#!/usr/bin/env -S deno run --allow-net --allow-env
// prereg-ceiling.ts (D-823) — THE PRE-REGISTERED BAR, reported. For every trd_prereg row: its own ceiling
// (sqrt(2 ln (trials counted under the id + all registrations ever))), the largest |t| its outcome note states, and
// whether that clears the bar. REPORT ONLY: clearing the pre-registered bar is NECESSARY, not sufficient — instrument,
// cost, turnover, holdability, sign and the ladder's sample floors still bind, and the outcome label says which way the
// number went. Positive controls: >= 1 row, and every ceiling must sit inside (2.0, mined ceiling].
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
declareKnobs("prereg-ceiling", []);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "pcl", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
const rows = await q(`trd_prereg?select=id,outcome,outcome_note,registered_at&order=registered_at.asc&limit=1000`) as { id: string; outcome: string | null; outcome_note: string | null; registered_at: string }[];
assertNonEmpty("trd_prereg rows", rows, 1);
const gate = (await q(`trd_gate_thresholds?key=eq.deflation_split&select=value,decision_ref`) as { value: Record<string, string>; decision_ref: string }[])[0];
if (!gate) { console.error("!! gate row deflation_split is missing — the split ceiling has no authority; RED"); Deno.exit(1); }
const nAll = Number((await fetch(`${OWNED}/trd_trial_counter?select=id`, { headers: { ...hdr, Prefer: "count=exact", Range: "0-0" } })).headers.get("content-range")?.split("/")[1]);
const mined = Math.sqrt(2 * Math.log(1_530_000 + nAll));
console.log(`==> PRE-REGISTERED BAR (D-823, gate row ${gate.decision_ref}) — ${rows.length} registrations; mined ceiling ${mined.toFixed(3)} at N=${(1_530_000 + nAll).toLocaleString()}`);
console.log(`    prereg ceiling = sqrt(2 ln (trials under the id + ${rows.length} registrations)). Necessary, not sufficient; the outcome label says which way the number went.`);
console.log(`    "trials 0" = the run was counted under a family name rather than the prereg id (before D-817); for those rows the bar is a FLOOR, not exact.\n`);
const tRe = /(?:NW\(?\d*\)?\s*)?\bt\s*(?:=|:|\s)\s*(-?\d+\.\d+)/gi;
let cleared = 0, withT = 0;
for (const r of rows) {
  const c = await preregCeiling({ rest: OWNED, headers: hdr, preregId: r.id });
  if (!(c.ceiling > 2.0 && c.ceiling <= mined + 1e-9)) { console.error(`!! ceiling ${c.ceiling.toFixed(3)} for ${r.id} outside (2.0, ${mined.toFixed(3)}] — positive control FAILED`); Deno.exit(1); }
  const ts: number[] = []; const note = r.outcome_note ?? ""; let m: RegExpExecArray | null; tRe.lastIndex = 0;
  while ((m = tRe.exec(note))) { const v = Math.abs(+m[1]); if (Number.isFinite(v) && v < 100) ts.push(v); }
  const maxT = ts.length ? Math.max(...ts) : NaN; if (ts.length) withT++;
  const clears = Number.isFinite(maxT) && maxT >= c.ceiling; if (clears) cleared++;
  console.log(`  ${clears ? "CLEARS " : "       "} ${r.id.padEnd(40)} ${(r.outcome ?? "open").padEnd(15)} max|t| ${Number.isFinite(maxT) ? maxT.toFixed(2).padStart(6) : "  n/a "}  bar ${c.ceiling.toFixed(2)}  (trials ${c.spentHere})`);
}
console.log(`\n  ${cleared} of ${withT} rows stating a t-statistic clear their own pre-registered bar (${rows.length - withT} state none).`);
console.log(`  A CLEARS row is admitted to the ladder ONLY if its outcome label is a confirmation in the registered direction and every other law holds on its lineage row.`);
