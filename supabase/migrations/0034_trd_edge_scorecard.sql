-- D-263: unified edge scorecard — one comparable cost-net row per edge from the trd-edge-backtest runner,
-- which composes the tested _shared cores (trd-harness → cost + edgeVsRandom + evaluateStrategy + gateVerdict).
create table if not exists trd_edge_scorecard (
  edge text primary key,
  run_at timestamptz not null default now(),
  n int, n_trials int,
  abs_r double precision, cost_r double precision, net_r double precision, cost_bps double precision,
  vs_random_edge double precision, vs_random_t double precision, vs_random_passes boolean,
  deflated_sharpe double precision, sharpe double precision, max_dd double precision, min_trl double precision,
  oos_h1 double precision, oos_h2 double precision, holds_both boolean,
  gate_passed boolean, gate_failing jsonb, detail jsonb
);
alter table trd_edge_scorecard enable row level security;
create policy trd_edge_scorecard_read on trd_edge_scorecard for select using (true);
