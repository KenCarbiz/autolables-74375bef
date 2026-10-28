import { describe, it, expect } from "vitest";
import { canApply, diffFields, initialReviewApply, isUnchanged, reviewApplyReducer, type ImpactSnapshot } from "./reviewApply";

type Fee = { enabled: boolean; amount: number };
const impact = (over: Partial<ImpactSnapshot> = {}): ImpactSnapshot => ({
  computedAt: "2026-10-28T00:00:00Z",
  version: 12,
  counts: { eligible: 128, excluded: 197 },
  samples: [],
  warnings: [],
  exclusions: ["archived"],
  ...over,
});

const start = () => initialReviewApply<Fee>({ enabled: true, amount: 895 });

describe("Review & Apply", () => {
  it("opens in editing with nothing applicable", () => {
    const s = start();
    expect(s.phase).toBe("editing");
    expect(canApply(s).ok).toBe(false);
  });

  it("refuses to apply an unchanged draft", () => {
    let s = start();
    s = reviewApplyReducer(s, { type: "validate", errors: [] });
    s = reviewApplyReducer(s, { type: "review", impact: impact(), idempotencyKey: "k1" });
    expect(canApply(s)).toMatchObject({ ok: false, reason: expect.stringMatching(/nothing has changed/i) });
  });

  it("applies only after validate and review with known counts and a matching version", () => {
    let s = start();
    s = reviewApplyReducer(s, { type: "edit", draft: { enabled: true, amount: 925 } });
    expect(canApply(s).ok).toBe(false);
    s = reviewApplyReducer(s, { type: "validate", errors: [] });
    s = reviewApplyReducer(s, { type: "review", impact: impact(), idempotencyKey: "k1" });
    expect(canApply(s, 12).ok).toBe(true);
    expect(canApply(s, 13)).toMatchObject({ ok: false, reason: expect.stringMatching(/changed after/i) });
  });

  it("blocks apply when any impact count is unknown", () => {
    let s = reviewApplyReducer(start(), { type: "edit", draft: { enabled: true, amount: 925 } });
    s = reviewApplyReducer(s, { type: "validate", errors: [] });
    s = reviewApplyReducer(s, { type: "review", impact: impact({ counts: { eligible: null, excluded: 197 } }), idempotencyKey: "k1" });
    expect(canApply(s)).toMatchObject({ ok: false, reason: expect.stringMatching(/could not be fully determined/i) });
    const after = reviewApplyReducer(s, { type: "apply" });
    expect(after.phase).toBe("reviewing");
    expect(after.error).toMatch(/could not be fully determined/i);
  });

  it("discards the impact when the draft is edited after review", () => {
    let s = reviewApplyReducer(start(), { type: "edit", draft: { enabled: true, amount: 925 } });
    s = reviewApplyReducer(s, { type: "validate", errors: [] });
    s = reviewApplyReducer(s, { type: "review", impact: impact(), idempotencyKey: "k1" });
    s = reviewApplyReducer(s, { type: "edit", draft: { enabled: true, amount: 950 } });
    expect(s.phase).toBe("editing");
    expect(s.impact).toBeNull();
    expect(s.idempotencyKey).toBeNull();
  });

  it("keeps validation errors in editing and refuses review until they clear", () => {
    let s = reviewApplyReducer(start(), { type: "edit", draft: { enabled: true, amount: -1 } });
    s = reviewApplyReducer(s, { type: "validate", errors: ["Amount must be zero or more."] });
    expect(s.phase).toBe("editing");
    s = reviewApplyReducer(s, { type: "review", impact: impact(), idempotencyKey: "k1" });
    expect(s.phase).toBe("editing");
    expect(s.impact).toBeNull();
  });

  it("records partial and failed results without pretending success", () => {
    let s = reviewApplyReducer(start(), { type: "edit", draft: { enabled: true, amount: 925 } });
    s = reviewApplyReducer(s, { type: "validate", errors: [] });
    s = reviewApplyReducer(s, { type: "review", impact: impact(), idempotencyKey: "k1" });
    s = reviewApplyReducer(s, { type: "apply" });
    expect(s.phase).toBe("applying");
    const partial = reviewApplyReducer(s, { type: "result", result: { status: "partial", affected: 40, message: "88 rows pending" } });
    expect(partial.phase).toBe("partial");
    expect(partial.original).toEqual({ enabled: true, amount: 895 });
    const applied = reviewApplyReducer(s, { type: "result", result: { status: "applied", affected: 128, message: "ok" } });
    expect(applied.phase).toBe("applied");
    expect(applied.original).toEqual({ enabled: true, amount: 925 });
    const failed = reviewApplyReducer(s, { type: "error", message: "timeout" });
    expect(failed.phase).toBe("failed");
  });

  it("surfaces a conflict and clears the stale review", () => {
    let s = reviewApplyReducer(start(), { type: "edit", draft: { enabled: true, amount: 925 } });
    s = reviewApplyReducer(s, { type: "validate", errors: [] });
    s = reviewApplyReducer(s, { type: "review", impact: impact(), idempotencyKey: "k1" });
    s = reviewApplyReducer(s, { type: "conflict", changedFields: ["amount"] });
    expect(s.phase).toBe("conflict");
    expect(s.changedElsewhere).toEqual(["amount"]);
    expect(s.impact).toBeNull();
    expect(canApply(s).ok).toBe(false);
  });

  it("compares records structurally and lists the changed fields", () => {
    expect(isUnchanged({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(true);
    expect(diffFields({ amount: 895, enabled: true }, { amount: 925, enabled: true })).toEqual([{ field: "amount", before: 895, after: 925 }]);
  });
});
