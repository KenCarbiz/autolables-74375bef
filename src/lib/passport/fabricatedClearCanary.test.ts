import { describe, it, expect } from "vitest";
import { deriveRecallView } from "@/lib/vehicleTruth/recallView";
import { vehicleInsights } from "@/lib/vehicleInsights";

// The three published customer pages whose "Verified, no open safety recalls"
// claim was manufactured from an HTTP 404. Copied from the live database on
// 2026-09-09, not invented: MarketCheck answered 404, marketcheck-recalls
// turned that into an empty recall array, and the row was stamped clear.
//
// The third has a NULL ymm, so no recall query of any kind has ever been made
// about it. Its clean claim came from nothing at all.
const FABRICATED = [
  {
    vin: "5N1AL1F81VC331105", slug: "2027-infiniti-qx60-331105", ymm: "2027 INFINITI QX60",
    recall_status: "clear", open_recall_count: 0,
    recall_payload: { rawProvider: "marketcheck_autorecalls", recalls: [], recallStatus: "clear", checkedAt: "2026-06-29T15:43:25.467Z", openRecallCount: 0 },
    recall_check: { campaigns: [], checked_at: "2026-06-29T15:43:25.467Z", do_not_drive: false, has_open: false },
  },
  {
    vin: "5N1AL1F94VC330815", slug: "2027-infiniti-qx60-330815", ymm: "2027 INFINITI QX60",
    recall_status: "clear", open_recall_count: 0,
    recall_payload: { rawProvider: "marketcheck_autorecalls", recalls: [], recallStatus: "clear", checkedAt: "2026-06-29T15:43:31.933Z", openRecallCount: 0 },
    recall_check: { campaigns: [], checked_at: "2026-06-29T15:43:31.933Z", do_not_drive: false, has_open: false },
  },
  {
    vin: "JN8AZ3CC5T9624253", slug: "JN8AZ3CC5T9624253", ymm: null,
    recall_status: "clear", open_recall_count: 0,
    recall_payload: { rawProvider: "marketcheck_autorecalls", recalls: [], recallStatus: "clear", checkedAt: "2026-09-04T16:43:52.593Z", openRecallCount: 0 },
    recall_check: { campaigns: [], checked_at: "2026-09-04T16:43:52.593Z", do_not_drive: false, has_open: false },
  },
];

describe("a 404 never becomes a customer-facing recall clearance", () => {
  for (const row of FABRICATED) {
    it(`${row.vin} is not VIN-clear`, () => {
      const v = deriveRecallView(row as never);
      expect(v.vin.state).not.toBe("VERIFIED_CLEAR");
      expect(v.vin.clearClaimAllowed).toBe(false);
    });

    it(`${row.vin} carries no "no open recalls" strength badge`, () => {
      const badges = vehicleInsights(row as never);
      expect(badges.map((b) => b.id)).not.toContain("no-recalls");
      expect(JSON.stringify(badges).toLowerCase()).not.toContain("no open recall");
    });
  }
});

describe("the clearance path cannot be reached without declared provenance", () => {
  const legacyBase = {
    vin: "TESTVIN0000000001",
    recall_status: "clear",
    open_recall_count: 0,
    recall_payload: null,
  };

  it("a legacy row using the newer word for clear is still not a clearance", () => {
    const v = deriveRecallView({
      ...legacyBase,
      recall_check: {
        // No `scope` key: this is the shape only a pre-Gate-2.5 writer produces.
        source: "marketcheck",
        vin_state: "verified_clear",
        checked_at: new Date().toISOString(),
        campaigns: [],
        open_count: 0,
      },
    } as never);
    expect(v.vin.state).toBe("UNKNOWN");
    expect(v.vin.clearClaimAllowed).toBe(false);
  });

  it("an open campaign on a legacy row is still honoured, because withdrawing a warning is unsafe", () => {
    const v = deriveRecallView({
      ...legacyBase,
      recall_status: "open_recalls",
      open_recall_count: 2,
      recall_check: {
        source: "marketcheck",
        checked_at: new Date().toISOString(),
        campaigns: [{ campaign: "26V455000", status: "open" }, { campaign: "25V111000", status: "open" }],
        open_count: 2,
      },
    } as never);
    expect(v.vin.state).toBe("OPEN");
  });

  it("a declared VIN-scope clearance from the new writer is honoured", () => {
    const v = deriveRecallView({
      ...legacyBase,
      recall_check: {
        scope: "vin",
        source: "marketcheck_autorecalls",
        vin_state: "verified_clear",
        checked_at: new Date().toISOString(),
        campaigns: [],
        open_count: 0,
      },
    } as never);
    expect(v.vin.state).toBe("VERIFIED_CLEAR");
    expect(v.vin.clearClaimAllowed).toBe(true);
  });
});
