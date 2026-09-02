// run-preconditions.ts (D-598) — the fix for the single largest source of wasted work in this programme.
//
// EVIDENCE. Every self-inflicted failure of the 2026-08-25 session was classified. Ten defects; NINE share one
// structure, and it is not a reasoning error:
//   stale .tsv read after a run wrote nothing        — never checked the run produced the file
//   columns labelled "grossR" that were NET          — never checked PERP_FEE_RT_BP=0 was passed
//   SYMBOLS filter matched 0 of 31 names             — never checked the filter matched anything
//   self-test silently no-opped on a typo'd env name — never checked the variable took effect
//   five guards exited 0 with the database down      — never checked any rows had been read
//   a guard certifying "ALL 0 PROMOTED ROWS"         — never checked the checked set was non-empty
//   a regex "family" splitting one book into twenty  — never checked the parse matched the real column
//   a blanket UPDATE hitting a pre-registered row    — never checked which rows the WHERE touched
// Zero were arithmetic errors. Zero were misreadings of a market. They are unvalidated preconditions, every one.
//
// The rework rate that produced was 41% of commits. Reviewing harder does not fix this class; asserting does.
// So: declare the knobs a script honours, and this module (a) prints what ACTUALLY took effect, (b) refuses to run
// when a set environment variable is a near-miss of a declared knob — the typo case — and (c) gives cheap assertions
// for the empty-result and stale-file cases.

/** Levenshtein, small and exact — used only to spot a typo'd knob name. */
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[m][n];
}

// Environment names every script sees and must never be flagged against.
const AMBIENT = new Set([
  "PATH", "HOME", "SHELL", "PWD", "LANG", "TERM", "USER", "TMPDIR", "SHLVL", "OLDPWD", "_",
  "OWNED_REST", "JWT_SECRET", "REST_PORT", "DB_PORT", "POSTGRES_PASSWORD", "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY", "DENO_DIR", "NO_COLOR", "COLIMA_HOME", "DOCKER_HOST",
]);
// Host-injected families that are never script knobs.
const AMBIENT_PREFIX = ["CLAUDE_", "ANTHROPIC_", "AWS_", "GIT_", "SSH_", "XPC_", "LC_", "HOMEBREW_"];

export interface Knob { name: string; def?: string; note?: string }

/**
 * Declare the knobs this script honours. Prints the EFFECTIVE configuration and dies on a near-miss env name.
 * Returns the resolved values so a script cannot read a knob it did not declare.
 */
export function declareKnobs(script: string, knobs: Knob[]): Record<string, string> {
  const declared = new Set(knobs.map((k) => k.name));
  const out: Record<string, string> = {};
  const lines: string[] = [];
  for (const k of knobs) {
    const raw = Deno.env.get(k.name);
    out[k.name] = raw ?? k.def ?? "";
    lines.push(`      ${k.name.padEnd(22)} = ${String(out[k.name]).padEnd(14)}${raw === undefined ? "(default)" : "(SET)"}${k.note ? "  " + k.note : ""}`);
  }
  // The typo case: a variable is SET, is not declared here, and is within edit-distance 3 of something that is.
  // This is precisely the GUARD_SELFTEST/SELFTEST failure, where a self-test silently did nothing and was nearly
  // reported as a verification.
  const suspects: string[] = [];
  for (const [name] of Object.entries(Deno.env.toObject())) {
    if (declared.has(name) || AMBIENT.has(name) || name.startsWith("npm_") || name.startsWith("__")) continue;
    if (AMBIENT_PREFIX.some((p) => name.startsWith(p))) continue;
    for (const d of declared) {
      const N = name.toUpperCase(), D = d.toUpperCase();
      // Two shapes, both seen in real defects. EDIT DISTANCE catches a mistyped name (SELFTST). CONTAINMENT catches
      // the prefix/suffix variant, which is what actually happened: GUARD_SELFTEST was set while the script read
      // SELFTEST — edit distance 6, so a distance test alone would have missed the very bug this exists to prevent.
      const near = lev(N, D) > 0 && lev(N, D) <= 3;
      // Containment must be a PLAUSIBLE VARIANT, not any string that happens to embed the knob name. GUARD_SELFTEST
      // vs SELFTEST differs by 6 characters and is a real typo shape; CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH vs
      // REFRESH differs by 31 and is an ambient variable that merely shares a word. Without this bound the guard
      // false-positives on the host environment and refuses correct runs — which is precisely how a guard stops
      // being believed. Found by this guard blocking its own author's ingest.
      const contains = N !== D && (N.includes(D) || D.includes(N))
        && Math.min(N.length, D.length) >= 4 && Math.abs(N.length - D.length) <= 8;
      if (near || contains) { suspects.push(`${name} (set, but this script reads ${d} — did nothing)`); break; }
    }
  }
  console.log(`    [${script}] effective configuration:`);
  for (const l of lines) console.log(l);
  if (suspects.length) {
    console.error(`!! UNRECOGNISED KNOB — refusing to run, because a variable that does nothing silently produces a`);
    console.error(`   result you will read as if it answered your question:`);
    for (const s of suspects) console.error(`     ${s}`);
    Deno.exit(1);
  }
  return out;
}

