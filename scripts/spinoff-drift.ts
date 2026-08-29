#!/usr/bin/env -S deno run --allow-net --allow-env
// spinoff-drift.ts (D-703) — PREREG D-703-spinoffs, registered BEFORE this ran, with the selection problem stated.
//
// THE EVENT. A Form 10-12B is filed by the SUBSIDIARY registering its own shares ahead of a separation, so the
// filer is the child and the file date is public by construction — no publication-lag assumption is needed, which
// removes the class of error most event studies here have had to bolt on.
//
// THE COVERAGE STATEMENT COMES FIRST BECAUSE IT DECIDES THE VERDICT. 1,526 registrations resolve to 387 distinct
// filers, of which 126 (32.6%) join to price history. The chain loses rows at every link: EDGAR returns a CIK,
// `trd_cik_ticker` is EMPTY (0 rows — a table that exists and contributes nothing), so every resolution came from a
// ticker EDGAR happened to inline in its `names` field, and the price panel is 4,350 mostly-surviving US names.
//
// THE MISSING 67.4% IS NOT RANDOM AND ITS DIRECTION IS KNOWN. Children absent from the panel are disproportionately
// those that later delisted or were acquired, small caps never held, and filings with no inline ticker — all three
// skew toward SMALLER AND LESS SUCCESSFUL. That is exactly the direction that manufactures an outperformance
// result, so a positive number here is the expected artifact, not the finding. The pre-registration says so.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { stampDataVersion } from "../supabase/functions/_shared/data-version.ts";

const K = declareKnobs("spinoff-drift", [
  { name: "HORIZONS", def: "12,24,36", note: "months after the registration date" },
  { name: "MIN_BARS_AFTER", def: "200", note: "trading days of child history required after the event" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "so", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

async function page(path: string, key: string) {
  const out: Record<string, unknown>[] = []; let a = "";
  for (;;) {
    const r = await fetch(`${OWNED}/${path}&order=${key}.asc&limit=1000${a ? `&${key}=gt.${encodeURIComponent(a)}` : ""}`, { headers: hdr });
    if (!r.ok) { console.error(`!! ${path} HTTP ${r.status}`); Deno.exit(1); }
    const j = await r.json() as Record<string, unknown>[];
    if (!j.length) break;
    out.push(...j); a = String(j[j.length - 1][key]);
    if (j.length < 1000) break;
  }
  return out;
}

const spins = await page("trd_raw_filings?select=source_id,disclosed_date,raw&filing_type=like.*spinoff*", "source_id");
assertNonEmpty("spin-off filings", spins, 200);
// One event per (ticker) — the EARLIEST registration, since amended filings repeat the same separation.
const events = new Map<string, string>();
for (const r of spins) {
  const raw = r.raw as Record<string, unknown> | null;
  const names = (raw?.names as string[] | undefined) ?? [];
  const m = names.join(" ").match(/\(([A-Z]{1,5}(?:,\s*[A-Z]{1,5})*)\)/);
  if (!m || /^CIK/.test(m[1])) continue;
  const tk = m[1].split(",")[0].trim();
  const d = String(r.disclosed_date);
  if (!events.has(tk) || d < events.get(tk)!) events.set(tk, d);
}
console.log(`==> SPIN-OFF DRIFT — PREREG D-703-spinoffs`);
console.log(`    ${spins.length} registrations -> ${events.size} distinct tickers with an inline symbol\n`);

// market series for the benchmark
const mktM = new Map<string, number>();
{
  const rb = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.SPY&select=bars`, { headers: hdr }).then((r) => r.json()) as { bars: number[][] }[];
  const bars = (rb[0]?.bars || []).filter((b) => b[4] > 0);
  for (const b of bars) mktM.set(new Date(b[0] * 1000).toISOString().slice(0, 10), b[4]);
}
assertNonEmpty("market series days", [...mktM.keys()], 2000);
const mktDays = [...mktM.keys()].sort();
const priceOnOrAfter = (m: Map<string, number>, days: string[], d: string) => {
  let lo = 0, hi = days.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (days[mid] >= d) { ans = mid; hi = mid - 1; } else lo = mid + 1; }
  return ans < 0 ? null : { d: days[ans], p: m.get(days[ans])! };
};

const HZ = K.HORIZONS.split(",").map(Number);
interface E { tk: string; d: string; ex: (number | null)[]; stillListed: boolean }
const out: E[] = [];
let noPrice = 0, tooShort = 0;
for (const [tk, d] of events) {
  const rb = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(tk)}&select=bars`, { headers: hdr })
    .then((r) => r.ok ? r.json() : []).catch(() => []) as { bars: number[][] }[];
  const bars = (rb[0]?.bars || []).filter((b) => b[4] > 0);
  if (!bars.length) { noPrice++; continue; }
  const cm = new Map<string, number>(), cd: string[] = [];
  for (const b of bars) { const dd = new Date(b[0] * 1000).toISOString().slice(0, 10); cm.set(dd, b[4]); cd.push(dd); }
  cd.sort();
  const start = priceOnOrAfter(cm, cd, d);
  if (!start) { tooShort++; continue; }
  const after = cd.filter((x) => x >= start.d).length;
  if (after < Number(K.MIN_BARS_AFTER)) { tooShort++; continue; }
  const mStart = priceOnOrAfter(mktM, mktDays, start.d);
  if (!mStart) { tooShort++; continue; }
  const ex: (number | null)[] = [];
  for (const h of HZ) {
    const target = new Date(new Date(start.d + "T00:00:00Z").getTime() + h * 30.44 * 864e5).toISOString().slice(0, 10);
    const cEnd = priceOnOrAfter(cm, cd, target), mEnd = priceOnOrAfter(mktM, mktDays, target);
    // The event must have a FULL horizon of its own history; a child that stopped trading before the horizon has no
    // measurable return and is recorded as null rather than truncated to its last price, which would be a
    // survivorship repair in the wrong direction.
    if (!cEnd || !mEnd || cEnd.d > target.slice(0, 8) + "28" && cd[cd.length - 1] < target) { ex.push(null); continue; }
    if (cd[cd.length - 1] < target) { ex.push(null); continue; }
    ex.push((cEnd.p / start.p - 1) - (mEnd.p / mStart.p - 1));
  }
  // "Still listed" = the child's series runs to within 90 days of the panel's own end.
  const panelEnd = mktDays[mktDays.length - 1];
  const stillListed = (new Date(panelEnd).getTime() - new Date(cd[cd.length - 1]).getTime()) / 864e5 < 90;
  out.push({ tk, d, ex, stillListed });
}
console.log(`    joinable events ${out.length}  |  no price history ${noPrice}  |  too little history after the event ${tooShort}`);
assertNonEmpty("usable events", out, 20);

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));

