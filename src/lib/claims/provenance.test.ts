import { describe, it, expect } from "vitest";
import { rollupVerification, type VerificationClaim } from "./provenance";

// The screenshot's real data: 8 checks, Title & Brand PENDING (material), 7 verified.
const screenshotClaims: VerificationClaim[] = [
  { key: "vin", label: "VIN Verification", status: "VERIFIED", outcome: "Decoded; year/make/model matched", evidence: "oem", sourceLabel: "OEM/VIN decode", material: true, checkedAt: "2026-06-26" },
  { key: "history", label: "Vehicle History", status: "VERIFIED", outcome: "No reported accidents", evidence: "commercial_history", sourceLabel: "Vehicle history", material: true, checkedAt: "2026-06-26" },
  { key: "recall", label: "Recall Verification", status: "VERIFIED", outcome: "Zero open recalls as of Jun 26", evidence: "government", sourceLabel: "NHTSA", material: true, checkedAt: "2026-06-26" },
  { key: "title", label: "Title & Brand Check", status: "PENDING", outcome: "Title status still being confirmed", evidence: "commercial_history", sourceLabel: "Vehicle history", material: true, checkedAt: null },
  { key: "odometer", label: "Odometer Verification", status: "VERIFIED", outcome: "17 miles; no inconsistency detected", evidence: "commercial_history", sourceLabel: "Vehicle history", material: true, checkedAt: "2026-06-26" },
  { key: "market", label: "Market Data Verification", status: "VERIFIED", outcome: "Compared with 61 similar within 250 mi", evidence: "autolabels_calculated", sourceLabel: "Live market data", material: false, checkedAt: "2026-06-26" },
  { key: "warranty", label: "Warranty Check", status: "VERIFIED", outcome: "Manufacturer terms found; start date not confirmed", evidence: "oem", sourceLabel: "OEM warranty", material: false, checkedAt: "2026-06-26" },
  { key: "equipment", label: "Media & Equipment Check", status: "VERIFIED", outcome: "VIN-derived + dealer-reported", evidence: "oem", sourceLabel: "OEM/VIN decode", material: false, checkedAt: "2026-06-26" },
];

describe("rollupVerification — claim governance", () => {
  it("a pending material title check never rolls up to an all-green 'verified'", () => {
    const r = rollupVerification(screenshotClaims);
    expect(r.overall).toBe("in_progress");
    expect(r.materialPending).toBe(true);
    expect(r.statusHeadline).toBe("Verification in progress");
  });

  it("reports honest completion, not a coverage fraction", () => {
    const r = rollupVerification(screenshotClaims);
    expect(r.applicableChecks).toBe(8);
    expect(r.completedChecks).toBe(7);
    expect(r.verified).toBe(7);
    expect(r.pending).toBe(1);
    expect(r.completenessPct).toBe(88); // 7/8 = 87.5 -> 88
  });

  it("counts distinct sources, not per-row", () => {
    const r = rollupVerification(screenshotClaims);
    // OEM/VIN decode, Vehicle history, NHTSA, Live market data, OEM warranty = 5
    expect(r.sourcesConsulted).toBe(5);
  });

  it("subcopy names the pending material check", () => {
    const r = rollupVerification(screenshotClaims);
    expect(r.subcopy).toContain("Title & Brand Check");
    expect(r.subcopy).toContain("5 data sources");
    expect(r.subcopy).toContain("7 of 8 checks");
  });

  it("all material checks verified => overall verified", () => {
    const clean = screenshotClaims.map((c) => (c.key === "title" ? { ...c, status: "VERIFIED" as const, outcome: "Clean title, no brands" } : c));
    const r = rollupVerification(clean);
    expect(r.overall).toBe("verified");
    expect(r.completenessPct).toBe(100);
  });

  it("a conflict on any check => attention, never verified", () => {
    const conflicted = screenshotClaims.map((c) => (c.key === "odometer" ? { ...c, status: "CONFLICT_DETECTED" as const, outcome: "Mileage inconsistency detected" } : c));
    const r = rollupVerification(conflicted);
    expect(r.overall).toBe("attention");
    expect(r.subcopy.toLowerCase()).toContain("conflicting");
  });

  it("NOT_APPLICABLE checks are excluded from totals; missing data is never counted verified", () => {
    const withNa = [...screenshotClaims, { key: "cpo", label: "CPO Inspection", status: "NOT_APPLICABLE" as const, outcome: "Not a CPO vehicle", evidence: "dealer_reported" as const, sourceLabel: "Dealer", material: false, checkedAt: null }];
    const r = rollupVerification(withNa);
    expect(r.applicableChecks).toBe(8);
    expect(r.notApplicable).toBe(1);
    // UNAVAILABLE must not inflate verified
    const withUnavail = screenshotClaims.map((c) => (c.key === "warranty" ? { ...c, status: "UNAVAILABLE" as const, outcome: "No warranty record found" } : c));
    const r2 = rollupVerification(withUnavail);
    expect(r2.verified).toBe(6);
    expect(r2.overall).not.toBe("verified");
  });

  it("tracks freshest per-check timestamp for 'last refreshed'", () => {
    const r = rollupVerification(screenshotClaims);
    expect(r.lastRefreshedAt).toBe("2026-06-26");
  });
});
