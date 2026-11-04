import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import {
  APP_BASE, approvePublish, buildListing, loadFixture, newStore, passportUrlFor,
  publishedDocs, runOrchestrate, sha256,
  type Fixture, type FixtureVehicle, type Listing, type Outcome, type Store,
} from "./harness";
import { adaptRenderData, fuelClassOf, MAKE_WIDE_MASTERS, MASTER_APPROVAL, masterFor, type FuelClass } from "../render/contract";
import { resolveReferenceVariant } from "../oem/referenceVariants";
import { encodeQrMatrix } from "../render/qrMatrix";
import { REPRODUCTION_BANNER, REPRODUCTION_DISCLOSURE, FACTORY_BUILD_UNVERIFIED } from "../reproduction";
import { isRatingMetadata } from "../oem/sourceCorrections";
import { REGENERATION_REASONS } from "../regenerationReason";
import { validateTemplateOverride } from "../oem/selection";

type Filed = Extract<Outcome, { kind: "filed" }>;

const fx: Fixture = loadFixture();
const norm = (s: string): string => s.replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
const flatten = (m: Record<string, string[]> | undefined): string[] => Object.values(m ?? {}).flat();

const sourceItems = (l: Listing): Set<string> => {
  const sheet = (l.mc_attributes.build_sheet ?? {}) as Record<string, unknown>;
  return new Set([
    ...flatten(sheet.standard as Record<string, string[]> | undefined),
    ...flatten(sheet.key_features as Record<string, string[]> | undefined),
  ].map(norm));
};
const sourceOptionNames = (l: Listing): string[] => {
  const sheet = (l.mc_attributes.build_sheet ?? {}) as { options?: Array<{ name: string }> };
  return (sheet.options ?? []).map((o) => o.name);
};

const pageText = (o: Filed, page: number): string =>
  norm(o.model.pages[page].primitives.flatMap((p) => (p.kind === "text" ? [p.str] : [])).join(" "));

const printedEquipment = (o: Filed): string[] =>
  adaptRenderData(o.normalized.data).data.equipment.standard.flatMap((g) => g.items);

const untraceable = (o: Filed): string[] => {
  const src = sourceItems(o.listing);
  return printedEquipment(o).filter((i) => !src.has(norm(i)));
};

/** Source rows belonging to some other VIN in this inventory, never this one. */
const foreignItems = (o: Filed): string[] => {
  const src = sourceItems(o.listing);
  return fx.dict.filter((d) => !src.has(norm(d)));
};

type Held = Extract<Outcome, { kind: "one_page_review_required" }>;
type Rendered = Filed | Held;

type Route = "master_make_wide" | "generic_fallback" | "no_data" | "unsupported";
const routeOf = (o: Outcome): Route => {
  if (o.kind === "pending_data") return "no_data";
  if (o.kind === "ineligible" || o.kind === "selection_blocked") return "unsupported";
  return masterFor(o.normalized.data) ? "master_make_wide" : "generic_fallback";
};

const exactVariantRoute = (o: Outcome): boolean => {
  if (o.kind === "pending_data" || o.kind === "ineligible" || o.kind === "selection_blocked") return false;
  const d = o.normalized.data;
  const year = Number(d.identity.year);
  const m = resolveReferenceVariant({
    make: d.identity.make, modelYear: Number.isFinite(year) ? year : null, model: d.identity.model,
    trim: d.identity.trim, drivetrain: d.mechanical?.drivetrain ?? null, fuelType: d.epa?.fuelType ?? null,
  });
  return m.status === "matched" && m.rendering === "variant_layout";
};

const TRIM_TO_ITEMS = 56;
const PUBLISHED_N = 31;
const HELD_N = 5;

/**
 * A one-page-capable subset of a VIN's own saved rows: the first rows of its
 * verified standard equipment, nothing added. It exercises the full filing
 * pipeline for these VINs; it is never a substitute for the complete build.
 */
const trimmedListing = (l: Listing): Listing => {
  const sheet = { ...(l.mc_attributes.build_sheet as Record<string, unknown>) };
  let left = TRIM_TO_ITEMS;
  const standard: Record<string, string[]> = {};
  for (const [cat, items] of Object.entries((sheet.standard ?? {}) as Record<string, string[]>)) {
    if (left <= 0) break;
    standard[cat] = items.slice(0, left);
    left -= standard[cat].length;
  }
  return { ...l, mc_attributes: { ...l.mc_attributes, build_sheet: { ...sheet, standard, key_features: undefined } } };
};

let auto: Map<string, Outcome>;
let trimmed: Map<string, Outcome>;
const filedOf = (vin: string): Filed => {
  const o = trimmed.get(vin);
  if (!o || o.kind !== "filed") throw new Error(`${vin} was not rendered`);
  return o;
};

beforeAll(async () => {
  auto = new Map();
  trimmed = new Map();
  for (const v of fx.vehicles) {
    auto.set(v.v, await runOrchestrate(buildListing(fx, v), newStore()));
    if (v.bs) trimmed.set(v.v, await runOrchestrate(trimmedListing(buildListing(fx, v)), newStore()));
  }
}, 480_000);

const withSheet = fx.vehicles.filter((v) => v.bs);
const withoutSheet = fx.vehicles.filter((v) => !v.bs);

describe("fixture is the real Harte INFINITI new-vehicle inventory", () => {
  it("holds 44 distinct new vehicles, 39 with a saved build sheet", () => {
    expect(fx.vehicles).toHaveLength(44);
    expect(new Set(fx.vehicles.map((v) => v.v)).size).toBe(44);
    expect(withSheet).toHaveLength(39);
    expect(withoutSheet).toHaveLength(5);
    for (const v of fx.vehicles) expect(v.v).toMatch(/^[A-HJ-NPR-Z0-9]{17}$/);
  });

  it("carries no customer data, keys or signed URLs", () => {
    const raw = readFileSync(join(__dirname, "harteNewInventory.fixture.json"), "utf8");
    expect(raw).not.toMatch(/token=|X-Amz|apikey|api_key|secret|@[a-z0-9-]+\.[a-z]{2,}|\b\d{3}-\d{3}-\d{4}\b/i);
  });
});

