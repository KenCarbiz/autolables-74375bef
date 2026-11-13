import { MOCK_LISTING, MOCK_NEW_2026, MOCK_SPARSE, MOCK_NEW_MSRP, MOCK_USED_FEE } from "@/pages/VehiclePassportV3";
import { usedRow, newRow, legacyUsedRow, NOW } from "@/lib/intelligence/marketPass/__fixtures__/rows";

export { NOW };

type Row = Record<string, unknown>;

const SOLD_AT = "2026-11-01T15:00:00.000Z";

export const soldRow = (): Row => ({
  ...(MOCK_USED_FEE as Row),
  id: "mock-sold", slug: "sample-sold", vin: "3PCAJ5BB1PF113140",
  status: "sold",
});

export const withdrawnRow = (): Row => ({
  ...(MOCK_USED_FEE as Row),
  id: "mock-withdrawn", slug: "sample-withdrawn", vin: "3PCAJ5BB1PF113143",
  status: "archived", archived_at: SOLD_AT, archive_reason: "withdrawn",
});

export const pendingRow = (): Row => ({
  ...(MOCK_USED_FEE as Row),
  id: "mock-pending", slug: "sample-pending", vin: "3PCAJ5BB1PF113141",
  status: "pending",
});

export const brandedTitleRow = (): Row => ({
  ...(MOCK_USED_FEE as Row),
  id: "mock-branded", slug: "sample-branded", vin: "3PCAJ5BB1PF113142",
  mc_attributes: { ...(MOCK_USED_FEE.mc_attributes as Row), carfax_clean_title: false, accident_count: 1 },
  title_verification: { status: "branded", verified_at: "2026-10-20T00:00:00.000Z", source: "nmvtis", brand_note: "Rebuilt" },
});

/** Every row the page view is exercised against, by name. */
export const pageViewFixtures = (): Record<string, Row> => ({
  used: { ...(MOCK_LISTING as Row), condition: "used", id: "mock-used", slug: "sample-used", vin: "5N1AL1F83VC332077", mileage: 21500 },
  new2026: MOCK_NEW_2026 as Row,
  newMsrp: MOCK_NEW_MSRP as Row,
  usedFee: MOCK_USED_FEE as Row,
  sparse: MOCK_SPARSE as Row,
  sold: soldRow(),
  pending: pendingRow(),
  withdrawn: withdrawnRow(),
  brandedTitle: brandedTitleRow(),
  mockListing: MOCK_LISTING as Row,
  marketPassUsed: usedRow() as unknown as Row,
  marketPassNew: newRow() as unknown as Row,
  marketPassLegacy: legacyUsedRow() as unknown as Row,
});
