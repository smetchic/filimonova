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
  v_material_count integer;
  v_work_count integer;
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
  get diagnostics v_material_count=row_count;

  -- В демо и ТЗ объём связанной работы измеряется в сотнях штук:
  -- сумма принятых панелей по всем связям работы / 100.
  insert into avr_rows(project_id,version_id,estimate_row_id,quantity,quantity_m3,amount,source_import_row_id)
  select p_project_id,v_version_id,wl.work_row_id,
    sum(ar.quantity)/100.0,
    null,
    (sum(ar.quantity)/100.0)*coalesce(erc.total_unit,0),
    null
  from estimate_work_links wl
  join avr_rows ar
    on ar.version_id=v_version_id and ar.estimate_row_id=wl.material_row_id
  join estimate_rows wr
    on wr.id=wl.work_row_id and wr.project_id=p_project_id and wr.row_type='work'
  left join estimate_row_costs erc on erc.estimate_row_id=wl.work_row_id
  where wl.project_id=p_project_id
  group by wl.work_row_id,erc.total_unit
  having sum(ar.quantity)>0;
  get diagnostics v_work_count=row_count;

  return jsonb_build_object(
    'document_id',v_document_id,'version_id',v_version_id,'version_no',v_version_no,
    'import_id',v_import_id,'rows',v_material_count+v_work_count,
    'material_rows',v_material_count,'work_rows',v_work_count,'state',v_state
  );
end;
$$;

grant execute on function public.apply_avr_import(uuid,date,text,text,text,jsonb) to authenticated;
