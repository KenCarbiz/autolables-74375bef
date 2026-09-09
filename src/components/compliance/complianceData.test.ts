import { describe, it, expect } from "vitest";
import {
  buildIssueRows,
  buildOverview,
  buildPriceRows,
  buildTitleRows,
  countUnresolvedPriceVins,
  isActiveListing,
  latestRunByVehicle,
  reconcileGap,
  feeExclusiveEquivalent,
  type CertificationRunRow,
  type DocumentFlagRow,
  type ListingRow,
  type PriceSnapshotRow,
  type VehicleDocumentRow,
} from "./complianceData";

const VIN = "5N1DL0MM8SC123456";
const OTHER_VIN = "JN8AZ2NE7S9123456";

const listing = (over: Partial<ListingRow> = {}): ListingRow => ({
  id: "veh-1",
  vin: VIN,
  ymm: "2025 INFINITI QX60",
  trim: null,
  condition: "used",
  status: "published",
  price: 48_000,
  website_sale_price: null,
  advertised_price_before_doc: null,
  doc_fee: null,
  price_parse_status: null,
  price_last_verified_at: null,
  price_source_url: null,
  source_url: null,
  open_recall_count: 0,
  recall_status: null,
  created_at: "2026-08-01T12:00:00Z",
  mc_attributes: null,
  sticker_snapshot: null,
  ...over,
});

const snapshot = (over: Partial<PriceSnapshotRow> = {}): PriceSnapshotRow => ({
  id: "snap-1",
  vin: VIN,
  advertised_price: 48_000,
  source_channel: "website",
  source_url: "https://dealer.example/vdp",
  captured_at: "2026-09-07T08:00:00Z",
  captured_by: null,
  ...over,
});

const flag = (over: Partial<DocumentFlagRow> = {}): DocumentFlagRow => ({
  id: "flag-1",
  vehicle_id: "veh-1",
  severity: "warning",
  reason: "Vehicle price changed after this sticker was generated.",
  changed_field: "price",
  old_value: 48_000,
  new_value: 47_105,
  status: "open",
  created_at: "2026-09-01T08:00:00Z",
  ...over,
});

describe("active inventory", () => {
  it("uses status, never published_at, to decide what is in stock", () => {
    expect(isActiveListing({ status: "published" })).toBe(true);
    expect(isActiveListing({ status: "draft" })).toBe(true);
    expect(isActiveListing({ status: "archived" })).toBe(false);
  });

  it("excludes archived vehicles from every derived list", () => {
    const rows = buildPriceRows({
      listings: [listing(), listing({ id: "veh-2", vin: OTHER_VIN, status: "archived" })],
      snapshots: [],
      flags: [],
      defaultDocFee: 0,
    });
    expect(rows.map((r) => r.vin)).toEqual([VIN]);
  });
});

describe("fee-inclusive website prices (Harte VDP ladder)", () => {
  // The real page: Market Value $36,925, less an $11,944 discount, plus an $895
  // conveyance fee, displayed as Sale Price $25,876. The feed says $24,981.
  const HARTE = { website_sale_price: 25_876, advertised_price_before_doc: 24_981 };

  it("reports no gap when the only difference is the fee the page added", () => {
    // Before the fix this returned +895 -- on all 132 vehicles at once, because
    // the only adjustment available was to ADD the fee, which moves the website
    // price further from the feed rather than closer.
    const fx = feeExclusiveEquivalent(25_876, HARTE);
    expect(fx).toBe(24_981);
    expect(reconcileGap(25_876, 24_981, 895, fx)).toEqual({ difference: 0, matchedWithDocFee: true });
  });

  it("still reports a real discrepancy of exactly the fee amount", () => {
    // The tolerance was NOT widened, so a genuine $895 gap on top of the fee is
    // still caught. A symmetric add-or-subtract heuristic would have hidden it.
    const fx = feeExclusiveEquivalent(25_876, HARTE);
    expect(reconcileGap(25_876, 24_086, 895, fx)).toEqual({ difference: 895, matchedWithDocFee: true });
  });

  it("declines to substitute when the page never added a fee", () => {
    expect(feeExclusiveEquivalent(24_981, { website_sale_price: 24_981, advertised_price_before_doc: 24_981 })).toBeNull();
  });

  it("declines to substitute when the snapshot is not that page's total", () => {
    // A stale snapshot, or a marketplace channel, must not be re-interpreted
    // through a ladder parsed off the dealer's own site.
    expect(feeExclusiveEquivalent(23_400, HARTE)).toBeNull();
  });

  it("declines to substitute when the ladder was never parsed", () => {
    expect(feeExclusiveEquivalent(25_876, { website_sale_price: null, advertised_price_before_doc: null })).toBeNull();
  });

  it("falls back to the old heuristic for snapshots with no ladder", () => {
    expect(reconcileGap(47_105, 48_000, 895, null)).toEqual({ difference: 0, matchedWithDocFee: true });
  });
});

