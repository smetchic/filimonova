
create or replace view public.supplier_prices_current
with (security_invoker=true)
as
select distinct on (sp.supplier_item_id,sp.effective_from,sp.price_basis)
  sp.id,
  sp.project_id,
  sp.supplier_item_id,
  sp.effective_from,
  sp.price_basis,
  sp.unit_price_gross,
  sp.unit_volume_snapshot_m3,
  sp.source_import_row_id,
  i.imported_at as source_imported_at
from public.supplier_prices sp
left join public.import_rows ir on ir.id=sp.source_import_row_id
left join public.imports i on i.id=ir.import_id
order by
  sp.supplier_item_id,
  sp.effective_from,
  sp.price_basis,
  i.imported_at desc nulls last,
  sp.created_at desc;

grant select on public.supplier_prices_current to authenticated;
