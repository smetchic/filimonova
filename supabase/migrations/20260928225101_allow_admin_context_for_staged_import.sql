
create or replace function public.append_specification_import_batch(
  p_import_id uuid,
  p_panels jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_project_id uuid;
  v_source_slot text;
  v_source_name text;
  v_sha text;
  v_building_section text;
  v_zone text;
  v_next_position integer;
  v_inserted integer := 0;
  v_updated integer := 0;
begin
  select project_id,source_slot,source_name,report->>'sha256'
    into v_project_id,v_source_slot,v_source_name,v_sha
  from public.imports
  where id=p_import_id and domain='specification' and status='loaded';

  if v_project_id is null then
    raise exception 'Черновик импорта спецификации не найден';
  end if;
  if auth.uid() is not null and not private.can_edit_project(v_project_id) then
    raise exception 'Недостаточно прав для импорта в проект';
  end if;

  case v_source_slot
    when 'spec_s1_basement' then v_building_section:='Секция 1'; v_zone:='Цоколь';
    when 'spec_s1_above' then v_building_section:='Секция 1'; v_zone:='Выше 0.000';
    when 'spec_s2_basement' then v_building_section:='Секция 2'; v_zone:='Цоколь';
    when 'spec_s2_above' then v_building_section:='Секция 2'; v_zone:='Выше 0.000';
    else raise exception 'Неизвестный слот спецификации: %',v_source_slot;
  end case;

  insert into public.import_rows(project_id,import_id,source_row_no,source_key,raw_data,normalized_data)
  select
    v_project_id,p_import_id,
    (p->>'source_row_no')::integer,
    p->>'source_identity',
    p,p
  from jsonb_array_elements(p_panels) p
  on conflict (import_id,source_key) where source_key is not null
  do update set
    source_row_no=excluded.source_row_no,
    raw_data=excluded.raw_data,
    normalized_data=excluded.normalized_data;

  insert into public.catalog_items(project_id,mark,name,normalized_key)
  select distinct
    v_project_id,
    ir.normalized_data->>'mark',
    ir.normalized_data->>'name',
    ir.normalized_data->>'normalized_key'
  from public.import_rows ir
  join jsonb_array_elements(p_panels) p
    on ir.import_id=p_import_id
   and ir.source_key=p->>'source_identity'
  on conflict (project_id,normalized_key)
    where normalized_key is not null and archived_at is null
  do update set
    mark=excluded.mark,
    name=excluded.name,
    archived_at=null,
    updated_at=now();

  with src as (
    select ir.*
    from public.import_rows ir
    join jsonb_array_elements(p_panels) p
      on ir.import_id=p_import_id
     and ir.source_key=p->>'source_identity'
  ),
  upd as (
    update public.specification_rows sr
    set
      section_id=ss.id,
      catalog_item_id=ci.id,
      designation=nullif(src.normalized_data->>'designation',''),
      mass_kg=nullif(src.normalized_data->>'mass_kg','')::numeric,
      sort_order=(src.normalized_data->>'source_row_no')::integer,
      source_import_id=p_import_id,
      source_import_row_id=src.id,
      source_original=jsonb_build_object(
        'source_slot',v_source_slot,
        'source_name',v_source_name,
        'source_identity',src.normalized_data->>'source_identity',
        'source_row_no',(src.normalized_data->>'source_row_no')::integer,
        'source_total',(src.normalized_data->>'source_total')::numeric,
        'sha256',v_sha
      ),
      archived_at=null,
      updated_at=now()
    from src
    join public.specification_sections ss
      on ss.project_id=v_project_id
     and ss.building_section=v_building_section
     and ss.zone=v_zone
     and ss.name=src.normalized_data->>'section'
     and ss.is_stairs=false
    join public.catalog_items ci
      on ci.project_id=v_project_id
     and ci.normalized_key=src.normalized_data->>'normalized_key'
     and ci.archived_at is null
    where sr.project_id=v_project_id
      and sr.source_original->>'source_slot'=v_source_slot
      and sr.source_original->>'source_identity'=src.normalized_data->>'source_identity'
    returning sr.id
  )
  select count(*) into v_updated from upd;

  select coalesce(max(position_no),0)+1
    into v_next_position
  from public.specification_rows
  where project_id=v_project_id;

  with src as (
    select ir.*
    from public.import_rows ir
    join jsonb_array_elements(p_panels) p
      on ir.import_id=p_import_id
     and ir.source_key=p->>'source_identity'
  ),
  new_src as (
    select src.*,
           row_number() over(order by (src.normalized_data->>'source_row_no')::integer) rn
    from src
    where not exists (
      select 1
      from public.specification_rows sr
      where sr.project_id=v_project_id
        and sr.source_original->>'source_slot'=v_source_slot
        and sr.source_original->>'source_identity'=src.normalized_data->>'source_identity'
    )
  ),
  ins as (
    insert into public.specification_rows(
      project_id,section_id,catalog_item_id,position_no,designation,mass_kg,sort_order,
      source_import_id,source_import_row_id,source_original
    )
    select
      v_project_id,
      ss.id,
      ci.id,
      v_next_position-1+new_src.rn,
      nullif(new_src.normalized_data->>'designation',''),
      nullif(new_src.normalized_data->>'mass_kg','')::numeric,
      (new_src.normalized_data->>'source_row_no')::integer,
      p_import_id,
      new_src.id,
      jsonb_build_object(
        'source_slot',v_source_slot,
        'source_name',v_source_name,
        'source_identity',new_src.normalized_data->>'source_identity',
        'source_row_no',(new_src.normalized_data->>'source_row_no')::integer,
        'source_total',(new_src.normalized_data->>'source_total')::numeric,
        'sha256',v_sha
      )
    from new_src
    join public.specification_sections ss
      on ss.project_id=v_project_id
     and ss.building_section=v_building_section
     and ss.zone=v_zone
     and ss.name=new_src.normalized_data->>'section'
     and ss.is_stairs=false
    join public.catalog_items ci
      on ci.project_id=v_project_id
     and ci.normalized_key=new_src.normalized_data->>'normalized_key'
     and ci.archived_at is null
    returning id
  )
  select count(*) into v_inserted from ins;

  delete from public.specification_quantities q
  using public.specification_rows sr, public.import_rows ir
  where q.specification_row_id=sr.id
    and sr.source_import_row_id=ir.id
    and ir.import_id=p_import_id
    and exists (
      select 1 from jsonb_array_elements(p_panels) p
      where p->>'source_identity'=ir.source_key
    );

  insert into public.specification_quantities(
    project_id,specification_row_id,level_code,level_order,quantity
  )
  select
    v_project_id,
    sr.id,
    lvl.key,
    case
      when lvl.key='Ц' then 0
      when lvl.key ~ '^\d+$' then lvl.key::integer
      when lvl.key='Ч' then 20
      when lvl.key='К' then 21
      else 99
    end,
    lvl.value::numeric
  from public.specification_rows sr
  join public.import_rows ir on ir.id=sr.source_import_row_id
  cross join lateral jsonb_each_text(ir.normalized_data->'levels') lvl
  where ir.import_id=p_import_id
    and exists (
      select 1 from jsonb_array_elements(p_panels) p
      where p->>'source_identity'=ir.source_key
    )
    and lvl.value::numeric<>0
  on conflict (specification_row_id,level_code)
  do update set
    quantity=excluded.quantity,
    level_order=excluded.level_order,
    updated_at=now();

  return jsonb_build_object(
    'inserted',v_inserted,
    'updated',v_updated,
    'batch_rows',jsonb_array_length(p_panels)
  );
end;
$$;

create or replace function public.finalize_specification_import(p_import_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_project_id uuid;
  v_slot text;
  v_source_name text;
  v_bad integer;
  v_positions integer;
  v_qty numeric;
  v_report jsonb;
begin
  select project_id,source_slot,source_name
    into v_project_id,v_slot,v_source_name
  from public.imports
  where id=p_import_id and domain='specification' and status='loaded';

  if v_project_id is null then
    raise exception 'Черновик импорта спецификации не найден';
  end if;
  if auth.uid() is not null and not private.can_edit_project(v_project_id) then
    raise exception 'Недостаточно прав для импорта в проект';
  end if;

  select count(*) into v_bad
  from public.import_rows ir
  where ir.import_id=p_import_id
    and abs(
      coalesce((ir.normalized_data->>'source_total')::numeric,0) -
      coalesce((select sum(value::numeric) from jsonb_each_text(ir.normalized_data->'levels')),0)
    ) > 0.000001;
  if v_bad>0 then
    raise exception 'Контроль Всего не пройден: % строк',v_bad;
  end if;

  update public.specification_rows sr
  set archived_at=now(),updated_at=now()
  where sr.project_id=v_project_id
    and sr.archived_at is null
    and sr.source_original->>'source_slot'=v_slot
    and sr.source_import_id<>p_import_id
    and not exists (
      select 1 from public.import_rows ir
      where ir.import_id=p_import_id
        and ir.source_key=sr.source_original->>'source_identity'
    );

  select count(distinct sr.id),coalesce(sum(q.quantity),0)
    into v_positions,v_qty
  from public.specification_rows sr
  left join public.specification_quantities q on q.specification_row_id=sr.id
  where sr.project_id=v_project_id
    and sr.source_import_id=p_import_id
    and sr.archived_at is null;

  v_report=jsonb_build_object(
    'source_slot',v_slot,
    'source_name',v_source_name,
    'positions',v_positions,
    'quantity_total',v_qty,
    'validation','ok'
  );

  update public.imports
  set status='applied',report=report||v_report,applied_at=now()
  where id=p_import_id;

  insert into public.audit_events(project_id,domain,action,entity_type,entity_id,payload)
  values(v_project_id,'specification','import_applied','import',p_import_id,v_report);

  return v_report;
end;
$$;
