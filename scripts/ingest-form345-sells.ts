#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write --allow-run
// ingest-form345-sells.ts (D-805) — the insider SELL side that D-476 recorded as an open item.
//
// trd-insider-bulk filtered EDGAR's quarterly insider-transaction data sets to open-market PURCHASES (TRANS_CODE P,
// acquired) at the original backfill, so `trd_insider` (278k rows) holds no sells and the sell side was never
// testable. This pulls the same free quarterly zips (sec.gov/files/structureddata/data/insider-transactions-data-sets)
// and keeps open-market SALES (TRANS_CODE S, disposed), aggregated per ticker x accession, into a repo-root JSONL —
// a FILE, deliberately, because adding a column or table is a schema change and that is the operator's call.
// Idempotent per quarter (a .done marker); sequential downloads with pacing; the zip is deleted after parsing.
// Positive controls at the end: >= 60 quarters parsed, >= 100k sell rows, AAPL present.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("ingest-form345-sells", [
  { name: "FROM_Q", def: "2010q1", note: "first quarter (trd_insider buys start 2010-01)" },
  { name: "TO_Q", def: "2026q3", note: "last quarter to try (a 404 on the newest is expected, not an error)" },
  { name: "OUT", def: "data/insider-sells.jsonl" },
  { name: "CACHE", def: "data/edgar-form345", note: "zip + .done markers" },
  { name: "SLEEP_MS", def: "500", note: "pacing between quarters (SEC: <= 10 req/s; we do far less)" },
]);
const REPO = new URL("..", import.meta.url).pathname;
const abs = (p: string) => p.startsWith("/") ? p : `${REPO}${p}`;
const UA = "Aegis Research ona@revitalise.io";   // the identifying UA the SEC requires; same as trd-insider-bulk / ingest-edgar-fts
const OUT = abs(K.OUT), CACHE = abs(K.CACHE);
await Deno.mkdir(CACHE, { recursive: true });
const quarters: string[] = [];
{ const [y0, q0] = K.FROM_Q.split("q").map(Number), [y1, q1] = K.TO_Q.split("q").map(Number); for (let y = y0; y <= y1; y++) for (let q = 1; q <= 4; q++) { if (y === y0 && q < q0) continue; if (y === y1 && q > q1) continue; quarters.push(`${y}q${q}`); } }
const tsv = (txt: string) => { const lines = txt.split(/\r?\n/).filter((l) => l.length); const hdr = lines[0].split("\t").map((h) => h.trim().toUpperCase()); return { hdr, rows: lines.slice(1).map((l) => l.split("\t")) }; };
const MON: Record<string, string> = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
const pdate = (s: string) => { s = (s || "").trim(); let m = s.match(/^(\d{2})-([A-Z]{3})-(\d{4})/i); if (m) return `${m[3]}-${MON[m[2].toUpperCase()]}-${m[1]}`; m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0]; m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; return ""; };
async function unzipEntry(zip: string, want: string): Promise<string | null> {
  const ls = await new Deno.Command("unzip", { args: ["-Z1", zip] }).output(); const names = new TextDecoder().decode(ls.stdout).split("\n");
  const name = names.find((n) => n.trim().toUpperCase() === want.toUpperCase()); if (!name) return null;
  const o = await new Deno.Command("unzip", { args: ["-p", zip, name.trim()] }).output(); return new TextDecoder("latin1").decode(o.stdout);
}
let parsed = 0, missing = 0, total = 0;
for (const yq of quarters) {
  const done = `${CACHE}/${yq}.done`, zip = `${CACHE}/${yq}_form345.zip`;
  try { const d = await Deno.readTextFile(done); const n = Number(d.trim()); if (Number.isFinite(n)) { parsed++; total += n; continue; } } catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
  let have = false; try { await Deno.stat(zip); have = true; } catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
  if (!have) {
    const url = `https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/${yq}_form345.zip`;
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (r.status === 404) { console.log(`  ${yq}: 404 (not published)`); missing++; await sleep(+K.SLEEP_MS); continue; }
    if (!r.ok) throw new Error(`${yq}: HTTP ${r.status}`);
    await Deno.writeFile(zip, new Uint8Array(await r.arrayBuffer()));
  }
  const subTxt = await unzipEntry(zip, "SUBMISSION.tsv"), ndTxt = await unzipEntry(zip, "NONDERIV_TRANS.tsv");
  if (!subTxt || !ndTxt) throw new Error(`${yq}: missing SUBMISSION/NONDERIV_TRANS in zip`);
  const sub = tsv(subTxt); const ci = (h: string) => sub.hdr.indexOf(h);
  const acc2 = new Map<string, { tk: string; fd: string }>();
  for (const row of sub.rows) { const acc = row[ci("ACCESSION_NUMBER")]; const tk = (row[ci("ISSUERTRADINGSYMBOL")] || "").trim().toUpperCase(); const fd = row[ci("FILING_DATE")]; if (acc && tk && tk !== "NONE" && tk !== "N/A") acc2.set(acc, { tk, fd }); }
  const nd = tsv(ndTxt); const ni = (h: string) => nd.hdr.indexOf(h);
  const iAcc = ni("ACCESSION_NUMBER"), iCode = ni("TRANS_CODE"), iAcq = ni("TRANS_ACQUIRED_DISP_CD"), iSh = ni("TRANS_SHARES"), iPx = ni("TRANS_PRICEPERSHARE"), iDt = ni("TRANS_DATE");
  if ([iAcc, iCode, iAcq, iSh, iPx, iDt].some((i) => i < 0)) throw new Error(`${yq}: column layout changed: ${nd.hdr.slice(0, 12).join(",")}`);
  const byKey = new Map<string, { ticker: string; accession: string; disclosed_date: string; trade_date: string; shares: number; value_usd: number }>();
  let nS = 0;
  for (const row of nd.rows) {
    if ((row[iCode] || "").trim().toUpperCase() !== "S") continue; if ((row[iAcq] || "").trim().toUpperCase() !== "D") continue;
    const acc = row[iAcc]; const meta = acc2.get(acc); if (!meta) continue;
    const sh = +(row[iSh] || "0"), px = +(row[iPx] || "0"); if (!(sh > 0)) continue; nS++;
    const key = meta.tk + "|" + acc; const cur = byKey.get(key);
    if (cur) { cur.shares += sh; cur.value_usd += sh * px; } else byKey.set(key, { ticker: meta.tk, accession: acc, disclosed_date: pdate(meta.fd), trade_date: pdate(row[iDt] || ""), shares: sh, value_usd: sh * px });
  }
  const lines = [...byKey.values()].map((b) => JSON.stringify({ q: yq, ...b })).join("\n") + "\n";
  await Deno.writeTextFile(OUT, lines, { append: true });
  await Deno.writeTextFile(done, String(byKey.size));
  try { await Deno.remove(zip); } catch { /* keep going */ }
  parsed++; total += byKey.size;
  console.log(`  ${yq}: ${nd.rows.length.toLocaleString()} non-deriv txns, ${nS.toLocaleString()} open-market sells, ${byKey.size.toLocaleString()} ticker x accession rows`);
  await sleep(+K.SLEEP_MS);
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
console.log(`\n==> FORM 345 SELLS: ${parsed} quarters parsed, ${missing} not published, ${total.toLocaleString()} rows in ${OUT}`);
if (parsed < 60) { console.error("  RED — positive control: fewer than 60 quarters parsed"); Deno.exit(1); }
if (total < 100_000) { console.error("  RED — positive control: fewer than 100k sell rows"); Deno.exit(1); }
const txt = await Deno.readTextFile(OUT); if (!/"ticker":"AAPL"/.test(txt)) { console.error("  RED — positive control: AAPL has no sells"); Deno.exit(1); }
console.log("  positive controls passed (quarters, rows, AAPL)");
