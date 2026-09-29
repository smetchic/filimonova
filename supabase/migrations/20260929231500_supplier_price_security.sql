-- RPCs are intentionally exposed only to signed-in project editors.
revoke all on function public.set_supplier_price_link(uuid,uuid,uuid) from public,anon;
grant execute on function public.set_supplier_price_link(uuid,uuid,uuid) to authenticated;

revoke all on function public.apply_supplier_spec_import(uuid,text,text,text,jsonb) from public,anon;
grant execute on function public.apply_supplier_spec_import(uuid,text,text,text,jsonb) to authenticated;

create index if not exists ix_supplier_price_links_supplier
  on public.supplier_price_links(project_id,supplier_id);
create index if not exists ix_supplier_price_links_last_import
  on public.supplier_price_links(last_checked_import_id);
create index if not exists ix_supplier_price_journal_import
  on public.supplier_price_journal(import_id);
create index if not exists ix_supplier_price_journal_supplier_item
  on public.supplier_price_journal(supplier_item_id);
