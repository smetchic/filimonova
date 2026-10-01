create or replace function public.adjust_montage_fact(
  p_project_id uuid,
  p_specification_row_id uuid,
  p_level_code text,
  p_event_date date,
  p_delta integer
) returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_catalog_item_id uuid;
  v_section_id uuid;
  v_section_name text;
  v_building_section text;
  v_plan numeric:=0;
  v_mounted numeric:=0;
  v_delivered numeric:=0;
  v_installed_catalog numeric:=0;
  v_available numeric:=0;
  v_prev_level text;
  v_prev_plan numeric:=0;
  v_prev_mounted numeric:=0;
  v_event_id uuid;
  v_event_qty numeric;
  v_exception boolean:=false;
begin
  if not private.can_edit_project(p_project_id) then
    raise exception 'Недостаточно прав';
  end if;

  if p_delta not in (-1,1) then
    raise exception 'Изменение монтажа должно быть +1 или -1';
  end if;

  if p_event_date is null then
    raise exception 'Не указана дата монтажа';
  end if;

  select sr.catalog_item_id,sr.section_id,ss.name,ss.building_section
    into v_catalog_item_id,v_section_id,v_section_name,v_building_section
  from public.specification_rows sr
  join public.specification_sections ss on ss.id=sr.section_id
  where sr.id=p_specification_row_id
    and sr.project_id=p_project_id
    and sr.archived_at is null;

  if v_catalog_item_id is null then
    raise exception 'Позиция спецификации не найдена';
  end if;

  select coalesce(sq.quantity,0)
    into v_plan
  from public.specification_quantities sq
  where sq.project_id=p_project_id
    and sq.specification_row_id=p_specification_row_id
    and sq.level_code=p_level_code
  limit 1;

  if coalesce(v_plan,0)<=0 then
    raise exception 'На уровне % эта позиция проектом не предусмотрена',p_level_code;
  end if;

  select coalesce(sum(me.quantity),0)
    into v_mounted
  from public.montage_events me
  where me.project_id=p_project_id
    and me.specification_row_id=p_specification_row_id
    and me.level_code=p_level_code
    and me.event_type='fact';

  if p_delta=1 then
    if v_mounted+1>v_plan then
      raise exception 'Монтаж превышает проектное количество: на уровне % предусмотрено %, уже смонтировано %',
        p_level_code,v_plan,v_mounted;
    end if;

    v_exception=lower(coalesce(v_section_name,'')) in ('ограждение лоджий','опорные вкладыши');

    if not v_exception and p_level_code ~ '^[0-9]+$' and p_level_code::integer>1 then
      v_prev_level=(p_level_code::integer-1)::text;

      select
        coalesce(sum(sq.quantity),0),
        coalesce((
          select sum(me.quantity)
          from public.montage_events me
          join public.specification_rows sr2 on sr2.id=me.specification_row_id
          join public.specification_sections ss2 on ss2.id=sr2.section_id
          where me.project_id=p_project_id
            and me.level_code=v_prev_level
            and me.event_type='fact'
            and ss2.building_section=v_building_section
            and lower(coalesce(ss2.name,'')) not in ('ограждение лоджий','опорные вкладыши')
        ),0)
        into v_prev_plan,v_prev_mounted
      from public.specification_quantities sq
      join public.specification_rows sr2 on sr2.id=sq.specification_row_id
      join public.specification_sections ss2 on ss2.id=sr2.section_id
      where sq.project_id=p_project_id
        and sq.level_code=v_prev_level
        and sr2.archived_at is null
        and ss2.building_section=v_building_section
        and lower(coalesce(ss2.name,'')) not in ('ограждение лоджий','опорные вкладыши');

      if v_prev_plan>0 and v_prev_mounted<v_prev_plan then
        raise exception 'Монтаж уровня % заблокирован: уровень % секции % ещё не завершён (% из %)',
          p_level_code,v_prev_level,v_building_section,v_prev_mounted,v_prev_plan;
      end if;
    end if;

    select coalesce(sum(coalesce(l.qty_pieces,0)),0)
      into v_delivered
    from public.supply_document_lines l
    join public.supply_documents d on d.id=l.document_id
    where l.project_id=p_project_id
      and d.project_id=p_project_id
      and l.catalog_item_id=v_catalog_item_id
      and lower(coalesce(d.status,'posted')) !~ '(draft|чернов|cancel|отмен)'
      and (
        exists(
          select 1
          from public.supply_line_allocations a
          where a.project_id=p_project_id and a.white_line_id=l.id
        )
        or (
          not exists(
            select 1
            from public.supply_line_allocations a
            where a.project_id=p_project_id and a.green_line_id=l.id
          )
          and lower(coalesce(d.document_type,'')) !~ '(green|зелен)'
        )
      );

    select coalesce(sum(me.quantity),0)
      into v_installed_catalog
    from public.montage_events me
    join public.specification_rows sr2 on sr2.id=me.specification_row_id
    where me.project_id=p_project_id
      and me.event_type='fact'
      and sr2.catalog_item_id=v_catalog_item_id;

    v_available=greatest(0,v_delivered-v_installed_catalog);
    if v_available<1 then
      raise exception 'Недостаточно фактически поставленных изделий: поставлено %, уже смонтировано %, доступно %',
        v_delivered,v_installed_catalog,v_available;
    end if;

    insert into public.montage_events(
      project_id,specification_row_id,level_code,event_date,event_type,quantity,note
    )
    values(
      p_project_id,p_specification_row_id,p_level_code,p_event_date,'fact',1,'Календарь монтажа'
    );

  else
    select me.id,me.quantity
      into v_event_id,v_event_qty
    from public.montage_events me
    where me.project_id=p_project_id
      and me.specification_row_id=p_specification_row_id
      and me.level_code=p_level_code
      and me.event_date=p_event_date
      and me.event_type='fact'
    order by me.created_at desc,me.id desc
    limit 1
    for update;

    if v_event_id is null then
      raise exception 'На выбранную дату монтаж по позиции не зафиксирован';
    end if;

    if v_event_qty>1 then
      update public.montage_events
      set quantity=v_event_qty-1,updated_at=now()
      where id=v_event_id;
    else
      delete from public.montage_events where id=v_event_id;
    end if;
  end if;

  select coalesce(sum(me.quantity),0)
    into v_mounted
  from public.montage_events me
  where me.project_id=p_project_id
    and me.specification_row_id=p_specification_row_id
    and me.level_code=p_level_code
    and me.event_type='fact';

  return jsonb_build_object(
    'specification_row_id',p_specification_row_id,
    'level_code',p_level_code,
    'event_date',p_event_date,
    'mounted',v_mounted,
    'plan',v_plan,
    'remaining',greatest(0,v_plan-v_mounted)
  );
end;
$$;

revoke all on function public.adjust_montage_fact(uuid,uuid,text,date,integer) from public,anon;
grant execute on function public.adjust_montage_fact(uuid,uuid,text,date,integer) to authenticated;

create index if not exists ix_montage_project_level_fact
  on public.montage_events(project_id,level_code,specification_row_id,event_date)
  where event_type='fact';

create index if not exists ix_supply_lines_project_catalog
  on public.supply_document_lines(project_id,catalog_item_id,document_id);
