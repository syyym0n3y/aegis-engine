# SECURITY & ROBUSTNESS AUDIT — Aegis stack (2026-08-04, D-099)

Full-stack vulnerability review. The single most important control is structural and already holds:
**no real money touches the stack — all execution is Alpaca *paper* / simulator.** The invariant "no
real money before the gates" is enforced by design, so the worst-case blast radius is a corrupted
*paper* record, not a financial loss. Within that, the review + fixes:

## FIXED

| # | Vulnerability | Severity | Fix |
|---|---|---|---|
| 1 | **Public dangerous endpoints** — the Alpaca executors are `verify_jwt=false` (public); anyone with the URL could hit `?flatten=1` (close all paper positions) or `?selftest=1` (spam real paper orders) and disrupt/pollute the forward test | HIGH | flatten/selftest now require header `x-admin: <service-role-key>`; public callers get **403**. Verified. Cron path (normal tick) unaffected. |
| 2 | **No circuit breaker on the real-order path** — executors would keep trading if something went wrong | HIGH | Durable **`trd_killswitch`** row; the 2 Alpaca executors check it and halt live trading when active (survives restarts). Verified trip→skip→reset. Trip with: `update trd_killswitch set active=true`. |

## ACCEPTED / FLAGGED (with rationale)

| # | Item | Severity | Disposition |
|---|---|---|---|
| 3 | **Alpaca key stored as name=KeyID / value=Secret**; KeyID hardcoded in edge-fn source | MED | The hardcoded value is the *public* Key ID (not the secret); can't trade alone. Fragile on key rotation. **Operator action:** rename to `APCA_API_KEY_ID` + `APCA_API_SECRET_KEY` (code already reads either). |
| 4 | **No alerting/heartbeat** — a tracker could silently stall (e.g., CoinGecko blocks) and the forward test quietly stops accruing | MED | Flagged. Mitigation: cockpit shows each tracker's `updated_at`; a staleness alert is the recommended next hardening. |
| 5 | **Data-source SPOFs** (Yahoo/CoinGecko/Binance/Alpaca) — a rate-limit/outage fails a tick | LOW | Graceful: state only upserts on success, so a failed tick is a no-op, not corruption. Retries would smooth it. |
| 6 | **Normal tick is public** (cron has no auth) | LOW | Idempotent per bar (deduped by last-bar ts), so replay places no duplicate orders; only harm is extra reads. Left open so cron can call it. |
| 7 | **CORS `*` on all endpoints** | LOW | Intended (public read APIs + the GitHub-Pages app). The token gate (#1) closes the mutating-endpoint amplification. |

## Structural strengths (already in place)
- **Paper-only** — no real capital anywhere (the biggest risk, real money on unproven strategies, is structurally impossible).
- **Append-only evidence** — the corpus + decision log are additive; verdicts are timestamped.
- **Pre-registration** — frozen spec + timestamp means forward records can't be silently curve-fit.
- **Deflation-locked gates** — DSR/PBO thresholds are decision-referenced, not quietly loosened.
- **Idempotent trackers** — re-runs dedupe; no double-counting.

## Residual risk statement (honest)
The stack is a **research + paper-forward-testing** system. Its integrity risks are about *data honesty*
(polluting a paper record), now gated. The moment real money is ever introduced (it is NOT today), the
kill-switch, reconciliation, disconnect-handling, and per-account exposure caps must ALL be hardened
further and re-audited — real money is a different threat model, and this audit does not clear it.
