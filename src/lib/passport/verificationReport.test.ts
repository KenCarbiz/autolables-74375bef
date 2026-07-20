import { describe, it, expect } from "vitest";
import {
  deriveVerificationReport, summarizeVerificationExceptions,
  VERIFICATION_STATUS_LABEL, VERIFICATION_CHECK_SHORT_LABEL,
  type VerificationReport,
} from "./verificationSummary";
import type { PassportData } from "@/lib/passportV2Data";
import type { VehicleListing } from "@/hooks/useVehicleListing";

// Minimal PassportData stub — only the fields the report derivation reads.
const dOf = (o: Partial<PassportData>): PassportData => ({
  accidentCount: null, ownerCount: null, cleanTitle: false, titleStatus: "unknown",
  marketAvg: null, belowMarket: null, warrantyStr: null, warrantyExpired: false,
  marketCheckedAt: null,
  ...(o as object),
} as PassportData);
const lOf = (o: Partial<VehicleListing>): VehicleListing => ({ ...(o as object) } as VehicleListing);

// Every report must satisfy the two arithmetic invariants, always.
const assertArithmetic = (r: VerificationReport) => {
  expect(r.totalChecks).toBe(
    r.verifiedChecks + r.needsAttentionChecks + r.needsConfirmationChecks + r.pendingChecks + r.unavailableChecks,
  );
  expect(r.completedChecks).toBe(r.verifiedChecks + r.needsAttentionChecks + r.needsConfirmationChecks);
};

