// trd-prop-optimizer — "Pass Your Prop Challenge" honest calculator. The millions who buy prop evals mostly
// fail because (1) no real edge or (2) wrong sizing. This takes a trader's REAL stats + their firm's exact
// rules and returns their true P(pass), the risk-per-trade that maximizes it, and the net EV of buying the
// eval — including telling them honestly "you have no edge, don't spend the $300". Monte-Carlo, two-hurdle
// (eval + funded payout). Public, CORS-open, no writes, no orders. POST JSON:
//   { accountSize, targetPct, maxDDpct, dailyLossPct, maxDays, tradesPerDay, winRate, winR, lossR,
//     evalCost, payout, split }
Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST, OPTIONS" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json();
    const account = +b.accountSize || 50000, target = +b.targetPct || 0.08, maxDD = +b.maxDDpct || 0.10, daily = +b.dailyLossPct || 0.05;
    const maxDays = Math.min(120, +b.maxDays || 40), tpd = Math.min(50, +b.tradesPerDay || 6);
    const p = Math.min(0.95, Math.max(0.05, +b.winRate || 0.47)), winR = +b.winR || 2, lossR = +b.lossR || 1;
    const evalCost = +b.evalCost || 300, payout = +b.payout || account * target, split = Math.min(1, +b.split || 0.8);
    const expectancyR = p * winR - (1 - p) * lossR;

    let seed = 20260804 >>> 0; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    function one(rf: number): "pass" | "fail" {
      let eq = account; const floor = account * (1 - maxDD);
      for (let d = 0; d < maxDays; d++) { let ds = eq; for (let t = 0; t < tpd; t++) { const risk = rf * account; eq += rnd() < p ? winR * risk : -lossR * risk; if (eq <= floor || eq <= ds - daily * account) return "fail"; if (eq >= account * (1 + target)) return "pass"; } }
      return "fail";
    }
    const N = 4000;
    const grid = [0.0025, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.03, 0.05];
    const rows = grid.map((rf) => {
      let pass = 0, paid = 0;
      for (let i = 0; i < N; i++) { if (one(rf) === "pass") { pass++; if (one(rf) === "pass") paid++; } }
      const pPass = pass / N, pPaid = paid / N, ev = pPaid * split * payout - evalCost;
      return { riskPct: +(rf * 100).toFixed(2), pPass: +(pPass * 100).toFixed(1), pPaid: +(pPaid * 100).toFixed(1), evPerEval: Math.round(ev) };
    });
    const best = rows.reduce((a, c) => c.evPerEval > a.evPerEval ? c : a, rows[0]);
    const edgeReal = expectancyR > 0 && best.evPerEval > 0;
    const verdict = expectancyR <= 0 ? "NO EDGE — DON'T BUY" : best.evPerEval <= 0 ? "EDGE TOO THIN — DON'T BUY" : best.evPerEval > 3 * evalCost ? "STRONG — FARMABLE" : "MARGINAL";
    const plainEnglish = expectancyR <= 0
      ? `Your stats give ${expectancyR.toFixed(2)}R per trade — a losing edge. No sizing fixes a negative edge; buying evals is −EV. The firm keeps your fee. Don't.`
      : best.evPerEval <= 0
        ? `Your +${expectancyR.toFixed(2)}R edge is real but too thin for these rules — best case is ${best.evPerEval >= 0 ? "+" : ""}$${best.evPerEval}/eval. Not worth it after the $${evalCost} fee.`
        : `Size at ${best.riskPct}% risk/trade → ${best.pPaid}% chance of a paid account, EV +$${best.evPerEval} per $${evalCost} eval. Bigger size LOWERS your odds — the money is in sizing to survive the drawdown rule, not in big bets.`;
    return new Response(JSON.stringify({ verdict, plainEnglish, expectancyR: +expectancyR.toFixed(3), optimalRiskPct: best.riskPct, pPaidAtOptimal: best.pPaid, evAtOptimal: best.evPerEval, grid: rows, edgeReal, note: "Two-hurdle Monte-Carlo (pass eval + profit on funded). Honest: a negative or thin edge is −EV regardless of sizing." }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ error: String(e).slice(0, 200) }), { status: 500, headers: cors }); }
});
