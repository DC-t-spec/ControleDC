# ControleDC

## Fluxo de autenticação e aprovação

### Primeiro administrador automático

A empresa padrão é `XHUB`, identificada pelo código `XHUB-26`.

Quando ainda não existe nenhum `profile` com `role = 'admin'` e `status = 'approved'` na empresa `XHUB-26`, a primeira conta criada pela aplicação é promovida automaticamente pelo trigger seguro `public.handle_new_auth_user()`:

- `role = 'admin'`
- `status = 'approved'`
- `company_id = XHUB`

Isto elimina a necessidade de entrar no Supabase para promover manualmente o primeiro utilizador depois de limpar `profiles`/dados.

### Novos utilizadores

Depois de já existir um admin aprovado na empresa `XHUB-26`, todas as contas seguintes criadas pela aplicação ficam automaticamente como:

- `role = 'user'`
- `status = 'pending'`
- `company_id = XHUB`

A autenticação continua a usar apenas email e senha. A aplicação mostra que a conta foi criada e que o utilizador deve aguardar aprovação do administrador.

### Aprovação pelo admin

- O admin aprovado entra no dashboard e abre o módulo **Aprovações**.
- Utilizadores pendentes aparecem na lista.
- O admin pode **Aprovar** ou **Rejeitar** utilizadores da própria empresa.
- Após aprovação, o utilizador consegue entrar normalmente com email e senha.

## Migração incremental

Para aplicar este comportamento num ambiente existente, execute `supabase_migration_auto_first_admin.sql` no Supabase SQL editor. A migração é incremental e não apaga dados existentes.
