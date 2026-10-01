create or replace function public.apply_accounting_import(
  p_project_id uuid,
  p_period_month date,
  p_source_name text,
  p_source_sha256 text,
  p_rows jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_import_id uuid;
  v_count integer;
begin
  if p_period_month is null or date_trunc('month',p_period_month)::date <> p_period_month then
    raise exception 'Период бухгалтерского отчёта должен быть первым числом месяца';
  end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then
    raise exception 'В бухгалтерском отчёте не найдены строки материалов';
  end if;

  insert into imports(project_id,domain,source_name,source_period,status,report,source_slot,applied_at)
  values(
    p_project_id,'accounting',p_source_name,p_period_month,'applied',
    jsonb_build_object('sha256',p_source_sha256,'rows',jsonb_array_length(p_rows)),
    to_char(p_period_month,'YYYY-MM'),now()
  )
  returning id into v_import_id;

  insert into import_rows(project_id,import_id,source_row_no,source_key,raw_data,normalized_data)
  select
    p_project_id,
    v_import_id,
    x.source_row_no,
    coalesce(x.raw_data->>'sheet','') || '#' || x.source_row_no::text,
    coalesce(x.raw_data,'{}'::jsonb),
    jsonb_build_object(
      'material_code',x.material_code,
      'name',x.name,
      'unit',x.unit,
      'quantity',x.quantity,
      'catalog_item_id',x.catalog_item_id,
      'catalog_match_reason',x.catalog_match_reason
    )
  from jsonb_to_recordset(p_rows) as x(
    source_row_no integer,
    material_code text,
    name text,
    unit text,
    quantity numeric,
    catalog_item_id uuid,
    catalog_match_reason text,
    raw_data jsonb
  );

  insert into accounting_rows(
    project_id,import_id,source_import_row_id,account_code,material_code,name,unit,quantity,unit_price,amount,source_row_no
  )
  select
    p_project_id,
    v_import_id,
    ir.id,
    x.account_code,
    x.material_code,
    x.name,
    x.unit,
    x.quantity,
    x.unit_price,
    x.amount,
    x.source_row_no
  from jsonb_to_recordset(p_rows) as x(
    source_row_no integer,
    account_code text,
    material_code text,
    name text,
    unit text,
    quantity numeric,
    unit_price numeric,
    amount numeric,
    raw_data jsonb,
    catalog_item_id uuid,
    catalog_match_reason text
  )
  join import_rows ir
    on ir.import_id=v_import_id
   and ir.source_key=coalesce(x.raw_data->>'sheet','') || '#' || x.source_row_no::text;
  get diagnostics v_count=row_count;

  insert into accounting_period_sources(project_id,period_month,import_id)
  values(p_project_id,p_period_month,v_import_id)
  on conflict(project_id,period_month) do update
    set import_id=excluded.import_id,
        selected_by=auth.uid(),
        selected_at=now();

  -- Automatic links are recalculated for the codes present in every import.
  -- Manual links are authoritative and are never overwritten or removed here.
  with source_codes as (
    select distinct nullif(trim(x.material_code),'') material_code
    from jsonb_to_recordset(p_rows) as x(material_code text)
    where nullif(trim(x.material_code),'') is not null
  )
  delete from accounting_code_links acl
  using source_codes sc
  where acl.project_id=p_project_id
    and acl.accounting_code=sc.material_code
    and acl.link_method='auto';

  with supplied as (
    select
      nullif(trim(x.material_code),'') material_code,
      x.catalog_item_id,
      max(nullif(trim(x.catalog_match_reason),'')) catalog_match_reason
    from jsonb_to_recordset(p_rows) as x(
      material_code text,
      catalog_item_id uuid,
      catalog_match_reason text
    )
    where nullif(trim(x.material_code),'') is not null
      and x.catalog_item_id is not null
    group by nullif(trim(x.material_code),''),x.catalog_item_id
  ), valid_codes as (
    select material_code
    from supplied
    group by material_code
    having count(distinct catalog_item_id)=1
  )
  insert into accounting_code_links(
    project_id,accounting_code,catalog_item_id,link_method,note
  )
  select
    p_project_id,
    s.material_code,
    s.catalog_item_id,
    'auto',
    coalesce(s.catalog_match_reason,'Автоматическое строгое сопоставление')
  from supplied s
  join valid_codes v using(material_code)
  on conflict(project_id,accounting_code) do update
    set catalog_item_id=excluded.catalog_item_id,
        link_method='auto',
        note=excluded.note,
        updated_at=now()
  where accounting_code_links.link_method<>'manual';

  return jsonb_build_object('import_id',v_import_id,'rows',v_count);
end;
$$;

revoke all on function public.apply_accounting_import(uuid,date,text,text,jsonb) from public,anon;
grant execute on function public.apply_accounting_import(uuid,date,text,text,jsonb) to authenticated;

-- Rebuild only previously automatic links with a conservative matcher.
-- Manual links, if any, stay untouched.
delete from public.accounting_code_links
where link_method='auto';

with source_names as (
  select ar.project_id,ar.material_code,min(ar.name) as source_name
  from public.accounting_rows ar
  where nullif(trim(ar.material_code),'') is not null
  group by ar.project_id,ar.material_code
  having count(distinct ar.name)=1
), src as (
  select
    s.project_id,
    s.material_code,
    s.source_name,
    position('(' in s.source_name)>0 as has_paren,
    case when position('(' in s.source_name)>0
      then coalesce(
        substring(s.source_name from '\((.*)\)'),
        substr(s.source_name,position('(' in s.source_name)+1)
      )
      else s.source_name
    end as inner_text,
    split_part(s.source_name,'(',1) as outer_text
  from source_names s
), catalog_base as (
  select
    ci.id,
    ci.project_id,
    ci.mark,
    ci.name,
    translate(replace(private.norm_accounting_match(ci.name),'ё','е'),'oо0','000') as name_visual,
    private.norm_accounting_match(ci.mark) as mark_norm,
    trim(both '|' from regexp_replace(ci.name,'[^0-9]+','|','g')) as number_key
  from public.catalog_items ci
  where ci.archived_at is null
    and exists(
      select 1 from public.specification_rows sr
      where sr.catalog_item_id=ci.id and sr.archived_at is null
    )
), catalog as (
  select
    c.*,
    count(*) over(partition by c.project_id,c.mark_norm) as mark_count
  from catalog_base c
), source_norm as (
  select
    s.*,
    translate(replace(private.norm_accounting_match(s.inner_text),'ё','е'),'oо0','000') as inner_visual,
    translate(replace(private.norm_accounting_match(s.source_name),'ё','е'),'oо0','000') as full_visual,
    private.norm_accounting_match(s.outer_text) as outer_norm,
    trim(both '|' from regexp_replace(s.inner_text,'[^0-9]+','|','g')) as number_key
  from src s
), candidates as (
  select
    s.project_id,
    s.material_code,
    c.id as catalog_item_id,
    case
      when s.inner_visual=c.name_visual then
        100 + case when right(s.outer_norm,length(c.mark_norm))=c.mark_norm then 20 else 0 end
      when not s.has_paren
       and length(c.name_visual)>=4
       and right(s.full_visual,length(c.name_visual))=c.name_visual then
        90 + case when right(s.outer_norm,length(c.mark_norm))=c.mark_norm then 20 else 0 end
      when right(s.outer_norm,length(c.mark_norm))=c.mark_norm
       and c.mark_count=1
       and s.number_key<>''
       and s.number_key=c.number_key then 60
      else 0
    end as score,
    case
      when s.inner_visual=c.name_visual
       and right(s.outer_norm,length(c.mark_norm))=c.mark_norm
        then 'Марка + точное обозначение'
      when s.inner_visual=c.name_visual
        then 'Точное обозначение'
      when not s.has_paren
       and length(c.name_visual)>=4
       and right(s.full_visual,length(c.name_visual))=c.name_visual
        then 'Номенклатура в тексте отчёта'
      when right(s.outer_norm,length(c.mark_norm))=c.mark_norm
       and c.mark_count=1
       and s.number_key<>''
       and s.number_key=c.number_key
        then 'Марка + числовое обозначение'
      else null
    end as reason
  from source_norm s
  join catalog c on c.project_id=s.project_id
  where s.inner_visual=c.name_visual
     or (
       not s.has_paren
       and length(c.name_visual)>=4
       and right(s.full_visual,length(c.name_visual))=c.name_visual
     )
     or (
       right(s.outer_norm,length(c.mark_norm))=c.mark_norm
       and c.mark_count=1
       and s.number_key<>''
       and s.number_key=c.number_key
     )
), ranked as (
  select c.*,max(c.score) over(partition by c.project_id,c.material_code) best_score
  from candidates c
  where c.score>0
), top_candidates as (
  select r.*,
         count(*) over(partition by r.project_id,r.material_code,r.score) as tie_count
  from ranked r
  where r.score=r.best_score
)
insert into public.accounting_code_links(
  project_id,accounting_code,catalog_item_id,link_method,note
)
select
  t.project_id,
  t.material_code,
  t.catalog_item_id,
  'auto',
  t.reason
from top_candidates t
where t.tie_count=1
on conflict(project_id,accounting_code) do nothing;
