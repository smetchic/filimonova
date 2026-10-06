
    alter table public.gpr_months
      add column if not exists monthly_index numeric(12,6) not null default 1.000000,
      add column if not exists is_in_period boolean not null default false;

    alter table public.gpr_months
      drop constraint if exists gpr_months_monthly_index_check;

    alter table public.gpr_months
      add constraint gpr_months_monthly_index_check check (monthly_index > 0);

    do $$
    declare
      p record;
      v_plan_id uuid;
      d date;
    begin
      for p in select id from public.projects loop
        select id into v_plan_id
        from public.gpr_plans
        where project_id=p.id and status='active'
        order by created_at
        limit 1;

        if v_plan_id is null then
          insert into public.gpr_plans(project_id,name,status,start_month,end_month)
          values(p.id,'Основной ГПР','active','2026-12-01','2027-11-01')
          returning id into v_plan_id;
        end if;

        d := date '2026-10-01';
        while d <= date '2028-03-01' loop
          insert into public.gpr_months(
            project_id,plan_id,month,monthly_index,execution_index,is_in_period
          )
          values(
            p.id,v_plan_id,d,1.000000,1.000000,
            d between date '2026-12-01' and date '2027-11-01'
          )
          on conflict (plan_id,month) do update
          set monthly_index=coalesce(public.gpr_months.monthly_index,1.000000),
              is_in_period=case
                when public.gpr_months.is_in_period is distinct from false
                  then public.gpr_months.is_in_period
                else excluded.is_in_period
              end;
          d := (d + interval '1 month')::date;
        end loop;
      end loop;
    end $$;
