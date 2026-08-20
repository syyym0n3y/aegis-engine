#!/usr/bin/env -S deno run --allow-net --allow-env
// sync-to-owned.ts (D-377) — move the research data (bars, fundamentals, insider, FF) from the RENTED broker onto the OWNED
// node. Uses ONLY the credential-free rented broker to READ (?allclasses/?barsbatch/?fundamentals/?insider_all) and the owned
// PostgREST to WRITE (service JWT). No rented DB password needed. After this the heavy analysis reads from OWNED — reliable,
// no shared-DB strain (the thing that lost a result last pass). Idempotent (merge-duplicates).
const RENTED = Deno.env.get("RENTED_BROKER") || "https://glzzoomuhnugsiichnub.supabase.co/functions/v1/trd-compute";
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt(): Promise<string> {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "sync", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const rget = (q: string) => fetch(`${RENTED}?${q}`).then((r) => r.json()).catch(() => null);
async function owrite(table: string, rows: unknown[], conflict: string) {
  const hdr = { "Content-Type": "application/json", Authorization: `Bearer ${await jwt()}`, apikey: await jwt(), Prefer: "resolution=merge-duplicates,return=minimal" };
  for (let i = 0; i < rows.length; i += 500) { let ok = false; for (let a = 0; a < 4 && !ok; a++) { try { const r = await fetch(`${OWNED}/${table}?on_conflict=${conflict}`, { method: "POST", headers: hdr, body: JSON.stringify(rows.slice(i, i + 500)) }); ok = r.ok; if (!ok) console.log(`  ${table} write ${r.status}: ${(await r.text()).slice(0, 80)}`); } catch (e) { console.log("  retry", String(e).slice(0, 60)); } if (!ok) await new Promise((r) => setTimeout(r, 2000)); } }
}

console.log(`==> SYNC rented → owned (${OWNED})`);
// 1. symbols + classes
const cls = new Map<string, string>();
for (const r of ((await rget("allclasses=1"))?.rows ?? []) as { symbol: string; asset_class: string }[]) cls.set(r.symbol, r.asset_class);
const syms = [...cls.keys()]; console.log(`1/4 bars: ${syms.length} symbols`);
let done = 0;
for (let i = 0; i < syms.length; i += 20) {
  const chunk = syms.slice(i, i + 20);
  const rows = ((await rget(`barsbatch=${encodeURIComponent(chunk.join(","))}`))?.rows ?? []) as { symbol: string; bars: number[][] }[];
  await owrite("trd_bars_deep", rows.filter((r) => r.bars?.length).map((r) => ({ symbol: r.symbol, asset_class: cls.get(r.symbol) || "equity", bars: r.bars, updated_at: new Date().toISOString() })), "symbol");
  done += rows.length; if (i % 200 === 0) console.log(`    ${done}/${syms.length}`);
}
console.log(`    bars done: ${done}`);
// 2. fundamentals
const f = ((await rget("fundamentals=1"))?.rows ?? []) as { t: string; c: string; e: string; p?: string; v: number }[];
console.log(`2/4 fundamentals: ${f.length} rows`);
await owrite("trd_fundamentals", f.map((r) => ({ ticker: r.t, concept: r.c, effective_date: r.e, period_end: r.p ?? r.e, value: r.v, cik: "0", updated_at: new Date().toISOString() })), "cik,concept,period_end");
// 3. insider
const ins = ((await rget("insider_all=1"))?.rows ?? []) as { t: string; d: string; v: number }[];
console.log(`3/4 insider: ${ins.length} events`);
await owrite("trd_insider", ins.map((r, i) => ({ ticker: r.t, accession: `sync-${i}`, disclosed_date: r.d, value_usd: r.v, updated_at: new Date().toISOString() })), "ticker,accession");
// 4. FF factors
const ff = ((await rget("ff=1"))?.rows ?? []) as { month: string; factor: string; ret: number }[];
console.log(`4/4 ff_factors: ${ff.length} rows`);
await owrite("trd_ff_factors", ff.map((r) => ({ ...r, updated_at: new Date().toISOString() })), "month,factor");
console.log("==> SYNC COMPLETE — research data now on the owned node.");
