import { describe, it, expect } from "vitest";
import {
  displayPrice, sumLines, isCompact, splitProducts, programsToBenefits, fmtCurrency,
  configForVariant, resolveConfig, resolvePrice, DEFAULT_TEMPLATE_CONFIG,
} from "./labelData";
import { resolveIconId } from "./iconResolver";
import type { Product } from "@/hooks/useProducts";
import type { DealerProgram } from "@/lib/dealerPrograms";

const product = (over: Partial<Product> & { available_preinstalled?: boolean } = {}): Product =>
  ({ id: "p1", name: "Window Tint", price: 499, badge_type: "installed", price_tiers: null, is_active: true, disclosure: "", ...over } as unknown as Product);

describe("displayPrice", () => {
  it("prefers MSRP for new vehicles and price for used", () => {
    expect(displayPrice({ condition: "new", msrp: 46000, price: 45000 })).toEqual({ label: "TOTAL MSRP", value: 46000 });
    expect(displayPrice({ condition: "used", msrp: 46000, price: 39000 })).toEqual({ label: "TOTAL PRICE", value: 39000 });
    expect(displayPrice({ condition: "used", msrp: null, price: null })).toEqual({ label: "PRICE", value: null });
  });
});

describe("splitProducts", () => {
  it("splits by catalog type in selective mode and honors default modes", () => {
    const products = [product(), product({ id: "p2", name: "Remote Start", badge_type: "optional", price: 799 })];
    const sel = splitProducts(products, "selective", "SUV", "Palisade");
    expect(sel.installed.map((l) => l.name)).toEqual(["Window Tint"]);
    expect(sel.upgrades.map((l) => l.name)).toEqual(["Remote Start"]);
    expect(splitProducts(products, "all_optional", "SUV", "Palisade").installed).toHaveLength(0);
    expect(splitProducts(products, "all_installed", "SUV", "Palisade").upgrades).toHaveLength(0);
  });
  it("forces non-preinstallable products optional even in all_installed mode", () => {
    const p = product({ available_preinstalled: false });
    expect(splitProducts([p], "all_installed", "", "").upgrades).toHaveLength(1);
  });
  it("uses body-class tier price when present", () => {
    const p = product({ price_tiers: { suv: 599 } });
    expect(splitProducts([p], "selective", "SUV", "Palisade").installed[0].price).toBe(599);
    expect(splitProducts([p], "selective", "Sedan", "Accord").installed[0].price).toBe(499);
  });
});

describe("programsToBenefits", () => {
  const program = (over: Partial<DealerProgram> = {}): DealerProgram =>
    ({ id: "g1", enabled: true, title: "10 Year / 100,000 Mile Powertrain Warranty", offer: "", benefit: "", disclosure: "See dealer", appliesTo: "all", requirement: "none", requirementText: "", showOnSticker: true, showOnPacket: true, ...over } as DealerProgram);
  it("includes enabled sticker-visible programs and flags disclosures", () => {
    const rows = programsToBenefits([program()], "used");
    expect(rows).toHaveLength(1);
    expect(rows[0].disclosureRequired).toBe(true);
    expect(rows[0].iconKey).toBe("powertrain_warranty");
  });
  it("filters disabled, packet-only, and non-applicable programs", () => {
    expect(programsToBenefits([program({ enabled: false })], "used")).toHaveLength(0);
    expect(programsToBenefits([program({ showOnSticker: false })], "used")).toHaveLength(0);
    expect(programsToBenefits([program({ appliesTo: "new" as DealerProgram["appliesTo"] })], "used")).toHaveLength(0);
  });
});

describe("totals and layout", () => {
  it("sums line prices ignoring nulls", () => {
    expect(sumLines([{ price: 499 }, { price: null }, { price: 999 }])).toBe(1498);
  });
  it("flips to compact past 12 lines", () => {
    expect(isCompact(new Array(5), new Array(4), new Array(3))).toBe(false);
    expect(isCompact(new Array(6), new Array(4), new Array(3))).toBe(true);
  });
  it("formats currency without cents", () => {
    expect(fmtCurrency(46000)).toBe("$46,000");
    expect(fmtCurrency(null)).toBe("");
  });
});

describe("template config + variants", () => {
  it("resolveConfig fills defaults and lets overrides win", () => {
    expect(resolveConfig()).toEqual(DEFAULT_TEMPLATE_CONFIG);
    expect(resolveConfig({ showTrustBadges: false }).showTrustBadges).toBe(false);
    expect(resolveConfig({ showTrustBadges: false }).showInstalledProducts).toBe(true);
  });
  it("variants flip only their intended switches", () => {
    expect(configForVariant("premium_full")).toEqual(DEFAULT_TEMPLATE_CONFIG);
    expect(configForVariant("no_upgrades").showAvailableUpgrades).toBe(false);
    expect(configForVariant("no_installed").showInstalledProducts).toBe(false);
    const ftc = configForVariant("ftc_minimal");
    expect(ftc.showTrustBadges).toBe(false);
    expect(ftc.showIncludedBenefits).toBe(false);
    expect(ftc.disclosureMode).toBe("full");
    expect(configForVariant("new").priceLabel).toBe("Total MSRP");
    expect(configForVariant("used").priceLabel).toBe("Selling Price");
    expect(configForVariant("cpo").priceLabel).toBe("Selling Price");
  });
  it("resolvePrice defers to displayPrice on auto and forces a fixed label otherwise", () => {
    const v = { condition: "used", msrp: 46000, price: 39000 };
    expect(resolvePrice(v, resolveConfig())).toEqual({ label: "TOTAL PRICE", value: 39000 });
    expect(resolvePrice(v, resolveConfig({ priceLabel: "Selling Price" }))).toEqual({ label: "SELLING PRICE", value: 39000 });
    expect(resolvePrice(v, configForVariant("new"))).toEqual({ label: "TOTAL MSRP", value: 39000 });
  });
});

describe("resolveIconId", () => {
  it("maps semantic keys, passes registry ids through, and always falls back", () => {
    expect(resolveIconId("window_tint")).toBe("A001");
    expect(resolveIconId("wc205")).toBe("WC205");
    expect(resolveIconId("nonsense_key")).toBe("U017");
  });
});
