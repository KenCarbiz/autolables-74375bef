import { describe, it, expect } from "vitest";
import {
  deriveVerificationReport, summarizeVerificationExceptions,
  VERIFICATION_STATUS_LABEL, VERIFICATION_CHECK_SHORT_LABEL,
  type VerificationReport,
} from "./verificationSummary";
import type { PassportData } from "@/lib/passportV2Data";
import type { VehicleListing } from "@/hooks/useVehicleListing";

// A VIN-level recall answer with a source and a time. `{ has_open: false }`
// alone is a zero with no provenance, and a zero without source, scope and
// time is not a clean claim — so it no longer verifies anything.
const VIN_LEVEL_CLEAR = {
  has_open: false,
  source: "marketcheck",
  scope: "vin",
  open_recall_count: 0,
  checked_at: new Date().toISOString(),
};

// Minimal PassportData stub — only the fields the report derivation reads.
const dOf = (o: Partial<PassportData>): PassportData => ({
  accidentCount: null, ownerCount: null, cleanTitle: false, titleStatus: "unknown",
  marketAvg: null, belowMarket: null, warrantyStr: null, warrantyExpired: false,
  marketCheckedAt: null,
  ...(o as object),
} as PassportData);
// Every synthetic listing carries a decoded spec unless a test removes it: the
// VIN identity check needs a decode that returned, not just a typed ymm.
const decodeReceiptFor = (o: Partial<VehicleListing>) => {
  const m = /^(\d{4})\s+(\S+)\s+(.+)$/.exec(String(o.ymm ?? ""));
  return m && o.vin ? [{ vin: o.vin, provider: "neovin", http_status: 200, fetched_at: "2026-10-01T00:00:00.000Z", year: m[1], make: m[2], model: m[3], payload_hash: "test" }] : [];
};
const lOf = (o: Partial<VehicleListing>): VehicleListing => ({ vin_decode_receipts: decodeReceiptFor(o), ...(o as object) } as unknown as VehicleListing);

// Two dated odometer readings from an independent history source: the
// minimum that lets the odometer check verify "no rollback indicators".
const ODO_HISTORY = (latest: number) => ({
  odometer_readings: [
    { date: "2025-01-15", miles: Math.max(0, latest - 9000), source: "AutoCheck" },
    { date: "2026-03-02", miles: Math.max(0, latest - 1500), source: "AutoCheck" },
  ],
});

// Every report must satisfy the two arithmetic invariants, always.
const assertArithmetic = (r: VerificationReport) => {
  expect(r.totalChecks).toBe(
    r.verifiedChecks + r.needsAttentionChecks + r.needsConfirmationChecks + r.pendingChecks + r.unavailableChecks,
  );
  expect(r.completedChecks).toBe(r.verifiedChecks + r.needsAttentionChecks + r.needsConfirmationChecks);
};

