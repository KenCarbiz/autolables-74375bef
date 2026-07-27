import { describe, expect, it } from "vitest";
import {
  contentChecksum,
  detectMaterialChange,
  MATERIAL_FIELDS,
  stableStringify,
} from "./materialChange";

interface TestSnapshot {
  condition: string;
  mileage: number;
  identity: { manufacturer: string; make: string; modelYear: number; model: string; trim?: string; bodyConfiguration: string; stockNumber: string };
  mechanical: { engine: string; transmission: string; drivetrain: string; fuelType: string };
  colors: { exterior: string; interior: string };
  equipment: { standard: string[]; factoryOptions: string[]; factoryPackages: string[]; dealerInstalled: string[] };
  pricing: { baseMsrp: number; destinationCharge: number; totalMsrp: number; factoryOptionsTotal: number; advertisedPrice: number };
  warranty: { selection: string };
  rendering: { pdfMargin: number; typography: string };
}

const snapshot = (): TestSnapshot => ({
  condition: "used",
  mileage: 13127,
  identity: {
    manufacturer: "Nissan Motor Corporation", make: "INFINITI", modelYear: 2025,
    model: "QX80", trim: "SENSORY AWD", bodyConfiguration: "SUV", stockNumber: "IN12567",
  },
  mechanical: { engine: "5.6L V8", transmission: "9-Speed Automatic", drivetrain: "AWD", fuelType: "Gasoline" },
  colors: { exterior: "Majestic White", interior: "Graphite" },
  equipment: {
    standard: ["Navigation System"], factoryOptions: [], factoryPackages: [], dealerInstalled: [],
  },
  pricing: { baseMsrp: 82450, destinationCharge: 1995, totalMsrp: 88635, factoryOptionsTotal: 4190, advertisedPrice: 79995 },
  warranty: { selection: "as_is" },
  // Presentation-only bookkeeping that must never mint a version.
  rendering: { pdfMargin: 9, typography: "Segoe UI" },
});

describe("stable serialization", () => {
  it("ignores key order", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    expect(contentChecksum({ a: 1, b: 2 })).toBe(contentChecksum({ b: 2, a: 1 }));
  });

  it("is deterministic and sensitive to real differences", () => {
    expect(contentChecksum(snapshot())).toBe(contentChecksum(snapshot()));
    const changed = snapshot();
    changed.pricing.baseMsrp = 82451;
    expect(contentChecksum(changed)).not.toBe(contentChecksum(snapshot()));
    // SHA-256 hex, the repo's existing content_hash convention.
    expect(contentChecksum(snapshot())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("drops an absent key rather than churning the checksum", () => {
    // The shared serializer omits undefined; an object that simply lacks
    // the key hashes the same, which is what keeps a missing provider
    // field from minting a version.
    expect(stableStringify({ a: undefined })).toBe(stableStringify({}));
    expect(contentChecksum({ a: undefined, b: 1 })).toBe(contentChecksum({ b: 1 }));
  });
});

describe("material change detection", () => {
  it("treats the first snapshot as material", () => {
    const r = detectMaterialChange(null, snapshot());
    expect(r.material).toBe(true);
    expect(r.affectedFamilies.length).toBeGreaterThan(3);
  });

  it("reports no change for an identical nightly refresh", () => {
    // The behaviour that stops every scrape minting a version and
    // regenerating documents.
    const r = detectMaterialChange(snapshot(), snapshot());
    expect(r.material).toBe(false);
    expect(r.changes).toEqual([]);
    expect(r.affectedFamilies).toEqual([]);
  });

  it("ignores presentation-only differences", () => {
    const next = snapshot();
    next.rendering.pdfMargin = 12;
    next.rendering.typography = "Helvetica";
    const r = detectMaterialChange(snapshot(), next);
    expect(r.material).toBe(false);
    expect(r.immaterialFields).toContain("rendering.pdfMargin");
  });

  it("routes an MSRP correction to the OEM sticker only", () => {
    const next = snapshot();
    next.pricing.baseMsrp = 82950;
    const r = detectMaterialChange(snapshot(), next);
    expect(r.material).toBe(true);
    expect(r.affectedFamilies).toEqual(["oem_window_sticker_reproduction"]);
    expect(r.changes[0].label).toBe("Base MSRP");
  });

  it("routes a warranty-selection correction to the Buyers Guide only", () => {
    const next = snapshot();
    next.warranty.selection = "dealer_warranty";
    const r = detectMaterialChange(snapshot(), next);
    expect(r.affectedFamilies).toEqual(["ftc_buyers_guide"]);
  });

  it("keeps dealer-installed equipment out of the manufacturer document", () => {
    const next = snapshot();
    next.equipment.dealerInstalled = ["Ceramic Coating"];
    const r = detectMaterialChange(snapshot(), next);
    expect(r.affectedFamilies).not.toContain("oem_window_sticker_reproduction");
    expect(r.affectedFamilies).toContain("used_vehicle_addendum");
  });

  it("keeps an advertised-price change away from the manufacturer document", () => {
    const next = snapshot();
    next.pricing.advertisedPrice = 77995;
    const r = detectMaterialChange(snapshot(), next);
    expect(r.material).toBe(true);
    expect(r.affectedFamilies).not.toContain("oem_window_sticker_reproduction");
  });

  it("routes a mileage change to the used-car documents", () => {
    const next = snapshot();
    next.mileage = 13500;
    const r = detectMaterialChange(snapshot(), next);
    expect(r.affectedFamilies).toContain("used_vehicle_window_sticker");
    expect(r.affectedFamilies).not.toContain("oem_window_sticker_reproduction");
  });

  it("treats a condition correction as affecting everything", () => {
    const next = snapshot();
    next.condition = "new";
    const r = detectMaterialChange(snapshot(), next);
    expect(r.affectedFamilies).toContain("ftc_buyers_guide");
    expect(r.affectedFamilies).toContain("oem_window_sticker_reproduction");
  });

  it("never erases a held fact because a provider stopped answering", () => {
    const next = snapshot();
    delete next.identity.trim;
    const r = detectMaterialChange(snapshot(), next);
    expect(r.material).toBe(false);
  });

  it("reports several independent changes at once", () => {
    const next = snapshot();
    next.identity.trim = "LUXE AWD";
    next.pricing.totalMsrp = 89000;
    next.mileage = 14000;
    const r = detectMaterialChange(snapshot(), next);
    expect(r.changes.map((x) => x.field).sort())
      .toEqual(["identity.trim", "mileage", "pricing.totalMsrp"]);
  });

  it("gives every material field a label and at least one affected family", () => {
    for (const rule of MATERIAL_FIELDS) {
      expect(rule.label, rule.field).toBeTruthy();
      expect(rule.affects.length, rule.field).toBeGreaterThan(0);
    }
    // No duplicate field rules.
    expect(new Set(MATERIAL_FIELDS.map((r) => r.field)).size).toBe(MATERIAL_FIELDS.length);
  });
});
