#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// probe-delisted-perps.ts (W4, D-639) — recovering the cohort that was declared unrecoverable.
//
// THE CORRECTION THIS SCRIPT EXISTS TO MAKE. One message after measuring the survivorship gap (D-638) I wrote that
// "a survivorship-free crypto panel needs a source that records what USED to be listed; exchangeInfo is definitionally
// incapable of it", and that neither equities nor crypto gives us one for free. The second half was ASSERTED, not
// checked. It is false for crypto:
//
//     GET /fapi/v1/klines?symbol=BTSUSDT   ->  returns history
//     BTSUSDT in exchangeInfo               ->  False
//
// Binance serves candles for contracts it no longer lists. The delisted cohort is therefore recoverable, and the
// binding constraint was never the data — it was having a LIST OF NAMES to ask for. exchangeInfo cannot supply that
// (it only knows the living), but SPOT exchangeInfo carries 734 USDT base assets, a superset that includes assets
// whose perpetual has since died.
//
// WHY THIS MATTERS BEYOND ONE PANEL. D-638 established that 16.8% of top-50 members are in wind-down, so the absent
// pre-seed cohort contains traded-universe names — FTMUSDT sat inside the top-50 for 1,351 of ~1,693 days. A book
// measured without those names is measured on the winners. Every crypto return on this board inherits that.
//
// WHAT IT DOES NOT CLAIM: recovering candles is not the same as recovering the cohort. A contract that delisted
// before 2019 or whose base asset was never on spot stays invisible, so the result is a LOWER BOUND on attrition and
// is reported as one.
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("probe-delisted-perps", [
  { name: "CAND", def: "/tmp/perp_candidates.txt", note: "one candidate symbol per line" },
  { name: "OUT", def: "/tmp/delisted_perps.tsv", note: "confirmed delisted perps with their spans" },
  { name: "SLEEP_MS", def: "160", note: "Binance weight limits; sequential and well under" },
  { name: "MIN_BARS", def: "200", note: "a contract with fewer daily bars is noise, not a panel member" },
]);

const SLEEP = Number(K.SLEEP_MS), MIN_BARS = Number(K.MIN_BARS);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Leveraged tokens (…UPUSDT / …DOWNUSDT) and tokenised equities (…BUSDT) never had perpetuals. Excluding them is a
// scoping choice and is stated rather than silently applied, so the candidate count in the output is auditable.
const isNotAPerp = (s: string) => /(UP|DOWN)USDT$/.test(s) || /^[A-Z]{2,6}BUSDT$/.test(s);

const raw = (await Deno.readTextFile(K.CAND)).split("\n").map((x) => x.trim()).filter(Boolean);
const cands = raw.filter((s) => !isNotAPerp(s));
assertNonEmpty("candidate symbols after filtering", cands, 20);
console.log(`==> DELISTED-PERP PROBE — ${raw.length} candidates, ${cands.length} after removing leveraged tokens and tokenised equities`);

interface Found { sym: string; first: string; last: string; bars: number }
const found: Found[] = [];
let checked = 0, empty = 0, errs = 0;

for (const sym of cands) {
  checked++;
  if (checked % 40 === 0) console.log(`    ${checked}/${cands.length} probed, ${found.length} recovered so far...`);
  // startTime in 2019 covers the whole USDT-margined perp era; 1500 daily bars is over four years.
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1d&startTime=1567296000000&limit=1500`;
  let rows: unknown = null;
  try {
    const r = await fetch(url);
    if (!r.ok) { empty++; await sleep(SLEEP); continue; }   // 400 = never existed as a perp
    rows = await r.json();
  } catch { errs++; await sleep(SLEEP); continue; }
  const arr = Array.isArray(rows) ? rows as (string | number)[][] : [];
  if (arr.length < MIN_BARS) { empty++; await sleep(SLEEP); continue; }
  const t0 = Number(arr[0][0]), t1 = Number(arr[arr.length - 1][0]);
  found.push({
    sym,
    first: new Date(t0).toISOString().slice(0, 10),
    last: new Date(t1).toISOString().slice(0, 10),
    bars: arr.length,
  });
  await sleep(SLEEP);
}

found.sort((a, b) => b.bars - a.bars);
await Deno.writeTextFile(K.OUT, found.map((f) => `${f.sym}\t${f.first}\t${f.last}\t${f.bars}`).join("\n"));

console.log(`\n    RECOVERED ${found.length} perpetual contract(s) absent from exchangeInfo but still served by klines`);
console.log(`    (${empty} candidates returned nothing or too few bars — those never traded as perps; ${errs} errors)`);
if (found.length) {
  console.log(`\n    ${"symbol".padEnd(16)}${"first".padEnd(12)}${"last".padEnd(12)}bars`);
  for (const f of found.slice(0, 25)) console.log(`    ${f.sym.padEnd(16)}${f.first.padEnd(12)}${f.last.padEnd(12)}${f.bars}`);
  if (found.length > 25) console.log(`    ... and ${found.length - 25} more, written to ${K.OUT}`);
}
console.log(`\n    THIS IS A LOWER BOUND, NOT THE COHORT. Candidates come from SPOT base assets, so any perpetual whose`);
console.log(`    base asset never listed on Binance spot — or delisted from spot too — remains invisible. Reported as a`);
console.log(`    floor on attrition rather than as a complete recovery.`);
