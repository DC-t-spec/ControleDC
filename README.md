# ControleDC

## Fluxo de autenticação e aprovação

### Primeiro administrador

O primeiro administrador precisa de uma promoção manual **apenas uma vez**, porque ainda não existe nenhum admin aprovado para aprovar outros utilizadores.

1. Abra a aplicação e crie a conta com o botão **Criar conta** usando o código da empresa `XHUB-26`.
2. Confirme que o utilizador foi criado em `auth.users` e que o `profile` foi criado em `public.profiles` com `role = 'user'`, `status = 'pending'` e o `company_id` da empresa `XHUB-26`.
3. Execute o bloco final de bootstrap em `supabase_schema.sql` no Supabase SQL editor para promover esse email para `role = 'admin'` e `status = 'approved'`.

Depois deste bootstrap inicial, a empresa não deve precisar de SQL manual para novos utilizadores.

### Novos utilizadores

- O utilizador cria conta no botão **Criar conta** com email, senha e código `XHUB-26`.
- O Supabase cria o utilizador em `auth.users`.
- O trigger `public.handle_new_auth_user()` cria automaticamente o `profile` com `role = 'user'`, `status = 'pending'` e a empresa correspondente ao código informado.
- A aplicação mostra: “Conta criada. Aguarde aprovação do administrador.”

### Aprovação pelo admin

- O admin aprovado entra no dashboard e abre o módulo **Aprovações**.
- Utilizadores pendentes aparecem na lista.
- O admin pode **Aprovar** ou **Rejeitar** utilizadores da própria empresa.
- Após aprovação, o utilizador consegue fazer login com o mesmo código de empresa.
