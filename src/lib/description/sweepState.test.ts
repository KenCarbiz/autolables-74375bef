import { describe, it, expect } from "vitest";
import { sweepState, type SweepCounts } from "./model";

// The bug this pins: a fleet where every vehicle had a case row but none had
// produced a description reported as fully processed and needing no
// attention. Having a row is not having a description.

const counts = (over: Partial<SweepCounts> = {}): SweepCounts => ({
  activeInventory: 136, missing: 0, pending: 0, settled: 136, ...over,
});

describe("sweep state", () => {
  it("does not call a fully-queued fleet clear", () => {
    // The exact shape observed on a live store: 136 active, all initialized,
    // all QUEUED, nothing published, ready, failed or stale.
    expect(sweepState(counts({ pending: 136, settled: 0 }))).toBe("queued");
  });

  it("flags uninitialized vehicles ahead of everything else", () => {
    expect(sweepState(counts({ missing: 4, pending: 132, settled: 0 }))).toBe("uninitialized");
    expect(sweepState(counts({ missing: 4, pending: 0, settled: 132 }))).toBe("uninitialized");
  });

  it("reports a fleet with finished work as working", () => {
    expect(sweepState(counts({ pending: 0, settled: 136 }))).toBe("working");
    expect(sweepState(counts({ pending: 100, settled: 36 }))).toBe("working");
  });

  it("treats a single finished description as progress, not a clean sweep claim", () => {
    // One settled case is enough to leave the queued state — the band then
    // reports settled-of-total rather than asserting the fleet is done.
    expect(sweepState(counts({ pending: 135, settled: 1 }))).toBe("working");
  });

  it("does not report queued when there is nothing to do at all", () => {
    expect(sweepState(counts({ activeInventory: 0, pending: 0, settled: 0 }))).toBe("working");
  });
});
