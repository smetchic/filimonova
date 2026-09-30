drop function if exists public.set_supplier_price_link_scoped_safe(uuid,uuid,uuid,text);
drop function if exists public.set_supplier_price_link_scoped(uuid,uuid,uuid,text);
alter function public.set_supplier_price_link_scoped_core(uuid,uuid,uuid,text)
rename to set_supplier_price_link_scoped;
grant execute on function public.set_supplier_price_link_scoped(uuid,uuid,uuid,text) to authenticated;
