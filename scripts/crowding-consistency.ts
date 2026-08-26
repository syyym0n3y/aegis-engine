#!/usr/bin/env -S deno run --allow-net --allow-env
// crowding-consistency.ts (D-609) — resolving a contradiction between two of this programme's own findings.
//
// THE CONTRADICTION. D-553/554: in crypto, LONG high funding earns +48.1%/yr, so crowded longs OUTPERFORM.
// D-607/608: in commodity AND financial futures, long high hedging pressure — which IS crowded speculative longs —
// LOSES at -13%/yr with t -4 to -10 across both universes and every control. Same economic concept, opposite signs.
//
// Two of our own results cannot both be describing crowding correctly, and an internal inconsistency is either an
// error in one of them or a real market fact. Either outcome is worth more than another new hypothesis.
//
// THE TEST. Hold the CONSTRUCTION identical to D-607/608 — rank by signal, long the top half, short the bottom half,
// dollar-neutral, vol-normalised, lag-1, costs charged — and apply it to crypto funding. If crypto still comes out
// POSITIVE under the futures construction, the difference is the MARKET. If it comes out NEGATIVE, the futures sign
// holds everywhere and the +48.1%/yr was a construction artifact.
//
// PRE-REGISTERED as D-609-crowding-consistency, including the third possibility: funding is a PRICE and COT
// positioning is a QUANTITY, so they may simply never have been the same measurement.
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("crowding-consistency", [
  { name: "HOLD_D", def: "7", note: "rebalance period in days, matching the weekly futures test" },
  { name: "COST_BP", def: "9", note: "round trip per leg" },
  { name: "MIN_NAMES", def: "20", note: "minimum names per rebalance" },
  { name: "TOPN", def: "0", note: "0 = all names with funding+price" },
  { name: "VOLNORM", def: "1" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "cc", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const day = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);

// Daily perp bars, for returns and vol.
const meta = await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&select=symbol,n_bars&order=n_bars.desc&limit=600`, { headers: hdr })
  .then((r) => r.json()).catch(() => []) as { symbol: string; n_bars: number }[];
const px = new Map<string, Map<string, number>>();
for (const m of Array.isArray(meta) ? meta : []) {
  const rs = await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&symbol=eq.${m.symbol}&select=bars`, { headers: hdr })
    .then((r) => r.json()).catch(() => []) as { bars: number[][] }[];
  const raw = rs?.[0]?.bars; if (!raw?.length) continue;
  const mp = new Map<string, number>();
  for (const b of raw) if (b[4] > 0) mp.set(day(b[0]), b[4]);
  if (mp.size > 200) px.set(m.symbol, mp);
}
assertNonEmpty("perp price series", [...px.keys()], 50);

// Funding, aggregated to a daily mean rate per symbol.
const fund = new Map<string, Map<string, number[]>>();
for (let off = 0;; off += 50000) {
  const rows = await fetch(`${OWNED}/trd_perp_oi?venue=eq.binance&interval=eq.funding&select=symbol,ts,open_interest&order=symbol,ts&offset=${off}&limit=50000`, { headers: hdr })
    .then((r) => r.json()).catch(() => []) as { symbol: string; ts: number; open_interest: number }[];
  if (!Array.isArray(rows) || !rows.length) break;
  for (const r of rows) {
    if (!px.has(r.symbol)) continue;
    const m = fund.get(r.symbol) ?? fund.set(r.symbol, new Map()).get(r.symbol)!;
    const d = day(+r.ts);
    (m.get(d) ?? m.set(d, []).get(d)!).push(+r.open_interest);
  }
  if (rows.length < 50000) break;
}
assertNonEmpty("symbols with funding and price", [...fund.keys()], 50);

