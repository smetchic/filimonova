
create or replace function public.refresh_estimate_reconciliation(p_estimate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_project_id uuid;
  v_building_section text;
  v_zone text;
  v_is_stairs boolean;
  v_auto_links integer := 0;
  v_resolved integer := 0;
  v_unlinked integer := 0;
begin
  select project_id,building_section,zone,is_stairs
    into v_project_id,v_building_section,v_zone,v_is_stairs
  from public.estimates
  where id=p_estimate_id;

  if v_project_id is null then raise exception 'Смета не найдена'; end if;
  if not private.can_edit_project(v_project_id) then raise exception 'Недостаточно прав'; end if;

  delete from public.reconciliation_links rl
  using public.estimate_rows er
  where er.id=rl.estimate_row_id
    and er.estimate_id=p_estimate_id
    and rl.link_method='auto';

  with material_rows as (
    select
      er.id,
      er.section_id,
      private.norm_match_text(er.basis) as basis_norm,
      private.norm_match_text(er.name) as name_norm
    from public.estimate_rows er
    where er.estimate_id=p_estimate_id
      and er.archived_at is null
      and er.row_type='material'
      and not exists (
        select 1 from public.reconciliation_links ml
        where ml.estimate_row_id=er.id and ml.link_method='manual'
      )
  ),
  scope_sections as (
    select
      ss.id,
      private.norm_match_text(ss.name) as section_norm
    from public.specification_sections ss
    where ss.project_id=v_project_id
      and ss.is_stairs=v_is_stairs
      and (
        v_is_stairs
        or (
          (v_building_section is null or ss.building_section=v_building_section)
          and (v_zone is null or ss.zone=v_zone)
        )
      )
  ),
  estimate_section_norm as (
    select es.id,private.norm_match_text(es.title) as section_norm
    from public.estimate_sections es
    where es.estimate_id=p_estimate_id
  ),
  section_match as (
    select
      esn.id as estimate_section_id,
      count(ss.id) as match_count,
      case when count(ss.id)=1 then min(ss.id::text)::uuid else null end as spec_section_id
    from estimate_section_norm esn
    left join scope_sections ss on ss.section_norm=esn.section_norm
    group by esn.id
  ),
  scoped_catalog as (
    select distinct
      sr.catalog_item_id,
      sr.section_id,
      private.norm_match_text(ci.mark) as mark_norm,
      private.norm_match_text(ci.name) as name_norm
    from public.specification_rows sr
    join scope_sections ss on ss.id=sr.section_id
    join public.catalog_items ci on ci.id=sr.catalog_item_id
    where sr.project_id=v_project_id
      and sr.archived_at is null
  ),
  basis_candidates as (
    select
      mr.id,
      count(distinct sc.catalog_item_id) as cnt,
      min(sc.catalog_item_id::text)::uuid as catalog_id
    from material_rows mr
    left join section_match sm on sm.estimate_section_id=mr.section_id
    join scoped_catalog sc
      on sc.mark_norm=mr.basis_norm
     and (coalesce(sm.match_count,0)<>1 or sc.section_id=sm.spec_section_id)
    group by mr.id
  ),
  name_candidates as (
    select
      mr.id,
      count(distinct sc.catalog_item_id) as cnt,
      min(sc.catalog_item_id::text)::uuid as catalog_id
    from material_rows mr
    left join section_match sm on sm.estimate_section_id=mr.section_id
    join scoped_catalog sc
      on sc.name_norm=mr.name_norm
     and (coalesce(sm.match_count,0)<>1 or sc.section_id=sm.spec_section_id)
    group by mr.id
  ),
  resolved as (
    select
      mr.id,
      case
        when coalesce(bc.cnt,0)=1 then bc.catalog_id
        when coalesce(nc.cnt,0)=1 then nc.catalog_id
        else null
      end as catalog_id
    from material_rows mr
    left join basis_candidates bc on bc.id=mr.id
    left join name_candidates nc on nc.id=mr.id
  ),
  upd as (
    update public.estimate_rows er
    set catalog_item_id=r.catalog_id,updated_at=now()
    from resolved r
    where er.id=r.id
      and r.catalog_id is not null
    returning er.id
  )
  select count(*) into v_resolved from upd;

  with material_rows as (
    select er.id,er.section_id,er.catalog_item_id
    from public.estimate_rows er
    where er.estimate_id=p_estimate_id
      and er.archived_at is null
      and er.row_type='material'
      and er.catalog_item_id is not null
      and not exists (
        select 1 from public.reconciliation_links ml
        where ml.estimate_row_id=er.id and ml.link_method='manual'
      )
  ),
  scope_sections as (
    select ss.id,private.norm_match_text(ss.name) as section_norm
    from public.specification_sections ss
    where ss.project_id=v_project_id
      and ss.is_stairs=v_is_stairs
      and (
        v_is_stairs
        or (
          (v_building_section is null or ss.building_section=v_building_section)
          and (v_zone is null or ss.zone=v_zone)
        )
      )
  ),
  estimate_section_norm as (
    select es.id,private.norm_match_text(es.title) as section_norm
    from public.estimate_sections es
    where es.estimate_id=p_estimate_id
  ),
  section_match as (
    select
      esn.id as estimate_section_id,
      count(ss.id) as match_count,
      case when count(ss.id)=1 then min(ss.id::text)::uuid else null end as spec_section_id
    from estimate_section_norm esn
    left join scope_sections ss on ss.section_norm=esn.section_norm
    group by esn.id
  ),
  counted as (
    select
      mr.*,
      sm.match_count,
      sm.spec_section_id,
      count(*) over(
        partition by mr.catalog_item_id,
        case when coalesce(sm.match_count,0)=1 then mr.section_id else null end
      ) as same_catalog_rows
    from material_rows mr
    left join section_match sm on sm.estimate_section_id=mr.section_id
  ),
  eligible as (
    select * from counted where same_catalog_rows=1
  ),
  ins as (
    insert into public.reconciliation_links(
      project_id,estimate_row_id,specification_row_id,link_method,origin_mode
    )
    select
      v_project_id,
      el.id,
      sr.id,
      'auto',
      case when coalesce(el.match_count,0)=1 then 'exact_block' else 'exact_scope' end
    from eligible el
    join public.specification_rows sr
      on sr.project_id=v_project_id
     and sr.catalog_item_id=el.catalog_item_id
     and sr.archived_at is null
    join scope_sections ss on ss.id=sr.section_id
    where (coalesce(el.match_count,0)<>1 or sr.section_id=el.spec_section_id)
      and not exists (
        select 1
        from public.reconciliation_links claimed
        where claimed.specification_row_id=sr.id
          and claimed.estimate_row_id<>el.id
      )
    on conflict(estimate_row_id,specification_row_id) do nothing
    returning id
  )
  select count(*) into v_auto_links from ins;

  select count(*) into v_unlinked
  from public.estimate_rows er
  where er.estimate_id=p_estimate_id
    and er.archived_at is null
    and er.row_type='material'
    and not exists (
      select 1 from public.reconciliation_links rl where rl.estimate_row_id=er.id
    );

  return jsonb_build_object(
    'resolved_catalog_rows',v_resolved,
    'auto_links_created',v_auto_links,
    'unlinked_material_rows',v_unlinked
  );
end;
$$;