describe("deriveVerificationReport — canonical customer summary", () => {
  it("the QX50 real-data scenario yields 8/6/1(conf)/1(unavailable)/7 complete/5 sources", () => {
    const r = deriveVerificationReport(
      dOf({
        accidentCount: 0, ownerCount: 1, titleStatus: "unknown", cleanTitle: false,
        marketAvg: 41000, belowMarket: 1500, warrantyStr: "4 yr / 60,000 mi", warrantyExpired: false,
        marketCheckedAt: "2026-07-15T00:00:00Z",
      }),
      lOf({
        vin: "5N1AL1F83VC332076", ymm: "2025 INFINITI QX50", trim: "LUXE AWD",
        mileage: 12000, condition: "used", history_payload: ODO_HISTORY(12000),
        recall_status: "clear", open_recall_count: 1,
        recall_check: { checked_at: "2026-07-10T00:00:00Z", has_open: true, campaigns: [{ campaignNumber: "25V123", component: "Backup camera", summary: "Rearview image may fail.", remedy: "Dealer will update software." }] },
      } as Partial<VehicleListing>),
    );
    assertArithmetic(r);
    expect(r.totalChecks).toBe(8);
    expect(r.verifiedChecks).toBe(6);
    expect(r.needsConfirmationChecks).toBe(1);
    expect(r.pendingChecks).toBe(0);
    expect(r.needsAttentionChecks).toBe(0);
    expect(r.unavailableChecks).toBe(1);
    expect(r.completedChecks).toBe(7);
    expect(r.sourceCount).toBe(5);
    expect(r.valid).toBe(true);

    expect(r.checks.find((c) => c.key === "recall")?.status).toBe("needs_confirmation");
    // No title record of any kind and no title workflow running: unavailable.
    expect(r.checks.find((c) => c.key === "title")?.status).toBe("unavailable");

    expect(r.banner.tone).toBe("amber");
    expect(r.banner.heading).toBe("Review one item before purchase");
    expect(r.banner.body).toContain("6 checks verified · 1 needs confirmation · 1 not available");
    expect(r.banner.body).toContain("Confirm the recall status with the dealer");
    expect(r.banner.body).not.toMatch(/title/i);
  });

  it("sourceCount counts unique FAMILIES, not checks (four history checks = one family)", () => {
    const r = deriveVerificationReport(
      dOf({ accidentCount: 0, ownerCount: 1, titleStatus: "clean", cleanTitle: true }),
      lOf({ vin: "5N1AL1F83VC332076", ymm: "2025 INFINITI QX50", mileage: 12000, condition: "used" }),
    );
    // vin + 4 vehicle-history checks all returned data, but only 2 families.
    // A pending check consulted nothing (L02), so it is not a source either.
    const consulted = new Set(r.checks.filter((c) => c.status !== "unavailable" && c.status !== "pending").map((c) => c.family));
    expect(consulted.has("oem_vin")).toBe(true);
    expect(consulted.has("vehicle_history")).toBe(true);
    expect(r.sourceCount).toBe(consulted.size);
    expect(r.sourceCount).toBeLessThan(r.completedChecks);
  });

  it("an all-verified vehicle shows the green completed banner", () => {
    const r = deriveVerificationReport(
      dOf({ accidentCount: 0, ownerCount: 1, titleStatus: "clean", cleanTitle: true, marketAvg: 61000, belowMarket: 3000, warrantyStr: "4 yr / 60,000 mi" }),
      lOf({ vin: "5N1AL1F83VC332076", ymm: "2027 INFINITI QX60", mileage: 17, condition: "new", history_payload: { odometer_readings: [{ date: "2026-05-01", miles: 5, source: "Manufacturer PDI" }, { date: "2026-06-01", miles: 12, source: "Manufacturer PDI" }] }, recall_status: "clear", open_recall_count: 0, recall_check: VIN_LEVEL_CLEAR } as Partial<VehicleListing>),
    );
    assertArithmetic(r);
    expect(r.verifiedChecks).toBe(8);
    expect(r.needsConfirmationChecks + r.needsAttentionChecks + r.pendingChecks).toBe(0);
    expect(r.banner.tone).toBe("green");
    expect(r.banner.heading).toBe("Verification checks completed");
  });

  // The owner's worked example, and the collapse a previous build shipped:
  // NHTSA recognises 2027 INFINITI QX60 and returns zero campaigns. That is a
  // real answer about the MODEL LINE. It may not verify this VIN, and the
  // customer report must not show a green check for it.
  it("does not verify the recall check from a model-level NHTSA zero", () => {
    const r = deriveVerificationReport(
      dOf({ accidentCount: 0, ownerCount: 1, titleStatus: "clean", cleanTitle: true, marketAvg: 61000, warrantyStr: "4 yr" }),
      lOf({
        vin: "5N1AL1F83VC332076", ymm: "2027 INFINITI QX60", mileage: 17, condition: "new",
        recall_status: "clear", open_recall_count: 0,
        recall_payload: {
          source: "nhtsa", checked_at: new Date().toISOString(),
          model_in_catalog: true, open_recall_count: 0, campaigns: [],
        },
      }),
    );
    assertArithmetic(r);
    const recall = r.checks.find((c) => c.key === "recall");
    expect(recall?.status).toBe("pending");
    expect(recall?.finding).toMatch(/Recall verification is unavailable for this VIN/);
    expect(recall?.finding).toMatch(/model-level context, not a check of this VIN/i);
    expect(r.banner.tone).not.toBe("green");
  });

  // The 74 pilot rows: NHTSA answered the ambiguous HTTP 400, the writer left
  // the status NULL, and a zero stayed behind in open_recall_count.
  it("does not verify the recall check from an unanswered NHTSA lookup", () => {
    const r = deriveVerificationReport(
      dOf({ accidentCount: 0, ownerCount: 1, titleStatus: "clean", cleanTitle: true }),
      lOf({
        vin: "5N1AL1F83VC332076", ymm: "2027 INFINITI QX65", condition: "new",
        recall_status: null, open_recall_count: 0,
        recall_payload: { source: "nhtsa", note: "no_nhtsa_record_http_400", checked_at: new Date().toISOString() },
      }),
    );
    const recall = r.checks.find((c) => c.key === "recall");
    expect(recall?.status).toBe("pending");
    expect(recall?.evidence.find((e) => e.label === "Open recalls on this VIN")?.value).toBeNull();
    expect(recall?.evidence.find((e) => e.label === "Model-level campaign context")?.value)
      .toBe("Model not in NHTSA's records");
  });

  it("a branded title is a conclusive actionable finding (needs_attention), not a conflict", () => {
    const r = deriveVerificationReport(
      dOf({ titleStatus: "branded", accidentCount: 0, ownerCount: 1, marketAvg: 40000, warrantyStr: "3 yr" }),
      lOf({ vin: "5N1AL1F83VC332076", ymm: "2022 INFINITI Q50", mileage: 40000, condition: "used", recall_status: "clear", recall_check: VIN_LEVEL_CLEAR }),
    );
    assertArithmetic(r);
    const title = r.checks.find((c) => c.key === "title");
    expect(title?.status).toBe("needs_attention");
    expect(r.needsConfirmationChecks).toBe(0);
    expect(r.banner.tone).toBe("amber");
  });

  it("a do-not-drive recall is high-severity → red banner", () => {
    const r = deriveVerificationReport(
      dOf({ titleStatus: "clean", cleanTitle: true, accidentCount: 0, ownerCount: 1, marketAvg: 40000, warrantyStr: "3 yr" }),
      lOf({ vin: "5N1AL1F83VC332076", ymm: "2022 INFINITI Q50", mileage: 40000, condition: "used", recall_status: "open", open_recall_count: 1, recall_check: { has_open: true, do_not_drive: true, campaigns: [{ campaignNumber: "24V999" }] } }),
    );
    assertArithmetic(r);
    expect(r.checks.find((c) => c.key === "recall")?.status).toBe("needs_attention");
    expect(r.checks.find((c) => c.key === "recall")?.highSeverity).toBe(true);
    expect(r.banner.tone).toBe("red");
  });

  it("recall conflict (clear status but open campaign) is needs_confirmation, never verified or issue", () => {
    const r = deriveVerificationReport(
      dOf({ titleStatus: "clean", cleanTitle: true, accidentCount: 0, ownerCount: 1 }),
      lOf({ vin: "5N1AL1F83VC332076", ymm: "2022 INFINITI Q50", mileage: 40000, condition: "used", recall_status: "clear", recall_check: { has_open: true, campaigns: [{ campaignNumber: "24V100" }] } }),
    );
    const recall = r.checks.find((c) => c.key === "recall");
    expect(recall?.status).toBe("needs_confirmation");
    expect(recall?.finding).toContain("conflicting recall information");
  });

  it("pending checks are never counted as verified, and missing sources are unavailable not pending", () => {
    const r = deriveVerificationReport(
      dOf({ titleStatus: "unknown", cleanTitle: false }),
      lOf({ vin: "5N1AL1F83VC332076", ymm: "2022 INFINITI Q50", condition: "used" }),
    );
    assertArithmetic(r);
    // No history/market/warranty data → those checks are unavailable, not pending.
    expect(r.checks.find((c) => c.key === "market")?.status).toBe("unavailable");
    expect(r.checks.find((c) => c.key === "warranty")?.status).toBe("unavailable");
    // No title record and no title workflow in flight → unavailable. A recall
    // lookup that has not run yet is still expected → pending.
    expect(r.checks.find((c) => c.key === "title")?.status).toBe("unavailable");
    expect(r.checks.find((c) => c.key === "recall")?.status).toBe("pending");
    expect(r.verifiedChecks).toBeGreaterThanOrEqual(0);
  });

  it("a report with nothing completed is a neutral 'not started' state (no all-green fallback)", () => {
    const r = deriveVerificationReport(dOf({}), lOf({ condition: "used" }));
    // Arithmetic still holds; nothing has returned a terminal result.
    assertArithmetic(r);
    expect(r.completedChecks).toBe(0);
    expect(r.verifiedChecks).toBe(0);
    expect(r.banner.tone).toBe("neutral");
    expect(r.banner.heading).toBe("0 of 8 checks verified");
  });

  it("a partial report still renders available checks and marks the rest unavailable", () => {
    const r = deriveVerificationReport(
      dOf({ marketAvg: 40000, belowMarket: 1000 }),
      lOf({ vin: "5N1AL1F83VC332076", ymm: "2022 INFINITI Q50", condition: "used", recall_status: "clear", recall_check: VIN_LEVEL_CLEAR }),
    );
    assertArithmetic(r);
    expect(r.valid).toBe(true);
    expect(r.checks.find((c) => c.key === "vin")?.status).toBe("verified");
    expect(r.checks.find((c) => c.key === "market")?.status).toBe("verified");
    expect(r.checks.find((c) => c.key === "recall")?.status).toBe("verified");
    expect(r.checks.find((c) => c.key === "warranty")?.status).toBe("unavailable");
  });

  it("surfaces MarketCheck-shaped recall campaign fields (nhtsaCampaignNumber / description)", () => {
    const r = deriveVerificationReport(
      dOf({}),
      lOf({
        vin: "5N1AL1F83VC332076", ymm: "2022 INFINITI Q50", condition: "used",
        recall_status: "open_recalls", open_recall_count: 1,
        // marketcheck-recalls persists campaigns under these field names, not
        // campaignNumber / summary — the passport must still read them.
        recall_check: {
          has_open: true,
          campaigns: [{ nhtsaCampaignNumber: "22V-123", description: "Fuel pump may fail", component: "FUEL SYSTEM", remedy: "Replace pump" }],
        },
      }),
    );
    const recall = r.checks.find((c) => c.key === "recall");
    expect(recall?.status).toBe("needs_attention");
    const number = recall?.evidence.find((e) => e.label === "Campaign number")?.value;
    const summary = recall?.evidence.find((e) => e.label === "Summary")?.value;
    expect(number).toBe("22V-123");
    expect(summary).toBe("Fuel pump may fail");
  });

  it("never labels dealer-provided data as independent, and market as AutoLabels-derived", () => {
    const r = deriveVerificationReport(
      dOf({ marketAvg: 40000, warrantyStr: "3 yr", accidentCount: 0 }),
      lOf({ vin: "5N1AL1F83VC332076", ymm: "2022 INFINITI Q50", condition: "used", recall_status: "clear", recall_check: VIN_LEVEL_CLEAR }),
    );
    expect(r.checks.find((c) => c.key === "market")?.provenance).toBe("autolabels_derived");
    expect(r.checks.find((c) => c.key === "history")?.provenance).toBe("independent_history");
    expect(r.checks.find((c) => c.key === "recall")?.provenance).toBe("government");
    expect(r.checks.find((c) => c.key === "vin")?.provenance).toBe("oem");
  });
});

