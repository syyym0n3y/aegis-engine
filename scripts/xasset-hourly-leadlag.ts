#!/usr/bin/env -S deno run --allow-net --allow-env
// xasset-hourly-leadlag.ts (D-599) — hourly cross-asset lead-lag across FX majors, gold, S&P, Nasdaq and Brent.
//
// COVERAGE GAP THIS CLOSES. The board holds 32 families and 1,021 specs, but `fxintraday` has THREE specs against
// 639,168 hourly bars spanning 10.6 years, and `xasset` tested only DAILY lags (21d, 63d) on SPY/QQQ. Hourly
// lead-lag across these eight instruments has never been tested. An acquired dataset the research never touches is
// a RESEARCH failure, not a market finding.
//
// PRE-REGISTERED as D-599-xasset-hourly in trd_prereg (immutable, kill condition written before the data). Expected
// outcome stated in advance: NULL, with non-synchronous trading as the most likely false positive.
//
// WHY NOT ANOTHER MEGA-SWEEP. At N=2.27M trials the expected maximum Sharpe under the null is already 3.047, and it
// rises with every trial spent (D-595/596). Spraying specifications now costs more in ceiling than it can return.
// This is 56 ordered pairs — the complete cross-section, counted honestly as 56 trials, and nothing more.
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("xasset-hourly-leadlag", [
  { name: "FX_FEE_BP", def: "1", note: "round-trip bp, FX majors" },
  { name: "IDX_FEE_BP", def: "3", note: "round-trip bp, gold/indices/Brent" },
  { name: "MIN_OVERLAP", def: "5000", note: "min shared hours for a pair to be testable" },
  { name: "CEILING", def: "5.41", note: "live deflated noise ceiling" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "xa", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const FXSET = new Set(["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"]);
const feeOf = (s: string) => FXSET.has(s) ? Number(K.FX_FEE_BP) : Number(K.IDX_FEE_BP);

// ---- load ----
interface Bar { ts: number; c: number; range: number }
const series = new Map<string, Map<number, Bar>>();
const symRows = await fetch(`${OWNED}/trd_fx_hourly?select=symbol`, { headers: hdr }).then((r) => r.json()).catch(() => []) as { symbol: string }[];
const syms = assertNonEmpty("symbols in trd_fx_hourly", [...new Set((Array.isArray(symRows) ? symRows : []).map((x) => x.symbol))]);
for (const sym of syms) {
  const m = new Map<number, Bar>();
  for (let off = 0;; off += 50000) {
    const rows = await fetch(`${OWNED}/trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c&order=ts&offset=${off}&limit=50000`, { headers: hdr })
      .then((r) => r.json()).catch(() => []) as { ts: number; o: number; h: number; l: number; c: number }[];
    if (!Array.isArray(rows) || !rows.length) break;
    for (const r of rows) if (r.c > 0 && r.h >= r.l) m.set(Number(r.ts), { ts: Number(r.ts), c: r.c, range: (r.h - r.l) / r.c });
    if (rows.length < 50000) break;
  }
  series.set(sym, m);
}
console.log(`==> XASSET HOURLY LEAD-LAG — ${series.size} instruments: ${[...series.keys()].join(", ")}`);
console.log(`    56 ordered pairs, counted as 56 trials. Ceiling ${K.CEILING}. Costs: FX ${K.FX_FEE_BP}bp, other ${K.IDX_FEE_BP}bp.\n`);

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };

interface Res { lead: string; follow: string; n: number; t: number; bpPerSd: number; fee: number; mult: number; t1: number; t2: number; staleT: number }
const out: Res[] = [];

for (const lead of series.keys()) {
  for (const follow of series.keys()) {
    if (lead === follow) continue;
    const L = series.get(lead)!, F = series.get(follow)!;
    // Shared hours only. Both instruments must have printed the hour, and the hour BEFORE it (for the lead return).
    const ts = [...F.keys()].filter((t) => L.has(t) && L.has(t - 3600) && F.has(t - 3600)).sort((a, b) => a - b);
    if (ts.length < Number(K.MIN_OVERLAP)) continue;

    // signal: lead's return over hour t-1 -> t, known at t's close.
    // position: follow's return over hour t -> t+1. LAG-1 BY CONSTRUCTION (SAME-BAR corollary, D-498).
    const sig: number[] = [], fwd: number[] = [], staleFlag: boolean[] = [];
    for (const t of ts) {
      const nxt = F.get(t + 3600); if (!nxt) continue;
      const lr = L.get(t)!.c / L.get(t - 3600)!.c - 1;
      const fr = nxt.c / F.get(t)!.c - 1;
      if (!Number.isFinite(lr) || !Number.isFinite(fr)) continue;
      sig.push(lr); fwd.push(fr);
      // stale-print detector: an hour where EITHER instrument had a zero range never really traded.
      staleFlag.push(L.get(t)!.range === 0 || F.get(t)!.range === 0);
    }
    if (sig.length < Number(K.MIN_OVERLAP)) continue;

    const ss = sd(sig) || 1e-12;
    const z = sig.map((x) => x / ss);                       // 1sd units, so the coefficient reads in bp per 1sd
    const pos = z.map((x) => Math.sign(x));                 // the tradable version: take the sign, pay the cost
    const pnl = pos.map((p, i) => p * fwd[i]);
    const t = mean(pnl) / (sd(pnl) / Math.sqrt(pnl.length) || 1e-12);

    // EFFECT SIZE in bp of expected return per 1sd of signal — the number the fee must be compared against.
    const beta = mean(z.map((x, i) => x * fwd[i])) / (mean(z.map((x) => x * x)) || 1e-12);
    const bpPerSd = Math.abs(beta) * 1e4;
    const fee = feeOf(follow);
    // sign stability across halves
    const h = Math.floor(pnl.length / 2);
    const t1 = mean(pnl.slice(0, h)) / (sd(pnl.slice(0, h)) / Math.sqrt(h) || 1e-12);
    const t2 = mean(pnl.slice(h)) / (sd(pnl.slice(h)) / Math.sqrt(pnl.length - h) || 1e-12);
    // non-synchronous-trading control: restrict to hours where BOTH instruments genuinely traded
    const liveIdx = staleFlag.map((s, i) => s ? -1 : i).filter((i) => i >= 0);
    const livePnl = liveIdx.map((i) => pnl[i]);
    const staleT = livePnl.length > 500 ? mean(livePnl) / (sd(livePnl) / Math.sqrt(livePnl.length) || 1e-12) : NaN;

    out.push({ lead, follow, n: pnl.length, t, bpPerSd, fee, mult: bpPerSd / fee, t1, t2, staleT });
  }
}

assertNonEmpty("testable ordered pairs", out);
out.sort((a, b) => Math.abs(b.t) - Math.abs(a.t));
console.log(`    ${out.length} testable ordered pairs (>= ${K.MIN_OVERLAP} shared hours)\n`);
console.log(`    ${"lead -> follow".padEnd(30)}${"t".padEnd(9)}${"bp/1sd".padEnd(9)}${"fee".padEnd(6)}${"xCost".padEnd(8)}${"t(h1)".padEnd(8)}${"t(h2)".padEnd(8)}${"t(live)".padEnd(9)}n`);
for (const r of out.slice(0, 14)) {
  console.log(`    ${`${r.lead} -> ${r.follow}`.padEnd(30)}${r.t.toFixed(2).padEnd(9)}${r.bpPerSd.toFixed(3).padEnd(9)}${String(r.fee).padEnd(6)}${r.mult.toFixed(2).padEnd(8)}${r.t1.toFixed(2).padEnd(8)}${r.t2.toFixed(2).padEnd(8)}${(Number.isFinite(r.staleT) ? r.staleT.toFixed(2) : "n/a").padEnd(9)}${r.n.toLocaleString()}`);
}

const CEIL = Number(K.CEILING);
const pass = out.filter((r) =>
  Math.abs(r.t) > CEIL && r.mult >= 1.0 && Math.sign(r.t1) === Math.sign(r.t2) && Math.sign(r.t1) === Math.sign(r.t)
);
console.log(`\n    QUALIFYING pairs (|t| > ${CEIL} AND effect >= 1.0x cost AND sign stable across halves): ${pass.length}`);
for (const r of pass) console.log(`      ${r.lead} -> ${r.follow}: t ${r.t.toFixed(2)}, ${r.mult.toFixed(2)}x cost, halves ${r.t1.toFixed(2)}/${r.t2.toFixed(2)}, live-only t ${r.staleT.toFixed(2)}`);
if (!pass.length) {
  const best = out[0];
  console.log(`      none. Best by |t| was ${best.lead} -> ${best.follow} at t ${best.t.toFixed(2)} but only ${best.mult.toFixed(2)}x its cost —`);
  console.log(`      the D-426 shape: significance without magnitude. Recorded as SUB-FEE, per the pre-registered kill condition.`);
}
