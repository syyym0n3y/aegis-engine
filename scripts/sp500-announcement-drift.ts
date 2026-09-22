#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// sp500-announcement-drift.ts (D-965) — the D-963 re-entry gate, opened: announcement dates pulled from S&P's own
// archive (data/sp500-announcements.json, 33 PRs 2023-09..2026-09). D-963 proved the footprint into the EFFECTIVE
// date is real (adds t 3.65 / dels -2.41) and already priced by then; THIS measures the harvestable window.
// PRE-SPECIFIED before running: match each change (effective >= 2023-09-01) to the NEAREST announcement 1..15
// calendar days BEFORE its effective date (deletes ride the same PR as their replacement add, so date-window
// matching covers both sides; matched/unmatched counts ARE the coverage statement). ADD: LONG from the open of the
// first trading day AFTER the announcement (PRs land after the close) to the close of the last trading day BEFORE
// effective (the rebalance auction). DEL: SHORT, same window. Registered directions: ADD positive, DEL negative
// (i.e. the short earns positive). Excess vs SPY over the identical window. 2 trials, spent. Cost bar: 20bp RT.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("sp500-announcement-drift", [
  { name: "ANN", def: "data/sp500-announcements.json" }, { name: "CHG", def: "data/sp500-changes.json" },
  { name: "FROM_D", def: "2023-09-01" }, { name: "MAX_LEAD_D", def: "15" }, { name: "RUN_ID", def: "D-965-sp500-announcement-drift" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "spa", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const t0 = await jwt(); const { q } = mkStrictRead(OWNED, { Authorization: `Bearer ${t0}`, apikey: t0 });
const REPO = new URL("..", import.meta.url).pathname;
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 1 ? mean(a) / ((sd(a) / Math.sqrt(a.length)) || 1e-12) : 0;
const dayN = (s: string) => Math.floor(Date.parse(s + "T00:00:00Z") / 86400000);
const ann = (JSON.parse(await Deno.readTextFile(`${REPO}${K.ANN}`)) as { rows: { a: string }[] }).rows.map((r) => dayN(r.a)).sort((a, b) => a - b);
const chg = ((JSON.parse(await Deno.readTextFile(`${REPO}${K.CHG}`)) as { changes: { date: string; added: string; removed: string }[] }).changes).filter((c) => c.date >= K.FROM_D);
assertNonEmpty("announcements", ann, 20); assertNonEmpty("changes since FROM_D", chg, 30);
// match: nearest announcement 1..MAX_LEAD calendar days before effective
const MAXL = +K.MAX_LEAD_D;
type Ev = { sym: string; side: 1 | -1; aDay: number; eDay: number };
const evs: Ev[] = []; let unmatched = 0; const leads: number[] = [];
for (const c of chg) { const e = dayN(c.date); let best = -1; for (const a of ann) { const L = e - a; if (L >= 1 && L <= MAXL && (best < 0 || a > best)) best = a; }
  if (best < 0) { unmatched++; continue; } leads.push(e - best);
  if (c.added) evs.push({ sym: c.added.toUpperCase(), side: 1, aDay: best, eDay: e });
  if (c.removed) evs.push({ sym: c.removed.toUpperCase(), side: -1, aDay: best, eDay: e });
}
console.log(`\n==> D-965 ANNOUNCEMENT->EFFECTIVE DRIFT — ${chg.length} changes since ${K.FROM_D}: ${chg.length - unmatched} matched to a PR (${unmatched} unmatched = coverage), lead days median ${leads.sort((a, b) => a - b)[Math.floor(leads.length / 2)]}`);
// bars for event symbols + SPY
const syms = [...new Set(["SPY", ...evs.map((e) => e.sym)])];
const S = new Map<string, Map<number, { o: number; c: number }>>();
for (let i = 0; i < syms.length; i += 40) { const page = syms.slice(i, i + 40); const rows = await q(`trd_bars_deep?symbol=in.(${page.map(encodeURIComponent).join(",")})&select=symbol,bars`) as { symbol: string; bars: number[][] }[];
  for (const r of rows) { const m = new Map<number, { o: number; c: number }>(); for (const b of (r.bars ?? [])) if (b[4] > 0) m.set(Math.floor(b[0] / 86400), { o: b[1], c: b[4] }); if (m.size > 100) S.set(r.symbol.toUpperCase(), m); } }
const spy = S.get("SPY"); if (!spy) { console.error("!! POSITIVE CONTROL FAILED: SPY bars absent — cannot benchmark."); Deno.exit(1); }
const spyDays = [...spy.keys()].sort((a, b) => a - b);
const nextTrade = (d: number) => spyDays.find((x) => x > d); const lastBefore = (d: number) => { let r: number | undefined; for (const x of spyDays) { if (x < d) r = x; else break; } return r; };
const T = await spendTrials({ rest: OWNED, headers: { Authorization: `Bearer ${t0}`, apikey: t0 }, family: "sp500-announcement-drift", runId: K.RUN_ID, spent: 2 });
const buckets: Record<string, number[]> = { ADD: [], DEL: [] }; let noBars = 0;
for (const ev of evs) { const bars = S.get(ev.sym); if (!bars) { noBars++; continue; }
  const d0 = nextTrade(ev.aDay), d1 = lastBefore(ev.eDay); if (d0 === undefined || d1 === undefined || d1 <= d0) continue;
  const e0 = bars.get(d0), e1 = bars.get(d1), s0 = spy.get(d0), s1 = spy.get(d1); if (!e0 || !e1 || !s0 || !s1) continue;
  const ex = Math.log(e1.c / e0.o) - Math.log(s1.c / s0.o);           // entry next OPEN after PR (lag-1), exit rebalance close
  buckets[ev.side === 1 ? "ADD" : "DEL"].push(ev.side * ex);
}
console.log(`  bars coverage: ${noBars} event legs missing bars (stated). Ceiling ${T.ceiling.toFixed(3)} at N=${T.N.toLocaleString()}.`);
for (const [nm, a] of Object.entries(buckets)) {
  const bp = 1e4 * mean(a); const tt = tstat(a); const win = a.filter((x) => x > 0).length;
  console.log(`  ${nm} (${nm === "ADD" ? "LONG add, PR-open -> rebalance close" : "SHORT delete, same window"}): n ${a.length}, excess ${bp >= 0 ? "+" : ""}${bp.toFixed(0)}bp/event, t ${tt.toFixed(2)}, win ${(100 * win / Math.max(1, a.length)).toFixed(0)}%  ${bp > 20 && tt >= 2 ? "** CLEARS 20bp COST **" : bp > 0 ? "(positive, vs 20bp cost)" : "(registered sign MISSED)"}`);
}
console.log(`  READ: single era (2023-09..2026-09, the PR archive's dense span) — that is the strongest-footprint era from D-963, stated, not hidden. No train/test split at n~60/side; the era IS the out-of-sample of D-963's pooled panel in the sense that no rule was formed here — both directions were registered from the forced-flow mechanism before any of this data was read.`);
