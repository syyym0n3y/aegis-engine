// Minimal, dependency-free test asserts so `deno test` runs fully offline
// (no jsr/std fetch). Keep this the ONLY test utility — the falsification
// engine's own correctness must never depend on a network call.

export function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) {
    throw new Error(msg ?? `expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
  }
}

export function assertAlmost(actual: number, expected: number, tol = 1e-6, msg?: string): void {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tol) {
    throw new Error(msg ?? `expected ~${expected} (±${tol}) got ${actual}`);
  }
}

export function assertThrows(fn: () => unknown, msg = "expected throw"): void {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(msg);
}

export function assertInRange(actual: number, lo: number, hi: number, msg?: string): void {
  if (!(actual >= lo && actual <= hi)) {
    throw new Error(msg ?? `expected ${actual} in [${lo}, ${hi}]`);
  }
}
