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
    for (const d of declared) {
      const N = name.toUpperCase(), D = d.toUpperCase();
      // Two shapes, both seen in real defects. EDIT DISTANCE catches a mistyped name (SELFTST). CONTAINMENT catches
      // the prefix/suffix variant, which is what actually happened: GUARD_SELFTEST was set while the script read
      // SELFTEST — edit distance 6, so a distance test alone would have missed the very bug this exists to prevent.
      const near = lev(N, D) > 0 && lev(N, D) <= 3;
      const contains = N !== D && (N.includes(D) || D.includes(N)) && Math.min(N.length, D.length) >= 4;
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
