// Acceptance: real, stored production vehicles (sanitized, read-only export of
// Nov 6 2026) through the SAME pipeline both Passports use. No provider calls.
//
// stored     = the build_sheet as it sits in production today
// rehydrated = structuredSheet() re-run over the stored NeoVIN snapshot (what a
//              zero-cost rehydration would write; no paid call involved)
import { describe, it, expect, vi, afterEach } from "vitest";
import fixtures from "./__fixtures__/acceptanceVehicles.json";
import type { VehicleListing } from "@/hooks/useVehicleListing";
import { derivePassport } from "@/lib/passportV2Data";
import { readBuildSheet } from "@/lib/buildSheet";
import { buildVehiclePassportDataContract } from "@/lib/vehicleData/dataContract";
import { buildNextPassportData } from "@/lib/passport/nextPassportData";
import { deriveVerificationReport } from "@/lib/passport/verificationSummary";
import { buildPassportSaleCard } from "@/lib/passport/saleCard";
import { resolveFuelEconomy } from "@/lib/passport/fuelEconomy";
import { structuredSheet, promoteNeovinExtras } from "../../../supabase/functions/_shared/neovinSheet";
import { FIELD_REGISTRY, unmappedFields, type FieldGroup } from "./fieldRegistry";
import { assessPassportCoverage } from "./passportCoverage";

type Row = Record<string, unknown> & { vin: string; neovin?: Record<string, unknown> | null; mc_attributes: Record<string, unknown> };
const ROWS = fixtures as unknown as Row[];
const byVin = (vin: string) => ROWS.find((r) => r.vin === vin)!;

const listingOf = (row: Row, rehydrate = false): VehicleListing => {
  const mc = { ...row.mc_attributes };
  if (rehydrate && row.neovin) mc.build_sheet = structuredSheet(row.neovin);
  return { ...row, mc_attributes: mc, status: "published" } as unknown as VehicleListing;
};

const pipeline = (l: VehicleListing) => {
  const d = derivePassport(l);
  const contract = buildVehiclePassportDataContract(l, d);
  const report = deriveVerificationReport(d, l);
  const saleCard = buildPassportSaleCard(d, String((l as unknown as Row).condition || ""));
  const next = buildNextPassportData({ d, listing: l as never, report, saleCard, gallery: [], contract });
  return { d, contract, report, saleCard, next };
};

const QX80 = "JN8AZ3CCXT9624250";
const X7 = "5UXCW2C03N9J22405";
const SONATA = "KMHL64JAXTA547670";
const SOLTERRA = "JTMABABA1PA013354";

afterEach(() => vi.useRealTimers());

