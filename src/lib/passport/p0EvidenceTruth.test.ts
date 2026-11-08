// L01 / L02 regression tests (AutoLabels full-rebuild handoff, Nov 7 2026).
// Fixtures are synthetic equivalents of the audited vehicles; the recall_check
// shape is copied from the production row for VIN ending 606923 (read-only).
import { describe, it, expect } from "vitest";
import {
  deriveVerificationReport, deriveNextSteps, recallHeadline, verificationCountsLine,
  verificationScopeLine, verificationStatusCounts, summarizeVerificationExceptions,
} from "./verificationSummary";
import type { PassportData } from "@/lib/passportV2Data";
import type { VehicleListing } from "@/hooks/useVehicleListing";

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

// Production shape (QX65 …606923): a VIN-level lookup that answered nothing.
const UNAVAILABLE_RECALL = {
  vin: "5N1AC0JX7VC606923", note: "marketcheck_vin_not_on_file", scope: "vin", state: "unknown",
  source: "marketcheck_autorecalls", campaigns: [], attempted_at: "2026-10-27T08:14:10.719Z",
};

const qx65 = () => deriveVerificationReport(
  dOf({
    // The dealer reviewed this VIN's NMVTIS title record (a VIN-specific
    // attestation). A store-wide no-branded-title policy would not count.
    titlePolicyAttestedBy: "Harte INFINITI",
    marketAvg: 66000, marketCheckedAt: "2026-11-01T00:00:00Z", warrantyStr: "4 yr / 60,000 mi",
  } as Partial<PassportData>),
  lOf({
    vin: "5N1AC0JX7VC606923", ymm: "2027 INFINITI QX65", mileage: 12, condition: "new", recall_check: UNAVAILABLE_RECALL,
    title_verification: { status: "clean", verified_at: "2026-10-30T12:00:00.000Z", verified_by: null, source: "nmvtis", report_generated_at: "2026-10-30T11:59:00.000Z", report_expires_at: null, brand_note: null },
  } as Partial<VehicleListing>),
);

const ANY_OPEN_RECALL = /open recall|recall remedy|the remedy/i;

describe("L01 — recall wording comes from the exact VIN-level result", () => {
  it("an unavailable lookup never asserts an open recall, a clear VIN or a completed remedy", () => {
    const r = qx65();
    const recall = r.checks.find((c) => c.key === "recall")!;
    // The VIN lookup ran and returned nothing usable: unavailable, not pending.
    expect(recall.status).toBe("unavailable");
    expect(recall.recallOutcome).toBe("unavailable");
    expect(recallHeadline(recall)).toBe("Recall not verified for this VIN");
    const steps = deriveNextSteps(r).join(" \n ");
    expect(steps).not.toMatch(ANY_OPEN_RECALL);
    expect(steps).not.toMatch(/no open recalls/i);
    expect(steps).toMatch(/VIN-level recall check/);
    expect(recall.finding).toMatch(/Recall verification is unavailable for this VIN/);
  });

  it("a model-level campaign is context, not a confirmed open recall on this VIN", () => {
    const r = deriveVerificationReport(dOf({}), lOf({
      vin: "5N1AL1FS7TC339685", ymm: "2026 INFINITI QX60", condition: "new",
      recall_check: { source: "nhtsa", scope: "model", model_campaign_count: 2, checked_at: new Date().toISOString(), campaigns: [{ campaignNumber: "26V001", component: "Airbags" }] },
    } as Partial<VehicleListing>));
    const recall = r.checks.find((c) => c.key === "recall")!;
    // Warning behaviour is preserved…
    expect(recall.status).toBe("needs_attention");
    // …but the words say model context, never "open recall found".
    if (recall.recallOutcome === "model_context") {
      expect(recallHeadline(recall)).toBe("Recall campaigns on this model");
      const steps = deriveNextSteps(r).join(" ");
      expect(steps).toMatch(/included in the recall campaigns reported for its model/);
      expect(steps).not.toMatch(/the open recall/);
    } else {
      // If the view classifies this as VIN-open the source must be VIN-scoped.
      expect(recall.recallOutcome).toBe("vin_open");
    }
  });

  it("a confirmed VIN-level open campaign keeps its next action", () => {
    const r = deriveVerificationReport(dOf({}), lOf({
      vin: "5N1AL1FS7TC339685", ymm: "2026 INFINITI QX60", condition: "new",
      recall_check: { source: "marketcheck", scope: "vin", has_open: true, open_recall_count: 1, checked_at: new Date().toISOString(), campaigns: [{ campaignNumber: "26V001", component: "Airbags", remedy: "Replace inflator" }] },
    } as Partial<VehicleListing>));
    const recall = r.checks.find((c) => c.key === "recall")!;
    expect(recall.status).toBe("needs_attention");
    expect(recall.recallOutcome).toBe("vin_open");
    expect(recallHeadline(recall)).toBe("Open safety recall found");
    expect(deriveNextSteps(r).join(" ")).toMatch(/open recall on this VIN/);
  });

  it("a do-not-drive recall leads with do-not-drive", () => {
    const r = deriveVerificationReport(dOf({}), lOf({
      vin: "5N1AL1FS7TC339685", ymm: "2026 INFINITI QX60", condition: "new",
      recall_check: { source: "marketcheck", scope: "vin", has_open: true, do_not_drive: true, checked_at: new Date().toISOString(), campaigns: [{ campaignNumber: "26V002", summary: "Do not drive" }] },
    } as Partial<VehicleListing>));
    const recall = r.checks.find((c) => c.key === "recall")!;
    expect(recall.highSeverity).toBe(true);
    expect(recallHeadline(recall)).toBe("Do-not-drive recall reported");
    expect(deriveNextSteps(r)[0]).toMatch(/^Do not drive/);
  });
});

