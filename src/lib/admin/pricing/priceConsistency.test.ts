import { describe, it, expect } from "vitest";
import { assessConsistency, consistencyHeadline, summarizeConsistency, type ConsistencyListing } from "./priceConsistency";

// The label and feed price is the fee-exclusive advertised price; the stored
// website total is that price plus the document fee.
const listing = (over: Partial<ConsistencyListing> = {}): ConsistencyListing => ({
  id: "l1",
  vin: "EXAMPLEVIN0000001",
  year: 2024,
  make: "Example",
  model: "Crossover",
  trim: "Base",
  stock: "EX-1",
  condition: "used",
  heroImageUrl: null,
  price: 30_000,
  advertisedBeforeDoc: 30_000,
  docFee: 895,
  websiteSalePrice: 30_895,
  parseStatus: "ok",
  verifiedAt: "2026-10-20T00:00:00Z",
  vehicleFileId: "f1",
  ...over,
});

const obs = (price: number, capturedAt = "2026-10-21T00:00:00Z") => ({ price, capturedAt, sourceUrl: "https://example.test/vdp", channel: "website" });

describe("price consistency assessment", () => {
  it("is consistent when the website shows the fee-exclusive label price", () => {
    const a = assessConsistency(listing(), obs(30_000), 895, "advertised_before_doc");
    expect(a.status).toBe("consistent");
    expect(a.evidence).toBe("same_version");
    expect(a.label).toBe(30_000);
    expect(a.passport).toBe(30_000);
    expect(a.reviewHref).toBe("/vehicle-file/f1");
  });

  it("reconciles a fee-inclusive website total against the fee-exclusive label through the canonical helper", () => {
    const a = assessConsistency(listing(), obs(30_895), 895, "advertised_before_doc");
    expect(a.status).toBe("consistent");
    expect(a.delta).toBe(0);
  });

  it("flags a website price that disagrees with the label and links to the vehicle file", () => {
    const a = assessConsistency(listing(), obs(31_000), 895, "advertised_before_doc");
    expect(a.status).toBe("mismatch");
    expect(a.delta).toBe(1000);
    expect(a.detail).toMatch(/\+\$1,000/);
    expect(a.reviewHref).toBe("/vehicle-file/f1");
  });

  it("links to the inventory search when the vehicle has no file", () => {
    const a = assessConsistency(listing({ vehicleFileId: null }), obs(31_000), 895, "advertised_before_doc");
    expect(a.reviewHref).toBe("/inventory?q=EXAMPLEVIN0000001");
  });

  it("reads an observation older than the verification stamp as older evidence", () => {
    const a = assessConsistency(listing(), obs(30_000, "2026-10-01T00:00:00Z"), 895, "advertised_before_doc");
    expect(a.evidence).toBe("older_version");
  });

  it("is not checked without a website observation or with a seed row", () => {
    expect(assessConsistency(listing(), null, 895, "advertised_before_doc").status).toBe("not_checked");
    expect(assessConsistency(listing(), obs(0), 895, "advertised_before_doc").status).toBe("not_checked");
    expect(assessConsistency(listing(), null, 895, "advertised_before_doc").evidence).toBe("awaiting");
  });

  it("is not checked when the listing has no label price", () => {
    expect(assessConsistency(listing({ price: null }), obs(30_000), 895, "advertised_before_doc").status).toBe("not_checked");
  });

  it("keeps a parser warning as a mismatch even when the numbers agree", () => {
    const a = assessConsistency(listing({ parseStatus: "warning" }), obs(30_000), 895, "advertised_before_doc");
    expect(a.status).toBe("mismatch");
    expect(a.detail).toMatch(/parser/);
  });

  it("shows the Passport value for the configured display basis", () => {
    expect(assessConsistency(listing(), obs(30_000), 895, "website_sale_price").passport).toBe(30_000);
    expect(assessConsistency(listing({ price: 29_500 }), obs(29_500), 895, "advertised_before_doc").passport).toBe(29_500);
  });
});

describe("consistency headline", () => {
  it("is Unknown when the read failed, never All reconciled", () => {
    expect(consistencyHeadline(null, true)).toEqual({ label: "Unknown", tone: "neutral" });
    expect(consistencyHeadline({ consistent: 3, mismatch: 0, notChecked: 0, shown: 3 }, true).label).toBe("Unknown");
  });

  it("reports mismatches first, then unchecked coverage, and only then a consistent set", () => {
    expect(consistencyHeadline({ consistent: 1, mismatch: 2, notChecked: 0, shown: 3 }, false)).toEqual({ label: "2 mismatches", tone: "warning" });
    expect(consistencyHeadline({ consistent: 0, mismatch: 0, notChecked: 3, shown: 3 }, false).label).toBe("Not checked");
    expect(consistencyHeadline({ consistent: 2, mismatch: 0, notChecked: 1, shown: 3 }, false).label).toBe("2 consistent, 1 not checked");
    expect(consistencyHeadline({ consistent: 3, mismatch: 0, notChecked: 0, shown: 3 }, false)).toEqual({ label: "3 consistent", tone: "success" });
    expect(consistencyHeadline({ consistent: 0, mismatch: 0, notChecked: 0, shown: 0 }, false).label).toBe("No priced vehicles");
  });

  it("summarizes a mixed set", () => {
    const rows = [
      assessConsistency(listing(), obs(30_000), 895, "advertised_before_doc"),
      assessConsistency(listing({ id: "l2", vin: "EXAMPLEVIN0000002" }), null, 895, "advertised_before_doc"),
    ];
    expect(summarizeConsistency(rows)).toEqual({ consistent: 1, mismatch: 0, notChecked: 1, shown: 2 });
  });
});
