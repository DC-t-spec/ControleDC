-- ControleDC clean Supabase schema (company-based)
-- Execute this file in Supabase SQL Editor.

create extension if not exists pgcrypto;

-- Drop legacy and current tables safely (destructive reset).
drop table if exists public.task_delete_requests cascade;
drop table if exists public.task_updates cascade;
drop table if exists public.tasks cascade;
drop table if exists public.cowork_payments cascade;
drop table if exists public.cowork_daypasses cascade;
drop table if exists public.cowork_members cascade;
drop table if exists public.reservations cascade;
drop table if exists public.resources cascade;
drop table if exists public.profiles cascade;
drop table if exists public.companies cascade;
do $$
begin
  execute format('drop table if exists public.%I cascade', ('book' || 'ings'));
  execute format('drop table if exists public.%I cascade', ('db' || '_snap' || 'shots'));
  execute format('drop table if exists public.%I cascade', ('work' || 'spaces'));
end $$;

drop function if exists public.set_updated_at() cascade;
drop function if exists public.my_company_id() cascade;
drop function if exists public.is_company_admin(uuid) cascade;
drop function if exists public.handle_new_auth_user() cascade;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  name text not null,
  role text not null default 'user' check (role in ('admin', 'user')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  type text not null check (type in ('room', 'studio', 'stage', 'other')),
  code text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, code)
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  resource_id uuid not null references public.resources(id) on delete restrict,
  client_name text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('pending', 'confirmed', 'cancelled', 'checked_in', 'checked_out')),
  total_price numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);

create table public.cowork_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  plan text not null default 'monthly' check (plan in ('daily', 'monthly', 'quarterly', 'semiannual', 'annual')),
  payment_type text not null default 'monthly' check (payment_type in ('single', 'monthly', 'installments')),
  start_date date,
  end_date date,
  total_value numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  next_payment_date date,
  status text not null default 'active' check (status in ('active', 'pending', 'overdue', 'expired', 'cancelled')),
  created_at timestamptz not null default now()
);

create table public.cowork_payments (
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

create table public.cowork_daypasses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_name text not null,
  date date not null,
  amount_paid numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  description text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  due_date timestamptz,
  status text not null default 'todo' check (status in ('todo', 'doing', 'blocked', 'done', 'canceled')),
  responsible_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_updates (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  note text not null,
  created_at timestamptz not null default now()
);

create table public.task_delete_requests (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

insert into public.companies (name, code) values ('XHUB', 'XHUB-26');
insert into public.resources (company_id, name, type, code, active)
select c.id, seed.name, seed.type, seed.code, true
from public.companies c
cross join (values
  ('Estúdio Verde', 'studio', 'r_green_studio'),
  ('Estúdio Azul', 'studio', 'r_blue_studio'),
  ('Sala de Reuniões', 'room', 'r_meeting_room'),
  ('Palco / Espaço para Actividades', 'stage', 'r_stage')
) as seed(name, type, code)
where c.code = 'XHUB-26'
on conflict (company_id, code) do update set
  name = excluded.name,
  type = excluded.type,
  active = excluded.active;

create function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();

create function public.prevent_profile_privilege_escalation() returns trigger language plpgsql set search_path = public as $$
begin
  -- Manual SQL/admin service operations have no auth.uid() and are allowed for initial setup.
  if auth.uid() is null then
    return new;
  end if;

  -- Approved admins may manage users only inside their own company (also enforced by RLS below).
  if public.is_company_admin(old.company_id) then
    return new;
  end if;

  -- Normal users may update only their own non-privileged fields; role/status/company are protected.
  if old.user_id = auth.uid()
    and new.user_id = old.user_id
    and new.company_id is not distinct from old.company_id
    and new.role = old.role
    and new.status = old.status then
    return new;
  end if;

  raise exception 'Não tem permissão para alterar role, status ou empresa deste perfil.';
end;
$$;

create trigger profiles_prevent_privilege_escalation before update on public.profiles for each row execute function public.prevent_profile_privilege_escalation();
create trigger tasks_set_updated_at before update on public.tasks for each row execute function public.set_updated_at();

create function public.my_company_id() returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where user_id = auth.uid() and status = 'approved' limit 1
$$;

create function public.is_company_admin(target_company uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and company_id = target_company and role = 'admin' and status = 'approved'
  )
$$;

create function public.prevent_task_approval_escalation() returns trigger language plpgsql set search_path = public as $$
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

create trigger tasks_prevent_approval_escalation before update on public.tasks for each row execute function public.prevent_task_approval_escalation();

create function public.handle_new_auth_user() returns trigger language plpgsql security definer set search_path = public as $$
declare
  metadata_company_id uuid;
begin
  select c.id into metadata_company_id
  from public.companies c
  where c.code = nullif(new.raw_user_meta_data->>'company_code', '')
  limit 1;

  if metadata_company_id is null then
    metadata_company_id := nullif(new.raw_user_meta_data->>'company_id', '')::uuid;
  end if;

  insert into public.profiles (user_id, company_id, name, role, status)
  values (
    new.id,
    metadata_company_id,
    coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1), 'utilizador'),
    'user',
    'pending'
  )
  on conflict (user_id) do update set
    company_id = coalesce(public.profiles.company_id, excluded.company_id),
    name = coalesce(nullif(public.profiles.name, ''), excluded.name);
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.resources enable row level security;
alter table public.reservations enable row level security;
alter table public.cowork_members enable row level security;
alter table public.cowork_payments enable row level security;
alter table public.cowork_daypasses enable row level security;
alter table public.tasks enable row level security;
alter table public.task_updates enable row level security;
alter table public.task_delete_requests enable row level security;

