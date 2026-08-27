// paged-fetch.ts (W4, D-629) — why this programme's analyses have been slow, and it was never the data volume.
//
// THE DEFECT. 47 scripts page through large tables with `?order=d&offset=${off}&limit=50000`. OFFSET pagination is
// QUADRATIC: Postgres must scan and discard every preceding row to reach page N, so the cost per page grows with the
// offset. Measured on trd_short_volume (19,173,126 rows):
//
//     offset          0  ->  0.22s
//     offset  5,000,000  ->  0.91s
//     offset 15,000,000  ->  1.91s      (>3s in practice with the full column set)
//
// Across ~380 pages that is several billion discarded row-scans for ONE table read.
//
// THE SECOND DEFECT, which compounds it. `shortvol-surprise.ts` downloaded all 19.17M rows and then filtered
// CLIENT-SIDE with `if (!priced.has(r.symbol)) continue`. Only 5,822,317 rows (30.4%) belong to symbols that have
// prices — so 69.6% of a ~1GB transfer was fetched, parsed, and thrown away. The filter existed; it was just on the
// wrong side of the network.
//
// Both are fixed by asking the database for what is actually wanted:
//   - `bySymbol()` filters server-side in batches, hitting the (symbol, d) index, with NO offset at all.
//   - `byKeyset()` walks a monotonic column with `col=gt.<last>`, so every page is an indexed seek rather than a scan.
//
// WHY THIS MATTERS BEYOND SPEED. A slow analysis is not merely annoying — it changes what gets tested. A sweep that
// takes twenty minutes gets run once with one parameterisation; a sweep that takes ninety seconds gets run against
// its controls, its eras, and its own null. The cost of asking a question determines how many questions get asked,
// and this programme's central failure mode has been reporting a number before running the test that would kill it.

export interface PageOpts {
  rest: string;
  headers: Record<string, string>;
  table: string;
  select: string;
  /** extra PostgREST filters, e.g. "tf=eq.1hSF" — no leading & */
  where?: string;
  pageSize?: number;
  /** called once per page with the rows; return void. Streaming avoids holding the whole table in memory. */
  onPage: (rows: Record<string, unknown>[]) => void;
  /** progress callback: (rowsSoFar, pagesSoFar) */
  onProgress?: (rows: number, pages: number) => void;
}

async function get(url: string, headers: Record<string, string>): Promise<Record<string, unknown>[]> {
  const r = await fetch(url, { headers });
  // A failed page must THROW, never silently end the walk. A swallowed error here truncates the dataset and the
  // analysis downstream reports a null computed on partial data — the D-584 failure shape, where five guards
  // certified green while reading nothing.
  if (!r.ok) throw new Error(`paged-fetch: ${url.slice(0, 120)} -> HTTP ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(`paged-fetch: non-array response from ${url.slice(0, 120)}`);
  return j as Record<string, unknown>[];
}

/**
 * Fetch only the rows belonging to `symbols`, in server-side batches.
 *
 * This is the right call whenever the analysis will discard most symbols anyway. It replaces a full-table download
 * plus a client-side `Set.has()` filter, and it uses the (symbol, d) index instead of a sequential scan.
 */
export async function bySymbol(
  opts: PageOpts & { symbols: string[]; symbolCol?: string; batch?: number; orderBy?: string },
): Promise<{ rows: number; pages: number }> {
  const col = opts.symbolCol ?? "symbol";
  const batch = opts.batch ?? 60;
  const size = opts.pageSize ?? 50000;
  let rows = 0, pages = 0;
  const uniq = [...new Set(opts.symbols)];
  for (let i = 0; i < uniq.length; i += batch) {
    const part = uniq.slice(i, i + batch).map((s) => `"${s}"`).join(",");
    // Within a symbol batch the row count is bounded, but page it anyway so an unusually deep batch cannot silently
    // truncate at PostgREST's max-rows limit.
    //
    // THE ORDER CLAUSE IS LOAD-BEARING, NOT COSMETIC. Paging by offset with no ORDER BY is undefined behaviour:
    // Postgres may return rows in a different sequence on each request, so a row can appear on two pages or on
    // none. The corruption is silent and data-dependent — it would surface as a slightly wrong Sharpe, never as an
    // error. Ordering by the batch column plus the range key makes the sequence total and the paging safe.
    // (Batches stay small enough that these offsets are 1-3 pages deep, so this does not reintroduce D-629.)
    const ord = opts.orderBy ? `&order=${opts.orderBy}` : `&order=${col}`;
    let off = 0;
    for (;;) {
      const url = `${opts.rest}/${opts.table}?${col}=in.(${encodeURIComponent(part)})&select=${opts.select}`
        + `${opts.where ? `&${opts.where}` : ""}${ord}&offset=${off}&limit=${size}`;
      const page = await get(url, opts.headers);
      if (!page.length) break;
      opts.onPage(page);
      rows += page.length; pages++;
      opts.onProgress?.(rows, pages);
      if (page.length < size) break;
      off += size;
    }
  }
  return { rows, pages };
}

/**
 * Walk a whole table by KEYSET on a monotonic column instead of by OFFSET.
 *
 * `keyCol` must be non-decreasing under `order=keyCol`. Ties are handled by re-requesting the boundary value and
 * skipping rows already seen, which is why `dedupeKey` is required: without it a tied boundary either loses rows or
 * repeats them, and both are silent.
 */
export async function byKeyset(
  opts: PageOpts & { keyCol: string; dedupeKey: (r: Record<string, unknown>) => string },
): Promise<{ rows: number; pages: number }> {
  const size = opts.pageSize ?? 50000;
  let last: string | null = null;
  let rows = 0, pages = 0;
  let boundarySeen = new Set<string>();
  for (;;) {
    const url = `${opts.rest}/${opts.table}?select=${opts.select}${opts.where ? `&${opts.where}` : ""}`
      + `${last === null ? "" : `&${opts.keyCol}=gte.${encodeURIComponent(last)}`}`
      + `&order=${opts.keyCol}&limit=${size}`;
    const page = await get(url, opts.headers);
    if (!page.length) break;
    const fresh = page.filter((r) => !boundarySeen.has(opts.dedupeKey(r)));
    if (!fresh.length) break;                       // whole page was the boundary we already consumed
    opts.onPage(fresh);
    rows += fresh.length; pages++;
    opts.onProgress?.(rows, pages);
    if (page.length < size) break;
    const newLast = String(page[page.length - 1][opts.keyCol]);
    // Carry forward only the rows AT the boundary value, so the next request can skip them without holding the
    // whole page in memory.
    boundarySeen = new Set(page.filter((r) => String(r[opts.keyCol]) === newLast).map(opts.dedupeKey));
    if (newLast === last) {
      // Every row in the page shares one key value and the page is full: a single key wider than pageSize. Widening
      // is not possible here, so fail loudly rather than loop forever or silently drop the remainder.
      throw new Error(`paged-fetch: ${opts.keyCol}=${newLast} has more than ${size} rows; keyset cannot advance. Use bySymbol() or a compound key.`);
    }
    last = newLast;
  }
  return { rows, pages };
}
