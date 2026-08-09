-- D-237: operator control token for the cockpit arm/kill/flatten buttons. RLS ENABLED with NO policy → anon/public
-- REST is default-denied; only the service-role edge function (which bypasses RLS) can read the token. The public app
-- never sees it — the operator pastes it into the UI and it's checked server-side (constant-time) per action.
create table if not exists trd_control (
  id    text primary key default 'default',
  token text not null
);
alter table trd_control enable row level security;  -- no policy = deny all non-service-role reads
