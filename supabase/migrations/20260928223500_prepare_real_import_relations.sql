
alter table public.estimates
  add column if not exists building_section text,
  add column if not exists zone text,
  add column if not exists is_stairs boolean not null default false;

alter table public.estimate_rows
  add column if not exists catalog_item_id uuid
  references public.catalog_items(id) on delete set null;

alter table public.imports
  add column if not exists source_slot text,
  add column if not exists applied_at timestamptz;

create index if not exists ix_estimate_rows_catalog
  on public.estimate_rows(project_id, catalog_item_id)
  where archived_at is null and catalog_item_id is not null;

create index if not exists ix_imports_project_domain_slot
  on public.imports(project_id, domain, source_slot, imported_at desc);

create unique index if not exists ux_spec_sections_semantic
  on public.specification_sections(project_id, building_section, zone, name, is_stairs);

create unique index if not exists ux_estimate_sections_semantic
  on public.estimate_sections(estimate_id, title, occurrence);

create unique index if not exists ux_catalog_normalized_active
  on public.catalog_items(project_id, normalized_key)
  where normalized_key is not null and archived_at is null;

create or replace function public.refresh_auto_reconciliation_links(p_project_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_catalog_linked integer := 0;
  v_auto_links integer := 0;
  v_unlinked_materials integer := 0;
begin
  with unique_marks as (
    select project_id, btrim(mark) as mark_key, min(id) as catalog_item_id
    from public.catalog_items
    where project_id = p_project_id
      and archived_at is null
    group by project_id, btrim(mark)
    having count(*) = 1
  ),
  upd as (
    update public.estimate_rows er
       set catalog_item_id = um.catalog_item_id,
           updated_at = now()
      from unique_marks um
     where er.project_id = p_project_id
       and er.project_id = um.project_id
       and er.archived_at is null
       and er.row_type = 'material'
       and er.catalog_item_id is null
       and btrim(coalesce(er.basis,'')) = um.mark_key
    returning er.id
  )
  select count(*) into v_catalog_linked from upd;

  delete from public.reconciliation_links
   where project_id = p_project_id
     and link_method = 'auto';

  insert into public.reconciliation_links(
    project_id,
    estimate_row_id,
    specification_row_id,
    link_method,
    origin_mode
  )
  select
    er.project_id,
    er.id,
    sr.id,
    'auto',
    'catalog_item_scope'
  from public.estimate_rows er
  join public.estimates e
    on e.id = er.estimate_id
   and e.project_id = er.project_id
  join public.specification_rows sr
    on sr.project_id = er.project_id
   and sr.catalog_item_id = er.catalog_item_id
   and sr.archived_at is null
  join public.specification_sections ss
    on ss.id = sr.section_id
   and ss.project_id = sr.project_id
  where er.project_id = p_project_id
    and er.archived_at is null
    and er.row_type = 'material'
    and er.catalog_item_id is not null
    and (
      (e.is_stairs = true and ss.is_stairs = true)
      or
      (
        e.is_stairs = false
        and ss.is_stairs = false
        and (e.building_section is null or e.building_section = ss.building_section)
        and (e.zone is null or e.zone = ss.zone)
      )
    )
  on conflict (estimate_row_id, specification_row_id) do nothing;

  get diagnostics v_auto_links = row_count;

  select count(*)
    into v_unlinked_materials
  from public.estimate_rows er
  where er.project_id = p_project_id
    and er.archived_at is null
    and er.row_type = 'material'
    and er.catalog_item_id is null;

  return jsonb_build_object(
    'catalog_links_created', v_catalog_linked,
    'reconciliation_links_created', v_auto_links,
    'unlinked_material_rows', v_unlinked_materials
  );
end;
$$;

create or replace view public.v_import_link_readiness
with (security_invoker = true)
as
select
  p.id as project_id,
  p.code as project_code,
  (select count(*) from public.catalog_items c where c.project_id=p.id and c.archived_at is null) as catalog_items,
  (select count(*) from public.specification_rows sr where sr.project_id=p.id and sr.archived_at is null) as specification_rows,
  (select count(*) from public.specification_rows sr where sr.project_id=p.id and sr.archived_at is null and sr.catalog_item_id is null) as specification_rows_without_catalog,
  (select count(*) from public.estimate_rows er where er.project_id=p.id and er.archived_at is null) as estimate_rows,
  (select count(*) from public.estimate_rows er where er.project_id=p.id and er.archived_at is null and er.row_type='material') as estimate_material_rows,
  (select count(*) from public.estimate_rows er where er.project_id=p.id and er.archived_at is null and er.row_type='material' and er.catalog_item_id is null) as estimate_material_rows_without_catalog,
  (select count(*) from public.reconciliation_links rl where rl.project_id=p.id) as specification_estimate_links,
  (select count(*) from public.estimate_work_links wl where wl.project_id=p.id) as material_work_links
from public.projects p;
