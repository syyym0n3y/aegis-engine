#!/usr/bin/env -S deno run --allow-net --allow-env --allow-run
// infra-guard.ts — the SUBSTRATE guard (D-408). Every Aegis conclusion, cron and candidate lives on a
// substrate; when the substrate is gone, a research loop does not report "no edge", it reports NOTHING —
// and the failure mode observed on 2026-08-21 was WORSE than nothing: a 120s curl hang and a pg "connection
// timeout" that reads like DB load, not like a dead project. The root cause was billing (all three Supabase
// projects PAUSED for unpaid invoices), which no amount of engine work can fix.
//
// This guard turns that silent outage into an unambiguous RED with the exact remediation. It is the COVERAGE
// LAW applied one level down: an unreachable substrate produces UNKNOWN, never a null finding about markets.
//
//   deno run -A scripts/infra-guard.ts
//   AEGIS_RENTED_BASE=http://127.0.0.1:33000 deno run -A scripts/infra-guard.ts   # green-path verification
//
// exit 0 = substrate reachable; exit 1 = RED (engine is down / conclusions are UNKNOWN, not null).

const RENTED = Deno.env.get("AEGIS_RENTED_BASE") || "https://glzzoomuhnugsiichnub.supabase.co";
const OWNED_REST = Deno.env.get("AEGIS_OWNED_REST") || "http://127.0.0.1:33000";
const TIMEOUT_MS = Number(Deno.env.get("AEGIS_GUARD_TIMEOUT_MS") || 8000);

type Probe = { target: string; url: string; ok: boolean; detail: string };

async function probe(target: string, url: string): Promise<Probe> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    // any HTTP answer (even 401/404) proves the host exists and is serving — that is what we test here.
    return { target, url, ok: true, detail: `HTTP ${r.status}` };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const dns = /dns error|failed to lookup|NXDOMAIN|name not resolved|nodename/i.test(m);
    return { target, url, ok: false, detail: dns ? `UNRESOLVABLE (project paused/deleted): ${m}` : m };
  } finally {
    clearTimeout(t);
  }
}

const results: Probe[] = [];
results.push(await probe("rented", `${RENTED}/rest/v1/`));
results.push(await probe("owned", `${OWNED_REST}/`));

const rented = results[0], owned = results[1];
for (const p of results) console.log(`${p.ok ? "ok  " : "RED "} ${p.target.padEnd(7)} ${p.url} -> ${p.detail}`);

if (rented.ok) {
  console.log("\nGREEN — rented substrate is serving. Edge-factory / stage-2 conclusions are readable.");
  Deno.exit(0);
}

console.log(`
RED — THE RENTED SUBSTRATE IS DOWN. The edge-factory pipeline (trd_edge_queue, trd_edge_scorecard,
trd_stage2_results, trd_forward_candidates, trd_edge_ingest) lives ONLY on that project and is
UNREACHABLE. The owned mirror is ${owned.ok ? "UP but does NOT carry those tables" : "also DOWN"}.

WHAT THIS MEANS (COVERAGE LAW, one level down):
  Queue progress, candidate counts and stage-2 verdicts are **UNKNOWN**, not null. Do not report
  "nothing survived" — that would be a claim about markets drawn from a claim about our billing.

REMEDIATION — OPERATOR ONLY (Claude must not and will not make payments):
  1. Settle the outstanding Supabase invoices at https://supabase.com/dashboard/org/_/billing
  2. Restore the project (dashboard -> project -> Restore), then re-run this guard for GREEN.
  3. Durable fix: finish the owned-infra migration in infra/RUNBOOK.md so an unpaid invoice can
     never again stop the research engine.
`);
Deno.exit(1);
