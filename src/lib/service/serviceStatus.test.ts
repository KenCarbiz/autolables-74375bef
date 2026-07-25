import { describe, it, expect } from "vitest";
import { deriveServiceStatus } from "./serviceStatus";

// deriveServiceStatus is fed the newest SIGNED safety_inspections row — both
// callers (ServiceQueue, ServiceStatusBanner) query .eq("status","signed").
// These tests call it exactly the way those consumers do, and pin the row to
// isExecutedSignoff semantics: signed AND result != 'fail' is executed; a
// nullable legacy result counts; a signed fail blocks.

const veh = { recall_status: null, status: "published" };
const grComplete = { items: [{ status: "complete" }], get_ready_complete_date: "2026-07-01", status: "complete" };

describe("deriveServiceStatus — one K-208 truth (S8)", () => {
  it("a signed FAIL is blocking, never executed", () => {
    const s = deriveServiceStatus(veh, grComplete, { result: "fail", licensee_certified_at: null }, false);
    expect(s.k208State).toBe("blocked");
    expect(s.blocked).toBe(true);
    expect(s.cleared).toBe(false);
    expect(s.grState).toBe("failed");
    expect(s.bannerKey).toBe("failed");
  });

  it("a legacy signed row with a NULL result counts as executed work awaiting certification", () => {
    // The column is nullable (20260629013549:12); isExecutedSignoff honours it.
    // Spelling this `result === 'pass'` dropped legacy rows to "waiting".
    const s = deriveServiceStatus(veh, grComplete, { result: null, licensee_certified_at: null }, false);
    expect(s.k208State).toBe("ready");
  });

  it("a signed pass without certification is ready to execute", () => {
    const s = deriveServiceStatus(veh, grComplete, { result: "pass", licensee_certified_at: null }, false);
    expect(s.k208State).toBe("ready");
    expect(s.bannerKey).toBe("ready");
  });

  it("a certified pass is executed and clears when get-ready is complete", () => {
    const s = deriveServiceStatus(veh, grComplete, { result: "pass", licensee_certified_at: "2026-07-02" }, false);
    expect(s.k208State).toBe("executed");
    expect(s.cleared).toBe(true);
    expect(s.bannerKey).toBe("cleared");
  });

  it("a certified FAIL still blocks — certification cannot launder a failed inspection", () => {
    const s = deriveServiceStatus(veh, grComplete, { result: "fail", licensee_certified_at: "2026-07-02" }, false);
    expect(s.k208State).toBe("blocked");
    expect(s.cleared).toBe(false);
  });

  it("no signed inspection at all is waiting", () => {
    const s = deriveServiceStatus(veh, null, null, false);
    expect(s.k208State).toBe("waiting");
    expect(s.bannerKey).toBe("not_started");
  });

  it("a do-not-drive recall blocks regardless of inspection", () => {
    const s = deriveServiceStatus({ ...veh, recall_status: "do_not_drive" }, grComplete, { result: "pass" }, false);
    expect(s.k208State).toBe("blocked");
    expect(s.blocked).toBe(true);
  });

  it("a pending additional-work request surfaces as awaiting approval", () => {
    const s = deriveServiceStatus(veh, grComplete, { result: "pass" }, true);
    expect(s.awaiting).toBe(true);
    expect(s.bannerKey).toBe("awaiting");
    expect(s.cleared).toBe(false);
  });
});
