// ── The internal review surface, read-only and tenant-isolated ─────────────

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildShadowReviewRow, SHADOW_REVIEW_AUDIENCE_NOTICE, SHADOW_REVIEW_FORBIDDEN_FIELDS,
} from "./shadowReview.ts";

const TENANT = "3f0f97f5-0000-0000-0000-000000000000";
const NOW = Date.parse("2026-09-11T12:00:00.000Z");

/** The Gate 14D evaluation, as the evidence table actually holds it. */
const EVIDENCE = {
  id: "78961f12-e1fa-4a74-b314-5cce335e7bc2",
  tenant_id: TENANT,
  vin: "3PCAJ5FB1SF109708",
  created_at: "2026-09-11T03:06:49.746Z",
  checked_at: "2026-09-11T03:06:49.746Z",
  status: "limited",
  algorithm_version: "v2.0.0-shadow",
  displayed_total_price: "43876.00",
  vehicle_comparison_price: "42981.00",
  doc_fee: "895.00",
  price_basis_status: "ambiguous",
  certification_match: null,
  provider: "marketcheck",
  provider_attempt_status: "succeeded",
  provider_prediction: "40661.00",
  raw_candidate_count: 7,
  eligible_primary_count: 0,
  effective_sample_size: "0.0000",
  independent_rooftop_count: 0,
  confidence_tier: "low",
  verdict: "Limited Market Evidence",
  confidence_reasons: ["insufficient_market_diversity", "no_primary_comparable_tier"],
  data_provenance: { shadow: true, invocation_source: "ingestion", provider_policy: "disabled" },
};

const COMPARABLES = [
  { comparable_vin: "V1", dealer_name: "Harte Infiniti", inclusion_status: "excluded", exclusion_reasons: ["internal_inventory_own_rooftop"] },
  { comparable_vin: "V2", dealer_name: "Infiniti Of Lynbrook", inclusion_status: "context_only", exclusion_reasons: ["context_tier_E"] },
];

const build = (over: Record<string, unknown> = {}) => buildShadowReviewRow({
  evaluation: { ...EVIDENCE, ...over },
  comparables: COMPARABLES,
  viewerTenantId: TENANT,
  legacyMarketValue: 39_158,
  now: NOW,
});

describe("tenant isolation", () => {
  it("refuses to assemble another tenant's row", () => {
    expect(build({ tenant_id: "someone-else" })).toBeNull();
  });

  it("refuses a row with no tenant, id or VIN at all", () => {
    for (const over of [{ tenant_id: null }, { id: null }, { vin: null }, { tenant_id: "" }]) {
      expect(buildShadowReviewRow({
        evaluation: { ...EVIDENCE, ...over }, viewerTenantId: TENANT, now: NOW,
      }), JSON.stringify(over)).toBeNull();
    }
  });
});

describe("what the internal row carries", () => {
  const row = build()!;

  it("labels itself internal-only and shadow", () => {
    expect(row.audience).toBe("internal_only");
    expect(row.shadow).toBe(true);
    expect(row.invocationSource).toBe("ingestion");
    expect(SHADOW_REVIEW_AUDIENCE_NOTICE).toContain("Not shown to customers");
  });

  it("may show Limited Market Evidence — this is the place for it", () => {
    expect(row.verdict).toBe("Limited Market Evidence");
    expect(row.confidence).toBe("low");
    expect(row.abstentionReasons).toContain("insufficient_market_diversity");
  });

  it("keeps the two prices distinctly named", () => {
    expect(row.advertisedPrice).toBe(43_876);
    expect(row.internalComparisonPrice).toBe(42_981);
    expect(row.docFee).toBe(895);
    expect(row.advertisedPrice! - row.internalComparisonPrice!).toBe(895);
  });

  it("reports the comparable arithmetic the pilot turns on", () => {
    expect(row.rawComparableCount).toBe(7);
    expect(row.eligibleComparableCount).toBe(0);
    expect(row.independentRooftopCount).toBe(0);
    expect(row.effectiveSampleSize).toBe(0);
  });

  it("names the own-rooftop exclusions only", () => {
    expect(row.ownRooftopExclusions).toEqual(["Harte Infiniti"]);
  });

  it("computes legacy minus V2", () => {
    expect(row.legacyVersusV2).toBe(39_158 - 40_661);
  });

  it("reports zero provider cost when none was metered", () => {
    expect(row.providerCostUsd).toBe(0);
    expect(buildShadowReviewRow({
      evaluation: EVIDENCE, viewerTenantId: TENANT, providerCostUsd: "0.0700", now: NOW,
    })!.providerCostUsd).toBe(0.07);
  });

  it("reports freshness in days", () => {
    expect(row.freshnessDays).toBeGreaterThan(0.3);
    expect(row.freshnessDays).toBeLessThan(0.5);
  });

  it("reads a certification conflict only from an explicit false", () => {
    // `null` means nothing was recorded, which is not a conflict.
    expect(build({ certification_match: null })!.certificationConflict).toBe(false);
    expect(build({ certification_match: true })!.certificationConflict).toBe(false);
    expect(build({ certification_match: false })!.certificationConflict).toBe(true);
  });
});

describe("the adapter is read-only and leaks nothing", () => {
  /**
   * Comments stripped, and the forbidden-field LIST excised.
   *
   * Both files name these strings in order to rule them out — the adapter
   * declares `SHADOW_REVIEW_FORBIDDEN_FIELDS` and its header explains why. A
   * guard that fires on its own documentation teaches people to delete the
   * documentation, so it is scoped to executable code instead.
   */
  const scan = (p: string) =>
    readFileSync(p, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/export const SHADOW_REVIEW_FORBIDDEN_FIELDS[\s\S]*?\] as const;/, "");
  const src = scan("src/lib/market/shadowReview.ts");
  const component = scan("src/components/admin/ShadowEvidenceTable.tsx");

  it("exposes no forbidden evidence field", () => {
    // Matched as whole KEYS. A substring check fails on `rawComparableCount`,
    // which is a field we want, and would push someone to rename it rather
    // than to keep the raw payload out.
    const row = build()!;
    const keys = Object.keys(row);
    const serialized = JSON.stringify(row);
    for (const forbidden of SHADOW_REVIEW_FORBIDDEN_FIELDS) {
      expect(keys, forbidden).not.toContain(forbidden);
      expect(serialized, forbidden).not.toContain(`"${forbidden}":`);
    }
  });

  it("contains no mutation, invocation or spend control", () => {
    for (const forbidden of [
      ".update(", ".insert(", ".delete(", "functions.invoke", "fetch(",
      "market_provider_budgets", "market_reserve_provider_call", "api_key",
    ]) {
      expect(src, forbidden).not.toContain(forbidden);
      expect(component, forbidden).not.toContain(forbidden);
    }
  });

  it("gives the component no button, form or input", () => {
    for (const control of ["<button", "<form", "<input", "onSubmit", "onChange"]) {
      expect(component, control).not.toContain(control);
    }
  });

  it("is not routed anywhere", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).not.toContain("ShadowEvidenceTable");
    const routed = readFileSync("src/components/admin/ShadowEvidenceTable.tsx", "utf8");
    expect(routed).not.toContain("<Route");
    expect(routed).not.toContain("useNavigate");
  });

  it("labels the internal comparison basis as internal in the UI, not only the type", () => {
    expect(component).toContain('label="Internal comparison basis"');
    expect(component).toContain("SHADOW_REVIEW_AUDIENCE_NOTICE");
  });
});
