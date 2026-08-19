-- 00-roles.sql — PostgREST auth roles on the owned Postgres (D-368). The supabase/postgres image already ships anon /
-- authenticated / service_role / authenticator, but this is idempotent + explicit so the owned node is reproducible on ANY
-- Postgres, not only the Supabase image. authenticator is the login role PostgREST connects as; it switches into anon (no
-- JWT), authenticated, or service_role (from the JWT `role` claim). RLS (migration 0064) then governs every request — the
-- same security posture we hardened on the rented DB, now on owned metal.
do $$
begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select from pg_roles where rolname='authenticator') then create role authenticator noinherit login; end if;
end $$;
-- authenticator's password is set from POSTGRES_PASSWORD by 01-authenticator.sh (env not available inside .sql init files)
grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;
-- service_role can do everything (edge functions/worker use it, bypassrls); anon/authenticated are governed by RLS policies.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
