#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// gex-vol-sizing.ts (D-968) — the ONLY admissible use of the validated gamma mechanism (D-961/967: vol, never
// direction), tested as a decision: does GEX improve the NEXT-DAY vol forecast BEYOND trailing realized vol?
// If yes, better vol-targeting follows mechanically (sizing error shrinks); if no, the mechanism is priced into
// trailing vol already and the ledger records that. PRE-SPECIFIED: train = first 2/3 of the 454-day panel, fit
// OLS log(nextRV) ~ a + b*log(ewmaRV) + c*gexZ on TRAIN ONLY, freeze, apply to test; metric = test MSE vs the
// same regression WITHOUT the GEX term (nested). Registered direction: c < 0 (high GEX -> lower next vol) and
// test MSE improves. Sizing translation: mean |realized-target| vol error at exposure = target/predVol, both
// models, test only. 2 trials (BW 1%/2%), spent.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("gex-vol-sizing", [
  { name: "OI", def: "data/databento/spxw-oi-merged.jsonl" }, { name: "SYM", def: "USA500IDXUSD" },
  { name: "RUN_ID", def: "D-968-gex-vol-sizing" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "gvs", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const t = await jwt(); const hdr = { Authorization: `Bearer ${t}`, apikey: t }; const { q } = mkStrictRead(OWNED, hdr);
const REPO = new URL("..", import.meta.url).pathname;
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const oiDays = (await Deno.readTextFile(`${REPO}${K.OI}`)).split("\n").filter(Boolean).map((l) => JSON.parse(l)) as { d: string; rows: [string, string, number, number][] }[];
assertNonEmpty("OI days", oiDays, 300); const oiByDay = new Map(oiDays.map((x) => [x.d, x.rows]));
const bars: { ts: number; o: number; c: number }[] = []; for (let off = 0; ; off += 50000) { const p = await q(`trd_fx_hourly?symbol=eq.${K.SYM}&select=ts,o,c&order=ts.asc&offset=${off}&limit=50000`) as { ts: number; o: number; c: number }[]; for (const r of p) if (r.c > 0) bars.push(r); if (p.length < 50000) break; }
const dayOf = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const byDay = new Map<string, { c: number; rv: number }>(); { const tmp = new Map<string, number[]>(); for (const b of bars) (tmp.get(dayOf(b.ts)) ?? tmp.set(dayOf(b.ts), []).get(dayOf(b.ts))!).push(b.c);
  for (const [d, cs] of tmp) { let rv = 0; for (let i = 1; i < cs.length; i++) rv += Math.abs(Math.log(cs[i] / cs[i - 1])); byDay.set(d, { c: cs[cs.length - 1], rv }); } }
const days = [...byDay.keys()].sort();
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "gex-vol-sizing", runId: K.RUN_ID, spent: 2 });
console.log(`\n==> D-968 GEX VOL-SIZING — nested forecast test on the 3-regime panel. Trials 2; ceiling ${T.ceiling.toFixed(3)} at N=${T.N.toLocaleString()}.`);
for (const BW of [0.01, 0.02]) {
  type R = { lnNext: number; lnEwma: number; gz: number };
  const rows: R[] = []; let ewma = 0;
  for (let i = 1; i < days.length - 1; i++) {
    const d = days[i]; const rv = byDay.get(d)!.rv; ewma = ewma === 0 ? rv : 0.9 * ewma + 0.1 * rv;
    const oi = oiByDay.get(d); if (!oi) continue; const S = byDay.get(days[i - 1])!.c;
    let gex = 0; for (const r of oi) { if (r[0] < d) continue; gex += (r[1] === "C" ? 1 : -1) * r[3] * Math.exp(-(((r[2] - S) / (BW * S)) ** 2)); }
    const nx = byDay.get(days[i + 1])!.rv; if (!(nx > 0 && ewma > 0)) continue;
    rows.push({ lnNext: Math.log(nx), lnEwma: Math.log(ewma), gz: gex });
  }
  const cut = Math.floor(rows.length * 2 / 3); const tr = rows.slice(0, cut), te = rows.slice(cut);
  const gm = mean(tr.map((r) => r.gz)), gs = Math.sqrt(mean(tr.map((r) => (r.gz - gm) ** 2))) || 1;
  const z = (g: number) => (g - gm) / gs;
  // OLS on train: with and without the GEX term (normal equations, 2/3 predictors)
  const fit = (useG: boolean) => { const X = tr.map((r) => useG ? [1, r.lnEwma, z(r.gz)] : [1, r.lnEwma]); const Y = tr.map((r) => r.lnNext);
    const k = X[0].length; const XtX = Array.from({ length: k }, () => new Array(k).fill(0)); const XtY = new Array(k).fill(0);
    for (let i = 0; i < X.length; i++) { for (let a = 0; a < k; a++) { XtY[a] += X[i][a] * Y[i]; for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b]; } }
    // gaussian elimination
    const M = XtX.map((row, i) => [...row, XtY[i]]);
    for (let col = 0; col < k; col++) { let piv = col; for (let r2 = col + 1; r2 < k; r2++) if (Math.abs(M[r2][col]) > Math.abs(M[piv][col])) piv = r2; [M[col], M[piv]] = [M[piv], M[col]];
      for (let r2 = 0; r2 < k; r2++) { if (r2 === col || !M[col][col]) continue; const f = M[r2][col] / M[col][col]; for (let c2 = col; c2 <= k; c2++) M[r2][c2] -= f * M[col][c2]; } }
    return M.map((row, i) => row[k] / (row[i] || 1e-12)); };
  const bG = fit(true), b0 = fit(false);
  const mseG = mean(te.map((r) => (r.lnNext - (bG[0] + bG[1] * r.lnEwma + bG[2] * z(r.gz))) ** 2));
  const mse0 = mean(te.map((r) => (r.lnNext - (b0[0] + b0[1] * r.lnEwma)) ** 2));
  // sizing translation: exposure = TGT/pred; realized daily vol error |exposure*rv_next - TGT|
  const TGT = Math.exp(mean(tr.map((r) => r.lnNext)));                       // target = train-mean daily RV (scale-free choice)
  const errG = mean(te.map((r) => Math.abs(Math.exp(r.lnNext) * TGT / Math.exp(bG[0] + bG[1] * r.lnEwma + bG[2] * z(r.gz)) - TGT)));
  const err0 = mean(te.map((r) => Math.abs(Math.exp(r.lnNext) * TGT / Math.exp(b0[0] + b0[1] * r.lnEwma) - TGT)));
  console.log(`  BW ${(100 * BW).toFixed(0)}% (n ${rows.length}, train ${tr.length}/test ${te.length}): c_gex ${bG[2].toFixed(3)} ${bG[2] < 0 ? "(registered sign matched)" : "(SIGN MISSED)"}`);
  console.log(`    TEST forecast MSE: ewma-only ${mse0.toFixed(4)} -> +GEX ${mseG.toFixed(4)}  (${(100 * (1 - mseG / mse0)).toFixed(1)}% ${mseG < mse0 ? "better" : "WORSE"})`);
  console.log(`    TEST vol-target tracking error: ${err0.toFixed(5)} -> ${errG.toFixed(5)}  (${(100 * (1 - errG / err0)).toFixed(1)}% ${errG < err0 ? "tighter" : "WORSE"})`);
}
console.log(`  READ: nested OOS comparison, coefficients frozen on train (D-455). An improvement here is a sizing gain for ANY vol-targeted book (the blend targets ${"20%"}); a null means trailing vol already carries the gamma information.`);
