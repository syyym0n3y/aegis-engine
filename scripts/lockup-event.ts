#!/usr/bin/env -S deno run --allow-net --allow-env
// lockup-event.ts (D-733 Phase 4) — the IPO lock-up expiry anomaly. ~180 calendar days after an IPO, insiders'
// lock-up expires and they can sell; the documented effect is a small NEGATIVE abnormal return around expiry from
// the selling pressure. Test on the 424B4 IPO prospectuses (D-733 ingest): filing date ~= IPO pricing date, so
// lock-up expiry ~= filing + 180 calendar days. Measure the issuer's excess return in a window around expiry.
//
// DISCIPLINE (carried from the spin-off study): the issuer must have price coverage AROUND the expiry, benchmarked
// vs SPY, in the liquid tercile, with median + win-rate so a mean is not read as a factor. Expected honest outcome
// per the literature: a small negative excess (a few %), likely gone after costs — a modest, capacity-bound effect.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("lockup-event", [{ name: "LOCKUP_D", def: "180", note: "calendar days IPO->lock-up expiry" }, { name: "PRE", def: "5", note: "window start, trading days before expiry" }, { name: "POST", def: "15", note: "window end, trading days after expiry" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "lke", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const addCal = (d: string, n: number) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

async function pageAll(path: string) { if (!/order=/.test(path)) throw new Error(`pageAll requires order=: ${path}`); /* plumbing-ok: audited */ const out: Record<string, unknown>[] = []; for (let off = 0; ; off += 1000) { const r = await fetch(`${OWNED}/${path}&offset=${off}&limit=1000`, { headers: hdr }); if (!r.ok) break; const j = await r.json(); if (!Array.isArray(j) || !j.length) break; out.push(...j); if (j.length < 1000) break; } return out; }
async function bars(sym: string): Promise<number[][]> { const raw = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`, { headers: hdr }).then((x) => x.json()).catch(() => []); return (raw?.[0]?.bars || []).filter((b: number[]) => b[4] > 0); }

const events = (await pageAll("trd_raw_filings?filing_type=like.%25ipo%25&ticker=not.is.null&select=ticker,disclosed_date&order=disclosed_date"))
  .map((r) => ({ ticker: r.ticker as string, d: r.disclosed_date as string })).filter((e) => /^[A-Z]{1,5}$/.test(e.ticker) && /^\d{4}-\d\d-\d\d$/.test(e.d));
assertNonEmpty("resolved IPO events", events, 50);
const spy = new Map((await bars("SPY")).map((b) => [iso(b[0]), b[4]]));
const LOCK = Number(K.LOCKUP_D), PRE = Number(K.PRE), POST = Number(K.POST);

const byTicker = new Map<string, string[]>();
for (const e of events) (byTicker.get(e.ticker) ?? byTicker.set(e.ticker, []).get(e.ticker)!).push(e.d);

const evs: { ex: number; runup: number; dollarVol: number }[] = [];
let noPrice = 0, noExpiryBar = 0;
for (const [tk, ds] of byTicker) {
  const b = await bars(tk); if (b.length < 120) { noPrice += ds.length; continue; }
  const dt = b.map((x) => iso(x[0]));
  const dv = b.map((x) => x[4] * x[5]); const medDV = [...dv].sort((a, z) => a - z)[Math.floor(dv.length / 2)];
  for (const d of ds) {
    const expiry = addCal(d, LOCK);
    // index of the first trading day on/after expiry
    const ei = dt.findIndex((x) => x >= expiry);
    if (ei < PRE + 5 || ei + POST >= b.length) { noExpiryBar++; continue; }
    const ipoBar = dt.findIndex((x) => x >= d); if (ipoBar < 0) { noExpiryBar++; continue; }
    const pA = b[ei - PRE][4], pB = b[ei + POST][4];                 // window around expiry
    const sA = spy.get(dt[ei - PRE]), sB = spy.get(dt[ei + POST]);
    const runA = b[ipoBar][4], runB = b[ei - PRE][4];               // IPO -> pre-expiry run-up
    if (!(pA > 0 && pB > 0 && sA && sB && runA > 0 && runB > 0)) continue;
    evs.push({ ex: ((pB / pA - 1) - (sB / sA - 1)) * 100, runup: (runB / runA - 1) * 100, dollarVol: medDV });
  }
}
assertNonEmpty("resolved lock-up events", evs, 30);
const sorted = [...evs].sort((a, b) => a.dollarVol - b.dollarVol);
const liq = sorted.slice(Math.floor(sorted.length * 2 / 3));
const rep = (label: string, s: typeof evs) => { const e = s.map((x) => x.ex); console.log(`    ${label.padEnd(16)} n=${String(s.length).padStart(4)}  expiry-window excess MEAN ${mean(e).toFixed(2)}% (t ${tstat(e).toFixed(2)}) MEDIAN ${med(e).toFixed(2)}% | IPO->expiry run-up ${mean(s.map((x) => x.runup)).toFixed(1)}%`); return { t: tstat(e), m: mean(e) }; };
console.log(`==> IPO LOCK-UP EXPIRY EVENT STUDY — ${evs.length} events, window [-${PRE},+${POST}]d around expiry (IPO+${LOCK}d)`);
console.log(`    (documented: insiders sell at expiry -> small negative abnormal return); excess vs SPY\n`);
rep("ALL", evs);
const liqRes = rep("LIQUID tercile", liq);
const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "lockup-event", runId: `lke|${LOCK}|${PRE}|${POST}`, spent: 2 });
console.log(`\n    trials ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()} | ceiling ${spend.ceiling.toFixed(4)}`);
console.log(`    VERDICT: ${Math.abs(liqRes.t) > 3 ? `liquid expiry-window excess ${liqRes.m.toFixed(2)}% at t ${liqRes.t.toFixed(2)} — a real lock-up effect; short-side needs borrow (paid, not modelled) so tradability is a separate question.` : `no significant liquid lock-up-expiry effect (excess ${liqRes.m.toFixed(2)}%, t ${liqRes.t.toFixed(2)}) — efficiently priced / anticipated. NULL.`}`);
console.log(`    CAVEAT: 424B4 filing date is the IPO-date proxy; a short lock-up trade needs borrow (paid), unmodelled here.`);
