-- Performance indexes for the application read paths.
-- Keeps project-scoped REST queries from scanning unrelated rows as the database grows.

create index if not exists ix_spec_qty_project_order
  on public.specification_quantities(project_id, level_order, specification_row_id);

create index if not exists ix_estimate_rows_project_order
  on public.estimate_rows(project_id, sort_order)
  where archived_at is null;

create index if not exists ix_estimate_costs_project_row
  on public.estimate_row_costs(project_id, estimate_row_id);

create index if not exists ix_estimate_sections_project_order
  on public.estimate_sections(project_id, sort_order);

create index if not exists ix_work_links_project_rows
  on public.estimate_work_links(project_id, material_row_id, work_row_id);

create index if not exists ix_recon_journal_project_created
  on public.reconciliation_journal(project_id, created_at desc);

create index if not exists ix_suppliers_project_name_active
  on public.suppliers(project_id, name)
  where archived_at is null;

create index if not exists ix_supplier_items_project_mark_active
  on public.supplier_items(project_id, source_mark)
  where archived_at is null;

create index if not exists ix_supplier_prices_project_item_date
  on public.supplier_prices(project_id, supplier_item_id, effective_from, price_basis);

create index if not exists ix_gpr_plans_project_created
  on public.gpr_plans(project_id, created_at);

create index if not exists ix_gpr_months_project_month
  on public.gpr_months(project_id, month);

create index if not exists ix_gpr_floor_project_plan
  on public.gpr_floor_assignments(project_id, plan_id);

create index if not exists ix_avr_versions_project_created
  on public.avr_versions(project_id, created_at);

create index if not exists ix_avr_rows_project_version
  on public.avr_rows(project_id, version_id);

create index if not exists ix_accounting_rows_project_source
  on public.accounting_rows(project_id, source_row_no);

create index if not exists ix_s29_rows_project_document
  on public.s29_rows(project_id, document_id);

create index if not exists ix_s29_allocations_project_row
  on public.s29_allocations(project_id, s29_row_id);

create index if not exists ix_s29_settlements_project_document
  on public.s29_carryover_settlements(project_id, settlement_document_id);
