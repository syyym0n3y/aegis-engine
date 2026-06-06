#!/usr/bin/env -S deno run --allow-net --allow-env
// trd-report — the operator's honest view of Aegis. Shows what was ingested,
// what features exist, and — per the honesty mandate — a prominent REJECTED list
// (every strategy the engine killed, with the reason). A backtester that hides
// its rejects is lying.
//
//   deno run --allow-net --allow-env scripts/trd-report.ts

import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";

const DB = Deno.env.get("DATABASE_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = postgres(DB);

function line(s = "") { console.log(s); }
try {
  const [filings] = await sql`select count(*)::int n, count(distinct ticker)::int tickers, min(disclosed_date)::text lo, max(disclosed_date)::text hi from trd_raw_filings where source='edgar'`;
  const [feats] = await sql`select count(*)::int n, count(distinct symbol)::int syms from trd_features`;
  const ladder = await sql`select s.family||':'||s.name as strat, l.rung, l.evidence, l.created_at
    from trd_ladder_state l join trd_strategy_specs s on s.id=l.spec_id order by l.created_at desc`;
  const [trials] = await sql`select count(*)::int n from trd_trial_counter`;

  line("══════════════════════════════════════════════════════════════");
  line("  AEGIS — falsification engine report");
  line("══════════════════════════════════════════════════════════════");
  line(`  Ingested filings : ${filings.n} EDGAR Form-4 (${filings.tickers} tickers, ${filings.lo}…${filings.hi})`);
  line(`  Feature store    : ${feats.n} point-in-time features over ${feats.syms} symbols`);
  line(`  Strategies tried : ${trials.n} (trial counter — every Sharpe is reported next to this)`);
  line();
  line("  ── REJECTED (the engine killed these) ──────────────────────");
  const rejected = ladder.filter((r: Record<string, unknown>) => r.rung === "REJECTED");
  if (rejected.length === 0) line("   (none yet)");
  for (const r of rejected) {
    const reasons = (r.evidence as { failing?: string[] })?.failing ?? [];
    line(`   ✗ ${r.strat}`);
    for (const why of reasons) line(`       • ${why}`);
  }
  line();
  const promoted = ladder.filter((r: Record<string, unknown>) => r.rung !== "REJECTED" && r.rung !== "DEMOTED");
  line("  ── SURVIVING (cleared the gate → on the ladder) ────────────");
  if (promoted.length === 0) line("   (none — the expected, honest result until a real edge survives)");
  for (const r of promoted) line(`   ✓ ${r.strat} → ${r.rung}`);
  line("══════════════════════════════════════════════════════════════");
} finally {
  await sql.end();
}
