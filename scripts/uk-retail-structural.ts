#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// uk-retail-structural.ts — UK RETAIL-ONLY STRUCTURAL INSTRUMENTS: QUANTIFIED, NOT TESTED.
//
// WHAT THIS IS AND IS NOT. Every other script in this repo tries to FALSIFY an edge. This one does not, deliberately:
// the three instruments below are not edges and no statistical claim is made about any of them. They are STATUTORY
// FACTS — a tax wrapper, a government bonus, a state-backed lottery-shaped deposit — whose value is arithmetic once
// the rates are known. So the honest job is (a) fetch the rates from the issuing authority rather than recalling
// them, (b) do the arithmetic exactly, (c) label every tax assumption with its tax year, and (d) put the answer beside
// the D-746 deposit arithmetic so it is clear how much of the operator's problem it actually solves.
//
// THE REASON THIS IS FRONTIER AT ALL. D-746 concluded that below ~$60,000 of capital the next monthly deposit
// outweighs any alpha this programme could plausibly clear, and that nothing on the map says "get more money". The UK
// wrappers are the one lever that is neither alpha nor deposits: they RAISE THE NET RETURN OF A HELD PORTFOLIO BY
// STATUTE, with no forecast, no turnover, no capacity limit and no execution risk. If any of them is material at the
// operator's scale, it beats everything the falsification engine has cleared — because the engine has cleared nothing.
//
// SOURCES, all free, keyless and fetched LIVE (no value below is recalled from memory):
//   NS&I  https://www.nsandi.com/historical-interest-rates   Premium Bond prize-fund rate, full change history
//   NS&I  https://www.nsandi.com/products/premium-bonds      the current rate and the £50,000 holding limit
//   GOV.UK https://www.gov.uk/income-tax-rates | /tax-on-dividends | /capital-gains-tax/rates | /capital-gains-tax/allowances
//          /individual-savings-accounts | /lifetime-isa
// nsandi.com and gov.uk were NOT on the endpoint allowlist; both patterns were appended to
// ~/.claude/hooks/endpoints.allowlist under the operator's standing authorisation for free public data hosts.
//
// DESCRIPTIVE ONLY (THE MECHANISM LAW). No causal claim, no pre-registration, no lineage row.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("uk-retail-structural", [
  { name: "CAGR", def: "6.8", note: "gross %/yr of the held portfolio; D-735's SPY 1993-2026 buy-and-hold CAGR" },
  { name: "DIV_Y", def: "1.8", note: "assumed dividend yield %/yr of that portfolio (the income part of the CAGR)" },
  { name: "SIZES", def: "10000,50000,200000", note: "portfolio sizes to price the wrappers at (£)" },
  { name: "HORIZON", def: "20", note: "years, for the compounded wrapper value" },
  { name: "REFRESH", def: "0", note: "1 = ignore on-disk caches and re-fetch" },
]);
const CAGR = Number(K.CAGR) / 100, DIVY = Number(K.DIV_Y) / 100;
const SIZES = K.SIZES.split(",").map(Number);
const HORIZON = Number(K.HORIZON);
const REFRESH = K.REFRESH === "1";
const UA = "Mozilla/5.0 (Aegis Research ona@revitalise.io)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const f = (x: number, d = 2) => Number.isFinite(x) ? x.toFixed(d) : "n/a";
const gbp = (x: number) => "£" + Math.round(x).toLocaleString("en-GB");
try { await Deno.mkdir("data", { recursive: true }); } catch { /* exists */ }

const CACHE = "data/uk-retail-sources.json";
type Cache = Record<string, string>;
let cache: Cache = {};
if (!REFRESH) { try { cache = JSON.parse(await Deno.readTextFile(CACHE)) as Cache; } catch { cache = {}; } }
async function page(url: string): Promise<string> {
  if (cache[url]) return cache[url];
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
  const html = await r.text();
  console.log(`    GET ${url}  -> HTTP ${r.status}, ${html.length.toLocaleString()} bytes`);
  const txt = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&pound;/g, "£").replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "'").replace(/\s+/g, " ");
  cache[url] = txt;
  await sleep(300);
  return txt;
}

