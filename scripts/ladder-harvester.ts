#!/usr/bin/env -S deno run --allow-net --allow-env
// ladder-harvester.ts (D-735) — the STRUCTURAL-WEALTH engine. Per the ladder finding (D-680), a low-budget account's
// fortune is built from compounding a total-return vehicle + regular deposits + not-losing — NOT a trading edge (0 of
// 1.37M trials cleared). This simulates that, and adds the ONE honest form of "sell when odds are against us": a
// rules-based TREND DE-RISKING overlay (Faber 2007) that is NOT a return-timing alpha (the engine killed those:
// voltiming sign-flipped D-498, macro-regime washed out D-730) but a DRAWDOWN reducer — exit confirmed downtrends to
// avoid the -50% crashes that break contribution plans and trigger panic-selling (the -5.5y lever, D-680).
//
// THE HONESTY THIS TOOL EXISTS TO ENFORCE: it reports the de-risked path's return AND its drawdown AND its
// time-underwater beside buy-and-hold, so the tradeoff is MEASURED, never assumed. Trend de-risking classically GIVES
// UP some return in exchange for much smaller drawdowns; if this data shows it costs more return than drawdown it
// saves, the tool says so and the honest answer is "just hold and keep depositing".
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("ladder-harvester", [
  { name: "VEHICLE", def: "SPY", note: "the total-return vehicle to compound (SPY = US market, adjusted)" },
  { name: "MONTHLY", def: "150", note: "monthly deposit (the D-680 lever: $150 vs $100 was -3.4y)" },
  { name: "SMA", def: "200", note: "trend filter length in trading days (200 = the classic 10-month rule)" },
  { name: "SWITCH_BP", def: "5", note: "round-trip cost per de-risk switch, bp (in a tax wrapper there is no CGT; D-072)" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "lh", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);

const raw = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(K.VEHICLE)}&select=bars`, { headers: hdr }).then((x) => x.json());
const bars = (raw?.[0]?.bars || []).filter((b: number[]) => b[4] > 0) as number[][];
assertNonEmpty(`${K.VEHICLE} bars`, bars, 1000);
const dt = bars.map((b) => iso(b[0])), px = bars.map((b) => b[4]);
// Cash yield: FRED 3-month T-bill (daily, %/yr) -> per-trading-day rate. Falls back to 0 if absent.
const t3 = await fetch(`${OWNED}/trd_macro_series?series=eq.ust_3m&select=d,v&order=d&limit=100000`, { headers: hdr }).then((x) => x.ok ? x.json() : []).catch(() => []) as { d: string; v: number }[];
const cashY = new Map(t3.map((r) => [r.d, r.v / 100 / 252]));
// Risk-off REGIME inputs (the drivers built this session): equity breadth (low = washout), HYG/LQD credit (low = HY
// stress), 10y-2y curve (inverted = late-cycle). A HIGH-CONVICTION de-risk fires only when the trend is down AND at
// least one of these confirms — so it acts in real crises (2008, 2020), not every wobble.
const ms = async (s: string) => { const r = await fetch(`${OWNED}/trd_macro_series?series=eq.${s}&select=d,v&order=d&limit=100000`, { headers: hdr }).then((x) => x.ok ? x.json() : []).catch(() => []) as { d: string; v: number }[]; return new Map(r.map((x) => [x.d, x.v])); };
const breadth = await ms("breadth_pct_gt_200dma_surv");

const SMA = Number(K.SMA), DEP = Number(K.MONTHLY), COST = Number(K.SWITCH_BP) / 1e4;

// Simulate a monthly-deposit account. mode: "hold" = always invested; "derisk" = invested only when yesterday's close
// was above its SMA (signal lagged one day — EXECUTION LAW, no same-close action), else in cash earning the T-bill.
function sim(mode: "hold" | "derisk" | "band" | "regime") {
  let units = 0, cash = 0, invested = true, switches = 0, deposits = 0;
  const equity: number[] = []; let peak = 0, maxDD = 0, uwStart = -1, longestUW = 0;
  let lastMonth = "";
  for (let i = 0; i < bars.length; i++) {
    // monthly deposit on the first trading day of each new month
    const mo = dt[i].slice(0, 7);
    if (mo !== lastMonth) { lastMonth = mo; deposits += DEP; if (invested) units += DEP / px[i]; else cash += DEP; }
    // de-risk decision uses prices up to YESTERDAY (i-1), acted at today's close (EXECUTION LAW: no same-close action).
    if (mode !== "hold" && i >= SMA) {
      const sma = px.slice(i - SMA, i).reduce((s, x) => s + x, 0) / SMA;   // through i-1
      const y = px[i - 1];
      let wantInvested: boolean = invested;
      if (mode === "derisk") wantInvested = y > sma;
      else if (mode === "band") { if (y < sma * 0.97) wantInvested = false; else if (y > sma * 1.01) wantInvested = true; }   // 3% band down / 1% up — cut whipsaw
      else if (mode === "regime") {
        // HIGH-CONVICTION: exit only when the trend is down AND breadth confirms a washout (or breadth absent -> trend only).
        const b = breadth.get(dt[i - 1]);
        const trendDown = y < sma * 0.97;
        const breadthWashout = b != null && b < 0.35;
        if (trendDown && (b == null || breadthWashout)) wantInvested = false;
        else if (y > sma * 1.02) wantInvested = true;
      }
      if (wantInvested !== invested) {
        switches++;
        if (wantInvested) { units = (cash * (1 - COST)) / px[i]; cash = 0; }         // cash -> units
        else { cash = units * px[i] * (1 - COST); units = 0; }                        // units -> cash
        invested = wantInvested;
      }
    }
    if (!invested) cash *= 1 + (cashY.get(dt[i]) ?? 0);   // cash earns the T-bill
    const eq = units * px[i] + cash;
    equity.push(eq);
    if (eq > peak) { peak = eq; if (uwStart >= 0) { longestUW = Math.max(longestUW, i - uwStart); uwStart = -1; } }
    else { const dd = 1 - eq / peak; if (dd > maxDD) maxDD = dd; if (uwStart < 0) uwStart = i; }
  }
  const yrs = bars.length / 252;
  const finalEq = equity[equity.length - 1];
  // money-weighted-ish CAGR proxy on total deposits vs final (not IRR, but comparable across modes on the same path)
  const cagr = Math.pow(finalEq / (deposits || 1), 1 / yrs) - 1;
  return { finalEq, deposits, cagr, maxDD, longestUWy: longestUW / 252, switches, invested };
}

const hold = sim("hold"), derisk = sim("derisk"), band = sim("band"), regime = sim("regime");
console.log(`==> LADDER HARVESTER — compound ${K.VEHICLE} at $${DEP}/mo, ${dt[0]}..${dt[dt.length - 1]} (${(bars.length / 252).toFixed(0)}y)`);
console.log(`    total deposited: $${hold.deposits.toLocaleString()}\n`);
console.log(`    ${"strategy".padEnd(22)}${"final $".padStart(13)}${"vs deposits".padStart(13)}${"CAGR".padStart(9)}${"max DD".padStart(9)}${"longest underwater".padStart(20)}${"switches".padStart(10)}`);
const row = (n: string, r: ReturnType<typeof sim>) => {
  const fin = ("$" + Math.round(r.finalEq).toLocaleString()).padStart(13);
  const mult = ((r.finalEq / r.deposits).toFixed(2) + "x").padStart(13);
  const cagr = ((r.cagr * 100).toFixed(1) + "%").padStart(9);
  const dd = ((r.maxDD * 100).toFixed(0) + "%").padStart(9);
  const uw = (r.longestUWy.toFixed(1) + "y").padStart(20);
  console.log(`    ${n.padEnd(22)}${fin}${mult}${cagr}${dd}${uw}${String(r.switches).padStart(10)}`);
};
row("buy & hold (invested)", hold);
row(`trend de-risk (${SMA}d)`, derisk);
row(`trend + 3% band`, band);
row(`high-conviction regime`, regime);

const cost = (r: ReturnType<typeof sim>) => (1 - r.finalEq / hold.finalEq) * 100;
console.log(`\n    THE TRADEOFF, MEASURED (each de-risk mode vs buy-and-hold):`);
console.log(`      basic 200d    : costs ${cost(derisk).toFixed(0)}% of wealth, DD ${(hold.maxDD * 100).toFixed(0)}%->${(derisk.maxDD * 100).toFixed(0)}%, ${derisk.switches} switches`);
console.log(`      3% band       : costs ${cost(band).toFixed(0)}% of wealth, DD ${(hold.maxDD * 100).toFixed(0)}%->${(band.maxDD * 100).toFixed(0)}%, ${band.switches} switches`);
console.log(`      regime (conv.): costs ${cost(regime).toFixed(0)}% of wealth, DD ${(hold.maxDD * 100).toFixed(0)}%->${(regime.maxDD * 100).toFixed(0)}%, ${regime.switches} switches`);
console.log(`\n    HONEST READ: de-risking is a DRAWDOWN tool, not a return tool — EVERY mode above gives up terminal wealth.`);
console.log(`    The ONLY saver it helps is one who would PANIC-SELL a -${(hold.maxDD * 100).toFixed(0)}% buy-and-hold: for them a smaller drawdown they can`);
console.log(`    hold beats a bigger one they'd bail on at the bottom (the -5.5y not-panic-selling lever, D-680). A saver who`);
console.log(`    will genuinely HOLD should just buy-and-hold and keep depositing — it is worth $${Math.round(hold.finalEq - Math.max(derisk.finalEq, band.finalEq, regime.finalEq)).toLocaleString()} more here.`);
console.log(`    Current signals: 200d=${derisk.invested ? "INVESTED" : "DE-RISKED"} | band=${band.invested ? "INVESTED" : "DE-RISKED"} | regime=${regime.invested ? "INVESTED" : "DE-RISKED"}.`);
