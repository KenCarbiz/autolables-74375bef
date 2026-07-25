import { describe, it, expect } from "vitest";
import { inspectionSubmitOutcome } from "./inspectionSubmission";

const NOW = new Date("2026-07-25T12:00:00Z");
const live = { status: "pending", expires_at: "2027-01-01T00:00:00Z" };
const name = "Ray Technician";

describe("inspectionSubmitOutcome — mirrors submit_safety_inspection (S1)", () => {
  it("accepts the permanent 'vehicle' hub token and does NOT consume it", () => {
    const o = inspectionSubmitOutcome({ ...live, department: "vehicle" }, [], name, NOW);
    expect(o).toEqual({ ok: true, consumesToken: false });
  });

  it("accepts the legacy single-use 'service' token and consumes it", () => {
    const o = inspectionSubmitOutcome({ ...live, department: "service" }, [], name, NOW);
    expect(o).toEqual({ ok: true, consumesToken: true });
  });

  it("rejects other departments as wrong_department", () => {
    expect(inspectionSubmitOutcome({ ...live, department: "detail" }, [], name, NOW).reason).toBe("wrong_department");
  });

  it("refuses a second submission once an executed (signed non-fail) K-208 exists", () => {
    const executed = [{ status: "signed", result: "pass" }];
    const o = inspectionSubmitOutcome({ ...live, department: "vehicle" }, executed, name, NOW);
    expect(o.ok).toBe(false);
    expect(o.reason).toBe("already_completed");
  });

  it("a legacy executed row with a NULL result also trips the guard", () => {
    const o = inspectionSubmitOutcome({ ...live, department: "vehicle" }, [{ status: "signed", result: null }], name, NOW);
    expect(o.reason).toBe("already_completed");
  });

  it("a signed FAIL does not trip the guard — re-inspection is the intended path", () => {
    const o = inspectionSubmitOutcome({ ...live, department: "vehicle" }, [{ status: "signed", result: "fail" }], name, NOW);
    expect(o.ok).toBe(true);
  });

  it("a pending ingest draft does not trip the guard", () => {
    const o = inspectionSubmitOutcome({ ...live, department: "vehicle" }, [{ status: "pending", result: null }], name, NOW);
    expect(o.ok).toBe(true);
  });

  it("token guards: missing, consumed, expired, unnamed inspector", () => {
    expect(inspectionSubmitOutcome(null, [], name, NOW).reason).toBe("not_found");
    expect(inspectionSubmitOutcome({ ...live, department: "vehicle", status: "used" }, [], name, NOW).reason).toBe("used_or_revoked");
    expect(inspectionSubmitOutcome({ department: "vehicle", status: "pending", expires_at: "2026-01-01T00:00:00Z" }, [], name, NOW).reason).toBe("expired");
    expect(inspectionSubmitOutcome({ ...live, department: "vehicle" }, [], "  ", NOW).reason).toBe("inspector_name_required");
  });
});
