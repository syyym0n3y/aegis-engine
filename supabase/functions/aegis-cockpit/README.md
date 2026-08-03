# aegis-cockpit — the operator's live view (front + backend)

Server-side reads real state (autonomous paper account `trd_paper_state`, platform
grades `trd_platform_reports`) and renders a dashboard. `?format=json` returns the
CC-shaped snapshot consumed by the `projects` table row (Aegis is registered in
Command Centre, status connected, snapshot_endpoint_path
`/functions/v1/aegis-cockpit?format=json`).

- Operator dashboard (HTML): https://glzzoomuhnugsiichnub.supabase.co/functions/v1/aegis-cockpit
- Public trader tool: https://glzzoomuhnugsiichnub.supabase.co/functions/v1/aegis-terminal
- Shows: live paper-account status/equity/drawdown/ticks, per-session×setup learning
  (Asia/London/NY), the 5 live APIs, engine+gates state, and the honest D-071..D-078 verdict.
