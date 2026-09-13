#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// tsmom-book.ts (D-863) — PREREG: D-863-tsmom-multiasset. The diversified time-series momentum book the record never
// had: sign of trailing 1/3/6/12-month returns (and their equal-weight combination), positions scaled to a target
// per-asset vol from trailing 60-day vol, rebalanced weekly, class costs, across the multi-asset DAILY panel (single
// equities excluded). In-sample 1990-2014 is the POSITIVE CONTROL (the literature's own era must reproduce); OOS is
// 2015-2026, after publication. Then the leverage table the operator's tenfold target is really asking about.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("tsmom-book", [
  { name: "OOS_FROM", def: "2015-01-01" }, { name: "IS_FROM", def: "1990-01-01" }, { name: "VOL_TARGET", def: "0.10", note: "per-asset ex-ante annualised vol" },
  { name: "REBAL_D", def: "5", note: "trading days between rebalances (weekly)" }, { name: "MIN_YEARS", def: "10" }, { name: "MAX_CRYPTO", def: "10" },
  { name: "PLACEABLE", def: "0", note: "1 = D-866: restrict to what a UK retail account can hold (ETFs, index/sector ETFs, commodity CFD proxies, major FX) and charge overnight FINANCING on CFD legs and ETF shorts" },
  { name: "FINANCING", def: "0.065", note: "D-866: annual financing rate on gross CFD/short notional (SOFR ~4% + 2.5%); 0 = the research number" },
  { name: "RUN_ID", def: "D-863-tsmom-multiasset" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "tsm", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok }; const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 2 ? mean(a) / (sd(a) / Math.sqrt(a.length) || 1e-12) : 0;