// The count-aware summary the passport hero chip + Verified Vehicle Data subtitle
// render. Zero segments are omitted; a fully-verified vehicle reads "All checks
// verified".
describe("summarizeVerificationExceptions — count-aware hero summary", () => {
  const base = { totalChecks: 8, verifiedChecks: 8, needsAttentionChecks: 0, needsConfirmationChecks: 0, pendingChecks: 0, unavailableChecks: 0 };

  it("all verified → 'All checks verified'", () => {
    expect(summarizeVerificationExceptions(base)).toBe("All checks verified");
  });

  it("1 needs confirmation + 2 pending → omits zero segments, ordered", () => {
    expect(summarizeVerificationExceptions({ ...base, verifiedChecks: 5, needsConfirmationChecks: 1, pendingChecks: 2 }))
      .toBe("1 needs confirmation · 2 pending");
  });

  it("needs attention leads, unavailable trails", () => {
    expect(summarizeVerificationExceptions({ ...base, verifiedChecks: 4, needsAttentionChecks: 1, needsConfirmationChecks: 1, pendingChecks: 1, unavailableChecks: 1 }))
      .toBe("1 needs attention · 1 needs confirmation · 1 pending · 1 not available");
  });
});

// Cross-surface consistency: the passport hero card + Verified Vehicle Data
// module are driven off deriveVerificationReport + the shared label maps, so a
// status can never be re-derived (or upgraded to green) on the passport.
describe("passport surfaces consume the canonical report (cross-surface consistency)", () => {
  const conflictReport = (): VerificationReport => deriveVerificationReport(
    dOf({ accidentCount: 0, ownerCount: 1, titleStatus: "unknown", cleanTitle: false, marketAvg: 41000, belowMarket: 1500, warrantyStr: "4 yr / 60,000 mi", marketCheckedAt: "2026-07-15T00:00:00Z" }),
    lOf({
      vin: "5N1AL1F83VC332076", ymm: "2025 INFINITI QX50", trim: "LUXE AWD", mileage: 12000, condition: "used",
      recall_status: "clear", open_recall_count: 1,
      recall_check: { checked_at: "2026-07-10T00:00:00Z", has_open: true, campaigns: [{ campaignNumber: "25V123" }] },
    }),
  );

  it("recall label is 'Needs confirmation', never 'Verified', when the conflict signature is present", () => {
    const recall = conflictReport().checks.find((c) => c.key === "recall")!;
    expect(recall.status).toBe("needs_confirmation");
    expect(VERIFICATION_STATUS_LABEL[recall.status]).toBe("Needs confirmation");
    expect(VERIFICATION_STATUS_LABEL[recall.status]).not.toBe("Verified");
  });

  it("the hero card renders all 8 canonical checks (same total as the report) with a short label each", () => {
    const r = conflictReport();
    expect(r.totalChecks).toBe(8);
    expect(r.checks).toHaveLength(8);
    r.checks.forEach((c) => expect(VERIFICATION_CHECK_SHORT_LABEL[c.key]).toBeTruthy());
  });

  it("pending and unavailable checks never map to the verified label", () => {
    const r = conflictReport();
    r.checks
      .filter((c) => c.status === "pending" || c.status === "unavailable")
      .forEach((c) => expect(VERIFICATION_STATUS_LABEL[c.status]).not.toBe("Verified"));
    expect(r.checks.find((c) => c.key === "title")?.status).toBe("unavailable");
  });

  it("the hero summary string matches the canonical counts (1 needs confirmation · 2 not available)", () => {
    // Title (no record) and odometer (dealer-reported mileage only).
    expect(summarizeVerificationExceptions(conflictReport())).toBe("1 needs confirmation · 2 not available");
  });
});


