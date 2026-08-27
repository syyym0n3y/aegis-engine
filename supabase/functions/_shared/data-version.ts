// data-version.ts (W4, D-635) — a number without its data snapshot is not a reproducible number.
//
// HOW THIS WAS FOUND. D-622 recorded the fails book at -9.69%/yr, t -7.84 on 2,388,308 events and 11,602 mean
// breadth. Re-running the SAME configuration today gives -9.56%/yr, t -7.80 — identical event count, identical
// breadth, different return. Three candidate causes were eliminated in turn:
//
//   - the loader rewrite (D-629)?  No. The D-621-era code was checked out and run on today's data: -9.56%/yr,
//     t -7.80, byte-identical to the new loader's output.
//   - non-determinism in tie-breaking?  No. Reversing symbol load order reproduces the run exactly.
//   - a different configuration?  No. The sibling row in the same table (PERSIST_D=5) reproduces EXACTLY at
//     -12.71%/yr, t -6.08.
//
// What remains is the data. 51 symbols had their price history refreshed on 2026-08-23/24, 14 of them present in
// the FTD panel — and the ledger CANNOT TELL US whether D-622 ran before or after that refresh, because no recorded
// result states the data it was computed against.
//
// WHY THIS MATTERS MORE THAN THE 0.13pp. Week 4 published a register inviting outsiders to reproduce claims. A claim
// that cannot be pinned to a data snapshot is not reproducible even in principle — the reader gets a different
// number and has no way to tell whether they made a mistake, we made a mistake, or the panel simply moved underneath
// both of us. Prices are not append-only: vendors restate splits, dividends and adjusted closes retroactively, so
// "the same query" legitimately returns different history over time.
//
// THE FINGERPRINT IS DELIBERATELY CHEAP. A full content hash of 57M rows would cost more than most analyses. What is
// recorded per table is (row count, max updated-at or max key) — enough to detect a refresh, an append, or a
// deletion, and cheap enough that no one is tempted to skip it.

export interface TableVersion { table: string; rows: number; watermark: string | null }

async function head(rest: string, headers: Record<string, string>, path: string): Promise<number | null> {
  try {
    const r = await fetch(`${rest}/${path}${path.includes("?") ? "&" : "?"}select=*&limit=1`, {
      headers: { ...headers, Prefer: "count=exact", Range: "0-0" },
    });
    if (!r.ok) return null;
    const n = Number(r.headers.get("content-range")?.split("/")[1] ?? NaN);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

async function watermark(rest: string, headers: Record<string, string>, table: string, col: string): Promise<string | null> {
  try {
    const r = await fetch(`${rest}/${table}?select=${col}&order=${col}.desc&limit=1`, { headers });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) && j.length ? String((j[0] as Record<string, unknown>)[col]) : null;
  } catch { return null; }
}

/**
 * Fingerprint the tables an analysis read.
 *
 * `tables` maps a table name to the column that moves when the data changes — `updated_at` where one exists,
 * otherwise the max key (a date column). Pass null to record row count only.
 */
export async function dataVersion(
  rest: string,
  headers: Record<string, string>,
  tables: Record<string, string | null>,
): Promise<TableVersion[]> {
  const out: TableVersion[] = [];
  for (const [t, col] of Object.entries(tables)) {
    const rows = await head(rest, headers, t);
    const wm = col ? await watermark(rest, headers, t, col) : null;
    out.push({ table: t, rows: rows ?? -1, watermark: wm });
  }
  return out;
}

/** One-line rendering for a result block, so the stamp travels with the number it belongs to. */
export function renderVersion(v: TableVersion[]): string {
  const parts = v.map((x) => `${x.table}=${x.rows < 0 ? "UNREADABLE" : x.rows.toLocaleString()}${x.watermark ? `@${String(x.watermark).slice(0, 19)}` : ""}`);
  return `    DATA VERSION: ${parts.join("  ")}`;
}

/** Print the stamp. Call at the END of an analysis, next to the result it pins. */
export async function stampDataVersion(
  rest: string,
  headers: Record<string, string>,
  tables: Record<string, string | null>,
): Promise<TableVersion[]> {
  const v = await dataVersion(rest, headers, tables);
  console.log(renderVersion(v));
  // An unreadable table is reported rather than omitted: a stamp with a silent hole is worse than no stamp, because
  // it looks complete. Same failure shape as the guards that certified green while reading nothing (D-584).
  const bad = v.filter((x) => x.rows < 0);
  if (bad.length) console.log(`    !! ${bad.length} table(s) could not be fingerprinted — this stamp is INCOMPLETE: ${bad.map((x) => x.table).join(", ")}`);
  return v;
}
