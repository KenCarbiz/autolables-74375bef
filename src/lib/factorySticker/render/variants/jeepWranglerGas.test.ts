import { describe, expect, it } from "vitest";
import { buildRenderLayout, templateRoutingFacts, type FactoryStickerRenderData, type FactoryStickerTheme } from "../contract";
import { textBBox, type LayoutModel, type TextPrimitive } from "../layout";
import { expectNoTextOverlap, pageStrings } from "../__fixtures__/layoutAsserts";
import { WRANGLER_REFERENCE_VIN, wranglerListing, wranglerReferenceMatchData, wranglerRenderData } from "../__fixtures__/wrangler";
import { canonicalPassportUrl, PASSPORT_QR_CAPTION, REPRODUCTION_BANNER, REPRODUCTION_DISCLOSURE } from "../../reproduction";
import { encodeQrMatrix } from "../qrMatrix";
import { TEMPLATE_CATALOG, getCatalogTemplate } from "../../oem/templateCatalog";
import { PASSPORT_QR_PT } from "./hyundaiTucsonGas";
import { JEEP_WRANGLER_GAS_ID } from "./jeepWranglerGas";

const theme: FactoryStickerTheme = {
  oemThemeId: "oem-jeep", oemThemeVersion: "1", canonicalOemId: "jeep", templateFamilyId: "x",
  templateVersion: "1.0.0", logoAssetId: null, logoAssetVersion: null,
};
const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
const PRINTED_BANNER = norm(REPRODUCTION_BANNER.replace(/[–—]/g, "-"));

const sample = (d: FactoryStickerRenderData): LayoutModel =>
  buildRenderLayout(d, theme, undefined, { sampleTemplateId: JEEP_WRANGLER_GAS_ID });
const texts = (m: LayoutModel): TextPrimitive[] =>
  m.pages[0].primitives.filter((p): p is TextPrimitive => p.kind === "text");

const listing = wranglerListing();
const real = wranglerRenderData(listing);
const ref = wranglerReferenceMatchData(real);

