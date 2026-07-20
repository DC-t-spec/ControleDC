-- ControleDC finance hardening migration (incremental, non-destructive)
-- Do not run this file more broadly than intended; it preserves existing production data.

create extension if not exists pgcrypto;

-- Ensure XHUB exists without changing existing companies.
insert into public.companies (name, code)
values ('XHUB', 'XHUB-26')
on conflict (code) do update set name = coalesce(nullif(public.companies.name, ''), excluded.name);

-- Helpers used by RLS policies. SECURITY DEFINER avoids recursive profiles RLS lookups.
create or replace function public.my_company_id() returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where user_id = auth.uid() and status = 'approved' limit 1
$$;

create or replace function public.has_company_role(target_company uuid, allowed_roles text[]) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid()
      and company_id = target_company
      and role = any(allowed_roles)
      and status = 'approved'
  )
$$;

create or replace function public.is_company_admin(target_company uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.has_company_role(target_company, array['admin'])
$$;

create or replace function public.is_company_manager_or_admin(target_company uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.has_company_role(target_company, array['admin','manager'])
$$;

-- Additive cowork member finance fields only.
do $$
begin
  if to_regclass('public.cowork_members') is not null then
    alter table public.cowork_members add column if not exists payment_type text not null default 'monthly';
    alter table public.cowork_members add column if not exists start_date date;
    alter table public.cowork_members add column if not exists end_date date;
    alter table public.cowork_members add column if not exists total_value numeric(12,2) not null default 0;
    alter table public.cowork_members add column if not exists next_payment_date date;

    update public.cowork_members set status = 'cancelled' where status = 'inactive';
    update public.cowork_members set status = 'expired' where status = 'ended';

    if exists (select 1 from pg_constraint where conname = 'cowork_members_status_check' and conrelid = 'public.cowork_members'::regclass) then
      alter table public.cowork_members drop constraint cowork_members_status_check;
    end if;

    if not exists (select 1 from pg_constraint where conname = 'cowork_members_status_check' and conrelid = 'public.cowork_members'::regclass) then
      alter table public.cowork_members add constraint cowork_members_status_check check (status in ('active', 'pending', 'overdue', 'expired', 'cancelled'));
    end if;

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

create table if not exists public.reservation_payments (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  payment_date date not null default current_date,
  amount numeric(12,2) not null check (amount > 0),
  payment_method text,
  reference text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.cowork_daypasses add column if not exists payment_method text;
alter table public.cowork_daypasses add column if not exists reference text;
alter table public.cowork_daypasses add column if not exists notes text;
alter table public.cowork_daypasses add column if not exists created_by uuid references auth.users(id) on delete set null;

create unique index if not exists cowork_payments_company_reference_uidx on public.cowork_payments(company_id, reference) where reference is not null and reference <> '';
create index if not exists cowork_payments_member_idx on public.cowork_payments(cowork_member_id);
create index if not exists cowork_payments_company_date_idx on public.cowork_payments(company_id, payment_date desc);
create index if not exists reservation_payments_reservation_idx on public.reservation_payments(reservation_id);
create index if not exists reservation_payments_company_date_idx on public.reservation_payments(company_id, payment_date desc);
create index if not exists cowork_daypasses_company_date_idx on public.cowork_daypasses(company_id, date desc);

-- Deterministic, duplicate-safe BRIMAR historical contract/payment backfill.
do $$
declare
  xhub_id uuid;
  brimar_member_id uuid;
begin
  select id into xhub_id from public.companies where code = 'XHUB-26' limit 1;
  if xhub_id is null then
    raise exception 'Empresa XHUB-26 não encontrada.';
  end if;

  select id into brimar_member_id
  from public.cowork_members
  where company_id = xhub_id and upper(name) = 'BRIMAR SERVICE'
  order by created_at nulls last, id
  limit 1;

  if brimar_member_id is null then
    insert into public.cowork_members (company_id, name, plan, payment_type, total_value, amount_paid, status)
    values (xhub_id, 'BRIMAR SERVICE', 'annual', 'installments', 75000, 0, 'active')
    returning id into brimar_member_id;
  else
    update public.cowork_members
    set total_value = case when coalesce(total_value, 0) < 75000 then 75000 else total_value end,
        payment_type = coalesce(payment_type, 'installments')
    where id = brimar_member_id;
  end if;

  insert into public.cowork_payments (cowork_member_id, company_id, payment_date, amount, payment_method, reference, notes)
  select brimar_member_id, xhub_id, date '2026-01-01', 12500, 'historical', 'BRIMAR-SERVICE-75000-12500-HISTORIC-001', 'Backfill histórico: 12.500 MT de contrato total de 75.000 MT.'
  where not exists (
    select 1 from public.cowork_payments
    where company_id = xhub_id and reference = 'BRIMAR-SERVICE-75000-12500-HISTORIC-001'
  );
end $$;

alter table public.profiles enable row level security;
alter table public.cowork_payments enable row level security;
alter table public.reservation_payments enable row level security;
alter table public.cowork_daypasses enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles read own or company approved') then
    create policy "profiles read own or company approved" on public.profiles for select using (user_id = auth.uid() or company_id = public.my_company_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles insert own xhub') then
    create policy "profiles insert own xhub" on public.profiles for insert with check (user_id = auth.uid() and company_id = (select id from public.companies where code = 'XHUB-26'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles update self basic') then
    create policy "profiles update self basic" on public.profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles xhub admin manage') then
    create policy "profiles xhub admin manage" on public.profiles for all using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cowork_payments' and policyname = 'cowork payments admin manager read') then
    create policy "cowork payments admin manager read" on public.cowork_payments for select using (public.is_company_manager_or_admin(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cowork_payments' and policyname = 'cowork payments admin manager write') then
    create policy "cowork payments admin manager write" on public.cowork_payments for all using (public.is_company_manager_or_admin(company_id)) with check (public.is_company_manager_or_admin(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reservation_payments' and policyname = 'reservation payments admin manager read') then
    create policy "reservation payments admin manager read" on public.reservation_payments for select using (public.is_company_manager_or_admin(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reservation_payments' and policyname = 'reservation payments admin manager write') then
    create policy "reservation payments admin manager write" on public.reservation_payments for all using (public.is_company_manager_or_admin(company_id)) with check (public.is_company_manager_or_admin(company_id));
  end if;
end $$;
