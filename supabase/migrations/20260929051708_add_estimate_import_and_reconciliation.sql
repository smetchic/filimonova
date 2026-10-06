
create or replace function private.norm_match_text(p_text text)
returns text
language sql
immutable
parallel safe
set search_path=''
as $$
  select lower(regexp_replace(replace(btrim(coalesce(p_text,'')), chr(160), ' '), '\s+', ' ', 'g'));
$$;

create index if not exists ix_estimate_rows_source_identity
  on public.estimate_rows(project_id, estimate_id, (source_original->>'source_identity'));

create index if not exists ix_estimate_rows_source_import
  on public.estimate_rows(project_id, source_import_id)
  where archived_at is null;

create index if not exists ix_recon_project_estimate
  on public.reconciliation_links(project_id, estimate_row_id, link_method);

create or replace function public.refresh_estimate_reconciliation(p_estimate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_project_id uuid;
  v_auto_links integer := 0;
  v_resolved integer := 0;
  v_unlinked integer := 0;
begin
  select project_id into v_project_id from public.estimates where id=p_estimate_id;
  if v_project_id is null then raise exception 'Смета не найдена'; end if;
  if not private.can_edit_project(v_project_id) then raise exception 'Недостаточно прав'; end if;

  delete from public.reconciliation_links rl
  using public.estimate_rows er
  where er.id=rl.estimate_row_id
    and er.estimate_id=p_estimate_id
    and rl.link_method='auto';

  with material_rows as (
    select
      er.id as estimate_row_id,
      er.basis,
      er.name,
      er.section_id,
      es.title as estimate_section_title,
      e.project_id,
      e.building_section,
      e.zone,
      e.is_stairs,
      exists (
        select 1 from public.reconciliation_links ml
        where ml.estimate_row_id=er.id and ml.link_method='manual'
      ) as has_manual,
      (
        select count(*)
        from public.specification_sections ss0
        where ss0.project_id=e.project_id
          and ss0.is_stairs=e.is_stairs
          and (e.is_stairs or (
            (e.building_section is null or ss0.building_section=e.building_section)
            and (e.zone is null or ss0.zone=e.zone)
          ))
          and private.norm_match_text(ss0.name)=private.norm_match_text(es.title)
      ) as matching_section_count
    from public.estimate_rows er
    join public.estimates e on e.id=er.estimate_id
    left join public.estimate_sections es on es.id=er.section_id
    where er.estimate_id=p_estimate_id
      and er.archived_at is null
      and er.row_type='material'
  ),
  candidates as (
    select
      mr.*,
      bc.catalog_item_id as basis_catalog,
      bc.catalog_count as basis_count,
      nc.catalog_item_id as name_catalog,
      nc.catalog_count as name_count
    from material_rows mr
    left join lateral (
      select min(sr.catalog_item_id::text)::uuid as catalog_item_id,
             count(distinct sr.catalog_item_id) as catalog_count
      from public.specification_rows sr
      join public.specification_sections ss on ss.id=sr.section_id
      join public.catalog_items ci on ci.id=sr.catalog_item_id
      where sr.project_id=mr.project_id
        and sr.archived_at is null
        and ss.is_stairs=mr.is_stairs
        and (mr.is_stairs or (
          (mr.building_section is null or ss.building_section=mr.building_section)
          and (mr.zone is null or ss.zone=mr.zone)
        ))
        and (mr.matching_section_count<>1 or private.norm_match_text(ss.name)=private.norm_match_text(mr.estimate_section_title))
        and private.norm_match_text(ci.mark)=private.norm_match_text(mr.basis)
    ) bc on true
    left join lateral (
      select min(sr.catalog_item_id::text)::uuid as catalog_item_id,
             count(distinct sr.catalog_item_id) as catalog_count
      from public.specification_rows sr
      join public.specification_sections ss on ss.id=sr.section_id
      join public.catalog_items ci on ci.id=sr.catalog_item_id
      where sr.project_id=mr.project_id
        and sr.archived_at is null
        and ss.is_stairs=mr.is_stairs
        and (mr.is_stairs or (
          (mr.building_section is null or ss.building_section=mr.building_section)
          and (mr.zone is null or ss.zone=mr.zone)
        ))
        and (mr.matching_section_count<>1 or private.norm_match_text(ss.name)=private.norm_match_text(mr.estimate_section_title))
        and private.norm_match_text(ci.name)=private.norm_match_text(mr.name)
    ) nc on true
  ),
  resolved as (
    select *,
      case when basis_count=1 then basis_catalog
           when name_count=1 then name_catalog
           else null end as chosen_catalog,
      case when basis_count=1 then 'exact_basis'
           when name_count=1 then 'exact_name'
           else null end as chosen_method
    from candidates
    where not has_manual
  ),
  upd as (
    update public.estimate_rows er
    set catalog_item_id=r.chosen_catalog, updated_at=now()
    from resolved r
    where er.id=r.estimate_row_id
      and r.chosen_catalog is not null
    returning er.id
  )
  select count(*) into v_resolved from upd;

  with material_rows as (
    select
      er.id as estimate_row_id,
      er.catalog_item_id,
      er.section_id,
      es.title as estimate_section_title,
      e.project_id,
      e.building_section,
      e.zone,
      e.is_stairs,
      (
        select count(*)
        from public.specification_sections ss0
        where ss0.project_id=e.project_id
          and ss0.is_stairs=e.is_stairs
          and (e.is_stairs or (
            (e.building_section is null or ss0.building_section=e.building_section)
            and (e.zone is null or ss0.zone=e.zone)
          ))
          and private.norm_match_text(ss0.name)=private.norm_match_text(es.title)
      ) as matching_section_count
    from public.estimate_rows er
    join public.estimates e on e.id=er.estimate_id
    left join public.estimate_sections es on es.id=er.section_id
    where er.estimate_id=p_estimate_id
      and er.archived_at is null
      and er.row_type='material'
      and er.catalog_item_id is not null
      and not exists (
        select 1 from public.reconciliation_links ml
        where ml.estimate_row_id=er.id and ml.link_method='manual'
      )
  ),
  eligible as (
    select mr.*
    from material_rows mr
    where 1=(
      select count(*)
      from material_rows x
      where x.catalog_item_id=mr.catalog_item_id
        and (
          (mr.matching_section_count=1 and x.section_id=mr.section_id)
          or
          (mr.matching_section_count<>1)
        )
    )
  ),
  ins as (
    insert into public.reconciliation_links(
      project_id,estimate_row_id,specification_row_id,link_method,origin_mode
    )
    select
      el.project_id,
      el.estimate_row_id,
      sr.id,
      'auto',
      case when el.matching_section_count=1 then 'exact_block' else 'exact_scope' end
    from eligible el
    join public.specification_rows sr
      on sr.project_id=el.project_id
     and sr.catalog_item_id=el.catalog_item_id
     and sr.archived_at is null
    join public.specification_sections ss on ss.id=sr.section_id
    where ss.is_stairs=el.is_stairs
      and (el.is_stairs or (
        (el.building_section is null or ss.building_section=el.building_section)
        and (el.zone is null or ss.zone=el.zone)
      ))
      and (el.matching_section_count<>1 or private.norm_match_text(ss.name)=private.norm_match_text(el.estimate_section_title))
      and not exists (
        select 1 from public.reconciliation_links claimed
        where claimed.specification_row_id=sr.id
          and claimed.estimate_row_id<>el.estimate_row_id
      )
    on conflict (estimate_row_id,specification_row_id) do nothing
    returning id
  )
  select count(*) into v_auto_links from ins;

  select count(*) into v_unlinked
  from public.estimate_rows er
  where er.estimate_id=p_estimate_id
    and er.archived_at is null
    and er.row_type='material'
    and not exists (
      select 1 from public.reconciliation_links rl where rl.estimate_row_id=er.id
    );

  return jsonb_build_object(
    'resolved_catalog_rows',v_resolved,
    'auto_links_created',v_auto_links,
    'unlinked_material_rows',v_unlinked
  );
end;
$$;

create or replace function public.apply_estimate_import(
  p_project_id uuid,
  p_estimate_number text,
  p_source_name text,
  p_source_sha256 text,
  p_estimate_name text,
  p_sections jsonb,
  p_rows jsonb,
  p_notes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_import_id uuid;
  v_estimate_id uuid;
  v_building_section text;
  v_zone text;
  v_is_stairs boolean := false;
  v_bad integer;
  v_report jsonb;
  v_link_report jsonb;
begin
  if not private.can_edit_project(p_project_id) then
    raise exception 'Недостаточно прав для импорта сметы';
  end if;

  case p_estimate_number
    when '200' then v_building_section:='Секция 1'; v_zone:='Цоколь';
    when '201' then v_building_section:='Секция 2'; v_zone:='Цоколь';
    when '202' then v_building_section:='Секция 1'; v_zone:='Выше 0.000';
    when '203' then v_building_section:='Секция 2'; v_zone:='Выше 0.000';
    when '207' then v_building_section:='Элементы лестниц'; v_zone:='Лестницы'; v_is_stairs:=true;
    else raise exception 'Неизвестный номер локальной сметы: %',p_estimate_number;
  end case;

  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then
    raise exception 'Файл сметы не содержит строк Р/М';
  end if;
  if jsonb_typeof(p_sections)<>'array' or jsonb_array_length(p_sections)=0 then
    raise exception 'В файле сметы не найдены разделы';
  end if;

  select count(*) into v_bad
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'row_type','') not in ('work','material')
     or nullif(btrim(r->>'position'),'') is null
     or nullif(btrim(r->>'basis'),'') is null
     or nullif(btrim(r->>'name'),'') is null
     or nullif(btrim(r->>'unit'),'') is null
     or nullif(btrim(r->>'source_identity'),'') is null
     or nullif(btrim(r->>'section_title'),'') is null
     or (r->>'section_occurrence')::integer < 1;
  if v_bad>0 then raise exception 'В импорте сметы % некорректных строк',v_bad; end if;

  select count(*) into v_bad
  from (
    select r->>'source_identity' k,count(*) c
    from jsonb_array_elements(p_rows) r
    group by r->>'source_identity'
    having count(*)>1
  ) d;
  if v_bad>0 then raise exception 'В импорте сметы есть дубли стабильной идентичности: %',v_bad; end if;

  insert into public.imports(project_id,domain,source_name,source_slot,status,report)
  values(
    p_project_id,'estimate',p_source_name,'estimate_'||p_estimate_number,'loaded',
    jsonb_build_object('sha256',p_source_sha256,'estimate_number',p_estimate_number)
  )
  returning id into v_import_id;

  insert into public.estimates(
    project_id,number,name,status,source_import_id,imported_at,building_section,zone,is_stairs
  )
  values(
    p_project_id,p_estimate_number,nullif(btrim(p_estimate_name),''),
    'active',v_import_id,now(),v_building_section,v_zone,v_is_stairs
  )
  on conflict(project_id,number) do update set
    name=coalesce(excluded.name,public.estimates.name),
    status='active',
    source_import_id=v_import_id,
    imported_at=now(),
    building_section=excluded.building_section,
    zone=excluded.zone,
    is_stairs=excluded.is_stairs,
    updated_at=now()
  returning id into v_estimate_id;

  insert into public.estimate_sections(
    project_id,estimate_id,title,occurrence,sort_order,source_row_no
  )
  select
    p_project_id,v_estimate_id,
    s->>'title',
    (s->>'occurrence')::integer,
    (s->>'sort_order')::integer,
    nullif(s->>'source_row_no','')::integer
  from jsonb_array_elements(p_sections) s
  on conflict(estimate_id,title,occurrence) do update set
    sort_order=excluded.sort_order,
    source_row_no=excluded.source_row_no,
    updated_at=now();

  insert into public.import_rows(project_id,import_id,source_row_no,source_key,raw_data,normalized_data)
  select
    p_project_id,v_import_id,
    (r->>'source_row_no')::integer,
    r->>'source_identity',
    r,r
  from jsonb_array_elements(p_rows) r
  order by (r->>'source_row_no')::integer;

  update public.estimate_rows er
  set
    section_id=es.id,
    row_type=ir.normalized_data->>'row_type',
    position=ir.normalized_data->>'position',
    basis=case
      when er.basis is not distinct from er.source_original->>'basis'
      then ir.normalized_data->>'basis' else er.basis end,
    name=case
      when er.name is not distinct from er.source_original->>'name'
      then ir.normalized_data->>'name' else er.name end,
    unit=case
      when er.unit is not distinct from er.source_original->>'unit'
      then ir.normalized_data->>'unit' else er.unit end,
    quantity=case
      when er.quantity is not distinct from nullif(er.source_original->>'quantity','')::numeric
      then nullif(ir.normalized_data->>'quantity','')::numeric else er.quantity end,
    sort_order=(ir.normalized_data->>'sort_order')::integer,
    source_row_no=(ir.normalized_data->>'source_row_no')::integer,
    source_import_id=v_import_id,
    source_import_row_id=ir.id,
    source_original=jsonb_build_object(
      'position',ir.normalized_data->>'position',
      'basis',ir.normalized_data->>'basis',
      'name',ir.normalized_data->>'name',
      'unit',ir.normalized_data->>'unit',
      'quantity',nullif(ir.normalized_data->>'quantity','')::numeric,
      'costs',ir.normalized_data->'costs',
      'source_identity',ir.normalized_data->>'source_identity',
      'source_name',p_source_name,
      'sha256',p_source_sha256
    ),
    archived_at=null,
    updated_at=now()
  from public.import_rows ir
  join public.estimate_sections es
    on es.estimate_id=v_estimate_id
   and es.title=ir.normalized_data->>'section_title'
   and es.occurrence=(ir.normalized_data->>'section_occurrence')::integer
  where ir.import_id=v_import_id
    and er.estimate_id=v_estimate_id
    and er.source_original->>'source_identity'=ir.normalized_data->>'source_identity';

  insert into public.estimate_rows(
    project_id,estimate_id,section_id,row_type,position,basis,name,unit,quantity,
    sort_order,source_row_no,source_import_id,source_import_row_id,source_original
  )
  select
    p_project_id,v_estimate_id,es.id,
    ir.normalized_data->>'row_type',
    ir.normalized_data->>'position',
    ir.normalized_data->>'basis',
    ir.normalized_data->>'name',
    ir.normalized_data->>'unit',
    nullif(ir.normalized_data->>'quantity','')::numeric,
    (ir.normalized_data->>'sort_order')::integer,
    (ir.normalized_data->>'source_row_no')::integer,
    v_import_id,ir.id,
    jsonb_build_object(
      'position',ir.normalized_data->>'position',
      'basis',ir.normalized_data->>'basis',
      'name',ir.normalized_data->>'name',
      'unit',ir.normalized_data->>'unit',
      'quantity',nullif(ir.normalized_data->>'quantity','')::numeric,
      'costs',ir.normalized_data->'costs',
      'source_identity',ir.normalized_data->>'source_identity',
      'source_name',p_source_name,
      'sha256',p_source_sha256
    )
  from public.import_rows ir
  join public.estimate_sections es
    on es.estimate_id=v_estimate_id
   and es.title=ir.normalized_data->>'section_title'
   and es.occurrence=(ir.normalized_data->>'section_occurrence')::integer
  where ir.import_id=v_import_id
    and not exists(
      select 1 from public.estimate_rows er
      where er.estimate_id=v_estimate_id
        and er.source_original->>'source_identity'=ir.normalized_data->>'source_identity'
    );

  update public.estimate_rows er
  set archived_at=now(),updated_at=now()
  where er.estimate_id=v_estimate_id
    and er.archived_at is null
    and not exists(
      select 1 from public.import_rows ir
      where ir.import_id=v_import_id
        and ir.source_key=er.source_original->>'source_identity'
    );

  insert into public.estimate_row_costs(
    estimate_row_id,project_id,
    salary_unit,salary_amount,machines_unit,machines_amount,drivers_unit,drivers_amount,
    materials_unit,materials_amount,transport_unit,transport_amount,total_unit,total_amount
  )
  select
    er.id,p_project_id,
    coalesce((ir.normalized_data->'costs'->>'salary_unit')::numeric,0),
    coalesce((ir.normalized_data->'costs'->>'salary_amount')::numeric,0),
    coalesce((ir.normalized_data->'costs'->>'machines_unit')::numeric,0),
    coalesce((ir.normalized_data->'costs'->>'machines_amount')::numeric,0),
    coalesce((ir.normalized_data->'costs'->>'drivers_unit')::numeric,0),
    coalesce((ir.normalized_data->'costs'->>'drivers_amount')::numeric,0),
    coalesce((ir.normalized_data->'costs'->>'materials_unit')::numeric,0),
    coalesce((ir.normalized_data->'costs'->>'materials_amount')::numeric,0),
    coalesce((ir.normalized_data->'costs'->>'transport_unit')::numeric,0),
    coalesce((ir.normalized_data->'costs'->>'transport_amount')::numeric,0),
    coalesce((ir.normalized_data->'costs'->>'total_unit')::numeric,0),
    coalesce((ir.normalized_data->'costs'->>'total_amount')::numeric,0)
  from public.import_rows ir
  join public.estimate_rows er
    on er.estimate_id=v_estimate_id
   and er.source_original->>'source_identity'=ir.normalized_data->>'source_identity'
   and er.archived_at is null
  where ir.import_id=v_import_id
  on conflict(estimate_row_id) do update set
    salary_unit=excluded.salary_unit,
    salary_amount=excluded.salary_amount,
    machines_unit=excluded.machines_unit,
    machines_amount=excluded.machines_amount,
    drivers_unit=excluded.drivers_unit,
    drivers_amount=excluded.drivers_amount,
    materials_unit=excluded.materials_unit,
    materials_amount=excluded.materials_amount,
    transport_unit=excluded.transport_unit,
    transport_amount=excluded.transport_amount,
    total_unit=excluded.total_unit,
    total_amount=excluded.total_amount,
    updated_at=now();

  delete from public.estimate_notes where estimate_id=v_estimate_id;
  insert into public.estimate_notes(project_id,estimate_id,source_row_no,sort_order,text,source_original)
  select
    p_project_id,v_estimate_id,
    nullif(n->>'source_row_no','')::integer,
    coalesce(nullif(n->>'sort_order','')::integer,0),
    n->>'text',
    n
  from jsonb_array_elements(coalesce(p_notes,'[]'::jsonb)) n
  where nullif(btrim(n->>'text'),'') is not null;

  v_link_report:=public.refresh_estimate_reconciliation(v_estimate_id);

  v_report=jsonb_build_object(
    'estimate_number',p_estimate_number,
    'source_name',p_source_name,
    'sha256',p_source_sha256,
    'sections',jsonb_array_length(p_sections),
    'rows',jsonb_array_length(p_rows),
    'works',(select count(*) from public.estimate_rows where estimate_id=v_estimate_id and archived_at is null and row_type='work'),
    'materials',(select count(*) from public.estimate_rows where estimate_id=v_estimate_id and archived_at is null and row_type='material'),
    'reconciliation',v_link_report,
    'validation','ok'
  );

  update public.imports set status='applied',report=v_report,applied_at=now() where id=v_import_id;

  insert into public.audit_events(project_id,domain,action,entity_type,entity_id,payload)
  values(p_project_id,'estimate','import_applied','import',v_import_id,v_report);

  return v_report || jsonb_build_object('import_id',v_import_id,'estimate_id',v_estimate_id);
end;
$$;

create or replace function public.set_manual_reconciliation(
  p_estimate_row_id uuid,
  p_specification_row_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_project_id uuid;
  v_estimate_id uuid;
  v_catalog_count integer;
  v_catalog_id uuid;
begin
  select project_id,estimate_id into v_project_id,v_estimate_id
  from public.estimate_rows
  where id=p_estimate_row_id and archived_at is null and row_type='material';
  if v_project_id is null then raise exception 'Материальная строка сметы не найдена'; end if;
  if not private.can_edit_project(v_project_id) then raise exception 'Недостаточно прав'; end if;

  if exists(
    select 1
    from unnest(coalesce(p_specification_row_ids,'{}'::uuid[])) s(id)
    left join public.specification_rows sr on sr.id=s.id and sr.project_id=v_project_id and sr.archived_at is null
    where sr.id is null
  ) then raise exception 'В выборе есть отсутствующая позиция спецификации'; end if;

  if exists(
    select 1
    from unnest(coalesce(p_specification_row_ids,'{}'::uuid[])) s(id)
    join public.reconciliation_links rl on rl.specification_row_id=s.id
    where rl.estimate_row_id<>p_estimate_row_id
  ) then raise exception 'Конфликт: позиция спецификации уже связана с другой строкой сметы'; end if;

  delete from public.reconciliation_links where estimate_row_id=p_estimate_row_id;

  insert into public.reconciliation_links(project_id,estimate_row_id,specification_row_id,link_method,origin_mode)
  select v_project_id,p_estimate_row_id,s.id,'manual','manual'
  from unnest(coalesce(p_specification_row_ids,'{}'::uuid[])) s(id)
  on conflict(estimate_row_id,specification_row_id) do update set
    link_method='manual',origin_mode='manual',updated_at=now();

  select count(distinct sr.catalog_item_id),min(sr.catalog_item_id::text)::uuid
    into v_catalog_count,v_catalog_id
  from public.specification_rows sr
  where sr.id=any(coalesce(p_specification_row_ids,'{}'::uuid[]));

  update public.estimate_rows
  set catalog_item_id=case when v_catalog_count=1 then v_catalog_id else null end,updated_at=now()
  where id=p_estimate_row_id;

  return jsonb_build_object(
    'links',coalesce(array_length(p_specification_row_ids,1),0),
    'catalog_item_id',case when v_catalog_count=1 then v_catalog_id else null end
  );
end;
$$;

revoke all on function public.refresh_estimate_reconciliation(uuid) from public;
grant execute on function public.refresh_estimate_reconciliation(uuid) to authenticated;
revoke all on function public.apply_estimate_import(uuid,text,text,text,text,jsonb,jsonb,jsonb) from public;
grant execute on function public.apply_estimate_import(uuid,text,text,text,text,jsonb,jsonb,jsonb) to authenticated;
revoke all on function public.set_manual_reconciliation(uuid,uuid[]) from public;
grant execute on function public.set_manual_reconciliation(uuid,uuid[]) to authenticated;