describe("Jeep Wrangler gasoline template", () => {
  describe("off-year layout stress test (2023 record), not a production candidate", () => {
    const m = sample(real);

    it("renders exactly one 1224x792 page that equals the catalog reference size", () => {
      const page = getCatalogTemplate(JEEP_WRANGLER_GAS_ID)!.page;
      expect(m.fit.ok).toBe(true);
      expect(m.pages).toHaveLength(1);
      expect([m.width, m.height]).toEqual([page.widthPt, page.heightPt]);
      expect(pageStrings(m, 0)).toContain("PAGE 1 OF 1");
    });

    it("prints the banner, disclosure and the VIN, without overlapping text", () => {
      const strings = pageStrings(m, 0);
      expect(strings).toContain(PRINTED_BANNER);
      expect(norm(strings.join(" "))).toContain(norm(REPRODUCTION_DISCLOSURE));
      expect(strings.filter((s) => s.includes(real.vin)).length).toBeGreaterThanOrEqual(1);
      expectNoTextOverlap(m, 0);
    });

    it("prints every priced option, the destination charge and the stated total", () => {
      const printed = norm(m.drawnStrings.join(" "));
      for (const o of real.options) expect(printed).toContain(o.name);
      for (const o of real.options.filter((x) => x.msrp)) expect(printed).toContain(`$${o.msrp!.toLocaleString("en-US")}.00`);
      expect(printed).toContain(`$${real.pricing.baseMsrp!.toLocaleString("en-US")}.00`);
      expect(printed).toContain(`$${real.pricing.destinationCharge!.toLocaleString("en-US")}.00`);
      expect(printed).toContain(`$${real.pricing.totalMsrp!.toLocaleString("en-US")}.00`);
    });

    it("accounts for every equipment item: printed, or the selection note is shown", () => {
      const counts = m.fit.ok ? m.fit.equipmentCounts : undefined;
      expect(counts).toBeDefined();
      if (counts!.printed < counts!.total) {
        expect(m.fit.ok && m.fit.equipmentScope).toBe("selected");
        expect(m.drawnStrings.join(" ")).toContain("Selected standard equipment shown.");
      } else {
        expect(counts!.printed).toBe(counts!.total);
      }
      for (const t of texts(m)) expect(t.size).toBeGreaterThanOrEqual(5.2);
    });

    it("keeps decoder fragments out of the equipment", () => {
      const all = m.drawnStrings.join(" | ");
      expect(all).not.toMatch(/Rating-\d|Standard-NHTSA|Standard-IIHS/);
    });

    it("prints EPA values from the record and explicit unavailable states for the rest", () => {
      const s = m.drawnStrings;
      expect(s).toContain("23");
      expect(s).toContain("Gasoline Vehicle");
      expect(s.join(" ")).toContain("388 grams CO2");
      expect(s.filter((x) => x === "Not Available")).toHaveLength(2);
      expect(s).toContain("5-year fuel cost comparison");
      expect(s.join(" ")).toContain("not available from a verified NHTSA record");
      expect(s).not.toContain("0");
    });

    it("prints a Passport QR of 0.90in with the canonical payload and a clear quiet zone", () => {
      const qrs = m.pages[0].primitives.filter((p) => p.kind === "qr");
      expect(qrs).toHaveLength(1);
      const qr = qrs[0] as { x: number; y: number; size: number; payload: string };
      expect(qr.payload).toBe(canonicalPassportUrl(String(listing.slug)));
      expect(qr.size).toBeCloseTo(PASSPORT_QR_PT, 5);
      expect(qr.size / 72).toBeCloseTo(0.9, 5);
      expect(encodeQrMatrix(qr.payload).size).toBeGreaterThan(20);
      expect(m.drawnStrings).toContain(PASSPORT_QR_CAPTION);
      const hits = (x0: number, y0: number, x1: number, y1: number): boolean =>
        x0 < qr.x + qr.size && x1 > qr.x && y0 < qr.y + qr.size && y1 > qr.y;
      for (const t of texts(m)) {
        const b = textBBox(t);
        expect(hits(b.x0, b.y0, b.x1, b.y1), t.str).toBe(false);
      }
      for (const p of m.pages[0].primitives) {
        if ((p.kind === "rect" && p.fill) || p.kind === "barcode" || p.kind === "image") {
          expect(hits(p.x, p.y, p.x + p.w, p.y + p.h)).toBe(false);
        }
      }
    });

    it("prints a barcode of the VIN", () => {
      const bc = m.pages[0].primitives.filter((p) => p.kind === "barcode");
      expect(bc).toHaveLength(1);
      expect((bc[0] as { payload: string }).payload).toBe(real.vin);
    });

    it("leaks nothing from the reference sample", () => {
      const all = norm(m.drawnStrings.join(" ")).toUpperCase();
      for (const bad of [WRANGLER_REFERENCE_VIN, "WILLYS", "392", "ANVIL", "TOLEDO", "HEMI", "FCA US"]) expect(all).not.toContain(bad);
      for (const p of m.pages[0].primitives) {
        if (p.kind === "qr" || p.kind === "barcode") expect(p.payload).not.toContain(WRANGLER_REFERENCE_VIN);
      }
    });

    it("leaves the sold-to block blank unless the original delivering dealer is proven", () => {
      expect(m.drawnStrings).toContain("SOLD TO:");
      const proven = sample({
        ...real, dealerRole: "original_delivery",
        dealer: { name: "Original Test Jeep", address: "1 Test Way", city: "Testville", state: "CT", zip: "06000", phone: null },
      });
      expect(proven.drawnStrings.join(" ")).toContain("ORIGINAL TEST JEEP");
      expectNoTextOverlap(proven, 0);
      const current = sample({
        ...real, dealer: { name: "Current Selling Rooftop", address: null, city: null, state: null, zip: null, phone: null },
      });
      expect(current.drawnStrings.join(" ")).not.toContain("CURRENT SELLING ROOFTOP");
    });
  });

  describe("reference-match fixture (visual comparison only)", () => {
    const m = sample(ref);

    it("renders one page with every reference value from data and no overlap", () => {
      expect(m.fit.ok).toBe(true);
      expect(m.pages).toHaveLength(1);
      expectNoTextOverlap(m, 0);
      const s = m.drawnStrings.join(" | ");
      for (const v of ["14", "13", "16", "7.1", "$13,750", "$4,450", "$69,995.00", "$1,995.00", "$74,480.00", "$1,895.00", "$595.00", "68%", "MEXICO: 18%", "GERMANY", "TOLEDO, OHIO"]) {
        expect(s).toContain(v);
      }
      const equipment = Object.values(ref.standardEquipment).flat();
      expect(m.fit.ok && m.fit.equipmentCounts).toMatchObject({ printed: equipment.length, total: equipment.length });
    });

    it("reconciles the reference pricing", () => {
      const p = ref.pricing;
      expect(p.baseMsrp! + p.optionsTotal! + p.destinationCharge!).toBe(p.totalMsrp);
    });

    it("prints the reference's honest not-rated safety state", () => {
      expect(m.drawnStrings.join(" ")).toContain("This vehicle has not been rated by the government");
    });

    it("draws star ratings when NHTSA data exists and per-row Not Rated otherwise", () => {
      const stars = (d: FactoryStickerRenderData): number =>
        sample(d).pages[0].primitives.filter((p) => p.kind === "path" && p.w < 14 && p.h < 14 && p.fill === "#000000" && p.d.includes("L")).length;
      const none = stars(ref);
      const rated = sample({ ...ref, safety: { overall: 4, frontalDriver: 4, frontalPassenger: 5, sideFront: 5, sideRear: 4, rollover: 3 }, nhtsaNotRated: false });
      expect(rated.drawnStrings).toContain("Overall Vehicle Score");
      expect(stars({ ...ref, safety: { overall: 4, frontalDriver: 4, frontalPassenger: 5, sideFront: 5, sideRear: 4, rollover: 3 }, nhtsaNotRated: false })).toBeGreaterThan(none);
      const partial = sample({ ...ref, safety: { overall: null, frontalDriver: 4, frontalPassenger: null, sideFront: 5, sideRear: 0, rollover: 3 }, nhtsaNotRated: false });
      expect(partial.drawnStrings.filter((x) => x === "Not Rated")).toHaveLength(3);
      expectNoTextOverlap(rated, 0);
      expectNoTextOverlap(partial, 0);
      const unavailable = sample({ ...ref, safety: null, nhtsaNotRated: false });
      expect(unavailable.drawnStrings.join(" ")).toContain("not available from a verified NHTSA record");
    });

    it("never prints a zero for unknown EPA and pricing values", () => {
      const sparse = sample({
        ...ref, pricing: { baseMsrp: null, destinationCharge: null, optionsTotal: null, totalMsrp: null }, epa: null, safety: null, nhtsaNotRated: false,
      });
      expect(sparse.fit.ok).toBe(true);
      const all = sparse.drawnStrings.join(" ");
      expect(all).not.toMatch(/(^|[^\d.,])\$?0\.00\b/);
      expect(all).toContain("not available from verified EPA records");
      expect(sparse.drawnStrings.filter((x) => x === "Not Available").length).toBeGreaterThanOrEqual(3);
      expect(all).toContain("NOT AVAILABLE");
    });

    it("moves the greenhouse-gas pointer with the score and shows an unavailable state for bad scores", () => {
      const xs: number[] = [];
      for (const score of [1, 5, 10]) {
        const model = sample({ ...ref, epa: { ...ref.epa!, ghgScore: score, smogScore: null } });
        const label = texts(model).find((t) => t.str === String(score) && t.color === "#ffffff" && t.x > 796 && t.x < 1020 && t.align === "center");
        expect(label).toBeDefined();
        xs.push(label!.x);
      }
      expect(xs[0]).toBeLessThan(xs[1]);
      expect(xs[1]).toBeLessThan(xs[2]);
      const none = sample({ ...ref, epa: { ...ref.epa!, ghgScore: 0, smogScore: 11 } });
      expect(none.drawnStrings.filter((x) => x === "Not Available")).toHaveLength(2);
    });
  });

  describe("no hard-coded vehicle data", () => {
    const REFERENCE_STRINGS = [
      "WILLYS", "392", "ANVIL", "HEMI", "8HP75", "SRT", "69,995", "74,480", "1,895", "1,995", "13,750", "4,450", "633 grams",
      "TOLEDO", "MEXICO", "GERMANY", "68%", "18%", "FCA US", "POWERTRAIN LIMITED", "BASIC LIMITED", "27T", "DANA", "SELEC",
      "UCONNECT", "ALPINE", WRANGLER_REFERENCE_VIN, "BLACK INTERIOR", "SWING GATE", "ADAPTIVE CRUISE",
    ];
    const minimal: FactoryStickerRenderData = {
      ...real,
      vin: "1C4HJXDN0PW000000", barcodePayload: "1C4HJXDN0PW000000", passportUrl: "",
      identity: { year: "2026", make: "Jeep", model: "Wrangler", trim: null },
      pricing: { baseMsrp: null, destinationCharge: null, optionsTotal: null, totalMsrp: null },
      packages: [], options: [], standardEquipment: {}, keyFeatures: {},
      colors: { exterior: { name: null, code: null }, interior: { name: null, code: null } },
      assembly: { plant: null, city: null, country: null }, mechanical: { engine: null, transmission: null, drivetrain: null },
      epa: null, safety: null, nhtsaNotRated: false, dealerRole: null,
      dealer: { name: null, address: null, city: null, state: null, zip: null, phone: null },
      warranty: undefined, partsContent: [], factoryCodes: { dealer: null, emissions: null }, transportMethod: null,
    };

    it("prints no reference-transcription value for an empty record", () => {
      const m = sample(minimal);
      expect(m.fit.ok).toBe(true);
      expectNoTextOverlap(m, 0);
      const all = norm(m.drawnStrings.join(" ")).toUpperCase();
      for (const bad of REFERENCE_STRINGS) expect(all, bad).not.toContain(bad.toUpperCase());
      expect(all).toContain("STANDARD EQUIPMENT NOT AVAILABLE FOR THIS VEHICLE");
      expect(all).toContain("NOT AVAILABLE FOR THIS VEHICLE");
      expect(all).not.toContain("GASOLINE VEHICLE");
    });

    it("prints a record's own values and none of the reference's", () => {
      const other: FactoryStickerRenderData = {
        ...minimal,
        identity: { year: "2026", make: "Jeep", model: "Wrangler", trim: "Sahara" },
        pricing: { baseMsrp: 51000, destinationCharge: 2095, optionsTotal: 0, totalMsrp: 53095 },
        colors: { exterior: { name: "Bright White", code: "PW7" }, interior: { name: "Black", code: null } },
        mechanical: { engine: "3.6L V6", transmission: "8-Speed Automatic", drivetrain: "4WD" },
      };
      const m = sample(other);
      const all = norm(m.drawnStrings.join(" ")).toUpperCase();
      for (const want of ["SAHARA", "BRIGHT WHITE (PW7)", "3.6L V6", "$51,000.00", "$53,095.00"]) expect(all).toContain(want);
      for (const bad of REFERENCE_STRINGS) expect(all, bad).not.toContain(bad.toUpperCase());
    });
  });

  describe("routing", () => {
    it("is never selected by production routing while pending owner approval", () => {
      for (const data of [real, ref]) {
        const production = buildRenderLayout(data, theme);
        expect(production.fit.ok ? production.fit.figmaMaster : undefined).toBeUndefined();
        expect(production.width).toBe(792);
      }
    });

    it("routes to the template in production only once owner approval and the layout are both approved", () => {
      const entry = TEMPLATE_CATALOG.find((t) => t.id === JEEP_WRANGLER_GAS_ID)!;
      const mutable = entry as { approval: string; layoutStatus: string };
      const saved = { approval: mutable.approval, layoutStatus: mutable.layoutStatus };
      try {
        mutable.approval = "approved";
        expect(buildRenderLayout(ref, theme).width).toBe(792);
        mutable.layoutStatus = "approved";
        const routed = buildRenderLayout(ref, theme);
        expect([routed.width, routed.height]).toEqual([1224, 792]);
        expect(routed.fit.ok && routed.fit.figmaMaster).toBe(true);
        expect(buildRenderLayout({ ...ref, identity: { ...ref.identity, year: "2025" } }, theme).width).toBe(792);
      } finally {
        Object.assign(mutable, saved);
      }
    });
  });

  describe("recorded routing flags", () => {
    it("matches 2026 gasoline SUV Wranglers as pending approval and flags other configurations unsupported", () => {
      expect(templateRoutingFacts(ref)).toMatchObject({ status: "pending_match", flags: ["template_pending_owner_approval"] });
      expect(templateRoutingFacts(real).flags).toEqual(["template_configuration_unsupported"]);
      const convertible = templateRoutingFacts({ ...ref, bodyClass: "Convertible" });
      expect(convertible.flags).toEqual(["template_configuration_unsupported"]);
    });

    it("never matches the 4xe plug-in hybrid and flags it unsupported", () => {
      const variants: FactoryStickerRenderData[] = [
        { ...ref, identity: { ...ref.identity, model: "Wrangler 4xe" } },
        { ...ref, identity: { ...ref.identity, trim: "Sahara 4xe" } },
        { ...ref, epa: { ...ref.epa!, fuelType: "Premium Gasoline and Electricity" } },
        { ...ref, epa: { ...ref.epa!, fuelType: "Plug-in Hybrid" } },
      ];
      expect(templateRoutingFacts(variants[3]).servedByApprovedMaster).toBe(true);
      for (const v of variants) {
        const facts = templateRoutingFacts(v);
        expect(facts.status).toBe("configuration_unsupported");
        expect(facts.flags).toEqual(facts.servedByApprovedMaster ? [] : ["template_configuration_unsupported"]);
        expect(facts.template).toBeNull();
      }
    });

    it("matches when the record states no drivetrain, but not a stated non-4WD drivetrain", () => {
      expect(templateRoutingFacts({ ...ref, mechanical: { engine: null, transmission: null, drivetrain: null } }).status).toBe("pending_match");
      expect(templateRoutingFacts({ ...ref, mechanical: { engine: null, transmission: null, drivetrain: "RWD" } }).status).toBe("configuration_unsupported");
    });
  });
});
