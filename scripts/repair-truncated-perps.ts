#!/usr/bin/env -S deno run --allow-net --allow-env
// repair-truncated-perps.ts (D-694) — undo a truncation I caused, and make the shape that caused it impossible.
//
// WHAT HAPPENED. `recover-delisted-perps.ts` writes a symbol's bars with a merge-duplicates upsert keyed on
// (symbol, tf) — it REPLACES the stored array. Its source is ONE `klines` call, which caps at 1500 bars. Given an
// explicit symbol list it skips the have-set filter, so it happily "recovered" 34 symbols that were already in the
// panel and overwrote each with at most 1500 bars. 110 panel symbols hold more than that. Four were truncated:
//
//   RLCUSDT   2219 -> 1500   (719 bars destroyed)
//   DENTUSDT  1855 -> 1500   (355)
//   OMGUSDT   1674 -> 1500   (174)
//   FTMUSDT   1565 -> 1500   (65)
//
// ~1,313 daily bars, recoverable because klines pages on startTime. This is the SAME hazard I added a guard for in
// `refresh-bars.ts` two hours earlier (D-687, ticker recycling) — a wholesale replace whose source can be shorter
// than what is held — reached through a different script that had no such check. Guarding one writer does not guard
// the pattern; the pattern is "replace an array from a capped source".
//
// THE REPAIR pages from onboardDate forward in 1500-bar windows, so the rebuilt series is at least as long as what
// was there. It refuses to write anything SHORTER than what is currently stored — the check whose absence caused
// the damage, now present in the script that repairs it.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("repair-truncated-perps", [
  { name: "SYMBOLS", def: "RLCUSDT,DENTUSDT,OMGUSDT,FTMUSDT", note: "the four measured as truncated" },
  { name: "PAUSE_MS", def: "200", note: "sequential by Hard Rule" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "rtp", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const info = await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo").then((r) => r.json());
const meta = new Map<string, { ob: number }>();
for (const s of info.symbols) meta.set(s.symbol, { ob: s.onboardDate });

const syms = K.SYMBOLS.split(/[,\s]+/).filter(Boolean);
assertNonEmpty("symbols to repair", syms, 1);
console.log(`==> REPAIR TRUNCATED PERPS — ${syms.length} symbol(s)`);

let repaired = 0;
const refused: string[] = [];
for (const sym of syms) {
  const cur = await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&symbol=eq.${sym}&select=n_bars`, { headers: hdr })
    .then((r) => r.json()).catch(() => []) as { n_bars: number }[];
  const held = cur[0]?.n_bars ?? 0;
  const ob = meta.get(sym)?.ob;
  if (!ob) { refused.push(`${sym}(no onboardDate)`); continue; }

  // Page forward from onboard. Each call returns at most 1500 bars starting at startTime; advance past the last one.
  const seen = new Map<number, number[]>();
  let cursor = ob;
  for (let page = 0; page < 12; page++) {
    const j = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1d&limit=1500&startTime=${cursor}`)
      .then((r) => r.ok ? r.json() : null).catch(() => null);
    await sleep(Number(K.PAUSE_MS));
    if (!Array.isArray(j) || !j.length) break;
    for (const kk of j as (string | number)[][]) {
      const t = Math.floor(+kk[0] / 1000), c = +kk[4];
      if (c > 0) seen.set(t, [t, +kk[1], +kk[2], +kk[3], c, +kk[5], +kk[7], +kk[9], +kk[8]]);
    }
    const lastOpen = +(j[j.length - 1] as (string | number)[])[0];
    if (j.length < 1500) break;
    cursor = lastOpen + 86400000;
  }
  const bars = [...seen.values()].sort((a, b) => a[0] - b[0]);

  // THE CHECK WHOSE ABSENCE CAUSED THE DAMAGE. Never replace a stored array with a shorter one.
  if (bars.length < held) { refused.push(`${sym}(rebuilt ${bars.length} < held ${held} — NOT WRITTEN)`); continue; }
  if (bars.length === held) { console.log(`    ${sym.padEnd(12)} ${String(held).padStart(5)} bars — already complete, no write`); continue; }

  const res = await fetch(`${OWNED}/trd_bars_intraday?on_conflict=symbol,tf`, { method: "POST",
    headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ symbol: sym, tf: "1dSF", bars, n_bars: bars.length }]) }).catch(() => null);
  if (!res || !res.ok) { refused.push(`${sym}(write ${res ? res.status : "net"})`); continue; }
  repaired++;
  const first = new Date(bars[0][0] * 1000).toISOString().slice(0, 10);
  const last = new Date(bars[bars.length - 1][0] * 1000).toISOString().slice(0, 10);
  console.log(`    ${sym.padEnd(12)} ${String(held).padStart(5)} -> ${String(bars.length).padStart(5)} bars  (+${bars.length - held})  ${first} .. ${last}`);
}
console.log(`\n  repaired ${repaired}  |  refused/unchanged ${refused.length}${refused.length ? ": " + refused.join(" ") : ""}`);
