#!/usr/bin/env -S deno run --allow-net --allow-env
// mechanism-guard.ts (D-597) — THE MACHINE GUARD for THE MECHANISM LAW.
//
// ORIGIN, and it is mine. On 2026-08-25 I proposed seven mechanism stories for one set of measurements —
// arbitrage-thinness, dispersion, leverage crowding, listing age, a liquidity band, a stop-width rescue, and a
// refutation of the beta explanation. All seven died. Six died to controls I ran myself, which is the system working.
// The seventh, D-590, did not: it was a false WIN, reported to the operator as "the beta hypothesis is refuted",
// resting on a POOLED short-vs-long comparison in which a single stop geometry carried 64.3% of the trades. One
// decomposition reversed it. Nothing caught it; I found it by chance while reading my own output.
//
// The other thirteen guards could not have caught it, because every one of them inspects a CONCLUSION already
// written to the ledger. This failure happened one step earlier — in the move from a number to a story about the
// number. That step had no gate at all.
//
// THE RULE ENFORCED: a research row may not assert a MECHANISM unless it either (a) names a pre-registration in
// trd_prereg whose kill condition was written before the data existed, or (b) explicitly marks itself DESCRIPTIVE
// ONLY — a measurement with no causal claim attached. Descriptive is always allowed. What is forbidden is the
// unregistered story, because that is the one that costs a session and reopens the rabbit hole.
//
// SECOND CHECK, aimed squarely at D-590: any row that reports a POOLED statistic must also state its
// disaggregation. A pooled number whose dominant stratum is unnamed is exactly the shape that produced the false win.
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mg", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

async function mustFetch(url: string, what: string): Promise<any[]> {
  // D-584: a guard that cannot read its input has verified nothing and must never certify.
  let r: Response;
  try { r = await fetch(url, { headers: hdr }); }
  catch (e) { console.error(`!! cannot reach ${what}: ${e instanceof Error ? e.message : e} — RED.`); Deno.exit(1); }
  if (!r.ok) { console.error(`!! ${what} returned HTTP ${r.status} — RED.`); Deno.exit(1); }
  const j = await r.json().catch(() => null);
  if (!Array.isArray(j)) { console.error(`!! ${what} did not return rows — RED.`); Deno.exit(1); }
  return j;
}

const SELFTEST = (Deno.env.get("SELFTEST") || Deno.env.get("GUARD_SELFTEST")) === "1";
// The law binds rows written from its adoption forward. Retrofitting 119 historical rows would produce an
// unclearable red, and an unclearable red gets ignored — the failure mode that let the agent-output defects run for
// nine cycles (and that this guard's own first sibling shipped with).
const EFFECTIVE_FROM = Deno.env.get("MECHANISM_LAW_FROM") || "2026-08-25T21:00:00Z";
const RESEARCH = new Set(["ml", "book", "vol", "crypto-derivatives", "equity-volatility", "attribution", "intl", "szbivar", "risk-management"]);

// Causal/interpretive language: the move from "we measured X" to "X is because Y".
const MECHANISM = /(because|therefore|driven by|explained by|the mechanism|mechanism is|is not beta|is beta|attributable to|the reason is|this shows that|which means the|caused by|stems from|reflects the)/i;
const HAS_PREREG = /PREREG:\s*([A-Za-z0-9._-]+)/;
const DESCRIPTIVE = /DESCRIPTIVE ONLY/i;
const POOLED = /\bpooled\b/i;
const DISAGG = /(disaggregat|by geometry|by stratum|by symbol|by era|excluding|ex-|dominant stratum|decompos)/i;

const rows = await mustFetch(`${OWNED}/trd_lineage?select=id,name,family,status,key_metric,verdict,updated_at`, "trd_lineage") as
  { id: string; name: string; family: string; status: string; key_metric: string | null; verdict: string | null; updated_at: string | null }[];
