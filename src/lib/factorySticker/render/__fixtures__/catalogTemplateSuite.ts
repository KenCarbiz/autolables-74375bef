// Shared test suite for the catalog templates added after the Voyager: one
// config per template registers the same behavioural checks (page size, one
// page, banner and disclosure, data-only printing, EPA/NHTSA states, QR and
// barcode, no reference leakage, routing).

import { describe, expect, it } from "vitest";
import { buildRenderLayout, templateRoutingFacts, type FactoryStickerRenderData, type FactoryStickerTheme } from "../contract";
import { textBBox, type LayoutModel, type TextPrimitive } from "../layout";
import { expectNoTextOverlap, pageStrings } from "./layoutAsserts";
import { canonicalPassportUrl, PASSPORT_QR_CAPTION, REPRODUCTION_BANNER, REPRODUCTION_DISCLOSURE } from "../../reproduction";
import { encodeQrMatrix } from "../qrMatrix";
import { TEMPLATE_CATALOG, getCatalogTemplate, isRoutable } from "../../oem/templateCatalog";
import { PASSPORT_QR_PT } from "../variants/hyundaiTucsonGas";
import type { CatalogListing } from "./catalogRecord";

export interface CatalogSuiteConfig {
  title: string;
  templateId: string;
  make: string;
  model: string;
  stressLabel: string;
  /** The stress record is itself a supported configuration (the synthetic fixture). */
  stressMatches?: boolean;
  /** The stress record is another make, which has no catalog templates and so carries no routing flag. */
  stressOtherMake?: boolean;
  listing: () => CatalogListing;
  renderData: (l: CatalogListing) => FactoryStickerRenderData;
  referenceMatch: (base: FactoryStickerRenderData) => FactoryStickerRenderData;
  referenceVin: string;
  /** Upper-cased strings that exist only in the reference transcription. */
  referenceStrings: string[];
  /** Strings the reference-match render must print (from its data). */
  referenceExpect: string[];
  /** Strings a minimal record with the given own values must print. */
  ownExpect: string[];
  /** Heavy-duty reference: a California Air Resources Board panel, no EPA panel, optionally no safety panel. */
  /** Electric or plug-in reference: the EV fuel-economy panel instead of the gasoline one. */
  ev?: "ev" | "phev";
  /** A model year the template must not route (defaults to 2025; the 2025 reference passes 2026). */
  offYear?: string;
  /** Amount by which the reference sticker's own printed total exceeds its printed lines (the sample does not reconcile). */
  referenceGap?: number;
  /** Page size in points when the reference page is not 17x11. */
  pageSize?: [number, number];
  carb?: { safetyPanel: boolean; plainAmounts?: boolean };
  /** Records the template must match (pending approval) and must not match. */
  supported: Array<{ label: string; patch: (d: FactoryStickerRenderData) => FactoryStickerRenderData }>;
  unsupported: Array<{ label: string; patch: (d: FactoryStickerRenderData) => FactoryStickerRenderData }>;
}

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
const PRINTED_BANNER = norm(REPRODUCTION_BANNER.replace(/[–—]/g, "-"));

