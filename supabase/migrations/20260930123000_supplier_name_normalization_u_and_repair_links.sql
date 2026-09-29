-- Supplier name normalization and one-time repair of exact links.
-- Source text remains immutable; normalization is used only for matching.

create or replace function private.norm_supplier_name(p_text text)
returns text
language sql
immutable
parallel safe
set search_path=''
as $$
  select regexp_replace(
    replace(
      lower(regexp_replace(replace(btrim(coalesce(p_text,'')), chr(160), ' '), '\s+', ' ', 'g')),
      'ё','е'
    ),
    '\(\s*у\s*\)',
    'у',
    'g'
  );
$$;

with project_row as (
  select id as project_id from public.projects where code='FILIMONOVA' limit 1
),
latest as (
  select i.id as import_id
  from public.imports i
  join project_row p on p.project_id=i.project_id
  where i.domain='supplier_price' and i.status='applied'
  order by i.imported_at desc
  limit 1
),
raw_candidates as (
  select
    si.id as supplier_item_id,
    si.supplier_id,
    ci.id as catalog_item_id,
    l.import_id,
    count(*) over(partition by ci.id) as source_count_for_catalog
  from latest l
  join public.import_rows ir on ir.import_id=l.import_id
  join public.supplier_items si on si.source_import_row_id=ir.id and si.archived_at is null
  join project_row p on p.project_id=si.project_id
  join public.catalog_items ci
    on ci.project_id=p.project_id
   and ci.archived_at is null
   and private.norm_supplier_mark(ci.mark)=private.norm_supplier_mark(ir.raw_data->>'source_mark')
   and private.norm_supplier_name(ci.name)=private.norm_supplier_name(ir.raw_data->>'source_name')
),
candidates as (
  select *
  from raw_candidates
  where source_count_for_catalog=1
),
ins as (
  insert into public.supplier_price_links(
    project_id,supplier_id,catalog_item_id,supplier_item_id,
    link_method,validation_state,last_checked_import_id
  )
  select p.project_id,c.supplier_id,c.catalog_item_id,c.supplier_item_id,
         'auto','confirmed',c.import_id
  from candidates c
  cross join project_row p
  where not exists(
    select 1 from public.supplier_price_links x
    where x.supplier_item_id=c.supplier_item_id
  )
    and not exists(
    select 1 from public.supplier_price_links x
    where x.project_id=p.project_id
      and x.supplier_id=c.supplier_id
      and x.catalog_item_id=c.catalog_item_id
  )
  on conflict do nothing
  returning project_id,supplier_id,catalog_item_id,supplier_item_id,last_checked_import_id
),
upd as (
  update public.supplier_items si
  set catalog_item_id=ins.catalog_item_id,
      link_method='auto',
      link_state='matched',
      updated_at=now()
  from ins
  where si.id=ins.supplier_item_id
  returning si.id
)
insert into public.supplier_price_journal(
  project_id,import_id,catalog_item_id,supplier_item_id,event_type,after_value,link_method
)
select ins.project_id,ins.last_checked_import_id,ins.catalog_item_id,ins.supplier_item_id,
       'automatic_exact_link',
       jsonb_build_object('repair','supplier-name-normalization'),
       'auto'
from ins;
