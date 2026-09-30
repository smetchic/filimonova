create or replace function private.supplier_numeric_signature(p_text text)
returns text
language sql
immutable
parallel safe
set search_path=''
as $$
  select trim(both '|' from regexp_replace(private.norm_supplier_match_name(p_text),'[^0-9]+','|','g'));
$$;

create or replace function private.rebuild_supplier_auto_links_internal(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_import_id uuid;
  v_supplier_id uuid;
  v_removed integer:=0;
  v_created integer:=0;
begin
  select i.id,
         (select s.id
          from public.suppliers s
          where s.project_id=i.project_id
            and s.archived_at is null
            and private.norm_supplier_name(s.name)=private.norm_supplier_name(i.report->>'supplier')
          order by s.created_at
          limit 1)
    into v_import_id,v_supplier_id
  from public.imports i
  where i.project_id=p_project_id
    and i.domain='supplier_price'
    and i.status='applied'
  order by i.imported_at desc
  limit 1;

  if v_import_id is null or v_supplier_id is null then
    return jsonb_build_object('status','no_supplier_price');
  end if;

  create temporary table tmp_old_auto on commit drop as
  select id,supplier_item_id
  from public.supplier_price_links
  where project_id=p_project_id and link_method='auto';

  delete from public.supplier_price_links
  where project_id=p_project_id and link_method='auto';
  get diagnostics v_removed=row_count;

  update public.supplier_items si
  set catalog_item_id=null,link_method=null,link_state='unmatched',updated_at=now()
  where si.id in(select supplier_item_id from tmp_old_auto)
    and not exists(select 1 from public.supplier_price_links l where l.supplier_item_id=si.id);

  create temporary table tmp_proj on commit drop as
  select
    ci.id catalog_item_id,
    private.supplier_project_scope_key(ss.zone,ss.name) scope_key,
    private.norm_supplier_match_mark(ci.mark) mk,
    private.norm_supplier_match_name(ci.name) nk,
    private.supplier_numeric_signature(ci.name) nums,
    sum(coalesce(sq.quantity,0))::numeric qty
  from public.catalog_items ci
  join public.specification_rows sr
    on sr.project_id=ci.project_id
   and sr.catalog_item_id=ci.id
   and sr.archived_at is null
  join public.specification_sections ss on ss.id=sr.section_id
  left join public.specification_quantities sq on sq.specification_row_id=sr.id
  where ci.project_id=p_project_id and ci.archived_at is null
  group by ci.id,ss.zone,ss.name,ci.mark,ci.name;

  create temporary table tmp_src on commit drop as
  select
    si.id supplier_item_id,
    si.supplier_id,
    ir.source_row_no,
    private.supplier_price_scope_key(ir.raw_data) source_scope,
    private.norm_supplier_match_mark(ir.raw_data->>'source_mark') mk,
    private.norm_supplier_match_name(ir.raw_data->>'source_name') nk,
    private.supplier_numeric_signature(ir.raw_data->>'source_name') nums,
    nullif(ir.raw_data->>'qty_house','')::numeric qty
  from public.import_rows ir
  join public.supplier_items si
    on si.project_id=p_project_id
   and si.supplier_id=v_supplier_id
   and si.source_import_row_id=ir.id
  where ir.import_id=v_import_id
    and not exists(
      select 1 from public.supplier_price_links l
      where l.supplier_item_id=si.id and l.link_method='manual'
    );

  create temporary table tmp_available_proj on commit drop as
  select p.*
  from tmp_proj p
  where not exists(
    select 1 from public.supplier_price_links l
    where l.project_id=p_project_id
      and l.catalog_item_id=p.catalog_item_id
      and l.scope_key=p.scope_key
      and l.link_method='manual'
  );

  create temporary table tmp_choice(
    supplier_item_id uuid primary key,
    supplier_id uuid not null,
    catalog_item_id uuid not null,
    project_scope text not null,
    rule text not null
  ) on commit drop;

  insert into tmp_choice
  select s.supplier_item_id,s.supplier_id,p.catalog_item_id,p.scope_key,'scoped_exact'
  from tmp_src s
  join tmp_available_proj p
    on p.scope_key=s.source_scope and p.mk=s.mk and p.nk=s.nk
  where (select count(*) from tmp_available_proj q
         where q.scope_key=s.source_scope and q.mk=s.mk and q.nk=s.nk)=1
    and (select count(*) from tmp_src q
         where q.source_scope=s.source_scope and q.mk=s.mk and q.nk=s.nk)=1;

  insert into tmp_choice
  select s.supplier_item_id,s.supplier_id,p.catalog_item_id,p.scope_key,'scoped_mark_qty_numeric'
  from tmp_src s
  join tmp_available_proj p
    on p.scope_key=s.source_scope and p.mk=s.mk and p.qty=s.qty and p.nums=s.nums
  where s.qty is not null and s.nums<>''
    and not exists(select 1 from tmp_choice c where c.supplier_item_id=s.supplier_item_id)
    and (select count(*) from tmp_available_proj q
         where q.scope_key=s.source_scope and q.mk=s.mk and q.qty=s.qty and q.nums=s.nums)=1
    and (select count(*) from tmp_src q
         where q.source_scope=s.source_scope and q.mk=s.mk and q.qty=s.qty and q.nums=s.nums)=1
    and not exists(select 1 from tmp_choice c
                   where c.catalog_item_id=p.catalog_item_id and c.project_scope=p.scope_key);

  insert into tmp_choice
  select s.supplier_item_id,s.supplier_id,p.catalog_item_id,p.scope_key,'scoped_unique_mark_numeric'
  from tmp_src s
  join tmp_available_proj p
    on p.scope_key=s.source_scope and p.mk=s.mk and p.nums=s.nums
  where s.nums<>''
    and not exists(select 1 from tmp_choice c where c.supplier_item_id=s.supplier_item_id)
    and (select count(*) from tmp_available_proj q
         where q.scope_key=s.source_scope and q.mk=s.mk and q.nums=s.nums)=1
    and (select count(*) from tmp_src q
         where q.source_scope=s.source_scope and q.mk=s.mk and q.nums=s.nums)=1
    and not exists(select 1 from tmp_choice c
                   where c.catalog_item_id=p.catalog_item_id and c.project_scope=p.scope_key);

  insert into tmp_choice
  select s.supplier_item_id,s.supplier_id,p.catalog_item_id,p.scope_key,'global_exact'
  from tmp_src s
  join tmp_available_proj p on p.mk=s.mk and p.nk=s.nk
  where not exists(select 1 from tmp_choice c where c.supplier_item_id=s.supplier_item_id)
    and (select count(*) from tmp_available_proj q where q.mk=s.mk and q.nk=s.nk)=1
    and (select count(*) from tmp_src q where q.mk=s.mk and q.nk=s.nk)=1
    and not exists(select 1 from tmp_choice c
                   where c.catalog_item_id=p.catalog_item_id and c.project_scope=p.scope_key);

  insert into tmp_choice
  select s.supplier_item_id,s.supplier_id,p.catalog_item_id,p.scope_key,'global_unique_mark_numeric'
  from tmp_src s
  join tmp_available_proj p on p.mk=s.mk and p.nums=s.nums
  where s.nums<>''
    and not exists(select 1 from tmp_choice c where c.supplier_item_id=s.supplier_item_id)
    and (select count(*) from tmp_available_proj q where q.mk=s.mk and q.nums=s.nums)=1
    and (select count(*) from tmp_src q where q.mk=s.mk and q.nums=s.nums)=1
    and not exists(select 1 from tmp_choice c
                   where c.catalog_item_id=p.catalog_item_id and c.project_scope=p.scope_key);

  insert into public.supplier_price_links(
    project_id,supplier_id,catalog_item_id,supplier_item_id,scope_key,
    link_method,validation_state,last_checked_import_id
  )
  select p_project_id,c.supplier_id,c.catalog_item_id,c.supplier_item_id,c.project_scope,
         'auto','confirmed',v_import_id
  from tmp_choice c
  on conflict do nothing;
  get diagnostics v_created=row_count;

  update public.supplier_items si
  set catalog_item_id=l.catalog_item_id,link_method='auto',link_state='matched',updated_at=now()
  from public.supplier_price_links l
  where l.project_id=p_project_id
    and l.link_method='auto'
    and l.supplier_item_id=si.id;

  return jsonb_build_object(
    'status','ok',
    'removed_auto',v_removed,
    'created_auto',v_created,
    'unmatched',(
      select count(*) from tmp_src s
      where not exists(select 1 from public.supplier_price_links l where l.supplier_item_id=s.supplier_item_id)
    )
  );
end;
$$;

create or replace function public.rebuild_supplier_auto_links(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if not private.can_edit_project(p_project_id) then raise exception 'Недостаточно прав'; end if;
  return private.rebuild_supplier_auto_links_internal(p_project_id);
end;
$$;

grant execute on function public.rebuild_supplier_auto_links(uuid) to authenticated;

create or replace function private.rebuild_supplier_auto_links_on_apply()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if new.domain='supplier_price'
     and new.status='applied'
     and old.status is distinct from new.status then
    perform private.rebuild_supplier_auto_links_internal(new.project_id);
  end if;
  return new;
end;
$$;

select private.rebuild_supplier_auto_links_internal('439a921e-51ea-4935-b136-8d7a3642e993');
