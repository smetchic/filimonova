
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  job_title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function private.users_share_project(p_other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1
    from public.project_members mine
    join public.project_members other
      on other.project_id = mine.project_id
    where mine.user_id = (select auth.uid())
      and other.user_id = p_other_user_id
  );
$$;

create policy profiles_select_shared_project
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or (select private.users_share_project(id))
);

create policy profiles_update_self
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant update(full_name, job_title) on public.profiles to authenticated;
grant usage on schema private to authenticated;
grant execute on function private.users_share_project(uuid) to authenticated;

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
  return new;
end;
$$;

create or replace function private.sync_auth_user_email()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  update public.profiles
     set email = new.email,
         updated_at = now()
   where id = new.id;
  return new;
end;
$$;

create trigger trg_auth_user_profile_insert
after insert on auth.users
for each row execute function private.handle_new_auth_user();

create trigger trg_auth_user_profile_email_update
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute function private.sync_auth_user_email();

create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

insert into public.profiles(id,email,full_name)
select u.id,u.email,nullif(btrim(coalesce(u.raw_user_meta_data->>'full_name','')), '')
from auth.users u
on conflict(id) do nothing;

revoke execute on function private.handle_new_auth_user() from public,anon,authenticated;
revoke execute on function private.sync_auth_user_email() from public,anon,authenticated;
