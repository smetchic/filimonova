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

  insert into accounting_code_links(project_id,accounting_code,catalog_item_id,link_method,note)
  select distinct p_project_id,ar.material_code,ci.id,'auto','Точное совпадение марки'
  from accounting_rows ar
  join catalog_items ci on ci.project_id=p_project_id and ci.archived_at is null
    and lower(regexp_replace(ci.mark,'[^a-zA-Zа-яА-Я0-9]','','g'))=lower(regexp_replace(ar.material_code,'[^a-zA-Zа-яА-Я0-9]','','g'))
  where ar.import_id=v_import_id
  on conflict(project_id,accounting_code) do nothing;

  return jsonb_build_object('import_id',v_import_id,'rows',v_count);
end;
$$;

create or replace function public.recalculate_s29(
  p_project_id uuid,
  p_period_month date
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_avr_version_id uuid;
  v_accounting_import_id uuid;
  v_document_id uuid;
  v_status text;
  v_count integer;
begin
  select av.id into v_avr_version_id
  from avr_documents ad join avr_versions av on av.document_id=ad.id and av.state='signed'
  where ad.project_id=p_project_id and ad.period_month=p_period_month;
  if v_avr_version_id is null then raise exception 'Для месяца нет подписанного АВР'; end if;
  select import_id into v_accounting_import_id from accounting_period_sources
  where project_id=p_project_id and period_month=p_period_month;
  if v_accounting_import_id is null then raise exception 'Для месяца не выбран бухгалтерский снимок'; end if;

  select id,status into v_document_id,v_status from s29_documents
  where project_id=p_project_id and period_month=p_period_month for update;
  if v_status='fixed' then raise exception 'Зафиксированный С-29 нельзя пересчитывать'; end if;
  if v_document_id is null then
    insert into s29_documents(project_id,period_month,avr_version_id,accounting_import_id,status)
    values(p_project_id,p_period_month,v_avr_version_id,v_accounting_import_id,'draft') returning id into v_document_id;
  else
    update s29_documents set avr_version_id=v_avr_version_id,accounting_import_id=v_accounting_import_id,updated_at=now()
    where id=v_document_id;
    delete from s29_rows where document_id=v_document_id;
  end if;

  with avr as (
    select er.catalog_item_id,sum(ar.quantity) pieces,sum(coalesce(ar.quantity_m3,0)) norm_m3
    from avr_rows ar join estimate_rows er on er.id=ar.estimate_row_id
    where ar.version_id=v_avr_version_id and er.row_type='material' and er.catalog_item_id is not null
    group by er.catalog_item_id
  ), accounting as (
    select acl.catalog_item_id,sum(coalesce(ar.quantity,0)) actual_m3
    from accounting_rows ar join accounting_code_links acl
      on acl.project_id=p_project_id and acl.accounting_code=ar.material_code
    where ar.import_id=v_accounting_import_id group by acl.catalog_item_id
  ), old_economy as (
    select c.catalog_item_id,sum(c.created_m3-coalesce(s.settled,0)) remaining_m3
    from s29_carryovers c
    left join (select carryover_id,sum(settled_m3) settled from s29_carryover_settlements group by carryover_id) s on s.carryover_id=c.id
    where c.project_id=p_project_id and c.kind='economy' and c.origin_month<p_period_month
    group by c.catalog_item_id
  ), calc as (
    select a.catalog_item_id,a.pieces,a.norm_m3,
      greatest(coalesce(ac.actual_m3,0)-greatest(coalesce(oe.remaining_m3,0),0),0) current_actual
    from avr a left join accounting ac on ac.catalog_item_id=a.catalog_item_id
    left join old_economy oe on oe.catalog_item_id=a.catalog_item_id
  )
  insert into s29_rows(project_id,document_id,catalog_item_id,avr_quantity_pieces,volume_per_piece_snapshot_m3,avr_quantity_m3,written_off_m3,economy_m3,overrun_m3)
  select p_project_id,v_document_id,catalog_item_id,pieces,
    case when pieces>0 then round(norm_m3/pieces,6) else 0 end,norm_m3,
    least(norm_m3,current_actual),greatest(norm_m3-current_actual,0),greatest(current_actual-norm_m3,0)
  from calc;
  get diagnostics v_count=row_count;

  insert into s29_allocations(project_id,s29_row_id,accounting_row_id,allocated_m3)
  select p_project_id,sr.id,ar.id,ar.quantity
  from s29_rows sr join accounting_code_links acl on acl.project_id=p_project_id and acl.catalog_item_id=sr.catalog_item_id
  join accounting_rows ar on ar.import_id=v_accounting_import_id and ar.material_code=acl.accounting_code
  where sr.document_id=v_document_id and coalesce(ar.quantity,0)>0;

  return jsonb_build_object('document_id',v_document_id,'rows',v_count,'status','draft');
end;
$$;

create or replace function public.fix_s29(
  p_project_id uuid,
  p_document_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_doc s29_documents%rowtype;
  v_item record;
  v_carry record;
  v_available numeric;
  v_remaining numeric;
  v_settle numeric;
begin
  select * into v_doc from s29_documents where id=p_document_id and project_id=p_project_id for update;
  if v_doc.id is null then raise exception 'С-29 не найден'; end if;
  if v_doc.status='fixed' then return jsonb_build_object('document_id',v_doc.id,'status','fixed'); end if;
  if not exists(select 1 from avr_versions where id=v_doc.avr_version_id and state='signed') then
    raise exception 'Фиксация разрешена только для подписанного АВР';
  end if;

  for v_item in select sr.*,coalesce(sum(sa.allocated_m3),0) available
    from s29_rows sr left join s29_allocations sa on sa.s29_row_id=sr.id
    where sr.document_id=v_doc.id group by sr.id
  loop
    v_available:=v_item.available;
    for v_carry in
      select c.*,c.created_m3-coalesce(sum(s.settled_m3),0) remaining
      from s29_carryovers c left join s29_carryover_settlements s on s.carryover_id=c.id
      where c.project_id=p_project_id and c.catalog_item_id=v_item.catalog_item_id and c.kind='economy' and c.origin_month<v_doc.period_month
      group by c.id having c.created_m3-coalesce(sum(s.settled_m3),0)>0
      order by c.origin_month,c.created_at
    loop
      exit when v_available<=0;
      v_settle:=least(v_available,v_carry.remaining);
      insert into s29_carryover_settlements(project_id,carryover_id,settlement_document_id,settlement_month,settled_m3)
      values(p_project_id,v_carry.id,v_doc.id,v_doc.period_month,v_settle);
      v_available:=v_available-v_settle;
    end loop;
    if v_item.economy_m3>0 then
      insert into s29_carryovers(project_id,origin_document_id,origin_row_id,catalog_item_id,kind,origin_month,created_m3)
      values(p_project_id,v_doc.id,v_item.id,v_item.catalog_item_id,'economy',v_doc.period_month,v_item.economy_m3);
    end if;
    if v_item.overrun_m3>0 then
      insert into s29_carryovers(project_id,origin_document_id,origin_row_id,catalog_item_id,kind,origin_month,created_m3)
      values(p_project_id,v_doc.id,v_item.id,v_item.catalog_item_id,'overrun',v_doc.period_month,v_item.overrun_m3);
    end if;
  end loop;
  update s29_documents set status='fixed',fixed_at=now(),fixed_by=auth.uid(),updated_at=now() where id=v_doc.id;
  return jsonb_build_object('document_id',v_doc.id,'status','fixed');
end;
$$;

grant execute on function public.apply_accounting_import(uuid,date,text,text,jsonb) to authenticated;
grant execute on function public.recalculate_s29(uuid,date) to authenticated;
grant execute on function public.fix_s29(uuid,uuid) to authenticated;