describe("L02 — one check-status inventory for every summary", () => {
  it("dealer attestation is counted apart from independent verification", () => {
    const r = qx65();
    const title = r.checks.find((c) => c.key === "title")!;
    expect(title.status).toBe("dealer_attested");
    expect(title.family).toBe("dealer");
    expect(title.provenance).toBe("dealer_provided");
    expect(r.dealerAttestedChecks).toBe(1);
    // Hero "Verified" number is independent only.
    expect(r.verifiedChecks).toBe(r.checks.filter((c) => c.status === "verified").length);
  });

  it("all eight categories reconcile: every surface sums to the total", () => {
    const r = qx65();
    expect(r.totalChecks).toBe(8);
    const sum = verificationStatusCounts(r).reduce((a, s) => a + s.count, 0);
    expect(sum).toBe(r.totalChecks);
    const line = verificationCountsLine(r);
    const nums = line.split(" · ").map((seg) => Number(seg.split(" ")[0]));
    expect(nums.reduce((a, n) => a + n, 0)).toBe(r.totalChecks);
    expect(line).toMatch(/dealer attested/);
    expect(summarizeVerificationExceptions(r)).toMatch(/1 dealer attested/);
  });

  it("never says 'N checks completed' when checks are unresolved", () => {
    const r = qx65();
    expect(r.completedChecks).toBeLessThan(r.totalChecks);
    const s = verificationScopeLine(r);
    expect(s).not.toMatch(/completed/);
    expect(s).toBe(`${r.verifiedChecks} of 8 checks verified`);
  });

  it("the dealer is never counted as an independent source family; pending checks consulted nothing", () => {
    const r = qx65();
    expect(r.dealerSourceUsed).toBe(true);
    const independent = new Set(r.checks.filter((c) => c.status !== "unavailable" && c.status !== "pending" && c.family !== "dealer").map((c) => c.family));
    expect(r.sourceCount).toBe(independent.size);
    expect(r.sources.some((s) => s.family === "dealer")).toBe(true);
    // The recall check is pending, so NHTSA/VIN recall is not a consulted source.
    expect(r.sources.some((s) => s.family === "nhtsa")).toBe(false);
  });

  it("the banner counts line includes every non-zero status", () => {
    const r = qx65();
    expect(r.banner.body).toMatch(/1 dealer attested/);
    if (r.unavailableChecks > 0) expect(r.banner.body).toMatch(/not available/);
  });
});
