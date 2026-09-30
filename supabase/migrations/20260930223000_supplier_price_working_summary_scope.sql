-- Supplier price links must target a row of the Working Summary, not only
-- catalog nomenclature. The same mark/name can legitimately occur in both
-- basement and above-0.000 supplier sections (e.g. PL1).

create or replace function private.supplier_price_scope_key(p_raw jsonb)
returns text
language plpgsql
immutable
as $$
declare
  g text:=lower(trim(regexp_replace(coalesce(p_raw->>'source_group',''),'\s+',' ','g')));
  s text:=lower(trim(regexp_replace(coalesce(p_raw->>'source_section',''),'\s+',' ','g')));
  z text:='';
begin
  if g like '%ниже отметки%' or g like '%цокол%' then
    z:='цоколь';
  elsif g like '%выше отметки%' or g like '%выше 0.000%' then
    z:='выше 0.000';
  elsif g like '%лестниц%' or s like '%элемент%лестниц%' then
    z:='лестницы';
  end if;
  return z||'|'||replace(s,'ё','е');
end;
$$;

alter table public.supplier_price_links
  add column if not exists scope_key text not null default '';

update public.supplier_price_links l
set scope_key=private.supplier_price_scope_key(ir.raw_data)
from public.supplier_items si
join public.import_rows ir on ir.id=si.source_import_row_id
where l.supplier_item_id=si.id
  and coalesce(l.scope_key,'')='';

alter table public.supplier_price_links
  drop constraint if exists supplier_price_links_project_id_supplier_id_catalog_item_id_key;

drop index if exists public.ux_supplier_price_links_scope;
create unique index ux_supplier_price_links_scope
  on public.supplier_price_links(project_id,supplier_id,catalog_item_id,scope_key);

create index if not exists ix_supplier_price_links_project_catalog_scope
  on public.supplier_price_links(project_id,catalog_item_id,scope_key);

alter table public.supplier_price_control_journal
  add column if not exists scope_key text not null default '';

create or replace view public.supplier_price_snapshot_rows
with (security_invoker=true) as
select
  i.project_id,
  i.id as import_id,
  i.source_name,
  i.imported_at,
  dense_rank() over(partition by i.project_id order by i.imported_at,i.id) as version_no,
  s.id as supplier_id,
  ir.id as import_row_id,
  ir.source_row_no,
  ir.source_key,
  ir.raw_data,
  ir.normalized_data,
  si.id as supplier_item_id,
  spl.catalog_item_id,
  spl.link_method,
  spl.validation_state,
  spl.scope_key
from public.imports i
join public.import_rows ir on ir.import_id=i.id
left join public.suppliers s
  on s.project_id=i.project_id
 and s.archived_at is null
 and private.norm_supplier_name(s.name)=private.norm_supplier_name(i.report->>'supplier')
left join public.supplier_items si
  on si.project_id=i.project_id and si.supplier_id=s.id and si.source_key=ir.source_key
left join public.supplier_price_links spl on spl.supplier_item_id=si.id
where i.domain='supplier_price' and i.status='applied';

grant select on public.supplier_price_snapshot_rows to authenticated;

create or replace function public.set_supplier_price_link_scoped(
  p_project_id uuid,
  p_catalog_item_id uuid,
  p_supplier_item_id uuid,
  p_scope_key text
) returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_supplier_id uuid;
  v_old public.supplier_price_links%rowtype;
  v_target_owner public.supplier_price_links%rowtype;
  v_import_id uuid;
  v_scope text:=coalesce(p_scope_key,'');
