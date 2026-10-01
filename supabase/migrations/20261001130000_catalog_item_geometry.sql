
alter table public.catalog_items
  add column if not exists length_mm numeric,
  add column if not exists height_mm numeric,
  add column if not exists thickness_mm numeric,
  add column if not exists area_m2 numeric,
  add column if not exists geometry_source text,
  add column if not exists geometry_source_page integer,
  add column if not exists geometry_confidence text,
  add column if not exists geometry_updated_at timestamptz;

comment on column public.catalog_items.length_mm is 'Фактический габарит изделия по опалубочному чертежу, мм';
comment on column public.catalog_items.height_mm is 'Фактическая высота изделия по опалубочному чертежу, мм';
comment on column public.catalog_items.thickness_mm is 'Фактическая толщина изделия по опалубочному чертежу, мм';
comment on column public.catalog_items.area_m2 is 'Площадь фактического контура изделия по опалубочному чертежу, м2; используется для выбора расценки по площади';
comment on column public.catalog_items.geometry_source is 'Источник геометрии';
comment on column public.catalog_items.geometry_source_page is 'Страница источника геометрии';
comment on column public.catalog_items.geometry_confidence is 'Способ/качество извлечения геометрии';
