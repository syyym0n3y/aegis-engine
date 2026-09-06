#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write
// prop-ledger.ts (D-807) — the OPERATOR's append-only ledger for the prop-firm clock fwd-prop-ftmo100k-utc16-0p5x-v1.
// The clock is scored ONLY from this file (CONTINUITY LAW, D-613): no entries, no number. One entry per day traded /
// statement line. Append-only: an existing entry is never edited here; a correction is a new entry with a note.
//   SET_FEE=<usd>                                  record the evaluation fee once (the stake the rule is priced against)
//   ADD=1 DATE=YYYY-MM-DD PHASE=eval1|eval2|funded EQUITY=<usd> [PAYOUT=<usd>] [BREACH=1] [NOTE="..."]
//   (no knobs)                                     print the summary the scorer will read
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("prop-ledger", [
  { name: "LEDGER", def: "data/prop-ledger.json" }, { name: "SET_FEE", def: "" }, { name: "ADD", def: "0" },
  { name: "DATE", def: "" }, { name: "PHASE", def: "" }, { name: "EQUITY", def: "" }, { name: "PAYOUT", def: "0" }, { name: "BREACH", def: "0" }, { name: "NOTE", def: "" },
]);
export interface PropEntry { date: string; phase: "eval1" | "eval2" | "funded"; equity_usd: number; payout_usd: number; breach: boolean; note: string; recorded_at: string }
export interface PropLedger { clock: string; firm: string; fee_usd: number | null; entries: PropEntry[] }
const REPO = new URL("..", import.meta.url).pathname; const path = K.LEDGER.startsWith("/") ? K.LEDGER : `${REPO}${K.LEDGER}`;
export async function readLedger(p = path): Promise<PropLedger> {
  try { return JSON.parse(await Deno.readTextFile(p)) as PropLedger; }
  catch (e) { if (e instanceof Deno.errors.NotFound) return { clock: "fwd-prop-ftmo100k-utc16-0p5x-v1", firm: "FTMO-style 100k two-phase", fee_usd: null, entries: [] }; throw e; }
}
if (import.meta.main) {
  const L = await readLedger();
  if (K.SET_FEE) { if (L.fee_usd != null) { console.error(`!! fee already recorded (${L.fee_usd}); it is not editable — add a NOTE entry if it was wrong`); Deno.exit(1); } L.fee_usd = Number(K.SET_FEE); }
  if (K.ADD === "1") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(K.DATE) || !["eval1", "eval2", "funded"].includes(K.PHASE) || !Number.isFinite(Number(K.EQUITY))) { console.error("!! ADD needs DATE=YYYY-MM-DD PHASE=eval1|eval2|funded EQUITY=<usd>"); Deno.exit(1); }
    const last = L.entries[L.entries.length - 1]; if (last && K.DATE < last.date) { console.error(`!! DATE ${K.DATE} precedes the last entry ${last.date} — entries are chronological and append-only`); Deno.exit(1); }
    L.entries.push({ date: K.DATE, phase: K.PHASE as PropEntry["phase"], equity_usd: Number(K.EQUITY), payout_usd: Number(K.PAYOUT) || 0, breach: K.BREACH === "1", note: K.NOTE, recorded_at: new Date().toISOString() });
  }
  if (K.SET_FEE || K.ADD === "1") await Deno.writeTextFile(path, JSON.stringify(L, null, 1) + "\n");
  const pay = L.entries.reduce((s, e) => s + e.payout_usd, 0), funded = L.entries.filter((e) => e.phase === "funded");
  console.log(`  ${L.clock} — fee ${L.fee_usd ?? "UNSET"} | entries ${L.entries.length} (${L.entries[0]?.date ?? "-"}..${L.entries[L.entries.length - 1]?.date ?? "-"}) | funded days ${funded.length} | payouts ${pay} | breaches ${L.entries.filter((e) => e.breach).length}`);
  if (!L.entries.length) console.log("  ledger EMPTY — the clock is registered and the scorer reports not-yet-computable until the first entry (fee unpaid = no experiment yet).");
}
