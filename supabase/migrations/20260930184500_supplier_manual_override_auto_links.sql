-- Manual supplier reconciliation must be authoritative.
-- A user-confirmed link may replace an automatic guess, while another manual
-- link stays protected. Quantity/volume differences remain verification facts.

create or replace function public.set_supplier_price_link(
  p_project_id uuid,
  p_catalog_item_id uuid,
  p_supplier_item_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_supplier_id uuid;
  v_old public.supplier_price_links%rowtype;
  v_target_owner public.supplier_price_links%rowtype;
  v_import_id uuid;
begin
  if not private.can_edit_project(p_project_id) then raise exception 'Недостаточно прав'; end if;
  if not exists(select 1 from public.catalog_items where id=p_catalog_item_id and project_id=p_project_id and archived_at is null) then
    raise exception 'Проектная номенклатура не найдена';
  end if;
  select * into v_old from public.supplier_price_links
  where project_id=p_project_id and catalog_item_id=p_catalog_item_id for update;

  if p_supplier_item_id is null then
    if v_old.id is not null then
      update public.supplier_items set catalog_item_id=null,link_method=null,link_state='unmatched',updated_at=now()
      where id=v_old.supplier_item_id;
      delete from public.supplier_price_links where id=v_old.id;
      insert into public.supplier_price_journal(project_id,import_id,catalog_item_id,supplier_item_id,event_type,before_value,link_method)
      values(p_project_id,v_old.last_checked_import_id,p_catalog_item_id,v_old.supplier_item_id,'manual_link_removed',
        jsonb_build_object('supplier_item_id',v_old.supplier_item_id),'manual');
    end if;
    return jsonb_build_object('status','removed');
  end if;

  select supplier_id into v_supplier_id from public.supplier_items
  where id=p_supplier_item_id and project_id=p_project_id and archived_at is null;
  if v_supplier_id is null then raise exception 'Позиция поставщика не найдена'; end if;
  select * into v_target_owner from public.supplier_price_links
  where supplier_item_id=p_supplier_item_id and catalog_item_id<>p_catalog_item_id
  for update;

  select i.id into v_import_id from public.imports i
  where i.project_id=p_project_id and i.domain='supplier_price' and i.status='applied'
  order by i.imported_at desc limit 1;

  -- Manual choice may replace an automatic link that was guessed incorrectly.
  -- A pre-existing manual link remains protected from silent reassignment.
  if v_target_owner.id is not null then
    if v_target_owner.link_method='manual' then
      raise exception 'Позиция поставщика уже вручную связана с другой проектной номенклатурой';
    end if;
    delete from public.supplier_price_links where id=v_target_owner.id;
    insert into public.supplier_price_journal(
      project_id,import_id,catalog_item_id,supplier_item_id,event_type,before_value,after_value,link_method
    ) values(
      p_project_id,v_import_id,v_target_owner.catalog_item_id,p_supplier_item_id,'manual_link_removed',
      jsonb_build_object('supplier_item_id',p_supplier_item_id,'previous_link_method',v_target_owner.link_method),
      jsonb_build_object('reassigned_to_catalog_item_id',p_catalog_item_id),
      'manual'
    );
  end if;

  if v_old.id is null then
    insert into public.supplier_price_links(project_id,supplier_id,catalog_item_id,supplier_item_id,link_method,validation_state,last_checked_import_id)
    values(p_project_id,v_supplier_id,p_catalog_item_id,p_supplier_item_id,'manual','confirmed',v_import_id);
    insert into public.supplier_price_journal(project_id,import_id,catalog_item_id,supplier_item_id,event_type,after_value,link_method)
    values(p_project_id,v_import_id,p_catalog_item_id,p_supplier_item_id,'manual_link_created',jsonb_build_object('supplier_item_id',p_supplier_item_id),'manual');
  else
    if v_old.supplier_item_id<>p_supplier_item_id then
      update public.supplier_items set catalog_item_id=null,link_method=null,link_state='unmatched',updated_at=now()
      where id=v_old.supplier_item_id;
    end if;
    update public.supplier_price_links set supplier_id=v_supplier_id,supplier_item_id=p_supplier_item_id,
      link_method='manual',validation_state='confirmed',last_checked_import_id=v_import_id,
      confirmed_by=auth.uid(),updated_at=now() where id=v_old.id;
    insert into public.supplier_price_journal(project_id,import_id,catalog_item_id,supplier_item_id,event_type,before_value,after_value,link_method)
    values(p_project_id,v_import_id,p_catalog_item_id,p_supplier_item_id,
      case when v_old.supplier_item_id=p_supplier_item_id then 'ambiguous_confirmed' else 'manual_link_changed' end,
      jsonb_build_object('supplier_item_id',v_old.supplier_item_id),jsonb_build_object('supplier_item_id',p_supplier_item_id),'manual');
  end if;
  update public.supplier_items set catalog_item_id=p_catalog_item_id,link_method='manual',link_state='matched',updated_at=now()
  where id=p_supplier_item_id;
  return jsonb_build_object('status','confirmed','catalog_item_id',p_catalog_item_id,'supplier_item_id',p_supplier_item_id);
end;
$$;

grant execute on function public.set_supplier_price_link(uuid,uuid,uuid) to authenticated;
