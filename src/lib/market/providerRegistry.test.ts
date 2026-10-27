import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  PROVIDER_CAPABILITIES, PROVIDER_CAPABILITY_KEYS, capability, capabilityForPath, effectiveCost,
  policyFor, publicBrowseMayTrigger, routineCapabilities,
} from "./providerRegistry.ts";
import { MC_CALL_PRICE_USD } from "../../../supabase/functions/_shared/mcCost";

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

  it("leaves no capability without a status, a trigger list, an authority and a note", () => {
    for (const c of PROVIDER_CAPABILITIES) {
      expect(c.status).toBeTruthy();
      expect(c.triggers.length).toBeGreaterThan(0);
      expect(c.authority).toBeTruthy();
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

  it("retires the legacy recall path and never triggers it", () => {
    const legacy = capability("autorecalls_legacy");
    expect(legacy?.status).toBe("retired");
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

describe("cost resolution", () => {
  it("prefers a configured override to the public default", () => {
    expect(effectiveCost("syndication")).toBe(1.0);
    expect(effectiveCost("syndication", { syndication: 0.8 })).toBe(0.8);
  });

  it("ignores a negative or non-finite override", () => {
    expect(effectiveCost("neovin", { neovin: -1 })).toBe(0.08);
    expect(effectiveCost("neovin", { neovin: Number.NaN })).toBe(0.08);
  });

  it("matches the meter's default for every priced capability", () => {
    for (const c of PROVIDER_CAPABILITIES) {
      const listed = MC_CALL_PRICE_USD[c.billingProduct];
      if (listed === undefined || c.billingProduct === "price_prediction") continue;
      expect(c.defaultCostUsd, c.key).toBe(listed);
    }
  });

  it("is null for an unknown capability", () => {
    expect(effectiveCost("nope")).toBeNull();
  });
});

describe("new and used policies are different", () => {
  it("keeps NMVTIS, VIN history, FSBO, auction and MarketMatch off the routine new-vehicle path", () => {
    const routineNew = routineCapabilities("new");
    for (const k of ["vindata_access", "vindata_generate", "vin_history", "fsbo", "auction", "marketmatch"]) {
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

  it("never allows an autocurb-reserved or retired capability for either", () => {
    for (const k of ["fsbo", "auction", "marketmatch", "autorecalls_legacy"]) {
      expect(policyFor(k, "new").allowed, k).toBe(false);
      expect(policyFor(k, "used").allowed, k).toBe(false);
    }
  });

  it("treats first-seen decode as immutable (no TTL)", () => {
    expect(policyFor("neovin", "used").ttlHours).toBeNull();
  });

  it("reports an entitlement block without pretending the capability is forbidden", () => {
    const p = policyFor("autorecalls", "used");
    expect(p.allowed).toBe(true);
    expect(p.reasons).toContain("entitlement_blocked");
  });
});
