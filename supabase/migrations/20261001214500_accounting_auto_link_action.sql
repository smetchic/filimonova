create or replace function public.apply_accounting_auto_links(
  p_project_id uuid,
  p_links jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_inserted integer:=0;
  v_removed integer:=0;
begin
  if not private.can_edit_project(p_project_id) then
    raise exception 'Недостаточно прав';
  end if;

  if p_links is null or jsonb_typeof(p_links)<>'array' then
    raise exception 'Некорректный набор автоматических связей';
  end if;

  delete from public.accounting_code_links
  where project_id=p_project_id
    and link_method='auto';
  get diagnostics v_removed=row_count;

  with supplied as (
    select distinct
      nullif(trim(x.accounting_code),'') accounting_code,
      x.catalog_item_id,
      coalesce(nullif(trim(x.note),''),'Автоматическое строгое сопоставление') note
    from jsonb_to_recordset(p_links) as x(
      accounting_code text,
      catalog_item_id uuid,
      note text
    )
    where nullif(trim(x.accounting_code),'') is not null
      and x.catalog_item_id is not null
  ), valid as (
    select s.*
    from supplied s
    join public.catalog_items ci
      on ci.id=s.catalog_item_id
     and ci.project_id=p_project_id
     and ci.archived_at is null
    where not exists(
      select 1
      from public.accounting_code_links m
      where m.project_id=p_project_id
        and m.accounting_code=s.accounting_code
        and m.link_method='manual'
    )
  )
  insert into public.accounting_code_links(
    project_id,accounting_code,catalog_item_id,link_method,note,updated_at
  )
  select
    p_project_id,v.accounting_code,v.catalog_item_id,'auto',v.note,now()
  from valid v
  on conflict(project_id,accounting_code) do nothing;
  get diagnostics v_inserted=row_count;

  return jsonb_build_object(
    'removed_auto',v_removed,
    'inserted_auto',v_inserted
  );
end;
$$;

revoke all on function public.apply_accounting_auto_links(uuid,jsonb) from public,anon;
grant execute on function public.apply_accounting_auto_links(uuid,jsonb) to authenticated;