/** A filter that matched nothing is UNTESTED, never zero. Dies rather than returning an empty set. */
export function assertNonEmpty<T>(label: string, xs: T[], min = 1): T[] {
  if (xs.length < min) {
    console.error(`!! ${label}: got ${xs.length}, need >= ${min}. A filter that matched nothing yields UNTESTED, not a null result.`);
    Deno.exit(1);
  }
  return xs;
}

/** A file must have been written by THIS run. Catches reading a previous run's artifact as if it were this one's. */
export async function assertFresh(path: string, startedAtMs: number): Promise<void> {
  let st: Deno.FileInfo;
  try { st = await Deno.stat(path); }
  catch { console.error(`!! ${path} was never written by this run — refusing to read it.`); Deno.exit(1); }
  const m = st.mtime?.getTime() ?? 0;
  if (m < startedAtMs) {
    console.error(`!! ${path} is STALE: last written ${new Date(m).toISOString()}, this run began ${new Date(startedAtMs).toISOString()}.`);
    console.error(`   Reading it would report a previous run's numbers as this one's.`);
    Deno.exit(1);
  }
}

/** Report how many rows a mutation actually touched; dies if it touched more than expected. */
export function assertTouched(label: string, touched: number, expected: number): void {
  if (touched !== expected) {
    console.error(`!! ${label}: touched ${touched} row(s), expected ${expected}. A blanket write that hits an`);
    console.error(`   unintended row is how a pre-registered forward record got contaminated (D-586).`);
    Deno.exit(1);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// STRICT READS (D-757) — the ninth precondition, and the one the other eight could not see.
//
// EVIDENCE. D-756: a swallowed read shrank a 15,502-symbol universe to 8,600 with no error and no exception, during a
// PostgREST OOM restart. The script ran to completion and printed a coherent, wrong answer. The near-universal helper
//     const q = (p) => fetch(`${OWNED}/${p}`, {headers}).then(r => r.ok ? r.json() : []).catch(() => [])
// converts EVERY transport failure — connection refused, 500, 502, 429, a mid-restart truncated body — into an empty
// array that is arithmetically indistinguishable from "the market has nothing here". On a day the database restarts
// twice, that manufactures false NULLS across an entire session's research.
//
// WHY assertNonEmpty IS NOT ENOUGH, stated precisely because it is the obvious objection: assertNonEmpty catches the
// ALL-EMPTY case, where every read failed. It cannot catch a PARTIAL universe — batch 7 of 40 returning [] leaves a
// non-empty, plausible, wrong panel. The all-empty case is the loud one and was never the dangerous one.
//
// The rules this encodes:
//   (1) a READ FAILURE IS AN EXCEPTION, never a value. No path returns [] for a failure, ever.
//   (2) transient failures (network error, 5xx, 429) are RETRIED — an OOM restart is recoverable and should not
//       abort an hour of work — but a failure that survives the retries THROWS with the path and the status.
//   (3) a PAGED read asserts its own completeness against the server's own Content-Range total, so a partial page
//       walk cannot pass silently. This is the POSITIVE-CONTROL RULE applied to plumbing: the server is asked how
//       many rows exist and the answer is checked, rather than trusting that the loop terminated for a good reason.
//   (4) a paged read without `order=` is refused (plumbing RULE 1): un-ordered pagination returns an arbitrary and
//       possibly overlapping sample of physical row order.
//   (5) assertCoverage states the shortfall in the units the caller cares about (symbols, dates, events), because
//       "got 8,600" is only alarming next to "requested 15,502".

export interface StrictReadOpts {
  retries?: number;          // attempts BEYOND the first (default 3 total attempts)
  backoffMs?: number;        // base backoff, doubled per attempt (default 250)
  fetchImpl?: typeof fetch;  // injectable for tests
  sleep?: (ms: number) => Promise<void>;
}
export interface StrictRead {
  /** One read. Returns parsed JSON. THROWS on any non-OK after retries — never returns [] for a failure. */
  q: (path: string, opts?: RequestInit) => Promise<any>;
  /** Paged read. Requires `order=`; asserts the walked row count equals the server's Content-Range total. */
  qAll: (pathWithOrder: string, pageSize?: number) => Promise<any[]>;
}

const TRANSIENT = (s: number) => s >= 500 || s === 429 || s === 408;

export function mkStrictRead(owned: string, hdr: Record<string, string>, o: StrictReadOpts = {}): StrictRead {
  const attempts = (o.retries ?? 2) + 1;
  const base = o.backoffMs ?? 250;
  const F = o.fetchImpl ?? fetch;
  const nap = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function raw(path: string, opts: RequestInit = {}): Promise<Response> {
    const url = path.startsWith("http") ? path : `${owned}/${path.replace(/^\//, "")}`;
    let last = "";
    for (let a = 1; a <= attempts; a++) {
      let res: Response;
      try {
        res = await F(url, { ...opts, headers: { ...hdr, ...(opts.headers as Record<string, string> ?? {}) } });
      } catch (e) {
        last = `network error: ${e instanceof Error ? e.message : String(e)}`;
        if (a < attempts) { await nap(base * 2 ** (a - 1)); continue; }
        throw new Error(`STRICT READ FAILED after ${a} attempt(s): ${url}\n   ${last}`);
      }
      if (res.ok) return res;
      last = `HTTP ${res.status} ${res.statusText}: ${(await res.text().catch(() => "")).slice(0, 200)}`; // plumbing-ok: error-body read, failure already established
      if (TRANSIENT(res.status) && a < attempts) { await nap(base * 2 ** (a - 1)); continue; }
      throw new Error(`STRICT READ FAILED after ${a} attempt(s): ${url}\n   ${last}`);
    }
    throw new Error(`STRICT READ FAILED: ${url}\n   ${last}`);
  }

  const q = async (path: string, opts?: RequestInit) => await (await raw(path, opts)).json();

  const qAll = async (pathWithOrder: string, pageSize = 1000): Promise<any[]> => {
    if (!/[?&]order=/.test(pathWithOrder)) {
      throw new Error(`qAll refuses an unordered paged read (plumbing RULE 1): ${pathWithOrder}\n   Without order=, page boundaries follow physical row order and the walk may skip and duplicate rows.`);
    }
    const rows: any[] = [];
    let total = -1;
    for (let from = 0; ; from += pageSize) {
      const res = await raw(pathWithOrder, {
        headers: { Range: `${from}-${from + pageSize - 1}`, "Range-Unit": "items", Prefer: "count=exact" },
      });
      const cr = res.headers.get("content-range") ?? "";
      const m = cr.match(/\/(\d+|\*)\s*$/);
      if (m && m[1] !== "*") total = Number(m[1]);
      const page = await res.json();
      if (!Array.isArray(page)) throw new Error(`qAll expected an array page, got ${typeof page}: ${pathWithOrder}`);
      rows.push(...page);
      if (page.length < pageSize) break;
      if (total >= 0 && rows.length >= total) break;
    }
    if (total < 0) {
      throw new Error(`qAll got no Content-Range total from the server for ${pathWithOrder} — completeness is unverifiable, which is the failure this helper exists to prevent.`);
    }
    if (rows.length !== total) {
      throw new Error(`qAll INCOMPLETE: walked ${rows.length} row(s) but the server reports ${total} for ${pathWithOrder}. A partial page walk is a partial universe, not a null result.`);
    }
    return rows;
  };

  return { q, qAll };
}

/**
 * A partial universe is not a null result. Throws with the shortfall stated in the caller's own units.
 * D-756: 8,600 of 15,502 symbols (55.5%) read as "the market" for an entire analysis.
 */
export function assertCoverage(label: string, got: number, requested: number, minFrac = 0.98): void {
  const frac = requested > 0 ? got / requested : 0;
  if (frac < minFrac) {
    throw new Error(
      `!! ${label}: COVERAGE SHORTFALL — got ${got} of ${requested} (${(100 * frac).toFixed(1)}%, floor ${(100 * minFrac).toFixed(1)}%); ` +
      `${requested - got} missing. A partial read is evidence about our PLUMBING, not about the market (COVERAGE LAW).`,
    );
  }
}
