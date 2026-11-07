import { describe, expect, it } from "vitest";
import { buildRenderLayout, equipmentBase, templateRoutingFacts, type FactoryStickerRenderData, type FactoryStickerTheme } from "../contract";
import { withCatalogEquipment } from "../catalogEquipment";
import { textBBox, type LayoutModel, type TextPrimitive } from "../layout";
import { expectNoTextOverlap, pageStrings } from "../__fixtures__/layoutAsserts";
import { REFERENCE_MATCH_VIN, referenceMatchData, tucsonListings, tucsonRenderData } from "../__fixtures__/tucson";
import { canonicalPassportUrl, PASSPORT_QR_CAPTION, REPRODUCTION_BANNER, REPRODUCTION_DISCLOSURE } from "../../reproduction";
import { encodeQrMatrix } from "../qrMatrix";
import { TEMPLATE_CATALOG, getCatalogTemplate } from "../../oem/templateCatalog";
import { HYUNDAI_TUCSON_GAS_ID, PASSPORT_QR_PT, scaleState } from "./hyundaiTucsonGas";

const theme: FactoryStickerTheme = {
  oemThemeId: "oem-hyundai", oemThemeVersion: "1", canonicalOemId: "hyundai", templateFamilyId: "x",
  templateVersion: "1.0.0", logoAssetId: null, logoAssetVersion: null,
};
const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
const PRINTED_BANNER = norm(REPRODUCTION_BANNER.replace(/[–—]/g, "-"));

const sample = (d: FactoryStickerRenderData): LayoutModel =>
  buildRenderLayout(d, theme, undefined, { sampleTemplateId: HYUNDAI_TUCSON_GAS_ID });

const listings = tucsonListings();
const records = listings.map(tucsonRenderData);
const texts = (m: LayoutModel): TextPrimitive[] =>
  m.pages[0].primitives.filter((p): p is TextPrimitive => p.kind === "text");

