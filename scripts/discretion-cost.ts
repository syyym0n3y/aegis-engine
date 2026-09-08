#!/usr/bin/env -S deno run --allow-net --allow-env
// discretion-cost.ts (D-831) — the two propositions from the Douglas/Schwager literature this stack had never measured:
//   (2) inconsistent execution destroys an edge; (3) a trader's REMEMBERED track record is not the real one.
// Neither is a signal claim, so neither could be tested by the grammar or the factory. Both are measurable directly on
// an event stream we already own, and they matter now because the micro rung puts fills in the operator's own hands.
//
// THE SHARPER FORM OF (3), and the reason this is worth running on a ZERO-EDGE rule: if a rule has no edge, discretion
// cannot destroy an edge that is not there - but SELECTION can still manufacture a track record that looks like skill.
// So the question measured here is: how good can a discretionary trader's record look, purely by chance, on a stream
// with no edge? That number is what a real person will mistake for evidence about themselves.
// The stream is the D-825 event set (the PSL fade on the three placeable instruments), whose true excess over an
// unconditional hold was measured at -1.35bp: as close to a zero-edge stream as this record owns.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { Bar, priorSessionLevels } from "../supabase/functions/_shared/mtf-structure.ts";
const K = declareKnobs("discretion-cost", [
  { name: "SPLIT", def: "2023-01-01" }, { name: "KK", def: "24" }, { name: "SIMS", def: "20000", note: "simulated discretionary traders per take-rate" },
  { name: "TAKES", def: "0.10,0.25,0.50", note: "share of signals a discretionary trader actually takes" },
  { name: "SEED", def: "831" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "dsc", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const pct = (a: number[], p: number) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.max(0, Math.floor(p * b.length)))]; };
