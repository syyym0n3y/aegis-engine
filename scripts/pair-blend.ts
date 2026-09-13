#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// pair-blend.ts (D-873) — PREREG: D-873-isa-plus-crypto-parity. Blend two already-registered holdable books from their
// dumped daily OOS series: the timed class-parity ISA basket with VIX overlay (D-872) and the timed spot-crypto basket
// (D-871), OOS 2018-2026, at risk parity (inverse trailing 60-day sleeve vol) and at equal weight, scaled to 10% vol.
// Dates are the UNION (crypto trades weekends; the ISA book is 0 on days it has no bar), which is how a real account
// would experience it.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("pair-blend", [{ name: "A", def: "data/d873-isa.json" }, { name: "B", def: "data/d873-crypto.json" }, { name: "VOL_TARGET", def: "0.10" }, { name: "RUN_ID", def: "D-873-isa-plus-crypto-parity" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "pb", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok };
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 2 ? mean(a) / (sd(a) / Math.sqrt(a.length) || 1e-12) : 0;
const corr = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / (Math.sqrt(da * db) || 1e-12); };
const stats = (x: number[], ann = 252) => { const mu = mean(x) * ann, vol = sd(x) * Math.sqrt(ann); let eq = 0, peak = 0, mdd = 0, uw = 0, maxUw = 0; for (const v of x) { eq += v; if (eq > peak) { peak = eq; uw = 0; } else { uw++; maxUw = Math.max(maxUw, uw); } mdd = Math.min(mdd, eq - peak); } return { mu, vol, sr: vol ? mu / vol : 0, t: tstat(x), mdd, uwY: maxUw / ann }; };
const A = JSON.parse(await Deno.readTextFile(new URL(`../${K.A}`, import.meta.url).pathname)).series as Record<string, number>;
const B = JSON.parse(await Deno.readTextFile(new URL(`../${K.B}`, import.meta.url).pathname)).series as Record<string, number>;
const days = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort(); const ANN = days.length / ((Date.parse(days.at(-1)!) - Date.parse(days[0])) / 86400000 / 365.25);
const a = days.map((d) => A[d] ?? 0), b = days.map((d) => B[d] ?? 0);
console.log(`\n==> D-873 PAIR BLEND — ${days.length} union days ${days[0]}..${days.at(-1)} (${ANN.toFixed(0)} obs/yr); ISA-overlay (A) x spot-crypto (B)`);
const sA = stats(a, ANN), sB = stats(b, ANN); console.log(`  A alone: Sharpe ${sA.sr.toFixed(2)} t ${sA.t.toFixed(2)} maxDD ${(100 * sA.mdd).toFixed(1)}% | B alone: Sharpe ${sB.sr.toFixed(2)} t ${sB.t.toFixed(2)} maxDD ${(100 * sB.mdd).toFixed(1)}% | corr ${corr(a, b).toFixed(2)}`);
const crash = (from: string, to: string) => { const ix = days.map((d, i) => [d, i] as [string, number]).filter(([d]) => d >= from && d <= to).map(([, i]) => i); return `${from.slice(0, 7)}..${to.slice(0, 7)} corr ${corr(ix.map((i) => a[i]), ix.map((i) => b[i])).toFixed(2)}, A ${(100 * ix.reduce((s, i) => s + a[i], 0)).toFixed(1)}% B ${(100 * ix.reduce((s, i) => s + b[i], 0)).toFixed(1)}%`; };
console.log(`  CRASHES: ${crash("2020-02-20", "2020-03-31")} | ${crash("2022-01-01", "2022-11-30")}`);
const res: Record<string, ReturnType<typeof stats>> = {}; const blends: Record<string, number[]> = {};
for (const mode of ["parity", "equal"]) { const out: number[] = []; for (let i = 0; i < days.length; i++) { let wa = 0.5; if (mode === "parity") { const va = i > 40 ? sd(a.slice(Math.max(0, i - 60), i)) : 0, vb = i > 40 ? sd(b.slice(Math.max(0, i - 60), i)) : 0; wa = va > 0 && vb > 0 ? (1 / va) / (1 / va + 1 / vb) : 0.5; } out.push(wa * a[i] + (1 - wa) * b[i]); } const v = sd(out) * Math.sqrt(ANN); const lev = +K.VOL_TARGET / (v || 1); blends[mode] = out.map((x) => x * lev); res[mode] = stats(blends[mode], ANN); }
for (const mode of ["parity", "equal"]) { const r = res[mode]; console.log(`  ${mode.padEnd(7)} at ${(100 * +K.VOL_TARGET).toFixed(0)}% vol: Sharpe ${r.sr.toFixed(2)}, t ${r.t.toFixed(2)}, ${(100 * r.mu).toFixed(1)}%/yr, maxDD ${(100 * r.mdd).toFixed(1)}%, underwater ${r.uwY.toFixed(1)}y`); }
console.log(`  LEVERAGE (parity): ` + [0.10, 0.20, 0.30, 0.40].map((tv) => { const x = blends.parity.map((v) => v * tv / +K.VOL_TARGET); const s = stats(x, ANN); const g = s.mu - s.vol * s.vol / 2; return `${(100 * tv).toFixed(0)}% -> ${(100 * s.mu).toFixed(1)}%/yr DD ${(100 * s.mdd).toFixed(0)}% 10x in ${g > 0 ? (Math.log(10) / g).toFixed(1) + "y" : "never"}`; }).join(" | "));
await spendTrials({ rest: OWNED, headers: hdr, family: "pair-blend", runId: K.RUN_ID, spent: 2 }); const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
const P = res.parity; const ok = P.sr >= 1.0 && P.mdd > -0.08 && P.sr > sA.sr && P.sr > sB.sr && corr(a, b) < 0.3;
console.log(`  ceiling ${ceil.ceiling.toFixed(3)}. VERDICT (D-873 rule): ${ok ? "SUPPORTED" : `NULL — ${[P.sr < 1.0 && `Sharpe ${P.sr.toFixed(2)} < 1.0`, P.mdd <= -0.08 && "maxDD worse than -8%", !(P.sr > sA.sr && P.sr > sB.sr) && "does not beat both sleeves", corr(a, b) >= 0.3 && "correlation >= 0.3"].filter(Boolean).join("; ")}`}`);