describe("reconcileGap", () => {
  it("reports the raw gap when no doc fee is configured", () => {
    expect(reconcileGap(47_105, 48_000, 0)).toEqual({ difference: -895, matchedWithDocFee: false });
  });

  it("treats a doc-fee-sized gap as reconciled and says so", () => {
    expect(reconcileGap(47_105, 48_000, 895)).toEqual({ difference: 0, matchedWithDocFee: true });
  });
});

describe("price rows grouped by VIN", () => {
  it("collapses many historical events into one row per VIN", () => {
    const snaps = Array.from({ length: 12 }, (_, i) =>
      snapshot({ id: `snap-${i}`, captured_at: `2026-08-${String(i + 1).padStart(2, "0")}T08:00:00Z`, advertised_price: 48_000 - i }),
    );
    const flags = Array.from({ length: 4 }, (_, i) =>
      flag({ id: `flag-${i}`, created_at: `2026-07-${String(i + 1).padStart(2, "0")}T08:00:00Z`, status: "resolved" }),
    );
    const rows = buildPriceRows({ listings: [listing()], snapshots: snaps, flags, defaultDocFee: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0].historicalEvents).toBe(16);
  });

  it("reports the live discrepancy as the current issue, not the history", () => {
    const rows = buildPriceRows({
      listings: [listing()],
      snapshots: [snapshot({ advertised_price: 47_105 })],
      flags: [flag({ status: "resolved" }), flag({ id: "flag-2", status: "resolved" })],
      defaultDocFee: 0,
    });
    expect(rows[0].state).toBe("differs");
    expect(rows[0].currentIssue).toBe("Website price differs by $895");
    expect(rows[0].historicalEvents).toBe(3);
    expect(rows[0].openFlags).toBe(0);
  });

  it("prefers a dealer-confirmed capture over the feed price as the reference", () => {
    const rows = buildPriceRows({
      listings: [listing()],
      snapshots: [
        snapshot({ id: "manual-1", source_channel: "manual", advertised_price: 47_500, captured_at: "2026-09-06T08:00:00Z" }),
        snapshot({ advertised_price: 47_500 }),
      ],
      defaultDocFee: 0,
      flags: [],
    });
    expect(rows[0].referenceLabel).toBe("Dealer-confirmed");
    expect(rows[0].confirmedPrice).toBe(47_500);
    expect(rows[0].state).toBe("matched");
  });

  it("does not read a seed row as a real website price", () => {
    const rows = buildPriceRows({
      listings: [listing()],
      snapshots: [snapshot({ advertised_price: 0, captured_by: "seed" })],
      flags: [],
      defaultDocFee: 0,
    });
    expect(rows[0].state).toBe("awaiting_snapshot");
    expect(rows[0].currentIssue).toBeNull();
  });

  it("marks a VIN with no snapshots as not monitored rather than mismatched", () => {
    const rows = buildPriceRows({ listings: [listing()], snapshots: [], flags: [], defaultDocFee: 0 });
    expect(rows[0].state).toBe("not_monitored");
  });
});

describe("countUnresolvedPriceVins", () => {
  it("counts vehicles with a problem, never historical event rows", () => {
    const snaps = Array.from({ length: 30 }, (_, i) =>
      snapshot({ id: `s${i}`, captured_at: `2026-08-${String((i % 28) + 1).padStart(2, "0")}T08:00:00Z`, advertised_price: 47_105 }),
    );
    const flags = Array.from({ length: 20 }, (_, i) => flag({ id: `f${i}`, status: "resolved" }));
    const rows = buildPriceRows({ listings: [listing()], snapshots: snaps, flags, defaultDocFee: 0 });
    expect(rows[0].historicalEvents).toBe(50);
    expect(countUnresolvedPriceVins(rows)).toBe(1);
  });

  it("counts a VIN whose only problem is an open document flag", () => {
    const rows = buildPriceRows({
      listings: [listing()],
      snapshots: [snapshot()],
      flags: [flag({ status: "open" })],
      defaultDocFee: 0,
    });
    expect(rows[0].state).toBe("matched");
    expect(countUnresolvedPriceVins(rows)).toBe(1);
  });

  it("is zero when every monitored vehicle reconciles", () => {
    const rows = buildPriceRows({
      listings: [listing()],
      snapshots: [snapshot()],
      flags: [flag({ status: "resolved" })],
      defaultDocFee: 0,
    });
    expect(countUnresolvedPriceVins(rows)).toBe(0);
  });
});

describe("titles", () => {
  const doc = (doc_type: string): VehicleDocumentRow => ({ vin: VIN, doc_type, created_at: "2026-08-10T08:00:00Z" });

  it("requires an MCO for a new car and a title for a used one", () => {
    const rows = buildTitleRows(
      [listing({ condition: "new" }), listing({ id: "veh-2", vin: OTHER_VIN, condition: "used" })],
      [],
      "clerk@dealer.example",
    );
    expect(rows[0].requirement.kind).toBe("mco");
    expect(rows[1].requirement.kind).toBe("title");
  });

  it("distinguishes a half-uploaded document from a missing one", () => {
    const rows = buildTitleRows([listing()], [doc("title_front")], "");
    expect(rows[0].state).toBe("front_only");
    expect(rows[0].owner).toBeNull();
  });

  it("clears a vehicle with both sides on file", () => {
    const rows = buildTitleRows([listing()], [doc("title_front"), doc("title_back")], "clerk@dealer.example");
    expect(rows[0].state).toBe("on_file");
    expect(rows[0].owner).toBe("clerk@dealer.example");
  });
});

