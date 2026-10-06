
alter table public.supplier_items
  drop constraint if exists supplier_items_link_state_check;
alter table public.supplier_items
  add constraint supplier_items_link_state_check
  check (link_state in ('matched','review','unmatched','supplier_only','ambiguous','needs_review'));
