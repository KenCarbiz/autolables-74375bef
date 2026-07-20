import { describe, it, expect } from "vitest";
import {
  bucketFor,
  summarizePassportExperiment,
  PASSPORT_EXPERIMENT_ID,
  type ExperimentEventRow,
} from "./passportExperiment";

const meta = (variant: "current" | "v3", extra: Record<string, unknown> = {}) => ({
  experiment_id: PASSPORT_EXPERIMENT_ID,
  experiment_variant: variant,
  ...extra,
});

describe("bucketFor — deterministic split", () => {
  it("assigns the same visitor to the same variant every time", () => {
    const a = bucketFor("visitor_abc");
    const b = bucketFor("visitor_abc");
    expect(a.variant).toBe(b.variant);
    expect(a.bucket).toBe(b.bucket);
  });

  it("splits roughly evenly across many visitors at 0.5", () => {
    let v3 = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) if (bucketFor(`v_${i}`).variant === "v3") v3++;
    const share = v3 / N;
    expect(share).toBeGreaterThan(0.45);
    expect(share).toBeLessThan(0.55);
  });

  it("split=1 sends everyone to v3, split=0 sends everyone to current", () => {
    expect(bucketFor("v_1", PASSPORT_EXPERIMENT_ID, 1).variant).toBe("v3");
    expect(bucketFor("v_1", PASSPORT_EXPERIMENT_ID, 0).variant).toBe("current");
  });

  it("bucket is stable in [0,1)", () => {
    const { bucket } = bucketFor("anything");
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(1);
  });
});

describe("summarizePassportExperiment — funnel readout", () => {
  it("counts exposures and conversions by UNIQUE visitor per variant", () => {
    const rows: ExperimentEventRow[] = [
      { visitor_id: "a", event_type: "engagement_ping", metadata: meta("v3") },
      { visitor_id: "a", event_type: "photo_viewed", metadata: meta("v3") },      // same visitor, not a conversion
      { visitor_id: "a", event_type: "customer_passport_reserve_clicked", metadata: meta("v3") },
      { visitor_id: "b", event_type: "engagement_ping", metadata: meta("v3") },   // exposed, no conversion
      { visitor_id: "c", event_type: "engagement_ping", metadata: meta("current") },
      { visitor_id: "c", event_type: "lead_submitted", metadata: meta("current") },
      { visitor_id: "d", event_type: "engagement_ping", metadata: meta("current") },
    ];
    const s = summarizePassportExperiment(rows);
    expect(s.variants.v3.exposures).toBe(2);      // a, b
    expect(s.variants.v3.conversions).toBe(1);    // a
    expect(s.variants.v3.conversionRate).toBeCloseTo(0.5);
    expect(s.variants.current.exposures).toBe(2); // c, d
    expect(s.variants.current.conversions).toBe(1); // c
    expect(s.totalExposures).toBe(4);
  });

  it("treats a reserve/lead cta_clicked as a conversion but ignores incidental CTAs", () => {
    const rows: ExperimentEventRow[] = [
      { visitor_id: "a", event_type: "engagement_ping", metadata: meta("v3") },
      { visitor_id: "a", event_type: "cta_clicked", metadata: meta("v3", { cta_action: "reserve" }) },
      { visitor_id: "b", event_type: "engagement_ping", metadata: meta("v3") },
      { visitor_id: "b", event_type: "cta_clicked", metadata: meta("v3", { cta_action: "share" }) }, // not a conversion
    ];
    const s = summarizePassportExperiment(rows);
    expect(s.variants.v3.conversions).toBe(1); // only a
  });

  it("ignores rows outside the experiment or with a different experiment id", () => {
    const rows: ExperimentEventRow[] = [
      { visitor_id: "a", event_type: "engagement_ping", metadata: meta("v3") },
      { visitor_id: "x", event_type: "engagement_ping", metadata: {} },                          // no experiment tag
      { visitor_id: "y", event_type: "engagement_ping", metadata: { experiment_id: "other", experiment_variant: "v3" } },
    ];
    const s = summarizePassportExperiment(rows);
    expect(s.totalExposures).toBe(1);
  });

  it("reports lift as v3 rate minus current rate, null when an arm has no exposure", () => {
    const withBoth = summarizePassportExperiment([
      { visitor_id: "a", event_type: "engagement_ping", metadata: meta("v3") },
      { visitor_id: "a", event_type: "lead_submitted", metadata: meta("v3") },
      { visitor_id: "b", event_type: "engagement_ping", metadata: meta("current") },
    ]);
    expect(withBoth.lift).toBeCloseTo(1); // v3 100% - current 0%

    const oneArm = summarizePassportExperiment([
      { visitor_id: "a", event_type: "engagement_ping", metadata: meta("v3") },
    ]);
    expect(oneArm.lift).toBeNull();
  });
});