describe("deriveVerificationReport — canonical customer summary", () => {
  it("the QX50 real-data scenario yields 8/6/1(conf)/1(pending)/7 complete/5 sources", () => {
    const r = deriveVerificationReport(
      dOf({
        accidentCount: 0, ownerCount: 1, titleStatus: "unknown", cleanTitle: false,
        marketAvg: 41000, belowMarket: 1500, warrantyStr: "4 yr / 60,000 mi", warrantyExpired: false,
        marketCheckedAt: "2026-07-15T00:00:00Z",
      }),
      lOf({
        vin: "5N1AL1F83VC332076", ymm: "2025 INFINITI QX50", trim: "LUXE AWD",
        mileage: 12000, condition: "used",
        recall_status: "clear", open_recall_count: 1,
        recall_check: { checked_at: "2026-07-10T00:00:00Z", has_open: true, campaigns: [{ campaignNumber: "25V123", component: "Backup camera", summary: "Rearview image may fail.", remedy: "Dealer will update software." }] },
      }),
    );
    assertArithmetic(r);
    expect(r.totalChecks).toBe(8);
    expect(r.verifiedChecks).toBe(6);
    expect(r.needsConfirmationChecks).toBe(1);
    expect(r.pendingChecks).toBe(1);
    expect(r.needsAttentionChecks).toBe(0);
    expect(r.unavailableChecks).toBe(0);
    expect(r.completedChecks).toBe(7);
    expect(r.sourceCount).toBe(5);
    expect(r.valid).toBe(true);

    expect(r.checks.find((c) => c.key === "recall")?.status).toBe("needs_confirmation");
    expect(r.checks.find((c) => c.key === "title")?.status).toBe("pending");

    expect(r.banner.tone).toBe("amber");
    expect(r.banner.heading).toBe("Review one item before purchase");
    expect(r.banner.body).toContain("6 checks verified · 1 needs confirmation · 1 pending");
    expect(r.banner.body).toContain("Confirm the recall status with the dealer");
    expect(r.banner.body).toContain("the title and brand check is still pending");
  });

  it("sourceCount counts unique FAMILIES, not checks (four history checks = one family)", () => {
    const r = deriveVerificationReport(
      dOf({ accidentCount: 0, ownerCount: 1, titleStatus: "clean", cleanTitle: true }),
      lOf({ vin: "5N1AL1F83VC332076", ymm: "2025 INFINITI QX50", mileage: 12000, condition: "used" }),
    );
    // vin + 4 vehicle-history checks all returned data, but only 2 families.
    const consulted = new Set(r.checks.filter((c) => c.status !== "unavailable").map((c) => c.family));
    expect(consulted.has("oem_vin")).toBe(true);
    expect(consulted.has("vehicle_history")).toBe(true);
    expect(r.sourceCount).toBe(consulted.size);
    expect(r.sourceCount).toBeLessThan(r.completedChecks);
  });

  it("an all-verified vehicle shows the green completed banner", () => {
    const r = deriveVerificationReport(
      dOf({ accidentCount: 0, ownerCount: 1, titleStatus: "clean", cleanTitle: true, marketAvg: 61000, belowMarket: 3000, warrantyStr: "4 yr / 60,000 mi" }),
      lOf({ vin: "5N1AL1F83VC332076", ymm: "2027 INFINITI QX60", mileage: 17, condition: "new", recall_status: "clear", open_recall_count: 0, recall_check: { has_open: false } }),
    );
    assertArithmetic(r);
    expect(r.verifiedChecks).toBe(8);
    expect(r.needsConfirmationChecks + r.needsAttentionChecks + r.pendingChecks).toBe(0);
    expect(r.banner.tone).toBe("green");
    expect(r.banner.heading).toBe("Verification checks completed");
  });

  it("a branded title is a conclusive actionable finding (needs_attention), not a conflict", () => {
    const r = deriveVerificationReport(
      dOf({ titleStatus: "branded", accidentCount: 0, ownerCount: 1, marketAvg: 40000, warrantyStr: "3 yr" }),
      lOf({ vin: "5N1AL1F83VC332076", ymm: "2022 Car", mileage: 40000, condition: "used", recall_status: "clear", recall_check: { has_open: false } }),
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
      lOf({ vin: "5N1AL1F83VC332076", ymm: "2022 Car", mileage: 40000, condition: "used", recall_status: "open", open_recall_count: 1, recall_check: { has_open: true, do_not_drive: true, campaigns: [{ campaignNumber: "24V999" }] } }),
    );
    assertArithmetic(r);
    expect(r.checks.find((c) => c.key === "recall")?.status).toBe("needs_attention");
    expect(r.checks.find((c) => c.key === "recall")?.highSeverity).toBe(true);
    expect(r.banner.tone).toBe("red");
  });

  it("recall conflict (clear status but open campaign) is needs_confirmation, never verified or issue", () => {
    const r = deriveVerificationReport(
      dOf({ titleStatus: "clean", cleanTitle: true, accidentCount: 0, ownerCount: 1 }),
      lOf({ vin: "5N1AL1F83VC332076", ymm: "2022 Car", mileage: 40000, condition: "used", recall_status: "clear", recall_check: { has_open: true, campaigns: [{ campaignNumber: "24V100" }] } }),
    );
    const recall = r.checks.find((c) => c.key === "recall");
    expect(recall?.status).toBe("needs_confirmation");
    expect(recall?.finding).toContain("conflicting recall information");
  });

  it("pending checks are never counted as verified, and missing sources are unavailable not pending", () => {
    const r = deriveVerificationReport(
      dOf({ titleStatus: "unknown", cleanTitle: false }),
      lOf({ vin: "5N1AL1F83VC332076", ymm: "2022 Car", condition: "used" }),
    );
    assertArithmetic(r);
    // No history/market/warranty data → those checks are unavailable, not pending.
    expect(r.checks.find((c) => c.key === "market")?.status).toBe("unavailable");
    expect(r.checks.find((c) => c.key === "warranty")?.status).toBe("unavailable");
    // Title and recall have no data → pending (material checks awaiting a result).
    expect(r.checks.find((c) => c.key === "title")?.status).toBe("pending");
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
    expect(r.banner.heading).toBe("Verification has not started");
  });

  it("a partial report still renders available checks and marks the rest unavailable", () => {
    const r = deriveVerificationReport(
      dOf({ marketAvg: 40000, belowMarket: 1000 }),
      lOf({ vin: "5N1AL1F83VC332076", ymm: "2022 Car", condition: "used", recall_status: "clear", recall_check: { has_open: false } }),
    );
    assertArithmetic(r);
    expect(r.valid).toBe(true);
    expect(r.checks.find((c) => c.key === "vin")?.status).toBe("verified");
    expect(r.checks.find((c) => c.key === "market")?.status).toBe("verified");
    expect(r.checks.find((c) => c.key === "recall")?.status).toBe("verified");
    expect(r.checks.find((c) => c.key === "warranty")?.status).toBe("unavailable");
  });

  it("never labels dealer-provided data as independent, and market as AutoLabels-derived", () => {
    const r = deriveVerificationReport(
      dOf({ marketAvg: 40000, warrantyStr: "3 yr", accidentCount: 0 }),
      lOf({ vin: "5N1AL1F83VC332076", ymm: "2022 Car", condition: "used", recall_status: "clear", recall_check: { has_open: false } }),
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
    expect(r.checks.find((c) => c.key === "title")?.status).toBe("pending");
  });

  it("the hero summary string matches the canonical counts (1 needs confirmation · 1 pending)", () => {
    expect(summarizeVerificationExceptions(conflictReport())).toBe("1 needs confirmation · 1 pending");
  });
});
