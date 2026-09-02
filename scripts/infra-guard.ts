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
//   AEGIS_OWNED_REST=http://127.0.0.1:33000 deno run -A scripts/infra-guard.ts   # green-path verification
//
// exit 0 = substrate reachable; exit 1 = RED (engine is down / conclusions are UNKNOWN, not null).

// D-751: THE RENTED PROBE IS RETIRED. D-722 re-scoped this guard to the owned node and left the rented host as a
// warning-only probe, with the note "to silence this warning entirely, retire the rented probe once the CC bridge is
// repointed at the owned node." The bridge is now repointed — the operator's cockpit is `scripts/cockpit-render.ts`,
// a file on disk rendered from the owned node — so the last live reference to a *.supabase.co host in any daily path
// is removed here rather than exempted. The rented project's billing state is an operator matter tracked in STATE.md
// under "Blocked on operator"; it is not something a daily research guard should reach across the network to learn.
// Enforced from here by `scripts/sovereignty-guard.ts`, which REDs on a live reference anywhere in the runner's closure.
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

// D-722: RE-SCOPED to the substrate research ACTUALLY uses. When this guard was written the edge-factory lived on
// the rented project, so rented-down meant research-UNKNOWN. That migration is now DONE: the daily runner uses only
// the owned node (grep: OWNED_REST=1, rented=0), every table this session touched (trd_lineage, trd_factory,
// trd_bars_deep, trd_macro_series, trd_prereg, trd_short_interest, ...) is on owned, and no active script references
// the rented project (the 3 remaining refs are legacy migration/provision tools, none in any launchd job). So a
// rented outage no longer makes any research conclusion UNKNOWN — it only means the legacy CC oversight bridge is
// unreachable, which is an operator BILLING matter, not a research-validity one. Gating RED on rented was therefore
// a FALSE red: it asserted research was down when research runs entirely on an owned node that is up. The COVERAGE
// LAW is honoured correctly by gating on OWNED (the substrate that actually carries the conclusions). D-751 finished
// the job: the rented WARNING probe is gone too, because the oversight surface it existed for now renders locally.
const results: Probe[] = [];
results.push(await probe("owned", `${OWNED_REST}/`));
const owned = results[0];
for (const p of results) console.log(`${p.ok ? "ok  " : "RED "} ${p.target.padEnd(7)} ${p.url} -> ${p.detail}`);

if (!owned.ok) {
  console.log(`
RED — THE OWNED RESEARCH SUBSTRATE IS DOWN (${OWNED_REST}). Every current table and every daily agent lives here;
with it unreachable, queue progress, candidate counts and verdicts are **UNKNOWN**, not null (COVERAGE LAW). Do not
report "nothing survived" — that would be a claim about markets drawn from a claim about our infrastructure.

REMEDIATION: bring the owned node up — infra/scripts/up.sh (docker compose up -d db rest), then re-run for GREEN.`);
  Deno.exit(1);
}

console.log("\nGREEN — the owned research substrate is serving. No rented host is probed: nothing in any daily path\n        depends on one (D-751), so its state cannot make a research conclusion UNKNOWN.");
Deno.exit(0);
