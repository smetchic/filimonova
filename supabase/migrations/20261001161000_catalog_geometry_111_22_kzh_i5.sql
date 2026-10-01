with src(mark,length_mm,height_mm,thickness_mm,source_page) as (
  values
    ('19-ПП2-2н',3580,6580,160,5),
    ('19-ПП2-3н',3580,6580,160,7),
    ('19-ПП3-1н',2980,4180,160,9),
    ('19-ПП4-3н',3280,3580,160,11),
    ('19-ПП6-1н',2980,6580,160,12),
    ('19-ПП7н',2980,2380,160,14),
    ('19-ПП7-1н',2980,2380,160,15),
    ('19-ПП11-1',1920,4880,160,16),
    ('19-ПП17-1н',3330,3580,160,17),
    ('19-ПП20',3400,4370,160,18),
    ('19-ПП21',3580,1990,160,19),
    ('19-ПП22',2800,3980,160,20),
    ('19-ПП23',1830,4790,160,21),
    ('19-ПП24',3700,1870,160,22)
)
update public.catalog_items ci
set length_mm=src.length_mm,
    height_mm=src.height_mm,
    thickness_mm=src.thickness_mm,
    area_m2=round(src.length_mm*src.height_mm/1000000.0,4),
    geometry_source='111-22-КЖ.И5',
    geometry_source_page=src.source_page,
    geometry_confidence='drawing-dimensions',
    geometry_updated_at=now()
from src
where ci.project_id='439a921e-51ea-4935-b136-8d7a3642e993'
  and ci.archived_at is null
  and ci.mark=src.mark;
