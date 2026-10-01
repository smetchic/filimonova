alter table public.supply_documents
  add column if not exists source_file_name text,
  add column if not exists source_file_path text;

insert into storage.buckets(id,name,public)
values('supply-documents','supply-documents',false)
on conflict(id) do nothing;

drop policy if exists supply_documents_storage_select on storage.objects;
create policy supply_documents_storage_select
on storage.objects for select to authenticated
using (
  bucket_id='supply-documents'
  and ((storage.foldername(name))[1])::uuid in (select private.current_readable_project_ids())
);

drop policy if exists supply_documents_storage_insert on storage.objects;
create policy supply_documents_storage_insert
on storage.objects for insert to authenticated
with check (
  bucket_id='supply-documents'
  and ((storage.foldername(name))[1])::uuid in (select private.current_editable_project_ids())
);

drop policy if exists supply_documents_storage_update on storage.objects;
create policy supply_documents_storage_update
on storage.objects for update to authenticated
using (
  bucket_id='supply-documents'
  and ((storage.foldername(name))[1])::uuid in (select private.current_editable_project_ids())
)
with check (
  bucket_id='supply-documents'
  and ((storage.foldername(name))[1])::uuid in (select private.current_editable_project_ids())
);

drop policy if exists supply_documents_storage_delete on storage.objects;
create policy supply_documents_storage_delete
on storage.objects for delete to authenticated
using (
  bucket_id='supply-documents'
  and ((storage.foldername(name))[1])::uuid in (select private.current_editable_project_ids())
);

create or replace function public.save_supply_document(
  p_project_id uuid,
  p_document_id uuid,
  p_document_type text,
  p_receipt_date date,
  p_ttn_number text,
  p_source_file_name text,
  p_source_file_path text,
  p_rows jsonb
) returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_document_id uuid;
  v_row jsonb;
  v_row_id uuid;
  v_seen_ids uuid[] := '{}';
  v_type text := lower(trim(coalesce(p_document_type,'')));
  v_qty_pieces numeric;
  v_qty_m3 numeric;
  v_volume numeric;
  v_unit_price numeric;
  v_vat_percent numeric;
  v_amount_net numeric;
  v_vat_amount numeric;
  v_amount_gross numeric;
  v_match_state text;
