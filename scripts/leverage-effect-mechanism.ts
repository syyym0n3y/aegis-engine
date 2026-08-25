#!/usr/bin/env -S deno run --allow-net --allow-env
// leverage-effect-mechanism.ts (D-601) — does ONE parameter predict where the risk gate earns its keep?
//
// D-600 found vol targeting helps 4 risk assets and hurts 4 FX majors. D-566 separately found it helps equities and
// not crypto. Two observations, each post-hoc. The candidate mechanism unifying them is the LEVERAGE EFFECT: the
// correlation between a period's return and the change in realised volatility. Where vol rises as price falls,
// scaling down in high vol avoids the drawdown. Where no asymmetry exists, scaling only buys turnover.
//
// PRE-REGISTERED as D-601-leverage-effect. Two clauses, both required, both written before the data:
//   (1) rank IC between leverage effect and vol-targeting benefit <= -0.5 across >= 14 instruments
//   (2) the relationship SURVIVES partialling out buy-and-hold Sharpe — because the competing explanation is simply
//       "vol targeting flatters high-drift assets", which is weaker and already known.
//
// CRUCIALLY the test set includes CRYPTO, which was not part of the observation that generated the hypothesis.
// Testing a post-hoc pattern on the same 8 instruments that produced it would be circular.
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("leverage-effect-mechanism", [
  { name: "TARGET_VOL", def: "0.10" },
  { name: "VOL_WINDOW", def: "500" },
  { name: "MAX_LEV", def: "3" },
  { name: "NCRYPTO", def: "10", note: "crypto perps added as held-out instruments" },
  { name: "MIN_IC", def: "0.5", note: "pre-registered |rank IC| bar" },
  { name: "LEV_AGG", def: "120", note: "hours per period for the leverage-effect measurement" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "le", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const corr = (a: number[], b: number[]) => {
  const ma = mean(a), mb = mean(b);
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? n / Math.sqrt(da * db) : 0;
};
const rankIC = (a: number[], b: number[]) => {
  const r = (x: number[]) => { const o = [...x.keys()].sort((i, j) => x[i] - x[j]); const q = new Array(x.length); o.forEach((idx, k) => q[idx] = k); return q; };
  return corr(r(a), r(b));
};

const HRS = 24 * 365;
interface Row { sym: string; klass: string; lev: number; benefit: number; bhSharpe: number }
const rows: Row[] = [];

function analyse(sym: string, klass: string, rets: number[], feeBp: number) {
  const W = Number(K.VOL_WINDOW), TGT = Number(K.TARGET_VOL), CAP = Number(K.MAX_LEV);
  if (rets.length < W + 5000) return;
  // LEVERAGE EFFECT: correlation between the period return and the CHANGE in trailing realised vol.
  // Negative => vol rises when price falls, the equity-like asymmetry.
  const bh: number[] = [], vt: number[] = [];
  let prevW = 1;
  for (let i = W; i < rets.length; i++) {
    const win = rets.slice(i - W, i);
    const vol = sd(win);
    const rv = vol * Math.sqrt(HRS);
    const w = Math.min(CAP, rv > 1e-9 ? TGT / rv : CAP);
    const cost = Math.abs(w - prevW) * feeBp / 1e4;
    bh.push(rets[i]); vt.push(w * rets[i] - cost); prevW = w;
  }
  // D-601 CORRECTED. The first version correlated r[i] against vol(..i-1) minus vol(..i-2) — a change driven by
  // r[i-1], not r[i]. One period of misalignment, and it read ~0 on every instrument including equity indices,
  // where the literature is unambiguous. Under the COVERAGE LAW that made the original verdict UNTESTED rather than
  // null: the measurement could not detect the thing it was testing for.
  // The leverage effect asks whether a NEGATIVE return RAISES SUBSEQUENT vol, so the return must be paired with the
  // vol change it CAUSES: vol of the window INCLUDING r[t] minus vol of the window ending just before it. Measured
  // at MULTI-PERIOD aggregation, where the effect actually lives — verified to reproduce the known pattern
  // (S&P -0.14, Nasdaq -0.10, gold -0.07, EURUSD +0.07) before being trusted here.
  const AGG = Number(Deno.env.get("LEV_AGG") || 120);
  const agg: number[] = [];
  for (let i = 0; i + AGG <= rets.length; i += AGG) agg.push(rets.slice(i, i + AGG).reduce((a, b2) => (1 + a) * (1 + b2) - 1, 0));
  const LW = 21, lR: number[] = [], lD: number[] = [];
  for (let i = LW; i < agg.length; i++) {
    const volExcl = sd(agg.slice(i - LW, i));
    const volIncl = sd(agg.slice(i - LW + 1, i + 1));
    lR.push(agg[i]); lD.push(volIncl - volExcl);
  }
  const shp = (a: number[]) => mean(a) / (sd(a) || 1e-12) * Math.sqrt(HRS);
  rows.push({ sym, klass, lev: lR.length > 30 ? corr(lR, lD) : 0, benefit: shp(vt) - shp(bh), bhSharpe: shp(bh) });
}

// --- FX / metals / indices / energy ---
const FXSET = new Set(["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"]);
const symRows = await fetch(`${OWNED}/trd_fx_hourly?select=symbol`, { headers: hdr }).then((r) => r.json()).catch(() => []) as { symbol: string }[];
for (const sym of [...new Set((Array.isArray(symRows) ? symRows : []).map((x) => x.symbol))]) {
  const px: number[] = [];
  for (let off = 0;; off += 50000) {
    const rs = await fetch(`${OWNED}/trd_fx_hourly?symbol=eq.${sym}&select=ts,c&order=ts&offset=${off}&limit=50000`, { headers: hdr })
      .then((r) => r.json()).catch(() => []) as { c: number }[];
    if (!Array.isArray(rs) || !rs.length) break;
    for (const r of rs) if (r.c > 0) px.push(r.c);
    if (rs.length < 50000) break;
  }
  const rets: number[] = []; for (let i = 1; i < px.length; i++) rets.push(px[i] / px[i - 1] - 1);
  analyse(sym, FXSET.has(sym) ? "fx" : "risk", rets, FXSET.has(sym) ? 1 : 3);
}

// --- CRYPTO: the held-out set. Not part of the observation that generated the hypothesis. ---
const meta = await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1hSF&select=symbol,n_bars&order=n_bars.desc&limit=${K.NCRYPTO}`, { headers: hdr })
  .then((r) => r.json()).catch(() => []) as { symbol: string; n_bars: number }[];
for (const m of Array.isArray(meta) ? meta : []) {
  const rs = await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1hSF&symbol=eq.${m.symbol}&select=bars`, { headers: hdr })
    .then((r) => r.json()).catch(() => []) as { bars: number[][] }[];
  const raw = rs?.[0]?.bars; if (!raw?.length) continue;
  const px: number[] = []; for (const b of raw) if (b[4] > 0) px.push(b[4]);
  const rets: number[] = []; for (let i = 1; i < px.length; i++) rets.push(px[i] / px[i - 1] - 1);
  analyse(m.symbol, "crypto", rets, 9);
}

assertNonEmpty("instruments analysed", rows, 14);
rows.sort((a, b) => a.lev - b.lev);
console.log(`\n==> LEVERAGE EFFECT vs VOL-TARGETING BENEFIT — ${rows.length} instruments (${rows.filter((r) => r.klass === "crypto").length} held-out crypto)\n`);
console.log(`    ${"instrument".padEnd(16)}${"class".padEnd(9)}${"leverage".padEnd(11)}${"VT benefit".padEnd(12)}BH Sharpe`);
for (const r of rows) console.log(`    ${r.sym.padEnd(16)}${r.klass.padEnd(9)}${r.lev.toFixed(4).padEnd(11)}${r.benefit.toFixed(3).padEnd(12)}${r.bhSharpe.toFixed(2)}`);

const lev = rows.map((r) => r.lev), ben = rows.map((r) => r.benefit), bhs = rows.map((r) => r.bhSharpe);
const ic = rankIC(lev, ben);
// Clause 2: partial out buy-and-hold Sharpe. Residualise BOTH sides on bhSharpe, then re-correlate.
const resid = (y: number[], x: number[]) => {
  const mx = mean(x), my = mean(y);
  const b = mean(x.map((v, i) => (v - mx) * (y[i] - my))) / (mean(x.map((v) => (v - mx) ** 2)) || 1e-12);
  return y.map((v, i) => v - (my + b * (x[i] - mx)));
};
const icPartial = rankIC(resid(lev, bhs), resid(ben, bhs));
const MIN = Number(K.MIN_IC);

console.log(`\n    rank IC(leverage effect, VT benefit)          = ${ic.toFixed(3)}   [pre-registered bar: <= -${MIN}]`);
console.log(`    rank IC after partialling out BH Sharpe       = ${icPartial.toFixed(3)}   [must survive]`);
console.log(`    rank IC(BH Sharpe, VT benefit) for reference  = ${rankIC(bhs, ben).toFixed(3)}`);
const pass = ic <= -MIN && icPartial <= -MIN;
console.log(`\n    ${pass ? "QUALIFIES — one parameter predicts where the risk gate works." : "DOES NOT QUALIFY under the pre-registered rule."}`);
if (!pass) {
  if (ic > -MIN) console.log(`      Clause 1 fails: |IC| ${Math.abs(ic).toFixed(3)} < ${MIN}, or wrong sign.`);
  else console.log(`      Clause 1 held but clause 2 fails: the relationship does not survive controlling for drift,`);
  console.log(`      so the honest statement is the weaker, already-known one — vol targeting flatters high-drift assets.`);
}
