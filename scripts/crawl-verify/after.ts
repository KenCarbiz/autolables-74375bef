// The cases of checks.ts, through the corrected modules: what the crawler does
// now with the same synthetic pages. Each line states the new behaviour; a PASS
// confirms the description.
import { extractVehiclePrice } from "../../supabase/functions/_shared/vdpPrice.ts";
import { classifyRenderedPage } from "../../supabase/functions/_shared/crawlUrlPolicy.ts";
import { decideFeeBasis } from "../../supabase/functions/_shared/feeBasis.ts";
import { judgeAboveFeed } from "../../supabase/functions/_shared/priceGuard.ts";

const TARGET = "1EXMP0005S9000001";
const OTHER = "1EXMP0007S9000002";
const URL_T = `https://dealer.example.test/viewdetails/used/${TARGET.toLowerCase()}/example-suv`;
const URL_UP = `https://dealer.example.test/viewdetails/used/${TARGET}/example-suv`;
const page = (body: string, title = "Example Dealer") => `<html><head><title>${title}</title></head><body>${body}</body></html>`;
const results: string[] = [];
const check = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
};
const read = (html: string, url = URL_T, finalUrl: string | null = url) =>
  extractVehiclePrice(html, { targetVin: TARGET, requestedUrl: url, finalUrl, labels: ["Selling Price"] });

const noVin = page(`<div>Selling Price $24,500</div>`);
check("T1 a page with no VIN anywhere -> refused (before: $24,500 accepted)", [read(noVin).price, read(noVin).reason], [null, "identity_unverified"]);

const otherVin = page(`<div>VIN ${OTHER}</div><div>Selling Price $31,000</div>`);
check("T2 body shows only another VIN, lowercase URL -> refused (unchanged)", [read(otherVin).price, read(otherVin).reason], [null, "vin_mismatch"]);
check("T2b same page, UPPERCASE URL -> refused (before: the URL supplied the VIN and $31,000 was accepted)",
  [read(otherVin, URL_UP).price, read(otherVin, URL_UP).reason], [null, "vin_mismatch"]);

// classifyRenderedPage is no longer on the price path; identity is decided by
// pageIdentity inside extractVehiclePrice. Shown for the same pages.
check("T3u other vehicle in body, UPPERCASE final URL -> refused (before: classifyRenderedPage said vehicle)",
  [read(otherVin, URL_UP, URL_UP).reason, classifyRenderedPage({ html: otherVin, requestedUrl: URL_UP, finalUrl: URL_UP, pageStatus: 200, targetVin: TARGET, isChallenge: () => false }).verdict],
  ["vin_mismatch", "vehicle"]);

const carouselFirst = page(`<div class="similar">Similar vehicle Selling Price $19,900</div><div>VIN ${TARGET} Selling Price $24,500</div>`);
const cardWithVin = page(`<div><a href="/viewdetails/used/${OTHER.toLowerCase()}">Similar vehicle</a> Selling Price $19,900</div><div>VIN ${TARGET} Selling Price $24,500</div>`);
check("T4 similar-vehicle card first (same page as before) -> the vehicle's own $24,500 (before: the card's $19,900)", read(carouselFirst).price, 24500);
check("T4c an unmarked card that links another VIN -> removed with that vehicle, $24,500", read(cardWithVin).price, 24500);

const unmarked = page(`<div>Selling Price $19,900</div><div>VIN ${TARGET} Selling Price $24,500</div>`);
check("T4b an unattributed conflicting price -> refused as ambiguous (before: first match won)", [read(unmarked).price, read(unmarked).reason], [null, "ambiguous_price"]);

const settings = { doc_fee_enabled: true, doc_fee_amount: 900, advertised_includes_doc_fee: true };
const basis = (sectionText: string, amount = 24500) => decideFeeBasis({
  observed: { amount, label: "Selling Price", source: "dom_label", section: "page" }, settings, pageUrl: URL_T,
  listingCondition: "used", sectionText, pageText: "",
});
const b5 = basis("selling price $24,500");
check("T5 inclusive setting, page shows no fee line -> derived but held, not page-verified (before: written, status ok)",
  [b5.status, b5.derived?.advertised_price_before_doc, b5.promote], ["dealer_configured_unverified", 23600, false]);
const b5b = basis("selling price $24,500 documentation fee $900");
check("T5b a fee line alone is not evidence of inclusion -> still held (before: identical note to T5)", [b5b.status, b5b.promote], ["dealer_configured_unverified", false]);
const b5c = basis("selling price $24,500 documentation fee $900 total price $24,500");
check("T5c a fee line and a labelled total that agree with the setting -> page-verified", [b5c.status, b5c.promote], ["page_verified", true]);

const MSRP = 50000, DAY = 86_400_000;
const b6 = basis("selling price $50,000", MSRP);
const g6 = judgeAboveFeed({ scraped: b6.derived?.advertised_price_before_doc ?? MSRP, feedPrice: 47000, feedMsrp: MSRP, feedAgeMs: 27 * DAY, freshMs: 3 * DAY });
check("T6 page figure == feed MSRP, inclusive setting, stale feed -> the guard still passes it, but it is held (before: written)",
  [g6.misparse, b6.status, b6.promote], [false, "dealer_configured_unverified", false]);

const g7 = judgeAboveFeed({ scraped: 20000, feedPrice: 25000, feedMsrp: null, feedAgeMs: 1 * DAY, freshMs: 3 * DAY });
check("T7 website $5,000 below a fresh feed price -> still not a mis-parse (unchanged: no lower bound)", g7.misparse, false);

console.log(results.join("\n"));
console.log(`\n${results.length} checks, ${results.filter((r) => r.startsWith("FAIL")).length} failed`);
if (results.some((r) => r.startsWith("FAIL"))) Deno.exit(1);
