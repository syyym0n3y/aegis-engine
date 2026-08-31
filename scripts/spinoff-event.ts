#!/usr/bin/env -S deno run --allow-net --allow-env
// spinoff-event.ts (D-733 Phase 3) — the Cusatis-Miles-Woolridge spin-off anomaly: spun-off companies (spincos)
// historically OUTPERFORM the market in the 1-3 years after the distribution. Test on the resolved spin-off filings
// (D-733 resolver), on the now-survivorship-complete panel.
//
// THE INCEPTION-DATE DISCIPLINE. A spinco starts trading at its distribution, ~1-3 months after its 10-12B filing.
// Its first bar in the panel IS that start — BUT the delisted backfill (D-723) gives ~5y IEX histories from ~2020,
// so a pre-2020 spinco's first bar is 2020 (truncated), not its real spinoff. So an event is measured ONLY when the
// spinco's first price falls within [filing_date, filing_date+150d] — confirming the panel captured the actual
// spinoff inception. Truncated ones are excluded (can't measure from inception), and the count is reported so the
// coverage is visible, not silent.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("spinoff-event", [{ name: "WINDOWS", def: "60,250,500", note: "forward horizons (trading days)" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "spe", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));
const addDays = (d: string, n: number) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

async function pageAll(path: string) { const out: Record<string, unknown>[] = []; for (let off = 0; ; off += 1000) { const r = await fetch(`${OWNED}/${path}&offset=${off}&limit=1000`, { headers: hdr }); if (!r.ok) break; const j = await r.json(); if (!Array.isArray(j) || !j.length) break; out.push(...j); if (j.length < 1000) break; } return out; }
async function bars(sym: string): Promise<number[][]> { const raw = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`, { headers: hdr }).then((x) => x.json()).catch(() => []); return (raw?.[0]?.bars || []).filter((b: number[]) => b[4] > 0); }

// MIN_D restricts inceptions to a period where the panel captures FAILURES too (2021+ via the IEX backfill), which
// removes the capture-survivorship of pre-2020 spincos — only panel-resident survivors of that era were ever
// captured, since failed pre-2020 spincos never entered the curated panel and their IEX history starts 2020.
const MIN_D = Deno.env.get("MIN_D") || "2000-01-01";
const events = (await pageAll("trd_raw_filings?filing_type=like.10-12B%25&ticker=not.is.null&select=ticker,disclosed_date&order=disclosed_date"))
  .map((r) => ({ ticker: r.ticker as string, d: r.disclosed_date as string })).filter((e) => /^[A-Z]{1,5}$/.test(e.ticker) && /^\d{4}-\d\d-\d\d$/.test(e.d) && e.d >= MIN_D);
assertNonEmpty("resolved spinoff events", events, 30);
const spy = new Map((await bars("SPY")).map((b) => [iso(b[0]), b[4]]));
// SIZE-MATCHED benchmark: spincos are small/mid-cap, so an excess vs large-cap SPY confounds the SMALL-CAP FACTOR
// with spinoff-specific alpha. IWM (Russell 2000) isolates it — if the excess survives vs IWM it is spinoff-specific.
const iwm = new Map((await bars("IWM")).map((b) => [iso(b[0]), b[4]]));
const BENCH = (Deno.env.get("BENCH") || "SPY") === "IWM" ? iwm : spy;
const WINS = K.WINDOWS.split(",").map(Number);

// group by ticker; one series load each
const byTicker = new Map<string, string[]>();
for (const e of events) (byTicker.get(e.ticker) ?? byTicker.set(e.ticker, []).get(e.ticker)!).push(e.d);

const results: { w: number; ex: number; dollarVol: number }[][] = WINS.map(() => []);
let captured = 0, truncated = 0, noPrice = 0;
for (const [tk, ds] of byTicker) {
  const b = await bars(tk); if (b.length < 60) { noPrice += ds.length; continue; }
  const dt = b.map((x) => iso(x[0])); const close = new Map(dt.map((d, i) => [d, b[i][4]]));
  const first = dt[0];
  const dv = b.map((x) => x[4] * x[5]); const medDV = [...dv].sort((a, z) => a - z)[Math.floor(dv.length / 2)];
  for (const d of ds) {
    // INCEPTION DISCIPLINE: the spinco's first bar must fall within [filing, filing+150d] to be the real spinoff.
    if (!(first >= d && first <= addDays(d, 150))) { truncated++; continue; }
    const i0 = 0;   // measure from the spinco's first trading day
    const lastDt = dt[dt.length - 1];
    // SURVIVORSHIP FIX: a spinco that DELISTED before the horizon must be included with its delisting return, not
    // skipped. If it has a bar at i0+w, use it; else if it delisted (its last bar predates today's data), use that
    // last bar as the terminal — capturing the failure. Only skip when the horizon is simply beyond the data we hold
    // for a STILL-LIVE name (right-censored), which is neutral, not survivorship.
    for (let wi = 0; wi < WINS.length; wi++) {
      const w = WINS[wi]; let iT = i0 + w;
      if (iT >= b.length) {
        const delisted = lastDt < "2026-06-01";   // stopped trading -> a real terminal, include it
        if (!delisted) continue;                    // still live but horizon exceeds our window -> right-censored, skip
        iT = b.length - 1;                          // measure to the delisting bar
      }
      const p0 = b[i0][4], p1 = b[iT][4];
      const s0 = BENCH.get(dt[i0]) ?? [...BENCH.entries()].find(([sd]) => sd >= dt[i0])?.[1];
      const s1 = BENCH.get(dt[iT]) ?? [...BENCH.entries()].reverse().find(([sd]) => sd <= dt[iT])?.[1];
      if (!(p0 > 0 && p1 > 0 && s0 && s1)) continue;
      results[wi].push({ w, ex: ((p1 / p0 - 1) - (s1 / s0 - 1)) * 100, dollarVol: medDV });
    }
    captured++;
  }
}
console.log(`==> SPIN-OFF EVENT STUDY — ${captured} spincos captured at inception (${truncated} history-truncated, ${noPrice} no price)`);
console.log(`    Cusatis-Miles-Woolridge: do spincos outperform post-distribution? excess vs SPY\n`);
const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "spinoff-event", runId: `spe|${WINS.join(",")}`, spent: WINS.length * 2 });
let anySig = false;
for (let wi = 0; wi < WINS.length; wi++) {
  const all = results[wi]; if (!all.length) { console.log(`    ${WINS[wi]}d: no events`); continue; }
  const sorted = [...all].sort((a, b) => a.dollarVol - b.dollarVol);
  const liq = sorted.slice(Math.floor(sorted.length * 2 / 3));
  const eAll = all.map((x) => x.ex), eLiq = liq.map((x) => x.ex);
  const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const winRate = (a: number[]) => 100 * a.filter((x) => x > 0).length / a.length;
  // Outlier concentration: share of the TOTAL excess coming from the top 5 names (BREADTH-LAW spirit — a mean driven
  // by a few moonshots is a lottery, not a factor).
  const top5share = (a: number[]) => { const s = [...a].sort((x, y) => y - x); const tot = a.reduce((p, x) => p + x, 0); return tot ? 100 * s.slice(0, 5).reduce((p, x) => p + x, 0) / tot : 0; };
  console.log(`    ${String(WINS[wi]).padStart(4)}d LIQUID n=${String(liq.length).padStart(4)}: MEAN ${mean(eLiq).toFixed(1)}% (t ${tstat(eLiq).toFixed(2)}) | MEDIAN ${med(eLiq).toFixed(1)}% | win-rate ${winRate(eLiq).toFixed(0)}% | top-5 names = ${top5share(eLiq).toFixed(0)}% of total`);
  if (Math.abs(tstat(eLiq)) > 2.5 && med(eLiq) > 3) anySig = true;   // significant AND the median (not just the mean) is positive
}
console.log(`\n    trials ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()} | ceiling ${spend.ceiling.toFixed(4)}`);
console.log(`    VERDICT: ${anySig ? "a spinco liquid-tercile excess clears |t|>2.5 at some horizon — a candidate; deflate + cost + verify before any claim." : "no significant spinco outperformance in the liquid tercile — the classic anomaly does not survive here (small captured n, survivorship-corrected panel, benchmarked)."}`);
console.log(`    CAVEAT: only spincos whose panel history begins at the distribution are measurable (the IEX-horizon`);
console.log(`    discipline); the captured n is a fraction of the ${events.length} filings, so this is power-limited.`);
