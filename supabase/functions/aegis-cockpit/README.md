# aegis-cockpit — SUPERSEDED (kept, not deleted)

**SUPERSEDED 2026-09-02 by the owned-node cockpit, `scripts/cockpit-render.ts` → `data/cockpit.html`.** This edge
function was the operator's oversight surface, and it was served from the CC Supabase project
`glzzoomuhnugsiichnub` — which is INACTIVE behind unpaid invoices on the Supabase organisation. That made the
ability to SEE the engine rentable: an unpaid invoice removed oversight while research carried on unaffected on the
owned node, which is the D-408 substrate lesson pointed at the cockpit rather than at the data. The replacement is a
single self-contained HTML file rendered from the owned PostgREST and the daily runner's own outputs, written as the
last step of every runner loop and opened with `scripts/cockpit-open.sh`; it carries a positive control (live trial
count + a full guard board) so it reds rather than rendering a convincing page from nothing. Nothing in any daily
path now references a `*.supabase.co` host — enforced every cycle by `scripts/sovereignty-guard.ts`, whose printed
allowlist names this directory explicitly. This function is kept rather than deleted so that the day the CC project
is restored it can be redeployed as the shared/remote view; until then it is documentation, not infrastructure.

---
*Historical description.* Server-side reads real state (autonomous paper account `trd_paper_state`, platform grades
`trd_platform_reports`) and renders a dashboard. `?format=json` returns the CC-shaped snapshot consumed by the
`projects` table row (Aegis is registered in Command Centre, status connected, snapshot_endpoint_path
`/functions/v1/aegis-cockpit?format=json`). Shows: live paper-account status/equity/drawdown/ticks, per-session×setup
learning (Asia/London/NY), the 5 live APIs, engine+gates state, and the honest D-071..D-078 verdict.
