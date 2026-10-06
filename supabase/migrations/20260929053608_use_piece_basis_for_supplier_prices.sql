CREATE OR REPLACE FUNCTION public.apply_supplier_spec_import(p_project_id uuid, p_source_name text, p_source_sha256 text, p_supplier_name text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_import_id uuid;
  v_supplier_id uuid;
  v_bad integer;
  v_matched integer := 0;
  v_supplier_only integer := 0;
  v_review integer := 0;
  v_no_price integer := 0;
  v_new_price integer := 0;
  v_changed_price integer := 0;
  v_volume_conflicts integer := 0;
  v_qty_conflicts integer := 0;
  v_multi_price_conflicts integer := 0;
  v_report jsonb;
begin
  if not private.can_edit_project(p_project_id) then
    raise exception 'Недостаточно прав для импорта спецификации поставщика';
  end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then
    raise exception 'Файл поставщика не содержит товарных строк';
  end if;
  if nullif(btrim(p_supplier_name),'') is null then
    raise exception 'Не указано наименование поставщика';
  end if;

  select count(*) into v_bad
  from jsonb_array_elements(p_rows) r
  where nullif(btrim(r->>'source_key'),'') is null
     or nullif(btrim(r->>'source_mark'),'') is null
     or nullif(btrim(r->>'source_name'),'') is null
     or nullif(r->>'source_row_no','')::integer is null;
  if v_bad>0 then raise exception 'В импорте поставщика % некорректных строк',v_bad; end if;

  select count(*) into v_bad
  from (
    select r->>'source_key' k,count(*) c
    from jsonb_array_elements(p_rows) r
    group by r->>'source_key'
    having count(*)>1
  ) d;
  if v_bad>0 then raise exception 'В импорте поставщика есть дубли стабильной идентичности: %',v_bad; end if;

  select id into v_supplier_id
  from public.suppliers
  where project_id=p_project_id
    and archived_at is null
    and private.norm_supplier_name(name)=private.norm_supplier_name(p_supplier_name)
  order by created_at
  limit 1;

  if v_supplier_id is null then
    insert into public.suppliers(project_id,name)
    values(p_project_id,btrim(p_supplier_name))
    returning id into v_supplier_id;
  end if;

  insert into public.imports(project_id,domain,source_name,source_slot,status,report)
  values(
    p_project_id,'supplier_price',p_source_name,'supplier_spec','loaded',
    jsonb_build_object('sha256',p_source_sha256,'supplier',p_supplier_name)
  )
  returning id into v_import_id;

  insert into public.import_rows(project_id,import_id,source_row_no,source_key,raw_data,normalized_data)
  select p_project_id,v_import_id,(r->>'source_row_no')::integer,r->>'source_key',r,r
  from jsonb_array_elements(p_rows) r
  order by (r->>'source_row_no')::integer;

  create temporary table if not exists tmp_supplier_catalog(
    catalog_item_id uuid primary key,
    mark_norm text,
    name_norm text,
    project_qty numeric,
    project_volume numeric
  ) on commit drop;
  truncate tmp_supplier_catalog;

  insert into tmp_supplier_catalog(catalog_item_id,mark_norm,name_norm,project_qty,project_volume)
  select
    ci.id,
    private.norm_supplier_mark(ci.mark),
    private.norm_supplier_name(ci.name),
    coalesce(q.project_qty,0),
    v.project_volume
  from public.catalog_items ci
  left join lateral (
    select coalesce(sum(sq.quantity),0)::numeric project_qty
    from public.specification_rows sr
    join public.specification_quantities sq on sq.specification_row_id=sr.id
    where sr.project_id=p_project_id
      and sr.archived_at is null
      and sr.catalog_item_id=ci.id
  ) q on true
  left join lateral (
    select case
      when count(distinct sr.project_volume_m3) filter(where sr.project_volume_m3 is not null and sr.project_volume_m3>0)=1
      then min(sr.project_volume_m3) filter(where sr.project_volume_m3 is not null and sr.project_volume_m3>0)
      else null end project_volume
    from public.specification_rows sr
    where sr.project_id=p_project_id
      and sr.archived_at is null
      and sr.catalog_item_id=ci.id
  ) v on true
  where ci.project_id=p_project_id and ci.archived_at is null;

  create index if not exists tmp_supplier_catalog_mark_idx on tmp_supplier_catalog(mark_norm);
  create index if not exists tmp_supplier_catalog_name_idx on tmp_supplier_catalog(name_norm);
  create index if not exists tmp_supplier_catalog_both_idx on tmp_supplier_catalog(mark_norm,name_norm);

  create temporary table if not exists tmp_supplier_match(
    import_row_id uuid primary key,
    source_key text,
    catalog_item_id uuid,
    match_state text,
    project_qty numeric,
    project_volume numeric,
    source_qty numeric,
    source_volume numeric,
    volume_conflict boolean,
    qty_conflict boolean,
    no_price boolean
  ) on commit drop;
  truncate tmp_supplier_match;

  insert into tmp_supplier_match(
    import_row_id,source_key,catalog_item_id,match_state,
    project_qty,project_volume,source_qty,source_volume,
    volume_conflict,qty_conflict,no_price
  )
  with base as (
    select
      ir.id import_row_id,
      ir.source_key,
      ir.normalized_data,
      private.norm_supplier_mark(ir.normalized_data->>'source_mark') mark_norm,
      private.norm_supplier_name(ir.normalized_data->>'source_name') name_norm,
      nullif(ir.normalized_data->>'qty_house','')::numeric source_qty,
      nullif(ir.normalized_data->>'unit_volume_m3','')::numeric source_volume
    from public.import_rows ir
    where ir.import_id=v_import_id
  ),
  counts as (
    select
      b.*,
      (select count(*) from tmp_supplier_catalog c where c.mark_norm=b.mark_norm and c.name_norm=b.name_norm) both_cnt,
      (select min(c.catalog_item_id::text)::uuid from tmp_supplier_catalog c where c.mark_norm=b.mark_norm and c.name_norm=b.name_norm) both_id,
      (select count(*) from tmp_supplier_catalog c where c.mark_norm=b.mark_norm) mark_cnt,
      (select count(*) from tmp_supplier_catalog c where c.name_norm=b.name_norm) name_cnt
    from base b
  ),
  effective as (
    select
      c.*,
      old.catalog_item_id old_catalog,
      old.link_method old_method,
      case
        when old.link_method='manual' and old.catalog_item_id is not null then old.catalog_item_id
        when c.both_cnt=1 then c.both_id
        else null
      end chosen_catalog,
      case
        when old.link_method='manual' and old.catalog_item_id is not null then 'matched'
        when c.both_cnt=1 then 'matched'
        when c.both_cnt>1 then 'ambiguous'
        when c.mark_cnt>0 or c.name_cnt>0 then 'needs_review'
        else 'supplier_only'
      end chosen_state
    from counts c
    left join public.supplier_items old
      on old.project_id=p_project_id
     and old.supplier_id=v_supplier_id
     and old.source_key=c.source_key
     and old.archived_at is null
  )
  select
    e.import_row_id,e.source_key,e.chosen_catalog,e.chosen_state,
    tc.project_qty,tc.project_volume,e.source_qty,e.source_volume,
    (e.chosen_catalog is not null and e.source_volume is not null and tc.project_volume is not null
      and abs(e.source_volume-tc.project_volume)>0.000001),
    (e.chosen_catalog is not null and e.source_qty is not null and tc.project_qty is not null
      and abs(e.source_qty-tc.project_qty)>0.000001),
    not exists(
      select 1
      from jsonb_array_elements(coalesce(e.normalized_data->'prices','[]'::jsonb)) p
      where nullif(p->>'unit_price_gross','') is not null
    )
  from effective e
  left join tmp_supplier_catalog tc on tc.catalog_item_id=e.chosen_catalog;

  insert into public.supplier_items(
    project_id,supplier_id,catalog_item_id,source_mark,source_name,source_section,
    source_key,unit_volume_m3,link_method,link_state,source_import_row_id,archived_at
  )
  select
    p_project_id,v_supplier_id,
    case when old.link_method='manual' and old.catalog_item_id is not null then old.catalog_item_id else m.catalog_item_id end,
    ir.normalized_data->>'source_mark',
    ir.normalized_data->>'source_name',
    nullif(ir.normalized_data->>'source_section',''),
    ir.source_key,
    nullif(ir.normalized_data->>'unit_volume_m3','')::numeric,
    case
      when old.link_method='manual' and old.catalog_item_id is not null then 'manual'
      when m.catalog_item_id is not null then 'auto'
      else null
    end,
    case when m.volume_conflict or m.qty_conflict then 'needs_review' else m.match_state end,
    ir.id,null
  from public.import_rows ir
  join tmp_supplier_match m on m.import_row_id=ir.id
  left join public.supplier_items old
    on old.project_id=p_project_id
   and old.supplier_id=v_supplier_id
   and old.source_key=ir.source_key
  where ir.import_id=v_import_id
  on conflict(project_id,supplier_id,source_key) where source_key is not null
  do update set
    catalog_item_id=case
      when public.supplier_items.link_method='manual' and public.supplier_items.catalog_item_id is not null
      then public.supplier_items.catalog_item_id
      else excluded.catalog_item_id end,
    source_mark=excluded.source_mark,
    source_name=excluded.source_name,
    source_section=excluded.source_section,
    unit_volume_m3=excluded.unit_volume_m3,
    link_method=case
      when public.supplier_items.link_method='manual' and public.supplier_items.catalog_item_id is not null
      then 'manual' else excluded.link_method end,
    link_state=excluded.link_state,
    source_import_row_id=excluded.source_import_row_id,
    archived_at=null,
    updated_at=now();

  with prices as (
    select
      ir.id import_row_id,
      (p->>'effective_from')::date effective_from,
      coalesce(nullif(p->>'price_basis',''),'piece') price_basis,
      (p->>'unit_price_gross')::numeric unit_price_gross
    from public.import_rows ir
    cross join lateral jsonb_array_elements(coalesce(ir.normalized_data->'prices','[]'::jsonb)) p
    where ir.import_id=v_import_id
      and nullif(p->>'unit_price_gross','') is not null
  ),
  before_state as (
    select
      pr.*,
      si.id supplier_item_id,
      exists(
        select 1 from public.supplier_prices oldp
        where oldp.supplier_item_id=si.id
          and oldp.effective_from=pr.effective_from
          and oldp.price_basis=pr.price_basis
      ) had_date,
      exists(
        select 1 from public.supplier_prices oldp
        where oldp.supplier_item_id=si.id
          and oldp.effective_from=pr.effective_from
          and oldp.price_basis=pr.price_basis
          and oldp.unit_price_gross=pr.unit_price_gross
      ) had_exact
    from prices pr
    join public.import_rows ir on ir.id=pr.import_row_id
    join public.supplier_items si
      on si.project_id=p_project_id and si.supplier_id=v_supplier_id and si.source_key=ir.source_key
  )
  select
    count(*) filter(where not had_date),
    count(*) filter(where had_date and not had_exact)
  into v_new_price,v_changed_price
  from before_state;

  insert into public.supplier_prices(
    project_id,supplier_item_id,effective_from,price_basis,unit_price_gross,
    unit_volume_snapshot_m3,source_import_row_id
  )
  select
    p_project_id,si.id,
    (p->>'effective_from')::date,
    coalesce(nullif(p->>'price_basis',''),'piece'),
    (p->>'unit_price_gross')::numeric,
    nullif(ir.normalized_data->>'unit_volume_m3','')::numeric,
    ir.id
  from public.import_rows ir
  join public.supplier_items si
    on si.project_id=p_project_id and si.supplier_id=v_supplier_id and si.source_key=ir.source_key
  cross join lateral jsonb_array_elements(coalesce(ir.normalized_data->'prices','[]'::jsonb)) p
  where ir.import_id=v_import_id
    and nullif(p->>'unit_price_gross','') is not null
  on conflict(supplier_item_id,effective_from,price_basis,unit_price_gross) do nothing;

  select
    count(*) filter(where catalog_item_id is not null and match_state='matched' and not volume_conflict and not qty_conflict),
    count(*) filter(where match_state='supplier_only'),
    count(*) filter(where match_state in ('ambiguous','needs_review') or volume_conflict or qty_conflict),
    count(*) filter(where no_price),
    count(*) filter(where volume_conflict),
    count(*) filter(where qty_conflict)
  into v_matched,v_supplier_only,v_review,v_no_price,v_volume_conflicts,v_qty_conflicts
  from tmp_supplier_match;

  with conflict_catalogs as (
    select si.catalog_item_id,(p->>'effective_from')::date effective_from
    from public.import_rows ir
    join public.supplier_items si
      on si.project_id=p_project_id and si.supplier_id=v_supplier_id and si.source_key=ir.source_key
    cross join lateral jsonb_array_elements(coalesce(ir.normalized_data->'prices','[]'::jsonb)) p
    where ir.import_id=v_import_id
      and si.catalog_item_id is not null
      and nullif(p->>'unit_price_gross','') is not null
    group by si.catalog_item_id,(p->>'effective_from')::date
    having count(distinct (p->>'unit_price_gross')::numeric)>1
  )
  select count(*) into v_multi_price_conflicts from conflict_catalogs;

  if v_multi_price_conflicts>0 then
    update public.supplier_items si
    set link_state='needs_review',updated_at=now()
    where si.project_id=p_project_id
      and si.supplier_id=v_supplier_id
      and si.catalog_item_id in (
        select distinct x.catalog_item_id
        from (
          select si2.catalog_item_id,(p->>'effective_from')::date effective_from
          from public.import_rows ir
          join public.supplier_items si2
            on si2.project_id=p_project_id and si2.supplier_id=v_supplier_id and si2.source_key=ir.source_key
          cross join lateral jsonb_array_elements(coalesce(ir.normalized_data->'prices','[]'::jsonb)) p
          where ir.import_id=v_import_id
            and si2.catalog_item_id is not null
            and nullif(p->>'unit_price_gross','') is not null
          group by si2.catalog_item_id,(p->>'effective_from')::date
          having count(distinct (p->>'unit_price_gross')::numeric)>1
        ) x
      );
  end if;

  v_report=jsonb_build_object(
    'supplier',p_supplier_name,
    'source_name',p_source_name,
    'sha256',p_source_sha256,
    'rows',jsonb_array_length(p_rows),
    'matched',v_matched,
    'new_or_changed_price',v_new_price+v_changed_price,
    'new_price',v_new_price,
    'changed_price',v_changed_price,
    'without_price',v_no_price,
    'supplier_only',v_supplier_only,
    'requires_review',v_review+v_multi_price_conflicts,
    'volume_conflicts',v_volume_conflicts,
    'qty_conflicts',v_qty_conflicts,
    'multi_price_conflicts',v_multi_price_conflicts,
    'validation','ok'
  );

  update public.imports set status='applied',report=v_report,applied_at=now() where id=v_import_id;

  insert into public.audit_events(project_id,domain,action,entity_type,entity_id,payload)
  values(p_project_id,'supplier_price','import_applied','import',v_import_id,v_report);

  return v_report || jsonb_build_object('import_id',v_import_id,'supplier_id',v_supplier_id);
end;
$function$
