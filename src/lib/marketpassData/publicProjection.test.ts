import { describe, expect, it } from "vitest";
import {
  PUBLIC_FIELD_CONSUMERS, PUBLIC_LISTING_FIELDS, projectPublicListing, scrubPrivateKeys,
} from "../../../supabase/functions/_shared/publicListingProjection.ts";
import { shapeLotRow } from "../../../supabase/functions/_shared/lotFeedRow.ts";
import fixtures from "@/lib/passport/__fixtures__/livePassports.2026-11-07.json";

const PRIVATE_VALUES = [
  "PRIV_PERCENTILE_77", "PRIV_CHEAPER_41", "PRIV_RANK_BASIS", "PRIV_CUT_COUNT", "PRIV_CUT_TOTAL",
  "PRIV_VISIT_PLAN", "PRIV_REF_PRICE", "PRIV_BB_TRADEIN", "PRIV_BB_RETAIL", "PRIV_FEES", "PRIV_NEOVIN_CONF",
  "PRIV_DESIRABILITY", "PRIV_DATA_CONF", "PRIV_ACV", "PRIV_COST", "PRIV_TOKEN", "PRIV_MC_RAW", "PRIV_VDP",
];

const stuffed = (): Record<string, unknown> => ({
  id: "L1", slug: "1HGCM82633A004352", vin: "1HGCM82633A004352", ymm: "2019 Acura TLX", price: 24995,
  install_token: "PRIV_TOKEN", mc_raw: { x: "PRIV_MC_RAW" }, blackbook: { retail: "PRIV_BB_RETAIL", tradein: "PRIV_BB_TRADEIN" },
  acv: "PRIV_ACV", cost: "PRIV_COST", market_desirability: "PRIV_DESIRABILITY", data_confidence: "PRIV_DATA_CONF",
  unlisted_future_column: "PRIV_UNLISTED",
  market_meta: {
    similar_count: 12, price_percentile: "PRIV_PERCENTILE_77", cheaper_count: "PRIV_CHEAPER_41", rank_basis: "PRIV_RANK_BASIS",
    comp_price_cut_count: "PRIV_CUT_COUNT", comp_price_cut_total: "PRIV_CUT_TOTAL", last_visit_plan: { v: "PRIV_VISIT_PLAN" },
    price_stats: { mean: 1, median: 2, secret: "PRIV_COST" },
    cohort: { selection: "price_independent_cohort", analyzed_count: 9, sneaky: "PRIV_COST", excluded: { subject_vin: 1, dealer_own_listings: 0, unpriced: 0, outliers: 0, leak: "PRIV_COST" } },
    sold_stats: { count: 9, price_median: 1, scope: "model_year_state", window_days: 90, ref_price: "PRIV_REF_PRICE" },
    market_desirability: "PRIV_DESIRABILITY",
  },
  market_payload: { marketValue: 1, low: 0, high: 2, ref_price: "PRIV_REF_PRICE", provider_valuation: { rawResponseSanitized: "PRIV_COST" } },
  mc_attributes: {
    make: "Acura", stock_no: "S1", dom: 12, fees: "PRIV_FEES", price_includes_fees: "PRIV_FEES", fee_basis: "PRIV_FEES",
    ref_price: "PRIV_REF_PRICE", ref_miles: 1, price_change_percent: "PRIV_REF_PRICE", neovin_confidence: "PRIV_NEOVIN_CONF",
    taxonomy: "PRIV_NEOVIN_CONF", vdp_url: "PRIV_VDP", msrp_variants: "PRIV_COST", dealer: { name: "PRIV_COST" }, source: "PRIV_COST",
    build_sheet: { packages: [{ name: "P", msrp: 100, contents: ["a"], vendor_cost: "PRIV_COST" }], options: [], generic: false, neovin_confidence: "PRIV_NEOVIN_CONF" },
  },
  history_payload: { available: true, entries: [{ miles: 1, price: "PRIV_COST", vdp_url: "PRIV_VDP", dealer: "PRIV_COST" }], owners: 1, source: "marketcheck_history" },
  comparables: [{ price: 1000, miles: 1, vin: "PRIV_COST", dealer: "PRIV_COST", ref_price: "PRIV_REF_PRICE" }],
  group_similar: [{ price: 1000, vin: "PRIV_COST", dealer: "PRIV_COST", dist: 1 }],
  value_history: [{ captured_at: "t", listing_price: 1, market_value: 2, cost: "PRIV_COST" }],
  documents: [{ name: "n", url: "u", type: "t", nested: { deeper: { acv: "PRIV_ACV", ok: 1 } } }],
  recon: { workItems: [{ title: "x", cost: "PRIV_COST", tradein: "PRIV_BB_TRADEIN" }] },
  dealer_snapshot: { name: "D", programs: [{ title: "p", internal_cost: 1, blackbook: { v: "PRIV_BB_RETAIL" } }] },
  features: [{ title: "f", market_desirability: "PRIV_DESIRABILITY" }],
});

