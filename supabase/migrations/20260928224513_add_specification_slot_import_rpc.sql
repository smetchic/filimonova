
create or replace function public.apply_specification_slot_import(
  p_project_id uuid,
  p_source_slot text,
  p_source_name text,
  p_source_sha256 text,
  p_panels jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_building_section text;
  v_zone text;
  v_sections text[];
  v_import_id uuid;
  v_next_position integer;
  v_report jsonb;
  v_panel_count integer;
  v_qty numeric;
  v_bad integer;
begin
  if not private.can_edit_project(p_project_id) then
    raise exception 'Недостаточно прав для импорта в проект';
  end if;

  case p_source_slot
    when 'spec_s1_basement' then v_building_section := 'Секция 1'; v_zone := 'Цоколь';
    when 'spec_s1_above'    then v_building_section := 'Секция 1'; v_zone := 'Выше 0.000';
    when 'spec_s2_basement' then v_building_section := 'Секция 2'; v_zone := 'Цоколь';
    when 'spec_s2_above'    then v_building_section := 'Секция 2'; v_zone := 'Выше 0.000';
    else raise exception 'Неизвестный слот спецификации: %', p_source_slot;
  end case;

  if v_zone = 'Цоколь' then
    v_sections := array[
      'Наружные стеновые панели цоколя',
      'Внутренние стеновые панели цоколя',
      'Внутренние стеновые перегородки цоколя',
      'Панели стеновые шахт лифтов',
      'Разделительные стенки лоджий цоколя',
      'Стенки входа цоколя',
      'Плиты перекрытия',
      'Плиты лоджий',
      'Плиты шахт лифтов',
      'Плиты входа',
      'Опорные вкладыши'
    ];
  else
    v_sections := array[
      'Наружные стеновые панели',
      'Наружные стеновые панели чердака',
      'Внутренние стеновые панели',
      'Внутренние стеновые панели чердака',
      'Внутренние стеновые перегородки',
      'Панели стеновые шахт лифтов',
      'Разделительные стенки лоджий',
      'Ограждение лоджий',
      'Вентиляционные блоки',
      'Плиты перекрытия',
      'Плиты покрытия',
      'Плиты лоджий',
      'Плиты шахт лифтов',
      'Опорные вкладыши',
      'Стенки входа',
      'Экраны козырьков входа',
      'Козырьки входа'
    ];
  end if;

  if jsonb_typeof(p_panels) <> 'array' or jsonb_array_length(p_panels) = 0 then
    raise exception 'Файл спецификации не содержит позиций';
  end if;

  select count(*) into v_bad
  from jsonb_array_elements(p_panels) p
  where nullif(btrim(p->>'mark'),'') is null
     or nullif(btrim(p->>'name'),'') is null
     or nullif(btrim(p->>'section'),'') is null
     or nullif(btrim(p->>'source_identity'),'') is null
     or nullif(btrim(p->>'normalized_key'),'') is null
     or coalesce(jsonb_typeof(p->'levels'),'') <> 'object';
  if v_bad > 0 then
    raise exception 'В импорте % строк без обязательных полей', v_bad;
  end if;

  select count(*) into v_bad
  from jsonb_array_elements(p_panels) p
  where not ((p->>'section') = any(v_sections));
  if v_bad > 0 then
    raise exception 'В импорте есть неизвестные разделы: % строк', v_bad;
  end if;

  if v_zone = 'Цоколь' then
    select count(*) into v_bad
    from jsonb_array_elements(p_panels) p
    where exists (
      select 1 from jsonb_object_keys(p->'levels') k(code)
      where k.code <> 'Ц'
    );
  else
    select count(*) into v_bad
    from jsonb_array_elements(p_panels) p
    where exists (
      select 1 from jsonb_object_keys(p->'levels') k(code)
      where not (k.code in ('Ч','К') or k.code ~ '^(?:[1-9]|1[0-9])$')
    );
  end if;
  if v_bad > 0 then
    raise exception 'В импорте есть недопустимые уровни: % строк', v_bad;
  end if;

  select count(*) into v_bad
  from jsonb_array_elements(p_panels) p
  where abs(
    coalesce((p->>'source_total')::numeric,0) -
    coalesce((select sum(value::numeric) from jsonb_each_text(p->'levels')),0)
  ) > 0.000001;
  if v_bad > 0 then
    raise exception 'Контроль Всего не пройден: % строк', v_bad;
  end if;

  select count(*) into v_bad
  from (
    select p->>'source_identity' k, count(*) c
    from jsonb_array_elements(p_panels) p
    group by p->>'source_identity'
    having count(*) > 1
  ) d;
  if v_bad > 0 then
    raise exception 'В импорте есть дубли идентичности позиций: %', v_bad;
  end if;

  insert into public.imports(
    project_id, domain, source_name, source_slot, status, report
  ) values (
    p_project_id, 'specification', p_source_name, p_source_slot, 'loaded',
    jsonb_build_object(
      'sha256',p_source_sha256,
      'building_section',v_building_section,
      'zone',v_zone
    )
  )
  returning id into v_import_id;

  insert into public.import_rows(
    project_id, import_id, source_row_no, source_key, raw_data, normalized_data
  )
  select
    p_project_id,
    v_import_id,
    (p->>'source_row_no')::integer,
    p->>'source_identity',
    jsonb_build_object(
      'mark',p->>'mark',
      'designation',p->>'designation',
      'name',p->>'name',
      'section',p->>'section',
      'levels',p->'levels',
      'total',(p->>'source_total')::numeric,
      'mass_kg',nullif(p->>'mass_kg','')::numeric
    ),
    p
  from jsonb_array_elements(p_panels) p
  order by (p->>'source_row_no')::integer;

  insert into public.specification_sections(
    project_id, building_section, zone, name, sort_order, is_stairs
  )
  select
    p_project_id,
    v_building_section,
    v_zone,
    s.name,
    s.ord * 10,
    false
  from unnest(v_sections) with ordinality s(name,ord)
  on conflict (project_id, building_section, zone, name, is_stairs)
  do update set sort_order=excluded.sort_order, updated_at=now();

  insert into public.catalog_items(project_id,mark,name,normalized_key)
  select distinct
    p_project_id,
    ir.normalized_data->>'mark',
    ir.normalized_data->>'name',
    ir.normalized_data->>'normalized_key'
  from public.import_rows ir
  where ir.import_id=v_import_id
  on conflict (project_id, normalized_key)
    where normalized_key is not null and archived_at is null
  do update set
    mark=excluded.mark,
    name=excluded.name,
    archived_at=null,
    updated_at=now();

  update public.specification_rows sr
  set
    section_id=ss.id,
    catalog_item_id=ci.id,
    designation=nullif(ir.normalized_data->>'designation',''),
    mass_kg=nullif(ir.normalized_data->>'mass_kg','')::numeric,
    sort_order=(ir.normalized_data->>'source_row_no')::integer,
    source_import_id=v_import_id,
    source_import_row_id=ir.id,
    source_original=jsonb_build_object(
      'source_slot',p_source_slot,
      'source_name',p_source_name,
      'source_identity',ir.normalized_data->>'source_identity',
      'source_row_no',(ir.normalized_data->>'source_row_no')::integer,
      'source_total',(ir.normalized_data->>'source_total')::numeric,
      'sha256',p_source_sha256
    ),
    archived_at=null,
    updated_at=now()
  from public.import_rows ir
  join public.specification_sections ss
    on ss.project_id=p_project_id
   and ss.building_section=v_building_section
   and ss.zone=v_zone
   and ss.name=ir.normalized_data->>'section'
   and ss.is_stairs=false
  join public.catalog_items ci
    on ci.project_id=p_project_id
   and ci.normalized_key=ir.normalized_data->>'normalized_key'
   and ci.archived_at is null
  where ir.import_id=v_import_id
    and sr.project_id=p_project_id
    and sr.source_original->>'source_slot'=p_source_slot
    and sr.source_original->>'source_identity'=ir.normalized_data->>'source_identity';

  update public.specification_rows sr
  set archived_at=now(), updated_at=now()
  where sr.project_id=p_project_id
    and sr.archived_at is null
    and sr.source_original->>'source_slot'=p_source_slot
    and not exists (
      select 1
      from public.import_rows ir
      where ir.import_id=v_import_id
        and ir.normalized_data->>'source_identity'=sr.source_original->>'source_identity'
    );

  select coalesce(max(position_no),0)+1
    into v_next_position
  from public.specification_rows
  where project_id=p_project_id;

  insert into public.specification_rows(
    project_id, section_id, catalog_item_id, position_no, designation,
    mass_kg, sort_order, source_import_id, source_import_row_id, source_original
  )
  select
    p_project_id,
    ss.id,
    ci.id,
    v_next_position - 1 + row_number() over(order by (ir.normalized_data->>'source_row_no')::integer),
    nullif(ir.normalized_data->>'designation',''),
    nullif(ir.normalized_data->>'mass_kg','')::numeric,
    (ir.normalized_data->>'source_row_no')::integer,
    v_import_id,
    ir.id,
    jsonb_build_object(
      'source_slot',p_source_slot,
      'source_name',p_source_name,
      'source_identity',ir.normalized_data->>'source_identity',
      'source_row_no',(ir.normalized_data->>'source_row_no')::integer,
      'source_total',(ir.normalized_data->>'source_total')::numeric,
      'sha256',p_source_sha256
    )
  from public.import_rows ir
  join public.specification_sections ss
    on ss.project_id=p_project_id
   and ss.building_section=v_building_section
   and ss.zone=v_zone
   and ss.name=ir.normalized_data->>'section'
   and ss.is_stairs=false
  join public.catalog_items ci
    on ci.project_id=p_project_id
   and ci.normalized_key=ir.normalized_data->>'normalized_key'
   and ci.archived_at is null
  where ir.import_id=v_import_id
    and not exists (
      select 1 from public.specification_rows sr
      where sr.project_id=p_project_id
        and sr.source_import_row_id=ir.id
    )
    and not exists (
      select 1 from public.specification_rows sr
      where sr.project_id=p_project_id
        and sr.archived_at is null
        and sr.source_original->>'source_slot'=p_source_slot
        and sr.source_original->>'source_identity'=ir.normalized_data->>'source_identity'
    )
  order by (ir.normalized_data->>'source_row_no')::integer;

  delete from public.specification_quantities q
  using public.specification_rows sr
  where q.specification_row_id=sr.id
    and sr.project_id=p_project_id
    and sr.source_import_id=v_import_id;

  insert into public.specification_quantities(
    project_id, specification_row_id, level_code, level_order, quantity
  )
  select
    p_project_id,
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
  join public.import_rows ir on ir.id=sr.source_import_row_id and ir.import_id=v_import_id
  cross join lateral jsonb_each_text(ir.normalized_data->'levels') lvl
  where sr.project_id=p_project_id
    and lvl.value::numeric <> 0
  on conflict (specification_row_id, level_code)
  do update set quantity=excluded.quantity, level_order=excluded.level_order, updated_at=now();

  select count(*), coalesce(sum(q.quantity),0)
    into v_panel_count, v_qty
  from public.specification_rows sr
  join public.specification_quantities q on q.specification_row_id=sr.id
  where sr.project_id=p_project_id
    and sr.source_import_id=v_import_id
    and sr.archived_at is null;

  v_report := jsonb_build_object(
    'source_slot',p_source_slot,
    'source_name',p_source_name,
    'sha256',p_source_sha256,
    'building_section',v_building_section,
    'zone',v_zone,
    'positions',jsonb_array_length(p_panels),
    'quantity_total',v_qty,
    'fixed_sections',array_length(v_sections,1),
    'validation','ok'
  );

  update public.imports
  set status='applied', report=v_report, applied_at=now()
  where id=v_import_id;

  insert into public.audit_events(
    project_id, domain, action, entity_type, entity_id, payload
  ) values (
    p_project_id, 'specification', 'import_applied', 'import', v_import_id, v_report
  );

  return v_report || jsonb_build_object('import_id',v_import_id);
end;
$$;

grant execute on function public.apply_specification_slot_import(uuid,text,text,text,jsonb) to authenticated;
