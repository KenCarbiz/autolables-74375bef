import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import {
  APP_BASE, approvePublish, buildListing, loadFixture, newStore, passportUrlFor,
  publishedDocs, runOrchestrate, sha256,
  type Fixture, type FixtureVehicle, type Listing, type Outcome, type Store,
} from "./harness";
import { adaptRenderData } from "../render/contract";
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

type LayoutClass = "dedicated" | "approved_generic" | "review_required" | "unsupported" | "no_data";
const layoutClassOf = (o: Outcome): LayoutClass => {
  if (o.kind === "pending_data") return "no_data";
  if (o.kind !== "filed") return "unsupported";
  if (o.plan.selection.selectionStatus !== "selected") return "unsupported";
  const ref = o.plan.referenceVariant;
  if (ref.status === "matched" && ref.rendering === "variant_layout") return "dedicated";
  if (ref.status === "review_required") return "review_required";
  return "approved_generic";
};

let auto: Map<string, Outcome>;
const filedOf = (vin: string): Filed => {
  const o = auto.get(vin);
  if (!o || o.kind !== "filed") throw new Error(`${vin} was not rendered`);
  return o;
};

beforeAll(async () => {
  auto = new Map();
  for (const v of fx.vehicles) {
    auto.set(v.v, await runOrchestrate(buildListing(fx, v), newStore()));
  }
}, 240_000);

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

