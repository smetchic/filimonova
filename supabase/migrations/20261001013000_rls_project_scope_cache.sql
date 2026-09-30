create or replace function private.current_readable_project_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.projects p
  where exists (
    select 1 from public.app_admins a
    where a.user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.project_members pm
    where pm.project_id = p.id
      and pm.user_id = (select auth.uid())
  );
$$;

create or replace function private.current_editable_project_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.projects p
  where exists (
    select 1 from public.app_admins a
    where a.user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.project_members pm
    where pm.project_id = p.id
      and pm.user_id = (select auth.uid())
      and pm.access_role in ('owner','editor')
  );
$$;

revoke execute on function private.current_readable_project_ids() from public, anon;
revoke execute on function private.current_editable_project_ids() from public, anon;
grant execute on function private.current_readable_project_ids() to authenticated;
grant execute on function private.current_editable_project_ids() to authenticated;

do $$
declare
  p record;
begin
  for p in
    select pol.tablename,pol.policyname,pol.cmd
    from pg_policies pol
    where pol.schemaname='public'
      and exists (
        select 1 from information_schema.columns c
        where c.table_schema='public'
          and c.table_name=pol.tablename
          and c.column_name='project_id'
      )
      and pol.tablename <> 'project_members'
      and (
        coalesce(pol.qual,'') like '%private.is_project_member%'
        or coalesce(pol.with_check,'') like '%private.is_project_member%'
        or coalesce(pol.qual,'') like '%private.can_edit_project%'
        or coalesce(pol.with_check,'') like '%private.can_edit_project%'
      )
  loop
    if p.cmd='SELECT' then
      execute format(
        'alter policy %I on public.%I using (project_id in (select private.current_readable_project_ids()))',
        p.policyname,p.tablename
      );
    elsif p.cmd='INSERT' then
      execute format(
        'alter policy %I on public.%I with check (project_id in (select private.current_editable_project_ids()))',
        p.policyname,p.tablename
      );
    elsif p.cmd='UPDATE' then
      execute format(
        'alter policy %I on public.%I using (project_id in (select private.current_editable_project_ids())) with check (project_id in (select private.current_editable_project_ids()))',
        p.policyname,p.tablename
      );
    elsif p.cmd='DELETE' then
      execute format(
        'alter policy %I on public.%I using (project_id in (select private.current_editable_project_ids()))',
        p.policyname,p.tablename
      );
    end if;
  end loop;
end
$$;
