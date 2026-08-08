# trd-paper-tick — autonomous live paper loop (MULTI-MARKET + MULTI-SESSION)

Runs the full pipeline (setups → bot allocate → firewall → paper-broker fills) on a
persisted paper account (`trd_paper_state`), advancing it each call with fresh KEYLESS
Alpaca crypto bars across a basket of **10 majors** (BTC/ETH/LTC/BCH/SOL/DOGE/AVAX/
LINK/UNI/AAVE) — 24h instruments that span the **Asia/London/NY** entry sessions
worldwide. Each setup is tagged by session (`fvg:london`, `sweep:asia`…) so the adaptive
allocator learns WHICH session×setup has live edge (concentrates on it) or benches it.
Firewall caps total `crypto` correlated exposure. Scheduled durably via **pg_cron every
6h** (`cron.job` name `trd-paper-tick`). Keyless, $0, no real-money order path.

- Slug: `trd-paper-tick` (public tick). State: `public.trd_paper_state` (jsonb account).
- Canonical engine: `../_shared/{trd-setups,trd-bot,trd-firewall,trd-paper-broker}.ts`.
- Inspect: `select account->>'equity' eq, ticks, updated_at from trd_paper_state;`
- HONEST: per-session expectancies are NOISE until n≥30 (the trust floor); the cron
  accumulates the sample over time and the allocator concentrates only on what survives.
  Expected per D-078: SURVIVES (firewall); compounds only if a real session-edge emerges.
