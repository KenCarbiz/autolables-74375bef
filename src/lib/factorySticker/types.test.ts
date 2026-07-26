import { describe, expect, it } from "vitest";
import type {
  EquipmentCategory,
  FactoryStickerData,
  PriceStatus,
  ReconciliationStatus,
  SourceClassification,
} from "./types";
import { normalizeNeovin } from "./normalizeNeovin";
import { validateStickerData } from "./validate";
import { ALL_FIXTURES } from "./__fixtures__";

describe("FactoryStickerData contract", () => {
  it("accepts a hand-written literal that follows the contract", () => {
    const literal = {
      vehicle: {
        vin: "JN8AZ2NE8P9123456",
        year: 2026,
        make: "INFINITI",
        model: "QX80",
        condition: "NEW",
      },
      equipment: {
        standard: [{ category: "SAFETY_SECURITY", items: ["Forward Collision Warning"] }],
        packages: [
          { name: "Premium Package", priceStatus: "PRICED", price: 2500, features: ["Rear Seat Entertainment"] },
        ],
        options: [{ name: "Roof Rail Crossbars", priceStatus: "UNAVAILABLE" }],
      },
      pricing: { currency: "USD", reconciliationStatus: "INSUFFICIENT_DATA" },
      regulatory: { epaStatus: "UNAVAILABLE", nhtsaStatus: "UNAVAILABLE" },
      factory: {},
      warranty: { basic: "4 years / 60,000 miles", sourceVerified: false },
      dealer: { tenantId: "tn_1", name: "Harte INFINITI" },
      document: {
        vehicleId: "veh_1",
        documentId: "doc_1",
        sourceProvider: "NEOVIN",
        sourceClassification: "OEM_BUILD_DATA",
        confidence: "HIGH",
        verificationStatus: "AUTO_VERIFIED",
        generatedAt: "2026-07-21T12:00:00.000Z",
        passportUrl: "https://autolabels.io/v/demo",
        templateVersion: "1.0.0",
        rendererVersion: "1.0.0",
        dataVersion: "2026-07-01",
      },
    } satisfies FactoryStickerData;
    expect(validateStickerData(literal).ok).toBe(true);
  });

  it("every normalized fixture satisfies the interface at runtime", () => {
    for (const [name, fixture] of Object.entries(ALL_FIXTURES)) {
      const data: FactoryStickerData = normalizeNeovin(fixture());
      expect(data.pricing.currency, name).toBe("USD");
      expect(data.document.sourceProvider, name).toBe("NEOVIN");
      expect(Array.isArray(data.equipment.standard), name).toBe(true);
      expect(Array.isArray(data.equipment.packages), name).toBe(true);
      expect(Array.isArray(data.equipment.options), name).toBe(true);
    }
  });

  it("enum unions carry the exact specified members", () => {
    const categories: EquipmentCategory[] = [
      "EXTERIOR", "INTERIOR", "COMFORT_CONVENIENCE", "FUNCTIONAL",
      "POWERTRAIN", "SAFETY_SECURITY", "TECHNOLOGY", "OTHER",
    ];
    const priceStatuses: PriceStatus[] = ["PRICED", "INCLUDED", "NO_CHARGE", "UNAVAILABLE"];
    const reconciliation: ReconciliationStatus[] = [
      "MATCHED", "MINOR_VARIATION", "REVIEW_REQUIRED", "INSUFFICIENT_DATA",
    ];
    const classifications: SourceClassification[] = [
      "ORIGINAL_OEM_DOCUMENT", "OEM_BUILD_DATA", "OEM_INVENTORY_MATCH",
      "CONFIGURATION_MATCH", "DEALER_VERIFIED",
    ];
    expect(categories).toHaveLength(8);
    expect(priceStatuses).toHaveLength(4);
    expect(reconciliation).toHaveLength(4);
    expect(classifications).toHaveLength(5);
  });

  it("optional sections stay optional: warranty may be absent", () => {
    const data = normalizeNeovin(ALL_FIXTURES.noEpaNhtsa());
    expect(data.warranty).toBeUndefined();
    expect(validateStickerData(data).ok).toBe(true);
  });
});
