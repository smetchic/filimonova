
drop policy if exists projects_insert_self on public.projects;

create policy projects_insert_admin
on public.projects
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.is_app_admin())
);
