// VERIFY API (LAYER 1) — falsification-as-a-service. POST a return series -> real vs overfit.
import { verifyTrackRecord } from "../_shared/trd-verify.ts";
const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors, "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST" } });
  if (req.method !== "POST") return new Response(JSON.stringify({ layer: "VERIFY", usage: "POST { returns:number[], periodsPerYear:number, claimedTrials?:number, benchmarkAnnualSharpe?:number }" }, null, 2), { headers: cors });
  try { const b = await req.json(); if (!Array.isArray(b.returns) || !b.periodsPerYear) throw new Error("need returns[] and periodsPerYear"); return new Response(JSON.stringify(verifyTrackRecord(b), null, 2), { headers: cors }); }
  catch (e) { return new Response(JSON.stringify({ error: String(e).slice(0, 160) }), { status: 400, headers: cors }); }
});
