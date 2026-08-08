// PROTECT API (LAYER 2) — risk X-ray. POST the trader's own numbers, get ruin/sizing.
// Deployed on command-centre (glzz). NOTE: the platform deploy bundles a copy of
// ../_shared/trd-protect.ts (MCP deploy is self-contained); this is the canonical source.
import { riskXray } from "../_shared/trd-protect.ts";
const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors, "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST" } });
  if (req.method !== "POST") return new Response(JSON.stringify({ layer: "PROTECT", usage: "POST { equity, riskPerTradeFrac, winRate, winLossRatio, leverage?, costPerTradeBps?, tradesPerYear? }" }, null, 2), { headers: cors });
  try { const b = await req.json(); if (b.winRate == null || b.winLossRatio == null || b.riskPerTradeFrac == null) throw new Error("need winRate, winLossRatio, riskPerTradeFrac"); return new Response(JSON.stringify(riskXray(b), null, 2), { headers: cors }); }
  catch (e) { return new Response(JSON.stringify({ error: String(e).slice(0, 160) }), { status: 400, headers: cors }); }
});
