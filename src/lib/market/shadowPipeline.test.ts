// ── The shadow pilot refuses by default, in every direction ────────────────

import { describe, it, expect } from "vitest";
import {
  parseShadowCohort, isInShadowCohort, decideShadowRequest, compareMaterialInputs,
  materialInputFingerprint, sanitizeInvocationSource, readProviderPolicy,
  providerCallPermitted, isCompletedEvaluation,
  SHADOW_COHORT_SETTING, MAX_SHADOW_COHORT, MATERIAL_VALUATION_INPUTS,
  type MaterialInputSource,
} from "./shadowPipeline.ts";
import { MARKET_ENGINE_VERSION } from "./types.ts";

const VIN = "3PCAJ5FB1SF109708";
const OTHER_VIN = "5N1AZ2MG1HN100001";
const TENANT = "3f0f97f5-0000-0000-0000-000000000000";

const settingsWith = (over: Record<string, unknown> = {}) => ({
  market_flags: { market_value_v2_shadow: true },
  [SHADOW_COHORT_SETTING]: [VIN],
  ...over,
});

const BASE: MaterialInputSource = {
  price: 43876, advertisedPriceBeforeDoc: 42981, websiteSalePrice: 43876,
  mileage: 11134, condition: "cpo", certified: "certified", trim: "Sport",
  ymm: "2025 INFINITI QX50", drivetrain: "AWD",
  dealerIdentity: { dealerIds: ["1013372"] },
  docFee: 895, advertisedIncludesDocFee: true,
  mandatoryAddOnsUsd: 0, mandatoryAddOnsIncludedInDisplayedPrice: true,
};

const decide = (over: Partial<Parameters<typeof decideShadowRequest>[0]> = {}) =>
  decideShadowRequest({
    settings: settingsWith(),
    tenantId: TENANT,
    listingTenantId: TENANT,
    vin: VIN,
    source: "ingestion",
    materialChange: compareMaterialInputs(null, BASE),
    algorithmVersion: MARKET_ENGINE_VERSION,
    existing: null,
    ...over,
  });

describe("the provider policy", () => {
  it("only the exact literal selects evidence-only", () => {
    expect(readProviderPolicy("disabled")).toBe("disabled");
    for (const v of ["DISABLED", " disabled ", true, 0, null, undefined, {}, "off", "none"]) {
      expect(readProviderPolicy(v), JSON.stringify(v)).toBe("reserved");
    }
  });

  it("permits a provider call only in the reserved mode", () => {
    expect(providerCallPermitted("reserved")).toBe(true);
    expect(providerCallPermitted("disabled")).toBe(false);
  });

  it("takes no budget, flag, key or entitlement argument", () => {
    // The signature is the guarantee: "should we spend" cannot re-open
    // "is spending part of this request's shape".
    expect(providerCallPermitted.length).toBe(1);
  });
});

describe("the invocation source", () => {
  it("passes the three approved server sources through", () => {
    for (const s of ["ingestion", "enrichment_sweep", "server_operator"]) {
      expect(sanitizeInvocationSource(s)).toBe(s);
    }
  });

  it("names browser rather than laundering it", () => {
    expect(sanitizeInvocationSource("browser")).toBe("browser");
  });

  it("never passes an arbitrary string into evidence", () => {
    for (const s of ["admin\n[INFO] granted", "<script>", 42, null, {}, ["ingestion"]]) {
      expect(sanitizeInvocationSource(s), JSON.stringify(s)).toBe("unknown");
    }
  });
});

