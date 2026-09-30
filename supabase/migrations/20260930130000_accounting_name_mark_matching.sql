create or replace function private.norm_accounting_match(value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(regexp_replace(replace(replace(coalesce(value,''),'(',''),')',''),'[^a-zA-Zа-яА-ЯёЁ0-9]','','g'))
$$;

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
  values(p_project_id,'accounting',p_source_name,p_period_month,'applied',
    jsonb_build_object('sha256',p_source_sha256,'rows',jsonb_array_length(p_rows)),
    to_char(p_period_month,'YYYY-MM'),now()) returning id into v_import_id;

  insert into import_rows(project_id,import_id,source_row_no,source_key,raw_data,normalized_data)
  select p_project_id,v_import_id,x.source_row_no,x.material_code,coalesce(x.raw_data,'{}'::jsonb),
    jsonb_build_object('material_code',x.material_code,'name',x.name,'unit',x.unit,'quantity',x.quantity)
  from jsonb_to_recordset(p_rows) as x(source_row_no integer,material_code text,name text,unit text,quantity numeric,raw_data jsonb);

  insert into accounting_rows(project_id,import_id,source_import_row_id,account_code,material_code,name,unit,quantity,unit_price,amount,source_row_no)
  select p_project_id,v_import_id,ir.id,x.account_code,x.material_code,x.name,x.unit,x.quantity,x.unit_price,x.amount,x.source_row_no
  from jsonb_to_recordset(p_rows) as x(source_row_no integer,account_code text,material_code text,name text,unit text,quantity numeric,unit_price numeric,amount numeric)
  join import_rows ir on ir.import_id=v_import_id and ir.source_row_no=x.source_row_no;
  get diagnostics v_count=row_count;

  insert into accounting_period_sources(project_id,period_month,import_id)
  values(p_project_id,p_period_month,v_import_id)
  on conflict(project_id,period_month) do update set import_id=excluded.import_id,selected_by=auth.uid(),selected_at=now();

  -- Бухгалтерский номенклатурный номер является внешним ID. Проектную марку
  -- ищем в исходном наименовании, сохраняя существующие ручные связи.
  with source_rows as (
    select distinct ar.material_code,private.norm_accounting_match(ar.name) name_norm
    from accounting_rows ar where ar.import_id=v_import_id
  ), catalog as (
    select ci.id,private.norm_accounting_match(ci.mark) mark_norm,
      private.norm_accounting_match(ci.name) name_norm
    from catalog_items ci
    where ci.project_id=p_project_id and ci.archived_at is null
      and length(private.norm_accounting_match(ci.mark))>=4
  ), candidates as (
    select s.material_code,c.id as catalog_item_id,
      (case when length(c.name_norm)>=4 and position(c.name_norm in s.name_norm)>0 then length(c.name_norm)*100 else 0 end)+
      (case when length(c.mark_norm)>=4 and position(c.mark_norm in s.name_norm)>0 then length(c.mark_norm) else 0 end) match_score
    from source_rows s join catalog c
      on (length(c.name_norm)>=4 and position(c.name_norm in s.name_norm)>0)
      or (length(c.mark_norm)>=4 and position(c.mark_norm in s.name_norm)>0)
  ), best_score as (
    select material_code,max(match_score) match_score from candidates group by material_code
  ), unambiguous as (
    select c.material_code,min(c.catalog_item_id) catalog_item_id
    from candidates c join best_score b using(material_code,match_score)
    group by c.material_code having count(distinct c.catalog_item_id)=1
  )
  insert into accounting_code_links(project_id,accounting_code,catalog_item_id,link_method,note)
  select p_project_id,u.material_code,u.catalog_item_id,'auto','Точная проектная марка в наименовании бухгалтерии'
  from unambiguous u
  on conflict(project_id,accounting_code) do nothing;

  return jsonb_build_object('import_id',v_import_id,'rows',v_count);
end;
$$;

revoke all on function public.apply_accounting_import(uuid,date,text,text,jsonb) from public,anon;
grant execute on function public.apply_accounting_import(uuid,date,text,text,jsonb) to authenticated;
