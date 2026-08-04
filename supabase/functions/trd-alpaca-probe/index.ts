// trd-alpaca-probe — retired. Confirmed 2026-08-04: no APCA_*/ALPACA_* secret on the command-centre
// (glzz) project where Aegis runs. Add APCA_API_KEY_ID + APCA_API_SECRET_KEY to glzz to enable real
// Alpaca paper execution for the BTC hypotheses.
Deno.serve(() => new Response(JSON.stringify({ retired: true, finding: "no Alpaca key on glzz; add APCA_API_KEY_ID + APCA_API_SECRET_KEY to command-centre secrets" }), { headers: { "Content-Type": "application/json" } }));
