#!/usr/bin/env -S deno run --allow-net --allow-env
// aegis-daily.ts (D-382) — the DAILY CONDITION ENGINE. Corrected doctrine: not "make money months later", but use ALL the
// data EVERY DAY to identify which instruments are in FAVOURABLE conditions to trade RIGHT NOW. For every instrument across the
// whole stack it reads the current state — MTF trend alignment (daily/weekly/monthly agree?), vol regime (calm=trend-friendly,
// turbulent=stand aside), trend strength scaled by vol — and flags today's favourable LONG/SHORT setups, ranked by edge, with
// the condition rationale. Runs daily on the owned node. DORMANT (surfaced, never auto-armed). Enter when conditions are
// favourable, hold while they remain, exit when they turn — condition-driven, not calendar-driven.
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "daily", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const H = async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; };
const hdr = await H();
console.log("==> AEGIS DAILY — favourable-condition scan across the whole stack (DORMANT)");

const meta = await fetch(`${OWNED}/trd_bars_deep?select=symbol,asset_class`, { headers: hdr }).then((r) => r.json()) as { symbol: string; asset_class: string }[];
const setups: { sym: string; cls: string; dir: string; align: number; regime: string; edge: number; d21: number; d63: number; d252: number; volpct: number }[] = [];
for (let i = 0; i < meta.length; i += 25) {
  const rows = await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${meta.slice(i, i + 25).map((m) => `"${m.symbol}"`).join(",")})&select=symbol,bars`, { headers: hdr }).then((r) => r.json()) as { symbol: string; bars: number[][] }[];
  for (const row of rows) {
    const b = row.bars; if (!b || b.length < 300) continue; const c = b.map((r) => r[4]); const k = c.length - 1; const px = c[k]; if (!(px > 0)) continue;
    // MTF trend: daily(21) / weekly(63) / monthly(252) horizons — do they agree?
    const t21 = c[k] / c[k - 21] - 1, t63 = c[k] / c[k - 63] - 1, t252 = c[k] / c[k - 252] - 1;
    if (![t21, t63, t252].every(Number.isFinite)) continue;
    const signs = [Math.sign(t21), Math.sign(t63), Math.sign(t252)]; const up = signs.filter((s) => s > 0).length, dn = signs.filter((s) => s < 0).length;
    const align = Math.max(up, dn); if (align < 2) continue; // need ≥2 of 3 timeframes aligned to be a "condition"
    const dir = up > dn ? "LONG" : "SHORT";
    // vol regime: current 21d realised vol vs its own 2yr history → percentile
    const rets: number[] = []; for (let j = k - 504; j <= k; j++) if (j > 0 && c[j - 1] > 0) rets.push(c[j] / c[j - 1] - 1);
    const rvNow = Math.sqrt(rets.slice(-21).reduce((s, x) => s + x * x, 0) / 21);
    const win: number[] = []; for (let j = 21; j < rets.length; j++) win.push(Math.sqrt(rets.slice(j - 21, j).reduce((s, x) => s + x * x, 0) / 21));
    const volpct = win.length ? win.filter((v) => v <= rvNow).length / win.length : 0.5;
    const regime = volpct < 0.4 ? "calm" : volpct > 0.75 ? "turbulent" : "normal";
    if (regime === "turbulent") continue; // stand aside when the instrument is in a turbulent regime (trend unreliable)
    // edge score: alignment × |medium trend| / vol (vol-scaled conviction)
    const edge = align * Math.abs(t63) / (rvNow * Math.sqrt(252) || 0.1);
    setups.push({ sym: row.symbol, cls: meta.find((m) => m.symbol === row.symbol)!.asset_class, dir, align, regime, edge: +edge.toFixed(2), d21: +(t21 * 100).toFixed(1), d63: +(t63 * 100).toFixed(1), d252: +(t252 * 100).toFixed(1), volpct: +volpct.toFixed(2) });
  }
}
setups.sort((a, b) => b.edge - a.edge);
const longs = setups.filter((s) => s.dir === "LONG"), shorts = setups.filter((s) => s.dir === "SHORT");
const day = { scanned_at: new Date().toISOString(), universe: meta.length, favourable: setups.length, dormant: true,
  top_long_conditions: longs.slice(0, 15), top_short_conditions: shorts.slice(0, 10),
  by_class: Object.fromEntries([...new Set(setups.map((s) => s.cls))].map((cl) => [cl, { long: setups.filter((s) => s.cls === cl && s.dir === "LONG").length, short: setups.filter((s) => s.cls === cl && s.dir === "SHORT").length }])),
  note: "Favourable = ≥2/3 timeframes trend-aligned AND not in a turbulent vol regime. Edge = alignment×|trend|/vol. Enter while favourable, exit when alignment breaks or regime turns turbulent. DORMANT — surfaced daily, never auto-armed." };
await fetch(`${OWNED}/trd_daily_conditions`, { method: "POST", headers: { ...hdr, Prefer: "return=minimal" }, body: JSON.stringify([{ scanned_at: day.scanned_at, conditions: day }]) }).catch(() => {});
console.log(JSON.stringify({ favourable_today: setups.length, longs: longs.length, shorts: shorts.length, top_longs: longs.slice(0, 8).map((s) => `${s.sym}(${s.cls},edge${s.edge},${s.regime})`), top_shorts: shorts.slice(0, 6).map((s) => `${s.sym}(${s.cls})`), by_class: day.by_class }, null, 2));
