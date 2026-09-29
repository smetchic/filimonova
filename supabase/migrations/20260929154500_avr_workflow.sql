create or replace function public.apply_avr_import(
  p_project_id uuid,
  p_period_month date,
  p_display_number text,
  p_source_name text,
  p_source_sha256 text,
  p_rows jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_document_id uuid;
  v_import_id uuid;
  v_version_id uuid;
  v_version_no integer;
  v_state text;
  v_row_count integer;
begin
  if p_period_month is null or date_trunc('month',p_period_month)::date <> p_period_month then
    raise exception 'Период АВР должен быть первым числом месяца';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows)=0 then
    raise exception 'В файле не найдены подтверждённые материальные строки АВР';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as x(estimate_row_id uuid,quantity numeric)
    left join estimate_rows er on er.id=x.estimate_row_id and er.project_id=p_project_id and er.row_type='material'
    where er.id is null or coalesce(x.quantity,0)<0
  ) then
    raise exception 'АВР содержит неизвестную позицию материала или отрицательное количество';
  end if;
  if (select count(*) from jsonb_to_recordset(p_rows) as x(estimate_row_id uuid)) <>
     (select count(distinct estimate_row_id) from jsonb_to_recordset(p_rows) as x(estimate_row_id uuid)) then
    raise exception 'В АВР одна позиция материала встречается несколько раз';
  end if;

  insert into imports(project_id,domain,source_name,source_period,status,report,source_slot,applied_at)
  values(p_project_id,'avr',p_source_name,p_period_month,'applied',
    jsonb_build_object('sha256',p_source_sha256,'validated_rows',jsonb_array_length(p_rows)),
    to_char(p_period_month,'YYYY-MM'),now())
  returning id into v_import_id;

  insert into import_rows(project_id,import_id,source_row_no,source_key,raw_data,normalized_data)
  select p_project_id,v_import_id,x.source_row_no,x.estimate_row_id::text,
    coalesce(x.raw_data,'{}'::jsonb),
    jsonb_build_object('estimate_row_id',x.estimate_row_id,'basis',x.basis,'quantity',x.quantity)
  from jsonb_to_recordset(p_rows) as x(
    estimate_row_id uuid,source_row_no integer,basis text,quantity numeric,raw_data jsonb
  );

  insert into avr_documents(project_id,period_month,display_number)
  values(p_project_id,p_period_month,nullif(trim(p_display_number),''))
  on conflict(project_id,period_month) do update
    set display_number=excluded.display_number,updated_at=now()
  returning id into v_document_id;

  select coalesce(max(version_no),0)+1 into v_version_no
  from avr_versions where document_id=v_document_id;
  v_state := case when exists(select 1 from avr_versions where document_id=v_document_id and state='signed') then 'draft' else 'in_use' end;
  if v_state='in_use' then
    update avr_versions set state='draft'
    where document_id=v_document_id and state='in_use';
  end if;
  insert into avr_versions(project_id,document_id,version_no,state,source_import_id)
  values(p_project_id,v_document_id,v_version_no,v_state,v_import_id)
  returning id into v_version_id;

  insert into avr_rows(project_id,version_id,estimate_row_id,quantity,quantity_m3,amount,source_import_row_id)
  select p_project_id,v_version_id,x.estimate_row_id,x.quantity,x.quantity_m3,coalesce(x.amount,0),ir.id
  from jsonb_to_recordset(p_rows) as x(
    estimate_row_id uuid,quantity numeric,quantity_m3 numeric,amount numeric
  )
  join import_rows ir on ir.import_id=v_import_id and ir.source_key=x.estimate_row_id::text;
  get diagnostics v_row_count=row_count;

  return jsonb_build_object(
    'document_id',v_document_id,'version_id',v_version_id,'version_no',v_version_no,
    'import_id',v_import_id,'rows',v_row_count,'state',v_state
  );
end;
$$;

create or replace function public.set_avr_version_state(
  p_project_id uuid,
  p_version_id uuid,
  p_action text
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_document_id uuid;
  v_state text;
begin
  select document_id,state into v_document_id,v_state
  from avr_versions where id=p_version_id and project_id=p_project_id
  for update;
  if v_document_id is null then raise exception 'Версия АВР не найдена'; end if;
  if p_action='use' then
    if exists(select 1 from avr_versions where document_id=v_document_id and state='signed') then
      raise exception 'Подписанный АВР уже является окончательным источником месяца';
    end if;
    update avr_versions set state='draft' where document_id=v_document_id and state='in_use';
    update avr_versions set state='in_use' where id=p_version_id;
  elsif p_action='sign' then
    if exists(select 1 from avr_versions where document_id=v_document_id and state='signed' and id<>p_version_id) then
      raise exception 'Для месяца уже подписана другая версия АВР';
    end if;
    update avr_versions set state='draft' where document_id=v_document_id and state='in_use' and id<>p_version_id;
    update avr_versions set state='signed',signed_at=coalesce(signed_at,now()),signed_by=coalesce(signed_by,auth.uid()) where id=p_version_id;
  else
    raise exception 'Неизвестное действие с версией АВР';
  end if;
  return jsonb_build_object('version_id',p_version_id,'state',(select state from avr_versions where id=p_version_id));
end;
$$;

grant execute on function public.apply_avr_import(uuid,date,text,text,text,jsonb) to authenticated;
grant execute on function public.set_avr_version_state(uuid,uuid,text) to authenticated;
