
create table if not exists private.admin_email_allowlist (
  email text primary key,
  note text,
  created_at timestamptz not null default now()
);

-- The live project uses the real administrator email; replace the placeholder when deploying a new copy.
insert into private.admin_email_allowlist(email,note)
values (lower('admin@example.com'),'Первичный глобальный администратор проекта «Филимонова»')
on conflict(email) do update set note=excluded.note;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.profiles(id,email,full_name)
  values(
    new.id,
    new.email,
    nullif(btrim(coalesce(new.raw_user_meta_data->>'full_name','')), '')
  )
  on conflict(id) do nothing;

  if new.email is not null and exists(
    select 1
    from private.admin_email_allowlist a
    where a.email = lower(new.email)
  ) then
    insert into public.app_admins(user_id,granted_by,note)
    values(new.id,new.id,'Автоматически назначен по списку первичных администраторов')
    on conflict(user_id) do nothing;
  end if;

  return new;
end;
$$;

revoke all on private.admin_email_allowlist from public,anon,authenticated;
revoke execute on function private.handle_new_auth_user() from public,anon,authenticated;

insert into public.app_admins(user_id,granted_by,note)
select u.id,u.id,'Назначен из списка первичных администраторов'
from auth.users u
join private.admin_email_allowlist a on a.email=lower(u.email)
on conflict(user_id) do nothing;
