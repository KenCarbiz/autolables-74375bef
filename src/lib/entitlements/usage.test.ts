import { describe, it, expect } from "vitest";
import { quotaState, limitFor } from "./usage";

describe("quota interpretation", () => {
  it("is ok well under the soft limit", () => {
    expect(quotaState("pro", "stickers_generated", 10)).toBe("ok");
  });
  it("warns near the soft limit", () => {
    const soft = limitFor("starter", "stickers_generated")!.soft; // 150
    expect(quotaState("starter", "stickers_generated", Math.ceil(soft * 0.85))).toBe("near");
  });
  it("flags over the soft limit but under hard", () => {
    expect(quotaState("starter", "stickers_generated", 160)).toBe("over_soft");
  });
  it("blocks at the hard limit", () => {
    const hard = limitFor("starter", "stickers_generated")!.hard; // 200
    expect(quotaState("starter", "stickers_generated", hard)).toBe("blocked");
  });
  it("never blocks on an unlimited (compliance) plan", () => {
    expect(quotaState("compliance", "stickers_generated", 999999)).toBe("ok");
  });
  it("never blocks a metric with no configured limit", () => {
    expect(quotaState("pro", "qr_scans", 999999)).toBe("ok");
  });
});
