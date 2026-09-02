#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// ingest-vx-curve.ts — CBOE per-expiry VX futures daily history -> data/vx-contracts.json (gitignored; no new table).
//
// SOURCE: https://cdn.cboe.com/data/us/futures/market_statistics/historical_data/VX/VX_{EXPIRY}.csv, one file per
// contract, keyed on the contract's EXPIRY date (a Wednesday). Free, keyless, allowlisted. Columns:
//   Trade Date,Futures,Open,High,Low,Close,Settle,Change,Total Volume,EFP,Open Interest
// PRICE RULE (measured, not assumed): pre-2016 files carry Settle=0 on every row and the usable price is Close;
// 2016+ files carry a real Settle. So price = Settle>0 ? Settle : Close, and a row with neither is dropped.
// ENUMERATION: every Wednesday 2013-01-01..2026-12-31 is probed sequentially (~200ms apart). Contracts whose expiry
// is the standard MONTHLY one (the Wednesday 30 days before the 3rd Friday of the FOLLOWING month) are marked
// monthly:true; every other 200 is a WEEKLY (listed from 2015) and is marked monthly:false. Nothing is inferred
// from a 404 other than "no contract expired that Wednesday".
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("ingest-vx-curve", [
  { name: "VX_FROM", def: "2013-01-01", note: "first candidate expiry Wednesday" },
  { name: "VX_TO", def: "2026-12-31", note: "last candidate expiry Wednesday" },
  { name: "VX_SLEEP_MS", def: "200", note: "sequential politeness delay between CDN fetches" },
]);
const FROM = Deno.env.get("VX_FROM") || "2013-01-01";
const TO = Deno.env.get("VX_TO") || "2026-12-31";
const SLEEP = Number(Deno.env.get("VX_SLEEP_MS") || "200");
const OUT = new URL("../data/vx-contracts.json", import.meta.url).pathname;

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** standard VIX monthly expiry: the Wednesday 30 days before the 3rd Friday of the FOLLOWING month */
function monthlyExpiries(fromY: number, toY: number): Set<string> {
  const s = new Set<string>();
  for (let y = fromY; y <= toY + 1; y++) {
    for (let m = 0; m < 12; m++) {
      // 3rd Friday of month m of year y
      const d = new Date(Date.UTC(y, m, 1));
      let fridays = 0;
      while (true) {
        if (d.getUTCDay() === 5) { fridays++; if (fridays === 3) break; }
        d.setUTCDate(d.getUTCDate() + 1);
      }
      const exp = new Date(d.getTime() - 30 * 86400000);
      s.add(iso(exp)); // (a holiday shifts this by a day; such contracts simply land in the weekly bucket — stated)
    }
  }
  return s;
}

type Row = { d: string; px: number; settle: number; close: number; vol: number; oi: number };
type Contract = { expiry: string; monthly: boolean; label: string; rows: Row[] };

const monthly = monthlyExpiries(Number(FROM.slice(0, 4)) - 1, Number(TO.slice(0, 4)));
const candidates: string[] = [];
{
  const d = new Date(FROM + "T00:00:00Z");
  while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);
  for (; iso(d) <= TO; d.setUTCDate(d.getUTCDate() + 7)) candidates.push(iso(d));
}
console.log(`==> probing ${candidates.length} candidate expiry Wednesdays ${FROM} .. ${TO} (sequential, ${SLEEP}ms apart)`);

const contracts: Contract[] = [];
let hits = 0, misses = 0;
for (const exp of candidates) {
  const url = `https://cdn.cboe.com/data/us/futures/market_statistics/historical_data/VX/VX_${exp}.csv`;
  let txt = "";
  try {
    const r = await fetch(url);
    if (!r.ok) { await r.body?.cancel(); misses++; await new Promise((s) => setTimeout(s, SLEEP)); continue; }
    txt = await r.text();
  } catch (_e) { misses++; await new Promise((s) => setTimeout(s, SLEEP)); continue; }
  await new Promise((s) => setTimeout(s, SLEEP));
  const lines = txt.trim().split("\n");
  if (lines.length < 3 || !lines[0].startsWith("Trade Date")) { misses++; continue; }
  const rows: Row[] = [];
  let label = "";
  for (const ln of lines.slice(1)) {
    const c = ln.split(",");
    if (c.length < 11) continue;
    const d = c[0].trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    label = c[1].trim();
    const close = Number(c[5]), settle = Number(c[6]);
    const px = settle > 0 ? settle : close;
    if (!(px > 0)) continue;
    rows.push({ d, px, settle, close, vol: Number(c[8]) || 0, oi: Number(c[10]) || 0 });
  }
  if (rows.length === 0) { misses++; continue; }
  rows.sort((a, b) => a.d < b.d ? -1 : 1);
  contracts.push({ expiry: exp, monthly: monthly.has(exp), label, rows });
  hits++;
  if (hits % 25 === 0) console.log(`    ${hits} contracts (last ${exp}, ${rows.length} rows)`);
}

