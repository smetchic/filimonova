alter function public.set_supplier_price_link_scoped(uuid,uuid,uuid,text)
rename to set_supplier_price_link_scoped_core;

create function public.set_supplier_price_link_scoped(
  p_project_id uuid,
  p_catalog_item_id uuid,
  p_supplier_item_id uuid,
  p_scope_key text
) returns jsonb
language plpgsql
set search_path=public,private,pg_temp
as $$
declare
  v_scope text:=coalesce(p_scope_key,'');
begin
  if p_supplier_item_id is not null then
    select private.supplier_price_scope_key(ir.raw_data)
      into v_scope
    from public.supplier_items si
    join public.import_rows ir on ir.id=si.source_import_row_id
    where si.id=p_supplier_item_id and si.project_id=p_project_id;
  end if;

  return public.set_supplier_price_link_scoped_core(
    p_project_id,p_catalog_item_id,p_supplier_item_id,v_scope
  );
end;
$$;

grant execute on function public.set_supplier_price_link_scoped(uuid,uuid,uuid,text) to authenticated;
