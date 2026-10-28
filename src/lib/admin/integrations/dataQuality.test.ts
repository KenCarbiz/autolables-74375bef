import { describe, it, expect } from "vitest";
import { DATA_QUALITY_CHECKS, summarizeDataQuality } from "./dataQuality";

const allKnown = (value: number) => Object.fromEntries(DATA_QUALITY_CHECKS.map((c) => [c.id, { kind: "known" as const, value }]));

describe("summarizeDataQuality", () => {
  it("is healthy only when every count is known and zero", () => {
    const s = summarizeDataQuality(allKnown(0));
    expect(s.state).toBe("healthy");
    expect(s.headline).toBe("No data quality issues found in active inventory");
    expect(s.unavailable).toBe(0);
  });

  it("treats a missing or failed count as unavailable, never as zero or healthy", () => {
    const s = summarizeDataQuality({ ...allKnown(0), source_conflicts: { kind: "failed" } });
    expect(s.state).toBe("unknown");
    expect(s.headline).toBe("1 check could not be read");
    expect(s.rows.find((r) => r.check.id === "source_conflicts")?.count.kind).toBe("failed");
    const none = summarizeDataQuality({});
    expect(none.unavailable).toBe(DATA_QUALITY_CHECKS.length);
    expect(none.state).toBe("unknown");
  });

  it("flags actionable counts and keeps context counts out of the attention line", () => {
    const s = summarizeDataQuality({ ...allKnown(0), price_mismatch: { kind: "known", value: 3 }, recall_stale: { kind: "known", value: 9 } });
    expect(s.state).toBe("warning");
    expect(s.headline).toBe("1 check needs attention");
    expect(s.rows.find((r) => r.check.id === "price_mismatch")?.tone).toBe("danger");
    expect(s.rows.find((r) => r.check.id === "recall_stale")?.state).toBe("healthy");
  });

  it("gives every check an exact destination", () => {
    for (const c of DATA_QUALITY_CHECKS) expect(c.destination.startsWith("/")).toBe(true);
  });
});