export function describeCatalogTemplate(c: CatalogSuiteConfig): void {
  const theme: FactoryStickerTheme = {
    oemThemeId: `oem-${c.make.toLowerCase()}`, oemThemeVersion: "1", canonicalOemId: c.make.toLowerCase(), templateFamilyId: "x",
    templateVersion: "1.0.0", logoAssetId: null, logoAssetVersion: null,
  };
  const sample = (d: FactoryStickerRenderData): LayoutModel => buildRenderLayout(d, theme, undefined, { sampleTemplateId: c.templateId });
  const texts = (m: LayoutModel): TextPrimitive[] => m.pages[0].primitives.filter((p): p is TextPrimitive => p.kind === "text");
  const dollar = (v: string): string => (c.carb?.plainAmounts ? v.replace(/[$]/g, "") : v);
  const listing = c.listing();
  const real = c.renderData(listing);
  const ref = c.referenceMatch(real);

  describe(`${c.title} template`, () => {
    describe(`layout stress test (${c.stressLabel}), not a production candidate`, () => {
      const m = sample(real);

      it("renders exactly one page that equals the catalog reference size", () => {
        const page = getCatalogTemplate(c.templateId)!.page;
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

      it("prints the priced options and the record's own pricing", () => {
        const printed = norm(m.drawnStrings.join(" "));
        for (const o of real.options.filter((x) => x.msrp)) expect(printed).toContain(dollar(`$${o.msrp!.toLocaleString("en-US")}.00`));
        for (const v of [real.pricing.baseMsrp, real.pricing.destinationCharge, real.pricing.totalMsrp]) {
          if (v !== null) expect(printed).toContain(dollar(`$${v.toLocaleString("en-US")}.00`));
        }
      });

      it("accounts for every equipment item: printed, or the selection note is shown; type is at least 5.5pt", () => {
        const counts = m.fit.ok ? m.fit.equipmentCounts : undefined;
        expect(counts).toBeDefined();
        if (counts!.printed < counts!.total) {
          expect(m.fit.ok && m.fit.equipmentScope).toBe("selected");
          expect(m.drawnStrings.join(" ")).toContain("Selected standard equipment shown.");
        } else {
          expect(counts!.printed).toBe(counts!.total);
        }
        for (const t of texts(m)) expect(t.size).toBeGreaterThanOrEqual(5.5);
      });

      it("keeps decoder fragments out of the equipment", () => {
        const all = m.drawnStrings.join(" | ");
        expect(all).not.toMatch(/Rating-\d|Standard-NHTSA|Standard-IIHS|Overall Rating/);
        for (const bad of ["V", "2", "FWD", "AWD", "4WD", "6-Cyl", "4-Cyl", "3-Cyl", "Unleaded", "Gasoline", "Poor", "In-Line"]) expect(m.printedEquipment, bad).not.toContain(bad);
      });

      it("prints EPA values from the record and explicit unavailable states for the rest", () => {
        const s = m.drawnStrings;
        if (real.neovin?.epaConflict) {
          expect(s.join(" ")).not.toMatch(/Electric Vehicle|Gasoline Vehicle|Diesel Vehicle|Plug-In Hybrid/);
          expect(s.join(" ")).not.toContain(`${Math.round(real.epa?.co2TailpipeGpm ?? -1)} grams CO2`);
          expect(s).toContain("Not Available");
          expect(s.join(" ")).toContain(c.carb ? "Environmental Performance" : "not available from verified EPA records");
          return;
        }
        if (c.carb) {
          const all = s.join(" ");
          expect(all).toContain("California Air Resources Board");
          expect(all).toContain("Environmental Performance");
          if (/^\s*electricity\s*$/i.test(real.epa?.fuelType ?? "") && real.carbMediumDutyEvidence) {
            // CARB fixes both ratings at A+ for a verified medium-duty vehicle whose only fuel is electricity.
            expect(s.filter((x) => x === "A+").length).toBe(4);
            expect(all).toContain("Does not include emissions from producing electricity.");
          } else {
            expect(s.filter((x) => x === "Not Available").length).toBeGreaterThanOrEqual(2);
            expect(all).not.toContain("Does not include emissions from producing electricity.");
          }
          expect(all).not.toMatch(/fueleconomy\.gov|Fuel Economy and Environment|5-year fuel cost/);
          expect(all).not.toMatch(/\$0\b/);
          return;
        }
        if (c.ev && real.epa && real.epa.combined !== null) {
          expect(s).toContain(String(real.epa.combined));
          expect(s).toContain(c.ev === "ev" ? "Electric Vehicle" : "Plug-In Hybrid Vehicle");
          expect(s).not.toContain("Gasoline Vehicle");
          expect(s.filter((x) => x === "Not Available" || x === "N/A").length).toBeGreaterThanOrEqual(1);
          expect(s.join(" ")).not.toMatch(/\$0\b/);
          return;
        }
        if (real.epa && real.epa.combined !== null) {
          expect(s).toContain(String(real.epa.combined));
          expect(s).toContain("Gasoline Vehicle");
          expect(s.join(" ")).toContain(`${Math.round(real.epa.co2TailpipeGpm ?? 0)} grams CO2`);
          expect(s).toContain("5-year fuel cost comparison");
        } else {
          expect(s.join(" ")).toContain("not available from verified EPA records");
          expect(s).not.toContain("Gasoline Vehicle");
        }
        expect(s.filter((x) => x === "Not Available").length).toBeGreaterThanOrEqual(1);
        expect(s.join(" ")).not.toMatch(/\$0\b/);
      });

      it("never splits combined NHTSA decode values into driver/passenger or seat rows", () => {
        const s = m.drawnStrings;
        if (c.carb && !c.carb.safetyPanel) return;
        if (s.includes("Overall Vehicle Score")) {
          expect(s).not.toContain("Driver");
          expect(s).not.toContain("Passenger");
          expect(s).not.toContain("Front seat");
          expect(s).not.toContain("Rear seat");
        } else {
          expect(s.join(" ")).toMatch(/safety ratings are not available|has not been rated/);
        }
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
          if (p.kind === "barcode" || p.kind === "image") expect(hits(p.x, p.y, p.x + p.w, p.y + p.h)).toBe(false);
        }
      });

      it("prints a barcode of the VIN", () => {
        const bc = m.pages[0].primitives.filter((p) => p.kind === "barcode");
        expect(bc).toHaveLength(1);
        expect((bc[0] as { payload: string }).payload).toBe(real.vin);
      });

      it("leaks nothing from the reference sample", () => {
        const all = norm(m.drawnStrings.join(" ")).toUpperCase();
        for (const bad of [c.referenceVin, ...c.referenceStrings]) expect(all, bad).not.toContain(bad.toUpperCase());
        for (const p of m.pages[0].primitives) {
          if (p.kind === "qr" || p.kind === "barcode") expect(p.payload).not.toContain(c.referenceVin);
        }
      });

      it("leaves the sold-to blocks blank unless the original delivering dealer is proven", () => {
        const proven = sample({
          ...real, dealerRole: "original_delivery",
          dealer: { name: "Original Test Rooftop", address: "1 Test Way", city: "Testville", state: "CT", zip: "06000", phone: null },
        });
        expect(proven.drawnStrings.join(" ")).toContain("ORIGINAL TEST ROOFTOP");
        expectNoTextOverlap(proven, 0);
        const current = sample({
          ...real, dealerRole: null, dealer: { name: "Current Selling Rooftop", address: null, city: null, state: null, zip: null, phone: null },
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
        const s = norm(m.drawnStrings.join(" | "));
        for (const v of c.referenceExpect) expect(s, v).toContain(dollar(v));
        const equipment = Object.values(ref.standardEquipment).flat();
        expect(m.fit.ok && m.fit.equipmentCounts).toMatchObject({ printed: equipment.length, total: equipment.length });
        expect(Math.min(...texts(m).map((t) => t.size))).toBeGreaterThanOrEqual(5.5);
      });

      it("reconciles the reference pricing", () => {
        const p = ref.pricing;
        expect(p.baseMsrp! + p.optionsTotal! + p.destinationCharge! + (c.referenceGap ?? 0)).toBe(p.totalMsrp);
        expect(ref.options.reduce((a, o) => a + (o.msrp ?? 0), 0) + ref.packages.reduce((a, o) => a + (o.msrp ?? 0), 0)).toBe(p.optionsTotal);
      });

      it("draws star ratings per row, and Not Rated / Not Available states, from the data, or no safety panel at all", () => {
        const stars = (d: FactoryStickerRenderData): number =>
          sample(d).pages[0].primitives.filter((p) => p.kind === "path" && p.w < 14 && p.h < 14 && p.fill === "#000000" && p.d.includes("L")).length;
        if (c.carb && !c.carb.safetyPanel) {
          const full = { ...ref, safety: { overall: 5, frontalDriver: 5, frontalPassenger: 4, sideFront: 5, sideRear: 4, rollover: 4 }, nhtsaNotRated: false };
          for (const d of [full, { ...ref, safety: null, nhtsaNotRated: true }, { ...ref, safety: null, nhtsaNotRated: false }]) {
            const model = sample(d);
            expect(stars(d)).toBe(0);
            expect(model.drawnStrings.join(" ")).not.toMatch(/5-STAR SAFETY|Overall Vehicle Score|Not Rated|not been rated by the government|verified NHTSA record/i);
          }
          return;
        }
        const full = { ...ref, safety: { overall: 5, frontalDriver: 5, frontalPassenger: 4, sideFront: 5, sideRear: 4, rollover: 4 }, nhtsaNotRated: false };
        expect(stars(full) - stars({ ...ref, safety: null, nhtsaNotRated: true })).toBe(5 + 5 + 4 + 5 + 4 + 4);
        const partial = sample({ ...full, safety: { overall: null, frontalDriver: 4, frontalPassenger: null, sideFront: 5, sideRear: 0, rollover: 3 } });
        expect(partial.drawnStrings.filter((x) => x === "Not Rated")).toHaveLength(3);
        expectNoTextOverlap(partial, 0);
        expect(sample({ ...ref, safety: null, nhtsaNotRated: true }).drawnStrings.join(" ")).toContain("This vehicle has not been rated by the government");
        expect(sample({ ...ref, safety: null, nhtsaNotRated: false }).drawnStrings.join(" ")).toContain("not available from a verified NHTSA record");
      });

      it("prints the CARB panel with unavailable scales whatever the EPA match holds", () => {
        if (!c.carb) return;
        const model = sample({ ...ref, epa: null, safety: null, nhtsaNotRated: false });
        const all = model.drawnStrings.join(" ");
        expect(all).toContain("California Air Resources Board");
        expect(model.drawnStrings.filter((x) => x === "Not Available").length).toBeGreaterThanOrEqual(2);
        expect(all).not.toContain("Overall Vehicle Score");
        expectNoTextOverlap(model, 0);
      });

      it("never prints a zero for unknown EPA and pricing values", () => {
        const sparse = sample({
          ...ref, pricing: { baseMsrp: null, destinationCharge: null, optionsTotal: null, totalMsrp: null }, epa: null, safety: null, nhtsaNotRated: false,
        });
        expect(sparse.fit.ok).toBe(true);
        const all = sparse.drawnStrings.join(" ");
        expect(all).not.toMatch(/(^|[^\d.,])\$?0\.00\b/);
        if (!c.carb) expect(all).toContain("not available from verified EPA records");
        expect(sparse.drawnStrings.filter((x) => x === "Not Available").length).toBeGreaterThanOrEqual(c.carb ? 2 : 3);
        expect(all).toContain("NOT AVAILABLE");
      });

      it("moves the greenhouse-gas pointer with the score and shows an unavailable state for bad scores, or keeps the CARB scales unavailable", () => {
        if (c.carb) {
          for (const score of [1, 5, 10]) {
            const model = sample({ ...ref, epa: { ...(ref.epa ?? { city: null, highway: null, combined: null, annualFuelCost: null, rangeMiles: null, fuelType: null }), ghgScore: score, smogScore: score } as typeof ref.epa });
            if (/^\s*electricity\s*$/i.test(ref.epa?.fuelType ?? "") && ref.carbMediumDutyEvidence) expect(model.drawnStrings.filter((x) => x === "A+")).toHaveLength(4);
            else expect(model.drawnStrings.filter((x) => x === "Not Available").length).toBeGreaterThanOrEqual(2);
            expect(texts(model).filter((t) => t.str === String(score) && t.color === "#ffffff" && t.align === "center")).toHaveLength(0);
          }
          return;
        }
        const xs: number[] = [];
        for (const score of [1, 5, 10]) {
          const model = sample({ ...ref, epa: { ...ref.epa!, ghgScore: score, smogScore: null } });
          const labels = texts(model).filter((t) => t.str === String(score) && t.color === "#ffffff" && t.align === "center");
          expect(labels.length).toBeGreaterThan(0);
          xs.push(labels.reduce((a, b) => (b.y < a.y ? b : a)).x);
        }
        expect(xs[0]).toBeLessThan(xs[1]);
        expect(xs[1]).toBeLessThan(xs[2]);
        const none = sample({ ...ref, epa: { ...ref.epa!, ghgScore: 0, smogScore: 11 } });
        expect(none.drawnStrings.filter((x) => x === "Not Available")).toHaveLength(2);
      });
    });

    describe("no hard-coded vehicle data", () => {
      const minimal: FactoryStickerRenderData = {
        ...real,
        vin: "1HGCM82633A000000", barcodePayload: "1HGCM82633A000000", passportUrl: "",
        identity: { year: "2026", make: c.make, model: c.model, trim: null },
        pricing: { baseMsrp: null, destinationCharge: null, optionsTotal: null, totalMsrp: null },
        packages: [], options: [], standardEquipment: {}, keyFeatures: {},
        colors: { exterior: { name: null, code: null }, interior: { name: null, code: null } },
        assembly: { plant: null, city: null, country: null }, mechanical: { engine: null, transmission: null, drivetrain: null },
        epa: null, safety: null, nhtsaNotRated: false, dealerRole: null,
        dealer: { name: null, address: null, city: null, state: null, zip: null, phone: null },
        warranty: undefined, partsContent: [], factoryCodes: { dealer: null, emissions: null }, transportMethod: null,
        neovin: undefined,
      };

      it("prints no reference-transcription value for an empty record", () => {
        const m = sample(minimal);
        expect(m.fit.ok).toBe(true);
        expectNoTextOverlap(m, 0);
        const all = norm(m.drawnStrings.join(" ")).toUpperCase();
        for (const bad of [c.referenceVin, ...c.referenceStrings]) expect(all, bad).not.toContain(bad.toUpperCase());
        expect(all).toContain("STANDARD EQUIPMENT NOT AVAILABLE FOR THIS VEHICLE");
        expect(all).toContain("NOT AVAILABLE FOR THIS VEHICLE");
        expect(all).not.toContain("GASOLINE VEHICLE");
        expect(all).not.toContain("DIESEL VEHICLE");
      });

      it("prints a record's own values and none of the reference's", () => {
        const other: FactoryStickerRenderData = {
          ...minimal,
          identity: { year: "2026", make: c.make, model: c.model, trim: "Zeta" },
          pricing: { baseMsrp: 43000, destinationCharge: 1995, optionsTotal: 0, totalMsrp: 44995 },
          colors: { exterior: { name: "Bright Test Color", code: "XYZ" }, interior: { name: "Dark Test", code: null } },
          mechanical: { engine: "Test 9.9L Engine", transmission: "Test Gearbox", drivetrain: null },
        };
        const m = sample(other);
        const all = norm(m.drawnStrings.join(" ")).toUpperCase();
        for (const want of ["ZETA", "BRIGHT TEST COLOR (XYZ)", "$43,000.00", "$44,995.00", ...c.ownExpect]) expect(all, want).toContain(dollar(want));
        for (const bad of [c.referenceVin, ...c.referenceStrings.filter((b) => b !== "1,995")]) expect(all, bad).not.toContain(bad.toUpperCase());
      });
    });

    describe("routing", () => {
      const entry = () => TEMPLATE_CATALOG.find((t) => t.id === c.templateId)!;
      const withState = (approval: string, layoutStatus: string, fn: () => void) => {
        const mutable = entry() as { approval: string; layoutStatus: string };
        const saved = { approval: mutable.approval, layoutStatus: mutable.layoutStatus };
        try {
          Object.assign(mutable, { approval, layoutStatus });
          fn();
        } finally {
          Object.assign(mutable, saved);
        }
      };

      it("is never selected by production routing while pending owner approval", () => {
        withState("pending_owner_approval", "sample_ready", () => {
          for (const data of [real, ref]) {
            const production = buildRenderLayout(data, theme);
            expect(production.fit.ok ? production.fit.figmaMaster : undefined).toBeUndefined();
            expect(production.width).toBe(792);
          }
        });
      });

      it("routes to the template in production only once owner approval and the layout are both approved", () => {
        withState("approved", "sample_ready", () => {
          expect(buildRenderLayout(ref, theme).width).toBe(792);
        });
        withState("approved", "approved", () => {
          const routed = buildRenderLayout(ref, theme);
          expect([routed.width, routed.height]).toEqual(c.pageSize ?? [1224, 792]);
          expect(routed.fit.ok && routed.fit.figmaMaster).toBe(true);
          expect(buildRenderLayout({ ...ref, identity: { ...ref.identity, year: c.offYear ?? "2025" } }, theme).width).toBe(792);
        });
      });

      it("routes production exactly as the catalog's recorded owner decision says", () => {
        const routed = buildRenderLayout(ref, theme);
        if (isRoutable(entry())) {
          expect([routed.width, routed.height]).toEqual(c.pageSize ?? [1224, 792]);
          expect(routed.fit.ok && routed.fit.figmaMaster).toBe(true);
          expect(templateRoutingFacts(ref)).toMatchObject({ status: "approved_match", flags: [] });
        } else {
          expect(routed.width).toBe(792);
          expect(templateRoutingFacts(ref)).toMatchObject({ status: "pending_match", flags: ["template_pending_owner_approval"] });
        }
      });

      it("matches the supported configurations as pending approval while pending", () => {
        withState("pending_owner_approval", "sample_ready", () => {
          expect(templateRoutingFacts(ref)).toMatchObject({ status: "pending_match", flags: ["template_pending_owner_approval"] });
          for (const s of c.supported) expect(templateRoutingFacts(s.patch(ref)), s.label).toMatchObject({ status: "pending_match" });
        });
      });

      it("flags the stress record and every unsupported configuration", () => {
        withState("pending_owner_approval", "sample_ready", () => {
          expect(templateRoutingFacts(real).flags).toEqual(c.stressOtherMake ? [] : [
            ...(c.stressMatches ? ["template_pending_owner_approval"] : ["template_configuration_unsupported"]),
            ...(real.neovin?.epaConflict ? ["epa_match_conflict"] : []),
          ]);
        });
        for (const u of c.unsupported) {
          const facts = templateRoutingFacts(u.patch(ref));
          expect(facts.flags, u.label).toEqual(["template_configuration_unsupported"]);
          expect(facts.template, u.label).toBeNull();
        }
      });
    });
  });
}
