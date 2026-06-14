import { describe, it, expect } from "vitest";
import { assessDrift, TOLERANCE_DOLLARS, type AdvertisedPrice } from "./useAdvertisedPrices";

// ──────────────────────────────────────────────────────────────
// assessDrift is the pure gate primitive every publish path
// runs through (Wave 23 PublishPriceGate). If this returns
// "match" we publish silently; if it returns "drift" we force
// a dealer-visible resolution; if it returns "untracked" we
// nudge to capture. Every branch needs pinned behavior.
// ──────────────────────────────────────────────────────────────

const makeAp = (overrides: Partial<AdvertisedPrice> = {}): AdvertisedPrice => ({
  id: "ap-1",
  vin: "1HGCM82633A123456",
  source_url: "https://example.com/inventory/123",
  source_label: "website",
  advertised_price: 22_000,
  snapshot_at: "2026-06-13T22:00:00Z",
  captured_by: "ken@dealer.com",
  notes: "",
  ...overrides,
});

describe("assessDrift — untracked branch", () => {
  it("returns untracked status when no advertised price exists", () => {
    const r = assessDrift(22_000, undefined);
    expect(r.status).toBe("untracked");
    expect(r.advertised).toBeUndefined();
    expect(r.delta).toBe(0);
    expect(r.abs_delta).toBe(0);
    expect(r.pct_delta).toBe(0);
  });

  it("untracked reason names the capture remediation explicitly", () => {
    const r = assessDrift(22_000, undefined);
    expect(r.reason.toLowerCase()).toMatch(/no advertised price/);
    expect(r.reason.toLowerCase()).toMatch(/capture/);
  });

  it("untracked status does not carry source or snapshot_at", () => {
    const r = assessDrift(0, undefined);
    expect(r.source).toBeUndefined();
    expect(r.snapshot_at).toBeUndefined();
  });
});

describe("assessDrift — match branch", () => {
  it("returns match when sticker exactly equals advertised", () => {
    const r = assessDrift(22_000, makeAp({ advertised_price: 22_000 }));
    expect(r.status).toBe("match");
    expect(r.delta).toBe(0);
    expect(r.abs_delta).toBe(0);
  });

  it("returns match within the $50 tolerance — sticker $50 higher", () => {
    const r = assessDrift(22_050, makeAp({ advertised_price: 22_000 }));
    expect(r.status).toBe("match");
    expect(r.abs_delta).toBe(50);
  });

  it("returns match within tolerance — sticker $50 lower", () => {
    const r = assessDrift(21_950, makeAp({ advertised_price: 22_000 }));
    expect(r.status).toBe("match");
    expect(r.abs_delta).toBe(50);
  });

  it("preserves the source label + snapshot_at on match for the UI", () => {
    const ap = makeAp({ source_label: "autotrader", snapshot_at: "2026-06-13T22:00:00Z" });
    const r = assessDrift(22_010, ap);
    expect(r.source).toBe("autotrader");
    expect(r.snapshot_at).toBe("2026-06-13T22:00:00Z");
  });

  it("match reason names the tolerance number so the dealer can verify the rule", () => {
    const r = assessDrift(22_001, makeAp({ advertised_price: 22_000 }));
    expect(r.reason).toMatch(new RegExp(`\\$${TOLERANCE_DOLLARS}`));
  });
});

describe("assessDrift — drift branch", () => {
  it("returns drift when sticker exceeds tolerance high", () => {
    // $51 over tolerance → drift
    const r = assessDrift(22_051, makeAp({ advertised_price: 22_000 }));
    expect(r.status).toBe("drift");
    expect(r.delta).toBe(51);
    expect(r.abs_delta).toBe(51);
    expect(r.pct_delta).toBeCloseTo(51 / 22_000, 6);
  });

  it("returns drift when sticker drops below tolerance low", () => {
    const r = assessDrift(21_949, makeAp({ advertised_price: 22_000 }));
    expect(r.status).toBe("drift");
    expect(r.delta).toBe(-51);
    expect(r.abs_delta).toBe(51);
    expect(r.pct_delta).toBeCloseTo(-51 / 22_000, 6);
  });

  it("flags drift > 0 as FTC §5 enforcement risk (sticker HIGHER than advertised)", () => {
    const r = assessDrift(25_000, makeAp({ advertised_price: 22_000 }));
    expect(r.status).toBe("drift");
    // Reason explicitly cites the enforcement context so the
    // dealer learns the rule by reading the gate.
    expect(r.reason).toMatch(/HIGHER/);
    expect(r.reason).toMatch(/FTC §5|97-dealer|97/);
  });

  it("flags drift < 0 as lower-risk but still on the record", () => {
    const r = assessDrift(20_000, makeAp({ advertised_price: 22_000 }));
    expect(r.status).toBe("drift");
    expect(r.reason).toMatch(/LOWER/);
    expect(r.reason).toMatch(/mismatch/i);
  });

  it("captures advertised, source, snapshot_at on the drift result for the modal", () => {
    const ap = makeAp({
      advertised_price: 22_000,
      source_label: "cars_com",
      snapshot_at: "2026-06-12T18:00:00Z",
    });
    const r = assessDrift(25_000, ap);
    expect(r.advertised).toBe(22_000);
    expect(r.source).toBe("cars_com");
    expect(r.snapshot_at).toBe("2026-06-12T18:00:00Z");
  });

  it("handles zero advertised price without dividing by zero", () => {
    // Edge case — defensive. assessDrift returns pct_delta = 0
    // when advertised is 0 so the UI doesn't render Infinity.
    const r = assessDrift(5_000, makeAp({ advertised_price: 0 }));
    expect(r.status).toBe("drift");
    expect(Number.isFinite(r.pct_delta)).toBe(true);
    expect(r.pct_delta).toBe(0);
  });
});

describe("assessDrift — boundary precision", () => {
  it("tolerance boundary exact-match (= $50) is treated as match", () => {
    const r = assessDrift(22_050, makeAp({ advertised_price: 22_000 }));
    expect(r.status).toBe("match");
  });

  it("tolerance boundary one-cent-over ($50.01) is treated as drift if integer math allows", () => {
    // We work in dollars; 50.01 trips. Verify the asymmetric
    // edge so an off-by-one in the comparator doesn't drift in
    // a refactor.
    const r = assessDrift(22_050.01, makeAp({ advertised_price: 22_000 }));
    expect(r.status).toBe("drift");
  });
});
