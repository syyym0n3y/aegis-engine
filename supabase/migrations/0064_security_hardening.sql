-- 0064 — SECURITY HARDENING (D-366). Advisor found 108 findings; the material one was 39 Aegis trd_* tables in the public
-- schema with RLS DISABLED = readable by the public anon key (all trading data: positions, signals, P&L, strategies). All
-- Aegis tables are accessed ONLY by edge functions using the service-role key (which bypasses RLS), so enabling RLS closes
-- the anon-read hole with zero impact on the system. Zero YGS/CC tables were exposed. Idempotent + reproducible here so a
-- rebuilt project starts secure. (New Aegis tables must ship RLS in their own migration — this is the backstop.)
do $$
declare r record;
begin
  -- enable RLS on every public trd_* table lacking it (no policy needed: deny-all for anon, service_role bypasses)
  for r in select tablename from pg_tables where schemaname='public' and tablename like 'trd_%' and rowsecurity=false loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
  -- pin search_path on every public trd_* function (closes the mutable-search_path injection vector) + revoke anon exec
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'trd_%'
  loop
    execute format('alter function public.%I(%s) set search_path = public, pg_temp', r.proname, r.args);
    execute format('revoke execute on function public.%I(%s) from anon, authenticated', r.proname, r.args);
  end loop;
  -- make trd_* views respect the querying role's RLS instead of running as definer (else they leak past table RLS)
  for r in select table_name from information_schema.views where table_schema='public' and table_name like 'trd_%' loop
    execute format('alter view public.%I set (security_invoker = on)', r.table_name);
  end loop;
end $$;