const HOLD = Number(K.HOLD_D), COST = Number(K.COST_BP) / 1e4, MINN = Number(K.MIN_NAMES);
const allDays = [...new Set([...px.values()].flatMap((m) => [...m.keys()]))].sort();
const plus = (d: string, n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

const rets: number[] = [];
let breadthSum = 0, periods = 0;
for (let i = 0; i + HOLD < allDays.length; i += HOLD) {
  const d0 = allDays[i], d1 = allDays[i + HOLD];
  const cands: { s: string; sig: number; ret: number; vol: number }[] = [];
  for (const [s, fm] of fund) {
    // Signal: mean funding over the PRIOR HOLD days, known at d0. Lag-1 by construction — nothing from d0 forward.
    const win: number[] = [];
    for (let k = 1; k <= HOLD; k++) { const v = fm.get(plus(d0, -k)); if (v) win.push(...v); }
    if (win.length < 3) continue;
    const p0 = px.get(s)!.get(d0), p1 = px.get(s)!.get(d1);
    if (!p0 || !p1) continue;
    // Trailing vol from the 30 days before d0.
    const hv: number[] = [];
    for (let k = 31; k >= 1; k--) { const a = px.get(s)!.get(plus(d0, -k)), b2 = px.get(s)!.get(plus(d0, -k + 1)); if (a && b2) hv.push(b2 / a - 1); }
    if (hv.length < 15) continue;
    cands.push({ s, sig: mean(win), ret: p1 / p0 - 1, vol: sd(hv) || 1e-6 });
  }
  if (cands.length < MINN) continue;
  cands.sort((a, b) => b.sig - a.sig);
  const half = Math.floor(cands.length / 2);
  const longs = cands.slice(0, half), shorts = cands.slice(-half);
  const wt = (c: typeof cands[number]) => K.VOLNORM === "1" ? 1 / c.vol : 1;
  const gl = longs.reduce((a, c) => a + wt(c), 0), gs = shorts.reduce((a, c) => a + wt(c), 0);
  let r = 0;
  for (const c of longs) r += (wt(c) / gl) * c.ret;
  for (const c of shorts) r -= (wt(c) / gs) * c.ret;
  rets.push(r - 2 * COST);
  breadthSum += cands.length; periods++;
}
assertNonEmpty("rebalance periods", rets, 100);

const m = mean(rets), s2 = sd(rets) || 1e-12;
const perYr = 365 / HOLD;
const t = m / (s2 / Math.sqrt(rets.length));
const h = Math.floor(rets.length / 2);
const t1 = mean(rets.slice(0, h)) / (sd(rets.slice(0, h)) / Math.sqrt(h) || 1e-12);
const t2 = mean(rets.slice(h)) / (sd(rets.slice(h)) / Math.sqrt(rets.length - h) || 1e-12);

console.log(`\n==> CROWDING CONSISTENCY — crypto funding under the D-607/608 futures construction`);
console.log(`    ${rets.length} rebalances of ${HOLD}d, mean breadth ${(breadthSum / periods).toFixed(1)} names`);
console.log(`    LONG high funding / SHORT low funding, dollar-neutral halves, vol-normalised, ${K.COST_BP}bp/leg`);
console.log(`    net ${(m * perYr * 100).toFixed(2)}%/yr  Sharpe ${((m / s2) * Math.sqrt(perYr)).toFixed(2)}  portfolio t ${t.toFixed(2)}  halves ${t1.toFixed(2)} / ${t2.toFixed(2)}`);
console.log(`\n    FOR COMPARISON, identical construction elsewhere:`);
console.log(`      commodity futures (D-607): t -4.16   financial futures (D-608): t -7.6 to -10.6`);
console.log(`      crypto directional book (D-553):     LONG high funding +48.1%/yr`);

const agree = Math.sign(t1) === Math.sign(t2);
if (t >= 2.0 && agree) {
  console.log(`\n    CRYPTO IS POSITIVE under the futures construction -> the disagreement is a MARKET difference,`);
  console.log(`    not a construction artifact. The same rule earns in crypto and loses in futures.`);
} else if (t <= -2.0 && agree) {
  console.log(`\n    CRYPTO IS NEGATIVE under the futures construction -> the futures sign holds in crypto TOO,`);
  console.log(`    and the +48.1%/yr was a CONSTRUCTION ARTIFACT. Alternative (a) supported; a headline falls.`);
} else {
  console.log(`\n    INCONCLUSIVE: |t| ${Math.abs(t).toFixed(2)} under 2.0${agree ? "" : " and the halves DISAGREE"} —`);
  console.log(`    reported as unresolved rather than forced into either reading.`);
}
