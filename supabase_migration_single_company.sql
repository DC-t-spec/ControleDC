-- Incremental migration: simplify authentication to a single default company.
-- Keeps company_id for RLS and future multi-company organisation.

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
begin
  default_company_id := public.get_default_company_id();

  if default_company_id is null then
    raise exception 'Empresa padrão XHUB não encontrada.';
  end if;

  insert into public.profiles (user_id, company_id, name, role, status)
  values (
    new.id,
    default_company_id,
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();
