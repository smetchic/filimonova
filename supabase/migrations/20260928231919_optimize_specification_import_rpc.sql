
create index if not exists ix_spec_rows_slot_identity_active
  on public.specification_rows(
    project_id,
    (source_original->>'source_slot'),
    (source_original->>'source_identity')
  )
  where archived_at is null;

create index if not exists ix_spec_rows_source_import_active
  on public.specification_rows(project_id, source_import_id)
  where archived_at is null;

alter function public.apply_specification_slot_import(uuid,text,text,text,jsonb)
  security definer;

alter function public.apply_specification_slot_import(uuid,text,text,text,jsonb)
  set search_path = public, private, pg_temp;

alter function public.apply_specification_stairs_import(uuid,text,text,jsonb)
  security definer;

alter function public.apply_specification_stairs_import(uuid,text,text,jsonb)
  set search_path = public, private, pg_temp;

revoke all on function public.apply_specification_slot_import(uuid,text,text,text,jsonb) from public;
grant execute on function public.apply_specification_slot_import(uuid,text,text,text,jsonb) to authenticated;

revoke all on function public.apply_specification_stairs_import(uuid,text,text,jsonb) from public;
grant execute on function public.apply_specification_stairs_import(uuid,text,text,jsonb) to authenticated;
