# trd-paper-tick — autonomous live paper loop (deployed on command-centre)

Runs the full pipeline (setups → bot allocate → firewall → paper-broker fills) on a
persisted paper account (`trd_paper_state`), advancing it each call with fresh KEYLESS
Alpaca crypto (BTC/USD 15m) bars. Scheduled durably via **pg_cron** every 6 hours
(`cron.job` name `trd-paper-tick`) → it keeps testing "can we keep + compound accounts
over time" autonomously, no session, no operator, $0.

- Deployed slug: `trd-paper-tick` (public, read-only tick; POST/GET both advance).
- Canonical engine source: `../_shared/{trd-setups,trd-bot,trd-firewall,trd-paper-broker}.ts`
  (the deploy bundles copies). State: `public.trd_paper_state` (jsonb account).
- Inspect: `select account->>'equity', ticks, updated_at from trd_paper_state;`
- Expected per D-078: SURVIVES (firewall) but does not compound (FVG/sweeps have no edge);
  the allocator would scale any setup that shows live edge.
