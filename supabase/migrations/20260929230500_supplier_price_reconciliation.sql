-- Independent supplier-price reconciliation contour.
-- A: imports/import_rows/supplier_prices remain immutable source snapshots.
-- B: supplier_price_links stores durable project nomenclature links.
-- C: supplier_price_journal is append-only history.

create table if not exists public.supplier_price_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  catalog_item_id uuid not null references public.catalog_items(id) on delete cascade,
  supplier_item_id uuid not null references public.supplier_items(id) on delete cascade,
  link_method text not null check (link_method in ('auto','manual')),
  validation_state text not null default 'confirmed' check (validation_state in ('confirmed','review','missing')),
  last_checked_import_id uuid references public.imports(id),
  created_by uuid default auth.uid() references auth.users(id),
  confirmed_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id,supplier_id,catalog_item_id),
  unique (supplier_item_id)
);

create index if not exists ix_supplier_price_links_project_catalog
  on public.supplier_price_links(project_id,catalog_item_id);

create table if not exists public.supplier_price_journal (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  import_id uuid references public.imports(id),
  catalog_item_id uuid references public.catalog_items(id),
  supplier_item_id uuid references public.supplier_items(id),
  event_type text not null,
  before_value jsonb not null default '{}'::jsonb,
  after_value jsonb not null default '{}'::jsonb,
  link_method text check (link_method in ('auto','manual')),
  actor_id uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists ix_supplier_price_journal_project_created
  on public.supplier_price_journal(project_id,created_at desc);
create index if not exists ix_supplier_price_journal_catalog
  on public.supplier_price_journal(project_id,catalog_item_id,created_at desc);

alter table public.supplier_price_links enable row level security;
alter table public.supplier_price_journal enable row level security;

drop policy if exists supplier_price_links_select on public.supplier_price_links;
create policy supplier_price_links_select on public.supplier_price_links for select to authenticated
using ((select private.is_project_member(project_id)));
drop policy if exists supplier_price_links_insert on public.supplier_price_links;
create policy supplier_price_links_insert on public.supplier_price_links for insert to authenticated
with check ((select private.can_edit_project(project_id)));
drop policy if exists supplier_price_links_update on public.supplier_price_links;
create policy supplier_price_links_update on public.supplier_price_links for update to authenticated
using ((select private.can_edit_project(project_id)))
with check ((select private.can_edit_project(project_id)));
drop policy if exists supplier_price_links_delete on public.supplier_price_links;
create policy supplier_price_links_delete on public.supplier_price_links for delete to authenticated
using ((select private.can_edit_project(project_id)));

drop policy if exists supplier_price_journal_select on public.supplier_price_journal;
create policy supplier_price_journal_select on public.supplier_price_journal for select to authenticated
using ((select private.is_project_member(project_id)));
-- No client UPDATE/DELETE policy: journal rows are append-only.

grant select,insert,update,delete on public.supplier_price_links to authenticated;
grant select on public.supplier_price_journal to authenticated;

-- Preserve all current supplier links as durable links before the import function changes.
insert into public.supplier_price_links(
  project_id,supplier_id,catalog_item_id,supplier_item_id,link_method,validation_state
)
select si.project_id,si.supplier_id,si.catalog_item_id,si.id,
       coalesce(si.link_method,'auto'),
       case when si.link_state in ('review','needs_review','ambiguous') then 'review' else 'confirmed' end
from public.supplier_items si
where si.supplier_id is not null and si.catalog_item_id is not null and si.archived_at is null
on conflict do nothing;

-- Each imported version owns its own immutable price facts. The current view chooses the newest snapshot.
alter table public.supplier_prices
  drop constraint if exists supplier_prices_supplier_item_id_effective_from_price_basis_key;
drop index if exists public.supplier_prices_supplier_item_id_effective_from_price_basis_key;
create unique index if not exists ux_supplier_prices_snapshot
  on public.supplier_prices(supplier_item_id,effective_from,price_basis,source_import_row_id);

create or replace view public.supplier_price_snapshot_rows
with (security_invoker=true) as
select
  i.project_id,
  i.id as import_id,
  i.source_name,
  i.imported_at,
  dense_rank() over(partition by i.project_id order by i.imported_at,i.id) as version_no,
  s.id as supplier_id,
  ir.id as import_row_id,
  ir.source_row_no,
  ir.source_key,
  ir.raw_data,
  ir.normalized_data,
  si.id as supplier_item_id,
  spl.catalog_item_id,
  spl.link_method,
  spl.validation_state
from public.imports i
join public.import_rows ir on ir.import_id=i.id
left join public.suppliers s
  on s.project_id=i.project_id
 and s.archived_at is null
 and private.norm_supplier_name(s.name)=private.norm_supplier_name(i.report->>'supplier')
left join public.supplier_items si
  on si.project_id=i.project_id and si.supplier_id=s.id and si.source_key=ir.source_key
left join public.supplier_price_links spl on spl.supplier_item_id=si.id
where i.domain='supplier_price' and i.status='applied';

grant select on public.supplier_price_snapshot_rows to authenticated;

create or replace function public.set_supplier_price_link(
  p_project_id uuid,
  p_catalog_item_id uuid,
  p_supplier_item_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_supplier_id uuid;
  v_old public.supplier_price_links%rowtype;
  v_import_id uuid;
begin
  if not private.can_edit_project(p_project_id) then raise exception 'Недостаточно прав'; end if;
  if not exists(select 1 from public.catalog_items where id=p_catalog_item_id and project_id=p_project_id and archived_at is null) then
    raise exception 'Проектная номенклатура не найдена';
  end if;
  select * into v_old from public.supplier_price_links
  where project_id=p_project_id and catalog_item_id=p_catalog_item_id for update;

  if p_supplier_item_id is null then
    if v_old.id is not null then
      update public.supplier_items set catalog_item_id=null,link_method=null,link_state='unmatched',updated_at=now()
      where id=v_old.supplier_item_id and link_method='manual';
      delete from public.supplier_price_links where id=v_old.id;
      insert into public.supplier_price_journal(project_id,import_id,catalog_item_id,supplier_item_id,event_type,before_value,link_method)
      values(p_project_id,v_old.last_checked_import_id,p_catalog_item_id,v_old.supplier_item_id,'manual_link_removed',
        jsonb_build_object('supplier_item_id',v_old.supplier_item_id),'manual');
    end if;
    return jsonb_build_object('status','removed');
  end if;

  select supplier_id into v_supplier_id from public.supplier_items
  where id=p_supplier_item_id and project_id=p_project_id and archived_at is null;
  if v_supplier_id is null then raise exception 'Позиция поставщика не найдена'; end if;
  if exists(select 1 from public.supplier_price_links where supplier_item_id=p_supplier_item_id and catalog_item_id<>p_catalog_item_id) then
    raise exception 'Позиция поставщика уже связана с другой проектной номенклатурой';
  end if;
  select i.id into v_import_id from public.imports i
  where i.project_id=p_project_id and i.domain='supplier_price' and i.status='applied'
  order by i.imported_at desc limit 1;

  if v_old.id is null then
    insert into public.supplier_price_links(project_id,supplier_id,catalog_item_id,supplier_item_id,link_method,validation_state,last_checked_import_id)
    values(p_project_id,v_supplier_id,p_catalog_item_id,p_supplier_item_id,'manual','confirmed',v_import_id);
    insert into public.supplier_price_journal(project_id,import_id,catalog_item_id,supplier_item_id,event_type,after_value,link_method)
    values(p_project_id,v_import_id,p_catalog_item_id,p_supplier_item_id,'manual_link_created',jsonb_build_object('supplier_item_id',p_supplier_item_id),'manual');
  else
    if v_old.supplier_item_id<>p_supplier_item_id then
      update public.supplier_items set catalog_item_id=null,link_method=null,link_state='unmatched',updated_at=now()
      where id=v_old.supplier_item_id and link_method='manual';
    end if;
    update public.supplier_price_links set supplier_id=v_supplier_id,supplier_item_id=p_supplier_item_id,
      link_method='manual',validation_state='confirmed',last_checked_import_id=v_import_id,
      confirmed_by=auth.uid(),updated_at=now() where id=v_old.id;
    insert into public.supplier_price_journal(project_id,import_id,catalog_item_id,supplier_item_id,event_type,before_value,after_value,link_method)
    values(p_project_id,v_import_id,p_catalog_item_id,p_supplier_item_id,
      case when v_old.supplier_item_id=p_supplier_item_id then 'ambiguous_confirmed' else 'manual_link_changed' end,
      jsonb_build_object('supplier_item_id',v_old.supplier_item_id),jsonb_build_object('supplier_item_id',p_supplier_item_id),'manual');
  end if;
  update public.supplier_items set catalog_item_id=p_catalog_item_id,link_method='manual',link_state='matched',updated_at=now()
  where id=p_supplier_item_id;
  return jsonb_build_object('status','confirmed','catalog_item_id',p_catalog_item_id,'supplier_item_id',p_supplier_item_id);
end;
$$;

grant execute on function public.set_supplier_price_link(uuid,uuid,uuid) to authenticated;

create or replace function public.apply_supplier_spec_import(
  p_project_id uuid,
  p_source_name text,
  p_source_sha256 text,
  p_supplier_name text,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_import_id uuid;
  v_previous_import_id uuid;
  v_supplier_id uuid;
  v_bad integer;
  v_report jsonb;
  v_rows integer;
  v_matched integer;
  v_supplier_only integer;
  v_review integer;
  v_no_price integer;
  v_changed_price integer:=0;
  v_volume_conflicts integer;
  v_qty_conflicts integer;
begin
  if not private.can_edit_project(p_project_id) then raise exception 'Недостаточно прав для импорта прайса'; end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then raise exception 'Файл поставщика не содержит товарных строк'; end if;
  if nullif(btrim(p_supplier_name),'') is null then raise exception 'Не указан поставщик'; end if;
  select count(*) into v_bad from jsonb_array_elements(p_rows) r
  where nullif(btrim(r->>'source_key'),'') is null or nullif(btrim(r->>'source_mark'),'') is null
     or nullif(btrim(r->>'source_name'),'') is null or nullif(r->>'source_row_no','')::integer is null;
  if v_bad>0 then raise exception 'В импорте % некорректных строк',v_bad; end if;
  select count(*) into v_bad from (select r->>'source_key' from jsonb_array_elements(p_rows) r group by 1 having count(*)>1) d;
  if v_bad>0 then raise exception 'В импорте есть дубли стабильной идентичности: %',v_bad; end if;

  select id into v_supplier_id from public.suppliers where project_id=p_project_id and archived_at is null
    and private.norm_supplier_name(name)=private.norm_supplier_name(p_supplier_name) order by created_at limit 1;
  if v_supplier_id is null then
    insert into public.suppliers(project_id,name) values(p_project_id,btrim(p_supplier_name)) returning id into v_supplier_id;
  end if;
  select id into v_previous_import_id from public.imports
  where project_id=p_project_id and domain='supplier_price' and status='applied'
    and private.norm_supplier_name(report->>'supplier')=private.norm_supplier_name(p_supplier_name)
  order by imported_at desc limit 1;

  insert into public.imports(project_id,domain,source_name,source_slot,status,report)
  values(p_project_id,'supplier_price',p_source_name,'supplier_spec','loaded',
    jsonb_build_object('sha256',p_source_sha256,'supplier',p_supplier_name,'supplier_id',v_supplier_id)) returning id into v_import_id;
  insert into public.import_rows(project_id,import_id,source_row_no,source_key,raw_data,normalized_data)
  select p_project_id,v_import_id,(r->>'source_row_no')::integer,r->>'source_key',r,r
  from jsonb_array_elements(p_rows) r order by (r->>'source_row_no')::integer;

  create temporary table tmp_supplier_eval on commit drop as
  with project_catalog as (
    select ci.id catalog_item_id,private.norm_supplier_mark(ci.mark) mark_norm,private.norm_supplier_name(ci.name) name_norm,
      coalesce((select sum(sq.quantity) from public.specification_rows sr join public.specification_quantities sq on sq.specification_row_id=sr.id
        where sr.project_id=p_project_id and sr.archived_at is null and sr.catalog_item_id=ci.id),0)::numeric project_qty,
      (select case when count(distinct sr.project_volume_m3) filter(where sr.project_volume_m3>0)=1
        then min(sr.project_volume_m3) filter(where sr.project_volume_m3>0) end from public.specification_rows sr
        where sr.project_id=p_project_id and sr.archived_at is null and sr.catalog_item_id=ci.id) project_volume
    from public.catalog_items ci where ci.project_id=p_project_id and ci.archived_at is null
  ), source_rows as (
    select ir.*,private.norm_supplier_mark(ir.raw_data->>'source_mark') mark_norm,
      private.norm_supplier_name(ir.raw_data->>'source_name') name_norm,
      nullif(ir.raw_data->>'qty_house','')::numeric source_qty,
      nullif(ir.raw_data->>'unit_volume_m3','')::numeric source_volume
    from public.import_rows ir where ir.import_id=v_import_id
  )
  select s.id import_row_id,s.source_key,s.raw_data,s.mark_norm,s.name_norm,s.source_qty,s.source_volume,
    (select count(*) from project_catalog c where c.mark_norm=s.mark_norm and c.name_norm=s.name_norm) exact_count,
    (select min(c.catalog_item_id::text)::uuid from project_catalog c where c.mark_norm=s.mark_norm and c.name_norm=s.name_norm) exact_catalog_id,
    (select count(*) from project_catalog c where c.mark_norm=s.mark_norm) mark_count,
    (select count(*) from project_catalog c where c.name_norm=s.name_norm) name_count
  from source_rows s;

  -- Stable supplier entities keep source text from the latest file; immutable text stays in import_rows.raw_data.
  insert into public.supplier_items(project_id,supplier_id,source_mark,source_name,source_section,source_key,unit_volume_m3,link_state,source_import_row_id)
  select p_project_id,v_supplier_id,e.raw_data->>'source_mark',e.raw_data->>'source_name',nullif(e.raw_data->>'source_section',''),
    e.source_key,e.source_volume,
    case when e.exact_count>1 or (e.exact_count=0 and (e.mark_count>0 or e.name_count>0)) then 'needs_review'
         when e.exact_count=1 then 'matched' else 'supplier_only' end,e.import_row_id
  from tmp_supplier_eval e
  on conflict(project_id,supplier_id,source_key) where source_key is not null do update set
    source_mark=excluded.source_mark,source_name=excluded.source_name,source_section=excluded.source_section,
    unit_volume_m3=excluded.unit_volume_m3,source_import_row_id=excluded.source_import_row_id,archived_at=null,updated_at=now();

  -- Reuse persistent links first. Manual links are never replaced.
  update public.supplier_items si set catalog_item_id=l.catalog_item_id,link_method=l.link_method,
    link_state=case when l.validation_state='review' then 'needs_review' else 'matched' end,updated_at=now()
  from public.supplier_price_links l join tmp_supplier_eval e on true
  where si.project_id=p_project_id and si.supplier_id=v_supplier_id and si.source_key=e.source_key and l.supplier_item_id=si.id;

  -- Exact normalized match is allowed only when both sides are unambiguous and no durable link conflicts.
  insert into public.supplier_price_links(project_id,supplier_id,catalog_item_id,supplier_item_id,link_method,validation_state,last_checked_import_id)
  select p_project_id,v_supplier_id,e.exact_catalog_id,si.id,'auto','confirmed',v_import_id
  from tmp_supplier_eval e join public.supplier_items si
    on si.project_id=p_project_id and si.supplier_id=v_supplier_id and si.source_key=e.source_key
  where e.exact_count=1
    and not exists(select 1 from public.supplier_price_links l where l.supplier_item_id=si.id)
    and not exists(select 1 from public.supplier_price_links l where l.project_id=p_project_id and l.supplier_id=v_supplier_id and l.catalog_item_id=e.exact_catalog_id)
  on conflict do nothing;

  insert into public.supplier_price_journal(project_id,import_id,catalog_item_id,supplier_item_id,event_type,after_value,link_method)
  select l.project_id,v_import_id,l.catalog_item_id,l.supplier_item_id,'automatic_exact_link',
    jsonb_build_object('source_mark',si.source_mark,'source_name',si.source_name),'auto'
  from public.supplier_price_links l join public.supplier_items si on si.id=l.supplier_item_id
  where l.last_checked_import_id=v_import_id and l.created_at>=now()-interval '10 seconds'
    and not exists(select 1 from public.supplier_price_journal j where j.import_id=v_import_id and j.supplier_item_id=l.supplier_item_id and j.event_type='automatic_exact_link');

  update public.supplier_items si set catalog_item_id=l.catalog_item_id,link_method=l.link_method,link_state='matched',updated_at=now()
  from public.supplier_price_links l where l.supplier_item_id=si.id and si.source_import_row_id in(select import_row_id from tmp_supplier_eval);
  update public.supplier_price_links l set last_checked_import_id=v_import_id,
    validation_state=case when exists(select 1 from public.supplier_items si join tmp_supplier_eval e on e.source_key=si.source_key
      where si.id=l.supplier_item_id and si.source_import_row_id=e.import_row_id) then 'confirmed' else 'missing' end,updated_at=now()
  where l.project_id=p_project_id and l.supplier_id=v_supplier_id;

  -- Compare against the previous immutable snapshot before inserting current price facts.
  insert into public.supplier_price_journal(project_id,import_id,catalog_item_id,supplier_item_id,event_type,before_value,after_value,link_method)
  select p_project_id,v_import_id,l.catalog_item_id,si.id,'price_changed',
    jsonb_build_object('price',oldp.unit_price_gross,'effective_from',oldp.effective_from),
    jsonb_build_object('price',(p->>'unit_price_gross')::numeric,'effective_from',(p->>'effective_from')::date),l.link_method
  from tmp_supplier_eval e
  join public.supplier_items si on si.project_id=p_project_id and si.supplier_id=v_supplier_id and si.source_key=e.source_key
  join public.supplier_price_links l on l.supplier_item_id=si.id
  cross join lateral jsonb_array_elements(coalesce(e.raw_data->'prices','[]'::jsonb)) p
  join lateral (
    select sp.* from public.supplier_prices sp left join public.import_rows pir on pir.id=sp.source_import_row_id
    left join public.imports pi on pi.id=pir.import_id
    where sp.supplier_item_id=si.id and sp.effective_from=(p->>'effective_from')::date and sp.price_basis=coalesce(nullif(p->>'price_basis',''),'piece')
    order by pi.imported_at desc nulls last,sp.created_at desc limit 1
  ) oldp on oldp.unit_price_gross<>(p->>'unit_price_gross')::numeric;
  get diagnostics v_changed_price=row_count;

  insert into public.supplier_prices(project_id,supplier_item_id,effective_from,price_basis,unit_price_gross,unit_volume_snapshot_m3,source_import_row_id)
  select p_project_id,si.id,(p->>'effective_from')::date,coalesce(nullif(p->>'price_basis',''),'piece'),
    (p->>'unit_price_gross')::numeric,e.source_volume,e.import_row_id
  from tmp_supplier_eval e join public.supplier_items si
    on si.project_id=p_project_id and si.supplier_id=v_supplier_id and si.source_key=e.source_key
  cross join lateral jsonb_array_elements(coalesce(e.raw_data->'prices','[]'::jsonb)) p
  where nullif(p->>'unit_price_gross','') is not null on conflict do nothing;

  -- Missing linked positions retain their previous prices, but the new check records absence.
  insert into public.supplier_price_journal(project_id,import_id,catalog_item_id,supplier_item_id,event_type,before_value,after_value,link_method)
  select p_project_id,v_import_id,l.catalog_item_id,l.supplier_item_id,'missing_in_new_version',
    jsonb_build_object('previous_price_continues',true),jsonb_build_object('present',false),l.link_method
  from public.supplier_price_links l join public.supplier_items si on si.id=l.supplier_item_id
  where l.project_id=p_project_id and l.supplier_id=v_supplier_id and l.validation_state='missing'
    and not exists(select 1 from public.supplier_price_journal j where j.import_id=v_import_id and j.supplier_item_id=l.supplier_item_id and j.event_type='missing_in_new_version');

  -- First appearance without a project counterpart.
  insert into public.supplier_price_journal(project_id,import_id,supplier_item_id,event_type,after_value)
  select p_project_id,v_import_id,si.id,'supplier_only_appeared',jsonb_build_object('source_mark',si.source_mark,'source_name',si.source_name)
  from tmp_supplier_eval e join public.supplier_items si
    on si.project_id=p_project_id and si.supplier_id=v_supplier_id and si.source_key=e.source_key
  where e.exact_count=0 and e.mark_count=0 and e.name_count=0
    and (v_previous_import_id is null or not exists(select 1 from public.import_rows oldr where oldr.import_id=v_previous_import_id and oldr.source_key=e.source_key));

  select count(*),
    count(*) filter(where l.catalog_item_id is not null and e.exact_count<=1),
    count(*) filter(where l.catalog_item_id is null and e.exact_count=0 and e.mark_count=0 and e.name_count=0),
    count(*) filter(where l.catalog_item_id is null and (e.exact_count>1 or e.mark_count>0 or e.name_count>0)),
    count(*) filter(where jsonb_array_length(coalesce(e.raw_data->'prices','[]'::jsonb))=0),
    count(*) filter(where l.catalog_item_id is not null and e.source_volume is not null and pf.project_volume is not null and abs(e.source_volume-pf.project_volume)>0.000001),
    count(*) filter(where l.catalog_item_id is not null and e.source_qty is not null and abs(e.source_qty-pf.project_qty)>0.000001)
  into v_rows,v_matched,v_supplier_only,v_review,v_no_price,v_volume_conflicts,v_qty_conflicts
  from tmp_supplier_eval e
  join public.supplier_items si on si.project_id=p_project_id and si.supplier_id=v_supplier_id and si.source_key=e.source_key
  left join public.supplier_price_links l on l.supplier_item_id=si.id
  left join lateral (
    select coalesce(sum(sq.quantity),0)::numeric project_qty,
      case when count(distinct sr.project_volume_m3) filter(where sr.project_volume_m3>0)=1 then min(sr.project_volume_m3) filter(where sr.project_volume_m3>0) end project_volume
    from public.specification_rows sr left join public.specification_quantities sq on sq.specification_row_id=sr.id
    where sr.project_id=p_project_id and sr.archived_at is null and sr.catalog_item_id=l.catalog_item_id
  ) pf on true;

  v_report=jsonb_build_object('supplier',p_supplier_name,'supplier_id',v_supplier_id,'source_name',p_source_name,'sha256',p_source_sha256,
    'rows',v_rows,'matched',v_matched,'changed_price',v_changed_price,'new_or_changed_price',v_changed_price,
    'without_price',v_no_price,'supplier_only',v_supplier_only,'requires_review',v_review,
    'volume_conflicts',v_volume_conflicts,'qty_conflicts',v_qty_conflicts,'validation','ok');
  update public.imports set status='applied',report=v_report,applied_at=now() where id=v_import_id;
  insert into public.audit_events(project_id,domain,action,entity_type,entity_id,payload)
  values(p_project_id,'supplier_price','import_applied','import',v_import_id,v_report);
  return v_report||jsonb_build_object('import_id',v_import_id);
end;
$$;

grant execute on function public.apply_supplier_spec_import(uuid,text,text,text,jsonb) to authenticated;
