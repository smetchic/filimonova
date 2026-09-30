create table if not exists public.supplier_price_control_journal (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  catalog_item_id uuid references public.catalog_items(id) on delete set null,
  supplier_item_id uuid references public.supplier_items(id) on delete set null,
  issue_key text not null,
  reasons text[] not null default '{}',
  status text not null default 'open',
  snapshot jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_price_control_journal_status_check check (status in ('open','closed')),
  constraint supplier_price_control_journal_project_issue_key_key unique (project_id, issue_key)
);

create index if not exists ix_supplier_price_control_journal_project
  on public.supplier_price_control_journal(project_id, created_at desc);
create index if not exists ix_supplier_price_control_journal_catalog
  on public.supplier_price_control_journal(project_id, catalog_item_id);
create index if not exists ix_supplier_price_control_journal_supplier_item
  on public.supplier_price_control_journal(project_id, supplier_item_id);

alter table public.supplier_price_control_journal enable row level security;

drop policy if exists supplier_price_control_journal_select on public.supplier_price_control_journal;
create policy supplier_price_control_journal_select
on public.supplier_price_control_journal for select to authenticated
using ((select private.is_project_member(project_id)));

drop policy if exists supplier_price_control_journal_insert on public.supplier_price_control_journal;
create policy supplier_price_control_journal_insert
on public.supplier_price_control_journal for insert to authenticated
with check ((select private.can_edit_project(project_id)));

drop policy if exists supplier_price_control_journal_update on public.supplier_price_control_journal;
create policy supplier_price_control_journal_update
on public.supplier_price_control_journal for update to authenticated
using ((select private.can_edit_project(project_id)))
with check ((select private.can_edit_project(project_id)));

drop policy if exists supplier_price_control_journal_delete on public.supplier_price_control_journal;
create policy supplier_price_control_journal_delete
on public.supplier_price_control_journal for delete to authenticated
using ((select private.can_edit_project(project_id)));

grant select,insert,update,delete on public.supplier_price_control_journal to authenticated;
