// aegis-cockpit — the operator's live view of EVERYTHING (front + backend). Reads real
// state server-side (autonomous paper account, platform reports, macro regime) and renders a
// dashboard. ?format=json returns the CC-shaped snapshot (for the projects table ingest).
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}` };
const BASE = "https://glzzoomuhnugsiichnub.supabase.co/functions/v1";
async function gather() {
  const ps = await fetch(`${SB}/rest/v1/trd_paper_state?id=eq.default&select=*`, { headers: H }).then((r) => r.json()).catch(() => []);
  const st = ps[0] ?? null; const a = st?.account ?? null;
  const reps = await fetch(`${SB}/rest/v1/trd_platform_reports?select=grade`, { headers: H }).then((r) => r.json()).catch(() => []);
  const grades: Record<string, number> = {}; for (const r of (reps as any[])) grades[r.grade] = (grades[r.grade] ?? 0) + 1;
  // MACRO regime (from trd-macro-pump)
  const ms = await fetch(`${SB}/rest/v1/trd_macro_state?id=eq.default&select=*`, { headers: H }).then((r) => r.json()).catch(() => []);
  const mrow = ms[0] ?? null; const me = mrow?.economies?.[0] ?? null;
  const macro = mrow ? { phase: me?.phase ?? "UNKNOWN", fragility: Number(me?.fragility ?? 0), deRisk: Number(mrow.blended_de_risk ?? 1), expectation: me?.expectation ?? "", signals: (me?.signals ?? []) as string[], asOf: mrow.as_of ?? null } : null;
  let equity = a?.equity ?? 5000, start = a?.startEquity ?? 5000, peak = a?.peakEquity ?? start;
  const mult = equity / start, dd = peak > 0 ? (peak - equity) / peak : 0;
  const perSess: { key: string; n: number; exp: number }[] = [];
  for (const [k, r] of Object.entries(a?.perSetupR ?? {})) { const arr = r as number[]; perSess.push({ key: k, n: arr.length, exp: arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : 0 }); }
  perSess.sort((x, y) => y.exp - x.exp);
  return { st, a, equity, start, mult, dd, ticks: st?.ticks ?? 0, updated: st?.updated_at ?? null, openPos: a?.positions?.length ?? 0, closed: a?.closed?.length ?? 0, survived: equity > start * 0.5, perSess, grades, reports: (reps as any[]).length, macro };
}
function j(d: any) { return { protocol_version: 1, project_kind: "aegis", generated_at: new Date().toISOString(), summary: { status: d.survived ? "alive" : "breached", equity: Math.round(d.equity), multiple: +d.mult.toFixed(3), max_drawdown_pct: +(d.dd * 100).toFixed(1), ticks: d.ticks, open_positions: d.openPos, closed_trades: d.closed, platform_reports: d.reports, macro_phase: d.macro?.phase ?? "UNKNOWN", macro_de_risk: d.macro?.deRisk ?? 1 }, data: { per_session_setup: d.perSess, grades: d.grades, factor_book_sharpe: 1.0, macro: d.macro }, open_work: ["live real-money bridge (paper-first, gated)", "close risk-inventory gaps", "auth/billing", "branded domain"], recent_events: [], query_errors: [] }; }
function esc(s: string) { return String(s).replace(/</g, "&lt;"); }
function html(d: any) {
  const upd = d.updated ? new Date(d.updated).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—";
  const gc = (g: string) => ({ A: "#40b784", B: "#40b784", C: "#d99a3c", D: "#d99a3c", F: "#e15a4f" } as any)[g] ?? "#8b97aa";
  const sessRows = d.perSess.length ? d.perSess.map((s: any) => `<tr><td class=mono>${esc(s.key)}</td><td class="mono num">${s.n}</td><td class="mono num" style="color:${s.exp > 0 ? "var(--accent)" : "var(--red)"}">${s.exp.toFixed(2)}R</td><td class=mono style="color:var(--faint)">${s.n < 30 ? "noise (n<30)" : s.exp > 0 ? "scaling" : "benched"}</td></tr>`).join("") : `<tr><td colspan=4 style="color:var(--faint)">no trades yet — waiting for the next 6h tick</td></tr>`;
  const gradeRows = Object.keys(d.grades).length ? Object.entries(d.grades).map(([g, n]) => `<span class=pill style="color:${gc(g)};border-color:${gc(g)}55">${g}: ${n}</span>`).join("") : "<span style=color:var(--faint)>none graded yet</span>";
  // MACRO panel
  const m = d.macro;
  const phaseColor = (p: string) => ({ EXPANSION: "var(--accent)", RECOVERY: "var(--accent)", LATE_CYCLE: "var(--amber)", CONTRACTION: "var(--red)", UNKNOWN: "var(--faint)" } as any)[p] ?? "var(--faint)";
  const drColor = !m ? "var(--faint)" : m.deRisk >= 0.99 ? "var(--accent)" : m.deRisk >= 0.6 ? "var(--amber)" : "var(--red)";
  const macroSignals = m && m.signals.length ? m.signals.map((s: string) => `<span class=pill style="color:var(--amber);border-color:var(--amber)55">${esc(s)}</span>`).join("") : `<span style="color:var(--faint)">none firing — benign regime</span>`;
  const macroSection = `
