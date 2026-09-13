#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// pair-governor.ts (D-878) — PREREG: D-878-risk-governed-pair-paper. The risk machine on the pair's 2020-2026 history:
// 20% vol target from trailing 60-day pair vol, gross leverage capped 3x, drawdown governor (halve below -15% from the
// governed equity peak, quarter below -25%, restore as the peak is regained). Judged against the un-governed 20% book.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("pair-governor", [{ name: "A", def: "data/d873b-isa.json" }, { name: "B", def: "data/d873b-cryptosf.json" }, { name: "TARGET", def: "0.20" }, { name: "CAP", def: "3" }, { name: "RUN_ID", def: "D-878-risk-governed-pair-paper" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "pg", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok };
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length); const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const A = JSON.parse(await Deno.readTextFile(new URL(`../${K.A}`, import.meta.url).pathname)).series as Record<string, number>, B = JSON.parse(await Deno.readTextFile(new URL(`../${K.B}`, import.meta.url).pathname)).series as Record<string, number>;
const days = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort(); const ANN = days.length / ((Date.parse(days.at(-1)!) - Date.parse(days[0])) / 86400000 / 365.25);
const a = days.map((d) => A[d] ?? 0), b = days.map((d) => B[d] ?? 0);
// the raw risk-parity pair (as D-873)
const pair: number[] = []; for (let i = 0; i < days.length; i++) { const va = i > 40 ? sd(a.slice(Math.max(0, i - 60), i)) : 0, vb = i > 40 ? sd(b.slice(Math.max(0, i - 60), i)) : 0; const wa = va > 0 && vb > 0 ? (1 / va) / (1 / va + 1 / vb) : 0.5; pair.push(wa * a[i] + (1 - wa) * b[i]); }
const stats = (x: number[]) => { const mu = mean(x) * ANN, vol = sd(x) * Math.sqrt(ANN); let eq = 0, peak = 0, mdd = 0; const yr = new Map<string, number>(); for (let i = 0; i < x.length; i++) { eq += x[i]; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq - peak); const y = days[i].slice(0, 4); yr.set(y, (yr.get(y) ?? 0) + x[i]); } return { mu, vol, sr: vol ? mu / vol : 0, mdd, worstYr: Math.min(...yr.values()), years: [...yr.entries()].map(([y, v]) => `${y} ${(100 * v).toFixed(0)}%`).join(" ") }; };
// un-governed 20%: constant leverage from full-sample vol (the D-873 leverage-table convention)
const lev0 = +K.TARGET / (sd(pair) * Math.sqrt(ANN)); const U = stats(pair.map((v) => v * lev0));
// governed: rolling 60-day vol target, cap, drawdown governor on the GOVERNED equity
const G: number[] = []; let eq = 0, peak = 0;
for (let i = 0; i < pair.length; i++) { const w = pair.slice(Math.max(0, i - 60), i); const pv = w.length > 40 ? sd(w) * Math.sqrt(ANN) : 0; const lev = pv > 0 ? Math.min(+K.CAP, +K.TARGET / pv) : 1; const dd = eq - peak; const g = dd < -0.25 ? 0.25 : dd < -0.15 ? 0.5 : 1; const v = lev * g * pair[i]; G.push(v); eq += v; peak = Math.max(peak, eq); }
const S = stats(G);
console.log(`\n==> D-878 RISK-GOVERNED PAIR — ${days.length} days ${days[0]}..${days.at(-1)}`);
console.log(`  un-governed 20% (constant leverage ${lev0.toFixed(2)}x): ${(100 * U.mu).toFixed(1)}%/yr, vol ${(100 * U.vol).toFixed(1)}%, Sharpe ${U.sr.toFixed(2)}, maxDD ${(100 * U.mdd).toFixed(1)}%, worst year ${(100 * U.worstYr).toFixed(1)}%   [${U.years}]`);
console.log(`  GOVERNED (rolling 20% target, cap ${K.CAP}x, DD governor): ${(100 * S.mu).toFixed(1)}%/yr, vol ${(100 * S.vol).toFixed(1)}%, Sharpe ${S.sr.toFixed(2)}, maxDD ${(100 * S.mdd).toFixed(1)}%, worst year ${(100 * S.worstYr).toFixed(1)}%   [${S.years}]`);
const retained = S.mu / U.mu; console.log(`  return retained ${(100 * retained).toFixed(0)}%; weekly expectation governed ${(100 * S.mu / 52).toFixed(2)}%/week`);
await spendTrials({ rest: OWNED, headers: hdr, family: "pair-governor", runId: K.RUN_ID, spent: 2 });
const ok = S.mdd > -0.30 && retained >= 0.8 && S.worstYr > -0.20;
console.log(`  VERDICT (D-878 rule): ${ok ? "SUPPORTED" : `NULL — ${[S.mdd <= -0.30 && `maxDD ${(100 * S.mdd).toFixed(0)}%`, retained < 0.8 && `retained ${(100 * retained).toFixed(0)}%`, S.worstYr <= -0.20 && `worst year ${(100 * S.worstYr).toFixed(0)}%`].filter(Boolean).join("; ")}`}`);