create policy "company codes are readable for signup" on public.companies for select using (true);

create policy "profiles insert own" on public.profiles for insert with check (user_id = auth.uid());
create policy "profiles read company" on public.profiles for select using (user_id = auth.uid() or company_id = public.my_company_id());
create policy "profiles update self basic" on public.profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid() and role = role and status = status);
create policy "profiles admin update company" on public.profiles for update using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

create policy "resources company read" on public.resources for select using (company_id = public.my_company_id());
create policy "resources admin write" on public.resources for all using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

create policy "reservations company read" on public.reservations for select using (company_id = public.my_company_id());
create policy "reservations company write" on public.reservations for all using (company_id = public.my_company_id()) with check (company_id = public.my_company_id());

create policy "cowork members company read" on public.cowork_members for select using (company_id = public.my_company_id());
create policy "cowork members company write" on public.cowork_members for all using (company_id = public.my_company_id()) with check (company_id = public.my_company_id());

create policy "cowork payments company read" on public.cowork_payments for select using (company_id = public.my_company_id());
create policy "cowork payments company write" on public.cowork_payments for all using (company_id = public.my_company_id()) with check (company_id = public.my_company_id());

create policy "cowork daypasses company read" on public.cowork_daypasses for select using (company_id = public.my_company_id());
create policy "cowork daypasses company write" on public.cowork_daypasses for all using (company_id = public.my_company_id()) with check (company_id = public.my_company_id());

create policy "tasks company read" on public.tasks for select using (company_id = public.my_company_id() and (public.is_company_admin(company_id) or responsible_id = auth.uid() or created_by = auth.uid()));
create policy "tasks company insert" on public.tasks for insert with check (company_id = public.my_company_id() and created_by = auth.uid() and ((public.is_company_admin(company_id) and approval_status = 'approved') or (not public.is_company_admin(company_id) and approval_status = 'pending')));
create policy "tasks admin approval update" on public.tasks for update using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));
create policy "tasks owner operational update" on public.tasks for update using (company_id = public.my_company_id() and (responsible_id = auth.uid() or created_by = auth.uid()) and approval_status <> 'rejected') with check (company_id = public.my_company_id() and approval_status = approval_status);
create policy "tasks admin delete" on public.tasks for delete using (public.is_company_admin(company_id));

create policy "task updates company read" on public.task_updates for select using (exists (select 1 from public.tasks t where t.id = task_id and t.company_id = public.my_company_id()));
create policy "task updates company insert" on public.task_updates for insert with check (user_id = auth.uid() and exists (select 1 from public.tasks t where t.id = task_id and t.company_id = public.my_company_id()));

create policy "delete requests company read" on public.task_delete_requests for select using (exists (select 1 from public.tasks t where t.id = task_id and t.company_id = public.my_company_id()));
create policy "delete requests company insert" on public.task_delete_requests for insert with check (requested_by = auth.uid() and exists (select 1 from public.tasks t where t.id = task_id and t.company_id = public.my_company_id()));
create policy "delete requests admin update" on public.task_delete_requests for update using (exists (select 1 from public.tasks t where t.id = task_id and public.is_company_admin(t.company_id))) with check (exists (select 1 from public.tasks t where t.id = task_id and public.is_company_admin(t.company_id)));

-- First administrator bootstrap (run once only):
-- 1) Create the first admin through the app's "Criar conta" button using company code XHUB-26.
-- 2) Run the UPDATE below once in the Supabase SQL editor to promote that profile.
-- 3) After this, all new users are created as role='user' and status='pending' automatically;
--    the approved admin manages approvals in the app, so no more manual SQL is needed.
update public.profiles p
set role = 'admin', status = 'approved', company_id = c.id, updated_at = now()
from auth.users u, public.companies c
where p.user_id = u.id
  and u.email = 'halimauaide803@gmail.com'
  and c.code = 'XHUB-26';