// HOLIDAY-SHIFTED MONTHLIES: when the 3rd Friday is an exchange holiday the VIX expiry moves to the TUESDAY, so a
// Wednesday-only probe misses that contract entirely (6 of 168 in the 2013-2026 span). Probe the Tuesday and the
// Thursday around every missing standard monthly and keep any that returns rows, marked monthly:true.
{
  const got = new Set(contracts.map((c) => c.expiry));
  const wantMon = [...monthly].filter((d) => d >= FROM && d <= TO && !got.has(d)).sort();
  for (const exp of wantMon) {
    for (const off of [-1, 1]) {
      const alt = iso(new Date(Date.parse(exp) + off * 86400000));
      if (got.has(alt)) continue;
      const url = `https://cdn.cboe.com/data/us/futures/market_statistics/historical_data/VX/VX_${alt}.csv`;
      let txt = "";
      try {
        const r = await fetch(url);
        if (!r.ok) { await r.body?.cancel(); await new Promise((s) => setTimeout(s, SLEEP)); continue; }
        txt = await r.text();
      } catch (_e) { await new Promise((s) => setTimeout(s, SLEEP)); continue; }
      await new Promise((s) => setTimeout(s, SLEEP));
      const lines = txt.trim().split("\n");
      if (lines.length < 3 || !lines[0].startsWith("Trade Date")) continue;
      const rows: Row[] = []; let label = "";
      for (const ln of lines.slice(1)) {
        const c = ln.split(",");
        if (c.length < 11) continue;
        const d = c[0].trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
        label = c[1].trim();
        const close = Number(c[5]), settle = Number(c[6]);
        const px = settle > 0 ? settle : close;
        if (!(px > 0)) continue;
        rows.push({ d, px, settle, close, vol: Number(c[8]) || 0, oi: Number(c[10]) || 0 });
      }
      if (!rows.length) continue;
      rows.sort((a, b) => a.d < b.d ? -1 : 1);
      contracts.push({ expiry: alt, monthly: true, label, rows });
      monthly.add(alt); monthly.delete(exp);
      got.add(alt); hits++;
      console.log(`    holiday-shifted monthly recovered: ${exp} -> ${alt} (${rows.length} rows)`);
      break;
    }
  }
}

contracts.sort((a, b) => a.expiry < b.expiry ? -1 : 1);
await Deno.writeTextFile(OUT, JSON.stringify({ fetched: new Date().toISOString(), source: "cboe cdn VX per-expiry", contracts }));

const mon = contracts.filter((c) => c.monthly), wk = contracts.filter((c) => !c.monthly);
const allRows = contracts.flatMap((c) => c.rows.map((r) => r.d));
allRows.sort();
console.log(`\n  CONTRACTS ${contracts.length}  (monthly ${mon.length}, weekly/other ${wk.length})   probes hit ${hits} / miss ${misses}`);
console.log(`  quote span ${allRows[0]} .. ${allRows[allRows.length - 1]}   total quote-days ${allRows.length}`);
console.log(`  expiry span ${contracts[0].expiry} .. ${contracts[contracts.length - 1].expiry}`);
// gaps: monthly expiries expected vs found
const expMon = [...monthly].filter((d) => d >= FROM && d <= TO).sort();
const gotMon = new Set(mon.map((c) => c.expiry));
const missMon = expMon.filter((d) => !gotMon.has(d));
console.log(`  MONTHLY GAPS: ${missMon.length} of ${expMon.length} standard monthly expiries returned no file` +
  (missMon.length ? ` -> ${missMon.slice(0, 12).join(" ")}${missMon.length > 12 ? " ..." : ""}` : ""));
console.log(`  wrote ${OUT}`);
