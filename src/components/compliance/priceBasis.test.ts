// L06 regression tests. The Q50 fixture reproduces production values for VIN
// JN1BV7AR6FM406806 (read-only, Nov 7 2026): feed $17,883, website snapshot
// $17,883, crawl decomposition $16,988 + $895 doc fee.
import { describe, it, expect } from "vitest";
import { buildPriceRows, comparePriceBases, type ListingRow, type PriceSnapshotRow } from "./complianceData";

const listing = (o: Partial<ListingRow>): ListingRow => ({
  id: "q50", vin: "JN1BV7AR6FM406806", ymm: "2015 INFINITI Q50", trim: null, condition: "used", status: "published",
  price: 17883, doc_fee: 895, website_sale_price: null, advertised_price_before_doc: null,
  price_parse_status: null, price_last_verified_at: null, price_source_url: null, source_url: null,
  open_recall_count: null, recall_status: null, created_at: "2026-09-01T00:00:00Z", mc_attributes: null, sticker_snapshot: null,
  ...o,
});
const snap = (channel: string, price: number, at = "2026-09-10T07:29:02Z"): PriceSnapshotRow => ({
  id: `${channel}-${price}`, vin: "JN1BV7AR6FM406806", advertised_price: price, source_channel: channel, source_url: null, captured_at: at, captured_by: null,
});
const rowFor = (l: ListingRow, snaps: PriceSnapshotRow[]) =>
  buildPriceRows({ listings: [l], snapshots: snaps, flags: [], defaultDocFee: 895 })[0];

describe("L06 — named price bases", () => {
  it("Q50: compares equivalent bases, never shows identical Current/Proposed as a correction", () => {
    const row = rowFor(
      listing({ website_sale_price: 17883, advertised_price_before_doc: 16988 }),
      [snap("website", 17883), snap("feed", 17883, "2026-09-08T16:45:52Z")],
    );
    expect(row.comparisonBasis).toBe("fee_removed_from_website");
    expect(row.websiteComparedPrice).toBe(16988);
    const cmp = comparePriceBases(row);
    // Current is the website on the selling-price basis — not the raw $17,883.
    expect(cmp.current).toEqual({ sellingPrice: 16988, docFee: 895, advertisedTotal: 17883 });
    expect(cmp.proposed).toEqual({ sellingPrice: 17883, docFee: 895, advertisedTotal: 18778 });
    expect(cmp.noChange).toBe(false);
    expect(cmp.summary).toMatch(/selling price \(before the doc fee\) basis/);
    expect(cmp.summary).toMatch(/\$16,988/);
    expect(cmp.summary).toMatch(/\$895 lower/);
    // The gap is exactly the fee and the feed equals the displayed total:
    // the fee basis must be confirmed before anything changes.
    expect(cmp.feeBasisQuestion).toMatch(/Confirm which basis/);
    expect(row.currentIssue).toMatch(/confirm the fee basis/);
  });

  it("equal values on the same basis read No change, not a corrective transaction", () => {
    const row = rowFor(listing({}), [snap("website", 17883)]);
    expect(row.comparisonBasis).toBe("as_displayed");
    expect(row.state).toBe("matched");
    const cmp = comparePriceBases(row);
    expect(cmp.noChange).toBe(true);
    expect(cmp.feeBasisQuestion).toBeNull();
    expect(cmp.summary).toMatch(/agree/);
  });

  it("a fee-inclusive reference is compared against website + fee and says so", () => {
    // Feed $18,778 (includes fee), website shows selling price $17,883.
    const row = rowFor(listing({ price: 18778 }), [snap("website", 17883)]);
    expect(row.comparisonBasis).toBe("fee_added_to_website");
    const cmp = comparePriceBases(row);
    expect(cmp.noChange).toBe(true);
    expect(cmp.basisNote).toMatch(/appears to include the \$895 doc fee/);
  });

  it("a real gap on equivalent bases proposes the reference and names both amounts", () => {
    // Website $17,883 above a feed of $17,000: compared as displayed.
    const row = rowFor(listing({ price: 17000 }), [snap("website", 17883)]);
    expect(row.comparisonBasis).toBe("as_displayed");
    const cmp = comparePriceBases(row);
    expect(cmp.noChange).toBe(false);
    expect(cmp.feeBasisQuestion).toBeNull();
    expect(cmp.current).toEqual({ sellingPrice: 17883, docFee: 895, advertisedTotal: 18778 });
    expect(cmp.proposed).toEqual({ sellingPrice: 17000, docFee: 895, advertisedTotal: 17895 });
    expect(cmp.summary).toMatch(/\$883 higher/);
  });

  it("no website capture: nothing to compare, nothing proposed", () => {
    const row = rowFor(listing({}), [snap("feed", 17883)]);
    expect(row.state).toBe("awaiting_snapshot");
    expect(comparePriceBases(row).noChange).toBe(true);
  });
});
