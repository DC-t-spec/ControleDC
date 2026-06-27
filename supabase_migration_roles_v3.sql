-- ControleDC roles and reservations fix v3 (incremental, non destructive)
-- Execute after the existing schema/migrations.

begin;

-- 1) Accept the new manager role while preserving existing data.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'manager', 'user'));

-- 2) Role helpers used by RLS and triggers.
create or replace function public.has_company_role(target_company uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.company_id = target_company
      and p.role = any(allowed_roles)
      and p.status = 'approved'
  )
$$;

create or replace function public.is_company_admin(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_company_role(target_company, array['admin'])
$$;

create or replace function public.is_company_manager_or_admin(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_company_role(target_company, array['admin','manager'])
$$;

-- 3) Reservations: keep company-wide visibility, but only admin/manager can write.
--    Also validate company_id/resource_id and active resources in the write policy.
drop policy if exists "reservations company write" on public.reservations;
drop policy if exists "reservations admin manager insert" on public.reservations;
drop policy if exists "reservations admin manager update" on public.reservations;
drop policy if exists "reservations admin delete" on public.reservations;

create policy "reservations admin manager insert" on public.reservations
for insert
with check (
  public.is_company_manager_or_admin(company_id)
  and exists (
    select 1 from public.resources r
    where r.id = resource_id
      and r.company_id = reservations.company_id
      and r.active = true
  )
);

create policy "reservations admin manager update" on public.reservations
for update
using (public.is_company_manager_or_admin(company_id))
with check (
  public.is_company_manager_or_admin(company_id)
  and exists (
    select 1 from public.resources r
    where r.id = resource_id
      and r.company_id = reservations.company_id
      and r.active = true
  )
);

create policy "reservations admin delete" on public.reservations
for delete
using (public.is_company_admin(company_id));

-- 4) Resources: managers can read active company resources needed by reservation forms;
--    only admins keep write access.
drop policy if exists "resources company read" on public.resources;
create policy "resources company read" on public.resources
for select
using (company_id = public.my_company_id() and (active = true or public.is_company_admin(company_id)));

-- 5) Cowork and finance-related data: admin/manager only at RLS level.
drop policy if exists "cowork members company read" on public.cowork_members;
drop policy if exists "cowork payments company read" on public.cowork_payments;
drop policy if exists "cowork daypasses company read" on public.cowork_daypasses;
drop policy if exists "cowork members company write" on public.cowork_members;
drop policy if exists "cowork payments company write" on public.cowork_payments;
drop policy if exists "cowork daypasses company write" on public.cowork_daypasses;

create policy "cowork members admin manager read" on public.cowork_members
for select using (public.is_company_manager_or_admin(company_id));
create policy "cowork members admin manager write" on public.cowork_members
for all using (public.is_company_manager_or_admin(company_id)) with check (public.is_company_manager_or_admin(company_id));

create policy "cowork payments admin manager read" on public.cowork_payments
for select using (public.is_company_manager_or_admin(company_id));
create policy "cowork payments admin manager write" on public.cowork_payments
for all using (public.is_company_manager_or_admin(company_id)) with check (public.is_company_manager_or_admin(company_id));

create policy "cowork daypasses admin manager read" on public.cowork_daypasses
for select using (public.is_company_manager_or_admin(company_id));
create policy "cowork daypasses admin manager write" on public.cowork_daypasses
for all using (public.is_company_manager_or_admin(company_id)) with check (public.is_company_manager_or_admin(company_id));

-- 6) Activities: admins and managers see company activity agenda; users see only own.
--    Admin approves; manager/user create activities pending approval.
drop policy if exists "tasks company read" on public.tasks;
drop policy if exists "tasks company insert" on public.tasks;
drop policy if exists "tasks admin approval update" on public.tasks;
drop policy if exists "tasks owner operational update" on public.tasks;
drop policy if exists "tasks admin delete" on public.tasks;

create policy "tasks role based read" on public.tasks
for select
using (
  company_id = public.my_company_id()
  and (public.is_company_manager_or_admin(company_id) or responsible_id = auth.uid() or created_by = auth.uid())
);

create policy "tasks role based insert" on public.tasks
for insert
with check (
  company_id = public.my_company_id()
  and created_by = auth.uid()
  and (
    (public.is_company_admin(company_id) and approval_status = 'approved')
    or (not public.is_company_admin(company_id) and approval_status = 'pending')
  )
);

create policy "tasks admin approval update" on public.tasks
for update using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

create policy "tasks owner manager operational update" on public.tasks
for update
using (
  company_id = public.my_company_id()
  and approval_status <> 'rejected'
  and (public.is_company_manager_or_admin(company_id) or responsible_id = auth.uid() or created_by = auth.uid())
)
with check (company_id = public.my_company_id());

create policy "tasks admin delete" on public.tasks
for delete using (public.is_company_admin(company_id));

commit;
