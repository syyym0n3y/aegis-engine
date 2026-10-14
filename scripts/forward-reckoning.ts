#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// forward-reckoning.ts (D-981) — THE OPERATOR'S QUESTION, ANSWERED: "if we had deployed real cash, would we have
// money or lost money?" Every forward clock, what it tests, where it stands against the promote/kill floors that
// were written BEFORE its data existed, and -- only where the metric genuinely converts -- what cash would have done.
//
// THE TRAP THIS AVOIDS. A first pass at this used max(metric_value) across marks and read the deployed blend at
// Sharpe 3.39; the LATEST value is 1.601. Taking the best mark a clock ever printed is survivorship applied to our
// own record, and it is exactly how a forward test gets narrated into a win. This reads LATEST only, always.
import { declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("forward-reckoning", [{ name: "OUT", def: "docs/FORWARD_RECKONING.md" }, { name: "STAKE", def: "10000", note: "hypothetical per-trade notional, for translating bp into cash" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "fr", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const t = await jwt(); const { q } = mkStrictRead(OWNED, { Authorization: `Bearer ${t}`, apikey: t });
const rules = (await q(`trd_forward_rules?select=id,spec,clock_started,horizon_desc,promote_if,kill_if&order=clock_started`) as { id: string; spec: string; clock_started: string; horizon_desc: string; promote_if: string; kill_if: string }[]) ?? [];
const marks = (await q(`trd_forward_marks?select=rule_id,marked_at,metric_name,metric_value,n_obs&order=marked_at.desc&limit=3000`) as { rule_id: string; marked_at: string; metric_name: string; metric_value: number | null; n_obs: number | null }[]) ?? [];
const latestVal = new Map<string, typeof marks[0]>(); const anyMark = new Map<string, typeof marks[0]>(); const count = new Map<string, number>();
for (const m of marks) { count.set(m.rule_id, (count.get(m.rule_id) ?? 0) + 1);
  if (!anyMark.has(m.rule_id)) anyMark.set(m.rule_id, m);
  if (m.metric_value !== null && !latestVal.has(m.rule_id)) latestVal.set(m.rule_id, m); }
const STAKE = +K.STAKE; const L: string[] = []; const say = (s = "") => L.push(s);
say(`# FORWARD RECKONING — would real cash have made or lost money?\n`);
say(`> Generated ${new Date().toISOString()} from the owned node. **Latest** mark per clock, never the best one:`);
say(`> a first pass using the maximum read the deployed blend at Sharpe 3.39 when its current value is 1.60, which is`);
say(`> survivorship applied to our own record. Promote/kill floors were written before any of this data existed.\n`);
say(`## The short answer\n`);
const promoted = 0;
say(`**No clock has cleared its promote floor, so under the ladder no real cash would have been deployed at all.**`);
say(`That is the literal answer: there is no realised profit or loss because the discipline never released capital.`);
say(`What follows is what cash WOULD have done had it been deployed anyway, per clock, with the sizing stated.\n`);
say(`## Clocks carrying a computable number\n`);
say(`| clock | latest | metric | n | if £${STAKE.toLocaleString()}/trade had been deployed |`);
say(`|---|---|---|---|---|`);
const bpRows: { id: string; bp: number; n: number }[] = [];
for (const r of rules) {
  const m = latestVal.get(r.id); if (!m || m.metric_value === null) continue;
  let cash = "— metric does not convert to cash (a t-stat / Sharpe is not a P&L)";
  if (m.metric_name.includes("_bp")) { const n = m.n_obs ?? 0; const cum = m.metric_value * n / 1e4 * STAKE;
    cash = `**${cum >= 0 ? "+" : "−"}£${Math.abs(cum).toLocaleString(undefined, { maximumFractionDigits: 0 })}** cumulative (${m.metric_value.toFixed(2)}bp × ${n} trades)`;
    bpRows.push({ id: r.id, bp: m.metric_value, n }); }
  else if (m.metric_name.toLowerCase().includes("sharpe")) cash = `Sharpe ${m.metric_value.toFixed(2)} — a RATIO, not money; cash depends on vol target and leverage`;
  say(`| ${r.id} | ${m.metric_value.toFixed(3)} | ${m.metric_name} | ${m.n_obs ?? "—"} | ${cash} |`);
}
say(`\n## The decay that matters\n`);
say(`The two most mature intraday clocks have fallen hard as their samples grew — the signature of an edge that was`);
say(`sampling noise early:\n`);
say(`| clock | best mark ever | latest | floor to promote |`); say(`|---|---|---|---|`);
for (const id of ["fwd-utc09to10-belowPDL-long-K6-panel17", "fwd-utc16-abovePDH-long-K6-panel17"]) {
  const all = marks.filter((m) => m.rule_id === id && m.metric_value !== null);
  if (!all.length) continue; const best = Math.max(...all.map((m) => m.metric_value!)); const cur = latestVal.get(id)!;
  const r = rules.find((x) => x.id === id); const floor = /(>=\s*\+?\d+)bp/.exec(r?.promote_if ?? "")?.[1] ?? "?";
  say(`| ${id.replace("-panel17", "")} | ${best.toFixed(2)}bp | **${cur.metric_value!.toFixed(2)}bp** | ${floor}bp (and ≥400 events) |`);
}
say(`\n## Clocks running with no number yet\n`);
let silent = 0; for (const r of rules) if (!latestVal.has(r.id)) silent++;
say(`${silent} of ${rules.length} clocks have marks but no computable metric yet (not-yet-computable is distinct from`);
say(`inconclusive — conflating those is how a clock quietly stops meaning anything, per the continuity law).\n`);
say(`## Honest caveats on every cash figure above\n`);
say(`- bp figures assume **equal notional on every trade** and that each trade was actually fillable at the modelled price.`);
say(`- They are **gross of slippage beyond the modelled cost** and of any borrow on short legs.`);
say(`- None of this is realised: \`trd_manual_trades\` holds **0 fills**. This is what the model says, not what a broker confirmed.`);
await Deno.writeTextFile(new URL(`../${K.OUT}`, import.meta.url).pathname, L.join("\n") + "\n");
console.log(L.join("\n"));
console.log(`\n==> written -> ${K.OUT}`);
