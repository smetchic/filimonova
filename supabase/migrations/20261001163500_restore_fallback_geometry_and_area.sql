-- Preserve previously inferred geometry when no project drawing has refined the item.
-- Drawing-based geometry keeps priority because only rows with missing dimensions are backfilled.

with parsed as (
  select
    id,
    regexp_match(name, '([0-9]{1,3})\.([0-9]{1,2})\.([0-9]{1,2})') as m
  from public.catalog_items
  where project_id='439a921e-51ea-4935-b136-8d7a3642e993'
    and archived_at is null
    and (length_mm is null or height_mm is null or thickness_mm is null)
),
fallback as (
  select
    id,
    ((m)[1])::numeric * 100 as length_mm,
    ((m)[2])::numeric * 100 as height_mm,
    ((m)[3])::numeric * 10 as thickness_mm
  from parsed
  where m is not null
)
update public.catalog_items ci
set length_mm=f.length_mm,
    height_mm=f.height_mm,
    thickness_mm=f.thickness_mm,
    area_m2=round(f.length_mm*f.height_mm/1000000.0,4),
    geometry_source='designation-fallback',
    geometry_source_page=null,
    geometry_confidence='designation-fallback',
    geometry_updated_at=now()
from fallback f
where ci.id=f.id;

update public.catalog_items
set area_m2=round(length_mm*height_mm/1000000.0,4),
    geometry_updated_at=now()
where project_id='439a921e-51ea-4935-b136-8d7a3642e993'
  and archived_at is null
  and length_mm is not null
  and height_mm is not null
  and area_m2 is null;
