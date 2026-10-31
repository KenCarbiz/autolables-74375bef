import { describe, it, expect } from "vitest";
import {
  acquisitionLadder, acquisitionMeta, acquisitionParams, buildStoredSample, toStoredComparable,
  type AcquisitionSubject, type StoredComparable,
} from "./compAcquisition.ts";
import { legacyComparableToCandidate } from "./legacyAdapter.ts";
import { buildMarketView } from "./marketView.ts";

const NOW = Date.parse("2026-10-31T00:00:00.000Z");

const subject: AcquisitionSubject = {
  vin: "3PCAJ5FB1SF109999", year: 2025, make: "INFINITI", model: "QX50", trim: "Sport",
  condition: "used", zip: "06120",
};

/** A provider page as MarketCheck active search returns it. */
const listing = (i: number, price: number, over: Record<string, unknown> = {}) => ({
  id: `L${String(i).padStart(4, "0")}`,
  vin: `5N1AJ5FB1SF1${String(i).padStart(5, "0")}`,
  heading: "Used 2025 INFINITI QX50 SPORT",
  price, miles: 10000 + i * 250, dist: 5 + ((i * 37) % 90),
  is_certified: i % 3 === 0,
  build: { year: 2025, make: "INFINITI", model: "QX50", trim: "Sport", drivetrain: "AWD" },
  dealer: { id: 9000 + i, name: `Dealer ${i}`, dealer_type: "franchise" },
  last_seen_at_date: "2026-10-30T12:00:00.000Z",
  dom: 10 + i,
  ...over,
});

const PRICES = [33900, 35400, 36950, 37800, 38400, 38900, 39500, 39950, 40800, 41500, 42300, 43900, 45200, 47800, 51900];
const page = () => PRICES.map((p, i) => listing(i + 1, p));