describe("the pilot cohort", () => {
  it("reads an explicit list", () => {
    const c = parseShadowCohort({ [SHADOW_COHORT_SETTING]: [VIN, OTHER_VIN] });
    expect(c.vins).toEqual([OTHER_VIN, VIN].sort());
  });

  it("normalizes case and whitespace", () => {
    const c = parseShadowCohort({ [SHADOW_COHORT_SETTING]: [` ${VIN.toLowerCase()} `] });
    expect(c.vins).toEqual([VIN]);
  });

  it("removes duplicates", () => {
    const c = parseShadowCohort({ [SHADOW_COHORT_SETTING]: [VIN, VIN, VIN.toLowerCase()] });
    expect(c.vins).toEqual([VIN]);
    expect(c.reasons).toContain("shadow_cohort_deduplicated");
  });

  it("rejects malformed VINs and says how many", () => {
    const c = parseShadowCohort({ [SHADOW_COHORT_SETTING]: [VIN, "TOOSHORT", "", 42, null, "IIIIIIIIIIIIIIIII"] });
    expect(c.vins).toEqual([VIN]);
    expect(c.reasons.some((r) => r.startsWith("shadow_cohort_rejected_"))).toBe(true);
  });

  it("is empty when absent", () => {
    expect(parseShadowCohort({}).vins).toEqual([]);
    expect(parseShadowCohort(null).vins).toEqual([]);
    expect(parseShadowCohort({}).reasons).toContain("shadow_cohort_absent");
  });

  it("reads no wildcard and no all-inventory form", () => {
    for (const raw of ["*", "all", true, 1, { all: true }, "ALL"]) {
      const c = parseShadowCohort({ [SHADOW_COHORT_SETTING]: raw });
      expect(c.vins, JSON.stringify(raw)).toEqual([]);
      expect(c.reasons).toContain("shadow_cohort_not_a_list");
    }
  });

  it("REJECTS a list over the cap rather than truncating it", () => {
    // Taking the first fifty of a hundred would run a pilot on a set nobody
    // chose. The whole list is refused.
    const many = Array.from({ length: MAX_SHADOW_COHORT + 1 }, (_, i) =>
      `1HGBH41JXMN${String(100000 + i)}`);
    const c = parseShadowCohort({ [SHADOW_COHORT_SETTING]: many });
    expect(c.vins).toEqual([]);
    expect(c.reasons).toContain(`shadow_cohort_exceeds_${MAX_SHADOW_COHORT}`);
  });

  it("accepts exactly the cap", () => {
    const exactly = Array.from({ length: MAX_SHADOW_COHORT }, (_, i) =>
      `1HGBH41JXMN${String(100000 + i)}`);
    expect(parseShadowCohort({ [SHADOW_COHORT_SETTING]: exactly }).vins).toHaveLength(MAX_SHADOW_COHORT);
  });

  it("matches membership case-insensitively", () => {
    const c = parseShadowCohort({ [SHADOW_COHORT_SETTING]: [VIN] });
    expect(isInShadowCohort(c, VIN.toLowerCase())).toBe(true);
    expect(isInShadowCohort(c, OTHER_VIN)).toBe(false);
    expect(isInShadowCohort(c, null)).toBe(false);
  });
});

describe("material inputs", () => {
  it("covers exactly the valuation-relevant fields", () => {
    expect([...MATERIAL_VALUATION_INPUTS]).toEqual([
      "price", "advertised_price_before_doc", "website_sale_price", "mileage",
      "condition", "certified", "trim", "ymm", "drivetrain", "dealer_identity",
      "doc_fee", "advertised_includes_doc_fee", "mandatory_add_ons_usd",
      "mandatory_add_ons_included_in_displayed_price",
    ]);
  });

  it("moves the fingerprint when a material input moves", () => {
    for (const change of [
      { price: 42000 }, { mileage: 11200 }, { condition: "used" },
      { certified: "not_certified" }, { trim: "Luxe" }, { docFee: 0 },
      { advertisedIncludesDocFee: false }, { mandatoryAddOnsUsd: 1495 },
      { dealerIdentity: { dealerIds: ["1028492"] } },
    ]) {
      const after = { ...BASE, ...change };
      expect(materialInputFingerprint(after), JSON.stringify(change))
        .not.toBe(materialInputFingerprint(BASE));
      expect(compareMaterialInputs(BASE, after).changed).toBe(true);
    }
  });

  it("does not move for a cosmetic change", () => {
    // Photos, descriptions, recall text, days-on-market: not inputs at all, so
    // they cannot reach the fingerprint even in principle.
    const cosmetic = { ...BASE, photos: ["a.jpg"], description: "Gorgeous!", dom: 259 } as MaterialInputSource;
    expect(materialInputFingerprint(cosmetic)).toBe(materialInputFingerprint(BASE));
    expect(compareMaterialInputs(BASE, cosmetic).changed).toBe(false);
  });

  it("is insensitive to case, padding and key order", () => {
    const same: MaterialInputSource = { ...BASE, condition: "CPO ", trim: " sport" };
    expect(materialInputFingerprint(same)).toBe(materialInputFingerprint(BASE));
  });

  it("treats a reordered dealer identity as unchanged", () => {
    const reordered = { ...BASE, dealerIdentity: { dealerIds: ["1013372"] } };
    expect(materialInputFingerprint(reordered)).toBe(materialInputFingerprint(BASE));
  });
});

