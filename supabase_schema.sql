-- ControleDC clean Supabase schema (company-based)
-- Execute this file in Supabase SQL Editor.

create extension if not exists pgcrypto;

-- Drop legacy and current tables safely (destructive reset).
drop table if exists public.task_delete_requests cascade;
drop table if exists public.task_updates cascade;
drop table if exists public.tasks cascade;
drop table if exists public.cowork_daypasses cascade;
drop table if exists public.cowork_members cascade;
drop table if exists public.reservations cascade;
drop table if exists public.resources cascade;
drop table if exists public.profiles cascade;
drop table if exists public.workspaces cascade;
drop table if exists public.bookings cascade;
drop table if exists public.db_snapshots cascade;
drop table if exists public.companies cascade;

drop function if exists public.set_updated_at() cascade;
drop function if exists public.my_company_id() cascade;
drop function if exists public.is_company_admin(uuid) cascade;
drop function if exists public.handle_new_auth_user() cascade;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  active boolean not null default true,
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
  type text not null check (type in ('room', 'studio', 'cowork', 'other')),
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
  plan text not null default 'monthly',
  start_date date,
  end_date date,
  amount_paid numeric(12,2) not null default 0,
  status text not null default 'active' check (status in ('active', 'inactive', 'ended')),
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

insert into public.companies (name, code, active) values ('XHUB', 'XHUB-26', true);
insert into public.resources (company_id, name, type, code, active)
select id, 'Sala de Reuniões', 'room', 'r_meet', true from public.companies where code = 'XHUB-26'
union all
select id, 'Estúdio', 'studio', 'r_studio', true from public.companies where code = 'XHUB-26'
union all
select id, 'Cowork', 'cowork', 'r_cowork', true from public.companies where code = 'XHUB-26';

create function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
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

create function public.handle_new_auth_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, name, role, status)
  values (new.id, coalesce(split_part(new.email, '@', 1), 'utilizador'), 'user', 'pending')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.resources enable row level security;
alter table public.reservations enable row level security;
alter table public.cowork_members enable row level security;
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

create policy "cowork daypasses company read" on public.cowork_daypasses for select using (company_id = public.my_company_id());
create policy "cowork daypasses company write" on public.cowork_daypasses for all using (company_id = public.my_company_id()) with check (company_id = public.my_company_id());

create policy "tasks company read" on public.tasks for select using (company_id = public.my_company_id() and (public.is_company_admin(company_id) or responsible_id = auth.uid() or created_by = auth.uid()));
create policy "tasks company insert" on public.tasks for insert with check (company_id = public.my_company_id() and created_by = auth.uid());
create policy "tasks company update" on public.tasks for update using (company_id = public.my_company_id() and (public.is_company_admin(company_id) or responsible_id = auth.uid() or created_by = auth.uid())) with check (company_id = public.my_company_id());
create policy "tasks admin delete" on public.tasks for delete using (public.is_company_admin(company_id));

create policy "task updates company read" on public.task_updates for select using (exists (select 1 from public.tasks t where t.id = task_id and t.company_id = public.my_company_id()));
create policy "task updates company insert" on public.task_updates for insert with check (user_id = auth.uid() and exists (select 1 from public.tasks t where t.id = task_id and t.company_id = public.my_company_id()));

create policy "delete requests company read" on public.task_delete_requests for select using (exists (select 1 from public.tasks t where t.id = task_id and t.company_id = public.my_company_id()));
create policy "delete requests company insert" on public.task_delete_requests for insert with check (requested_by = auth.uid() and exists (select 1 from public.tasks t where t.id = task_id and t.company_id = public.my_company_id()));
create policy "delete requests admin update" on public.task_delete_requests for update using (exists (select 1 from public.tasks t where t.id = task_id and public.is_company_admin(t.company_id))) with check (exists (select 1 from public.tasks t where t.id = task_id and public.is_company_admin(t.company_id)));

-- Promote the first administrator after creating the auth user for this email.
update public.profiles p
set role = 'admin', status = 'approved', company_id = c.id, updated_at = now()
from auth.users u, public.companies c
where p.user_id = u.id
  and u.email = 'halimauaide803@gmail.com'
  and c.code = 'XHUB-26';