// ── Dealer title policy vs VIN-specific attestation ───────────────────
// A franchise store that never retails branded titles is stating a policy
// about its lot, not evidence about this VIN. It is shown as the dealer's
// statement and counts as nothing: the VIN's title check stays unavailable
// until a title record or a VIN-specific dealer review exists.

describe("a dealership's title policy is not a VIN title check", () => {
  const withPolicy = (over: Record<string, unknown> = {}) =>
    dOf({ titleStatus: "unknown", titlePolicyAttested: true, titlePolicyAttestedBy: "Harte INFINITI", ...over });
  const titleOf = (d: PassportData, l: Partial<VehicleListing> = {}) =>
    deriveVerificationReport(d, lOf(l)).checks.find((c) => c.key === "title")!;

  it("a policy alone leaves the VIN's title check unavailable", () => {
    expect(titleOf(withPolicy()).status).toBe("unavailable");
  });

  it("shows the policy separately, named as the dealership's statement", () => {
    const c = titleOf(withPolicy());
    expect(c.finding).toBeNull();
    expect(c.evidence.find((e) => e.label === "Dealer policy")?.value)
      .toBe("Harte INFINITI states it does not retail branded-title vehicles. This is a dealership-wide policy, not a check of this VIN.");
  });

  it("is never counted as attested or verified", () => {
    const r = deriveVerificationReport(withPolicy(), lOf({}));
    expect(r.dealerAttestedChecks).toBe(0);
    expect(r.checks.filter((c) => c.status === "verified").map((c) => c.key)).not.toContain("title");
    expect(r.dealerSourceUsed).toBe(false);
  });

  it("NEVER buries a reported brand", () => {
    expect(titleOf(withPolicy({ titleStatus: "branded" })).status).toBe("needs_attention");
    expect(titleOf(withPolicy(), { mc_attributes: { title_brand: "Salvage" } } as Partial<VehicleListing>).status).toBe("needs_attention");
  });

  it("an independent clean record verifies; the policy does not change that", () => {
    expect(titleOf(withPolicy(), { mc_attributes: { carfax_clean_title: true } } as Partial<VehicleListing>).status).toBe("verified");
  });

  it("no title record and no policy is unavailable, never 'clean'", () => {
    const c = titleOf(dOf({ titleStatus: "unknown" }));
    expect(c.status).toBe("unavailable");
    expect(c.finding).toBeNull();
  });
});

