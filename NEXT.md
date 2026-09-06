# NEXT — work queue (rewritten 2026-09-06, D-804; the previous version had not changed since 2026-08-14 and still queued
# Supabase provisioning, Alpaca ingest and `trd_features` — all superseded by the owned node, D-408→D-729/D-704)

The live queue is [`docs/GOLD_PATH.md`](./docs/GOLD_PATH.md) §4. Summary:

1. ~~Five UNTESTED-on-held-data tests~~ **DONE 2026-09-06 (D-805)**: short-interest surprise NULL (sign missed), insider
   sells NULL (sign missed), profitability/investment premia NULL vs ceiling (investment dead post-2013); D-612 and
   D-601/602 were already resolved and had been misfiled.
2. **2026 crypto regime break — DESCRIPTIVE-ONLY decomposition** (§3.3). Two live clocks depend on it.
3. **Reliability debt** (§3.7): cockpit-render positive control · `refresh-bars.ts` metadata columns · post-kickstart transient RED.
4. **Prop clock** `fwd-prop-ftmo100k-utc16-0p5x-v1` — register ONLY on operator sign-off, then its ledger scorer.

**Operator-only:** log deposits / wrapper / currency leak into the wealth ledger (it is EMPTY and is the whole in-market
10^7 lever today); decide the one prop fee; CC Supabase invoices (cockpit only).

**Standing:** 17 forward clocks scored daily, 0 computable yet, 0 promoted; 28 guards, board green; nothing trades.