describe("Hyundai Tucson gasoline template", () => {
  for (const [i, data] of records.entries()) {
    describe(`real record ${data.vin}`, () => {
      const m = sample(data);

      it("renders exactly one 1224x792 page that equals the catalog reference size", () => {
        const ref = getCatalogTemplate(HYUNDAI_TUCSON_GAS_ID)!.page;
        expect(m.fit.ok).toBe(true);
        expect(m.pages).toHaveLength(1);
        expect([m.width, m.height]).toEqual([ref.widthPt, ref.heightPt]);
        expect(pageStrings(m, 0)).toContain("PAGE 1 OF 1");
      });

      it("prints the banner, disclosure and the VIN, without overlapping text", () => {
        const strings = pageStrings(m, 0);
        expect(strings).toContain(PRINTED_BANNER);
        expect(norm(strings.join(" "))).toContain(norm(REPRODUCTION_DISCLOSURE));
        expect(strings.filter((s) => s.includes(data.vin)).length).toBeGreaterThanOrEqual(3);
        expectNoTextOverlap(m, 0);
      });

      it("prints every priced option, the freight and a reconciled total", () => {
        const printed = norm(m.drawnStrings.join(" "));
        for (const o of data.options) {
          expect(printed).toContain(o.name);
          expect(printed).toContain(`$${o.msrp!.toFixed(2)}`);
        }
        const p = data.pricing;
        expect(printed).toContain(`$${p.baseMsrp!.toLocaleString("en-US")}.00`);
        expect(printed).toContain(`$${p.destinationCharge!.toLocaleString("en-US")}.00`);
        expect(printed).toContain(`$${p.totalMsrp!.toLocaleString("en-US")}.00`);
        expect(p.baseMsrp! + p.optionsTotal! + p.destinationCharge!).toBe(p.totalMsrp);
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

      it("prints a curated standard-features list in Hyundai's hierarchy at 8pt, from the VIN's own items only", () => {
        expect(m.fit.ok && m.fit.equipmentScope).toBe("selected");
        expect(m.fit.ok && m.fit.equipmentFontPt).toBeGreaterThanOrEqual(7.9);
        const printed = m.printedEquipment ?? [];
        expect(printed.length).toBeGreaterThanOrEqual(30);
        expect(printed.length).toBeLessThanOrEqual(70);
        const own = new Set([...Object.values(data.standardEquipment), ...Object.values(data.keyFeatures)].flat().map((x) => x.trim().toUpperCase()));
        const sources = new Set(equipmentBase(withCatalogEquipment(data, HYUNDAI_TUCSON_GAS_ID)).lines.flatMap((l) => l.sources).map((x) => x.toUpperCase()));
        for (const sItem of sources) expect(own.has(sItem)).toBe(true);
        const strings = pageStrings(m, 0);
        const order = ["ADVANCED SAFETY TECHNOLOGIES", "POWERTRAIN TECHNOLOGY", "EXTERIOR", "COMFORT & CONVENIENCE", "MULTIMEDIA & CONNECTIVITY"]
          .map((h) => strings.indexOf(h));
        expect(order.every((x) => x >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        // The full list stays in the data the Vehicle Passport reads.
        expect(Object.values(data.standardEquipment).flat().length).toBeGreaterThan(printed.length * 3);
      });

      it("titles the vehicle AWD, Hyundai's term for the four-wheel Tucson the decode calls 4WD", () => {
        expect(data.mechanical?.drivetrain).toBe("AWD");
        expect(pageStrings(m, 0)).toContain(`2026 TUCSON ${data.identity.trim!.toUpperCase()} AWD`);
        expect(m.drawnStrings.join(" ")).not.toMatch(/\b4WD\b/);
      });

      it("keeps every parts-content line and names the values the source lacks", () => {
        const all = m.drawnStrings.join(" ");
        expect(all).toContain("U.S./CANADIAN PARTS CONTENT: NOT AVAILABLE");
        expect(all).toContain("ENGINE: NOT AVAILABLE");
        expect(all).toContain("TRANSMISSION: NOT AVAILABLE");
        expect(all).toContain("COUNTRY OF FINAL ASSEMBLY: USA");
        expect(all).toContain("NOT AVAILABLE: not in the verified source data for this VIN.");
      });

      it("prints EPA values from the record and explicit unavailable states for the rest", () => {
        const s = m.drawnStrings;
        expect(s).toContain("26");
        expect(s).toContain("Gasoline Vehicle");
        // Smog rating and the 5-year comparison are not in the saved EPA record.
        expect(s.filter((x) => x === "Not Available").length).toBe(2);
        expect(s).toContain("5-year fuel cost");
        expect(s.join(" ")).toContain("$2,450");
        expect(s).toContain("Overall Vehicle Score");
        expect(s).not.toContain("Driver");
        expect(s).not.toContain("Front seat");
        expect(s.join(" ")).toContain("COUNTRY OF FINAL ASSEMBLY: USA");
        expect(s).toContain("5");
        expect(m.drawnStrings.join(" ")).toContain("337 grams CO2");
        expect(s).not.toContain("0");
      });

      it("prints a Passport QR of 0.90in with the canonical payload and a clear quiet zone", () => {
        const qrs = m.pages[0].primitives.filter((p) => p.kind === "qr");
        expect(qrs).toHaveLength(1);
        const qr = qrs[0] as { x: number; y: number; size: number; payload: string };
        expect(qr.payload).toBe(canonicalPassportUrl(String(listings[i].slug)));
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
        expect((bc[0] as { payload: string }).payload).toBe(data.vin);
      });

      it("leaks nothing from the reference sample", () => {
        const all = norm(m.drawnStrings.join(" ")).toUpperCase();
        expect(all).not.toContain(REFERENCE_MATCH_VIN);
        expect(all).not.toContain("MILLENNIUM");
        expect(all).not.toContain("NY126");
        for (const p of m.pages[0].primitives) {
          if (p.kind === "qr" || p.kind === "barcode") expect(p.payload).not.toContain(REFERENCE_MATCH_VIN);
        }
      });

      it("omits the dealer block unless the original delivering dealer is proven", () => {
        expect(m.drawnStrings.join(" ")).not.toMatch(/SOLD TO/);
        const proven = sample({
          ...data, dealerRole: "original_delivery",
          dealer: { name: "Original Test Hyundai", address: "1 Test Way", city: "Testville", state: "CT", zip: "06000", phone: null },
        });
        expect(proven.drawnStrings.join(" ")).toContain("ORIGINAL TEST HYUNDAI");
        expectNoTextOverlap(proven, 0);
        const current = sample({
          ...data, dealer: { name: "Current Selling Rooftop", address: null, city: null, state: null, zip: null, phone: null },
        });
        expect(current.drawnStrings.join(" ")).not.toContain("CURRENT SELLING ROOFTOP");
      });
    });
  }

  describe("reference-match fixture (visual comparison only)", () => {
    const ref = referenceMatchData(records[0]);
    const m = sample(ref);

    it("renders one page with every reference value from data and no overlap", () => {
      expect(m.fit.ok).toBe(true);
      expect(m.pages).toHaveLength(1);
      expectNoTextOverlap(m, 0);
      const s = m.drawnStrings;
      for (const v of ["26", "24", "30", "$1,900", "$1,000", "6", "5", "KOREA: 31 %", "$33,125.00"]) {
        expect(s.join(" | ")).toContain(v);
      }
      const equipment = Object.values(ref.standardEquipment).flat();
      expect(m.fit.ok && m.fit.equipmentCounts).toMatchObject({ printed: equipment.length, total: equipment.length });
    });

    it("prints star ratings 1-5, Not Rated and Not Available", () => {
      const stars = (d: FactoryStickerRenderData): number =>
        sample(d).pages[0].primitives.filter((p) => p.kind === "path" && p.w < 12 && p.h < 12 && p.fill === "#000000").length;
      const base = stars(ref);
      const lower = stars({ ...ref, safety: { overall: 3, frontalDriver: 1, frontalPassenger: 2, sideFront: 3, sideRear: 4, rollover: 5 } });
      expect(base).toBeGreaterThan(lower - 100);
      const notRated = sample({ ...ref, safety: null, nhtsaNotRated: true });
      expect(notRated.drawnStrings.filter((x) => x === "Not Rated")).toHaveLength(6);
      const none = sample({ ...ref, safety: { overall: null, frontalDriver: 4, frontalPassenger: null, sideFront: 5, sideRear: 0, rollover: 3 } });
      expect(none.drawnStrings.filter((x) => x === "Not Rated")).toHaveLength(3);
      const unavailable = sample({ ...ref, safety: null });
      expect(unavailable.drawnStrings.filter((x) => x === "Not Available")).toHaveLength(6);
    });

    it("never prints a zero for unknown EPA and pricing values", () => {
      const sparse = sample({
        ...ref,
        pricing: { baseMsrp: null, destinationCharge: null, optionsTotal: null, totalMsrp: null },
        epa: null, safety: null,
      });
      expect(sparse.fit.ok).toBe(true);
      const all = sparse.drawnStrings.join(" ");
      expect(all).not.toMatch(/(^|[^\d.,])\$?0\.00\b/);
      expect(all).toContain("not available from verified EPA records");
    });

    it("shows an unavailable state for a missing or invalid scale score, never a pointer", () => {
      for (const bad of [0, 11, 5.5, Number.NaN]) {
        expect(scaleState(bad).kind).toBe("unavailable");
      }
      expect(scaleState(undefined).kind).toBe("unavailable");
      const noGhg = sample({ ...ref, epa: { ...ref.epa!, ghgScore: null, smogScore: null } });
      expect(noGhg.drawnStrings.filter((x) => x === "Not Available")).toHaveLength(2);
    });

    it("moves the scale pointer with the score", () => {
      const xs: number[] = [];
      for (const score of [1, 5, 10]) {
        const model = sample({ ...ref, epa: { ...ref.epa!, ghgScore: score, smogScore: null } });
        const label = texts(model).find((t) => t.str === String(score) && t.color === "#ffffff" && t.x > 861 && t.x < 1070 && t.align === "center");
        expect(label).toBeDefined();
        xs.push(label!.x);
      }
      expect(xs[0]).toBeLessThan(xs[1]);
      expect(xs[1]).toBeLessThan(xs[2]);
    });
  });

  describe("scale model", () => {
    it("maps 1-10 onto the scale and rejects everything else", () => {
      expect(scaleState(1)).toEqual({ kind: "scored", score: 1, position: 0.05 });
      expect(scaleState(10)).toEqual({ kind: "scored", score: 10, position: 0.95 });
      expect(scaleState(null)).toEqual({ kind: "unavailable" });
    });
  });

  describe("routing", () => {
    it("is never selected by production routing while pending owner approval", () => {
      for (const data of [...records, referenceMatchData(records[0])]) {
        const production = buildRenderLayout(data, theme);
        expect(production.fit.ok ? production.fit.figmaMaster : undefined).toBeUndefined();
        expect(production.width).toBe(792);
      }
    });

    it("routes to the template in production only once owner approval and the layout are both approved", () => {
      const entry = TEMPLATE_CATALOG.find((t) => t.id === HYUNDAI_TUCSON_GAS_ID)!;
      const mutable = entry as { approval: string; layoutStatus: string };
      const saved = { approval: mutable.approval, layoutStatus: mutable.layoutStatus };
      try {
        mutable.approval = "approved";
        const half = buildRenderLayout(records[0], theme);
        expect(half.width).toBe(792);
        mutable.layoutStatus = "approved";
        const routed = buildRenderLayout(records[0], theme);
        expect([routed.width, routed.height]).toEqual([1224, 792]);
        expect(routed.fit.ok && routed.fit.figmaMaster).toBe(true);
        const wrongYear = buildRenderLayout({ ...records[0], identity: { ...records[0].identity, year: "2025" } }, theme);
        expect(wrongYear.width).toBe(792);
      } finally {
        Object.assign(mutable, saved);
      }
    });
  });

  describe("recorded routing flags", () => {
    it("records pending approval for a matching configuration and unsupported for the rest of the make", () => {
      expect(templateRoutingFacts(records[0])).toMatchObject({ status: "pending_match", flags: ["template_pending_owner_approval"] });
      const y2025 = templateRoutingFacts({ ...records[0], identity: { ...records[0].identity, year: "2025" } });
      expect(y2025.flags).toEqual(["template_configuration_unsupported"]);
      const diesel = templateRoutingFacts({ ...records[0], epa: { ...records[0].epa!, fuelType: "Diesel" } });
      expect(diesel.flags).toEqual(["template_configuration_unsupported"]);
      const sedan = templateRoutingFacts({ ...records[0], bodyClass: "Sedan" });
      expect(sedan.flags).toEqual(["template_configuration_unsupported"]);
    });

    it("records nothing for a vehicle an approved master already serves, or a make without catalog templates", () => {
      const hybrid = templateRoutingFacts({
        ...records[0], identity: { ...records[0].identity, model: "Santa Fe Hybrid" }, epa: { ...records[0].epa!, fuelType: "Gasoline Hybrid" },
      });
      expect(hybrid.servedByApprovedMaster).toBe(true);
      expect(hybrid.flags).toEqual([]);
      const other = templateRoutingFacts({ ...records[0], identity: { ...records[0].identity, make: "Mazda" } });
      expect(other).toMatchObject({ status: "no_catalog_for_make", flags: [] });
    });
  });
});
