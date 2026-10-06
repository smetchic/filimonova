-- Object settings for running several objects (pilot «Выготского, 15»).
-- projects.settings keeps the number of building sections and the list of local estimates.
-- Specification slots are parsed by section number instead of being fixed to sections 1-2,
-- and estimate numbers are looked up in the object settings (legacy 200-203, 207 stay the default).

alter table public.projects
  add column if not exists settings jsonb not null default '{}'::jsonb;

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

  -- Slots are generated from the object's section count: spec_s<N>_basement / spec_s<N>_above.
  if p_source_slot ~ '^spec_s[1-9][0-9]?_(basement|above)$' then
    v_building_section := 'Секция ' || substring(p_source_slot from '^spec_s([0-9]+)_');
    v_zone := case when p_source_slot like '%basement' then 'Цоколь' else 'Выше 0.000' end;
  else
    raise exception 'Неизвестный слот спецификации: %', p_source_slot;
  end if;

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

alter function public.apply_specification_slot_import(uuid,text,text,text,jsonb)
  security definer;
alter function public.apply_specification_slot_import(uuid,text,text,text,jsonb)
  set search_path = public, private, pg_temp;
revoke all on function public.apply_specification_slot_import(uuid,text,text,text,jsonb) from public;
grant execute on function public.apply_specification_slot_import(uuid,text,text,text,jsonb) to authenticated;

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

  -- Estimate numbers come from the object's settings (projects.settings->'estimates');
  -- objects without that list keep the original numbering 200-203, 207.
  select
    e->>'section',
    e->>'zone',
    coalesce((e->>'stairs')::boolean,false)
  into v_building_section,v_zone,v_is_stairs
  from public.projects p
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(p.settings->'estimates')='array' then p.settings->'estimates' else '[]'::jsonb end
  ) e
  where p.id=p_project_id
    and btrim(e->>'number')=btrim(p_estimate_number)
  limit 1;
  v_is_stairs:=coalesce(v_is_stairs,false);

  if v_building_section is null then
    if exists(
      select 1 from public.projects p
      where p.id=p_project_id and jsonb_typeof(p.settings->'estimates')='array'
    ) then
      raise exception 'Смета № % не указана в настройках объекта',p_estimate_number;
    end if;
    case p_estimate_number
      when '200' then v_building_section:='Секция 1'; v_zone:='Цоколь';
      when '201' then v_building_section:='Секция 2'; v_zone:='Цоколь';
      when '202' then v_building_section:='Секция 1'; v_zone:='Выше 0.000';
      when '203' then v_building_section:='Секция 2'; v_zone:='Выше 0.000';
      when '207' then v_building_section:='Элементы лестниц'; v_zone:='Лестницы'; v_is_stairs:=true;
      else raise exception 'Неизвестный номер локальной сметы: %',p_estimate_number;
    end case;
  end if;

  if coalesce(btrim(v_building_section),'')='' or coalesce(btrim(v_zone),'')='' then
    raise exception 'В настройках объекта для сметы № % не заполнены секция или зона',p_estimate_number;
  end if;

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

revoke all on function public.apply_estimate_import(uuid,text,text,text,text,jsonb,jsonb,jsonb) from public;
grant execute on function public.apply_estimate_import(uuid,text,text,text,text,jsonb,jsonb,jsonb) to authenticated;
