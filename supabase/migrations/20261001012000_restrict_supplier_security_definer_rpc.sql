revoke execute on function public.rebuild_supplier_auto_links(uuid) from public, anon;
grant execute on function public.rebuild_supplier_auto_links(uuid) to authenticated;

revoke execute on function public.set_supplier_price_link_scoped(uuid,uuid,uuid,text) from public, anon;
grant execute on function public.set_supplier_price_link_scoped(uuid,uuid,uuid,text) to authenticated;
