create or replace function public.apply_accounting_import(
  p_project_id uuid,
  p_period_month date,
  p_source_name text,
  p_source_sha256 text,
  p_rows jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_import_id uuid;
  v_count integer;
begin
  if p_period_month is null or date_trunc('month',p_period_month)::date <> p_period_month then
    raise exception 'Период бухгалтерского отчёта должен быть первым числом месяца';
  end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then
    raise exception 'В бухгалтерском отчёте не найдены строки материалов';
  end if;

  insert into imports(project_id,domain,source_name,source_period,status,report,source_slot,applied_at)
  values(
    p_project_id,'accounting',p_source_name,p_period_month,'applied',
    jsonb_build_object('sha256',p_source_sha256,'rows',jsonb_array_length(p_rows)),
    to_char(p_period_month,'YYYY-MM'),now()
  )
  returning id into v_import_id;

  insert into import_rows(project_id,import_id,source_row_no,source_key,raw_data,normalized_data)
  select
    p_project_id,
    v_import_id,
    x.source_row_no,
    coalesce(x.raw_data->>'sheet','') || '#' || x.source_row_no::text,
    coalesce(x.raw_data,'{}'::jsonb),
    jsonb_build_object(
      'material_code',x.material_code,
      'name',x.name,
      'unit',x.unit,
      'quantity',x.quantity
    )
  from jsonb_to_recordset(p_rows) as x(
    source_row_no integer,
    material_code text,
    name text,
    unit text,
    quantity numeric,
    raw_data jsonb
  );

  insert into accounting_rows(
    project_id,import_id,source_import_row_id,account_code,material_code,name,unit,quantity,unit_price,amount,source_row_no
  )
  select
    p_project_id,
    v_import_id,
    ir.id,
    x.account_code,
    x.material_code,
    x.name,
    x.unit,
    x.quantity,
    x.unit_price,
    x.amount,
    x.source_row_no
  from jsonb_to_recordset(p_rows) as x(
    source_row_no integer,
    account_code text,
    material_code text,
    name text,
    unit text,
    quantity numeric,
    unit_price numeric,
    amount numeric,
    raw_data jsonb,
    catalog_item_id uuid
  )
  join import_rows ir
    on ir.import_id=v_import_id
   and ir.source_key=coalesce(x.raw_data->>'sheet','') || '#' || x.source_row_no::text;
  get diagnostics v_count=row_count;

  insert into accounting_period_sources(project_id,period_month,import_id)
  values(p_project_id,p_period_month,v_import_id)
  on conflict(project_id,period_month) do update
    set import_id=excluded.import_id,
        selected_by=auth.uid(),
        selected_at=now();

  with supplied as (
    select distinct x.material_code,x.catalog_item_id
    from jsonb_to_recordset(p_rows) as x(
      material_code text,
      catalog_item_id uuid
    )
    where x.material_code is not null
      and x.catalog_item_id is not null
  ), valid_codes as (
    select material_code
    from supplied
    group by material_code
    having count(distinct catalog_item_id)=1
  )
  insert into accounting_code_links(
    project_id,accounting_code,catalog_item_id,link_method,note
  )
  select
    p_project_id,
    s.material_code,
    s.catalog_item_id,
    'auto',
    'Автоматическое сопоставление по проектной марке/наименованию'
  from supplied s
  join valid_codes v using(material_code)
  on conflict(project_id,accounting_code) do nothing;

  return jsonb_build_object('import_id',v_import_id,'rows',v_count);
end;
$$;

revoke all on function public.apply_accounting_import(uuid,date,text,text,jsonb) from public,anon;
grant execute on function public.apply_accounting_import(uuid,date,text,text,jsonb) to authenticated;
