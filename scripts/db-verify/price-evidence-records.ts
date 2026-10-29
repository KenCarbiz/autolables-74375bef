// Emits evidence records for a synthetic dealer page as JSON, for
// price-evidence-verify.sh. Synthetic data only.
import { buildEvidenceRecords } from "../../supabase/proposed/crawl-fee-treatment/priceEvidence.ts";
import { readPriceStack } from "../../supabase/proposed/crawl-fee-treatment/priceStack.ts";
import { DEALER_LABEL, TARGET_VIN, stack, vdpPage } from "../../src/lib/admin/pricing/fixtures/priceStackPages.ts";

const url = `https://dealer.example.test/viewdetails/new/${TARGET_VIN.toLowerCase()}/2027-suv`;
const html = vdpPage(stack([
  ["MSRP", "$100,000"], ["Dealer Discount", "-$3,000"], [DEALER_LABEL, "$97,000"],
  ["Retail Cash", "-$10,000"], ["Conveyance Fee", "+$895"], ["Your Price", "$87,895"],
]), "All prices exclude tax, title, registration and conveyance fee.");
const r = readPriceStack(html, TARGET_VIN, {
  dealerPriceLabels: [DEALER_LABEL], finalPriceLabels: ["Your Price"], configuredFee: 895,
  observedAt: new Date("2026-10-29T12:00:00Z"), pageUrl: url,
});
const records = await buildEvidenceRecords(html, r, {
  tenantId: process.argv[2], vin: TARGET_VIN, sourceUrl: url, capturedAt: "2026-10-29T12:00:00Z", screenshotSha256: null,
});
console.log(JSON.stringify(records));