const day = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const COST: Record<string, number> = { fx: 2, index: 4, intl_index: 4, rate: 4, etf: 4, sector: 4, commodity: 6, crypto: 9 };
const CLASS4 = (c: string) => c === "crypto" ? "crypto" : c === "fx" ? "fx" : c === "commodity" ? "commodity" : "equity-idx/rates";
// ---- panel ----
const meta = await q(`trd_bars_deep?asset_class=in.(commodity,fx,index,intl_index,rate,etf,sector,crypto)&select=symbol,asset_class,first_date,last_date,n_bars&order=first_date.asc`) as { symbol: string; asset_class: string; first_date: string; n_bars: number }[];
const cutoff = new Date(); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - +K.MIN_YEARS);
let sel = meta.filter((m) => m.first_date <= cutoff.toISOString().slice(0, 10) && m.n_bars > 2000 && !/^\^VIX$|USDT|^\^IRX$/.test(m.symbol));
const cryptoSel = sel.filter((m) => m.asset_class === "crypto").slice(0, +K.MAX_CRYPTO); sel = [...sel.filter((m) => m.asset_class !== "crypto"), ...cryptoSel];
const PLACEABLE_RE = /^(SPY|QQQ|DIA|IWM|IWF|IWD|EFA|EEM|EWJ|EWZ|EWG|EWU|EWH|EWA|EWC|FXI|VGK|TLT|IEF|SHY|LQD|HYG|GLD|SLV|USO|UNG|XL[IEBFVPYKU]|ITB|KRE|XLRE|SMH|VNQ|GC=F|SI=F|CL=F|BZ=F|HG=F|NG=F|PL=F|EURUSD=X|GBPUSD=X|JPY=X|AUDUSD=X|CAD=X|CHF=X|NZDUSD=X|EURGBP=X|EURJPY=X|GBPJPY=X|AUDJPY=X|EURCHF=X|\^GSPC|\^IXIC|\^DJI|\^RUT|\^FTSE|\^GDAXI|\^FCHI|\^N225|\^HSI|\^AXJO|\^STOXX50E)$/;
if (K.PLACEABLE === "1") { sel = sel.filter((m) => PLACEABLE_RE.test(m.symbol)); console.log(`  PLACEABLE subset: ${sel.length} assets a UK retail account can hold (ETF long / CFD both ways); financing ${(100 * +K.FINANCING).toFixed(1)}%/yr on gross CFD and short notional`); }
assertNonEmpty("assets with >= MIN_YEARS", sel, K.PLACEABLE === "1" ? 40 : 60);
type Ser = { sym: string; cls: string; ts: number[]; c: number[] };
const S: Ser[] = [];
for (let i = 0; i < sel.length; i += 5) { const page = sel.slice(i, i + 5); const rows = await q(`trd_bars_deep?symbol=in.(${page.map((p) => encodeURIComponent(p.symbol)).join(",")})&select=symbol,asset_class,bars`) as { symbol: string; asset_class: string; bars: number[][] }[]; for (const r of rows) { const b = (r.bars ?? []).filter((x) => x[4] > 0).sort((a, z) => a[0] - z[0]); S.push({ sym: r.symbol, cls: r.asset_class, ts: b.map((x) => x[0]), c: b.map((x) => x[4]) }); } }
console.log(`\n==> D-863 DIVERSIFIED TSMOM BOOK — ${S.length} assets: ${Object.entries(S.reduce((a, s) => (a[s.cls] = (a[s.cls] ?? 0) + 1, a), {} as Record<string, number>)).map(([k, v]) => `${k} ${v}`).join(", ")}`);
// ---- per-asset daily strategy returns for each signal, vol-scaled, weekly rebalance, cost on position changes ----
const LOOK = [21, 63, 126, 252]; const SIGS = [...LOOK.map(String), "combo"];
type Daily = Map<string, number>; // day -> return
const bookRet: Record<string, Daily> = {}; for (const s of SIGS) bookRet[s] = new Map(); const longRet: Daily = new Map();
const perAsset: Record<string, Record<string, number[]>> = {}; const perAssetLong: Record<string, number[]> = {};
const isOOS = (ts: number) => day(ts) >= K.OOS_FROM, isIS = (ts: number) => day(ts) >= K.IS_FROM && day(ts) < K.OOS_FROM;
const nDay = new Map<string, number>();
for (const a of S) {
  const n = a.c.length; if (n < 300) continue; const r = new Float64Array(n); for (let i = 1; i < n; i++) r[i] = Math.log(a.c[i] / a.c[i - 1]);
  const cost = COST[a.cls] / 1e4; perAsset[a.sym] = {}; perAssetLong[a.sym] = [];
  for (const sig of SIGS) {
    let pos = 0, lastReb = -1e9; const rets: number[] = [];
    for (let i = 260; i < n - 1; i++) {
      if (i - lastReb >= +K.REBAL_D) {
        lastReb = i; const vol = sd(Array.from(r.slice(i - 60, i))) * Math.sqrt(252); const scale = vol > 0 ? Math.min(3, +K.VOL_TARGET / vol) : 0;
        let sgn = 0; if (sig === "combo") { for (const L of LOOK) sgn += Math.sign(a.c[i] / a.c[i - L] - 1); sgn /= LOOK.length; } else sgn = Math.sign(a.c[i] / a.c[i - +sig] - 1);
        const newPos = sgn * scale; const turn = Math.abs(newPos - pos); pos = newPos; rets.push(-turn * cost / 2); // cost charged on the traded fraction (half a round trip per side)
      } else rets.push(0);
      const isEtf = a.cls === "etf" || a.cls === "sector"; const finDaily = (+K.FINANCING / 252) * (isEtf ? Math.max(0, -pos) : Math.abs(pos)) * (K.PLACEABLE === "1" ? 1 : 0);
      const v = pos * r[i + 1] + rets.pop()! - finDaily; // next-day return on the position set at close i (lag-1), minus overnight financing on CFD/short notional
      rets.push(v); const d = day(a.ts[i + 1]); const m = bookRet[sig]; m.set(d, (m.get(d) ?? 0) + v); if (sig === "combo") nDay.set(d, (nDay.get(d) ?? 0) + 1);
      if (sig === "combo" && isOOS(a.ts[i + 1])) perAsset[a.sym][sig] = perAsset[a.sym][sig] ?? [], perAsset[a.sym][sig].push(v);
      if (sig === "combo") { const vol = sd(Array.from(r.slice(Math.max(0, i - 60), i))) * Math.sqrt(252); const lv = (vol > 0 ? Math.min(3, +K.VOL_TARGET / vol) : 0) * r[i + 1]; longRet.set(d, (longRet.get(d) ?? 0) + lv); if (isOOS(a.ts[i + 1])) perAssetLong[a.sym].push(lv); }
    }
  }
}
// book = equal-weight across assets active that day (divide by count), so the book's ex-ante vol ~ VOL_TARGET/sqrt(N_eff)
const series = (m: Daily, filt: (ts: number) => boolean) => [...m.entries()].filter(([d]) => filt(Date.parse(d + "T00:00:00Z") / 1000)).sort().map(([d, v]) => v / Math.max(1, nDay.get(d) ?? 1));
const stats = (x: number[]) => { const mu = mean(x) * 252, vol = sd(x) * Math.sqrt(252); let eq = 0, peak = 0, mdd = 0, uw = 0, maxUw = 0; for (const v of x) { eq += v; if (eq > peak) { peak = eq; uw = 0; } else { uw++; maxUw = Math.max(maxUw, uw); } mdd = Math.min(mdd, eq - peak); } return { mu, vol, sr: vol ? mu / vol : 0, t: tstat(x), mdd, uwDays: maxUw, n: x.length }; };
const ceilInfo = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
await spendTrials({ rest: OWNED, headers: hdr, family: "tsmom", runId: K.RUN_ID, spent: SIGS.length * 2 });
console.log(`\n  ${"signal".padEnd(8)} ${"IS 1990-2014 Sharpe".padStart(20)} ${"OOS 2015+ Sharpe".padStart(17)} ${"OOS t".padStart(7)} ${"OOS %/yr".padStart(9)} ${"vol".padStart(6)} ${"maxDD".padStart(7)} ${"underwater".padStart(11)}`);
const res: Record<string, ReturnType<typeof stats>> = {};
for (const sig of SIGS) { const is = stats(series(bookRet[sig], isIS)), oos = stats(series(bookRet[sig], isOOS)); res[sig] = oos; console.log(`  ${sig.padEnd(8)} ${is.sr.toFixed(2).padStart(20)} ${oos.sr.toFixed(2).padStart(17)} ${oos.t.toFixed(2).padStart(7)} ${(100 * oos.mu).toFixed(1).padStart(8)}% ${(100 * oos.vol).toFixed(1).padStart(5)}% ${(100 * oos.mdd).toFixed(0).padStart(6)}% ${(oos.uwDays / 252).toFixed(1).padStart(9)}y`); }
const lo = stats(series(longRet, isOOS)); console.log(`  ${"long-only".padEnd(8)} ${"".padStart(20)} ${lo.sr.toFixed(2).padStart(17)} ${lo.t.toFixed(2).padStart(7)} ${(100 * lo.mu).toFixed(1).padStart(8)}% ${(100 * lo.vol).toFixed(1).padStart(5)}%   (vol-matched long basket, the benchmark)`);
const comboIS = stats(series(bookRet["combo"], isIS));
console.log(`\n  POSITIVE CONTROL: IS 1990-2014 combo Sharpe ${comboIS.sr.toFixed(2)} [needs > 0.4 — the literature's own era must reproduce]`);
// excess over the long basket, day by day
const co = bookRet["combo"]; const exd: number[] = []; for (const [d, v] of co) if (isOOS(Date.parse(d + "T00:00:00Z") / 1000) && longRet.has(d)) exd.push((v - longRet.get(d)!) / Math.max(1, nDay.get(d) ?? 1));
const ex = stats(exd);
// per class, per asset agreement (OOS, combo)
const byCls: Record<string, number[]> = {}; let posA = 0, nA = 0; const assetLines: string[] = [];
for (const a of S) { const v = perAsset[a.sym]?.combo; if (!v || v.length < 500) continue; nA++; const m = mean(v) * 252; if (m > 0) posA++; (byCls[CLASS4(a.cls)] ??= []).push(m); assetLines.push(`${a.sym}:${(100 * m).toFixed(1)}`); }
console.log(`\n  OOS BY CLASS (mean per-asset %/yr at ${(100 * +K.VOL_TARGET).toFixed(0)}% vol): ${Object.entries(byCls).map(([c, v]) => `${c} ${(100 * mean(v)).toFixed(1)}% (${v.filter((x) => x > 0).length}/${v.length} +)`).join(" | ")}`);
console.log(`  OOS asset agreement: ${posA}/${nA} positive; excess over vol-matched long basket ${(100 * ex.mu).toFixed(1)}%/yr t ${ex.t.toFixed(2)}`);
// leverage table for the combo book
const oosCombo = series(bookRet["combo"], isOOS); const baseVol = sd(oosCombo) * Math.sqrt(252);
console.log(`\n  LEVERAGE TABLE (combo book, OOS, scaled from its realised ${(100 * baseVol).toFixed(1)}% vol; costs scale with leverage):`);
console.log(`  ${"target vol".padEnd(11)} ${"%/yr".padStart(7)} ${"maxDD".padStart(7)} ${"underwater".padStart(11)} ${"years to 10x".padStart(13)}`);
for (const tv of [0.10, 0.20, 0.40]) { const lev = tv / (baseVol || 1); const x = oosCombo.map((v) => v * lev); const st = stats(x); const g = st.mu - st.vol * st.vol / 2; console.log(`  ${(100 * tv).toFixed(0).padStart(9)}% ${(100 * st.mu).toFixed(1).padStart(6)}% ${(100 * st.mdd).toFixed(0).padStart(6)}% ${(st.uwDays / 252).toFixed(1).padStart(9)}y ${(g > 0 ? (Math.log(10) / g).toFixed(1) + "y" : "never").padStart(13)}`); }
const R = res["combo"]; const classes = Object.values(byCls).filter((v) => mean(v) > 0).length;
const ok = comboIS.sr > 0.4 && R.sr >= 0.5 && R.t >= ceilInfo.ceiling && posA / Math.max(1, nA) >= 0.6 && classes >= 3 && ex.mu > 0 && ex.t >= 2;
console.log(`\n  ceiling for this id ${ceilInfo.ceiling.toFixed(3)}`);
console.log(`  VERDICT (D-863 rule): ${comboIS.sr <= 0.4 ? "UNTESTED — positive control failed (in-sample era does not reproduce)" : ok ? "SUPPORTED" : `NULL — ${[R.sr < 0.5 && `OOS Sharpe ${R.sr.toFixed(2)} < 0.5`, R.t < ceilInfo.ceiling && `t ${R.t.toFixed(2)} < ceiling`, posA / Math.max(1, nA) < 0.6 && "asset agreement < 60%", classes < 3 && "fewer than 3 classes positive", !(ex.mu > 0 && ex.t >= 2) && "excess over long basket fails"].filter(Boolean).join("; ")}`}`);
await Deno.writeTextFile(new URL("../data/tsmom-oos-assets.json", import.meta.url).pathname, JSON.stringify({ prereg: K.RUN_ID, oos_from: K.OOS_FROM, assets: assetLines }, null, 1));