const NMVTIS_REVIEW = { status: "clean", verified_at: "2026-10-20T15:00:00.000Z", verified_by: null, source: "nmvtis", report_generated_at: "2026-10-20T14:58:00.000Z", report_expires_at: null, brand_note: null };

describe("title evidence: dealer VIN review vs independent record", () => {
  const titleOf = (l: Partial<VehicleListing>, d: Partial<PassportData> = {}) =>
    deriveVerificationReport(dOf(d), lOf({ vin: "5N1AL1F83VC332076", ymm: "2025 INFINITI QX50", ...l } as Partial<VehicleListing>)).checks.find((c) => c.key === "title")!;

  it("a VIN-specific dealer review of the title record is dealer attested, with its source and date", () => {
    const c = titleOf({ title_verification: NMVTIS_REVIEW } as Partial<VehicleListing>, { titlePolicyAttestedBy: "Harte INFINITI" });
    expect(c.status).toBe("dealer_attested");
    expect(c.family).toBe("dealer");
    expect(c.finding).toMatch(/reviewed the NMVTIS title record for this VIN on Oct 20, 2026/);
    expect(c.finding).toMatch(/not an independent title-history report/);
    expect(c.evidence.find((e) => e.label === "Note")?.value).toMatch(/NMVTIS title data may be incomplete/);
  });

  it("a verified independent title record is verified", () => {
    expect(titleOf({ mc_attributes: { carfax_clean_title: true } } as Partial<VehicleListing>).status).toBe("verified");
  });

  it("a confirmed title brand needs attention", () => {
    const c = titleOf({ mc_attributes: { carfax_clean_title: false, title_brand: "Flood" } } as Partial<VehicleListing>);
    expect(c.status).toBe("needs_attention");
    expect(c.evidence.find((e) => e.label === "Independent title record")?.value).toBe("Brand reported: Flood");
  });

  it("contradictory sources surface the brand and say the sources disagree", () => {
    const c = titleOf({ title_verification: NMVTIS_REVIEW, mc_attributes: { title_brand: "Rebuilt" } } as Partial<VehicleListing>);
    expect(c.status).toBe("needs_attention");
    expect(c.finding).toMatch(/Title sources disagree/);
    expect(c.reviewNote).toMatch(/^confirm the title/);
  });

  it("a dealer review that found a brand needs attention", () => {
    expect(titleOf({ title_verification: { ...NMVTIS_REVIEW, status: "branded", brand_note: "Salvage" } } as Partial<VehicleListing>).status).toBe("needs_attention");
  });

  it("missing title history is unavailable", () => {
    expect(titleOf({}).status).toBe("unavailable");
  });

  it("dealer policy conflicting with a reported brand: the brand wins", () => {
    const c = titleOf({ mc_attributes: { carfax_clean_title: false } } as Partial<VehicleListing>, { titlePolicyAttested: true, titlePolicyAttestedBy: "Harte INFINITI" });
    expect(c.status).toBe("needs_attention");
    expect(c.evidence.find((e) => e.label === "Dealer policy")?.value).toMatch(/dealership-wide policy/);
  });
});