const pregs = await mustFetch(`${OWNED}/trd_prereg?select=id,outcome`, "trd_prereg") as { id: string; outcome: string | null }[];
const pregIds = new Set(pregs.map((p) => p.id));

// Fixtures prove BOTH branches reachable: an unregistered mechanism claim must fail, a registered one and a
// descriptive one must pass, and a pooled claim without disaggregation must fail. Verified by breaking the input,
// not by reading the output.
const subjects = [...rows, ...(SELFTEST
  ? [
    { id: "SELFTEST-STORY", name: "unregistered mechanism", family: "ml", status: "monitoring", updated_at: "2099-01-01T00:00:00Z",
      key_metric: "shorts 0.0967 vs longs 0.0418", verdict: "both sides pay, therefore this is not beta" },
    { id: "SELFTEST-REGD", name: "registered mechanism", family: "ml", status: "monitoring", updated_at: "2099-01-01T00:00:00Z",
      key_metric: "excess +0.10R both sides", verdict: "a timing component survives, therefore not drift. PREREG: D-591-vs-buyhold" },
    { id: "SELFTEST-DESC", name: "pure measurement", family: "ml", status: "monitoring", updated_at: "2099-01-01T00:00:00Z",
      key_metric: "mean trial Sharpe -0.036", verdict: "DESCRIPTIVE ONLY — no mechanism claimed" },
    { id: "SELFTEST-POOL", name: "pooled with no disaggregation", family: "ml", status: "monitoring", updated_at: "2099-01-01T00:00:00Z",
      key_metric: "pooled short/long 1.21x", verdict: "DESCRIPTIVE ONLY — reports a pooled ratio and never breaks it out" },
  ]
  : [])];

let red = 0, checked = 0, skippedOld = 0;
console.log("==> MECHANISM GUARD — is every causal claim either PRE-REGISTERED or marked DESCRIPTIVE ONLY?");
for (const r of subjects) {
  if (!RESEARCH.has((r.family || "").toLowerCase())) continue;
  if ((r.updated_at || "") < EFFECTIVE_FROM) { skippedOld++; continue; }
  const hay = `${r.key_metric || ""} ${r.verdict || ""}`;
  checked++;

  if (MECHANISM.test(hay) && !DESCRIPTIVE.test(hay)) {
    const m = hay.match(HAS_PREREG);
    if (!m) {
      red++;
      console.log(`  RED  ${r.id.padEnd(28)} asserts a MECHANISM with no PREREG: and no DESCRIPTIVE ONLY marker`);
      continue;
    }
    if (!pregIds.has(m[1])) {
      red++;
      console.log(`  RED  ${r.id.padEnd(28)} cites PREREG: ${m[1]} — which does not exist in trd_prereg`);
      continue;
    }
  }
  if (POOLED.test(hay) && !DISAGG.test(hay)) {
    red++;
    console.log(`  RED  ${r.id.padEnd(28)} reports a POOLED statistic and never states its disaggregation (the D-590 shape)`);
    continue;
  }
  console.log(`  PASS ${r.id.padEnd(28)} ${DESCRIPTIVE.test(hay) ? "descriptive only" : MECHANISM.test(hay) ? "mechanism, pre-registered" : "no causal claim"}`);
}

console.log(`\n  ${checked} row(s) in scope since ${EFFECTIVE_FROM} (${skippedOld} predate the law and are exempt).`);
// Report open pre-registrations: a rule with no recorded outcome is a test that was started and never resolved,
// which is its own way of leaving the rabbit hole open.
const open = pregs.filter((p) => !p.outcome && p.id !== "SELFTEST-IMMUT");
if (open.length) console.log(`  NOTE: ${open.length} pre-registration(s) with no recorded outcome: ${open.map((p) => p.id).join(", ")}`);
console.log(`  ${red === 0 ? "NO UNREGISTERED MECHANISM CLAIMS." : `${red} ROW(S) RED — an unregistered story is how a false win survives to be reported.`}`);
if (red > 0) Deno.exit(1);
