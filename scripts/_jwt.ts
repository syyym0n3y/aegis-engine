// _jwt.ts — prints a service_role JWT for shell health-checks. No data access of its own.
const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "sh", exp: 4102444800 });
const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(Deno.env.get("JWT_SECRET")!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
console.log(`${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`);
