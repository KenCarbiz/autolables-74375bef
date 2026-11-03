// @vitest-environment node
import { describe, expect, it } from "vitest";
import policy from "./rtgip2-refusal-policy.v1.json";
import {
  PERMANENT_REFUSAL_REASONS,
  PERMANENT_REFUSAL_STATUSES,
  refusalClass,
  refusalReason,
} from "./delivery.ts";

describe("rtgip/2-refusal-policy/1", () => {
  it("the code lists are the policy file's lists", () => {
    expect([...PERMANENT_REFUSAL_STATUSES].sort()).toEqual([...policy.permanent_statuses].sort());
    expect([...PERMANENT_REFUSAL_REASONS].sort()).toEqual([...policy.permanent_reasons].sort());
  });
  it("permanent refusals are permanent", () => {
    for (const r of policy.permanent_reasons) {
      expect(refusalClass(refusalReason(403, r))).toBe("permanent");
      expect(refusalClass(refusalReason(401, r))).toBe("permanent");
    }
    for (const s of policy.permanent_statuses)
      expect(refusalClass(refusalReason(s, "x"))).toBe("permanent");
  });
  it("pending mappings, unknown 4xx reasons, 5xx and transport stay retryable", () => {
    for (const r of policy.temporary_examples)
      expect(refusalClass(refusalReason(403, r))).toBe("retryable");
    expect(refusalClass(refusalReason(401, "bad_signature"))).toBe("retryable");
    expect(refusalClass(refusalReason(503, "admission_not_confirmed"))).toBe("retryable");
    expect(refusalClass("transport:ECONNRESET")).toBe("retryable");
    expect(refusalClass("refused:403")).toBe("retryable");
  });
});
