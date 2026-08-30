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

// D-722: RE-SCOPED to the substrate research ACTUALLY uses. When this guard was written the edge-factory lived on
// the rented project, so rented-down meant research-UNKNOWN. That migration is now DONE: the daily runner uses only
// the owned node (grep: OWNED_REST=1, rented=0), every table this session touched (trd_lineage, trd_factory,
// trd_bars_deep, trd_macro_series, trd_prereg, trd_short_interest, ...) is on owned, and no active script references
// the rented project (the 3 remaining refs are legacy migration/provision tools, none in any launchd job). So a
// rented outage no longer makes any research conclusion UNKNOWN — it only means the legacy CC oversight bridge is
// unreachable, which is an operator BILLING matter, not a research-validity one. Gating RED on rented was therefore
// a FALSE red: it asserted research was down when research runs entirely on an owned node that is up. The COVERAGE
// LAW is honoured correctly by gating on OWNED (the substrate that actually carries the conclusions); rented-down is
// reported as a WARNING so the billing issue stays visible without falsely invalidating research.
const results: Probe[] = [];
results.push(await probe("owned", `${OWNED_REST}/`));
results.push(await probe("rented", `${RENTED}/rest/v1/`));
const owned = results[0], rented = results[1];
for (const p of results) console.log(`${p.ok ? "ok  " : (p.target === "owned" ? "RED " : "warn")} ${p.target.padEnd(7)} ${p.url} -> ${p.detail}`);

if (!owned.ok) {
  console.log(`
RED — THE OWNED RESEARCH SUBSTRATE IS DOWN (${OWNED_REST}). Every current table and every daily agent lives here;
with it unreachable, queue progress, candidate counts and verdicts are **UNKNOWN**, not null (COVERAGE LAW). Do not
report "nothing survived" — that would be a claim about markets drawn from a claim about our infrastructure.

REMEDIATION: bring the owned node up — infra/scripts/up.sh (docker compose up -d db rest), then re-run for GREEN.`);
  Deno.exit(1);
}

if (!rented.ok) {
  console.log(`
GREEN (research) — the owned node is serving; every current conclusion is readable and valid.
WARNING (oversight) — the legacy RENTED project is down: ${rented.detail}. It carries no active research; the only
effect is that the CC oversight cockpit cannot read via the service-role bridge. This is an operator BILLING matter
(https://supabase.com/dashboard/org/_/billing), NOT a research-validity one — deliberately NOT a RED, because gating
research on an abandoned substrate was itself the bug (D-722). To silence this warning entirely, retire the rented
probe once the CC bridge is repointed at the owned node.`);
  Deno.exit(0);
}

console.log("\nGREEN — owned research substrate serving and the rented oversight bridge is reachable.");
Deno.exit(0);
