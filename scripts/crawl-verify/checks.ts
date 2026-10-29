// What the crawler does, case by case, on synthetic pages: the VIN gate, the
// label it reads, how the doc fee is treated and what the above-feed guard
// compares. Each case states the behaviour observed in the code as it is; a
// PASS confirms the description, not that the behaviour is desirable.
import { extractAdvertised, extractPriceComponents, buildBreakdown, priceEvidenceHtml } from "./extract.ts";
import { classifyRenderedPage } from "./crawlUrlPolicy.ts";
import { judgeAboveFeed } from "./priceGuard.ts";

const TARGET = "1EXMP0005S9000001";
const OTHER = "1EXMP0007S9000002";
const URL_T = `https://dealer.example.test/viewdetails/used/${TARGET.toLowerCase()}/example-suv`;
const page = (body: string, title = "Example Dealer") => `<html><head><title>${title}</title></head><body>${body}</body></html>`;
const results: string[] = [];
const check = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
};
const notChallenge = () => false;

// T1 VIN gate, cheap path: a page with no VIN in its body, fetched at a URL that carries the VIN.
const noVin = page(`<div>Selling Price $24,500</div>`);
const r1 = extractAdvertised(priceEvidenceHtml(noVin), URL_T, TARGET, ["Selling Price"]);
check("T1 cheap path: a page with no VIN anywhere still yields a price (absence passes the gate)", [r1.price, r1.reason], [24500, null]);

// T2 VIN gate, cheap path: body shows only another vehicle's VIN, URL carries the target.
const otherVin = page(`<div>VIN ${OTHER}</div><div>Selling Price $31,000</div>`);
const r2 = extractAdvertised(priceEvidenceHtml(otherVin), URL_T, TARGET, ["Selling Price"]);
check("T2 cheap path: body shows only another VIN, lowercase target in URL -> refused", [r2.price, r2.reason], [null, "vin_mismatch"]);
const URL_UP = `https://dealer.example.test/viewdetails/used/${TARGET}/example-suv`;
const r2b = extractAdvertised(priceEvidenceHtml(otherVin), URL_UP, TARGET, ["Selling Price"]);
check("T2b cheap path: same page, UPPERCASE target in URL -> URL supplies the VIN, price accepted", [r2b.price, r2b.reason], [31000, null]);

// T3 render path: classifier with final URL equal to the requested URL.
const c3 = classifyRenderedPage({ html: otherVin, requestedUrl: URL_T, finalUrl: URL_T, pageStatus: 200, targetVin: TARGET, isChallenge: notChallenge });
check("T3 render path: other vehicle in body, not redirected, lowercase URL -> verdict", c3.verdict, "other_vehicle");
const c3n = classifyRenderedPage({ html: noVin, requestedUrl: URL_T, finalUrl: URL_T, pageStatus: 200, targetVin: TARGET, isChallenge: notChallenge });
check("T3n render path: page with no VIN at all -> verdict", c3n.verdict, "no_vehicle");
const c3u = classifyRenderedPage({ html: otherVin, requestedUrl: URL_UP, finalUrl: URL_UP, pageStatus: 200, targetVin: TARGET, isChallenge: notChallenge });
check("T3u render path: other vehicle in body, UPPERCASE final URL -> verdict", c3u.verdict, "vehicle");
const c3b = classifyRenderedPage({ html: otherVin, requestedUrl: URL_T, finalUrl: null, pageStatus: 200, targetVin: TARGET, isChallenge: notChallenge });
check("T3b render path: same page, provider returns no final URL -> verdict", c3b.verdict, "other_vehicle");
const c3c = classifyRenderedPage({ html: otherVin, requestedUrl: URL_T, finalUrl: `https://dealer.example.test/viewdetails/used/${OTHER.toLowerCase()}/x`, pageStatus: 200, targetVin: TARGET, isChallenge: notChallenge });
check("T3c render path: redirected to another vehicle's URL -> verdict", c3c.verdict, "other_vehicle");

// T4 label: "Selling Price" is a default label; first occurrence in page text wins, within 80 chars.
const carouselFirst = page(`<div class="similar">Similar vehicle Selling Price $19,900</div><div>VIN ${TARGET} Selling Price $24,500</div>`);
const r4 = extractAdvertised(priceEvidenceHtml(carouselFirst), URL_T, TARGET, ["Selling Price"]);
check("T4 label tier: a similar-vehicle card earlier in the page wins the label", [r4.price, r4.matched_label], [19900, "selling price"]);

// T5 fee treatment: the tenant flag alone decides inclusion; a page with no fee line reports ok.
const noFeeLine = extractPriceComponents(priceEvidenceHtml(page(`<div>Selling Price $24,500</div>`)));
const b5 = buildBreakdown(24500, noFeeLine, 900, true);
check("T5 inclusive tenant, page shows no fee line -> before-doc, status", [b5.advertised_price_before_doc, b5.website_sale_price, b5.price_parse_status], [23600, 24500, "ok"]);
const withFeeLine = extractPriceComponents(priceEvidenceHtml(page(`<div>Selling Price $24,500</div><div>Documentation fee $900</div>`)));
const b5b = buildBreakdown(24500, withFeeLine, 900, true);
check("T5b inclusive tenant, page shows a matching fee line -> identical result and identical note", [b5b.advertised_price_before_doc, b5b.price_parse_status, b5b.price_parse_notes === b5.price_parse_notes], [23600, "ok", true]);
const exclusiveTenant = buildBreakdown(24500, noFeeLine, 900, false);
check("T5c same page, tenant flag off -> fee added on top instead", [exclusiveTenant.advertised_price_before_doc, exclusiveTenant.website_sale_price], [24500, 25400]);

// T6 guard: page figure equal to MSRP, tenant fee-inclusive, feed stale.
const MSRP = 50000, FEE = 900, FEED = 47000, DAY = 86_400_000;
const b6 = buildBreakdown(MSRP, noFeeLine, FEE, true);
const g6 = judgeAboveFeed({ scraped: b6.advertised_price_before_doc, feedPrice: FEED, feedMsrp: MSRP, feedAgeMs: 27 * DAY, freshMs: 3 * DAY });
check("T6 page figure == feed MSRP, inclusive tenant, stale feed -> misparse?", [b6.advertised_price_before_doc, g6.misparse, g6.reason], [49100, false, null]);
const g6b = judgeAboveFeed({ scraped: MSRP, feedPrice: FEED, feedMsrp: MSRP, feedAgeMs: 27 * DAY, freshMs: 3 * DAY });
check("T6b same figure judged before the fee is subtracted -> misparse?", [g6b.misparse, g6b.reason], [true, "at_or_above_msrp"]);

// T7 guard: a drop below a fresh feed price is always written.
const g7 = judgeAboveFeed({ scraped: 20000, feedPrice: 25000, feedMsrp: null, feedAgeMs: 1 * DAY, freshMs: 3 * DAY });
check("T7 website $5,000 below a fresh feed price -> misparse?", g7.misparse, false);

console.log(results.join("\n"));
console.log(`\n${results.length} checks, ${results.filter((r) => r.startsWith("FAIL")).length} failed`);
if (results.some((r) => r.startsWith("FAIL"))) Deno.exit(1);
