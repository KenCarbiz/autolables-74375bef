import { describe, it, expect } from "vitest";
import { derivePassportVerification } from "./verificationSummary";
import type { PassportData } from "@/lib/passportV2Data";
import type { VehicleListing } from "@/hooks/useVehicleListing";

// Minimal PassportData stub — only the fields the derivation reads.
const dOf = (o: Partial<PassportData>): PassportData => ({
  cleanTitle: false, recallClear: false, ownerCount: null, accidentCount: null,
  marketAvg: null, warrantyStr: null, serviceCount: 0, marketCheckedAt: null,
  ...(o as object),
} as PassportData);
const lOf = (o: Partial<VehicleListing>): VehicleListing => ({ ...(o as object) } as VehicleListing);

describe("derivePassportVerification — shared source of truth", () => {
  it("reports the FULL category set with pending visible (not just completed rows)", () => {
    const s = derivePassportVerification(dOf({}), lOf({}));
    expect(s.total).toBe(7);
    expect(s.completed).toBe(0);
    expect(s.pending).toBe(7);
    expect(s.categories).toHaveLength(7);
  });

  it("a clean, fully-checked vehicle completes every category", () => {
    const s = derivePassportVerification(
      dOf({ cleanTitle: true, recallClear: true, ownerCount: 1, accidentCount: 0, marketAvg: 61000, warrantyStr: "4 yr / 60,000 mi", serviceCount: 3 }),
      lOf({ vin: "5N1AL1F83VC332076", recall_status: "clear" }),
    );
    expect(s.completed).toBe(7);
    expect(s.completedPct).toBe(100);
    expect(s.materialPending).toBe(0);
  });

  it("a pending MATERIAL check (title) is surfaced and never all-complete", () => {
    const s = derivePassportVerification(
      dOf({ cleanTitle: false, recallClear: true, marketAvg: 61000, warrantyStr: "4 yr", serviceCount: 2, ownerCount: 1 }),
      lOf({ vin: "ABC", recall_status: "clear" }),
    );
    expect(s.completed).toBeLessThan(s.total);
    expect(s.materialPending).toBe(1);
    expect(s.categories.find((c) => c.key === "title")?.state).toBe("pending");
  });

  it("classifies source types and states distinctly (market = calculated, warranty = dealer_confirmed)", () => {
    const s = derivePassportVerification(
      dOf({ cleanTitle: true, recallClear: true, marketAvg: 61000, warrantyStr: "4 yr", serviceCount: 1, ownerCount: 1 }),
      lOf({ vin: "ABC", recall_status: "clear" }),
    );
    expect(s.categories.find((c) => c.key === "market")?.state).toBe("calculated");
    expect(s.categories.find((c) => c.key === "market")?.sourceType).toBe("autolabels_calculated");
    expect(s.categories.find((c) => c.key === "warranty")?.state).toBe("dealer_confirmed");
    expect(s.categories.find((c) => c.key === "recall")?.sourceType).toBe("government");
    expect(s.verified).toBeGreaterThan(0);
    expect(s.dealerConfirmed).toBeGreaterThan(0);
  });

  it("missing data is pending, never fabricated as verified", () => {
    const s = derivePassportVerification(dOf({ cleanTitle: true }), lOf({ vin: "ABC" }));
    // title + vin complete; the rest pending
    expect(s.categories.find((c) => c.key === "market")?.state).toBe("pending");
    expect(s.categories.find((c) => c.key === "warranty")?.state).toBe("pending");
  });
});
