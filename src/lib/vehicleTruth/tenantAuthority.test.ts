import { describe, expect, it } from "vitest";
import {
  compileTenantAuthority,
  EMPTY_AUTHORITY,
  FACT_TO_FIELD,
  orderFromRule,
  type SourceAuthorityRule,
} from "./tenantAuthority";
import { resolveFact, sourceRank, type CandidateFact } from "./precedence";
import { buildVehicleSnapshot } from "./snapshot";

const rule = (over: Partial<SourceAuthorityRule> = {}): SourceAuthorityRule => ({
  field_key: "msrp",
  primary_source: "vin_decoder_oem",
  secondary_source: null,
  conflict_behavior: "warn",
  ...over,
});

const fact = (
  factKey: string, value: unknown, source: CandidateFact["source"],
  confidence: CandidateFact["confidence"] = "VERIFIED",
): CandidateFact => ({ factKey, value, source, confidence });

describe("mapping the settings vocabulary onto the truth layer", () => {
  it("maps a configured source to the kinds it covers, best first", () => {
    expect(orderFromRule(rule())).toEqual(["oem_authorized", "neovin", "vin_decode"]);
  });

  it("appends the secondary source without duplicating a kind", () => {
    const order = orderFromRule(rule({ primary_source: "dms_feed", secondary_source: "manual_entry" }));
    expect(order).toEqual(["dealer_confirmed", "other_structured"]);
  });

  it("refuses to approximate a source it cannot express", () => {
    // Half-applying a dealer's instruction is worse than not applying it,
    // because it looks like it worked.
    expect(orderFromRule(rule({ primary_source: "carfax" }))).toBeNull();
  });

  it("covers every MSRP-ish fact from the single settings field", () => {
    for (const f of ["base_msrp", "total_msrp", "destination_charge", "factory_options_total"]) {
      expect(FACT_TO_FIELD[f], f).toBe("msrp");
    }
    expect(FACT_TO_FIELD.mileage).toBe("mileage");
    expect(FACT_TO_FIELD.dealer_installed_equipment).toBe("dealer_installed_products");
  });
});

describe("compiling a tenant's rules", () => {
  it("expands one settings field across all the facts it governs", () => {
    const a = compileTenantAuthority([rule()]);
    expect(a.orderByFact.get("base_msrp")).toEqual(["oem_authorized", "neovin", "vin_decode"]);
    expect(a.orderByFact.get("total_msrp")).toEqual(["oem_authorized", "neovin", "vin_decode"]);
  });

  it("records blocking and ignored behaviours per fact", () => {
    const a = compileTenantAuthority([
      rule({ field_key: "mileage", primary_source: "dms_feed", conflict_behavior: "block_generation" }),
      rule({ field_key: "exterior_color", primary_source: "dealer_website", conflict_behavior: "ignore" }),
    ]);
    expect(a.blockingFacts.has("mileage")).toBe(true);
    expect(a.ignoredFacts.has("exterior_color")).toBe(true);
  });

  it("skips a settings field that governs no truth fact", () => {
    const a = compileTenantAuthority([rule({ field_key: "vehicle_location", primary_source: "dms_feed" })]);
    expect(a.orderByFact.size).toBe(0);
  });

  it("skips an unknown field rather than guessing", () => {
    expect(compileTenantAuthority([rule({ field_key: "not_a_field" })]).orderByFact.size).toBe(0);
  });
});

describe("configured order changes who wins", () => {
  it("ranks a tenant's chosen source above the built-in ordering", () => {
    const order = orderFromRule(rule({ primary_source: "marketcheck" }))!;
    expect(sourceRank("base_msrp", "marketcheck", order))
      .toBeLessThan(sourceRank("base_msrp", "neovin", order));
    // Without the rule, NeoVIN outranks MarketCheck on a manufacturer fact.
    expect(sourceRank("base_msrp", "neovin")).toBeLessThan(sourceRank("base_msrp", "marketcheck"));
  });

  it("keeps an unranked source behind every ranked one", () => {
    const order = orderFromRule(rule({ primary_source: "marketcheck" }))!;
    expect(sourceRank("base_msrp", "marketcheck", order))
      .toBeLessThan(sourceRank("base_msrp", "ai_inference", order));
  });

  it("lets a dealership put MarketCheck ahead of NeoVIN on MSRP", () => {
    const r = resolveFact(
      [fact("base_msrp", 47595, "neovin"), fact("base_msrp", 47000, "marketcheck", "HIGH")],
      { configuredOrder: orderFromRule(rule({ primary_source: "marketcheck" })) },
    );
    expect(r?.value).toBe(47000);
    expect(r?.source).toBe("marketcheck");
  });

  it("falls back to the built-in ordering with no configured rule", () => {
    const r = resolveFact([
      fact("base_msrp", 47595, "neovin"),
      fact("base_msrp", 47000, "marketcheck", "HIGH"),
    ]);
    expect(r?.value).toBe(47595);
  });
});

