-- OCR matching rule for supplier prices:
-- Cyrillic О, Latin O/o and digit 0 are equivalent for comparison only.
-- Source text and source_key remain untouched.

create or replace function private.norm_supplier_match_mark(p_text text)
returns text
language sql
immutable
parallel safe
set search_path=''
as $$
  select translate(private.norm_supplier_mark(p_text),'оo0','000');
$$;

create or replace function private.norm_supplier_match_name(p_text text)
returns text
language sql
immutable
parallel safe
set search_path=''
as $$
  select translate(private.norm_supplier_name(p_text),'оo0','000');
$$;

create or replace function private.supplier_project_scope_key(p_zone text,p_section text)
returns text
language sql
immutable
parallel safe
set search_path=''
as $$
  select lower(replace(trim(regexp_replace(coalesce(p_zone,''),'\s+',' ','g')),'ё','е'))
      ||'|'||
         lower(replace(trim(regexp_replace(coalesce(p_section,''),'\s+',' ','g')),'ё','е'));
$$;

create or replace function private.auto_link_supplier_item_scoped()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_raw jsonb;
  v_import_id uuid;
  v_scope text;
  v_catalog_id uuid;
  v_count integer;
begin
  if new.source_import_row_id is null or new.supplier_id is null then
    return new;
  end if;

  if exists(select 1 from public.supplier_price_links l where l.supplier_item_id=new.id) then
    return new;
  end if;

  select ir.raw_data,ir.import_id
    into v_raw,v_import_id
  from public.import_rows ir
  where ir.id=new.source_import_row_id;

  if v_raw is null then return new; end if;

  v_scope:=private.supplier_price_scope_key(v_raw);
  if nullif(v_scope,'|') is null then return new; end if;

  with candidates as (
    select distinct ci.id
    from public.catalog_items ci
    join public.specification_rows sr
      on sr.project_id=ci.project_id
     and sr.catalog_item_id=ci.id
     and sr.archived_at is null
    join public.specification_sections ss on ss.id=sr.section_id
    where ci.project_id=new.project_id
      and ci.archived_at is null
      and private.supplier_project_scope_key(ss.zone,ss.name)=v_scope
      and private.norm_supplier_match_mark(ci.mark)=private.norm_supplier_match_mark(v_raw->>'source_mark')
      and private.norm_supplier_match_name(ci.name)=private.norm_supplier_match_name(v_raw->>'source_name')
  )
  select count(*),min(id::text)::uuid into v_count,v_catalog_id
  from candidates;

  if v_count<>1 or v_catalog_id is null then
    return new;
  end if;

  if exists(
    select 1
    from public.supplier_price_links l
    where l.project_id=new.project_id
      and l.supplier_id=new.supplier_id
      and l.catalog_item_id=v_catalog_id
      and l.scope_key=v_scope
  ) then
    return new;
  end if;

  insert into public.supplier_price_links(
    project_id,supplier_id,catalog_item_id,supplier_item_id,scope_key,
    link_method,validation_state,last_checked_import_id
  )
  values(
    new.project_id,new.supplier_id,v_catalog_id,new.id,v_scope,
    'auto','confirmed',v_import_id
  )
  on conflict do nothing;

  if found then
    update public.supplier_items
    set catalog_item_id=v_catalog_id,
        link_method='auto',
        link_state='matched',
        updated_at=now()
    where id=new.id;

    insert into public.supplier_price_journal(
      project_id,import_id,catalog_item_id,supplier_item_id,event_type,after_value,link_method
    )
    values(
      new.project_id,v_import_id,v_catalog_id,new.id,'automatic_exact_link',
      jsonb_build_object(
        'source_mark',v_raw->>'source_mark',
        'source_name',v_raw->>'source_name',
        'scope_key',v_scope,
        'ocr_o_zero_equivalent',true
      ),
      'auto'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_supplier_item_scoped_auto_link on public.supplier_items;
create trigger trg_supplier_item_scoped_auto_link
after insert or update of source_import_row_id
on public.supplier_items
for each row
execute function private.auto_link_supplier_item_scoped();

-- Apply the rule to the current supplier-price version.
with latest_import as (
  select i.id
  from public.imports i
  where i.project_id=(select id from public.projects order by created_at limit 1)
    and i.domain='supplier_price'
    and i.status='applied'
  order by i.imported_at desc
  limit 1
)
update public.supplier_items si
set source_import_row_id=si.source_import_row_id
where si.source_import_row_id in (
  select ir.id
  from public.import_rows ir
  where ir.import_id=(select id from latest_import)
);
