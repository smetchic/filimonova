
create table public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null,
  note text
);

alter table public.app_admins enable row level security;

create policy app_admins_select_self
on public.app_admins
for select
to authenticated
using (user_id = (select auth.uid()));

grant select on public.app_admins to authenticated;
revoke insert, update, delete on public.app_admins from authenticated, anon;

create or replace function private.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1
    from public.app_admins a
    where a.user_id = (select auth.uid())
  );
$$;

grant usage on schema private to authenticated;
grant execute on function private.is_app_admin() to authenticated;

create or replace function private.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select
    (select private.is_app_admin())
    or (
      p_project_id is not null
      and exists(
        select 1
        from public.project_members pm
        where pm.project_id = p_project_id
          and pm.user_id = (select auth.uid())
      )
    );
$$;

create or replace function private.can_edit_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select
    (select private.is_app_admin())
    or (
      p_project_id is not null
      and exists(
        select 1
        from public.project_members pm
        where pm.project_id = p_project_id
          and pm.user_id = (select auth.uid())
          and pm.access_role in ('owner','editor')
      )
    );
$$;

create or replace function private.is_project_owner(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select
    (select private.is_app_admin())
    or (
      p_project_id is not null
      and exists(
        select 1
        from public.project_members pm
        where pm.project_id = p_project_id
          and pm.user_id = (select auth.uid())
          and pm.access_role = 'owner'
      )
    );
$$;

create or replace function private.users_share_project(p_other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select
    (select private.is_app_admin())
    or exists (
      select 1
      from public.project_members mine
      join public.project_members other
        on other.project_id = mine.project_id
      where mine.user_id = (select auth.uid())
        and other.user_id = p_other_user_id
    );
$$;
