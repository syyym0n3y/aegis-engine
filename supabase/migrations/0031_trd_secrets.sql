-- D-258: secrets table (RLS ENABLED, NO policy → service-role only). Values inserted out-of-band, NEVER in git.
create table if not exists trd_secrets (name text primary key, value text not null);
alter table trd_secrets enable row level security;
