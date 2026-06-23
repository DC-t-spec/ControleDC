-- Incremental migration: automatically bootstrap the first approved admin for XHUB.
-- Non-destructive: does not delete or rewrite existing profiles.

insert into public.companies (name, code)
values ('XHUB', 'XHUB-26')
on conflict (code) do update set
  name = excluded.name;

create or replace function public.get_default_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.companies
  where code = 'XHUB-26'
  limit 1
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_company_id uuid;
  should_bootstrap_admin boolean;
begin
  default_company_id := public.get_default_company_id();

  if default_company_id is null then
    raise exception 'Empresa padrão XHUB não encontrada.';
  end if;

  -- Serialize signup bootstrap decisions so two simultaneous first signups cannot
  -- both observe an empty admin set and become admins.
  perform pg_advisory_xact_lock(hashtext('public.handle_new_auth_user:XHUB:first_admin')::bigint);

  select not exists (
    select 1
    from public.profiles p
    where p.company_id = default_company_id
      and p.role = 'admin'
      and p.status = 'approved'
  ) into should_bootstrap_admin;

  insert into public.profiles (user_id, company_id, name, role, status)
  values (
    new.id,
    default_company_id,
    coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1), 'utilizador'),
    case when should_bootstrap_admin then 'admin' else 'user' end,
    case when should_bootstrap_admin then 'approved' else 'pending' end
  )
  on conflict (user_id) do update set
    company_id = coalesce(public.profiles.company_id, excluded.company_id),
    name = coalesce(nullif(public.profiles.name, ''), excluded.name);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();