/** Fisher-Yates with a seeded generator, so a failing order can be replayed. */
function shuffled<T>(xs: T[], seed: number): T[] {
  const out = [...xs];
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const isOwn = (c: StoredComparable) => (c.dealer ?? "").toLowerCase().includes("harte") || c.dist === 0;

const engineSubject = (price: number) => ({
  vin: subject.vin, year: 2025, make: "INFINITI", model: "QX50", trim: "Sport",
  drivetrain: "AWD", powertrain: null, mileage: 12000, certified: false,
  price, advertisedPriceBeforeDoc: price - 895, websiteSalePrice: price,
  docFee: 895, advertisedExcludesDocFee: false, mandatoryDealerAddOns: 0,
  dealerType: "franchise" as const, zip: "06120",
});

const value = (rows: unknown[], subjectPrice = 40000) => {
  const sample = buildStoredSample(rows, { vin: subject.vin, isOwn });
  const { view, explanation } = buildMarketView({
    subject: engineSubject(subjectPrice), condition: "used",
    candidates: sample.market.map((c) => legacyComparableToCandidate(c)),
    identity: { names: ["Harte Infiniti"] },
    provider: null, nowMs: NOW,
  });
  const primary = explanation.comparables.filter((c) => c.inclusionStatus === "primary").map((c) => c.vin).sort();
  return { sample, view, explanation, primary };
};

describe("comparable request (comp-acquisition-v1)", () => {
  it("never carries a price, a price band or a price sort at any tier", () => {
    for (const tier of acquisitionLadder(subject)) {
      const p = acquisitionParams(subject, tier);
      expect(Object.keys(p).filter((k) => /price/i.test(k))).toEqual([]);
      expect(p.sort_by).toBe("dist");
      expect(p.rows).toBe("50");
    }
  });

  it("relaxes identity before geography, in a fixed order", () => {
    expect(acquisitionLadder(subject).map((t) => t.key)).toEqual(["trim_year_r100", "year_r100", "year_pm1_r100", "year_pm1_r250"]);
    expect(acquisitionLadder({ ...subject, trim: null }).map((t) => t.key)).toEqual(["year_r100", "year_pm1_r100", "year_pm1_r250"]);
    expect(acquisitionParams(subject, acquisitionLadder(subject)[2]).year).toBe("2024,2025,2026");
  });

  it("drops geography explicitly, and says so, when the store has no ZIP", () => {
    const noZip = { ...subject, zip: null };
    const t = acquisitionLadder(noZip)[0];
    expect(t.radiusMiles).toBeNull();
    expect(acquisitionParams(noZip, t).radius).toBeUndefined();
    expect(acquisitionMeta(t, acquisitionParams(noZip, t), 10, 10).limitations).toContain("no_geography");
  });

  it("separates new from used in the request", () => {
    expect(acquisitionParams({ ...subject, condition: "new" }, acquisitionLadder(subject)[0]).car_type).toBe("new");
    expect(acquisitionParams({ ...subject, condition: "cpo" }, acquisitionLadder(subject)[0]).car_type).toBe("used");
  });

  it("records truncation when the provider held back listings, and never echoes the key", () => {
    const t = acquisitionLadder(subject)[0];
    const m = acquisitionMeta(t, { ...acquisitionParams(subject, t), api_key: "secret" }, 140, 50);
    expect(m.truncated).toBe(true);
    expect(m.limitations).toContain("truncated_to_nearest:50_of_140");
    expect(m.limitations).toContain("asking_prices_not_transactions");
    expect(m.requested.api_key).toBeUndefined();
  });
});

describe("stored sample", () => {
  it("is identical whatever order the provider returned the rows in", () => {
    const base = buildStoredSample(page(), { vin: subject.vin, isOwn });
    for (let seed = 1; seed <= 25; seed++) {
      expect(buildStoredSample(shuffled(page(), seed), { vin: subject.vin, isOwn })).toEqual(base);
    }
  });

  it("is identical when the provider sorted by price either way", () => {
    const asc = [...page()].sort((a, b) => a.price - b.price);
    const desc = [...page()].sort((a, b) => b.price - a.price);
    expect(buildStoredSample(asc, { vin: subject.vin, isOwn })).toEqual(buildStoredSample(desc, { vin: subject.vin, isOwn }));
  });

  it("keeps both the cheapest and the dearest listings, with no slice", () => {
    const s = buildStoredSample(page(), { vin: subject.vin, isOwn });
    const prices = s.market.map((c) => c.price);
    expect(s.market).toHaveLength(PRICES.length);
    expect(prices).toContain(Math.min(...PRICES));
    expect(prices).toContain(Math.max(...PRICES));
  });

  it("is ordered by distance, then VIN", () => {
    const s = buildStoredSample(page(), { vin: subject.vin, isOwn });
    for (let i = 1; i < s.market.length; i++) {
      const a = s.market[i - 1], b = s.market[i];
      expect((a.dist ?? 0) < (b.dist ?? 0) || ((a.dist ?? 0) === (b.dist ?? 0) && (a.vin ?? "") <= (b.vin ?? ""))).toBe(true);
    }
  });

  it("resolves a duplicate VIN to its most recently seen copy regardless of order", () => {
    const old = listing(1, 39000, { last_seen_at_date: "2026-10-01T00:00:00.000Z", id: "OLD" });
    const fresh = listing(1, 38500, { last_seen_at_date: "2026-10-30T00:00:00.000Z", id: "NEW" });
    for (const rows of [[old, fresh], [fresh, old]]) {
      const s = buildStoredSample(rows, { vin: subject.vin, isOwn });
      expect(s.market).toHaveLength(1);
      expect(s.market[0].listing_id).toBe("NEW");
      expect(s.diagnostics.duplicates).toBe(1);
    }
  });

  it("excludes the subject and keeps the dealer's own listings out of market evidence", () => {
    const rows = [
      ...page(),
      listing(90, 40000, { vin: subject.vin }),
      listing(91, 41000, { dealer: { id: 1, name: "Harte Infiniti" } }),
      listing(92, 0),
      listing(93, 40000, { vin: "" }),
    ];
    const s = buildStoredSample(rows, { vin: subject.vin, isOwn });
    expect(s.market.map((c) => c.vin)).not.toContain(subject.vin);
    expect(s.own.map((c) => c.dealer)).toEqual(["Harte Infiniti"]);
    expect(s.diagnostics.subjectExcluded).toBe(1);
    expect(s.diagnostics.missingVinOrPrice).toBe(2);
  });

  it("keeps certification three-state and fee evidence verbatim", () => {
    expect(toStoredComparable(listing(1, 1, { is_certified: undefined })).certified).toBeNull();
    expect(toStoredComparable(listing(1, 1, { is_certified: false })).certified).toBe(false);
    expect(toStoredComparable(listing(1, 1, { dealer_fees: 899 })).fee_evidence).toEqual({ dealer_fees: 899 });
    expect(toStoredComparable(listing(1, 1)).fee_evidence).toBeNull();
  });

  it("feeds certification, dealer id and observation time through to the engine", () => {
    const c = legacyComparableToCandidate(buildStoredSample([listing(3, 40000)], { vin: subject.vin, isOwn }).market[0]);
    expect(c.certified).toBe(true);
    expect(c.dealerId).toBe("9003");
    expect(c.observedAt).toBe("2026-10-30T12:00:00.000Z");
    expect(c.drivetrain).toBe("AWD");
  });

  it("leaves rows written before v1 unknown, as before", () => {
    const c = legacyComparableToCandidate({ vin: "X", ymm: "2025 INFINITI QX50", trim: "Sport", miles: 1, price: 2, dist: 3, dealer: "D", dom: 4 });
    expect(c.certified).toBeNull();
    expect(c.dealerId).toBeNull();
    expect(c.observedAt).toBeNull();
  });
});

describe("valuation is independent of provider order and of the subject's own price", () => {
  it("selects the same comparables and the same median for any arrival order", () => {
    const base = value(page());
    expect(base.primary.length).toBeGreaterThan(0);
    for (let seed = 1; seed <= 25; seed++) {
      const v = value(shuffled(page(), seed));
      expect(v.primary).toEqual(base.primary);
      expect(v.explanation.stats.p50).toBe(base.explanation.stats.p50);
      expect(v.explanation.stats.effectiveSampleSize).toBe(base.explanation.stats.effectiveSampleSize);
    }
  });

  it("does not move the market median when the dealer changes its price", () => {
    const at = (p: number) => value(page(), p).explanation.stats.p50;
    expect(at(35000)).toBe(at(40000));
    expect(at(48000)).toBe(at(40000));
  });

  it("withholds a conclusion when the sample is too thin", () => {
    const thin = value(page().slice(0, 3));
    expect(value(page()).view.status).toBe("available");
    expect(thin.view.status).toBe("limited");
    expect(thin.view.confidence).toBe("low");
    expect(thin.view.verdict).toBe("Limited Market Evidence");
  });
});

describe("vehicle-enrich uses this method", () => {
  it("builds its comparable request from comp-acquisition-v1 and never from the subject price", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("supabase/functions/vehicle-enrich/index.ts", "utf8");
    const start = src.indexOf("async function fetchComps(");
    const body = src.slice(start, src.indexOf("\n}\n", start));
    expect(body).toContain("acquisitionParams(acqSubject, t)");
    expect(body).toContain("buildStoredSample(");
    expect(body).not.toMatch(/sort_by:\s*"price"/);
    expect(body).not.toMatch(/listingPrice \* 0\.65|listingPrice \* 1\.35/);
    expect(body).not.toMatch(/\.slice\(0, 16\)/);
  });
});