describe("decideShadowRequest refuses by default", () => {
  it("authorizes only when every condition holds", () => {
    const d = decide();
    expect(d.invoke).toBe(true);
    expect(d.providerPolicy).toBe("disabled");
    expect(d.reasons).toContain("shadow_authorized");
  });

  it("refuses when the flag is off, missing or malformed", () => {
    for (const settings of [
      {}, null, undefined, { market_flags: {} },
      { market_flags: { market_value_v2_shadow: false } },
      { market_flags: { market_value_v2_shadow: "true" } },
      { market_flags: { market_value_v2_shadow: 1 } },
      { market_flags: "on" },
    ]) {
      const d = decide({ settings: { ...(settings as object), [SHADOW_COHORT_SETTING]: [VIN] } });
      expect(d.invoke, JSON.stringify(settings)).toBe(false);
      expect(d.reasons).toContain("shadow_flag_off");
    }
  });

  it("refuses a browser or unknown source by name", () => {
    for (const source of ["browser", "unknown", "admin_ui", null, 42]) {
      const d = decide({ source });
      expect(d.invoke, String(source)).toBe(false);
      expect(d.reasons.some((r) => r.startsWith("shadow_source_rejected_"))).toBe(true);
    }
  });

  it("refuses a cross-tenant listing before it consults the cohort", () => {
    // Answering "not in the cohort" for another tenant's VIN would leak
    // whether it is in theirs.
    const d = decide({ listingTenantId: "someone-else" });
    expect(d.invoke).toBe(false);
    expect(d.reasons).toContain("shadow_tenant_mismatch");
    expect(d.reasons).not.toContain("shadow_vin_not_in_cohort");
  });

  it("refuses a missing tenant on either side", () => {
    expect(decide({ tenantId: null }).invoke).toBe(false);
    expect(decide({ listingTenantId: null }).invoke).toBe(false);
    expect(decide({ tenantId: "" }).invoke).toBe(false);
  });

  it("refuses an empty, malformed or oversized cohort", () => {
    const many = Array.from({ length: 51 }, (_, i) => `1HGBH41JXMN${String(100000 + i)}`);
    for (const cohort of [[], "*", undefined, many]) {
      const settings = { market_flags: { market_value_v2_shadow: true }, [SHADOW_COHORT_SETTING]: cohort };
      const d = decide({ settings });
      expect(d.invoke, JSON.stringify(cohort)).toBe(false);
      expect(d.reasons).toContain("shadow_cohort_unusable");
    }
  });

  it("refuses a VIN outside the cohort", () => {
    const d = decide({ vin: OTHER_VIN });
    expect(d.invoke).toBe(false);
    expect(d.reasons).toContain("shadow_vin_not_in_cohort");
  });

  it("refuses a duplicate: same material inputs, same algorithm", () => {
    const fp = materialInputFingerprint(BASE);
    const d = decide({
      existing: { materialInputFingerprint: fp, algorithmVersion: MARKET_ENGINE_VERSION, status: "limited" },
    });
    expect(d.invoke).toBe(false);
    expect(d.reasons).toContain("shadow_duplicate_material_inputs");
    expect(d.reasons).toContain("shadow_no_material_change");
  });

  it("allows a re-evaluation when the material inputs moved", () => {
    const d = decide({
      existing: { materialInputFingerprint: "stale", algorithmVersion: MARKET_ENGINE_VERSION, status: "limited" },
    });
    expect(d.invoke).toBe(true);
    expect(d.reasons).toContain("shadow_material_inputs_changed");
  });

  it("allows a re-evaluation when the algorithm version moved", () => {
    const d = decide({
      existing: {
        materialInputFingerprint: materialInputFingerprint(BASE),
        algorithmVersion: "v1.0.0-old", status: "available",
      },
    });
    expect(d.invoke).toBe(true);
    expect(d.reasons).toContain("shadow_algorithm_version_changed");
  });

  it("evaluates a newly cohorted VIN that has never been answered", () => {
    const d = decide({ existing: null });
    expect(d.invoke).toBe(true);
    expect(d.reasons).toContain("shadow_first_evaluation");
  });

  it("does not treat an unfinished evaluation as a duplicate", () => {
    const fp = materialInputFingerprint(BASE);
    for (const status of ["pending", "failed", null, "", "running"]) {
      expect(isCompletedEvaluation(status), String(status)).toBe(false);
      const d = decide({
        existing: { materialInputFingerprint: fp, algorithmVersion: MARKET_ENGINE_VERSION, status },
      });
      expect(d.invoke, String(status)).toBe(true);
    }
  });

  it("returns provider policy disabled on every path, allowed or refused", () => {
    const every = [
      decide(), decide({ settings: {} }), decide({ source: "browser" }),
      decide({ vin: OTHER_VIN }), decide({ listingTenantId: "other" }),
    ];
    for (const d of every) expect(d.providerPolicy).toBe("disabled");
  });

  it("hardcodes no tenant and no VIN", () => {
    const src = require("node:fs").readFileSync("src/lib/market/shadowPipeline.ts", "utf8");
    expect(src).not.toMatch(/3f0f97f5-4151-4e32-88ef-e2d6fc5a3142/);
    expect(src).not.toMatch(/\b[A-HJ-NPR-Z0-9]{17}\b/);
    expect(src).not.toContain("Harte");
  });
});