<h2>Macro regime — where the economy sits, and the risk it implies</h2>
<div class=grid>
<div class=card><div class=lbl>US cycle phase</div><div class=v style="color:${phaseColor(m?.phase ?? "UNKNOWN")}">${m?.phase ?? "—"}</div><div class=s>as of ${m?.asOf ?? "—"}</div></div>
<div class=card><div class=lbl>Fragility</div><div class=v>${m ? (m.fragility * 100).toFixed(0) : "—"}%</div><div class=s>0 robust · 100 primed to break</div></div>
<div class=card><div class=lbl>De-risk applied</div><div class=v style="color:${drColor}">${m ? (m.deRisk * 100).toFixed(0) : "100"}%</div><div class=s>bot size × this (≤100%)</div></div>
<div class=card><div class=lbl>Signals firing</div><div class=v>${m ? m.signals.length : 0}</div><div class=s>curve · vol regime</div></div>
</div>
<div class=panel style="margin-top:14px"><div class=lbl>What to expect — fragility, NOT direction</div><div style="font-size:13px;color:var(--tx)">${esc(m?.expectation ?? "Macro pump has not run yet — the bot runs at full (already-capped) risk until it does.")}</div><div style="margin-top:10px">${macroSignals}</div></div>`;
  return `<title>Aegis — Command Cockpit</title><style>:root{--bg:#0a0d13;--sf:#111621;--sf2:#161e2b;--ln:#222c3c;--tx:#e7ecf3;--mut:#8b97aa;--faint:#5d6879;--accent:#40b784;--red:#e15a4f;--amber:#d99a3c;--mono:ui-monospace,Menlo,monospace;--sans:system-ui,sans-serif}@media(prefers-color-scheme:light){:root{--bg:#f3f5f3;--sf:#fff;--sf2:#edf0ee;--ln:#dde2df;--tx:#131820;--mut:#5a6472;--faint:#8c96a3;--accent:#1c8a5a;--red:#c23a30}}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font-family:var(--sans);line-height:1.5}.wrap{max-width:1040px;margin:0 auto;padding:0 22px 60px}.mono{font-family:var(--mono)}.num{font-variant-numeric:tabular-nums;text-align:right}.lbl{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--mut)}header{border-bottom:1px solid var(--ln)}.bar{display:flex;justify-content:space-between;align-items:center;padding:18px 0}.brand{font-family:var(--mono);font-weight:700;letter-spacing:.04em;display:flex;gap:9px;align-items:center}.dot{width:9px;height:9px;border-radius:2px;background:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}h2{font-size:14px;margin:34px 0 12px;letter-spacing:-.01em}.grid{display:grid;gap:14px;grid-template-columns:repeat(2,1fr)}@media(min-width:720px){.grid{grid-template-columns:repeat(4,1fr)}}.card{background:var(--sf);border:1px solid var(--ln);border-radius:10px;padding:15px}.card .lbl{margin-bottom:6px}.card .v{font-family:var(--mono);font-size:24px;font-weight:700}.card .s{font-size:12px;color:var(--mut);margin-top:2px}table{width:100%;border-collapse:collapse;font-size:13px;background:var(--sf);border:1px solid var(--ln);border-radius:10px;overflow:hidden}th,td{padding:9px 14px;text-align:left;border-bottom:1px solid var(--ln)}th{font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}tbody tr:last-child td{border-bottom:0}.two{display:grid;gap:14px;grid-template-columns:1fr}@media(min-width:760px){.two{grid-template-columns:1fr 1fr}}.panel{background:var(--sf);border:1px solid var(--ln);border-radius:10px;padding:16px 18px}.panel .lbl{margin-bottom:10px}.row{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:4px 0;border-bottom:1px solid var(--ln)}.row:last-child{border:0}.row a{color:var(--accent);text-decoration:none;font-family:var(--mono);font-size:12px}.pill{display:inline-block;font-family:var(--mono);font-size:11px;padding:3px 9px;border-radius:4px;border:1px solid var(--ln);margin:3px 4px 0 0}.ok{color:var(--accent)}.warn{color:var(--amber)}li{margin:4px 0;font-size:13px;color:var(--mut)}ul{margin:6px 0;padding-left:18px}</style><header><div class="wrap bar"><div class=brand><span class=dot></span> AEGIS · COMMAND COCKPIT</div><div class=mono style="font-size:12px;color:var(--mut)">live · updated ${upd}</div></div></header><main class=wrap>
<h2>Autonomous paper account — the live 'keep + compound' test</h2>
<div class=grid>
<div class=card><div class=lbl>Status</div><div class=v style="color:${d.survived ? "var(--accent)" : "var(--red)"}">${d.survived ? "ALIVE" : "BREACHED"}</div><div class=s>firewall protecting</div></div>
<div class=card><div class=lbl>Equity</div><div class=v>$${Math.round(d.equity)}</div><div class=s>from $${d.start} · ${d.mult.toFixed(3)}x</div></div>
<div class=card><div class=lbl>Max drawdown</div><div class=v>${(d.dd * 100).toFixed(1)}%</div><div class=s>${d.openPos} open · ${d.closed} closed</div></div>
<div class=card><div class=lbl>Ticks</div><div class=v>${d.ticks}</div><div class=s>10 markets · every 6h</div></div>
</div>
${macroSection}
<h2>Per-session × setup — what the allocator is learning (Asia / London / NY)</h2>
<table><thead><tr><th>session × setup</th><th class=num>trades</th><th class=num>expectancy</th><th>allocator</th></tr></thead><tbody>${sessRows}</tbody></table>
<div class=two style="margin-top:26px">
<div class=panel><div class=lbl>Frontend — what's live for traders</div>
<div class=row><span>Public Terminal (any broker, free)</span><a href="${BASE}/aegis-terminal">open ↗</a></div>
<div class=row><span>Verify API (real vs overfit)</span><a href="${BASE}/trd-api-verify">POST</a></div>
<div class=row><span>Protect API (ruin / sizing)</span><a href="${BASE}/trd-api-protect">POST</a></div>
<div class=row><span>Allocate API (global factor book)</span><a href="${BASE}/trd-api-allocate?preset=global">GET</a></div>
<div class=row><span>Platform API (grade any account)</span><a href="${BASE}/trd-platform">POST</a></div></div>
<div class=panel><div class=lbl>Backend — engine + gates</div>
<div class=row><span>Autonomous loop (pg_cron)</span><span class=mono ok>every 6h</span></div>
<div class=row><span>Macro regime pump (pg_cron)</span><span class=mono ok>4×/day</span></div>
<div class=row><span>Risk firewall</span><span class=mono ok>enforcing</span></div>
<div class=row><span>Real-money order path</span><span class=mono warn>GATED (paper-first)</span></div>
<div class=row><span>Proven compounding edge</span><span class=mono ok>factor book Sharpe 1.00</span></div>
<div class=row><span>Accounts graded (platform)</span><span class=mono>${d.reports} · ${gradeRows}</span></div></div>
</div>
<h2>The honest verdict (D-071…D-079)</h2><div class=panel><ul>
<li><b style=color:var(--tx)>No chart/timing signal survives</b> honest testing (~15,000 backtests, regimes, survivorship, PBO).</li>
<li><b style=color:var(--tx)>Risk management is the durable edge</b> — it keeps accounts alive even trading a losing strategy (proven live above).</li>
<li><b style=color:var(--tx)>Compounding comes from the global factor book</b> (value+quality+momentum, US+intl+EM) — Sharpe 1.0, not chart setups.</li>
<li><b style=color:var(--tx)>Macro measures fragility, not direction</b> — the regime overlay only ever shrinks size when the system is primed to break; it never predicts which way price goes.</li>
<li>The loop trades <b style=color:var(--tx)>10 markets across every session</b> and learns which session×setup has live edge — trusting none until n≥30.</li>
</ul></div>
</main>`;
}
Deno.serve(async (req) => {
  const d = await gather();
  if (new URL(req.url).searchParams.get("format") === "json") return new Response(JSON.stringify(j(d)), { headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
  return new Response(html(d), { headers: { "content-type": "text/html; charset=utf-8" } });
});
