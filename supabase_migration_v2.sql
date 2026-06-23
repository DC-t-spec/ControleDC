-- ControleDC migration v2 (incremental, non-destructive)
-- Run this after the existing production schema. It only adds missing objects/data.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.cowork_members') is not null then
    alter table public.cowork_members add column if not exists payment_type text not null default 'monthly';
    alter table public.cowork_members add column if not exists start_date date;
    alter table public.cowork_members add column if not exists end_date date;
    alter table public.cowork_members add column if not exists total_value numeric(12,2) not null default 0;
    alter table public.cowork_members add column if not exists next_payment_date date;

    if not exists (select 1 from pg_constraint where conname = 'cowork_members_payment_type_check' and conrelid = 'public.cowork_members'::regclass) then
      alter table public.cowork_members add constraint cowork_members_payment_type_check check (payment_type in ('single', 'monthly', 'installments'));
    end if;
  end if;
end $$;

create table if not exists public.cowork_payments (
  id uuid primary key default gen_random_uuid(),
  cowork_member_id uuid not null references public.cowork_members(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  payment_date date not null default current_date,
  amount numeric(12,2) not null check (amount > 0),
  payment_method text,
  reference text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.tasks add column if not exists approval_status text not null default 'approved';
alter table public.tasks add column if not exists approved_by uuid references auth.users(id) on delete set null;
alter table public.tasks add column if not exists approved_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_approval_status_check' and conrelid = 'public.tasks'::regclass) then
    alter table public.tasks add constraint tasks_approval_status_check check (approval_status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

insert into public.resources (company_id, name, type, code, active)
select c.id, seed.name, seed.type, seed.code, true
from public.companies c
cross join (values
  ('Estúdio Verde', 'studio', 'r_green_studio'),
  ('Estúdio Azul', 'studio', 'r_blue_studio'),
  ('Sala de Reuniões', 'room', 'r_meeting_room'),
  ('Palco / Espaço para Actividades', 'stage', 'r_stage')
) as seed(name, type, code)
where not exists (
  select 1 from public.resources r where r.company_id = c.id and r.code = seed.code
);

create unique index if not exists resources_company_code_idx on public.resources(company_id, code);

create index if not exists cowork_payments_member_idx on public.cowork_payments(cowork_member_id);
create index if not exists cowork_payments_company_date_idx on public.cowork_payments(company_id, payment_date desc);
create index if not exists tasks_company_approval_idx on public.tasks(company_id, approval_status);

alter table public.cowork_payments enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cowork_payments' and policyname = 'cowork payments company read') then
    create policy "cowork payments company read" on public.cowork_payments for select using (company_id = public.my_company_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cowork_payments' and policyname = 'cowork payments company write') then
    create policy "cowork payments company write" on public.cowork_payments for all using (company_id = public.my_company_id()) with check (company_id = public.my_company_id());
  end if;
end $$;

create or replace function public.prevent_task_approval_escalation() returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if public.is_company_admin(old.company_id) then
    return new;
  end if;
  if new.approval_status is distinct from old.approval_status
    or new.approved_by is distinct from old.approved_by
    or new.approved_at is distinct from old.approved_at then
    raise exception 'Apenas administradores podem aprovar ou rejeitar actividades.';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_prevent_approval_escalation on public.tasks;
create trigger tasks_prevent_approval_escalation before update on public.tasks for each row execute function public.prevent_task_approval_escalation();
