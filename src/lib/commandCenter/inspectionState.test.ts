import { describe, it, expect } from "vitest";
import { executedVinSet, isExecutedSignoff, k208State } from "./inspectionState";

const signedPass = { id: "a", status: "signed", result: "pass", signed_at: "2026-01-12T10:00:00Z", created_at: "2026-01-12T09:00:00Z" };
const signedFail = { id: "b", status: "signed", result: "fail", signed_at: "2026-02-10T10:00:00Z", created_at: "2026-02-10T09:00:00Z" };
const prefilled = { id: "c", status: "pending", result: null, signed_at: null, created_at: "2026-03-01T09:00:00Z" };

describe("k208State", () => {
  // Screen 1 read newest-by-created_at and screen 3 read newest-signed-by-signed_at,
  // so a pending re-inspection masked the executed K-208 on one screen only.
  it("a pending re-inspection does not mask the signed original", () => {
    expect(k208State({ latestSigned: signedPass, latest: prefilled })).toEqual({
      state: "signed", at: signedPass.signed_at,
    });
  });

  // The defect this module's stated rule did not actually hold: the failure test
  // was asked of the newest row of ANY status, so a signed pass in January, a
  // signed FAILURE in February and a prefilled revision in March resolved to
  // "Ready · Signed Jan 12" and counted as finished over a failed inspection.
  it("a signed failure is the newest word on the car even behind a later prefilled row", () => {
    expect(k208State({ latestSigned: signedFail, latest: prefilled })).toEqual({
      state: "failed", at: signedFail.signed_at,
    });
  });

  it("a signed failure outranks an earlier signed pass", () => {
    expect(k208State({ latestSigned: signedFail, latest: signedFail }).state).toBe("failed");
  });

  it("an unsigned row whose result reads fail is still only prefilled work", () => {
    const draftFail = { id: "d", status: "draft", result: "fail", created_at: "2026-07-12T09:00:00Z" };
    expect(k208State({ latestSigned: null, latest: draftFail }).state).toBe("prefilled");
  });

  it("an existing but unsigned inspection is prefilled", () => {
    expect(k208State({ latestSigned: null, latest: prefilled }).state).toBe("prefilled");
  });

  it("no inspection row at all is not started", () => {
    expect(k208State({ latestSigned: null, latest: null })).toEqual({ state: "not_started", at: null });
  });

  it("treats a signed inspection with no recorded result as executed", () => {
    const legacy = { id: "e", status: "signed", result: null, signed_at: "2026-06-01T00:00:00Z" };
    expect(k208State({ latestSigned: legacy, latest: legacy }).state).toBe("signed");
  });
});

// "Newest signed" must order exactly as the SQL truth (20260726110000):
// signed_at DESC NULLS LAST, then created_at DESC — never
// coalesce(signed_at, created_at), which let an unsigned-timestamp row with a
// late created_at outrank a genuinely signed one.
describe("executedVinSet — signed_at DESC NULLS LAST, then created_at DESC", () => {
  const VIN = "1FTEW1EP0MFA00001";

  it("a null-signed_at row never outranks a row with a real signed_at, whatever its created_at", () => {
    const rows = [
      { vin: VIN, status: "signed", result: "fail", signed_at: null, created_at: "2026-07-20T00:00:00Z" },
      { vin: VIN, status: "signed", result: "pass", signed_at: "2026-06-01T00:00:00Z", created_at: "2026-05-01T00:00:00Z" },
    ];
    expect(executedVinSet(rows).has(VIN)).toBe(true);
    // Same rows, flipped results: the signed_at row (a fail) still wins.
    const flipped = [
      { vin: VIN, status: "signed", result: "pass", signed_at: null, created_at: "2026-07-20T00:00:00Z" },
      { vin: VIN, status: "signed", result: "fail", signed_at: "2026-06-01T00:00:00Z", created_at: "2026-05-01T00:00:00Z" },
    ];
    expect(executedVinSet(flipped).has(VIN)).toBe(false);
  });

  it("ties on signed_at break by created_at DESC, in any input order", () => {
    const older = { vin: VIN, status: "signed", result: "pass", signed_at: "2026-07-01T10:00:00Z", created_at: "2026-07-01T09:00:00Z" };
    const newer = { vin: VIN, status: "signed", result: "fail", signed_at: "2026-07-01T10:00:00Z", created_at: "2026-07-01T09:30:00Z" };
    expect(executedVinSet([older, newer]).has(VIN)).toBe(false);
    expect(executedVinSet([newer, older]).has(VIN)).toBe(false);
  });

  it("two null signed_at rows fall back to created_at DESC", () => {
    const rows = [
      { vin: VIN, status: "signed", result: "pass", signed_at: null, created_at: "2026-07-01T09:00:00Z" },
      { vin: VIN, status: "signed", result: "fail", signed_at: null, created_at: "2026-07-02T09:00:00Z" },
    ];
    expect(executedVinSet(rows).has(VIN)).toBe(false);
  });

  it("a newer signed pass over an older signed fail is executed", () => {
    const rows = [
      { vin: VIN, status: "signed", result: "fail", signed_at: "2026-06-01T00:00:00Z", created_at: "2026-06-01T00:00:00Z" },
      { vin: VIN, status: "signed", result: "pass", signed_at: "2026-07-01T00:00:00Z", created_at: "2026-07-01T00:00:00Z" },
    ];
    expect(executedVinSet(rows).has(VIN)).toBe(true);
  });
});

// V6: the PDI column used to spell this `result === 'pass'` and the K-208
// `result !== 'fail'`, so a legacy signed PDI with a NULL result was honoured on
// one screen and silently dropped on the other. One predicate, both callers.
describe("isExecutedSignoff", () => {
  it("accepts a signed row with no recorded result — the column is nullable", () => {
    expect(isExecutedSignoff({ status: "signed", result: null })).toBe(true);
    expect(isExecutedSignoff({ status: "signed", result: "pass" })).toBe(true);
  });

  it("rejects a signed failure and anything unsigned", () => {
    expect(isExecutedSignoff({ status: "signed", result: "fail" })).toBe(false);
    expect(isExecutedSignoff({ status: "pending", result: "pass" })).toBe(false);
    expect(isExecutedSignoff(null)).toBe(false);
  });
});