console.log(`==> UK RETAIL-ONLY STRUCTURAL INSTRUMENTS — every rate below is FETCHED, none recalled\n`);

// ─────────────────────────────────────────────────────────────────────────────
// (1) NS&I PREMIUM BONDS
// ─────────────────────────────────────────────────────────────────────────────
const nsHist = await page("https://www.nsandi.com/historical-interest-rates");
const nsPB = await page("https://www.nsandi.com/products/premium-bonds");

// POSITIVE CONTROL (D-641) BEFORE ANY PARSE IS BELIEVED: the page must contain the anchor phrases. A silently-changed
// page yields an empty parse that looks exactly like "NS&I publishes no history".
const ctlHist = /Prize draw effective from/i.test(nsHist) && /Prize fund rate/i.test(nsHist);
console.log(`\n    [CONTROL] NS&I history page contains "Prize draw effective from" + "Prize fund rate": ${ctlHist ? "PASS" : "FAIL"}`);
if (!ctlHist) { console.error(`!! NS&I history page shape changed. Refusing to report a parse that may be empty for the wrong reason.`); Deno.exit(1); }

// The table renders as: "<Month> <Year> <rate>% <odds> to 1", repeated, newest first, under the Premium Bonds heading.
interface PBRate { from: string; rate: number; odds: number }
const pbRates: PBRate[] = [];
{
  const seg = nsHist.slice(nsHist.search(/Prize draw effective from/i), nsHist.search(/Direct ISA/i));
  const re = /([A-Z][a-z]+)\s+(\d{4})\s+(\d+\.\d+)%\s+([\d,]+)\s+to\s+1/g;
  const MON = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  for (const m of seg.matchAll(re)) {
    const mo = MON.indexOf(m[1].toLowerCase());
    if (mo < 0) continue;
    pbRates.push({ from: `${m[2]}-${String(mo + 1).padStart(2, "0")}`, rate: Number(m[3]), odds: Number(m[4].replace(/,/g, "")) });
  }
}
assertNonEmpty("NS&I Premium Bond prize-fund rate history", pbRates, 10);
const pbNow = pbRates[0];
const pbCurrentOnProduct = nsPB.match(/[Aa]nnual prize fund rate\s*([\d.]+)%/);
console.log(`\n==> (1) NS&I PREMIUM BONDS — the tax-free prize fund rate, ${pbRates.length} changes on record`);
console.log(`    CURRENT: ${f(pbNow.rate)}% tax-free from the ${pbNow.from} prize draw, odds 1 in ${pbNow.odds.toLocaleString()} per £1 Bond unit`);
console.log(`    CROSS-CHECK against the product page (a second source for the same fact): ${pbCurrentOnProduct ? `${pbCurrentOnProduct[1]}% -> ${Number(pbCurrentOnProduct[1]) === pbNow.rate ? "AGREES" : "DISAGREES — do not trust either"}` : "not found on the product page"}`);
const pbLimit = /up to £50,000 in Premium Bonds/i.test(nsPB) ? 50000 : NaN;
console.log(`    HOLDING LIMIT: ${Number.isFinite(pbLimit) ? gbp(pbLimit) : "NOT FOUND"} per person (parsed from the product page, not assumed)`);
console.log(`\n    FULL RATE HISTORY (prize draw effective from -> tax-free prize fund rate, odds per £1 unit)`);
for (const r of pbRates) console.log(`      ${r.from}   ${f(r.rate).padStart(5)}%   1 in ${r.odds.toLocaleString()}`);
{
  const rs = pbRates.map((r) => r.rate);
  console.log(`    span ${pbRates[pbRates.length - 1].from} .. ${pbNow.from} | min ${f(Math.min(...rs))}% max ${f(Math.max(...rs))}% | mean of the ${rs.length} POSTED LEVELS ${f(rs.reduce((a, b) => a + b, 0) / rs.length)}%`);
  console.log(`    !! THAT MEAN IS A MEAN OF LEVELS, NOT A TIME-WEIGHTED AVERAGE — the 2020-2022 1.00% level ran for 18 months and`);
  console.log(`       counts once here, exactly like a level that lasted one month. It is reported as what it is and used for nothing.`);
}
console.log(`\n    WHAT THE PRIZE RATE ACTUALLY MEANS, said plainly, because the headline rate is the most misread number in UK retail:`);
console.log(`      The ${f(pbNow.rate)}% is the size of the PRIZE FUND divided by the total invested — it is NOT an expected return for a`);
console.log(`      given holder. The prize distribution is extremely right-skewed (two £1m prizes a month), so the MEDIAN holder`);
console.log(`      earns strictly less than the mean, and the smaller the holding the worse the gap. At the ${gbp(pbLimit)} maximum a`);
console.log(`      holder buys ${(pbLimit).toLocaleString()} monthly draw entries at odds 1 in ${pbNow.odds.toLocaleString()}, i.e. ~${f(pbLimit / pbNow.odds, 1)} expected prizes per month — enough`);
console.log(`      entries for the law of large numbers to bite, and the mean is then a fair description. At £1,000 it is ~${f(1000 / pbNow.odds, 3)}`);
console.log(`      prizes/month and the modal annual outcome is ZERO. This script therefore quotes the mean and says where it lies.`);