describe("configured conflict behaviour", () => {
  const disagreeing = () => [
    fact("base_msrp", 47595, "neovin"),
    fact("base_msrp", 45900, "dealer_confirmed"),
  ];

  it("warns by default", () => {
    const r = resolveFact(disagreeing());
    expect(r?.disputed).toBe(true);
    expect(r?.blocking).toBe(false);
  });

  it("escalates to blocking when the tenant asked for it", () => {
    const r = resolveFact(disagreeing(), { conflictBehavior: "block_generation" });
    expect(r?.disputed).toBe(true);
    expect(r?.blocking).toBe(true);
  });

  it("silences the dispute when the tenant asked for it", () => {
    const r = resolveFact(disagreeing(), { conflictBehavior: "ignore" });
    expect(r?.disputed).toBe(false);
  });

  it("never invents a conflict where the sources agree", () => {
    const r = resolveFact(
      [fact("base_msrp", 47595, "neovin"), fact("base_msrp", 47595, "dealer_confirmed")],
      { conflictBehavior: "block_generation" },
    );
    expect(r?.disputed).toBe(false);
    expect(r?.blocking).toBe(false);
  });
});

describe("the snapshot honours the dealership's configuration", () => {
  const VIN = "3PCAJ5BB1PF113139";

  it("resolves MSRP from the configured source", () => {
    const authority = compileTenantAuthority([rule({ primary_source: "marketcheck" })]);
    const { snapshot } = buildVehicleSnapshot(VIN, [
      fact("base_msrp", 47595, "neovin"),
      fact("base_msrp", 47000, "marketcheck", "HIGH"),
    ], authority);
    expect(snapshot.pricing.baseMsrp).toBe(47000);
  });

  it("blocks generation on a field the tenant marked blocking", () => {
    const authority = compileTenantAuthority([
      rule({ field_key: "mileage", primary_source: "dms_feed", conflict_behavior: "block_generation" }),
    ]);
    const { conflicts } = buildVehicleSnapshot(VIN, [
      fact("mileage", 13127, "dealer_confirmed"),
      fact("mileage", 13500, "neovin"),
    ], authority);
    expect(conflicts).toHaveLength(1);
    // Mileage is dealer-controlled, so it would not block by default.
    expect(conflicts[0].blocksGeneration).toBe(true);
  });

  it("raises no conflict on a field the tenant told us to ignore", () => {
    const authority = compileTenantAuthority([
      rule({ field_key: "exterior_color", primary_source: "dealer_website", conflict_behavior: "ignore" }),
    ]);
    const { conflicts, facts } = buildVehicleSnapshot(VIN, [
      fact("exterior_color", "Majestic White", "dealer_confirmed"),
      fact("exterior_color", "Pearl White", "neovin"),
    ], authority);
    expect(conflicts).toEqual([]);
    expect(facts.exterior_color.status).not.toBe("disputed");
  });

  it("behaves exactly as before for a tenant with no rules", () => {
    const withNone = buildVehicleSnapshot(VIN, [fact("base_msrp", 47595, "neovin")], EMPTY_AUTHORITY);
    const withDefault = buildVehicleSnapshot(VIN, [fact("base_msrp", 47595, "neovin")]);
    expect(withNone.checksum).toBe(withDefault.checksum);
    expect(withNone.snapshot.pricing.baseMsrp).toBe(47595);
  });

  it("still blocks a disputed manufacturer fact with no rule configured", () => {
    const { conflicts } = buildVehicleSnapshot(VIN, [
      fact("base_msrp", 47595, "neovin"),
      fact("base_msrp", 45900, "dealer_confirmed"),
    ]);
    expect(conflicts[0].blocksGeneration).toBe(true);
  });
});