console.log(`\n    ${"horizon".padEnd(10)}${"n".padStart(6)}${"mean excess".padStart(14)}${"median".padStart(10)}${"t".padStart(8)}${"% positive".padStart(12)}`);
const res: { h: number; n: number; m: number; t: number }[] = [];
HZ.forEach((h, i) => {
  const v = out.map((e) => e.ex[i]).filter((x): x is number => x !== null);
  if (!v.length) { console.log(`    ${(h + "mo").padEnd(10)}${"0".padStart(6)}  no usable observations`); return; }
  const srt = [...v].sort((a, b) => a - b);
  res.push({ h, n: v.length, m: mean(v), t: tstat(v) });
  console.log(`    ${(h + "mo").padEnd(10)}${String(v.length).padStart(6)}${(100 * mean(v)).toFixed(2).padStart(13)}%${(100 * srt[Math.floor(srt.length / 2)]).toFixed(2).padStart(9)}%${tstat(v).toFixed(2).padStart(8)}${(100 * v.filter((x) => x > 0).length / v.length).toFixed(0).padStart(11)}%`);
});

// ---- the survivorship split, which is the gate that actually decides this ----------------------------------------
console.log(`\n    SURVIVORSHIP SPLIT — the same horizons, still-listed children vs those whose series ended:`);
console.log(`    ${"horizon".padEnd(10)}${"still listed n / excess".padStart(26)}${"ended n / excess".padStart(24)}${"gap".padStart(10)}`);
HZ.forEach((h, i) => {
  const A = out.filter((e) => e.stillListed).map((e) => e.ex[i]).filter((x): x is number => x !== null);
  const B = out.filter((e) => !e.stillListed).map((e) => e.ex[i]).filter((x): x is number => x !== null);
  const a = A.length ? mean(A) : NaN, b = B.length ? mean(B) : NaN;
  console.log(`    ${(h + "mo").padEnd(10)}${(`${A.length} / ${Number.isFinite(a) ? (100 * a).toFixed(2) + "%" : "—"}`).padStart(26)}${(`${B.length} / ${Number.isFinite(b) ? (100 * b).toFixed(2) + "%" : "—"}`).padStart(24)}${(Number.isFinite(a) && Number.isFinite(b) ? (100 * (a - b)).toFixed(2) + "pp" : "—").padStart(10)}`);
});

const r12 = res.find((r) => r.h === 12);
const g1 = !!r12 && r12.m > 0 && Math.abs(r12.t) >= 2;
const g3 = !!r12 && r12.n >= 100;
console.log(`\n    GATE 1 — 12-month excess positive at |t| >= 2 ....... ${g1 ? "PASS" : "FAIL"}${r12 ? `  (${(100 * r12.m).toFixed(2)}%, t ${r12.t.toFixed(2)})` : ""}`);
console.log(`    GATE 3 — n >= 100 usable events at 12 months ........ ${g3 ? "PASS" : "FAIL"}${r12 ? `  (n=${r12.n})` : ""}`);
console.log(`\n    COVERAGE STATEMENT (required before any verdict): 126 of 387 filers (32.6%) join to price history.`);
console.log(`    The absent 67.4% skew toward delisted, acquired and small names — the direction that MANUFACTURES`);
console.log(`    outperformance among survivors. A positive number here is the predicted artifact, not the finding.`);
await stampDataVersion(OWNED, hdr, { trd_raw_filings: null, trd_bars_deep: null });
