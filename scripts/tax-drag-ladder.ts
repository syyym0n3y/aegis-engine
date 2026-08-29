#!/usr/bin/env -S deno run --allow-net --allow-env
// tax-drag-ladder.ts (D-699) — the largest lever on this ladder, and the programme had never modelled it.
//
// HOW IT WAS FOUND. `coverage-map.ts` (D-697) enumerates documented sources of market success and counts the ledger
// rows touching each. "Tax drag & account wrapper" came back TESTED with 32 rows — every one a false positive on the
// phrase "ETF WRAPPERs". Corrected, it is UNTESTED: in 1,059 specifications and 200-odd decisions, this programme
// has never once modelled the arithmetic of tax on the account it exists to grow. It has modelled 10bp fees to four
// decimal places.
//
// WHAT THIS IS AND IS NOT. It is a DRAG SENSITIVITY, computed exactly as the expense-ratio and spread sensitivities
// already in `capital-ladder-long.ts`: given a drag of x%/yr and a terminal rate of y%, what happens to the climb.
// It is NOT tax advice, it does not model any jurisdiction, and it names no wrapper — nobody's actual position can
// be read off it, and it should not be. The rates swept are round numbers chosen to span the plausible range, not
// anybody's rates.
//
// WHY IT BELONGS IN A TRADING RESEARCH PROGRAMME AT ALL. D-680 measured what an edge is worth in this account:
// a sustained +5%/yr net alpha — which 1,059 specs have failed to produce — buys 4.1 years off the climb to
// $100,000. Tax drag operates on the same quantity, is CERTAIN rather than probabilistic, is capacity-unlimited,
// and requires no edge whatsoever. If it moves the ladder by a comparable amount then the programme has spent its
// entire effort on the smaller of two levers, and that is worth knowing precisely rather than vaguely.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("tax-drag-ladder", [
  { name: "START", def: "40", note: "opening capital" },
  { name: "MONTHLY", def: "100", note: "contribution per month" },
  { name: "MAX_YEARS", def: "45" },
  { name: "DIV_YIELD", def: "2.0", note: "%/yr gross dividend yield on a broad index — the recurring taxable event for a buy-and-hold holding" },
  { name: "ER_BP", def: "3", note: "expense ratio bp/yr, charged in every scenario" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "tdl", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

async function stream(name: string) {
  const m = new Map<string, number>();
  for (let off = 0;; off += 10000) {
    const r = await fetch(`${OWNED}/trd_ff_factors?select=month,ret&factor=eq.${encodeURIComponent(name)}&order=month.asc&offset=${off}&limit=10000`, { headers: hdr });
    if (!r.ok) { console.error(`!! ${name} HTTP ${r.status}`); Deno.exit(1); }
    const rows = await r.json() as { month: string; ret: number }[];
    if (!rows.length) break;
    for (const x of rows) { const v = Number(x.ret); if (Number.isFinite(v)) m.set(x.month.slice(0, 7), v); }
    if (rows.length < 10000) break;
  }
  return m;
}
const mkt = await stream("Mkt-RF"), rf = await stream("RF");
const months = [...mkt.keys()].filter((m) => rf.has(m)).sort().map((m) => ({ m, r: mkt.get(m)! + rf.get(m)! }));
assertNonEmpty("total-return months", months, 600);

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const pct = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

const START = Number(K.START), MONTHLY = Number(K.MONTHLY), MAXY = Number(K.MAX_YEARS);
const ER = Number(K.ER_BP) / 1e4, DIVY = Number(K.DIV_YIELD) / 100;
const LEVELS = [10000, 100000];
const LABEL = ["$10k", "$100k"];

// A scenario is (recurring drag on the dividend component, terminal rate on the accumulated gain). The recurring
// leg is modelled on the DIVIDEND YIELD rather than on the whole return, because a buy-and-hold holding realises
// nothing else until it sells — that distinction is the entire reason the terminal leg is separate.
interface Scen { name: string; divTax: number; terminal: number }
const SCENS: Scen[] = [
  { name: "no drag", divTax: 0, terminal: 0 },
  { name: "div taxed 20%", divTax: 0.20, terminal: 0 },
  { name: "div 20% + terminal 10%", divTax: 0.20, terminal: 0.10 },
  { name: "div 40% + terminal 20%", divTax: 0.40, terminal: 0.20 },
  { name: "div 40% + terminal 28%", divTax: 0.40, terminal: 0.28 },
];

function walk(s: Scen) {
  const hit: (number | null)[][] = [];
  const terminals: number[] = [];
  const crossings: number[] = [];
  for (let st = 0; st < months.length; st++) {
    if (months.length - st < 24) break;
    let cap = START, contributed = START;
    const h: (number | null)[] = LEVELS.map(() => null);
    let cross: number | null = null;
    let mo = 0;
    for (let i = st; i < months.length && mo < MAXY * 12; i++, mo++) {
      // recurring drag: the taxable dividend slice of the month's return, charged at divTax
      const drag = (DIVY / 12) * s.divTax + ER / 12;
      cap = cap * (1 - drag) * (1 + months[i].r) + MONTHLY;
      contributed += MONTHLY;
      // Levels are reached on the GROSS-OF-TERMINAL balance: nothing is realised until a sale, which is exactly
      // why the terminal leg is reported separately below rather than folded into the climb.
      LEVELS.forEach((L, k) => { if (h[k] === null && cap >= L) h[k] = mo / 12; });
      if (cross === null && cap - contributed > contributed) cross = mo / 12;
      if (mo === 20 * 12 - 1) {
        const gain = Math.max(0, cap - contributed);
        terminals.push(cap - gain * s.terminal);
      }
    }
    hit.push(h);
    if (cross !== null) crossings.push(cross);
  }
  return { hit, terminals, crossings };
}

console.log(`==> TAX DRAG ON THE LADDER — a sensitivity, not advice, and no jurisdiction is modelled`);
console.log(`    ${months.length} months ${months[0].m}..${months[months.length - 1].m}  |  $${START} start, $${MONTHLY}/mo, ${K.DIV_YIELD}% gross dividend yield, ${K.ER_BP}bp expense\n`);
console.log(`    ${"scenario".padEnd(24)}${LABEL.map((l) => `${l} med`.padStart(11)).join("")}${"crossover".padStart(11)}${"20yr terminal".padStart(15)}`);

const out: { s: Scen; med: (number | null)[]; term: number; cross: number }[] = [];
for (const s of SCENS) {
  const w = walk(s);
  const med = LEVELS.map((_, k) => {
    const got = w.hit.map((h) => h[k]).filter((x): x is number => x !== null);
    return got.length ? pct(got, 0.5) : null;
  });
  const term = w.terminals.length ? pct(w.terminals, 0.5) : NaN;
  const cross = w.crossings.length ? pct(w.crossings, 0.5) : NaN;
  out.push({ s, med, term, cross });
  console.log(`    ${s.name.padEnd(24)}${med.map((m) => (m === null ? "—" : m.toFixed(1) + "y").padStart(11)).join("")}${(Number.isFinite(cross) ? cross.toFixed(1) + "y" : "—").padStart(11)}${("$" + Math.round(term).toLocaleString()).padStart(15)}`);
}

const base = out[0], worst = out[out.length - 1];
console.log(`\n    COST OF THE HEAVIEST DRAG MODELLED, against no drag:`);
LEVELS.forEach((_, k) => {
  if (base.med[k] === null || worst.med[k] === null) return;
  console.log(`      to ${LABEL[k].padEnd(6)}: ${base.med[k]!.toFixed(1)}y -> ${worst.med[k]!.toFixed(1)}y  (+${(worst.med[k]! - base.med[k]!).toFixed(1)} years)`);
});
console.log(`      crossover: ${base.cross.toFixed(1)}y -> ${worst.cross.toFixed(1)}y  (+${(worst.cross - base.cross).toFixed(1)} years)`);
console.log(`      20-year terminal: $${Math.round(base.term).toLocaleString()} -> $${Math.round(worst.term).toLocaleString()}  (${(100 * (worst.term / base.term - 1)).toFixed(1)}%)`);

console.log(`\n    THE COMPARISON THAT MAKES THIS WORTH MEASURING (D-680): a sustained +5%/yr NET alpha — which 1,059`);
console.log(`    specifications have failed to produce — buys 4.1 years off the climb to $100,000. Read the years`);
console.log(`    above against that number. Both act on the same quantity; one of them is certain.`);
console.log(`\n    SCOPE, STATED: the recurring leg is modelled on the dividend yield only, because a buy-and-hold`);
console.log(`    holding realises nothing else until it sells. A strategy that TURNS OVER realises gains continuously,`);
console.log(`    so its recurring drag is larger by roughly (turnover x gain x rate) — which means every active`);
console.log(`    specification on this board is understated here, not overstated. Measuring that properly needs the`);
console.log(`    per-spec turnover now stored by D-686, and is recorded as open rather than done.`);
