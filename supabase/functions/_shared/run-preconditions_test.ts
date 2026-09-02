// run-preconditions_test.ts (D-757) — tests for the STRICT READ helper.
//
// These test the FAILURE paths, because the failure path is the whole point: the defect being killed (D-756) is a read
// that fails and returns [] anyway. A test that only proves the happy path proves nothing about this helper.
import { assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { assertCoverage, mkStrictRead } from "./run-preconditions.ts";

const H = { Authorization: "Bearer x" };
const NOSLEEP = (_ms: number) => Promise.resolve();
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

Deno.test("q: retries a transient 503 and then SUCCEEDS", async () => {
  let calls = 0;
  const { q } = mkStrictRead("http://o", H, {
    sleep: NOSLEEP,
    fetchImpl: ((_u: string) => { calls++; return Promise.resolve(calls < 3 ? json({ e: "oom" }, 503) : json([{ a: 1 }])); }) as unknown as typeof fetch,
  });
  assertEquals(await q("trd_x?select=a"), [{ a: 1 }]);
  assertEquals(calls, 3); // two failures then the win — the OOM-restart case, recovered rather than swallowed
});

Deno.test("q: retries a NETWORK error and then succeeds", async () => {
  let calls = 0;
  const { q } = mkStrictRead("http://o", H, {
    sleep: NOSLEEP,
    fetchImpl: ((_u: string) => { calls++; return calls < 2 ? Promise.reject(new TypeError("connection refused")) : Promise.resolve(json([1, 2])); }) as unknown as typeof fetch,
  });
  assertEquals(await q("trd_x?select=a"), [1, 2]);
  assertEquals(calls, 2);
});

Deno.test("q: THROWS after exhausting retries — never returns []", async () => {
  let calls = 0;
  const { q } = mkStrictRead("http://o", H, {
    sleep: NOSLEEP,
    fetchImpl: ((_u: string) => { calls++; return Promise.resolve(json({ e: "down" }, 502)); }) as unknown as typeof fetch,
  });
  const err = await assertRejects(() => q("trd_bars_deep?select=bars"), Error);
  assertEquals(calls, 3);
  // the message must carry the PATH and the STATUS, or the operator cannot tell which read died
  if (!/trd_bars_deep/.test(err.message) || !/502/.test(err.message)) throw new Error(`unhelpful message: ${err.message}`);
});

Deno.test("q: a 400 is NOT retried (it is a bad request, not a hiccup) and throws immediately", async () => {
  let calls = 0;
  const { q } = mkStrictRead("http://o", H, {
    sleep: NOSLEEP,
    fetchImpl: ((_u: string) => { calls++; return Promise.resolve(json({ e: "bad column" }, 400)); }) as unknown as typeof fetch,
  });
  await assertRejects(() => q("trd_x?select=nope"), Error);
  assertEquals(calls, 1);
});

Deno.test("qAll: refuses an UNORDERED paged read (plumbing RULE 1)", async () => {
  const { qAll } = mkStrictRead("http://o", H, { sleep: NOSLEEP, fetchImpl: (() => { throw new Error("must not fetch"); }) as unknown as typeof fetch });
  await assertRejects(() => qAll("trd_x?select=a"), Error, "unordered");
});

Deno.test("qAll: walks every page and matches the server's Content-Range total", async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ i }));
  const { qAll } = mkStrictRead("http://o", H, {
    sleep: NOSLEEP,
    fetchImpl: ((_u: string, o: RequestInit) => {
      const [a, b] = String((o.headers as Record<string, string>).Range).split("-").map(Number);
      const page = rows.slice(a, b + 1);
      return Promise.resolve(json(page, 200, { "content-range": `${a}-${b}/${rows.length}` }));
    }) as unknown as typeof fetch,
  });
  assertEquals((await qAll("trd_x?select=i&order=i.asc")).length, 2500);
});

Deno.test("qAll: a PARTIAL page walk THROWS rather than returning a short universe", async () => {
  // The D-756 shape: the server says 15,502 rows exist, the walk yields 1,000 and stops. Silently, this became a
  // 'null result about the market'. Here it must be an exception naming both numbers.
  const { qAll } = mkStrictRead("http://o", H, {
    sleep: NOSLEEP,
    fetchImpl: (() => Promise.resolve(json(Array.from({ length: 500 }, (_, i) => i), 200, { "content-range": "0-499/15502" }))) as unknown as typeof fetch,
  });
  const err = await assertRejects(() => qAll("trd_universe?select=symbol&order=symbol.asc", 1000), Error);
  if (!/500/.test(err.message) || !/15502/.test(err.message)) throw new Error(`unhelpful message: ${err.message}`);
});

Deno.test("qAll: NO Content-Range total is itself a failure (completeness unverifiable)", async () => {
  const { qAll } = mkStrictRead("http://o", H, {
    sleep: NOSLEEP,
    fetchImpl: (() => Promise.resolve(json([1, 2, 3]))) as unknown as typeof fetch,
  });
  await assertRejects(() => qAll("trd_x?select=a&order=a.asc"), Error, "Content-Range");
});

Deno.test("assertCoverage: throws on the shortfall, passes at the floor", () => {
  assertThrows(() => assertCoverage("universe", 8600, 15502), Error, "COVERAGE SHORTFALL");
  assertCoverage("universe", 15490, 15502);      // 99.9% — fine
  assertThrows(() => assertCoverage("universe", 15100, 15502), Error); // 97.4% — below the 98% floor
});