describe("certification runs", () => {
  const run = (over: Partial<CertificationRunRow> = {}): CertificationRunRow => ({
    id: "run-1",
    vehicle_id: "veh-1",
    vin: VIN,
    stock: null,
    vehicle_title: "2025 INFINITI QX60",
    ready: false,
    checks: null,
    certified_at: "2026-09-01T08:00:00Z",
    ...over,
  });

  it("keeps only the newest run per vehicle", () => {
    const map = latestRunByVehicle([
      run({ id: "old", certified_at: "2026-08-01T08:00:00Z", ready: false }),
      run({ id: "new", certified_at: "2026-09-05T08:00:00Z", ready: true }),
    ]);
    expect(map.get("veh-1")?.id).toBe("new");
  });
});

describe("issues and overview", () => {
  const build = (over: { listings?: ListingRow[]; runs?: CertificationRunRow[] } = {}) => {
    const listings = over.listings ?? [listing()];
    const priceRows = buildPriceRows({ listings, snapshots: [snapshot()], flags: [], defaultDocFee: 0 });
    const titleRows = buildTitleRows(listings, [], "clerk@dealer.example");
    const issueRows = buildIssueRows({
      listings,
      runs: over.runs ?? [],
      exceptions: [],
      priceRows,
      titleRows,
      recallTasks: [{ vin: OTHER_VIN, status: "open_review", open_recall_count: 0 }],
    });
    return { issueRows, titleRows, priceRows };
  };

  it("gathers every finding for a VIN onto one row", () => {
    const { issueRows } = build({ listings: [listing({ open_recall_count: 2 })] });
    expect(issueRows).toHaveLength(1);
    expect(issueRows[0].issues.map((i) => i.category)).toEqual(["documents", "recall"]);
    expect(issueRows[0].critical).toBe(1);
  });

  // Compliance may not read a zero as clear. On 74 of the pilot tenant's 130
  // active cars `open_recall_count = 0` sits beside an NHTSA lookup that never
  // answered, and compliance used to raise nothing at all for them.
  it("raises an exception rather than passing a vehicle with no VIN-level recall answer", () => {
    const { issueRows } = build({
      listings: [listing({
        open_recall_count: 0,
        recall_status: null,
        recall_payload: { source: "nhtsa", note: "no_nhtsa_record_http_400", checked_at: "2026-09-08T03:00:00Z" },
      })],
    });
    const recall = issueRows[0].issues.filter((i) => i.category === "recall");
    expect(recall).toHaveLength(1);
    expect(recall[0].label).toBe("Recall verification unavailable for this VIN");
    expect(recall[0].severity).toBe("attention");
    expect(recall[0].detail).toMatch(/Model not in NHTSA's records/);
  });

  // NHTSA recognising the model and returning zero campaigns is a real answer
  // about the MODEL LINE. It still does not clear the car.
  it("does not treat NO_MODEL_CAMPAIGNS_FOUND as compliance clearance", () => {
    const { issueRows } = build({
      listings: [listing({
        open_recall_count: 0,
        recall_status: "clear",
        recall_payload: {
          source: "nhtsa", checked_at: "2026-09-08T03:00:00Z",
          model_in_catalog: true, open_recall_count: 0,
        },
      })],
    });
    const recall = issueRows[0].issues.filter((i) => i.category === "recall");
    expect(recall).toHaveLength(1);
    expect(recall[0].label).toBe("Recall verification unavailable for this VIN");
    expect(recall[0].detail).toMatch(/No campaigns on this model/);
  });

  it("clears the recall exception only on a VIN-level answer", () => {
    const { issueRows } = build({
      listings: [listing({
        open_recall_count: 0,
        recall_status: "clear",
        recall_payload: {
          source: "marketcheck", scope: "vin", open_recall_count: 0,
          checked_at: new Date().toISOString(),
        },
      })],
    });
    expect(issueRows[0].issues.filter((i) => i.category === "recall")).toHaveLength(0);
  });

  it("does not report a certification state for a vehicle that was never run", () => {
    const { issueRows } = build();
    expect(issueRows[0].certificationReady).toBeNull();
  });

  it("keeps open-recall counts and recall-review tasks as separate populations", () => {
    const { issueRows, titleRows } = build({ listings: [listing({ open_recall_count: 1 })] });
    const overview = buildOverview({
      issueRows,
      titleRows,
      recallTasks: [
        { vin: OTHER_VIN, status: "open_review", open_recall_count: 0 },
        { vin: "3RDVIN00000000000", status: "closed", open_recall_count: 0 },
      ],
    });
    expect(overview.openRecallVehicles).toBe(1);
    expect(overview.recallReviewTasks).toBe(1);
    expect(overview.uncertified).toBe(1);
    expect(overview.auditReady).toBe(0);
  });
});