describe("pending-data vehicles are refused, not rendered from generic data", () => {
  it.each(withoutSheet.map((v) => [v.v]))("%s parks PENDING_DATA with no document", async (vin) => {
    const o = auto.get(vin)!;
    expect(o.kind).toBe("pending_data");
    expect(o.autoPublish).toBe(false);
    const store = newStore();
    await runOrchestrate(buildListing(fx, fx.vehicles.find((v) => v.v === vin)!), store);
    expect(store.docs).toHaveLength(0);
    expect(store.record.current_document_id).toBeNull();
    expect(store.record.generation_status).toBe("PENDING_DATA");
  });
});

const renderable = withSheet.filter((v) => v.y && v.t);

describe("the trimmed subset of every identified build renders on one page", () => {
  it.each(renderable.map((v) => [v.v]))("%s files a one-page document", (vin) => {
    const o = trimmed.get(vin)!;
    expect(o.kind).toBe("filed");
  });
});

describe.each(renderable.map((v) => [v.v, `${v.y} ${v.t}`.trim()]))(
  "one-page generation of the verified subset %s (%s)",
  (vin) => {
    it("equipment comes only from this VIN's saved build sheet", () => {
      const o = filedOf(vin);
      expect(printedEquipment(o).length).toBeGreaterThan(0);
      expect(untraceable(o)).toEqual([]);
      const options = new Set(sourceOptionNames(o.listing).map(norm));
      for (const opt of o.normalized.data.options) expect(options.has(norm(opt.name)), opt.name).toBe(true);
      expect(o.normalized.data.options).toHaveLength(options.size === 0 ? 0 : sourceOptionNames(o.listing).length);
      expect(o.normalized.data.generic).toBe(false);
    });

    it("prints no row that belongs to a different VIN's build", () => {
      const o = filedOf(vin);
      const text = norm(o.rendered.layout.drawnStrings.join(" "));
      const exact = new Set(o.rendered.layout.drawnStrings.map(norm));
      const legit = new Set([
        ...sourceOptionNames(o.listing),
        String(o.listing.mc_attributes.engine ?? ""), String(o.listing.mc_attributes.transmission ?? ""),
        String(o.listing.mc_attributes.drivetrain ?? ""), String(o.normalized.data.epa?.fuelType ?? ""),
        o.normalized.data.mechanical?.drivetrain ?? "",
      ].map(norm));
      const sourceText = [...sourceItems(o.listing), ...legit].join(" | ");
      const leaked = foreignItems(o).filter((d) => {
        const n = norm(d);
        if (legit.has(n) || sourceText.includes(n)) return false;
        return n.length >= 12 ? text.includes(n) : exact.has(n);
      });
      expect(leaked).toEqual([]);
    });

    it("never prints decoder rating metadata as equipment or invents safety, warranty or parts content", () => {
      const o = filedOf(vin);
      expect(printedEquipment(o).filter(isRatingMetadata)).toEqual([]);
      expect(o.normalized.data.safety ?? null).toBeNull();
      expect(o.normalized.data.nhtsaNotRated ?? false).toBe(false);
      expect(o.normalized.data.warranty ?? null).toBeNull();
      expect(o.normalized.data.partsContent ?? null).toBeNull();
      const adapted = adaptRenderData(o.normalized.data).data;
      expect(adapted.regulatory.nhtsaStatus).toBe("UNAVAILABLE");
      expect(adapted.warranty).toBeUndefined();
      expect(adapted.factory.partsContent).toBeUndefined();
      const text = o.rendered.layout.drawnStrings.join(" ");
      expect(text).not.toMatch(/AALA|parts content|overall rating|rollover rating/i);
      if (/5-STAR SAFETY RATINGS/.test(text)) expect(text).toContain("Not Available");
      const starGlyphs = o.model.pages[0].primitives.filter((p) => p.kind === "path" && p.w >= 7 && p.w <= 8 && p.h >= 7 && p.h <= 8);
      expect(starGlyphs).toHaveLength(0);
    });

    it("EPA figures are the saved EPA row or absent", () => {
      const o = filedOf(vin);
      const v = fx.vehicles.find((x) => x.v === vin)!;
      if (!v.e) {
        expect(o.normalized.data.epa).toBeNull();
        expect(o.rendered.layout.drawnStrings.join(" ")).not.toMatch(/\bMPG\b/);
        return;
      }
      const epa = o.normalized.data.epa!;
      expect([epa.city, epa.highway, epa.combined, epa.annualFuelCost, epa.ghgScore, epa.fuelType, epa.co2TailpipeGpm]).toEqual(v.e);
      const drawn = new Set(o.rendered.layout.drawnStrings);
      if (masterFor(o.normalized.data)) {
        expect(drawn.has(`$${v.e[3].toLocaleString("en-US")}`)).toBe(true);
      } else {
        expect(o.rendered.layout.drawnStrings.join(" ")).toContain(`emits ${v.e[6]} grams CO2`);
      }
      expect(drawn.has(String(v.e[2]))).toBe(true);
      expect(drawn.has(String(v.e[0]))).toBe(true);
      expect(drawn.has(String(v.e[1]))).toBe(true);
    });

    it("MSRP reconciles (base + options + destination = total) or the document is held", () => {
      const o = filedOf(vin);
      const v = fx.vehicles.find((x) => x.v === vin)!;
      const pricing = (v.bs!.pricing ?? {}) as { base_msrp?: number; destination_charge?: number; total_msrp?: number };
      const optionSum = ((v.bs!.options ?? []) as Array<{ msrp?: number }>).reduce((a, x) => a + (x.msrp ?? 0), 0);
      expect(o.normalized.baseMsrp).toBe(pricing.base_msrp);
      expect(o.normalized.destinationCharge).toBe(pricing.destination_charge);
      expect(o.normalized.statedTotalMsrp).toBe(pricing.total_msrp);
      expect(o.normalized.optionsTotal ?? 0).toBe(optionSum);
      const rec = o.plan.reconciliation;
      const computed = (pricing.base_msrp ?? 0) + optionSum + (pricing.destination_charge ?? 0);
      expect(rec.computedCents).toBe(Math.round(computed * 100));
      const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
      const drawn = o.rendered.layout.drawnStrings;
      expect(drawn).toContain(money(pricing.base_msrp!));
      expect(drawn).toContain(money(pricing.total_msrp!));
      if (rec.status === "MATCHED") {
        expect(Math.abs(computed - pricing.total_msrp!)).toBeLessThanOrEqual(5);
      } else {
        expect(o.autoPublish).toBe(false);
        expect(o.assessment.decision.blockers.map((b) => b.code)).toContain("msrp_does_not_reconcile");
      }
    });

    it("renders a real PDF whose page count matches the layout", async () => {
      const o = filedOf(vin);
      expect(o.rendered.pdfBytes.byteLength).toBeGreaterThan(5_000);
      expect(Buffer.from(o.rendered.pdfBytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
      const pdf = await PDFDocument.load(o.rendered.pdfBytes);
      expect(pdf.getPageCount()).toBe(1);
      expect(o.rendered.layout.pages).toBe(1);
      expect(o.rendered.layout.fit.ok).toBe(true);
      const { width, height } = pdf.getPage(0).getSize();
      expect(Math.round(width)).toBe(792);
      expect(Math.round(height)).toBe(612);
    });

    it("QR encodes this vehicle's public passport URL and the barcode is the VIN", () => {
      const o = filedOf(vin);
      const url = passportUrlFor(o.listing);
      expect(o.passportUrl).toBe(url);
      expect(url).toBe(`${APP_BASE}/v/${o.listing.slug}`);
      expect(o.normalized.data.passportUrl).toBe(url);
      expect(o.normalized.data.barcodePayload).toBe(vin);
      const qrs = o.model.pages.flatMap((p) => p.primitives.filter((x) => x.kind === "qr"));
      const payloads = qrs.map((q) => (q.kind === "qr" ? q.payload : ""));
      expect(payloads).toContain(url);
      for (const p of payloads) expect([url, "https://fueleconomy.gov"]).toContain(p);
      const matrix = encodeQrMatrix(url);
      expect(matrix.size).toBeGreaterThan(20);
      const barcodes = o.model.pages[0].primitives.filter((x) => x.kind === "barcode");
      expect(barcodes.some((b) => b.kind === "barcode" && b.payload === vin)).toBe(true);
      expect(o.assessment.qaChecks.qr_is_canonical_passport).toBe(true);
      expect(o.assessment.qaChecks.barcode_is_vin).toBe(true);
      expect(o.assessment.qaChecks.vin_drawn).toBe(true);
    });

    it("reproduction banner and disclosure are printed on the single page", () => {
      const o = filedOf(vin);
      expect(o.model.pages.length).toBe(1);
      for (let i = 0; i < o.model.pages.length; i++) {
        const text = pageText(o, i);
        expect(text, `page ${i + 1} banner`).toContain(norm(REPRODUCTION_BANNER));
        expect(text, `page ${i + 1} disclosure`).toContain(norm(REPRODUCTION_DISCLOSURE));
        expect(text, `page ${i + 1} provenance`).toContain(norm(FACTORY_BUILD_UNVERIFIED));
      }
    });

    it("auto-publishes only when reconciliation MATCHED and every QA gate passes", () => {
      const o = filedOf(vin);
      const blockers = o.assessment.decision.blockers.map((b) => b.code);
      if (o.autoPublish) {
        expect(blockers).toEqual([]);
        expect(o.plan.reconciliation.status).toBe("MATCHED");
        expect(o.assessment.qaPass).toBe(true);
        expect(o.assessment.completeness.pass).toBe(true);
        expect(o.assessment.geometry.pass).toBe(true);
        expect(o.normalized.confidence).toBe("HIGH");
        expect(o.plan.selection.selectionStatus).toBe("selected");
        expect(o.status).toBe("PUBLISHED");
      } else {
        expect(blockers.length).toBeGreaterThan(0);
        expect(o.status).toBe("REVIEW_REQUIRED");
      }
    });
  },
);

describe("document versioning and publication controls through manual generation", () => {
  const sample = (pred: (o: Filed) => boolean): FixtureVehicle[] =>
    withSheet.filter((v) => {
      const o = trimmed.get(v.v);
      return o?.kind === "filed" && pred(o);
    });

  const corrected = (l: Listing): Listing => ({
    ...l,
    mc_attributes: {
      ...l.mc_attributes,
      build_sheet: {
        ...(l.mc_attributes.build_sheet as Record<string, unknown>),
        colors: {
          exterior: { code: "ZZZ", name: "Corrected Exterior Name" },
          interior: { code: "G", name: "Corrected Interior Name" },
        },
      },
    },
  });

  const invariants = (store: Store): void => {
    expect(publishedDocs(store).length).toBeLessThanOrEqual(1);
    const versions = store.docs.map((d) => d.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (const d of store.docs) {
      if (d.document_status === "superseded") {
        const by = store.docs.find((x) => x.id === d.superseded_by);
        expect(by, `${d.id} superseded_by`).toBeTruthy();
        expect(by!.version).toBeGreaterThan(d.version);
      }
    }
  };

  it("an auto-published vehicle: manual regenerate of unchanged data is a no-op on versions", { timeout: 180_000 }, async () => {
    for (const v of sample((o) => o.autoPublish)) {
      const listing = trimmedListing(buildListing(fx, v));
      const store = newStore();
      const first = await runOrchestrate(listing, store) as Filed;
      expect(first.version).toBe(1);
      expect(store.docs.map((d) => d.document_status)).toEqual(["published"]);
      const again = await runOrchestrate(listing, store, { regeneration: { reasonCode: "additional_source_data_available" } }) as Filed;
      expect(again.filing.action).toBe("reuse_identical");
      expect(again.version).toBe(1);
      expect(store.docs).toHaveLength(1);
      invariants(store);
    }
  });

  it("an auto-published vehicle: manual regenerate with corrected data is v2, v1 retained as superseded", { timeout: 180_000 }, async () => {
    let checked = 0;
    for (const v of sample((o) => o.autoPublish)) {
      const store = newStore();
      await runOrchestrate(trimmedListing(buildListing(fx, v)), store);
      const second = await runOrchestrate(corrected(trimmedListing(buildListing(fx, v))), store, {
        regeneration: { reasonCode: "vehicle_information_corrected" },
      }) as Filed;
      expect(second.version).toBe(2);
      expect(second.filing.action).toBe("insert");
      expect(store.docs.map((d) => [d.version, d.document_status])).toEqual([[1, "superseded"], [2, "published"]]);
      expect(store.docs[0].superseded_by).toBe(store.docs[1].id);
      expect(store.docs[1].generated_by).toBe("user");
      expect(store.docs[1].regeneration_reason_code).toBe("vehicle_information_corrected");
      expect(store.docs[0].pdfBytes.byteLength).toBeGreaterThan(0);
      invariants(store);
      checked++;
    }
    expect(checked).toBe(sample((o) => o.autoPublish).length);
  });

  it("a held vehicle is never published by any generation, only by explicit approval", { timeout: 180_000 }, async () => {
    const held = sample((o) => !o.autoPublish);
    expect(held.length).toBeGreaterThan(0);
    for (const v of held) {
      const store = newStore();
      await runOrchestrate(trimmedListing(buildListing(fx, v)), store);
      expect(store.docs.map((d) => d.document_status)).toEqual(["pending_approval"]);
      await runOrchestrate(trimmedListing(buildListing(fx, v)), store, { regeneration: { reasonCode: "pdf_or_layout_problem" } });
      await runOrchestrate(corrected(trimmedListing(buildListing(fx, v))), store, { regeneration: { reasonCode: "msrp_corrected" } });
      expect(publishedDocs(store)).toHaveLength(0);
      expect(store.record.generation_status).toBe("REVIEW_REQUIRED");
      expect(store.record.review_required).toBe(true);
      expect(store.record.review_reason).toBeTruthy();
      invariants(store);
    }
  });

  it("a human-approved v1 stays public while a held regeneration waits as v2, then v2 supersedes it", { timeout: 180_000 }, async () => {
    for (const v of sample((o) => !o.autoPublish).slice(0, 8)) {
      const store = newStore();
      await runOrchestrate(trimmedListing(buildListing(fx, v)), store);
      approvePublish(store);
      expect(store.docs.map((d) => [d.version, d.document_status])).toEqual([[1, "published"]]);
      const second = await runOrchestrate(corrected(trimmedListing(buildListing(fx, v))), store, {
        regeneration: { reasonCode: "options_or_packages_corrected" },
      }) as Filed;
      expect(second.autoPublish).toBe(false);
      expect(second.version).toBe(2);
      expect(store.docs.map((d) => [d.version, d.document_status])).toEqual([[1, "published"], [2, "pending_approval"]]);
      invariants(store);
      approvePublish(store);
      expect(store.docs.map((d) => [d.version, d.document_status])).toEqual([[1, "superseded"], [2, "published"]]);
      expect(store.docs[0].superseded_by).toBe(store.docs[1].id);
      invariants(store);
    }
  });

  it("a manual layout override is never auto-published, and never replaces a public document without approval", { timeout: 180_000 }, async () => {
    const override = { template_key: "oem-autolabels-fallback", reason: "dealer prefers neutral layout" };
    for (const v of sample((o) => o.autoPublish)) {
      const store = newStore();
      await runOrchestrate(trimmedListing(buildListing(fx, v)), store);
      const second = await runOrchestrate(trimmedListing(buildListing(fx, v)), store, {
        regeneration: { reasonCode: "wrong_template_selected" }, storedOverride: override,
      }) as Filed;
      expect(second.plan.appliedOverride).not.toBeNull();
      expect(second.assessment.decision.blockers.map((b) => b.code)).toContain("template_override_active");
      expect(second.autoPublish).toBe(false);
      expect(second.version).toBe(2);
      expect(store.docs.map((d) => [d.version, d.document_status])).toEqual([[1, "published"], [2, "pending_approval"]]);
      expect(publishedDocs(store)[0].version).toBe(1);
      invariants(store);
    }
  });

  it("an override naming another manufacturer is discarded and the automatic decision stands", async () => {
    const v = sample((o) => o.autoPublish)[0];
    const store = newStore();
    const o = await runOrchestrate(trimmedListing(buildListing(fx, v)), store, {
      regeneration: { reasonCode: "wrong_template_selected" },
      storedOverride: { template_key: "oem-bmw", reason: "wrong brand" },
    }) as Filed;
    expect(o.plan.appliedOverride).toBeNull();
    expect(o.plan.overrideDiscarded?.requested).toBe("oem-bmw");
    expect(o.plan.theme.templateOverrideKey).toBeNull();
    expect(o.autoPublish).toBe(true);
    expect(validateTemplateOverride(o.plan.selection.canonicalMake, "oem-bmw", 2027).allowed).toBe(false);
  });

  it("a regeneration without a recorded reason is refused", async () => {
    const listing = trimmedListing(buildListing(fx, withSheet[0]));
    await expect(runOrchestrate(listing, newStore(), { regeneration: { reasonCode: "because" } })).rejects.toThrow("reason_required");
    await expect(runOrchestrate(listing, newStore(), { regeneration: { reasonCode: "other" } })).rejects.toThrow("reason_notes_required");
    expect(REGENERATION_REASONS).toContain("msrp_corrected");
  });
});

describe("missing or generic source information never becomes equipment", () => {
  const base = (): Listing => trimmedListing(buildListing(fx, withSheet.find((v) => v.t === "LUXE" && v.y === "2027 INFINITI QX60")!));
  const strip = (l: Listing, patch: (s: Record<string, unknown>) => Record<string, unknown>): Listing => ({
    ...l,
    mc_attributes: { ...l.mc_attributes, build_sheet: patch({ ...(l.mc_attributes.build_sheet as Record<string, unknown>) }) },
  });

  it("a sheet with no equipment rows prints no equipment and is held", async () => {
    const l = strip(base(), (s) => ({ ...s, standard: undefined, key_features: undefined }));
    const store = newStore();
    const o = await runOrchestrate(l, store) as Filed;
    expect(printedEquipment(o)).toEqual([]);
    const drawn = new Set(o.rendered.layout.drawnStrings.map(norm));
    const leaked = fx.dict.filter((d) => d.length >= 8 && drawn.has(norm(d)));
    expect(leaked).toEqual([]);
  });

  it("a sheet with no base MSRP is parked and no document or total is invented", async () => {
    const l = strip(base(), (s) => ({ ...s, pricing: { destination_charge: 1545 } }));
    const store = newStore();
    const o = await runOrchestrate(l, store);
    expect(o.kind).toBe("ineligible");
    expect(o.autoPublish).toBe(false);
    expect(store.docs).toHaveLength(0);
    expect(store.record.generation_status).toBe("REVIEW_REQUIRED");
  });

  it("a feed asking price is never promoted to the manufacturer total", async () => {
    const l = strip(base(), (s) => ({ ...s, pricing: { base_msrp: 59390, destination_charge: 1545 } }));
    l.mc_attributes.msrp = 62335;
    l.price = 62335;
    const store = newStore();
    const o = await runOrchestrate(l, store);
    expect(o.kind).toBe("ineligible");
    expect(store.docs).toHaveLength(0);
  });

  it("a generic (typical-for-trim) decode is labelled, graded LOW and never auto-published as VIN-specific", async () => {
    const l = strip(base(), (s) => ({ ...s, generic: true }));
    const o = await runOrchestrate(l, newStore());
    if (o.kind === "filed") {
      expect(o.autoPublish).toBe(false);
      expect(o.normalized.confidence).toBe("LOW");
      expect(o.normalized.data.generic).toBe(true);
      expect(o.rendered.layout.drawnStrings.join(" ")).toMatch(/typical for this trim/i);
    } else {
      expect(o.autoPublish).toBe(false);
    }
  });

  it("no EPA row means no mileage figures", async () => {
    const l = base();
    l.epa_economy = null;
    const o = await runOrchestrate(l, newStore()) as Filed;
    expect(o.normalized.data.epa).toBeNull();
    expect(o.rendered.layout.drawnStrings.join(" ")).not.toMatch(/\bMPG\b/);
  });
});

describe("the orchestrator runs the code this harness runs", () => {
  const index = readFileSync(join(__dirname, "../../../../supabase/functions/factory-sticker-orchestrate/index.ts"), "utf8");
  it("decides eligibility, selection, QA and publication through the shared plan", () => {
    expect(index).toContain("planGeneration({");
    expect(index).toContain("assessRenderedSticker({");
    expect(index).toContain("planDocumentFiling(");
    expect(index).toContain("recordStatusFor(");
    expect(index).not.toMatch(/\bevaluateAutoPublish\(/);
    expect(index).not.toMatch(/\bcheckRenderedCompleteness\(/);
    expect(index).not.toMatch(/\bevaluateStickerEligibility\(/);
  });
  it("takes regeneration reasons from the same list the dealer UI offers", () => {
    expect(index).toContain("REGENERATION_REASON_CODES");
    expect(index).not.toContain('"vehicle_information_corrected"');
  });
});

describe("complete builds: one page on the equipment-priority composition, or held", () => {
  const completeOutcomes = (): Array<[string, Outcome]> => renderable.map((v) => [v.v, auto.get(v.v)!]);
  const heldList = (): Held[] => completeOutcomes().flatMap(([, o]) => (o.kind === "one_page_review_required" ? [o] : []));
  const filedList = (): Filed[] => completeOutcomes().flatMap(([, o]) => (o.kind === "filed" ? [o] : []));

  it("every identified sheet-backed VIN is a verified one-page document or a one-page hold", () => {
    expect(filedList().length + heldList().length).toBe(38);
    expect(filedList().length).toBeGreaterThan(0);
    expect(heldList().length).toBeGreaterThan(0);
  });

  it("filed complete builds are exactly one page at the floor or above and print every item once", async () => {
    for (const o of filedList()) {
      const pdf = await PDFDocument.load(o.rendered.pdfBytes);
      expect(pdf.getPageCount()).toBe(1);
      expect(Math.round(pdf.getPage(0).getSize().width)).toBe(792);
      expect(Math.round(pdf.getPage(0).getSize().height)).toBe(612);
      const fit = o.rendered.layout.fit;
      expect(fit.ok && fit.equipmentFontPt).toBeGreaterThanOrEqual(5.5);
      const expected = adaptRenderData(o.normalized.data).data.equipment.standard.flatMap((g) => g.items);
      expect([...o.rendered.layout.printedEquipment].sort()).toEqual([...expected].sort());
      expect(o.assessment.completeness.pass).toBe(true);
      expect(untraceable(o)).toEqual([]);
      const qrs = o.model.pages[0].primitives.filter((x) => x.kind === "qr");
      expect(qrs.some((q) => q.kind === "qr" && q.payload === o.passportUrl && q.size >= 57.6)).toBe(true);
      expect(o.model.drawnStrings).toContain("Scan for Vehicle Passport");
      expect(o.model.pages[0].primitives.some((x) => x.kind === "barcode" && x.payload === o.listing.vin.toUpperCase())).toBe(true);
    }
  });

  it("held complete builds park REVIEW_REQUIRED with no PDF, no document and the one-page reason", async () => {
    for (const o of heldList()) {
      const fit = o.rendered.layout.fit;
      expect(fit.ok).toBe(false);
      if (fit.ok) continue;
      expect(fit.reason).toBe("one_page_fit_failed");
      expect(fit.overflowPt).toBeGreaterThan(0);
      expect(fit.equipmentFontPt).toBeGreaterThanOrEqual(5.5);
      expect(fit.detail).toContain("approved one-page layout adjustment");
      expect(fit.detail).toContain("run-in");
      expect(o.rendered.pdfBytes.byteLength).toBe(0);
      expect(o.rendered.previewSvg).toBe("");
      expect(o.model.pages).toHaveLength(1);
      expect(o.autoPublish).toBe(false);
      expect(o.assessment.decision.blockers.map((b) => b.code)).toContain("one_page_review_required");
      const store = newStore();
      const again = await runOrchestrate(o.listing, store);
      expect(again.kind).toBe("one_page_review_required");
      expect(store.docs).toHaveLength(0);
      expect(store.record.generation_status).toBe("REVIEW_REQUIRED");
      expect(store.record.review_required).toBe(true);
      expect(store.record.review_reason).toContain("one_page_review_required");
    }
  });

  it("an existing published document stays intact when the complete build cannot fit", async () => {
    const v = renderable.find((x) => auto.get(x.v)?.kind === "one_page_review_required" && (trimmed.get(x.v) as Filed | undefined)?.autoPublish)!;
    const store = newStore();
    const first = await runOrchestrate(trimmedListing(buildListing(fx, v)), store) as Filed;
    expect(first.autoPublish).toBe(true);
    const before = store.docs.map((d) => [d.id, d.version, d.document_status, d.content_hash]);
    const bytes = sha256(store.docs[0].pdfBytes);
    const held = await runOrchestrate(buildListing(fx, v), store, { regeneration: { reasonCode: "other", reasonNotes: "full build" } });
    expect(held.kind).toBe("one_page_review_required");
    expect(store.docs.map((d) => [d.id, d.version, d.document_status, d.content_hash])).toEqual(before);
    expect(sha256(store.docs[0].pdfBytes)).toBe(bytes);
    expect(publishedDocs(store)).toHaveLength(1);
    expect(store.record.current_document_id).toBe(first.documentId);
    expect(store.record.review_required).toBe(true);
  });

  it("no held build was compressed below the floor", () => {
    for (const o of heldList()) {
      const fit = o.rendered.layout.fit;
      expect(!fit.ok && fit.equipmentFontPt).toBe(5.5);
    }
  });
});

describe("make-wide master routing by fuel class", () => {
  const FUELS: Array<[FuelClass, string]> = [
    ["gasoline", "Premium"], ["hybrid", "Hybrid"], ["phev", "Plug-in Hybrid"], ["ev", "Electricity"], ["diesel", "Diesel"],
  ];
  const routes = (make: string, fuelType: string) => masterFor({ identity: { make }, epa: { fuelType } });

  it("classifies the EPA fuel type strings", () => {
    for (const [cls, label] of FUELS) expect(fuelClassOf(label)).toBe(cls);
    expect(fuelClassOf(null)).toBeNull();
    expect(fuelClassOf("")).toBeNull();
  });

  it("routes approved make-wide masters only for the fuel classes their EPA panel supports", () => {
    expect(routes("INFINITI", "Premium")?.variantKey).toBe("infiniti-2026-qx60-sport-awd");
    expect(routes("Nissan", "Regular")?.variantKey).toBe("nissan-2026-pathfinder-platinum-4wd");
    expect(routes("Hyundai", "Hybrid")?.variantKey).toBe("hyundai-2026-santa-fe-hybrid-se-awd");
    expect(routes("Jeep", "Plug-in Hybrid")?.variantKey).toBe("jeep-2024-grand-cherokee-4xe-phev");
    expect(routes("INFINITI", "Hybrid")).toBeNull();
    expect(routes("INFINITI", "Electricity")).toBeNull();
    expect(routes("Hyundai", "Regular")).toBeNull();
    expect(routes("Jeep", "Regular")).toBeNull();
    expect(routes("Jeep", "Hybrid")).toBeNull();
    expect(routes("INFINITI", "")).toBeNull();
  });

  it("never routes a master that is pending owner approval, and keeps Ford Transit exact-only", () => {
    expect(MASTER_APPROVAL[MAKE_WIDE_MASTERS.MITSUBISHI.variantKey]).toBe("pending_owner_approval");
    expect(MASTER_APPROVAL[MAKE_WIDE_MASTERS.CHRYSLER.variantKey]).toBe("pending_owner_approval");
    expect(routes("Mitsubishi", "Regular")).toBeNull();
    expect(routes("Chrysler", "Plug-in Hybrid")).toBeNull();
    expect(routes("Ford", "Regular")).toBeNull();
  });
});

describe("coverage across the inventory", () => {
  type Row = { v: FixtureVehicle; o: Outcome; route: Route };
  const rows = (): Row[] => fx.vehicles.map((v) => {
    const o = auto.get(v.v)!;
    return { v, o, route: routeOf(o) };
  });
  const resultOf = (o: Outcome): string => {
    if (o.kind === "pending_data") return "refused_no_build_sheet";
    if (o.kind === "ineligible" || o.kind === "selection_blocked") return "held_unsupported_record";
    if (o.kind === "one_page_review_required") return "held_one_page_review_required";
    return o.autoPublish ? "published_eligible_one_page" : "held_other";
  };

  it("every vehicle lands in exactly one route and none is silently dropped", () => {
    const counts: Record<Route, number> = { master_make_wide: 0, generic_fallback: 0, no_data: 0, unsupported: 0 };
    for (const r of rows()) counts[r.route]++;
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(44);
    expect(counts.no_data).toBe(5);
    expect(counts.unsupported).toBe(0);
    expect(counts.master_make_wide).toBe(38);
    expect(counts.generic_fallback).toBe(1);
  });

  it("primary result: make-wide INFINITI master routing; comparison: exact-variant only", () => {
    const rs = rows();
    const makeWide = rs.filter((r) => r.route === "master_make_wide").length;
    const exact = rs.filter((r) => exactVariantRoute(r.o)).length;
    expect(makeWide).toBeGreaterThan(exact);
    expect(exact).toBe(0);
    expect(rs.filter((r) => r.o.kind === "filed" && r.o.autoPublish)).toHaveLength(PUBLISHED_N);
    expect(rs.filter((r) => r.o.kind === "one_page_review_required")).toHaveLength(HELD_N);
  });

  it("no vehicle is an auto-published or complete one-page document unless its PDF has exactly one page", async () => {
    for (const r of rows()) {
      if (r.o.kind === "filed") {
        const pdf = await PDFDocument.load(r.o.rendered.pdfBytes);
        expect(pdf.getPageCount()).toBe(1);
      } else {
        expect(r.o.autoPublish).toBe(false);
      }
    }
  });

  it("writes evidence files when STICKER_EVIDENCE_DIR is set", async () => {
    const dir = process.env.STICKER_EVIDENCE_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    const coverage: Array<Record<string, string | number | boolean | null>> = [];
    for (const r of rows()) {
      const id = [r.v.y, r.v.t].filter(Boolean).join(" ") || "(identity missing on saved record)";
      const o = r.o;
      const base = {
        vin: r.v.v, year_make_model_trim: id, layout_route: r.route,
        exact_variant_route: exactVariantRoute(o), result: resultOf(o),
      };
      if (o.kind === "pending_data" || o.kind === "ineligible" || o.kind === "selection_blocked") {
        coverage.push({
          ...base, reconciliation_status: "n/a", auto_publish_decision: o.kind === "pending_data" ? "refused_no_build_sheet" : "held_manual_review",
          standard_equipment_items: 0, options: 0, pages: 0, fit_overflow_pt: null, equipment_font_pt: null,
          rendered_on: null, composition: null, equipment_mode: null, smallest_equipment_font_pt: null,
          blockers: o.kind === "pending_data" ? "no saved VIN-specific build sheet" : o.plan.kind === "ineligible" ? o.plan.eligibility.status : (o.plan as { reason?: string }).reason ?? "selection_blocked",
          hold_reason: o.kind === "pending_data" ? "No saved VIN-specific build sheet; nothing rendered." : "Record unsupported for an OEM reproduction layout.",
        });
        continue;
      }
      const fit = o.rendered.layout.fit;
      coverage.push({
        ...base, reconciliation_status: o.plan.reconciliation.status,
        auto_publish_decision: o.autoPublish ? "auto_published" : "held_manual_review",
        standard_equipment_items: adaptRenderData(o.normalized.data).data.equipment.standard.flatMap((g) => g.items).length,
        options: o.normalized.data.options.length,
        pages: o.kind === "filed" ? o.rendered.layout.pages : 0,
        rendered_on: o.model.pages[0].primitives.some((x) => x.kind === "image" && x.assetId.startsWith("figma-")) ? "figma_master" : "generic_engine",
        composition: fit.composition ?? "standard",
        equipment_mode: fit.equipmentMode ?? "list",
        smallest_equipment_font_pt: fit.equipmentFontPt,
        fit_overflow_pt: fit.ok ? 0 : fit.overflowPt,
        equipment_font_pt: fit.ok ? fit.equipmentFontPt : fit.equipmentFontPt,
        blockers: o.assessment.decision.blockers.map((b) => b.code).join("|"),
        hold_reason: fit.ok ? "" : fit.detail,
      });
    }
    const count = (pred: (c: Record<string, string | number | boolean | null>) => boolean) => coverage.filter(pred).length;
    const summary = {
      vehicles: coverage.length,
      primary_make_wide_routing: {
        routed_to_infiniti_master: count((c) => c.layout_route === "master_make_wide"),
        published_eligible_one_page: count((c) => c.result === "published_eligible_one_page"),
        held_one_page_review_required: count((c) => c.result === "held_one_page_review_required"),
        held_other: count((c) => c.result === "held_other" || c.result === "held_unsupported_record"),
        refused_no_build_sheet: count((c) => c.result === "refused_no_build_sheet"),
      },
      comparison_exact_variant_only: {
        routed_to_dedicated_variant: count((c) => c.exact_variant_route === true),
      },
    };
    writeFileSync(join(dir, "coverage.json"), JSON.stringify({
      generated_for: "Harte INFINITI new inventory (read-only production extract)",
      extracted_at: fx.extractedAt, rule: "exactly one physical PDF page; unfittable content is REVIEW_REQUIRED, never compressed",
      summary, rows: coverage,
    }, null, 2));
    const cols = Object.keys(coverage[0]);
    const esc = (x: unknown) => `"${String(x ?? "").replace(/"/g, '""')}"`;
    writeFileSync(join(dir, "coverage.csv"), [cols.join(","), ...coverage.map((c) => cols.map((k) => esc((c as Record<string, unknown>)[k])).join(","))].join("\n"));

    const FUELS: Array<[FuelClass, string]> = [
      ["gasoline", "Premium"], ["hybrid", "Hybrid"], ["phev", "Plug-in Hybrid"], ["ev", "Electricity"], ["diesel", "Diesel"],
    ];
    const makeRows: Array<Record<string, string>> = Object.entries(MAKE_WIDE_MASTERS).flatMap(([make, m]) => FUELS.map(([cls, label]) => {
      const routed = masterFor({ identity: { make }, epa: { fuelType: label } });
      const approval = MASTER_APPROVAL[m.variantKey];
      return {
        make, fuel_class: cls, master: m.variantKey, owner_approval: approval,
        scope: m.makeWide ? "make-wide" : "exact reference only",
        result: routed ? "routes to master" : m.fuel.includes(cls) ? (approval === "approved" ? "exact reference only; other models generic" : "generic one-page fallback (master pending owner approval)") : "generic one-page fallback (fuel class not on master EPA panel)",
      };
    }));
    makeRows.push(...FUELS.map(([cls]) => ({
      make: "(every other make)", fuel_class: cls, master: "none", owner_approval: "n/a", scope: "generic",
      result: "generic one-page layout",
    })));
    writeFileSync(join(dir, "make-fuel-coverage.json"), JSON.stringify(makeRows, null, 2));
    const mcols = Object.keys(makeRows[0]);
    writeFileSync(join(dir, "make-fuel-coverage.csv"), [mcols.join(","), ...makeRows.map((c) => mcols.map((k) => esc((c as Record<string, unknown>)[k])).join(","))].join("\n"));

    const fullDir = join(dir, "full-build");
    mkdirSync(fullDir, { recursive: true });
    const cohortKey = (v: FixtureVehicle): string => `${v.y ?? "unidentified"}-${v.t ?? ""}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const cohortNames = [...new Set(fx.vehicles.filter((v) => v.bs).map(cohortKey))];
    const cohorts: Array<Record<string, unknown>> = [];
    for (const name of cohortNames) {
      const members = fx.vehicles.filter((v) => v.bs && cohortKey(v) === name);
      const outs = members.map((m) => auto.get(m.v)!);
      const filed = outs.filter((o): o is Filed => o.kind === "filed");
      const held = outs.filter((o): o is Held => o.kind === "one_page_review_required");
      const fonts = outs.flatMap((o) => (o.kind === "filed" || o.kind === "one_page_review_required" ? [o.rendered.layout.fit.equipmentFontPt] : []));
      let pdf: Record<string, unknown> | null = null;
      if (filed.length) {
        const rep = filed[0];
        const file = join(fullDir, `${name}-${rep.listing.vin}.pdf`);
        writeFileSync(file, rep.rendered.pdfBytes);
        const doc = await PDFDocument.load(new Uint8Array(readFileSync(file)));
        expect(doc.getPageCount(), file).toBe(1);
        const size = doc.getPage(0).getSize();
        expect(Math.round(size.width)).toBe(792);
        expect(Math.round(size.height)).toBe(612);
        pdf = { file, pages: 1, width: Math.round(size.width), height: Math.round(size.height) };
      }
      cohorts.push({
        cohort: name, vins: members.length, published_eligible: filed.filter((o) => o.autoPublish).length,
        filed_held_other_reason: filed.filter((o) => !o.autoPublish).length, held_one_page_review_required: held.length,
        smallest_equipment_font_pt_used: fonts.length ? Math.min(...fonts) : null,
        held_overflow_pt_worst: held.length ? Math.max(...held.map((o) => (o.rendered.layout.fit.ok ? 0 : o.rendered.layout.fit.overflowPt))) : null,
        representative_pdf: pdf,
      });
    }
    writeFileSync(join(fullDir, "cohort-results.json"), JSON.stringify(cohorts, null, 2));

    const sampleDir = join(dir, "one-page-capability-samples");
    mkdirSync(sampleDir, { recursive: true });
    const seen = new Set<string>();
    const written: string[] = [];
    for (const v of renderable) {
      const t = trimmed.get(v.v);
      if (!t || t.kind !== "filed") continue;
      const cohort = `${v.y}-${v.t}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if (seen.has(cohort)) continue;
      seen.add(cohort);
      const file = join(sampleDir, `SUBSET-NOT-FULL-BUILD-${cohort}-${v.v}.pdf`);
      writeFileSync(file, t.rendered.pdfBytes);
      written.push(file);
    }
    for (const file of written) {
      const pdf = await PDFDocument.load(new Uint8Array(readFileSync(file)));
      expect(pdf.getPageCount(), file).toBe(1);
    }
    const refused = withoutSheet[0];
    writeFileSync(join(dir, `pending-data-${refused.v}-REFUSED.json`), JSON.stringify({
      vin: refused.v, outcome: "PENDING_DATA", rendered: false, document_created: false,
      reason: "No saved VIN-specific build sheet. The pipeline parks the record and renders nothing; no typical-for-trim equipment is substituted.",
      sha256_of_nothing: sha256(new Uint8Array()),
    }, null, 2));
  }, 240_000);
});