describe.each(withSheet.map((v) => [v.v, `${v.y ?? "no ymm"} ${v.t ?? ""}`.trim()]))(
  "automatic generation %s (%s)",
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
      expect(text).not.toMatch(/\bstars?\b|AALA|parts content|\bNHTSA\b.*\d/i);
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
      expect(o.rendered.layout.drawnStrings.join(" ")).toContain(`emits ${v.e[6]} grams CO2`);
      const drawn = new Set(o.rendered.layout.drawnStrings);
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
      expect(pdf.getPageCount()).toBe(o.rendered.layout.pages);
      expect(pdf.getPageCount()).toBeGreaterThan(0);
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

    it("reproduction banner and disclosure are printed on every page", () => {
      const o = filedOf(vin);
      expect(o.model.pages.length).toBeGreaterThan(0);
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
      const o = auto.get(v.v);
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
      const listing = buildListing(fx, v);
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
      await runOrchestrate(buildListing(fx, v), store);
      const second = await runOrchestrate(corrected(buildListing(fx, v)), store, {
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
      await runOrchestrate(buildListing(fx, v), store);
      expect(store.docs.map((d) => d.document_status)).toEqual(["pending_approval"]);
      await runOrchestrate(buildListing(fx, v), store, { regeneration: { reasonCode: "pdf_or_layout_problem" } });
      await runOrchestrate(corrected(buildListing(fx, v)), store, { regeneration: { reasonCode: "msrp_corrected" } });
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
      await runOrchestrate(buildListing(fx, v), store);
      approvePublish(store);
      expect(store.docs.map((d) => [d.version, d.document_status])).toEqual([[1, "published"]]);
      const second = await runOrchestrate(corrected(buildListing(fx, v)), store, {
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
      await runOrchestrate(buildListing(fx, v), store);
      const second = await runOrchestrate(buildListing(fx, v), store, {
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
    const o = await runOrchestrate(buildListing(fx, v), store, {
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
    const listing = buildListing(fx, withSheet[0]);
    await expect(runOrchestrate(listing, newStore(), { regeneration: { reasonCode: "because" } })).rejects.toThrow("reason_required");
    await expect(runOrchestrate(listing, newStore(), { regeneration: { reasonCode: "other" } })).rejects.toThrow("reason_notes_required");
    expect(REGENERATION_REASONS).toContain("msrp_corrected");
  });
});

describe("missing or generic source information never becomes equipment", () => {
  const base = (): Listing => buildListing(fx, withSheet.find((v) => v.t === "LUXE" && v.y === "2027 INFINITI QX60")!);
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

describe("coverage across the inventory", () => {
  const rows = () => fx.vehicles.map((v) => {
    const o = auto.get(v.v)!;
    return { v, o, cls: layoutClassOf(o) };
  });

  it("every vehicle lands in exactly one class and none is silently dropped", () => {
    const counts: Record<LayoutClass, number> = { dedicated: 0, approved_generic: 0, review_required: 0, unsupported: 0, no_data: 0 };
    for (const r of rows()) counts[r.cls]++;
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(44);
    expect(counts.no_data).toBe(5);
    expect(counts.dedicated).toBe(0);
    expect(counts.review_required).toBe(1);
    expect(counts.unsupported).toBe(1);
    expect(counts.approved_generic).toBe(37);
  });

  it("writes evidence files when STICKER_EVIDENCE_DIR is set", async () => {
    const dir = process.env.STICKER_EVIDENCE_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    const coverage = [];
    for (const r of rows()) {
      const base = {
        vin: r.v.v, year_make_model_trim: [r.v.y, r.v.t].filter(Boolean).join(" ") || "(identity missing on saved record)",
        layout_class: r.cls,
      };
      if (r.o.kind !== "filed") {
        coverage.push({
          ...base, reconciliation_status: "n/a", auto_publish_decision: r.o.kind === "pending_data" ? "refused_no_build_sheet" : "held_manual_review",
          auto_version: null, manual_versions: null, disclosure_all_pages: null, qr_ok: null,
          equipment_items: 0, equipment_items_not_in_source: 0, pages: 0, blockers: r.o.kind === "pending_data" ? "no saved VIN-specific build sheet" : "",
        });
        continue;
      }
      const o = r.o;
      const qr = o.model.pages.flatMap((p) => p.primitives.filter((x) => x.kind === "qr")).some((q) => q.kind === "qr" && q.payload === o.passportUrl);
      const disc = o.model.pages.every((_, i) => pageText(o, i).includes(norm(REPRODUCTION_DISCLOSURE)) && pageText(o, i).includes(norm(REPRODUCTION_BANNER)));
      const store = newStore();
      await runOrchestrate(buildListing(fx, r.v), store);
      if (!o.autoPublish) approvePublish(store);
      const manual = await runOrchestrate(
        { ...buildListing(fx, r.v), mc_attributes: { ...buildListing(fx, r.v).mc_attributes, exterior_color: "Corrected" } },
        store, { regeneration: { reasonCode: "vehicle_information_corrected" } },
      );
      coverage.push({
        ...base, reconciliation_status: o.plan.reconciliation.status,
        auto_publish_decision: o.autoPublish ? "auto_published" : "held_manual_review",
        auto_version: o.version, manual_versions: store.docs.map((d) => `v${d.version}:${d.document_status}`).join(" "),
        disclosure_all_pages: disc, qr_ok: qr, equipment_items: printedEquipment(o).length,
        equipment_items_not_in_source: untraceable(o).length, pages: o.rendered.layout.pages,
        blockers: o.assessment.decision.blockers.map((b) => b.code).join("|"),
      });
      void manual;
    }
    writeFileSync(join(dir, "coverage.json"), JSON.stringify({
      generated_for: "Harte INFINITI new inventory (read-only production extract)",
      extracted_at: fx.extractedAt, vehicles: coverage.length,
      summary: coverage.reduce<Record<string, number>>((m, c) => { m[c.layout_class] = (m[c.layout_class] ?? 0) + 1; return m; }, {}),
      rows: coverage,
    }, null, 2));
    const cols = Object.keys(coverage[0]);
    const esc = (x: unknown) => `"${String(x ?? "").replace(/"/g, '""')}"`;
    writeFileSync(join(dir, "coverage.csv"), [cols.join(","), ...coverage.map((c) => cols.map((k) => esc((c as Record<string, unknown>)[k])).join(","))].join("\n"));

    const seen = new Set<string>();
    for (const r of rows()) {
      if (r.o.kind !== "filed") continue;
      const cohort = `${r.v.y}-${r.v.t}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if (seen.has(cohort)) continue;
      seen.add(cohort);
      writeFileSync(join(dir, `${cohort}-${r.v.v}.pdf`), r.o.rendered.pdfBytes);
    }
    const refused = withoutSheet[0];
    writeFileSync(join(dir, `pending-data-${refused.v}-REFUSED.json`), JSON.stringify({
      vin: refused.v, outcome: "PENDING_DATA", rendered: false, document_created: false,
      reason: "No saved VIN-specific build sheet. The pipeline parks the record and renders nothing; no typical-for-trim equipment is substituted.",
      sha256_of_nothing: sha256(new Uint8Array()),
    }, null, 2));
  }, 240_000);
});