describe("field registry covers every observed provider field", () => {
  it("has no duplicate rows", () => {
    const keys = FIELD_REGISTRY.map((r) => `${r.group}::${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("maps every key of every stored NeoVIN decode and normalized column", () => {
    const groups: [FieldGroup, (r: Row) => unknown][] = [
      ["neovin", (r) => r.neovin],
      ["mc_attributes", (r) => r.mc_attributes],
      ["build_sheet", (r) => r.mc_attributes.build_sheet],
      ["market_meta", (r) => r.market_meta],
      ["market_payload", (r) => r.market_payload],
      ["history_payload", (r) => r.history_payload],
      ["epa_economy", (r) => r.epa_economy],
    ];
    const missing: string[] = [];
    for (const row of ROWS) for (const [g, get] of groups) for (const k of unmappedFields(g, get(row))) missing.push(`${g}.${k}`);
    expect([...new Set(missing)]).toEqual([]);
  });

  it("surfaces a newly introduced provider field for review", () => {
    expect(unmappedFields("neovin", { ...byVin(QX80).neovin, brand_new_field: 1 })).toEqual(["brand_new_field"]);
    expect(unmappedFields("listing", { fees: 895, price_includes_fees: true, alternate_vin: "X" })).toEqual([]);
  });

  it("records an explicit reason for every exclusion", () => {
    for (const r of FIELD_REGISTRY.filter((x) => x.status === "excluded")) expect(r.note.length).toBeGreaterThan(10);
  });
});

describe("factory build: installed vs available, options vs packages", () => {
  it("keeps a priced paint option the equipment noise filter used to drop", () => {
    const sheet = readBuildSheet(listingOf(byVin(SONATA), true))!;
    const paint = sheet.options.find((o) => o.code === "W6H");
    expect(paint?.name).toBe("Serenity White Pearl");
    expect(paint?.msrp).toBe(500);
  });

  it("separates packages from options and attributes option-code equipment to the option", () => {
    const sheet = readBuildSheet(listingOf(byVin(QX80), true))!;
    expect(sheet.packages.map((p) => p.code)).toEqual(["M93"]);
    expect(sheet.options.map((o) => o.code).sort()).toEqual(["B92", "E08", "H92"]);
    expect(sheet.packages[0].contents.length).toBeGreaterThan(0);
    const standardItems = sheet.standard.flatMap(([, items]) => items);
    for (const item of sheet.packages[0].contents) expect(standardItems).not.toContain(item);
    expect(sheet.optionEquipment).toEqual([]);
  });

  it("never lists an option the provider marked verified=false as installed", () => {
    const sheet = readBuildSheet(listingOf(byVin(X7), true))!;
    const installed = [...sheet.options, ...sheet.packages].map((o) => o.code);
    expect(installed).not.toContain("4KT");
    expect(installed).not.toContain("4KU");
    expect(sheet.notVerified.map((o) => o.code).sort()).toEqual(["4KT", "4KU"]);
  });

  it("stored build sheets (no verification metadata yet) still never drop priced options", () => {
    for (const row of ROWS) {
      const sheet = readBuildSheet(listingOf(row));
      const stored = ((row.mc_attributes.build_sheet as Record<string, unknown> | undefined)?.options ?? []) as { msrp?: number }[];
      if (!sheet) continue;
      const kept = [...sheet.options, ...sheet.packages, ...sheet.notVerified].filter((o) => o.msrp).length;
      expect(kept).toBeGreaterThanOrEqual(stored.filter((o) => o.msrp).length);
    }
  });
});

describe("factory MSRP reconciliation", () => {
  it("reconciles base + options + destination to the provider total (QX80)", () => {
    const { contract, next } = pipeline(listingOf(byVin(QX80)));
    expect(contract.buildSheet!.msrp).toMatchObject({ baseMsrp: 111500, destination: 2190, optionsTotal: 3060, totalMsrp: 116750, status: "reconciled" });
    expect(next.factoryMsrp.state).toBe("success");
    expect(next.factoryMsrp.total).toBe(116750);
  });

  it("holds a ladder that does not add up instead of repairing it (X7)", () => {
    const { contract, next } = pipeline(listingOf(byVin(X7), true));
    expect(contract.buildSheet!.msrp.status).toBe("conflict");
    expect(next.factoryMsrp.state).toBe("unavailable");
    expect(next.factoryMsrp.total).toBeNull();
    expect(next.factoryMsrp.note).toMatch(/held for review/);
  });

  it("labels a used car's figure as original MSRP, never a current price", () => {
    const { next } = pipeline(listingOf(byVin("JN1BV7AR6FM406806")));
    expect(next.factoryMsrp.label).toBe("Original Factory MSRP");
  });
});

describe("NeoVIN warranty terms", () => {
  it("parses NeoVIN {duration, distance} terms and maps the unlimited sentinel", () => {
    const w = promoteNeovinExtras(byVin(QX80).neovin).warranty!;
    expect(w.basis).toBe("original_factory");
    const total = w.terms.find((t) => t.type === "total");
    expect(total).toMatchObject({ months: 48, miles: 60000 });
    expect(w.terms.find((t) => t.type === "anti_corrosion")?.miles).toBe(-1);
  });
});

describe("EPA units", () => {
  it("labels a battery-electric record MPGe on both Passports", () => {
    const { d, next } = pipeline(listingOf(byVin(SOLTERRA)));
    expect(d.epa?.unit).toBe("MPGe");
    expect(next.fuel.unit).toBe("MPGe");
    const fe = d.keySpecs.find(([k]) => k === "Fuel Economy")?.[1] ?? "";
    expect(fe).toMatch(/MPGe/);
    expect(resolveFuelEconomy(d.epa).unit).toBe("MPGe");
  });

  it("keeps MPG for combustion and hybrid records", () => {
    for (const vin of [QX80, "5NMP54G13TH144040"]) expect(pipeline(listingOf(byVin(vin))).d.epa?.unit).toBe("MPG");
  });
});

describe("no false positive claims from missing data", () => {
  it("never turns listing-history spells into an owner count", () => {
    for (const row of ROWS) {
      const l = listingOf(row);
      const hp = { ...(row.history_payload as Record<string, unknown> || {}), available: true, owners: 12, entries: [] };
      const { next } = pipeline({ ...l, history_payload: hp } as unknown as VehicleListing);
      expect(next.timeline.events.some((e) => /12 owners/.test(e.label))).toBe(false);
    }
  });

  it("does not claim active factory warranty on a used car without an in-service date", () => {
    const l = { ...listingOf(byVin("JN1BV7AR6FM406806")), warranty_info: { factory_months: 48, factory_miles: 100000 } } as unknown as VehicleListing;
    const { next } = pipeline(l);
    expect(next.trustBadges.map((b) => b.label)).not.toContain("Factory Warranty Active");
    expect(next.reasons.items).not.toContain("Factory warranty coverage remaining");
  });

  it("draws no market position without a provider range", () => {
    for (const row of ROWS) {
      const l = { ...listingOf(row), market_payload: { ...(row.market_payload as object || {}), low: null, high: null } } as unknown as VehicleListing;
      expect(pipeline(l).next.market.position).toBeNull();
    }
  });

  it("does not show a recall-clear status without a VIN-level answer", () => {
    for (const row of ROWS) {
      const { d, next } = pipeline(listingOf(row));
      if (next.recalls.status === "VERIFIED") expect(d.recall.vin.clearClaimAllowed).toBe(true);
    }
  });

  it("drops expired or ineligible incentives", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T12:00:00Z"));
    const l = { ...listingOf(byVin(QX80)), incentives: [
      { title: "Old", amount: 1000, valid_through: "2026-10-31" },
      { title: "Current", amount: 500, valid_through: "2026-11-30" },
      { title: "Not this VIN", amount: 750, eligible: false },
    ] } as unknown as VehicleListing;
    expect(derivePassport(l).offers.map((o) => o.title)).toEqual(["Current"]);
  });

  it("produces no NaN, undefined or $0 strings anywhere in the V2 model", () => {
    for (const row of ROWS) {
      const json = JSON.stringify(pipeline(listingOf(row)).next);
      expect(json).not.toMatch(/NaN|undefined|"\$0"/);
    }
  });
});

describe("one truth model across Passport versions", () => {
  it("V2 price, fuel and equipment equal the live Passport's shared values", () => {
    for (const row of ROWS) {
      const { d, saleCard, next, contract } = pipeline(listingOf(row));
      if (saleCard?.reconciles) expect(next.price.current).toBe(saleCard.totalAdvertisedPrice);
      expect(next.fuel.combined).toBe(resolveFuelEconomy(d.epa).combinedMpg);
      expect(next.equipment.featureCount).toBe(Math.max(contract.equipment.factoryFeatureCount, contract.equipmentList.length));
    }
  });

  it("one vehicle's build never appears on another VIN", () => {
    const a = pipeline(listingOf(byVin(QX80))).next;
    const b = pipeline(listingOf(byVin(SONATA))).next;
    expect(a.vehicle.vin).toBe(QX80);
    expect(b.equipment.options.map((o) => o.code)).not.toContain("E08");
  });
});

describe("Passport Data Coverage report", () => {
  it("grades every acceptance vehicle without throwing and flags no unknown fields", () => {
    for (const row of ROWS) {
      const rep = assessPassportCoverage(listingOf(row), row.neovin);
      expect(rep.vin).toBe(row.vin);
      expect(rep.categories.map((c) => c.key)).toEqual([
        "inventory", "marketcheck_listing", "neovin", "equipment", "pricing", "market_value", "comparables",
        "price_history", "vehicle_history", "recalls", "epa", "incentives", "v2_rendering",
      ]);
      expect(rep.unknownFields).toEqual([]);
    }
  });

  it("holds the X7 pricing for review and passes the QX80", () => {
    expect(assessPassportCoverage(listingOf(byVin(X7), true)).categories.find((c) => c.key === "pricing")?.status).toBe("held");
    expect(assessPassportCoverage(listingOf(byVin(QX80))).categories.find((c) => c.key === "pricing")?.status).toBe("full");
  });

  it("says not_requested, not unavailable, for an endpoint we never called", () => {
    const rep = assessPassportCoverage(listingOf(byVin(QX80)));
    expect(rep.categories.find((c) => c.key === "incentives")?.status).toBe("not_requested");
  });
});
