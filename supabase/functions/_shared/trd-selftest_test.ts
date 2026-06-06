import { runSelfTest } from "./trd-selftest.ts";
import { assert } from "./trd-test-helpers.ts";

Deno.test("runSelfTest: the engine proves it still kills bad strategies", () => {
  const r = runSelfTest();
  for (const c of r.checks) assert(c.passed, `self-check failed: ${c.name} — ${c.detail}`);
  assert(r.passed, "overall self-test must pass");
  assert(r.checks.length >= 4, "expected at least 4 self-checks");
});