let seed = +K.SEED; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const VENUE: Record<string, number> = { XAUUSD: 2.2, USA500IDXUSD: 2.4, USATECHIDXUSD: 2.2 };
const KK = +K.KK, SPLIT = Date.parse(K.SPLIT + "T00:00:00Z") / 1000;
const nets: number[] = [];
for (const sym of Object.keys(VENUE)) {
  const rows = await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c,vol&order=ts.asc`) as { ts: number; o: number; h: number; l: number; c: number; vol: number }[];
  const b: Bar[] = rows.filter((r) => r.h !== r.l).map((r) => ({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol }));
  const psl = priorSessionLevels(b); const rt = VENUE[sym] / 1e4; let firedAt: number | undefined;
  for (let i = 1; i < b.length - KK - 1; i++) {
    const lvl = psl[i]?.low; if (lvl === undefined) continue;
    if (!(b[i - 1].c >= lvl && b[i].c < lvl) || firedAt === lvl) continue;
    firedAt = lvl; if (b[i].ts < SPLIT) continue;
    nets.push(Math.log(b[i + 1 + KK].c / b[i + 1].o) - rt);
  }
}
assertNonEmpty("event stream", nets, 1000);
const m0 = mean(nets), s0 = sd(nets);
/* D-831 CONTROL, added after the first run overstated the effect: the raw stream carries +6.24bp of DRIFT (its excess
   over an unconditional hold is -1.35bp, D-826b), so "most random subsets look profitable" would be measuring the
   drift, not the selection. The deciding series is therefore the DEMEANED stream - exactly zero edge by construction -
   and the raw one is reported beside it as the real-world case where drift and selection compound. */
const zero = nets.map((x) => x - m0);
console.log(`\n==> D-831 WHAT DISCRETION DOES — measured on the D-825 stream (${nets.length} events, the three placeable instruments, OOS).`);
console.log(`    The mechanical rule: mean ${(m0 * 1e4).toFixed(2)}bp/event, sd ${(s0 * 1e4).toFixed(0)}bp, t ${(m0 / (s0 / Math.sqrt(nets.length))).toFixed(2)}. Its measured excess over an unconditional hold is -1.35bp (D-826b) — a zero-edge stream by construction.`);
console.log(`\n  PROPOSITION 3 — how good can a DISCRETIONARY record look, by pure selection, on a stream with no edge?`);
console.log(`    Each simulated trader takes a random subset of the signals (no skill, no foresight) and judges themselves on what they took.`);
for (const [label, SRC] of [["DEMEANED stream — pure selection, zero edge by construction (THE CONTROL)", zero], ["RAW stream — drift and selection compounding, the real-world case", nets]] as [string, number[]][]) {
console.log(`\n    ${label}`);
console.log(`    ${"takes".padStart(6)} ${"trades".padStart(7)} ${"median mean bp".padStart(15)} ${"p95 mean bp".padStart(12)} ${"p99".padStart(8)} ${"% who look PROFITABLE".padStart(22)} ${"% who look profitable AT t>=2".padStart(30)}`);
for (const take of K.TAKES.split(",").map(Number)) {
  const n = Math.max(2, Math.round(nets.length * take));
  const means: number[] = []; let profitable = 0, significant = 0;
  for (let s = 0; s < +K.SIMS; s++) {
    let sum = 0, sq = 0;
    for (let j = 0; j < n; j++) { const v = SRC[Math.floor(rnd() * SRC.length)]; sum += v; sq += v * v; }
    const mu = sum / n, sg = Math.sqrt(Math.max(1e-18, sq / n - mu * mu));
    means.push(mu); if (mu > 0) profitable++;
    if (mu / (sg / Math.sqrt(n)) >= 2) significant++;
  }
  console.log(`    ${(100 * take).toFixed(0).padStart(5)}% ${String(n).padStart(7)} ${(pct(means, 0.5) * 1e4).toFixed(2).padStart(15)} ${(pct(means, 0.95) * 1e4).toFixed(2).padStart(12)} ${(pct(means, 0.99) * 1e4).toFixed(2).padStart(8)} ${((100 * profitable / +K.SIMS).toFixed(1) + "%").padStart(22)} ${((100 * significant / +K.SIMS).toFixed(1) + "%").padStart(30)}`);
}
}
console.log(`\n  PROPOSITION 2 — what CHERRY-PICKING IN MEMORY does, on the DEMEANED (zero-edge) stream:`);
console.log(`    ${"takes".padStart(6)} ${"true median bp".padStart(15)} ${"remembered (best half)".padStart(23)} ${"inflation".padStart(11)}`);
for (const take of K.TAKES.split(",").map(Number)) {
  const n = Math.max(2, Math.round(nets.length * take));
  const trueM: number[] = [], remM: number[] = [];
  for (let s = 0; s < Math.min(4000, +K.SIMS); s++) {
    const picks: number[] = []; for (let j = 0; j < n; j++) picks.push(zero[Math.floor(rnd() * zero.length)]);
    trueM.push(mean(picks));
    const srt = [...picks].sort((a, b) => b - a); remM.push(mean(srt.slice(0, Math.max(1, Math.floor(srt.length / 2)))));
  }
  console.log(`    ${(100 * take).toFixed(0).padStart(5)}% ${(pct(trueM, 0.5) * 1e4).toFixed(2).padStart(15)} ${(pct(remM, 0.5) * 1e4).toFixed(2).padStart(23)} ${((pct(remM, 0.5) - pct(trueM, 0.5)) * 1e4).toFixed(2).padStart(11)}bp`);
}
console.log(`\n  THE NUMBER THAT MATTERS FOR THE FIRST FILLS: a trader taking ${(100 * +K.TAKES.split(",")[0]).toFixed(0)}% of a ZERO-EDGE stream has a`);
console.log(`  meaningful chance of showing a profit over their first few dozen trades, and no way to tell that from skill without the`);
console.log(`  sample size the gates already require. That is the literature's claim, and it is now a measured number rather than advice.`);