describe("public projection never lets private intelligence through, at any depth", () => {
  const out = projectPublicListing(stuffed());
  const text = JSON.stringify(out);

  it("serialised payload contains none of the planted private values", () => {
    for (const v of PRIVATE_VALUES) expect(text.includes(v), `${v} leaked`).toBe(false);
    expect(text.includes("PRIV_UNLISTED")).toBe(false);
  });

  it("serialised payload contains none of the private key names", () => {
    for (const k of ["price_percentile", "cheaper_count", "rank_basis", "comp_price_cut", "last_visit_plan", "ref_price",
      "blackbook", "neovin_confidence", "market_desirability", "data_confidence", "install_token", "mc_raw", "window_days",
      "fee_basis", "price_includes_fees", "msrp_variants", "taxonomy"]) {
      expect(text.includes(`"${k}`), `${k} key leaked`).toBe(false);
    }
  });

  it("drops an unlisted top-level column", () => {
    expect(out.unlisted_future_column).toBeUndefined();
  });

  it("keeps what the customer surfaces read", () => {
    expect(out.vin).toBe("1HGCM82633A004352");
    expect((out.market_meta as Record<string, unknown>).similar_count).toBe(12);
    expect(((out.market_meta as Record<string, { analyzed_count: number }>).cohort).analyzed_count).toBe(9);
    expect((out.mc_attributes as Record<string, unknown>).make).toBe("Acura");
    expect((out.mc_attributes as Record<string, unknown>).dom).toBe(12);
    expect(((out.documents as { nested: { deeper: { ok: number } } }[])[0]).nested.deeper.ok).toBe(1);
  });

  it("projects comparables to the shopper-safe columns", () => {
    expect(out.comparables).toEqual([{ price: 1000, miles: 1 }]);
  });

  it("does not drop comparables priced below the subject (selection is upstream, price-independent)", () => {
    const o = projectPublicListing({ price: 30000, comparables: [{ price: 20000 }, { price: 40000 }] });
    expect((o.comparables as { price: number }[]).map((c) => c.price)).toEqual([20000, 40000]);
  });

  it("carries no dealer-only desirability or data-confidence field", () => {
    expect(scrubPrivateKeys({ a: { market_desirability_score: 1, data_confidence_score: 2, desirability: 3, ok: 4 } }))
      .toEqual({ a: { ok: 4 } });
  });

  it("every allowed field documents the surface that consumes it", () => {
    for (const k of PUBLIC_LISTING_FIELDS) expect(PUBLIC_FIELD_CONSUMERS[k]?.length, k).toBeGreaterThan(5);
  });

  it("the feed projection also withholds market_payload and comparables, and keeps own-stock vin", () => {
    const f = projectPublicListing(stuffed(), { forFeed: true });
    expect(f.market_payload).toBeUndefined();
    expect(f.comparables).toBeUndefined();
    expect((f.group_similar as { vin: string }[])[0].vin).toBe("PRIV_COST");
  });

  it("shapeLotRow (autofilm-feed) carries none of the private values either", () => {
    const shaped = JSON.stringify(shapeLotRow(stuffed(), null));
    for (const v of PRIVATE_VALUES) {
      if (v === "PRIV_COST") continue;
      expect(shaped.includes(v), `${v} leaked into the feed`).toBe(false);
    }
    expect(shaped.includes("PRIV_UNLISTED")).toBe(false);
  });
});

describe("autofilm-feed keeps every field AutoFilm reads", () => {
  // Read by AutoFilm's readVehicle, readPassport and the rep vehicle lookup
  // (autofilm-starter supabase/functions/_shared/inventory_sync.ts,
  // vehicle_passport.ts, api/index.ts) and present as vehicle_listings columns.
  const AUTOFILM_READS = [
    "vin", "photos", "hero_image_url", "ymm", "year", "make", "model", "trim", "stock_number", "price",
    "mileage", "condition", "slug", "body_style", "msrp", "market_value", "savings", "window_sticker_url",
    "certification", "features", "warranty_info", "service_records", "history_report_url",
    "payment_estimate", "epa_economy", "website_sale_price", "retail_cash", "dealer_discount", "doc_fee",
    "recall_status", "open_recall_count", "market_position", "photo_count",
  ];
  it("each one survives shapeLotRow", () => {
    const row: Record<string, unknown> = { ...stuffed() };
    for (const k of AUTOFILM_READS) if (!(k in row)) row[k] = k === "photos" ? ["https://x/a.jpg"] : 3;
    const out = shapeLotRow(row, null) as Record<string, unknown>;
    expect(AUTOFILM_READS.filter((k) => !(k in out))).toEqual([]);
  });
});

describe("real production rows still project to what the passport reads", () => {
  const rows = Object.entries(fixtures as Record<string, unknown>).filter(([k]) => !k.startsWith("_")).map(([, v]) => v as Record<string, unknown>);
  it("keeps identity, price inputs, specs, recalls and history on every fixture row", () => {
    for (const r of rows) {
      const o = projectPublicListing(r);
      for (const k of ["vin", "slug", "ymm", "price", "mileage", "status", "mc_attributes", "photos", "key_specs"]) {
        if (r[k] !== undefined) expect(o[k], k).toBeDefined();
      }
      expect(JSON.stringify(o).includes("install_token")).toBe(false);
    }
  });
});
