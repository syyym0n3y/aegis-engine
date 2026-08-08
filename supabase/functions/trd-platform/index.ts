// AEGIS PLATFORM API — one call: any broker export (or returns[]) -> normalized account
// -> unified Verify/Protect/Allocate verdict + composite grade -> persisted (append-only).
// Broker-agnostic by design: operates on the universal trade/return primitive, never on
// broker order APIs. Deployed on command-centre; deploy bundles copies of ../_shared.
import { fromReturns, ingest } from "../_shared/trd-normalize.ts";
import { analyzeAccount } from "../_shared/trd-platform.ts";
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors, "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST" } });
  if (req.method !== "POST") return new Response(JSON.stringify({ platform: "Aegis", usage: "POST { raw?:string, returns?:number[], format?:'auto'|'generic'|'mt', startEquity?, periodsPerYear?, claimedTrials?, costPerTradeBps?, accountRef? }" }, null, 2), { headers: cors });
  try {
    const b = await req.json();
    const acct = Array.isArray(b.returns) ? fromReturns(b.returns, b.periodsPerYear ?? 252) : (typeof b.raw === "string" ? ingest(b.raw, { startEquity: b.startEquity, format: b.format }) : null);
    if (!acct) throw new Error("provide raw (a broker CSV export) or returns[]");
    if (acct.trades.length < 5) throw new Error("need at least 5 trades to analyze");
    const rep = analyzeAccount(acct, { claimedTrials: b.claimedTrials, costPerTradeBps: b.costPerTradeBps });
    try { await fetch(`${SB}/rest/v1/trd_platform_reports`, { method: "POST", headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ account_ref: b.accountRef ?? null, source: rep.account.source, start_equity: rep.account.startEquity, n_trades: rep.account.trades, span_days: rep.account.spanDays, win_rate: rep.account.winRate, win_loss_ratio: Number.isFinite(rep.account.winLossRatio) ? rep.account.winLossRatio : null, grade: rep.grade, headline: rep.headline, report: rep }) }); } catch (_) { /* best-effort */ }
    return new Response(JSON.stringify(rep, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ error: String(e).slice(0, 200) }), { status: 400, headers: cors }); }
});