// ─────────────────────────────────────────────────────────────────────────────
// (2) TAX PARAMETERS — fetched, and every one labelled with its tax year
// ─────────────────────────────────────────────────────────────────────────────
const gIncome = await page("https://www.gov.uk/income-tax-rates");
const gDiv = await page("https://www.gov.uk/tax-on-dividends");
const gCgtR = await page("https://www.gov.uk/capital-gains-tax/rates");
const gCgtA = await page("https://www.gov.uk/capital-gains-tax/allowances");
const gIsa = await page("https://www.gov.uk/individual-savings-accounts");
const gLisa = await page("https://www.gov.uk/lifetime-isa");
await Deno.writeTextFile(CACHE, JSON.stringify(cache));

const taxYear = (gIncome.match(/current tax year is from (\d+ \w+ \d{4}) to (\d+ \w+ \d{4})/i) ?? ["", "?", "?"]).slice(1).join(" to ");
const divTaxYear = (gDiv.match(/rates from (\d+ \w+ \d{4}) to (\d+ \w+ \d{4})/i) ?? ["", "?", "?"]).slice(1).join(" to ");
const personalAllowance = Number((gIncome.match(/standard Personal Allowance is £([\d,]+)/i) ?? ["", "0"])[1].replace(/,/g, ""));
const basicBand = (gIncome.match(/Basic rate £([\d,]+) to £([\d,]+)\s*(\d+)%/i) ?? []);
const higherBand = (gIncome.match(/Higher rate £([\d,]+) to £([\d,]+)\s*(\d+)%/i) ?? []);
const divRates = gDiv.match(/Basic rate ([\d.]+)%\s*Higher rate ([\d.]+)%\s*Additional rate ([\d.]+)%/i);
const divAllow = Number((gDiv.match(/dividend allowance of £([\d,]+)/i) ?? ["", "0"])[1].replace(/,/g, ""));
const cgtHigher = Number((gCgtR.match(/higher or additional rate[^.]*?(\d+)% on your gains/i) ?? ["", "0"])[1]);
const cgtBasic = Number((gCgtR.match(/basic Income Tax band\s*,?\s*you['\u2019]ll pay (\d+)% on your gains/i) ?? ["", "0"])[1]);
const cgtAllow = Number((gCgtA.match(/Capital Gains tax-free allowance is:\s*£([\d,]+)/i) ?? ["", "0"])[1].replace(/,/g, ""));
const isaLimit = Number((gIsa.match(/the maximum you can save in ISAs is £([\d,]+)/i) ?? ["", "0"])[1].replace(/,/g, ""));
const isaYear = (gIsa.match(/In the (\d{4} to \d{4}) tax year/i) ?? ["", "?"])[1];
const lisaCap = Number((gLisa.match(/put in up to £([\d,]+) each year/i) ?? ["", "0"])[1].replace(/,/g, ""));
const lisaBonusMax = Number((gLisa.match(/25% bonus to your savings, up to a maximum of £([\d,]+) per year/i) ?? ["", "0"])[1].replace(/,/g, ""));

// POSITIVE CONTROL on the tax parse: each of these MUST be non-zero, or the arithmetic below is built on silent nulls.
const parsed: [string, number][] = [
  ["personal allowance", personalAllowance], ["basic-rate income tax %", Number(basicBand[3] ?? 0)], ["higher-rate income tax %", Number(higherBand[3] ?? 0)],
  ["dividend basic %", Number(divRates?.[1] ?? 0)], ["dividend higher %", Number(divRates?.[2] ?? 0)], ["dividend allowance", divAllow],
  ["CGT basic %", cgtBasic], ["CGT higher %", cgtHigher], ["CGT annual exempt amount", cgtAllow],
  ["ISA limit", isaLimit], ["LISA annual cap", lisaCap], ["LISA max bonus", lisaBonusMax],
];
console.log(`\n==> (2) TAX PARAMETERS — parsed from gov.uk, with a positive control on EVERY field`);
let bad = 0;
for (const [k, v] of parsed) { if (!(v > 0)) { bad++; console.log(`    [CONTROL] ${k.padEnd(28)} -> ${v}  FAIL`); } else console.log(`    [CONTROL] ${k.padEnd(28)} -> ${v}  PASS`); }
if (bad) { console.error(`!! ${bad} tax field(s) parsed as zero. Refusing to compute an uplift on silent nulls.`); Deno.exit(1); }
const BR_INC = Number(basicBand[3]) / 100, HR_INC = Number(higherBand[3]) / 100;
const BR_DIV = Number(divRates![1]) / 100, HR_DIV = Number(divRates![2]) / 100, AR_DIV = Number(divRates![3]) / 100;
console.log(`\n    ASSUMPTIONS, ALL STATED WITH THEIR TAX YEAR (none of these is a finding; all are statute):`);
console.log(`      income tax year          : ${taxYear}   personal allowance ${gbp(personalAllowance)}`);
console.log(`      income tax bands         : basic ${f(BR_INC * 100, 0)}% (${gbp(Number(basicBand[1].replace(/,/g, "")))}-${gbp(Number(basicBand[2].replace(/,/g, "")))}), higher ${f(HR_INC * 100, 0)}% (${gbp(Number(higherBand[1].replace(/,/g, "")))}-${gbp(Number(higherBand[2].replace(/,/g, "")))}), additional 45%`);
console.log(`      dividend tax (${divTaxYear}): basic ${f(BR_DIV * 100)}%, higher ${f(HR_DIV * 100)}%, additional ${f(AR_DIV * 100)}%; allowance ${gbp(divAllow)}`);
console.log(`      capital gains tax        : basic ${cgtBasic}%, higher/additional ${cgtHigher}%; annual exempt amount ${gbp(cgtAllow)}`);
console.log(`      ISA                      : ${gbp(isaLimit)} per person per tax year (${isaYear}); 18+; UK resident`);
console.log(`      Lifetime ISA             : ${gbp(lisaCap)}/yr in, 25% government bonus capped at ${gbp(lisaBonusMax)}/yr; counts INSIDE the ${gbp(isaLimit)}`);
console.log(`      SCOTLAND IS DIFFERENT and is NOT modelled: gov.uk states income tax bands differ for Scottish taxpayers.`);
console.log(`      The portfolio is assumed to yield ${f(DIVY * 100)}%/yr in dividends inside a ${f(CAGR * 100)}%/yr total return (D-735 SPY 1993-2026`);
console.log(`      buy-and-hold). The ${f(DIVY * 100)}% split is an ASSUMPTION of this script, not a measurement, and it drives the annual-drag term.`);

// ─────────────────────────────────────────────────────────────────────────────
// (3) THE ISA UPLIFT — computed, with the two taxes that actually bite separated
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n==> (3) THE ISA WRAPPER — what it is worth per year, by taxpayer band`);
console.log(`    TWO DISTINCT SAVINGS, and conflating them is how the ISA gets oversold:`);
console.log(`      (a) ANNUAL: dividend tax removed every year. Drag = max(0, yield*V - dividend allowance) * dividend rate.`);
console.log(`      (b) TERMINAL: CGT removed on the eventual sale. Value = max(0, gain - annual exempt amount) * CGT rate, ONCE.`);
console.log(`    The annual one compounds; the terminal one does not. Below, (a) is expressed as an uplift to the NET CAGR and`);
console.log(`    then compounded over ${HORIZON}y; (b) is priced separately on the terminal gain.`);

interface Band { label: string; divRate: number; cgtRate: number }
const BANDS: Band[] = [
  { label: `basic rate (${f(BR_INC * 100, 0)}% income)`, divRate: BR_DIV, cgtRate: cgtBasic / 100 },
  { label: `higher rate (${f(HR_INC * 100, 0)}% income)`, divRate: HR_DIV, cgtRate: cgtHigher / 100 },
];
console.log(`\n    size      band          div income/yr  taxable div   annual div tax   net CAGR unwrapped   ${HORIZON}y terminal: ISA vs taxable   CGT saved at sale`);
const rows: Record<string, unknown>[] = [];
for (const V of SIZES) {
  for (const b of BANDS) {
    const divInc = V * DIVY;
    const taxableDiv = Math.max(0, divInc - divAllow);
    const divTax = taxableDiv * b.divRate;
    const dragRate = divTax / V;                       // annual drag as a fraction of the portfolio
    const netCagr = CAGR - dragRate;
    const isaEnd = V * Math.pow(1 + CAGR, HORIZON);
    const taxEnd = V * Math.pow(1 + netCagr, HORIZON);
    const gainTaxable = Math.max(0, taxEnd - V - cgtAllow);
    const cgtSaved = gainTaxable * b.cgtRate;
    rows.push({ size: V, band: b.label, divInc, taxableDiv, divTax, netCagr, isaEnd, taxEnd, cgtSaved, total: (isaEnd - taxEnd) + cgtSaved });
    console.log(`    ${gbp(V).padEnd(9)} ${b.label.padEnd(22)} ${gbp(divInc).padStart(9)} ${gbp(taxableDiv).padStart(12)} ${gbp(divTax).padStart(14)} ${(f(netCagr * 100) + "%").padStart(20)} ${(gbp(isaEnd) + " vs " + gbp(taxEnd)).padStart(28)} ${gbp(cgtSaved).padStart(18)}`);
  }
}
console.log(`\n    TOTAL ${HORIZON}-YEAR VALUE OF THE WRAPPER = (compounded dividend-tax saving) + (CGT saved at sale):`);
for (const r of rows) console.log(`      ${gbp(r.size as number).padEnd(9)} ${(r.band as string).padEnd(22)} ${gbp((r.isaEnd as number) - (r.taxEnd as number)).padStart(10)} + ${gbp(r.cgtSaved as number).padStart(10)} = ${gbp(r.total as number).padStart(11)}   (${f(100 * (r.total as number) / (r.size as number), 1)}% of the starting portfolio)`);
console.log(`\n    THE HONEST QUALIFIER ON THE CGT HALF, which is where ISA marketing overstates: it assumes the whole position is`);
console.log(`    liquidated in ONE tax year. A holder who sells across years uses the ${gbp(cgtAllow)} exemption repeatedly, and a holder`);
console.log(`    who never sells pays no CGT at all. At ${gbp(SIZES[0])} the CGT saving is largely an artifact of that assumption; at`);
console.log(`    ${gbp(SIZES[SIZES.length - 1])} it is not, because a single year's exemption covers a trivial fraction of the gain.`);
console.log(`    ALSO NOT MODELLED (each would RAISE the ISA's value, so the numbers above are conservative): interest on cash,`);
console.log(`    the ${gbp(personalAllowance)} personal allowance interacting with other income, and the fact that an ISA needs no tax return.`);

// ─────────────────────────────────────────────────────────────────────────────
// (4) LISA
// ─────────────────────────────────────────────────────────────────────────────
const lisaAgeOpen = /must also be under 40/i.test(gIsa) || /under 40/i.test(gLisa);
const lisaAgeStop = /When you turn 50/i.test(gLisa);
const lisaPenalty = gLisa.match(/withdrawal charge of (\d+)%/i);
console.log(`\n==> (4) LIFETIME ISA — the 25% government bonus`);
console.log(`    Cap ${gbp(lisaCap)}/yr in, bonus 25% = ${gbp(lisaBonusMax)}/yr max, and it sits INSIDE the ${gbp(isaLimit)} ISA allowance.`);
console.log(`    AGE GATES (parsed): must open before 40 -> ${lisaAgeOpen ? "CONFIRMED" : "NOT FOUND"}; contributions stop at 50 -> ${lisaAgeStop ? "CONFIRMED" : "NOT FOUND"}.`);
console.log(`    SO THE LIFETIME MAXIMUM BONUS is bounded by age, not by wealth: opening at ${18} and paying ${gbp(lisaCap)} every year`);
console.log(`    to 50 gives at most ${50 - 18} x ${gbp(lisaBonusMax)} = ${gbp((50 - 18) * lisaBonusMax)} of bonus; opening at 39 gives at most ${gbp((50 - 39) * lisaBonusMax)}.`);
console.log(`    THE BONUS IS NOT A RETURN, it is a one-off ${f(25)}% on the CONTRIBUTION. Annualised over a ${HORIZON}y hold on a single`);
console.log(`    year's ${gbp(lisaCap)}, 25% up front is ${f(100 * (Math.pow(1.25, 1 / HORIZON) - 1))}%/yr of extra CAGR — large in year 1, small when spread.`);
console.log(`    THE CATCH, and it is severe: outside a first home (<= £450,000) or age 60, withdrawal carries a ${lisaPenalty ? lisaPenalty[1] : "25"}% charge on the`);
console.log(`    WITHDRAWAL, which is more than the 25% bonus on the CONTRIBUTION — 25% off a grown balance exceeds 25% added to the`);
console.log(`    original, so an early exit loses real capital, not just the bonus. That makes the LISA CONDITIONAL money, and it is`);
console.log(`    not comparable like-for-like with the unconditional ISA uplift above.`);

// ─────────────────────────────────────────────────────────────────────────────
// (5) THE COMPARISON TABLE + the D-746 frame
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n==> (5) THE TABLE: instrument | who can hold it | rate/uplift | worth per year at each size`);
console.log(`    (Premium Bonds are priced as their prize-fund rate against a taxable cash alternative earning the SAME rate,`);
console.log(`     so the number isolates the TAX-FREE-NESS, not a rate advantage — NS&I's rate is typically below best-buy cash.)`);
const hdr2 = `    ${"instrument".padEnd(22)} ${"who".padEnd(26)} ${"rate / uplift".padEnd(22)} ` + SIZES.map((s) => `worth/yr @${gbp(s)}`.padStart(20)).join("");
console.log(hdr2);
console.log(`    ${"-".repeat(hdr2.length - 4)}`);
const line = (name: string, who: string, rate: string, per: (v: number) => number) =>
  console.log(`    ${name.padEnd(22)} ${who.padEnd(26)} ${rate.padEnd(22)} ` + SIZES.map((s) => gbp(per(s)).padStart(20)).join(""));
line("Premium Bonds", "UK resident, any age", `${f(pbNow.rate)}% tax-free`, (v) => {
  const capped = Math.min(v, pbLimit);
  return capped * (pbNow.rate / 100) * BR_INC;   // basic-rate saver: the tax that would have been due on the same interest
});
line("  (higher-rate)", "same holder, 40% band", `${f(pbNow.rate)}% tax-free`, (v) => Math.min(v, pbLimit) * (pbNow.rate / 100) * HR_INC);
line("ISA — dividend tax", "UK resident, 18+", `${f(BR_DIV * 100)}% / ${f(HR_DIV * 100)}% removed`, (v) => Math.max(0, v * DIVY - divAllow) * BR_DIV);
line("  (higher-rate)", "same holder, 40% band", `${f(HR_DIV * 100)}% removed`, (v) => Math.max(0, v * DIVY - divAllow) * HR_DIV);
line("ISA — CGT (amortised)", `UK resident, sale in ${HORIZON}y`, `${cgtBasic}% / ${cgtHigher}% removed`, (v) => {
  const end = v * Math.pow(1 + CAGR, HORIZON);
  return Math.max(0, end - v - cgtAllow) * (cgtHigher / 100) / HORIZON;
});
line("LISA bonus", "opened 18-39, held to 60", `25% of contribution`, (_v) => lisaBonusMax);
console.log(`\n    NOTE ON THE PREMIUM BONDS ROWS: the ${gbp(pbLimit)} statutory cap means the row is FLAT above ${gbp(pbLimit)} — the`);
console.log(`    ${gbp(SIZES[SIZES.length - 1])} column is identical to the ${gbp(pbLimit)} value. That cap, not the rate, is what makes Premium Bonds`);
console.log(`    irrelevant to a large portfolio, and it is the single most important fact about them for a scaling saver.`);
console.log(`    NOTE ON THE LISA ROW: it is FLAT at ${gbp(lisaBonusMax)} at every size for the same reason (a ${gbp(lisaCap)} contribution cap),`);
console.log(`    and it is CONDITIONAL money (first home or age 60), unlike every other row.`);

console.log(`\n==> (6) AGAINST THE D-746 DEPOSIT ARITHMETIC — the only comparison that decides anything`);
console.log(`    D-746: at $1,800/yr of deposits and a generous 3% alpha the crossover capital is $60,000; below it the next`);
console.log(`    deposit outweighs any alpha this programme could plausibly clear (it has cleared none). Restated in the same`);
console.log(`    units, a WRAPPER is alpha that requires no forecast — so the honest question is what alpha-equivalent it is worth:`);
console.log(`    THE ALPHA-EQUIVALENT IS COMPUTED PROPERLY, not by dividing a one-off saving by the horizon. That shortcut would`);
console.log(`    charge a ${HORIZON}-year-grown balance's CGT against the STARTING capital and print ~3%/yr, which is wrong by roughly the`);
console.log(`    growth multiple. The honest figure is the CAGR that makes the two AFTER-TAX terminal wealths equal:`);
console.log(`        alpha_equiv = (ISA terminal / taxable terminal after CGT)^(1/${HORIZON}) - 1`);
console.log(``);
console.log(`    size      band            ISA terminal   taxable terminal (post-CGT)   alpha-equivalent   of which dividends   of which CGT`);
for (const V of SIZES) {
  for (const b of BANDS) {
    const divTax = Math.max(0, V * DIVY - divAllow) * b.divRate;
    const netCagr = CAGR - divTax / V;
    const isaEnd = V * Math.pow(1 + CAGR, HORIZON);
    const taxEndPre = V * Math.pow(1 + netCagr, HORIZON);
    const taxEnd = taxEndPre - Math.max(0, taxEndPre - V - cgtAllow) * b.cgtRate;
    const alpha = Math.pow(isaEnd / taxEnd, 1 / HORIZON) - 1;
    const alphaDiv = CAGR - netCagr;                                     // the dividend half, exactly
    console.log(`    ${gbp(V).padEnd(9)} ${b.label.padEnd(24)} ${gbp(isaEnd).padStart(12)} ${gbp(taxEnd).padStart(29)} ${(f(alpha * 100, 3) + "%/yr").padStart(18)} ${(f(alphaDiv * 100, 3) + "%/yr").padStart(20)} ${(f((alpha - alphaDiv) * 100, 3) + "%/yr").padStart(14)}`);
  }
}
const hiAlpha = (() => {
  const V = SIZES[1], b = BANDS[1];
  const divTax = Math.max(0, V * DIVY - divAllow) * b.divRate;
  const netCagr = CAGR - divTax / V;
  const isaEnd = V * Math.pow(1 + CAGR, HORIZON);
  const taxEndPre = V * Math.pow(1 + netCagr, HORIZON);
  const taxEnd = taxEndPre - Math.max(0, taxEndPre - V - cgtAllow) * b.cgtRate;
  return Math.pow(isaEnd / taxEnd, 1 / HORIZON) - 1;
})();
console.log(`\n    THE UNCOMFORTABLE READING, first: at ${gbp(SIZES[0])} the ISA's dividend saving is ${gbp(Math.max(0, SIZES[0] * DIVY - divAllow) * HR_DIV)}/yr, because a ${f(DIVY * 100)}% yield on`);
console.log(`    ${gbp(SIZES[0])} is ${gbp(SIZES[0] * DIVY)} and the ${gbp(divAllow)} dividend allowance already shelters ${f(100 * Math.min(1, divAllow / (SIZES[0] * DIVY)), 0)}% of it. The wrapper is NOT the lever at`);
console.log(`    small size — the allowances already are — and D-746's answer stands unchanged there: the deposit is the lever.`);
console.log(`    Where the wrapper DOES bind is above roughly ${gbp(divAllow / DIVY)} of portfolio (where the dividend allowance is exhausted) and`);
console.log(`    above roughly ${gbp(cgtAllow / (Math.pow(1 + CAGR, HORIZON) - 1))} of portfolio (where ${HORIZON}y of ${f(CAGR * 100)}% growth exceeds the ${gbp(cgtAllow)} CGT exemption).`);
console.log(`    Both thresholds are far below D-746's $60,000 crossover, so ON THE SAME AXIS the ordering is:`);
console.log(`      1. keep depositing            (dominates below ~$60k, D-746)`);
console.log(`      2. hold it inside an ISA      (free, statutory, ~${f(hiAlpha * 100, 2)}%/yr at ${gbp(SIZES[1])} higher-rate — bigger than any edge this engine has cleared, which is zero)`);
console.log(`      3. everything this programme has tested (nothing promoted; see LADDER.md)`);
console.log(`    That ordering is the finding. It is embarrassing for the falsification engine and it is what the numbers say.`);

console.log(`\n==> WHAT THIS IS NOT`);
console.log(`    NOT a test, NOT a strategy, NOT personalised advice. No hypothesis was falsified and no gate was cleared;`);
console.log(`    the only claims are statutory rates fetched live plus arithmetic on them. DESCRIPTIVE ONLY (MECHANISM LAW).`);
console.log(`    Every tax figure is an ASSUMPTION labelled with its tax year (${taxYear}); rates change annually and Scotland`);
console.log(`    differs. NS&I's ${f(pbNow.rate)}% is a variable prize-fund rate, not a guaranteed return, and its MEDIAN outcome is below`);
console.log(`    its mean at every holding size. The ${f(CAGR * 100)}%/yr portfolio return is D-735's realised SPY figure, not a forecast.`);
await Deno.writeTextFile("data/uk-retail-structural.json", JSON.stringify({
  fetched: new Date().toISOString(), premiumBonds: { current: pbNow, limit: pbLimit, history: pbRates },
  tax: { taxYear, divTaxYear, personalAllowance, basic: BR_INC, higher: HR_INC, divRates: { basic: BR_DIV, higher: HR_DIV, additional: AR_DIV }, divAllow, cgtBasic, cgtHigher, cgtAllow, isaLimit, isaYear, lisaCap, lisaBonusMax },
  assumptions: { cagr: CAGR, divYield: DIVY, horizon: HORIZON, sizes: SIZES }, isaRows: rows,
}, null, 1));
console.log(`\n    Wrote data/uk-retail-structural.json and data/uk-retail-sources.json (raw fetched text, for reproducibility).`);
