// D-915 — the prop route priced with REAL firm terms, sourced from official pages (FTMO how-it-works; Apex help-center;
// Topstep rules), on the HONEST excess futures book (D-912/914: you earn no rf on the firm's capital, so the evaluation
// drift is the ~0.4 excess Sharpe, not the ~1.1 total). Two structurally different firm types are modelled:
//   FTMO  — 2-phase, STATIC 10% max drawdown, 5% daily, targets 10%/5%, 80% split, fee REFUNDED on first payout.
//   APEX/TOPSTEP — 1-phase, TRAILING drawdown that LOCKS at ~breakeven once cleared, 6% target, 90% split, monthly
//                  non-refundable fee, a 30% consistency rule (no single day > 30% of profit at payout) + 5 winning days.
// THE ZERO-EDGE CONTROL gates every firm: if a driftless trader is +EV under a firm's rules, that firm's config is
// misencoded and its edge number does not count (D-641).
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "pf", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const sg = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...sg)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const K = declareKnobs("prop-firms", [
  { name: "BLEND", def: "data/d914-futures-excess.json", note: "the CLEAN-EXCESS futures book (RF=0), the honest prop input" },
  { name: "PATHS", def: "8000" }, { name: "SEED", def: "20260914" },
  { name: "VOLS", def: "0.06,0.08,0.10,0.12,0.15,0.20" },
  { name: "FUNDED_DAYS", def: "252" }, { name: "RUN_ID", def: "D-915-prop-real-firm-terms" },
]);
const j = JSON.parse(await Deno.readTextFile(new URL(`../${K.BLEND}`, import.meta.url).pathname)) as { series: Record<string, number> };
const days = Object.keys(j.series).sort(); const R = days.map((d) => j.series[d]);
assertNonEmpty("excess daily observations", R, 2500);
const ANN = days.length / Math.max(1e-9, (Date.parse(days.at(-1)!) - Date.parse(days[0])) / (365.25 * 864e5));
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const volRaw = sd(R) * Math.sqrt(ANN), srEx = mean(R) / sd(R) * Math.sqrt(ANN);
// firm presets. dd: "static" | "trail" | "traillock". lock = profit level (fraction) the trailing floor fixes at.
// fee is the cost per evaluation attempt; refund = fee returned on reaching a first payout.
type Firm = { name: string; phases: number; t1: number; t2: number; daily: number; maxDD: number; dd: string; lock: number; split: number; fee: number; refund: boolean; minTd: number; consist: number; winMin: number; evalDays: number };
const FIRMS: Firm[] = [
  { name: "FTMO 100k",    phases: 2, t1: 0.10, t2: 0.05, daily: 0.05, maxDD: 0.10, dd: "static",    lock: 0,      split: 0.80, fee: 580, refund: true,  minTd: 4, consist: 1.0,  winMin: 0, evalDays: 10000 },
  { name: "Apex 100k",    phases: 1, t1: 0.06, t2: 0,    daily: 0,    maxDD: 0.03, dd: "traillock", lock: 0.001, split: 0.90, fee: 150, refund: false, minTd: 7, consist: 0.30, winMin: 5, evalDays: 10000 },
  { name: "Topstep 100k", phases: 1, t1: 0.06, t2: 0,    daily: 0.02, maxDD: 0.03, dd: "trail",     lock: 0,      split: 0.90, fee: 99,  refund: false, minTd: 2, consist: 0.30, winMin: 0, evalDays: 10000 },
];
const floorOf = (peak: number, f: Firm) => f.dd === "static" ? -f.maxDD : f.dd === "trail" ? peak - f.maxDD : Math.min(peak - f.maxDD, f.lock);
let seed = +K.SEED >>> 0; const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const draw = (edge: boolean, sc: number) => (edge ? R[Math.floor(rnd() * R.length)] : R[Math.floor(rnd() * R.length)] - mean(R)) * sc;
// one phase: reach target before a daily-loss or drawdown breach. returns true=pass, false=breach/timeout.
function phase(target: number, sc: number, edge: boolean, f: Firm): boolean {
  let eq = 0, peak = 0;
  for (let t = 0; t < f.evalDays; t++) {
    const r = draw(edge, sc);
    if (f.daily > 0 && r <= -f.daily) return false;
    eq += r; peak = Math.max(peak, eq);
    if (eq <= floorOf(peak, f)) return false;
    if (eq >= target) return true;
  }
  return false;
}
// funded: accumulate under the firm's drawdown; payout requires survival, min days, >= winMin winning days, and the
// 30% consistency rule (best single day <= consist * total profit). payout = split * profit; refund handled by caller.
function funded(sc: number, edge: boolean, f: Firm): number {
  let eq = 0, peak = 0, best = 0, wins = 0, days = 0; const daily: number[] = [];
  for (let t = 0; t < +K.FUNDED_DAYS; t++) {
    const r = draw(edge, sc); days++;
    if (f.daily > 0 && r <= -f.daily) return 0;   // daily breach ends the account with no payout
    eq += r; peak = Math.max(peak, eq); daily.push(r); if (r > 0.001) wins++; best = Math.max(best, r);
    if (eq <= floorOf(peak, f)) return 0;         // drawdown breach: account lost, no payout
  }
  if (days < f.minTd || wins < f.winMin || eq <= 0) return 0;
  if (best > f.consist * eq) return 0;            // consistency rule fails the payout
  return f.split * eq;   // in ACCOUNT units; caller multiplies by notional
}
const ACC = 100000;
console.log(`==> D-915 PROP FIRMS (real terms) on the honest excess futures book — excess Sharpe ${srEx.toFixed(2)}, realised vol ${(100 * volRaw).toFixed(1)}%`);
console.log(`  Terms sourced Sep 2026 (FTMO how-it-works; Apex help-center; Topstep rules). The zero-edge control gates every firm.\n`);
let trials = 0; const summary: string[] = [];
for (const f of FIRMS) {
  console.log(`  ${f.name} — ${f.phases}-phase, ${f.dd} DD ${(100*f.maxDD).toFixed(0)}%, target ${(100*f.t1).toFixed(0)}%${f.phases>1?`/${(100*f.t2).toFixed(0)}%`:""}, split ${(100*f.split).toFixed(0)}%, fee $${f.fee}${f.refund?" (refunded on 1st payout)":""}, consistency ${f.consist<1?(100*f.consist).toFixed(0)+"%":"none"}`);
  console.log(`    ${"vol".padStart(4)} ${"EDGE P(pass)".padStart(12)} ${"E[$/attempt]".padStart(13)}   ${"CTRL P(pass)".padStart(12)} ${"CTRL E[$]".padStart(10)}`);
  for (const vS of K.VOLS.split(",")) {
    const vol = +vS, sc = vol / volRaw; trials++;
    const run = (edge: boolean) => {
      let pass = 0, net = 0;
      for (let p = 0; p < +K.PATHS; p++) {
        let ok = true; for (let ph = 0; ph < f.phases && ok; ph++) ok = phase(ph === 0 ? f.t1 : f.t2, sc, edge, f);
        if (!ok) { net -= f.fee; continue; }
        pass++;
        const pay = funded(sc, edge, f) * ACC;
        net += pay + (pay > 0 && f.refund ? f.fee : 0) - f.fee;
      }
      return { pP: pass / +K.PATHS, ev: net / +K.PATHS };
    };
    const e = run(true), c = run(false);
    console.log(`    ${(100*vol).toFixed(0).padStart(3)}% ${(100*e.pP).toFixed(1).padStart(11)}% ${((e.ev>=0?"+":"")+"$"+Math.round(e.ev)).padStart(13)}   ${(100*c.pP).toFixed(1).padStart(11)}% ${((c.ev>=0?"+":"")+"$"+Math.round(c.ev)).padStart(10)}`);
    if (vS === "0.10" || vS === "0.12") summary.push(`${f.name} @ ${(100*vol).toFixed(0)}%: edge ${(e.ev>=0?"+":"")}$${Math.round(e.ev)}/attempt (control ${(c.ev>=0?"+":"")}$${Math.round(c.ev)})`);
  }
  console.log();
}
const HDR = { Authorization: `Bearer ${await jwt()}`, apikey: await jwt(), "Content-Type": "application/json" };
await spendTrials({ rest: OWNED_REST(), headers: HDR, family: "prop-firms", runId: K.RUN_ID, spent: trials });
console.log(`  SUMMARY: ${summary.join(" | ")}`);
function OWNED_REST() { return Deno.env.get("OWNED_REST") || "http://localhost:33000"; }
