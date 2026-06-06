import { isOpenMarketBuy, parseDailyIndex, parseForm4, toFilingRow } from "./trd-edgar.ts";
import { assert, assertEquals } from "./trd-test-helpers.ts";

// real lines from https://www.sec.gov/Archives/edgar/daily-index/2026/QTR2/form.20260605.idx
const INDEX = `Form Type   Company Name                                                  CIK         Date Filed  File Name
---------------------------------------------------------------------------------------------------------------------------------------------
1-K              Ridepair Inc.                                                 2050256     20260605    edgar/data/2050256/0001683168-26-004584.txt
4                1ST SOURCE CORP                                               34782       20260605    edgar/data/34782/0000939167-26-000004.txt
4/A              ACME WIDGETS INC                                              999999      20260605    edgar/data/999999/0001111111-26-000007.txt
10-K             Some Big Co                                                   12345       20260605    edgar/data/12345/0002222222-26-000001.txt`;

// a Form-4 ownership doc matching the REAL tag structure observed on EDGAR:
// issuer/owner direct text; transaction date/shares/price/A-D wrapped in <value>;
// transactionCode a direct text node. Two transactions: one PURCHASE, one AWARD.
const FORM4 = `<ownershipDocument>
  <issuer><issuerTradingSymbol>SRCE</issuerTradingSymbol></issuer>
  <reportingOwner><reportingOwnerId><rptOwnerName>FITZPATRICK DANIEL B</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>1</isDirector><officerTitle>CEO</officerTitle></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTransaction>
    <transactionDate><value>2026-06-03</value></transactionDate>
    <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
    <transactionAmounts>
      <transactionShares><value>1000</value></transactionShares>
      <transactionPricePerShare><value>50.25</value></transactionPricePerShare>
      <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
    </transactionAmounts>
  </nonDerivativeTransaction>
  <nonDerivativeTransaction>
    <transactionDate><value>2026-06-03</value></transactionDate>
    <transactionCoding><transactionCode>A</transactionCode></transactionCoding>
    <transactionAmounts>
      <transactionShares><value>250</value></transactionShares>
      <transactionPricePerShare><value>0</value></transactionPricePerShare>
      <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
    </transactionAmounts>
  </nonDerivativeTransaction>
</ownershipDocument>`;

Deno.test("parseDailyIndex: filters to Form 4 / 4/A and extracts accession", () => {
  const rows = parseDailyIndex(INDEX);
  assertEquals(rows.length, 2);
  assertEquals(rows[0].form, "4");
  assertEquals(rows[0].company, "1ST SOURCE CORP");
  assertEquals(rows[0].cik, "34782");
  assertEquals(rows[0].dateFiled, "20260605");
  assertEquals(rows[0].accession, "0000939167-26-000004");
  assertEquals(rows[1].form, "4/A");
});

Deno.test("parseForm4: extracts issuer/owner/role + both transactions", () => {
  const f4 = parseForm4(FORM4);
  assertEquals(f4.issuerSymbol, "SRCE");
  assertEquals(f4.ownerName, "FITZPATRICK DANIEL B");
  assertEquals(f4.isDirector, true);
  assertEquals(f4.officerTitle, "CEO");
  assertEquals(f4.transactions.length, 2);
  assertEquals(f4.transactions[0].code, "P");
  assertEquals(f4.transactions[0].shares, 1000);
  assertEquals(f4.transactions[0].price, 50.25);
  assertEquals(f4.transactions[1].code, "A");
});

Deno.test("isOpenMarketBuy: only the PURCHASE counts (awards excluded)", () => {
  const f4 = parseForm4(FORM4);
  const buys = f4.transactions.filter(isOpenMarketBuy);
  assertEquals(buys.length, 1);
  assertEquals(buys[0].code, "P");
});

Deno.test("toFilingRow: canonical row with disclosed/trade dates + open-market notional", () => {
  const idx = parseDailyIndex(INDEX)[0];
  const f4 = parseForm4(FORM4);
  const row = toFilingRow(idx, f4);
  assertEquals(row.source, "edgar");
  assertEquals(row.source_id, "0000939167-26-000004");
  assertEquals(row.ticker, "SRCE");
  assertEquals(row.disclosed_date, "2026-06-05");
  assertEquals(row.trade_date, "2026-06-03");
  assertEquals(row.amount_low, 1000 * 50.25); // only the open-market buy
  assertEquals((row.raw as { openMarketBuys: number }).openMarketBuys, 1);
});
