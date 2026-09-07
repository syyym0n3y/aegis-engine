#!/usr/bin/env -S deno run --allow-net --allow-env
// spend-trials.ts (D-814) — record trials for a run that lives outside Deno (the Python model classes). Same ledger, same
// idempotent run key: `FAMILY=<f> RUN_ID=<id> SPENT=<n> deno run ... spend-trials.ts` prints the ceiling the result must clear.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("spend-trials", [{ name: "FAMILY", def: "" }, { name: "RUN_ID", def: "" }, { name: "SPENT", def: "0" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "spt", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const t = await jwt(); const T = await spendTrials({ rest: OWNED, headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }, family: K.FAMILY, runId: K.RUN_ID, spent: Number(K.SPENT) });
console.log(`  trials: ${K.FAMILY}/${K.RUN_ID} spent ${T.spent} -> N=${T.N.toLocaleString()} ceiling ${T.ceiling.toFixed(4)}`);
