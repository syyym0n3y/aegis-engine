#!/usr/bin/env -S deno run --allow-net --allow-env
// bond-carry.ts (D-731b) — closes the bond leg of the "carry" untested approach. The documented bond risk premium
// (Fama-Bliss, Cochrane-Piazzesi): a STEEP curve predicts higher future bond excess returns. Test on TLT with the
// term spread (ust_10y - ust_2y, FRED from 1976). Applies the D-730 discipline — condition on the LEVEL and on the
// stationary CHANGE, train-split deciles, benchmark vs unconditional — because a term-spread LEVEL is persistent and
// a significant level result must be checked against the change before it is believed.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("bond-carry", [{ name: "FWD", def: "60", note: "forward horizon (trading days)" }, { name: "TRAIN_FRAC", def: "0.6", note: "train split for decile edges" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "bc", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const welch = (a: number[], b: number[]) => (a.length > 5 && b.length > 5) ? (mean(a) - mean(b)) / Math.sqrt(sd(a) ** 2 / a.length + sd(b) ** 2 / b.length) : 0;

async function macro(name: string): Promise<Map<string, number>> {
  const r = await fetch(`${OWNED}/trd_macro_series?series=eq.${name}&select=d,v&order=d&limit=100000`, { headers: hdr }).then((x) => x.json()).catch(() => []);
  return new Map((Array.isArray(r) ? r : []).map((x: { d: string; v: number }) => [x.d, x.v]));
}
const raw = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.TLT&select=bars`, { headers: hdr }).then((x) => x.json());
const tlt = new Map<string, number>(((raw?.[0]?.bars) || []).filter((b: number[]) => b[4] > 0).map((b: number[]) => [iso(b[0]), b[4]]));
const y2 = await macro("ust_2y"), y10 = await macro("ust_10y");
const spread = new Map<string, number>();
for (const [d, v] of y10) if (y2.has(d)) spread.set(d, v - y2.get(d)!);
assertNonEmpty("term spread", [...spread], 1000);

const FWD = Number(K.FWD), TF = Number(K.TRAIN_FRAC);
const dates = [...tlt.keys()].filter((d) => spread.has(d)).sort();
assertNonEmpty("aligned TLT/spread days", dates, 500);

function decileTest(getX: (i: number) => number | null, label: string) {
  const obs: { x: number; fwd: number }[] = [];
  for (let i = 0; i < dates.length - FWD; i++) { const x = getX(i); const p0 = tlt.get(dates[i])!, p1 = tlt.get(dates[i + FWD]); if (x == null || !p1) continue; obs.push({ x, fwd: p1 / p0 - 1 }); }
  if (obs.length < 200) return null;
  const split = Math.floor(obs.length * TF);
  const edges = obs.slice(0, split).map((o) => o.x).sort((a, b) => a - b);
  const q = (p: number) => edges[Math.min(edges.length - 1, Math.floor(p * edges.length))];
  const cut = [0.2, 0.4, 0.6, 0.8].map(q);
  const dec = (x: number) => { let i = 0; while (i < cut.length && x > cut[i]) i++; return i; };
  const test = obs.slice(split); const uncond = mean(test.map((o) => o.fwd));
  const bk: number[][] = [[], [], [], [], []]; for (const o of test) bk[dec(o.x)].push(o.fwd);
  const lo = bk[0], hi = bk[4];   // hi = steepest curve (high carry) -> should predict HIGHER bond returns
  const t = welch(hi, lo);
  console.log(`     ${label}: TEST n=${test.length} uncond ${(uncond * 100).toFixed(2)}% | flat/low excess ${((mean(lo) - uncond) * 100).toFixed(2)}% | steep/high excess ${((mean(hi) - uncond) * 100).toFixed(2)}% | steep-minus-flat t=${t.toFixed(2)}`);
  return t;
}

// A rolling z-score of the term spread (750-day / ~3y window) is STATIONARY where the raw level is not — it asks
// "steep RELATIVE TO the recent regime", which is what carry actually means and which keeps train/test buckets
// comparable. The raw-level test is kept only to DEMONSTRATE its degeneracy (empty buckets under the regime shift).
const svals = dates.map((d) => spread.get(d)!);
function rollZ(i: number): number | null {
  const w = 750; if (i < w) return null;
  const win = svals.slice(i - w, i); const m = mean(win), s = sd(win) || 1e-9;
  return (svals[i] - m) / s;
}
console.log(`==> BOND CARRY — does the term spread predict TLT forward-${FWD}d returns? ${dates[0]}..${dates[dates.length - 1]}`);
console.log(`    (bond risk premium: steep curve -> higher future bond excess return)`);
const tLevel = decileTest((i) => rollZ(i), "(B) on term-spread ROLLING Z (stationary carry)");
const tChange = decileTest((i) => (i >= FWD ? (spread.get(dates[i])! - spread.get(dates[i - FWD])!) : null), "(C) on term-spread CHANGE (stationary control)");
const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "bond-carry", runId: `bc|2specs|fwd${FWD}`, spent: 2 });
console.log(`\n    trials ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()} | ceiling ${spend.ceiling.toFixed(4)}`);
const survives = tLevel != null && Math.abs(tLevel) > 2 && tChange != null && Math.abs(tChange) > 2 && Math.sign(tLevel) === Math.sign(tChange);
console.log(`    VERDICT: ${survives ? "the carry signal SURVIVES both level and change conditioning — a rare candidate; verify with deflation + costs before any claim." : tLevel != null && Math.abs(tLevel) > 2 ? "significant on LEVEL but " + (tChange != null && Math.abs(tChange) <= 2 ? "WASHES OUT on the change — a persistence/era artifact, NOT a tradable signal (the D-730 pattern)." : "inconclusive on the change.") : "no significant term-spread conditioning of TLT returns — a null."}`);
console.log(`    Overlapping ${FWD}d windows inflate |t|; the decision is on sign-agreement across level+change, not the raw t.`);
