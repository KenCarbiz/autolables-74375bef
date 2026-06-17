import { describe, it, expect } from "vitest";
import {
  assessDrift,
  assessSiteSpread,
  assessPriceIntegrity,
  includedInAdvertised,
  TOLERANCE_DOLLARS,
  type AdvertisedPrice,
  type PriceIntegrityProduct,
} from "./useAdvertisedPrices";

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

describe("assessSiteSpread — cross-site price agreement", () => {
  it("returns null when no priced rows exist", () => {
    expect(assessSiteSpread([])).toBeNull();
    expect(assessSiteSpread(undefined)).toBeNull();
    expect(assessSiteSpread([makeAp({ advertised_price: 0 })])).toBeNull();
  });

  it("flags agreement when every site is within tolerance", () => {
    const r = assessSiteSpread([
      makeAp({ source_label: "website", advertised_price: 22_000 }),
      makeAp({ source_label: "carfax", advertised_price: 22_025 }),
      makeAp({ source_label: "cargurus", advertised_price: 22_000 }),
    ]);
    expect(r).not.toBeNull();
    expect(r!.sites).toBe(3);
    expect(r!.spread).toBe(25);
    expect(r!.inAgreement).toBe(true);
  });

  it("flags disagreement when a site is out of step beyond tolerance", () => {
    const r = assessSiteSpread([
      makeAp({ source_label: "website", advertised_price: 22_000 }),
      makeAp({ source_label: "carfax", advertised_price: 24_500 }),
    ]);
    expect(r!.min).toBe(22_000);
    expect(r!.max).toBe(24_500);
    expect(r!.spread).toBe(2_500);
    expect(r!.inAgreement).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────
// assessPriceIntegrity is the per-deal FTC gate: the all-in price
// (selling + doc fee + pre-installed items) must equal the scraped
// advertised price or the addendum cannot be signed.
// ──────────────────────────────────────────────────────────────

const installed = (price: number, over: Partial<PriceIntegrityProduct> = {}): PriceIntegrityProduct => ({
  id: `p-${price}`, name: `Item ${price}`, price, badge_type: "installed", price_in_advertised: true, ...over,
});

describe("includedInAdvertised — which lines fold into the advertised price", () => {
  it("includes a pre-installed, non-removable, in-advertised line", () => {
    expect(includedInAdvertised(installed(995))).toBe(true);
  });
  it("excludes an optional/customer-elected line", () => {
    expect(includedInAdvertised(installed(995, { badge_type: "optional" }))).toBe(false);
  });
  it("excludes a line explicitly above the advertised price", () => {
    expect(includedInAdvertised(installed(995, { price_in_advertised: false }))).toBe(false);
  });
  it("excludes a removable pre-installed line", () => {
    expect(includedInAdvertised(installed(995, { removable: true }))).toBe(false);
  });
  it("treats undefined price_in_advertised as inside the ad price (FTC-safe default)", () => {
    expect(includedInAdvertised({ name: "x", price: 100, badge_type: "installed" })).toBe(true);
  });
});

describe("assessPriceIntegrity — no_selling_price branch", () => {
  it("blocks when selling price is missing", () => {
    const r = assessPriceIntegrity({ sellingPrice: null, docFee: 599, products: [installed(995)], advertised: makeAp() });
    expect(r.status).toBe("no_selling_price");
    expect(r.blocking).toBe(true);
  });
  it("blocks when selling price is zero or negative", () => {
    expect(assessPriceIntegrity({ sellingPrice: 0, docFee: 0, products: [], advertised: makeAp() }).status).toBe("no_selling_price");
  });
});

describe("assessPriceIntegrity — untracked branch", () => {
  it("is soft (non-blocking) when no advertised price is on file", () => {
    const r = assessPriceIntegrity({ sellingPrice: 20_000, docFee: 599, products: [installed(995)], advertised: undefined });
    expect(r.status).toBe("untracked");
    expect(r.blocking).toBe(false);
    expect(r.expectedOnline).toBe(21_594);
  });
});

describe("assessPriceIntegrity — ok branch", () => {
  it("reconciles selling + doc fee + pre-installed to the advertised price", () => {
    // 20000 + 599 + 995 + 406 = 22000 → exact match
    const r = assessPriceIntegrity({
      sellingPrice: 20_000,
      docFee: 599,
      products: [installed(995), installed(406)],
      advertised: makeAp({ advertised_price: 22_000 }),
    });
    expect(r.status).toBe("ok");
    expect(r.blocking).toBe(false);
    expect(r.includedTotal).toBe(1_401);
    expect(r.expectedOnline).toBe(22_000);
    expect(r.delta).toBe(0);
  });
  it("passes within the $50 tolerance window", () => {
    const r = assessPriceIntegrity({
      sellingPrice: 20_040,
      docFee: 599,
      products: [installed(995), installed(406)],
      advertised: makeAp({ advertised_price: 22_000 }),
    });
    expect(r.status).toBe("ok");
    expect(r.abs_delta).toBe(40);
  });
  it("excludes optional and above-advertised lines from the included total", () => {
    const r = assessPriceIntegrity({
      sellingPrice: 21_405,
      docFee: 0,
      products: [
        installed(595),                                   // included
        installed(900, { badge_type: "optional" }),       // excluded
        installed(750, { price_in_advertised: false }),   // excluded
      ],
      advertised: makeAp({ advertised_price: 22_000 }),
    });
    expect(r.includedTotal).toBe(595);
    expect(r.status).toBe("ok");
  });
});

describe("assessPriceIntegrity — mismatch branch", () => {
  it("blocks and flags OVER when the all-in total exceeds advertised", () => {
    // 20000 + 599 + 995 = 21594, advertised 21000 → +594 over
    const r = assessPriceIntegrity({
      sellingPrice: 20_000,
      docFee: 599,
      products: [installed(995)],
      advertised: makeAp({ advertised_price: 21_000 }),
    });
    expect(r.status).toBe("mismatch");
    expect(r.blocking).toBe(true);
    expect(r.delta).toBe(594);
    expect(r.reason).toMatch(/OVER/);
    expect(r.reason.toLowerCase()).toMatch(/reclassify|customer-elected/);
  });
  it("blocks and flags UNDER when the all-in total is below advertised", () => {
    const r = assessPriceIntegrity({
      sellingPrice: 18_000,
      docFee: 599,
      products: [installed(995)],
      advertised: makeAp({ advertised_price: 22_000 }),
    });
    expect(r.status).toBe("mismatch");
    expect(r.delta).toBe(-2_406);
    expect(r.reason).toMatch(/UNDER/);
  });
});
