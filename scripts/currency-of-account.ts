#!/usr/bin/env -S deno run --allow-net --allow-env
// currency-of-account.ts (D-731) — closes the "currency of account / FX exposure" untested approach (D-697). For a
// GBP-based investor (the operator) holding a USD-denominated market, the realised return and RISK differ from the
// headline USD numbers by the FX path. This is a STRUCTURAL decomposition, not a timing signal — so it sidesteps the
// non-stationarity trap that killed D-730's forward test: it measures what the FX exposure DID, not whether it can be
// predicted. Compares SPY total return in USD vs unhedged GBP vs (synthetically) hedged GBP over the FX history held.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("currency-of-account", []);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "coa", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };

async function closes(sym: string): Promise<Map<string, number>> {
  const raw = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`, { headers: hdr }).then((x) => x.json()).catch(() => []);
  const bars = (raw?.[0]?.bars || []).filter((b: number[]) => b[4] > 0);
  return new Map(bars.map((b: number[]) => [iso(b[0]), b[4]]));
}

const spy = await closes("SPY");                 // USD total-return (adjusted)
const gbpusd = await closes("GBPUSD=X");          // USD per GBP
const dates = [...spy.keys()].filter((d) => gbpusd.has(d)).sort();
assertNonEmpty("aligned SPY/GBP days", dates, 500);

// Daily log-returns: USD, unhedged GBP (= USD price / (USD-per-GBP), so GBP investor loses when GBP strengthens),
// and hedged GBP (the USD return with the FX term removed — what a perfect currency hedge would deliver, ex-cost).
const usd: number[] = [], gbp: number[] = [], hedged: number[] = [], fx: number[] = [];
for (let i = 1; i < dates.length; i++) {
  const s0 = spy.get(dates[i - 1])!, s1 = spy.get(dates[i])!;
  const f0 = gbpusd.get(dates[i - 1])!, f1 = gbpusd.get(dates[i])!;
  const rUsd = Math.log(s1 / s0);
  const rFx = Math.log(f1 / f0);                 // GBP appreciation vs USD
  usd.push(rUsd); fx.push(rFx); gbp.push(rUsd - rFx); hedged.push(rUsd);   // hedged ~= USD return (FX neutralised)
}
const yr = 252;
const ann = (a: number[]) => (Math.exp(mean(a) * yr) - 1) * 100;
const vol = (a: number[]) => sd(a) * Math.sqrt(yr) * 100;
const sharpe = (a: number[]) => (mean(a) * yr) / (sd(a) * Math.sqrt(yr) || 1e-9);

console.log(`==> CURRENCY OF ACCOUNT — SPY held by a GBP investor, ${dates[0]}..${dates[dates.length - 1]} (${dates.length} days)\n`);
console.log(`    ${"basis".padEnd(20)}${"ann return".padStart(12)}${"ann vol".padStart(10)}${"Sharpe".padStart(9)}`);
console.log(`    ${"USD (home=USD)".padEnd(20)}${(ann(usd).toFixed(2) + "%").padStart(12)}${(vol(usd).toFixed(1) + "%").padStart(10)}${sharpe(usd).toFixed(2).padStart(9)}`);
console.log(`    ${"GBP unhedged".padEnd(20)}${(ann(gbp).toFixed(2) + "%").padStart(12)}${(vol(gbp).toFixed(1) + "%").padStart(10)}${sharpe(gbp).toFixed(2).padStart(9)}`);
console.log(`    ${"GBP hedged (ex-cost)".padEnd(20)}${(ann(hedged).toFixed(2) + "%").padStart(12)}${(vol(hedged).toFixed(1) + "%").padStart(10)}${sharpe(hedged).toFixed(2).padStart(9)}`);
console.log(`    ${"[FX term alone]".padEnd(20)}${(ann(fx).toFixed(2) + "%").padStart(12)}${(vol(fx).toFixed(1) + "%").padStart(10)}${"".padStart(9)}`);

const dRet = ann(gbp) - ann(usd), dVol = vol(gbp) - vol(usd);
console.log(`\n    FINDING: unhedged GBP exposure moved the annual return by ${dRet >= 0 ? "+" : ""}${dRet.toFixed(2)}pp and vol by ${dVol >= 0 ? "+" : ""}${dVol.toFixed(1)}pp vs USD.`);
console.log(`    The FX term contributed ${ann(fx) >= 0 ? "+" : ""}${ann(fx).toFixed(2)}%/yr of GBP appreciation (a drag on USD-asset returns when positive)`);
console.log(`    at ${vol(fx).toFixed(1)}% standalone vol. Hedging removes that ${vol(fx).toFixed(1)}% of noise but costs the rate differential (not modelled).`);
console.log(`\n    VERDICT (structural, not a signal): currency of account is a REAL and MEASURABLE effect on a UK investor's`);
console.log(`    realised return and risk — recorded so the ladder's base-currency choice is an informed one, not a`);
console.log(`    default. It is not a market edge; it is a fact about whose money is measuring the return (INSTRUMENT LAW`);
console.log(`    at the portfolio level). The hedge decision trades FX vol for the rate-differential carry cost.`);
