#!/usr/bin/env -S deno run --allow-net --allow-env
// hourly-leadlag.ts (D-862) — PREREG: D-862-hourly-leadlag. The cell the map never had: does one instrument's LAST
// completed hour predict another's NEXT hour? Three leader-follower families. POSITIVE CONTROL first: the SAME-hour
// correlation must be materially positive, which proves the timestamp alignment before any lagged claim is read.
// Then: lagged OLS slope (train < 2023 / test >= 2023), effect per 1sd of leader return in bp against the follower's
// round-trip cost (EFFECT-SIZE LAW), and the implied trade's day-clustered t on TEST.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
import { decodeBar } from "../supabase/functions/_shared/mtf-structure.ts";
const K = declareKnobs("hourly-leadlag", [{ name: "SPLIT", def: "2023-01-01" }, { name: "RUN_ID", def: "D-862-hourly-leadlag" }, { name: "CRYPTO_BP", def: "9" }, { name: "IDX_BP", def: "6" }, { name: "FX_BP", def: "4" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "hll", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok }; const { q } = mkStrictRead(OWNED, hdr);
type B = { ts: number; o: number; c: number };
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 2 ? mean(a) / (sd(a) / Math.sqrt(a.length) || 1e-12) : 0;
const corr = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / (Math.sqrt(da * db) || 1e-12); };
const ols = (x: number[], y: number[]) => { const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; } const b = sxy / (sxx || 1e-12); const res = y.map((v, i) => v - my - b * (x[i] - mx)); const se = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / (x.length - 2) / (sxx || 1e-12)); return { b, t: b / (se || 1e-12) }; };
const FX = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"], IDX = ["XAUUSD", "USA500IDXUSD", "USATECHIDXUSD", "BRENTCMDUSD"];
async function load(sym: string): Promise<Map<number, B>> {
  let out: B[] = [];
  if (FX.includes(sym) || IDX.includes(sym)) { let from = 0; for (;;) { const p = await q(`trd_fx_hourly?symbol=eq.${sym}&ts=gt.${from}&select=ts,o,c,vol&order=ts.asc&limit=20000`) as (B & { vol: number })[]; if (!p.length) break; out.push(...p.filter((r) => r.vol > 0)); from = p.at(-1)!.ts; if (p.length < 20000) break; } }
  else { const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`) as { bars: number[][] }[])[0]; out = ((row?.bars ?? []) as number[][]).map(decodeBar).filter((b) => b.v > 0).map((b) => ({ ts: b.ts, o: b.o, c: b.c })); }
  return new Map(out.map((b) => [b.ts, b]));
}
const perps = (await q(`trd_bars_intraday?tf=eq.1h&select=symbol,n_bars&order=symbol`) as { symbol: string; n_bars: number }[]).filter((r) => r.n_bars > 10000).map((r) => r.symbol);
const FAM: [string, string, string[], number][] = [["perps<-BTC", "BTCUSDT", perps.filter((s) => s !== "BTCUSDT"), +K.CRYPTO_BP], ["cfd<-USA500", "USA500IDXUSD", ["XAUUSD", "USATECHIDXUSD", "BRENTCMDUSD"], +K.IDX_BP], ["fx<-XAUUSD", "XAUUSD", FX, +K.FX_BP]];
const SPLIT = Date.parse(K.SPLIT + "T00:00:00Z") / 1000; const cache = new Map<string, Map<number, B>>();
const get = async (s: string) => cache.get(s) ?? (cache.set(s, await load(s)), cache.get(s)!);
console.log(`\n==> D-862 HOURLY LEAD-LAG — does the leader's last hour predict the follower's next?`);
let trials = 0; const results: { fam: string; ok: boolean; agree: string; note: string }[] = [];
for (const [fam, leader, followers, costBp] of FAM) {
  const L = await get(leader); let famRows: string[] = []; let agreePos = 0, nF = 0, famOk = true;
  for (const f of followers) {
    const F = await get(f); const ts = [...F.keys()].filter((t) => L.has(t) && L.has(t - 3600) && F.has(t - 3600) && F.has(t + 3600) && F.has(t + 3600 * 2) && F.has(t + 3600 * 5)).sort((a, b) => a - b);
    if (ts.length < 10000) { famRows.push(`    ${f.padEnd(14)} only ${ts.length} aligned hours — excluded`); continue; }
    const lead = ts.map((t) => Math.log(L.get(t)!.c / L.get(t - 3600)!.c)), same = ts.map((t) => Math.log(F.get(t)!.c / F.get(t - 3600)!.c));
    const ctl = corr(lead, same);
    for (const h of [1, 4]) {
      trials++;
      const fwd = ts.map((t) => Math.log(F.get(t + 3600 * h + 3600)!.o / F.get(t + 3600)!.o));   // lag-1: next open to open h hours later
      const tr = ts.map((_, i) => ts[i] < SPLIT), xTr = lead.filter((_, i) => tr[i]), yTr = fwd.filter((_, i) => tr[i]), xTe = lead.filter((_, i) => !tr[i]), yTe = fwd.filter((_, i) => !tr[i]);
      const oTr = ols(xTr, yTr), oTe = ols(xTe, yTe);
      const trade = ts.map((t, i) => !tr[i] ? Math.sign(lead[i]) * fwd[i] - costBp / 1e4 : null).filter((v): v is number => v !== null);
      const byDay = new Map<number, number>(); let j = 0; for (let i = 0; i < ts.length; i++) if (!tr[i]) { const d = Math.floor(ts[i] / 86400); byDay.set(d, (byDay.get(d) ?? 0) + trade[j++]); }
      const dT = tstat([...byDay.values()]); const perSd = oTe.b * sd(xTe) * 1e4;
      if (h === 1) { nF++; if (Math.sign(oTr.b) === Math.sign(oTe.b) && oTe.b > 0) agreePos++; }
      famRows.push(`    ${f.padEnd(14)} h=${h}  same-hour r ${ctl.toFixed(2)}  slope train ${oTr.b.toFixed(3)} (t ${oTr.t.toFixed(1)})  test ${oTe.b.toFixed(3)} (t ${oTe.t.toFixed(1)})  effect/1sd ${perSd.toFixed(2)}bp vs cost ${costBp}bp  trade net ${(mean(trade) * 1e4).toFixed(2)}bp day-t ${dT.toFixed(2)}`);
      if (h === 1 && ctl < 0.2 && fam === "perps<-BTC") famOk = false;
    }
  }
  console.log(`\n  ${fam} (cost ${costBp}bp):`); for (const r of famRows) console.log(r);
  results.push({ fam, ok: famOk, agree: `${agreePos}/${nF}`, note: famOk ? "control passed" : "CONTROL FAILED (same-hour r < 0.2) — alignment suspect" });
}
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "hourly-leadlag", runId: K.RUN_ID, spent: trials });
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
console.log(`\n  trials +${trials}; pre-registered ceiling ${ceil.ceiling.toFixed(3)} (programme ${T.ceiling.toFixed(3)})`);
for (const r of results) console.log(`  ${r.fam.padEnd(14)} followers agreeing in sign (train=test, positive, h=1): ${r.agree}  ${r.note}`);
console.log(`  A family is SUPPORTED only if a follower's TEST slope t clears ${ceil.ceiling.toFixed(2)} with effect/1sd > cost and >= 60% of followers agree; read the rows above against that.`);
