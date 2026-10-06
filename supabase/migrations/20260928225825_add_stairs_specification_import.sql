
create or replace function public.apply_specification_stairs_import(
  p_project_id uuid,
  p_source_name text,
  p_source_sha256 text,
  p_panels jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_import_id uuid;
  v_section_id uuid;
  v_next_position integer;
  v_bad integer;
  v_positions integer;
  v_qty numeric;
  v_report jsonb;
begin
  if not private.can_edit_project(p_project_id) then
    raise exception 'Недостаточно прав для импорта в проект';
  end if;
  if jsonb_typeof(p_panels) <> 'array' or jsonb_array_length(p_panels)=0 then
    raise exception 'Файл лестниц не содержит позиций';
  end if;

  select count(*) into v_bad
  from jsonb_array_elements(p_panels) p
  where nullif(btrim(p->>'mark'),'') is null
     or nullif(btrim(p->>'name'),'') is null
     or nullif(btrim(p->>'source_identity'),'') is null
     or nullif(btrim(p->>'normalized_key'),'') is null
     or coalesce((p->'levels'->>'Л')::numeric,0) <= 0;
  if v_bad>0 then
    raise exception 'В импорте лестниц % некорректных строк',v_bad;
  end if;

  select count(*) into v_bad
  from (
    select p->>'source_identity' k,count(*) c
    from jsonb_array_elements(p_panels) p
    group by p->>'source_identity'
    having count(*)>1
  ) d;
  if v_bad>0 then
    raise exception 'В импорте лестниц есть дубли идентичности: %',v_bad;
  end if;

  insert into public.imports(project_id,domain,source_name,source_slot,status,report)
  values(
    p_project_id,'specification',p_source_name,'spec_stairs','loaded',
    jsonb_build_object('sha256',p_source_sha256,'building_section','Элементы лестниц','zone','Лестницы')
  )
  returning id into v_import_id;

  insert into public.import_rows(project_id,import_id,source_row_no,source_key,raw_data,normalized_data)
  select p_project_id,v_import_id,(p->>'source_row_no')::integer,p->>'source_identity',p,p
  from jsonb_array_elements(p_panels) p
  order by (p->>'source_row_no')::integer;

  insert into public.specification_sections(project_id,building_section,zone,name,sort_order,is_stairs)
  values(p_project_id,'Элементы лестниц','Лестницы','Элементы лестниц',9990,true)
  on conflict (project_id,building_section,zone,name,is_stairs)
  do update set sort_order=excluded.sort_order,updated_at=now()
  returning id into v_section_id;

  if v_section_id is null then
    select id into v_section_id
    from public.specification_sections
    where project_id=p_project_id and building_section='Элементы лестниц'
      and zone='Лестницы' and name='Элементы лестниц' and is_stairs=true;
  end if;

  insert into public.catalog_items(project_id,mark,name,normalized_key)
  select distinct p_project_id,
    ir.normalized_data->>'mark',
    ir.normalized_data->>'name',
    ir.normalized_data->>'normalized_key'
  from public.import_rows ir
  where ir.import_id=v_import_id
  on conflict (project_id,normalized_key)
    where normalized_key is not null and archived_at is null
  do update set mark=excluded.mark,name=excluded.name,archived_at=null,updated_at=now();

  update public.specification_rows sr
  set
    section_id=v_section_id,
    catalog_item_id=ci.id,
    designation=nullif(ir.normalized_data->>'designation',''),
    mass_kg=nullif(ir.normalized_data->>'mass_kg','')::numeric,
    sort_order=(ir.normalized_data->>'source_row_no')::integer,
    source_import_id=v_import_id,
    source_import_row_id=ir.id,
    source_original=jsonb_build_object(
      'source_slot','spec_stairs',
      'source_name',p_source_name,
      'source_identity',ir.normalized_data->>'source_identity',
      'source_row_no',(ir.normalized_data->>'source_row_no')::integer,
      'source_total',(ir.normalized_data->>'source_total')::numeric,
      'sha256',p_source_sha256
    ),
    archived_at=null,
    updated_at=now()
  from public.import_rows ir
  join public.catalog_items ci
    on ci.project_id=p_project_id
   and ci.normalized_key=ir.normalized_data->>'normalized_key'
   and ci.archived_at is null
  where ir.import_id=v_import_id
    and sr.project_id=p_project_id
    and sr.source_original->>'source_slot'='spec_stairs'
    and sr.source_original->>'source_identity'=ir.normalized_data->>'source_identity';

  update public.specification_rows sr
  set archived_at=now(),updated_at=now()
  where sr.project_id=p_project_id
    and sr.archived_at is null
    and sr.source_original->>'source_slot'='spec_stairs'
    and not exists(
      select 1 from public.import_rows ir
      where ir.import_id=v_import_id
        and ir.source_key=sr.source_original->>'source_identity'
    );

  select coalesce(max(position_no),0)+1 into v_next_position
  from public.specification_rows where project_id=p_project_id;

  insert into public.specification_rows(
    project_id,section_id,catalog_item_id,position_no,designation,mass_kg,sort_order,
    source_import_id,source_import_row_id,source_original
  )
  select
    p_project_id,v_section_id,ci.id,
    v_next_position-1+row_number() over(order by (ir.normalized_data->>'source_row_no')::integer),
    nullif(ir.normalized_data->>'designation',''),
    nullif(ir.normalized_data->>'mass_kg','')::numeric,
    (ir.normalized_data->>'source_row_no')::integer,
    v_import_id,ir.id,
    jsonb_build_object(
      'source_slot','spec_stairs',
      'source_name',p_source_name,
      'source_identity',ir.normalized_data->>'source_identity',
      'source_row_no',(ir.normalized_data->>'source_row_no')::integer,
      'source_total',(ir.normalized_data->>'source_total')::numeric,
      'sha256',p_source_sha256
    )
  from public.import_rows ir
  join public.catalog_items ci
    on ci.project_id=p_project_id
   and ci.normalized_key=ir.normalized_data->>'normalized_key'
   and ci.archived_at is null
  where ir.import_id=v_import_id
    and not exists(
      select 1 from public.specification_rows sr
      where sr.project_id=p_project_id
        and sr.archived_at is null
        and sr.source_original->>'source_slot'='spec_stairs'
        and sr.source_original->>'source_identity'=ir.normalized_data->>'source_identity'
    );

  delete from public.specification_quantities q
  using public.specification_rows sr
  where q.specification_row_id=sr.id
    and sr.project_id=p_project_id
    and sr.source_import_id=v_import_id;

  insert into public.specification_quantities(project_id,specification_row_id,level_code,level_order,quantity)
  select p_project_id,sr.id,'Л',30,(ir.normalized_data->'levels'->>'Л')::numeric
  from public.specification_rows sr
  join public.import_rows ir on ir.id=sr.source_import_row_id and ir.import_id=v_import_id
  where sr.project_id=p_project_id
    and (ir.normalized_data->'levels'->>'Л')::numeric<>0
  on conflict(specification_row_id,level_code)
  do update set quantity=excluded.quantity,level_order=excluded.level_order,updated_at=now();

  select count(distinct sr.id),coalesce(sum(q.quantity),0)
  into v_positions,v_qty
  from public.specification_rows sr
  left join public.specification_quantities q on q.specification_row_id=sr.id
  where sr.project_id=p_project_id and sr.source_import_id=v_import_id and sr.archived_at is null;

  v_report=jsonb_build_object(
    'source_slot','spec_stairs',
    'source_name',p_source_name,
    'sha256',p_source_sha256,
    'building_section','Элементы лестниц',
    'zone','Лестницы',
    'positions',v_positions,
    'quantity_total',v_qty,
    'validation','ok'
  );

  update public.imports
  set status='applied',report=v_report,applied_at=now()
  where id=v_import_id;

  insert into public.audit_events(project_id,domain,action,entity_type,entity_id,payload)
  values(p_project_id,'specification','import_applied','import',v_import_id,v_report);

  return v_report || jsonb_build_object('import_id',v_import_id);
end;
$$;

grant execute on function public.apply_specification_stairs_import(uuid,text,text,jsonb) to authenticated;
