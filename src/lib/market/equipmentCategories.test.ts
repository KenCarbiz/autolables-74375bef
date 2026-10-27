import { describe, it, expect } from "vitest";
import {
  EQUIPMENT_CATEGORIES, compareConfiguration, emptyEquipmentLedger, fileEquipment, installedEquipment,
  isInstalledCategory,
} from "./equipmentClass.ts";

describe("available options never become installed options", () => {
  it("keeps the five categories distinct by name", () => {
    expect(EQUIPMENT_CATEGORIES).toEqual([
      "factory_standard_equipment", "factory_available_options", "vin_installed_options",
      "dealer_installed_accessories", "unknown_unverified",
    ]);
    expect(isInstalledCategory("factory_available_options")).toBe(false);
    expect(isInstalledCategory("unknown_unverified")).toBe(false);
    expect(isInstalledCategory("vin_installed_options")).toBe(true);
  });

  it("files an available-options item as available even when the caller claims it is installed", () => {
    const ledger = fileEquipment(emptyEquipmentLedger(), {
      name: "Vision Package", category: "vin_installed_options", source: "available_options_packages", msrp: 1_500,
    });
    expect(ledger.vin_installed_options).toEqual([]);
    expect(ledger.factory_available_options).toHaveLength(1);
    expect(ledger.factory_available_options[0].category).toBe("factory_available_options");
  });

  it("never lists an available package among the equipment the vehicle contains", () => {
    let ledger = emptyEquipmentLedger();
    ledger = fileEquipment(ledger, { name: "Tow Hitch", category: "vin_installed_options", source: "neovin", code: "TH1" });
    ledger = fileEquipment(ledger, { name: "Vision Package", category: "factory_available_options", source: "available_options_packages" });
    ledger = fileEquipment(ledger, { name: "Splash Guards", category: "dealer_installed_accessories", source: "dealer" });
    ledger = fileEquipment(ledger, { name: "Blind Spot Warning", category: "factory_standard_equipment", source: "neovin" });
    const installed = installedEquipment(ledger).map((i) => i.name);
    expect(installed).toEqual(["Blind Spot Warning", "Tow Hitch", "Splash Guards"]);
    expect(installed).not.toContain("Vision Package");
  });

  it("compares configuration without promoting anything", () => {
    let ledger = emptyEquipmentLedger();
    ledger = fileEquipment(ledger, { name: "Tow Hitch", category: "vin_installed_options", source: "neovin" });
    ledger = fileEquipment(ledger, { name: "Tow Hitch", category: "factory_available_options", source: "available_options_packages" });
    ledger = fileEquipment(ledger, { name: "Vision Package", category: "factory_available_options", source: "available_options_packages" });
    ledger = fileEquipment(ledger, { name: "Roof Rails", category: "vin_installed_options", source: "neovin" });
    const cmp = compareConfiguration(ledger);
    expect(cmp.installedNames).toEqual(["roof rails", "tow hitch"]);
    expect(cmp.availableNotInstalled).toEqual(["vision package"]);
    expect(cmp.installedNotInCatalog).toEqual(["roof rails"]);
    expect(installedEquipment(ledger).map((i) => i.name)).not.toContain("Vision Package");
  });

  it("keeps unverified items out of the installed list", () => {
    const ledger = fileEquipment(emptyEquipmentLedger(), { name: "Something", category: "unknown_unverified", source: "unknown" });
    expect(installedEquipment(ledger)).toEqual([]);
  });
});
