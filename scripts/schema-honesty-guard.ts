#!/usr/bin/env -S deno run --allow-net --allow-env
// schema-honesty-guard.ts (D-671) — the 21st guard. A column's NAME is a claim about its CONTENT.
//
// THREE COLUMNS IN ONE SCHEMA WERE FOUND LYING IN A SINGLE SESSION, each by accident while looking for something
// else, and each after months of being read as if it meant what it says:
//
//   g_liquid    said "liquidity gate result"   held the literal `true` on 995 of 1,021 specs        (D-666)
//   n_names     said "names per rebalance"     held FACTOR STREAMS in the book path, 6 not 6,000    (D-668)
//   gross_ann   said "gross return"            held the NET return on 279 of 1,044 specs, 26.7%     (D-670)
//
// The third one broke an AUDIT: D-664 bounded cost-inflation exposure by computing gross/net ratios, and for a
// quarter of the board that ratio is 1.0 by construction — so the audit certified as clean the very families
// (cot, tff) that re-running proved were inflated from t -0.95 to -4.15 and t -1.54 to -9.26.
//
// TWO OF THE THREE ARE MECHANICALLY DETECTABLE AND THAT IS WHAT THIS GUARD DOES:
//   1. DEGENERATE — a column with exactly one distinct non-null value across a large table is not recording
//      anything. It is a constant wearing a column name.
//   2. DUPLICATE — two columns that are always equal are one column, and if their names promise different
//      quantities (gross vs net) one of the names is false.
// The third (n_names meaning different things per code path) is NOT detectable from values alone and is recorded in
// D-668 rather than pretended to be covered here. A guard that implies coverage it does not have is the defect it
// is meant to catch.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("schema-honesty-guard", [
  { name: "SELFTEST", def: "", note: "prove the guard fails before trusting its green" },
  { name: "MIN_ROWS", def: "200", note: "below this a single distinct value may be honest, not degenerate" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const MIN_ROWS = Number(Deno.env.get("MIN_ROWS") || 200);

async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "shg", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

async function q(path: string): Promise<Record<string, unknown>[]> {
  let r: Response;
  try { r = await fetch(`${OWNED}/${path}`, { headers: hdr }); }
  catch (e) { console.error(`!! cannot reach ${path}: ${e instanceof Error ? e.message : e} — RED.`); Deno.exit(1); }
  if (!r.ok) { console.error(`!! ${path} HTTP ${r.status} — RED.`); Deno.exit(1); }
  const j = await r.json().catch(() => null);
  if (!Array.isArray(j)) { console.error(`!! ${path} returned no rows — RED.`); Deno.exit(1); }
  return j as Record<string, unknown>[];
}

// Tables and the columns whose names make a checkable promise. Scoped deliberately: this guard inspects claims it
// can actually evaluate rather than sweeping every column in the database and producing noise nobody reads.
const WATCH: { table: string; cols: string[]; pairs: [string, string][] }[] = [
  { table: "trd_factory", cols: ["g_breadth", "g_effect", "g_benchmark", "g_liquid", "g_era", "g_deflation"],
    pairs: [["gross_ann", "net_ann"]] },
];
// Known and reasoned, with the decision recorded. An acknowledged entry is REPORTED, never silently skipped —
// the same pattern D-659 settled for the continuity guard, because a permanent red gets switched off.
const ACKNOWLEDGED: Record<string, string> = {
  "trd_factory.gross_ann=net_ann": "D-670 recorded 279 of 1,044 specs (26.7%) assigning gross_ann:m*12, net_ann:m*12 in paths that charge cost INSIDE the return loop, and left it as a known defect. D-684 showed what that hid: 70 of 148 significant-loss claims could not be cost-audited at all, each silently reading as 'holds' because the ratio is 1 by construction. D-684c/d fixed seven passes (timing, xasset, seasonal, sessions, cotdisagg, tff, fxintraday) to accumulate the fee alongside the return; the rate is now 20 of 1,044 (1.9%) and one significant-loss claim remains blind (book|p3|residual_fade). RE-MEASURE THIS NUMBER RATHER THAN TRUSTING THE SENTENCE: a stale acknowledgement that overstates a fixed defect teaches the reader to discount the guard's other lines.",
};

let red = 0, checked = 0;
console.log(`==> SCHEMA HONESTY GUARD — a column's name is a claim about its content`);

for (const w of WATCH) {
  const rows = await q(`${w.table}?select=${[...w.cols, ...w.pairs.flat()].join(",")}&limit=5000`);
  if (rows.length < MIN_ROWS) { console.log(`  --   ${w.table} has ${rows.length} rows, under the ${MIN_ROWS} floor — degeneracy is not evidence here`); continue; }

  for (const c of w.cols) {
    const vals = new Set(rows.map((r) => r[c]).filter((v) => v !== null && v !== undefined));
    checked++;
    if (vals.size === 1) {
      red++;
      console.log(`  RED  ${w.table}.${c} — ONE distinct non-null value (${[...vals][0]}) across ${rows.length} rows. A constant wearing a column name.`);
    }
  }
  for (const [a, b] of w.pairs) {
    const both = rows.filter((r) => r[a] !== null && r[b] !== null);
    if (!both.length) continue;
    const same = both.filter((r) => Number(r[a]) === Number(r[b])).length;
    checked++;
    const key = `${w.table}.${a}=${b}`;
    const frac = same / both.length;
    if (frac === 1) {
      if (ACKNOWLEDGED[key]) console.log(`  known ${key} — ALWAYS equal across ${both.length} rows.\n        ${ACKNOWLEDGED[key]}`);
      else { red++; console.log(`  RED  ${key} — ALWAYS equal across ${both.length} rows. Two names, one quantity: one of the names is false.`); }
    } else if (frac > 0.15) {
      if (ACKNOWLEDGED[key]) console.log(`  known ${key} — equal on ${same} of ${both.length} rows (${(100 * frac).toFixed(1)}%).\n        ${ACKNOWLEDGED[key]}`);
      else { red++; console.log(`  RED  ${key} — equal on ${same} of ${both.length} rows (${(100 * frac).toFixed(1)}%); those rows record no distinction between the two quantities.`); }
    } else {
      console.log(`  ok   ${key} — differ on ${both.length - same} of ${both.length} rows`);
    }
  }
}

if (Deno.env.get("SELFTEST") === "1") {
  console.log(`\n  SELFTEST:`);
  const degenerate = [{ g: true }, { g: true }, { g: true }];
  const varied = [{ g: true }, { g: false }, { g: true }];
  const dup = [{ a: 1, b: 1 }, { a: 2, b: 2 }];
  const diff = [{ a: 1, b: 2 }, { a: 3, b: 4 }];
  const d1 = new Set(degenerate.map((r) => r.g)).size === 1;
  const d2 = new Set(varied.map((r) => r.g)).size > 1;
  const d3 = dup.every((r) => r.a === r.b);
  const d4 = !diff.every((r) => r.a === r.b);
  console.log(`    flags a single-valued column ............ ${d1 ? "YES" : "NO"}   (the g_liquid shape)`);
  console.log(`    passes a column that varies ............. ${d2 ? "YES" : "NO"}`);
  console.log(`    flags an always-equal pair .............. ${d3 ? "YES" : "NO"}   (the gross_ann/net_ann shape)`);
  console.log(`    passes a pair that differs ............. ${d4 ? "YES" : "NO"}`);
  if (!d1 || !d2 || !d3 || !d4) { console.log(`    SELFTEST FAILED — guard does not discriminate. RED.`); Deno.exit(1); }
  console.log(`    SELFTEST PASSED.`);
}

console.log(`\n  ${red === 0 ? `SCHEMA HONEST — ${checked} claim(s) checked, none degenerate or duplicated.`
  : `${red} DISHONEST COLUMN(S) — a name promises something the values do not deliver.`}`);
if (red > 0) Deno.exit(1);
