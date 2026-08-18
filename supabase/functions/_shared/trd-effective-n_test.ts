import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dayIndex, effectiveRankIC, type ICObs } from "./trd-effective-n.ts";

// A pool whose x and y agree well enough to give a solidly non-zero IC, built so the SAME (x,y) multiset can be
// re-tagged with different members/days by the controls below. The point of every control here is that ONLY the
// tagging changes — the correlation itself is held byte-identical — so any change in t is attributable to the
// independence accounting and to nothing else.
const XY: [number, number][] = Array.from({ length: 24 }, (_, i) => [i, i % 5 === 0 ? -i : i] as [number, number]);

const tag = (members: string[], days: number[]): ICObs[] =>
  XY.map(([x, y], i) => ({ member: members[i % members.length], day: days[i], x, y }));

const spread = XY.map((_, i) => i * 40);         // 40 days apart — never inside a 21d block
const sameWeek = XY.map(() => 100);              // all on one day

Deno.test("effectiveRankIC: the IC itself is untouched by the tagging — only the independence count moves", () => {
  const a = effectiveRankIC(tag(["A"], sameWeek), 21);
  const b = effectiveRankIC(tag(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"], spread), 21);
  assertEquals(a.ic, b.ic);                       // same observations → same correlation
  assertEquals(a.n, b.n);
  assertEquals(a.tNaive, b.tNaive);               // the naive t cannot tell these two pools apart — that is the bug
  assert(a.effN < b.effN, `${a.effN} !< ${b.effN}`);
});

Deno.test("THE D-336 CONTROL: one member, one block → effN=1, fails closed at t=0 while naive t is large", () => {
  // 24 Form-4 filings, all BAC, all in the same 21-day window. A naive t counts them as 24 independent bets.
  const r = effectiveRankIC(tag(["BAC"], sameWeek), 21);
  assertEquals(r.effN, 1);
  assertEquals(r.nMembers, 1);
  assertEquals(r.maxMemberShare, 1);
  assertEquals(r.tEff, 0, "must claim NO significance from one repeated bet");
  assert(Math.abs(r.tNaive) > 3, `naive t should be inflated, got ${r.tNaive}`);
  assert(r.underpowered);
  assert(r.verdict.includes("UNDERPOWERED"));
});

Deno.test("THE OVERLAP CONTROL: same members, same 24 daily observations — only the horizon changes", () => {
  const daily = XY.map((_, i) => 1000 + i);       // consecutive calendar days
  const members = ["A", "B", "C"];                // 3 members × 24 days
  const h1 = effectiveRankIC(tag(members, daily), 1);
  const h21 = effectiveRankIC(tag(members, daily), 21);
  assertEquals(h1.ic, h21.ic);                    // identical data
  assertEquals(h1.effN, 24, "1d windows do not overlap → every observation is its own cluster");
  assert(h21.effN < h1.effN, `${h21.effN} !< ${h1.effN}`);
  assert(Math.abs(h21.tEff) < Math.abs(h1.tEff), "a longer overlapping window must LOWER significance, never raise it");
  assert(h21.vif > h1.vif);
});

Deno.test("no inflation to correct: distinct members, non-overlapping days → effN = n and tEff = tNaive", () => {
  const members = Array.from({ length: 24 }, (_, i) => `M${i}`);
  const r = effectiveRankIC(tag(members, spread), 21);
  assertEquals(r.effN, r.n);
  assertEquals(r.vif, 1);
  assertAlmostEquals(r.tEff, r.tNaive, 0.01);     // the gate must be a no-op when the pool is genuinely independent
});

Deno.test("effN is bounded by n and by members × blocks", () => {
  const r = effectiveRankIC(tag(["A", "B"], XY.map((_, i) => 1000 + i * 30)), 21);
  assert(r.effN <= r.n);
  assert(r.effN <= r.nMembers * r.nBlocks);
});

Deno.test("maxMemberShare surfaces a pool dominated by ONE member (the 15/24 BAC shape)", () => {
  const obs: ICObs[] = XY.map(([x, y], i) => ({ member: i < 15 ? "BAC" : `M${i}`, day: 1000 + i * 40, x, y }));
  const r = effectiveRankIC(obs, 21);
  assertAlmostEquals(r.maxMemberShare, 15 / 24, 0.001);
  assertEquals(r.nMembers, 10);
});

Deno.test("order-invariant: shuffling the pool changes nothing", () => {
  const obs = tag(["A", "B", "C"], XY.map((_, i) => 1000 + i * 7));
  const shuffled = obs.map((o, i) => obs[(i * 7 + 3) % obs.length]);
  const a = effectiveRankIC(obs, 5), b = effectiveRankIC(shuffled, 5);
  assertEquals(a.ic, b.ic); assertEquals(a.effN, b.effN); assertEquals(a.tEff, b.tEff);
});

Deno.test("ties in x are averaged, not resolved by array position", () => {
  // Every x identical → no cross-sectional variation → IC is 0 by construction, not an artifact of fetch order.
  const obs: ICObs[] = Array.from({ length: 20 }, (_, i) => ({ member: `M${i}`, day: 1000 + i * 40, x: 5, y: i }));
  const r = effectiveRankIC(obs, 21);
  assertEquals(r.ic, 0);
  assertEquals(r.tEff, 0);
});

Deno.test("a perfect fit returns a large FINITE t, not 0 (understating is the wrong failure direction)", () => {
  const obs: ICObs[] = Array.from({ length: 20 }, (_, i) => ({ member: `M${i}`, day: 1000 + i * 40, x: i, y: i }));
  const r = effectiveRankIC(obs, 21);
  assertEquals(r.ic, 1);
  assert(Number.isFinite(r.tEff) && r.tEff > 100, `expected a large finite t, got ${r.tEff}`);
});

Deno.test("fails closed on an empty pool and on a pool below the independence floor", () => {
  const e = effectiveRankIC([], 21);
  assertEquals(e.n, 0); assertEquals(e.tEff, 0); assert(e.underpowered);
  const nine = effectiveRankIC(
    Array.from({ length: 9 }, (_, i) => ({ member: `M${i}`, day: 1000 + i * 40, x: i, y: i * 2 })),
    21,
  );
  assertEquals(nine.effN, 9);
  assertEquals(nine.tEff, 0, "9 independent clusters is below the default floor of 10");
});

Deno.test("a non-finite day gets its own block rather than silently bucketing into day 0", () => {
  const obs: ICObs[] = [
    { member: "A", day: NaN, x: 1, y: 1 },
    { member: "A", day: 0, x: 2, y: 2 },
    { member: "A", day: 1, x: 3, y: 3 },
  ];
  const r = effectiveRankIC(obs, 21);
  assertEquals(r.effN, 2, "the two real day-0-block rows collapse; the NaN row stays separate");
});

Deno.test("dayIndex: bare dates and ISO timestamps land on the same day; garbage is NaN", () => {
  assertEquals(dayIndex("1970-01-01"), 0);
  assertEquals(dayIndex("1970-01-02"), 1);
  assertEquals(dayIndex("2026-08-17"), dayIndex("2026-08-17T23:59:00Z"));
  assertEquals(dayIndex("2026-08-18") - dayIndex("2026-08-17"), 1);
  assert(Number.isNaN(dayIndex("not-a-date")));
});
