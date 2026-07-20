# Plano de hardening financeiro

> Não executar migrações na Supabase a partir deste PR. As queries abaixo são para revisão e execução manual/controlada antes e depois de `supabase_migration_finance_hardening.sql`.

## Garantias da migração

- A migração é incremental e não contém `DROP TABLE`, `TRUNCATE`, `DELETE` de dados existentes nem recriação de tabelas.
- Dados existentes de empresas, perfis, recursos, reservas, membros cowork, daypasses, tarefas e pagamentos são preservados.
- Estados legados de `cowork_members.status` são normalizados de forma idempotente antes da nova constraint: `inactive -> cancelled` e `ended -> expired`.
- O backfill da BRIMAR SERVICE usa a referência determinística `BRIMAR-SERVICE-75000-12500-HISTORIC-001` com `NOT EXISTS`, registando exactamente uma vez o pagamento histórico de 12.500 MT para contrato total de 75.000 MT.
- `profiles` mantém leitura do próprio perfil, inserção para signup em XHUB (`XHUB-26`) e gestão por administradores aprovados da empresa.

## Verificações antes da migração

```sql
-- Contagens base por tabela crítica
select 'companies' as table_name, count(*) from public.companies
union all select 'profiles', count(*) from public.profiles
union all select 'resources', count(*) from public.resources
union all select 'reservations', count(*) from public.reservations
union all select 'cowork_members', count(*) from public.cowork_members
union all select 'cowork_daypasses', count(*) from public.cowork_daypasses
union all select 'tasks', count(*) from public.tasks
union all select 'cowork_payments', count(*) from public.cowork_payments;

-- Perfis aprovados, incluindo administradores XHUB
select c.code, p.role, p.status, count(*)
from public.profiles p
left join public.companies c on c.id = p.company_id
group by c.code, p.role, p.status
order by c.code, p.role, p.status;

-- Estados antigos e novos dos membros cowork
select status, count(*)
from public.cowork_members
group by status
order by status;

-- Dados existentes da BRIMAR SERVICE antes do backfill
select m.id, m.name, m.total_value, m.amount_paid, m.status, c.code
from public.cowork_members m
join public.companies c on c.id = m.company_id
where c.code = 'XHUB-26' and upper(m.name) = 'BRIMAR SERVICE';

-- Pagamentos cowork existentes e soma total
select count(*) as payment_rows, coalesce(sum(amount), 0) as total_amount
from public.cowork_payments;

-- Reservas e daypasses antes da migração
select count(*) as reservation_count, coalesce(sum(total_price), 0) as reservation_total
from public.reservations;

select count(*) as daypass_count, coalesce(sum(amount_paid), 0) as daypass_total
from public.cowork_daypasses;
```

## Verificações depois da migração

```sql
-- Confirmar que as contagens de entidades preservadas não diminuíram
select 'companies' as table_name, count(*) from public.companies
union all select 'profiles', count(*) from public.profiles
union all select 'resources', count(*) from public.resources
union all select 'reservations', count(*) from public.reservations
union all select 'cowork_members', count(*) from public.cowork_members
union all select 'cowork_daypasses', count(*) from public.cowork_daypasses
union all select 'tasks', count(*) from public.tasks
union all select 'cowork_payments', count(*) from public.cowork_payments
union all select 'reservation_payments', count(*) from public.reservation_payments;

-- Não devem restar estados legados incompatíveis
select status, count(*)
from public.cowork_members
group by status
order by status;

select count(*) as legacy_status_rows
from public.cowork_members
where status in ('inactive', 'ended');

-- BRIMAR: contrato total e pagamento histórico exacto, sem duplicação
select m.id, m.name, m.total_value, m.status, c.code,
       count(p.*) filter (where p.reference = 'BRIMAR-SERVICE-75000-12500-HISTORIC-001') as historic_payment_rows,
       coalesce(sum(p.amount) filter (where p.reference = 'BRIMAR-SERVICE-75000-12500-HISTORIC-001'), 0) as historic_payment_total
from public.cowork_members m
join public.companies c on c.id = m.company_id
left join public.cowork_payments p on p.cowork_member_id = m.id
where c.code = 'XHUB-26' and upper(m.name) = 'BRIMAR SERVICE'
group by m.id, m.name, m.total_value, m.status, c.code;

-- Soma de cowork_payments por empresa após o backfill
select c.code, count(p.*) as payment_rows, coalesce(sum(p.amount), 0) as total_amount
from public.companies c
left join public.cowork_payments p on p.company_id = c.id
group by c.code
order by c.code;

-- Verificação de reservas/daypasses e respectivos pagamentos/novos campos
select count(*) as reservation_count, coalesce(sum(total_price), 0) as reservation_total
from public.reservations;

select count(*) as reservation_payment_rows, coalesce(sum(amount), 0) as reservation_payment_total
from public.reservation_payments;

select count(*) as daypass_count,
       coalesce(sum(amount_paid), 0) as daypass_total,
       count(*) filter (where payment_method is not null or reference is not null or notes is not null) as daypasses_with_finance_metadata
from public.cowork_daypasses;

-- Políticas necessárias para login, próprio perfil e gestão XHUB
select schemaname, tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'cowork_payments', 'reservation_payments', 'cowork_daypasses')
order by tablename, policyname;
```