begin
  if not private.can_edit_project(p_project_id) then raise exception 'Недостаточно прав'; end if;
  if not exists(
    select 1 from public.catalog_items
    where id=p_catalog_item_id and project_id=p_project_id and archived_at is null
  ) then
    raise exception 'Проектная номенклатура не найдена';
  end if;

  select * into v_old
  from public.supplier_price_links
  where project_id=p_project_id
    and catalog_item_id=p_catalog_item_id
    and scope_key=v_scope
  for update;

  if p_supplier_item_id is null then
    if v_old.id is not null then
      delete from public.supplier_price_links where id=v_old.id;
      insert into public.supplier_price_journal(
        project_id,import_id,catalog_item_id,supplier_item_id,event_type,before_value,after_value,link_method
      ) values(
        p_project_id,v_old.last_checked_import_id,p_catalog_item_id,v_old.supplier_item_id,'manual_link_removed',
        jsonb_build_object('supplier_item_id',v_old.supplier_item_id,'scope_key',v_scope),
        jsonb_build_object('scope_key',v_scope),'manual'
      );
      update public.supplier_items
      set catalog_item_id=null,link_method=null,link_state='unmatched',updated_at=now()
      where id=v_old.supplier_item_id;
    end if;
    return jsonb_build_object('status','removed','catalog_item_id',p_catalog_item_id,'scope_key',v_scope);
  end if;

  select supplier_id into v_supplier_id
  from public.supplier_items
  where id=p_supplier_item_id and project_id=p_project_id and archived_at is null;
  if v_supplier_id is null then raise exception 'Позиция поставщика не найдена'; end if;

  select * into v_target_owner
  from public.supplier_price_links
  where supplier_item_id=p_supplier_item_id
    and not (catalog_item_id=p_catalog_item_id and scope_key=v_scope)
  for update;

  select i.id into v_import_id
  from public.imports i
  join public.import_rows ir on ir.import_id=i.id
  join public.supplier_items si on si.source_import_row_id=ir.id
  where si.id=p_supplier_item_id
  order by i.imported_at desc
  limit 1;

  if v_target_owner.id is not null then
    if v_target_owner.link_method='manual' then
      raise exception 'Позиция поставщика уже вручную связана с другой строкой Рабочей сводки';
    end if;
    delete from public.supplier_price_links where id=v_target_owner.id;
    insert into public.supplier_price_journal(
      project_id,import_id,catalog_item_id,supplier_item_id,event_type,before_value,after_value,link_method
    ) values(
      p_project_id,v_import_id,v_target_owner.catalog_item_id,p_supplier_item_id,'manual_link_removed',
      jsonb_build_object('supplier_item_id',p_supplier_item_id,'scope_key',v_target_owner.scope_key,'previous_link_method',v_target_owner.link_method),
      jsonb_build_object('reassigned_to_catalog_item_id',p_catalog_item_id,'scope_key',v_scope),
      'manual'
    );
  end if;

  if v_old.id is null then
    insert into public.supplier_price_links(
      project_id,supplier_id,catalog_item_id,supplier_item_id,scope_key,
      link_method,validation_state,last_checked_import_id
    ) values(
      p_project_id,v_supplier_id,p_catalog_item_id,p_supplier_item_id,v_scope,
      'manual','confirmed',v_import_id
    );
    insert into public.supplier_price_journal(
      project_id,import_id,catalog_item_id,supplier_item_id,event_type,after_value,link_method
    ) values(
      p_project_id,v_import_id,p_catalog_item_id,p_supplier_item_id,'manual_link_created',
      jsonb_build_object('supplier_item_id',p_supplier_item_id,'scope_key',v_scope),'manual'
    );
  else
    if v_old.supplier_item_id<>p_supplier_item_id then
      update public.supplier_items
      set catalog_item_id=null,link_method=null,link_state='unmatched',updated_at=now()
      where id=v_old.supplier_item_id;
    end if;

    update public.supplier_price_links
    set supplier_id=v_supplier_id,
        supplier_item_id=p_supplier_item_id,
        scope_key=v_scope,
        link_method='manual',
        validation_state='confirmed',
        last_checked_import_id=v_import_id,
        confirmed_by=auth.uid(),
        updated_at=now()
    where id=v_old.id;

    insert into public.supplier_price_journal(
      project_id,import_id,catalog_item_id,supplier_item_id,event_type,before_value,after_value,link_method
    ) values(
      p_project_id,v_import_id,p_catalog_item_id,p_supplier_item_id,
      case when v_old.supplier_item_id=p_supplier_item_id then 'ambiguous_confirmed' else 'manual_link_changed' end,
      jsonb_build_object('supplier_item_id',v_old.supplier_item_id,'scope_key',v_old.scope_key),
      jsonb_build_object('supplier_item_id',p_supplier_item_id,'scope_key',v_scope),
      'manual'
    );
  end if;

  update public.supplier_items
  set catalog_item_id=p_catalog_item_id,link_method='manual',link_state='matched',updated_at=now()
  where id=p_supplier_item_id;

  return jsonb_build_object(
    'status','confirmed',
    'catalog_item_id',p_catalog_item_id,
    'supplier_item_id',p_supplier_item_id,
    'scope_key',v_scope
  );
end;
$$;

grant execute on function public.set_supplier_price_link_scoped(uuid,uuid,uuid,text) to authenticated;
