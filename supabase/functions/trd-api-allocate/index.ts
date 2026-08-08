// ALLOCATE API (LAYER 3) — global multi-factor book. GET ?preset=global builds the live
// book from stored Fama-French premia (trd_scratch_ff); POST { streams } for a custom one.
import { buildFactorBook } from "../_shared/trd-allocate.ts";
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PICKS: Record<string, [string, string]> = { "value-US": ["us5", "HML"], "value-Dev": ["dev5", "HML"], "value-EM": ["em5", "HML"], "quality-US": ["us5", "RMW"], "quality-Dev": ["dev5", "RMW"], "momentum-Dev": ["devmom", "WML"] };
const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
async function livePreset() {
  const hdr = { apikey: SRK, Authorization: `Bearer ${SRK}` };
  const byName: Record<string, Map<string, number>> = {};
  for (const [name, [f, fac]] of Object.entries(PICKS)) { const r = await fetch(`${SB}/rest/v1/trd_scratch_ff?file=eq.${f}&factor=eq.${encodeURIComponent(fac)}&select=ym,val`, { headers: hdr }); const rows = await r.json() as Array<{ ym: string; val: number }>; byName[name] = new Map(rows.map((x) => [x.ym, x.val / 100])); }
  const names = Object.keys(byName); let common: string[] | null = null;
  for (const n of names) { const ks = new Set(byName[n].keys()); common = common ? common.filter((m) => ks.has(m)) : [...ks]; }
  common = (common ?? []).sort(); const streams: Record<string, number[]> = {}; for (const n of names) streams[n] = common.map((m) => byName[n].get(m)!);
  return { streams, from: common[0], to: common[common.length - 1] };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors, "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST,GET" } });
  try {
    const url = new URL(req.url);
    if (req.method === "GET" && url.searchParams.get("preset") === "global") { const { streams, from, to } = await livePreset(); const rep = buildFactorBook({ streams, periodsPerYear: 12, targetAnnualVol: 0.10, volLookback: 24 }); return new Response(JSON.stringify({ preset: "global", window: `${from}..${to}`, ...rep, portfolio: undefined }, null, 2), { headers: cors }); }
    if (req.method === "POST") { const b = await req.json(); if (!b.streams) throw new Error("need streams{}"); const rep = buildFactorBook({ periodsPerYear: b.periodsPerYear ?? 12, targetAnnualVol: b.targetAnnualVol ?? 0.10, streams: b.streams }); return new Response(JSON.stringify({ ...rep, portfolio: undefined }, null, 2), { headers: cors }); }
    return new Response(JSON.stringify({ layer: "ALLOCATE", usage: ["GET ?preset=global", "POST { streams:{name:number[]}, periodsPerYear?, targetAnnualVol? }"] }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ error: String(e).slice(0, 160) }), { status: 400, headers: cors }); }
});
