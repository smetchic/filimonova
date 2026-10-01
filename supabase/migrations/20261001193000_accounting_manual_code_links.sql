create or replace function public.set_accounting_code_link(
  p_project_id uuid,
  p_accounting_code text,
  p_catalog_item_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_code text:=nullif(trim(p_accounting_code),'');
begin
  if not private.can_edit_project(p_project_id) then
    raise exception 'Недостаточно прав';
  end if;
  if v_code is null then
    raise exception 'Код бухгалтерского материала не указан';
  end if;

  if p_catalog_item_id is null then
    delete from public.accounting_code_links
    where project_id=p_project_id and accounting_code=v_code;

    return jsonb_build_object(
      'accounting_code',v_code,
      'catalog_item_id',null,
      'link_method',null
    );
  end if;

  if not exists(
    select 1
    from public.catalog_items ci
    where ci.id=p_catalog_item_id
      and ci.project_id=p_project_id
      and ci.archived_at is null
  ) then
    raise exception 'Позиция проектной номенклатуры не найдена';
  end if;

  insert into public.accounting_code_links(
    project_id,accounting_code,catalog_item_id,link_method,note,created_by,updated_at
  )
  values(
    p_project_id,v_code,p_catalog_item_id,'manual',
    'Ручное сопоставление бухгалтерского кода с проектной номенклатурой',
    auth.uid(),now()
  )
  on conflict(project_id,accounting_code) do update
    set catalog_item_id=excluded.catalog_item_id,
        link_method='manual',
        note=excluded.note,
        created_by=auth.uid(),
        updated_at=now();

  return jsonb_build_object(
    'accounting_code',v_code,
    'catalog_item_id',p_catalog_item_id,
    'link_method','manual'
  );
end;
$$;

revoke all on function public.set_accounting_code_link(uuid,text,uuid) from public,anon;
grant execute on function public.set_accounting_code_link(uuid,text,uuid) to authenticated;
