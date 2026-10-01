create or replace function public.set_avr_version_state(
  p_project_id uuid,
  p_version_id uuid,
  p_action text
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_document_id uuid;
  v_state text;
begin
  select document_id,state into v_document_id,v_state
  from avr_versions
  where id=p_version_id and project_id=p_project_id
  for update;

  if v_document_id is null then
    raise exception 'Версия АВР не найдена';
  end if;

  if p_action='use' then
    if exists(
      select 1 from avr_versions
      where document_id=v_document_id and state='signed'
    ) then
      raise exception 'Подписанный АВР уже является окончательным источником месяца';
    end if;

    update avr_versions
    set state='draft'
    where document_id=v_document_id and state='in_use';

    update avr_versions
    set state='in_use'
    where id=p_version_id;

  elsif p_action='sign' then
    if exists(
      select 1 from avr_versions
      where document_id=v_document_id and state='signed' and id<>p_version_id
    ) then
      raise exception 'Для месяца уже подписана другая версия АВР';
    end if;

    update avr_versions
    set state='draft'
    where document_id=v_document_id and state='in_use' and id<>p_version_id;

    update avr_versions
    set state='signed',
        signed_at=coalesce(signed_at,now()),
        signed_by=coalesce(signed_by,auth.uid())
    where id=p_version_id;

  elsif p_action='unsign' then
    if v_state<>'signed' then
      raise exception 'Отменить подписание можно только у подписанной версии АВР';
    end if;

    update avr_versions
    set state='draft'
    where document_id=v_document_id and state='in_use' and id<>p_version_id;

    update avr_versions
    set state='in_use',
        signed_at=null,
        signed_by=null
    where id=p_version_id;

  else
    raise exception 'Неизвестное действие с версией АВР';
  end if;

  return jsonb_build_object(
    'version_id',p_version_id,
    'state',(select state from avr_versions where id=p_version_id)
  );
end;
$$;

grant execute on function public.set_avr_version_state(uuid,uuid,text) to authenticated;
