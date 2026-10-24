-- Privileges for PostgREST (anon / authenticated / service_role)
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on table public.gestrisk_sessoes to anon, authenticated, service_role;
grant select, insert, update, delete on table public.gestrisk_gestantes_cadastro to anon, authenticated, service_role;

-- Policies: service_role bypasses RLS; allow authenticated full access for local/dev if needed.
-- For local n8n we use service_role JWT.
