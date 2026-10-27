import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  NON_SCORE_AUTHORITIES, PROVIDER_CAPABILITIES, PROVIDER_CAPABILITY_KEYS, capability, capabilityForPath,
  effectiveCost, mayInfluenceVehicleScore, policyFor, publicBrowseMayTrigger, routineCapabilities,
} from "./providerRegistry.ts";
import { MC_CALL_PRICE_USD, MC_PRICE_SOURCE } from "../../../supabase/functions/_shared/mcCost";

const MATRIX = readFileSync("MARKETCHECK_CAPABILITY_MATRIX.md", "utf8");

describe("coverage", () => {
  it("has a unique key per capability", () => {
    expect(new Set(PROVIDER_CAPABILITY_KEYS).size).toBe(PROVIDER_CAPABILITY_KEYS.length);
  });

  it("covers every billing product the meter knows (except the unknown bucket)", () => {
    const billed = new Set(PROVIDER_CAPABILITIES.map((c) => c.billingProduct));
    for (const product of Object.keys(MC_CALL_PRICE_USD)) {
      if (product === "unknown") continue;
      expect(billed.has(product), `no capability bills under ${product}`).toBe(true);
    }
  });

  it("names every endpoint path that appears in the capability matrix", () => {
    const paths = [...MATRIX.matchAll(/`(\/v2\/[a-z0-9_/{}.-]+)`/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(10);
    for (const p of paths) {
      const normalized = p.replace(/\{[a-z_]+\}/g, "{x}");
      const found = PROVIDER_CAPABILITIES.some((c) => c.path.replace(/\{[a-z_]+\}/g, "{x}") === normalized);
      expect(found, `matrix path ${p} has no registry entry`).toBe(true);
    }
  });

  it("lists every capability the change order requires", () => {
    for (const k of [
      "syndication", "dealership_directory", "active_search", "recents", "neovin", "basic_decode", "vin_history",
      "mds", "sales_stats", "sold_summary", "sold_summary_dealership_groups", "price_base", "price_premium",
      "price_premium_plus", "autorecalls", "vindata_access", "vindata_generate", "incentives_oem",
      "available_options_packages", "marketmatch", "auction", "fsbo", "webhooks", "cached_images",
      "dealership_groups_reference",
    ]) {
      expect(capability(k), k).not.toBeNull();
    }
  });

  it("leaves no capability without a status, a trigger list, an authority, an ownership, a cadence and a note", () => {
    for (const c of PROVIDER_CAPABILITIES) {
      expect(c.status).toBeTruthy();
      expect(c.triggers.length).toBeGreaterThan(0);
      expect(c.authority).toBeTruthy();
      expect(c.ownership).toBeTruthy();
      expect(typeof c.cadence.intake).toBe("boolean");
      expect(typeof c.cadence.refresh).toBe("boolean");
      expect(c.notes.length).toBeGreaterThan(10);
    }
  });
});

describe("the public browse rule", () => {
  it("is false for every capability, as a type and as a value", () => {
    for (const c of PROVIDER_CAPABILITIES) expect(c.publicBrowseMayTrigger).toBe(false);
    for (const k of PROVIDER_CAPABILITY_KEYS) expect(publicBrowseMayTrigger(k)).toBe(false);
  });
});

describe("contract status is honest", () => {
  it("marks nothing as verified, because the live contract cannot be read from the sandbox", () => {
    expect(PROVIDER_CAPABILITIES.some((c) => c.contract === "verified")).toBe(false);
  });

  it("labels change-order capabilities whose path has not been read as unlocated", () => {
    for (const k of ["available_options_packages", "sold_summary_dealership_groups", "dealership_groups_reference"]) {
      expect(capability(k)?.contract, k).toBe("unlocated");
      expect(capability(k)?.status, k).toBe("not_active");
    }
  });

  it("marks the legacy recall path deprecated/replaced and never triggers it", () => {
    const legacy = capability("autorecalls_legacy");
    expect(legacy?.status).toBe("deprecated_replaced");
    expect(legacy?.triggers).toEqual(["never"]);
    expect(capability("autorecalls")?.path).toBe("/v2/car/autorecalls/{vin}");
  });
});

describe("path resolution", () => {
  it("resolves the longest matching path", () => {
    expect(capabilityForPath("https://api.marketcheck.com/v2/predict/car/us/marketcheck_price/comparables/decode?api_key=x")?.key).toBe("price_premium_plus");
    expect(capabilityForPath("/v2/predict/car/us/marketcheck_price/comparables")?.key).toBe("price_premium");
    expect(capabilityForPath("/v2/predict/car/us/marketcheck_price")?.key).toBe("price_base");
  });

  it("matches placeholders as one segment", () => {
    expect(capabilityForPath("/v2/decode/car/neovin/1ABCDEFGH12345678/specs")?.key).toBe("neovin");
    expect(capabilityForPath("/v2/history/car/1ABCDEFGH12345678")?.key).toBe("vin_history");
    expect(capabilityForPath("/v2/car/autorecalls/1ABCDEFGH12345678")?.key).toBe("autorecalls");
    expect(capabilityForPath("/v2/recall/car/1ABCDEFGH12345678")?.key).toBe("autorecalls_legacy");
  });

  it("returns null for an unknown path rather than guessing", () => {
    expect(capabilityForPath("/v2/something/else")).toBeNull();
  });
});

describe("cost resolution uses configurable pricing", () => {
  it("prefers a configured override to the list default", () => {
    expect(effectiveCost("syndication")).toBe(1.0);
    expect(effectiveCost("syndication", { syndication: 0.8 })).toBe(0.8);
  });

  it("ignores a negative or non-finite override", () => {
    expect(effectiveCost("neovin", { neovin: -1 })).toBe(0.08);
    expect(effectiveCost("neovin", { neovin: Number.NaN })).toBe(0.08);
  });

  it("matches the meter's list default for every priced capability", () => {
    for (const c of PROVIDER_CAPABILITIES) {
      const listed = MC_CALL_PRICE_USD[c.billingProduct];
      if (listed === undefined || c.billingProduct === "price_prediction") continue;
      expect(c.defaultCostUsd, c.key).toBe(listed);
    }
  });

  it("carries the 2026-10-27 revisions and drops the old MDS / Sales Stats / recents assumptions", () => {
    expect(MC_CALL_PRICE_USD.market_days_supply).toBe(0.002);
    expect(MC_CALL_PRICE_USD.sales_stats).toBe(0.002);
    expect(MC_CALL_PRICE_USD.recent_inventory).toBe(0.0025);
    expect(MC_CALL_PRICE_USD.marketmatch).toBe(0.35);
    expect(MC_CALL_PRICE_USD.auction).toBe(0.008);
    expect(MC_CALL_PRICE_USD.fsbo).toBe(0.01);
    expect(MC_CALL_PRICE_USD.vindata_generate).toBe(0.49);
    expect(MC_CALL_PRICE_USD.available_options_packages).toBe(0.002);
    expect(capability("mds")?.defaultCostUsd).toBe(0.002);
    expect(capability("sales_stats")?.defaultCostUsd).toBe(0.002);
    expect(capability("recents")?.defaultCostUsd).toBe(0.0025);
    expect(MC_PRICE_SOURCE).toMatch(/2026-10-27/);
  });

  it("is null for an unknown capability", () => {
    expect(effectiveCost("nope")).toBeNull();
  });
});

describe("new and used policies are different", () => {
  it("keeps NMVTIS, VIN history, FSBO, auction and MarketMatch off the routine new-vehicle path", () => {
    const routineNew = routineCapabilities("new");
    for (const k of ["vindata_access", "vindata_generate", "vin_history", "fsbo", "auction", "marketmatch", "marketmatch_dealers"]) {
      expect(routineNew, k).not.toContain(k);
    }
  });

  it("routinely allows syndication, NeoVIN and active search for both", () => {
    for (const t of ["new", "used"] as const) {
      const r = routineCapabilities(t);
      expect(r).toContain("syndication");
      expect(r).toContain("neovin");
      expect(r).toContain("active_search");
    }
  });

  it("allows VIN history, MDS and Sales Stats routinely for used only", () => {
    const used = routineCapabilities("used");
    expect(used).toContain("vin_history");
    expect(used).toContain("mds");
    expect(used).toContain("sales_stats");
    const fresh = routineCapabilities("new");
    expect(fresh).not.toContain("vin_history");
    expect(policyFor("mds", "new").requiresTenantOptIn).toBe(true);
  });

  it("never allows an autocurb-reserved or deprecated capability for either", () => {
    for (const k of ["fsbo", "auction", "marketmatch", "marketmatch_dealers", "autorecalls_legacy"]) {
      expect(policyFor(k, "new").allowed, k).toBe(false);
      expect(policyFor(k, "used").allowed, k).toBe(false);
    }
  });

  it("treats first-seen decode as immutable (no TTL) and Available Options Packages as opt-in for new", () => {
    expect(policyFor("neovin", "used").ttlHours).toBeNull();
    expect(policyFor("available_options_packages", "new").requiresTenantOptIn).toBe(true);
  });

  it("reports an entitlement block without pretending the capability is forbidden", () => {
    const p = policyFor("autorecalls", "used");
    expect(p.allowed).toBe(true);
    expect(p.reasons).toContain("entitlement_blocked");
  });
});

describe("the scoring rule is executable", () => {
  it("no market-evidence, acquisition, offer-context or inventory-state capability may reach Vehicle Score", () => {
    for (const c of PROVIDER_CAPABILITIES) {
      if (NON_SCORE_AUTHORITIES.includes(c.authority)) {
        expect(c.influences.vehicleScore, c.key).toBe(false);
        expect(mayInfluenceVehicleScore(c.key), c.key).toBe(false);
      }
    }
  });

  it("dealership-group and sold-summary intelligence are context only", () => {
    for (const k of ["sold_summary", "sold_summary_dealership_groups", "dealership_groups_reference", "mds", "sales_stats", "recents"]) {
      const c = capability(k)!;
      expect(c.influences.vehicleScore, k).toBe(false);
      expect(c.influences.marketContext, k).toBe(true);
    }
  });

  it("available options packages never verify identity or equipment on the subject VIN", () => {
    const c = capability("available_options_packages")!;
    expect(c.influences.identity).toBe(false);
    expect(c.influences.vehicleScore).toBe(false);
    expect(c.influences.dataConfidence).toBe(false);
  });

  it("factory build, title history and VIN safety may reach the score", () => {
    for (const k of ["neovin", "vindata_generate", "autorecalls", "vin_history"]) {
      expect(mayInfluenceVehicleScore(k), k).toBe(true);
    }
  });
});

describe("premium strategy is recorded, not assumed", () => {
  it("keeps Premium Plus as the intake tier and Premium as the refresh tier", () => {
    expect(capability("price_premium_plus")?.cadence).toEqual({ intake: true, refresh: false });
    expect(capability("price_premium")?.cadence).toEqual({ intake: false, refresh: true });
    expect(capability("neovin")?.cadence).toEqual({ intake: true, refresh: false });
  });

  it("treats generic fallback as a distinct request", () => {
    expect(capability("price_base")?.cacheKey).toContain("fallback_to_generic");
  });
});
