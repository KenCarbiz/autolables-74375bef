import { describe, it, expect } from "vitest";
import { k208State } from "./inspectionState";

const signedPass = { id: "a", status: "signed", result: "pass", signed_at: "2026-07-01T10:00:00Z", created_at: "2026-07-01T09:00:00Z" };
const signedFail = { id: "b", status: "signed", result: "fail", signed_at: "2026-07-10T10:00:00Z", created_at: "2026-07-10T09:00:00Z" };
const pendingRevision = { id: "c", status: "draft", result: null, signed_at: null, created_at: "2026-07-12T09:00:00Z" };

describe("k208State", () => {
  // Screen 1 read newest-by-created_at and screen 3 read newest-signed-by-signed_at,
  // so a pending re-inspection masked the executed K-208 on one screen only.
  it("a pending re-inspection does not mask the signed original", () => {
    expect(k208State({ signed: signedPass, latest: pendingRevision })).toEqual({
      state: "signed", at: signedPass.signed_at,
    });
  });

  it("a signed failure is the newest word on the car and blocks it", () => {
    expect(k208State({ signed: signedPass, latest: signedFail }).state).toBe("failed");
  });

  it("an unsigned row whose result reads fail is still only prefilled work", () => {
    const draftFail = { id: "d", status: "draft", result: "fail", created_at: "2026-07-12T09:00:00Z" };
    expect(k208State({ signed: null, latest: draftFail }).state).toBe("prefilled");
  });

  it("an existing but unsigned inspection is prefilled", () => {
    expect(k208State({ signed: null, latest: pendingRevision }).state).toBe("prefilled");
  });

  it("no inspection row at all is not started", () => {
    expect(k208State({ signed: null, latest: null })).toEqual({ state: "not_started", at: null });
  });

  it("treats a signed inspection with no recorded result as executed", () => {
    const legacy = { id: "e", status: "signed", result: null, signed_at: "2026-06-01T00:00:00Z" };
    expect(k208State({ signed: legacy, latest: legacy }).state).toBe("signed");
  });
});