begin
  if not private.can_edit_project(p_project_id) then
    raise exception 'Недостаточно прав';
  end if;
  if v_type not in ('white','green') then
    raise exception 'Тип накладной должен быть white или green';
  end if;
  if p_receipt_date is null then
    raise exception 'Укажите дату поступления';
  end if;
  if v_type='green' and nullif(trim(coalesce(p_ttn_number,'')),'') is null then
    raise exception 'Для зелёной ТТН укажите номер';
  end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then
    raise exception 'Некорректные строки накладной';
  end if;

  if p_document_id is null then
    insert into public.supply_documents(
      project_id,document_type,receipt_date,ttn_number,status,source_file_name,source_file_path
    ) values(
      p_project_id,v_type,p_receipt_date,nullif(trim(coalesce(p_ttn_number,'')),''),
      'posted',nullif(trim(coalesce(p_source_file_name,'')),''),nullif(trim(coalesce(p_source_file_path,'')),'')
    )
    returning id into v_document_id;
  else
    select id into v_document_id
    from public.supply_documents
    where id=p_document_id and project_id=p_project_id
    for update;
    if v_document_id is null then raise exception 'Накладная не найдена'; end if;

    update public.supply_documents
    set document_type=v_type,
        receipt_date=p_receipt_date,
        ttn_number=nullif(trim(coalesce(p_ttn_number,'')),''),
        status='posted',
        source_file_name=nullif(trim(coalesce(p_source_file_name,'')),''),
        source_file_path=nullif(trim(coalesce(p_source_file_path,'')),''),
        updated_at=now()
    where id=v_document_id;
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if nullif(trim(coalesce(v_row->>'source_mark','')),'') is null
       and nullif(trim(coalesce(v_row->>'source_name','')),'') is null
       and coalesce(nullif(v_row->>'qty_pieces','')::numeric,0)=0
       and coalesce(nullif(v_row->>'qty_m3','')::numeric,0)=0 then
      continue;
    end if;

    v_row_id=nullif(v_row->>'id','')::uuid;
    v_qty_pieces=nullif(v_row->>'qty_pieces','')::numeric;
    v_qty_m3=nullif(v_row->>'qty_m3','')::numeric;
    v_volume=nullif(v_row->>'unit_volume_snapshot_m3','')::numeric;
    v_unit_price=nullif(v_row->>'unit_price','')::numeric;
    v_vat_percent=coalesce(nullif(v_row->>'vat_percent','')::numeric,20);

    if v_type='white' then
      if coalesce(v_qty_pieces,0)<=0 then
        raise exception 'В белой ТТН количество в штуках должно быть больше 0';
      end if;
      if coalesce(v_volume,0)>0 then v_qty_m3=v_qty_pieces*v_volume; end if;
      v_unit_price=null;
      v_amount_net=null; v_vat_amount=null; v_amount_gross=null;
    else
      if coalesce(v_qty_m3,0)<=0 then
        raise exception 'В зелёной ТТН объём должен быть больше 0';
      end if;
      if coalesce(v_unit_price,0)<0 then
        raise exception 'Цена не может быть отрицательной';
      end if;
      if coalesce(v_volume,0)>0 then v_qty_pieces=v_qty_m3/v_volume; else v_qty_pieces=null; end if;
      v_amount_net=round(v_qty_m3*coalesce(v_unit_price,0),2);
      v_vat_amount=round(v_amount_net*v_vat_percent/100,2);
      v_amount_gross=v_amount_net+v_vat_amount;
    end if;

    v_match_state=case
      when nullif(v_row->>'catalog_item_id','') is null then 'unmatched'
      when coalesce(v_volume,0)<=0 then 'review'
      when v_type='green' and abs(v_qty_pieces-round(v_qty_pieces))>0.000001 then 'review'
      else 'matched'
    end;

    if v_row_id is null then
      insert into public.supply_document_lines(
        project_id,document_id,sort_order,source_mark,source_name,catalog_item_id,supplier_item_id,
        qty_pieces,qty_m3,unit_volume_snapshot_m3,price_basis,unit_price,
        amount_net,vat_percent,vat_amount,amount_gross,match_state
      ) values(
        p_project_id,v_document_id,coalesce((v_row->>'sort_order')::integer,0),
        nullif(trim(coalesce(v_row->>'source_mark','')),''),
        nullif(trim(coalesce(v_row->>'source_name','')),''),
        nullif(v_row->>'catalog_item_id','')::uuid,
        nullif(v_row->>'supplier_item_id','')::uuid,
        v_qty_pieces,v_qty_m3,v_volume,
        case when v_type='green' then 'm3' else null end,
        v_unit_price,v_amount_net,v_vat_percent,v_vat_amount,v_amount_gross,v_match_state
      ) returning id into v_row_id;
    else
      update public.supply_document_lines
      set sort_order=coalesce((v_row->>'sort_order')::integer,0),
          source_mark=nullif(trim(coalesce(v_row->>'source_mark','')),''),
          source_name=nullif(trim(coalesce(v_row->>'source_name','')),''),
          catalog_item_id=nullif(v_row->>'catalog_item_id','')::uuid,
          supplier_item_id=nullif(v_row->>'supplier_item_id','')::uuid,
          qty_pieces=v_qty_pieces,qty_m3=v_qty_m3,unit_volume_snapshot_m3=v_volume,
          price_basis=case when v_type='green' then 'm3' else null end,
          unit_price=v_unit_price,amount_net=v_amount_net,vat_percent=v_vat_percent,
          vat_amount=v_vat_amount,amount_gross=v_amount_gross,match_state=v_match_state,
          updated_at=now()
      where id=v_row_id and document_id=v_document_id and project_id=p_project_id;
      if not found then raise exception 'Строка накладной не найдена'; end if;
    end if;
    v_seen_ids=array_append(v_seen_ids,v_row_id);
  end loop;

  delete from public.supply_document_lines
  where project_id=p_project_id and document_id=v_document_id
    and not (id=any(v_seen_ids));

  return v_document_id;
