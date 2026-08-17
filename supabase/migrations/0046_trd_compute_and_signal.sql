-- 0046 — the OWN COMPUTE NODE job queue + the buy/sell SIGNAL store.
-- Compute node: a standalone uncapped worker (scripts/aegis-worker.ts) drains trd_compute_jobs, running heavy
-- era-disaggregated attribution/grammar work the 2s edge-function cap cannot hold. Light broker I/O stays in the
-- trd-compute edge fn; heavy compute runs on the worker. Signal: per-instrument buy/sell lean + calibrated causal
-- CONFIDENCE + the WHY decomposition + honest RESIDUAL (single-operator, unpublished — inside the existing invariant).
create table if not exists trd_compute_jobs (
  id bigint generated always as identity primary key,
  job_type text not null, params jsonb not null default '{}',
  status text not null default 'pending', priority int not null default 100,
  worker_id text, result jsonb, error text,
  claimed_at timestamptz, done_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists trd_compute_jobs_pending on trd_compute_jobs (status, priority, id) where status='pending';
create table if not exists trd_signal (
  symbol text primary key, asof date not null,
  lean double precision not null, confidence double precision not null,
  engage boolean not null default false, why jsonb, residual double precision,
  note text, updated_at timestamptz not null default now()
);
create or replace function trd_claim_job(p_worker text)
returns setof trd_compute_jobs language sql as $$
  update trd_compute_jobs j set status='claimed', worker_id=p_worker, claimed_at=now()
  where j.id = (select id from trd_compute_jobs where status='pending' order by priority, id
                for update skip locked limit 1)
  returning *;
$$;
alter table trd_compute_jobs enable row level security;
alter table trd_signal enable row level security;
