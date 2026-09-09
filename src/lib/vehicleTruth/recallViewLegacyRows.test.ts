import { describe, it, expect } from "vitest";
import { deriveRecallView } from "@/lib/vehicleTruth/recallView";

// The exact shapes sitting on the pilot lot on 2026-09-09, copied from the
// database rather than imagined, because the readers ship before the writer
// migration is applied and must be honest about data nobody has corrected yet.
//
// The 74-row group is a failed NHTSA lookup that was stored as a zero. The
// 53-row group is a model-level campaign count. Neither is a statement about
// a specific VIN, and neither may read as one.
const LEGACY_TODAY = {
  recall_status: null,
  open_recall_count: 0,
  recall_payload: {
    campaigns: [],
    checked_at: "2026-09-08T03:15:18.004Z",
    note: "no_nhtsa_record_http_400",
    source: "nhtsa",
  },
  recall_check: null,
};

// The 53 rows that carry a model-level NHTSA count today.
const LEGACY_OPEN = {
  recall_status: "open_recalls",
  open_recall_count: 10,
  recall_payload: { campaigns: [{ campaign: "21V957000" }], checked_at: "2026-09-09T03:08:03.051Z", source: "nhtsa" },
  recall_check: null,
};

describe("today's un-migrated rows must not read as clean", () => {
  it("a failed NHTSA lookup stored as zero is not VIN-clear", () => {
    const v = deriveRecallView(LEGACY_TODAY as never);
    expect(v.vin.state).not.toBe("VERIFIED_CLEAR");
    expect(v.vin.state).toBe("UNKNOWN");
  });

  it("a model-level count never becomes a VIN verification", () => {
    const v = deriveRecallView(LEGACY_OPEN as never);
    expect(v.vin.state).toBe("UNKNOWN");
  });
});