end;
$$;

revoke all on function public.save_supply_document(uuid,uuid,text,date,text,text,text,jsonb) from public,anon;
grant execute on function public.save_supply_document(uuid,uuid,text,date,text,text,text,jsonb) to authenticated;

create or replace function public.rebuild_green_supply_allocations(
  p_project_id uuid,
  p_document_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  g record;
  w record;
  v_remaining_pieces numeric;
  v_remaining_m3 numeric;
  v_white_remaining_pieces numeric;
  v_white_remaining_m3 numeric;
  v_alloc_pieces numeric;
  v_alloc_m3 numeric;
  v_count integer:=0;
begin
  if not private.can_edit_project(p_project_id) then raise exception 'Недостаточно прав'; end if;
  if not exists(select 1 from public.supply_documents where id=p_document_id and project_id=p_project_id and document_type='green') then
    return jsonb_build_object('allocations',0);
  end if;

  delete from public.supply_line_allocations a
  using public.supply_document_lines gl
  where a.green_line_id=gl.id and gl.document_id=p_document_id and gl.project_id=p_project_id;

  for g in
    select l.*,d.receipt_date
    from public.supply_document_lines l
    join public.supply_documents d on d.id=l.document_id
    where l.project_id=p_project_id and l.document_id=p_document_id and l.catalog_item_id is not null
    order by l.sort_order,l.id
  loop
    v_remaining_pieces=coalesce(g.qty_pieces,0);
    v_remaining_m3=coalesce(g.qty_m3,0);

    for w in
      select l.*,d.receipt_date
      from public.supply_document_lines l
      join public.supply_documents d on d.id=l.document_id
      where l.project_id=p_project_id
        and d.project_id=p_project_id
        and d.document_type='white'
        and d.status='posted'
        and d.receipt_date<=g.receipt_date
        and l.catalog_item_id=g.catalog_item_id
      order by d.receipt_date,l.sort_order,l.id
    loop
      select
        greatest(0,coalesce(w.qty_pieces,0)-coalesce(sum(a.allocated_pieces),0)),
        greatest(0,coalesce(w.qty_m3,0)-coalesce(sum(a.allocated_m3),0))
      into v_white_remaining_pieces,v_white_remaining_m3
      from public.supply_line_allocations a
      where a.white_line_id=w.id;

      if v_remaining_pieces<=0 and v_remaining_m3<=0 then exit; end if;
      if v_white_remaining_pieces<=0 and v_white_remaining_m3<=0 then continue; end if;

      if coalesce(g.unit_volume_snapshot_m3,0)>0 then
        v_alloc_pieces=least(v_remaining_pieces,v_white_remaining_pieces);
        v_alloc_m3=v_alloc_pieces*g.unit_volume_snapshot_m3;
      else
        v_alloc_m3=least(v_remaining_m3,v_white_remaining_m3);
        v_alloc_pieces=null;
      end if;

      if coalesce(v_alloc_pieces,0)>0 or coalesce(v_alloc_m3,0)>0 then
        insert into public.supply_line_allocations(project_id,white_line_id,green_line_id,allocated_pieces,allocated_m3)
        values(p_project_id,w.id,g.id,v_alloc_pieces,v_alloc_m3);
        v_count=v_count+1;
        v_remaining_pieces=greatest(0,v_remaining_pieces-coalesce(v_alloc_pieces,0));
        v_remaining_m3=greatest(0,v_remaining_m3-coalesce(v_alloc_m3,0));
      end if;
    end loop;
  end loop;

  return jsonb_build_object('allocations',v_count);
end;
$$;

revoke all on function public.rebuild_green_supply_allocations(uuid,uuid) from public,anon;
grant execute on function public.rebuild_green_supply_allocations(uuid,uuid) to authenticated;
