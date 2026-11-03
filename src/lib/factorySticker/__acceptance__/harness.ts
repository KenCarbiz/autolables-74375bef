// Real-inventory acceptance harness for the factory window sticker.
//
// Drives the same pure steps factory-sticker-orchestrate runs between "load
// saved listing" and "file the document" — normalizeForSticker, planGeneration,
// the real renderer, assessRenderedSticker and planDocumentFiling — against
// listings rebuilt from a read-only extract of production, with an in-memory
// document store in place of Postgres and storage. No network, no provider
// call, nothing written anywhere but memory.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeForSticker, type NormalizeResult } from "../../../../supabase/functions/factory-sticker-orchestrate/normalize.ts";
import {
  planGeneration, assessRenderedSticker,
  type GenerationPlan, type RenderAssessment, type StoredTemplateOverride,
} from "../generationPlan.ts";
import { planDocumentFiling, recordStatusFor, type FilingPlan, type FiledDocumentRow } from "../documentFiling.ts";
import { renderFactorySticker } from "../render/index.ts";
import { buildRenderLayout, type FactoryStickerRenderResult } from "../render/contract.ts";
import type { LayoutModel } from "../render/layout.ts";
import { REGENERATION_REASONS } from "../regenerationReason.ts";

export const APP_BASE = "https://app.autolabels.io";
export const TEMPLATE_VERSION = "1.0.0";
export const NEW_TITLE = "Factory Window Sticker — Configuration & MSRP";

export interface FixtureVehicle {
  v: string;
  s: string;
  y: string | null;
  t: string | null;
  mc: Record<string, unknown>;
  bs: Record<string, unknown> | null;
  sh: string | null;
  kh: string | null;
  /** city, highway, combined, annual fuel cost, GHG score, fuel type, tailpipe CO2 g/mi */
  e: [number, number, number, number, number, string, number] | null;
  p: [string, string | null];
}

export interface Fixture {
  storeId: string;
  extractedAt: string;
  dict: string[];
  lists: Record<string, Record<string, number[]>>;
  vehicles: FixtureVehicle[];
}

export function loadFixture(): Fixture {
  const path = join(__dirname, "harteNewInventory.fixture.json");
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}

const expand = (fx: Fixture, key: string | null): Record<string, string[]> | undefined => {
  if (!key) return undefined;
  const list = fx.lists[key];
  if (!list) throw new Error(`fixture list ${key} missing`);
  return Object.fromEntries(Object.entries(list).map(([cat, ix]) => [cat, ix.map((i) => fx.dict[i])]));
};

export type Listing = Record<string, unknown> & {
  vin: string; slug: string; ymm: string | null; trim: string | null;
  condition: string; mc_attributes: Record<string, unknown>; epa_economy: Record<string, unknown> | null;
};

/** The saved vehicle_listings row the orchestrator would have read. */
export function buildListing(fx: Fixture, v: FixtureVehicle): Listing {
  const sheet = v.bs
    ? { ...v.bs, standard: expand(fx, v.sh ? `S${v.sh}` : null), key_features: expand(fx, v.kh ? `K${v.kh}` : null) }
    : undefined;
  return {
    vin: v.v, slug: v.s, ymm: v.y, trim: v.t, condition: "new",
    mc_attributes: { ...v.mc, ...(sheet ? { build_sheet: sheet } : {}) },
    epa_economy: v.e
      ? { city: v.e[0], highway: v.e[1], combined: v.e[2], annualFuelCost: v.e[3], ghgScore: v.e[4], fuelType: v.e[5], co2TailpipeGpm: v.e[6], rangeMiles: null }
      : null,
  };
}

export const passportUrlFor = (listing: Listing): string => `${APP_BASE}/v/${listing.slug}`;

export const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export interface StoredDoc extends FiledDocumentRow {
  superseded_by: string | null;
  pdfBytes: Uint8Array;
  regeneration_reason_code: string | null;
  generated_by: "system" | "user";
}

export interface Store {
  docs: StoredDoc[];
  record: { generation_status: string; review_required: boolean; review_reason: string | null; current_document_id: string | null };
  nextId: number;
}

export const newStore = (): Store => ({
  docs: [],
  record: { generation_status: "PENDING_DATA", review_required: false, review_reason: null, current_document_id: null },
  nextId: 1,
});

export type Outcome =
  | { kind: "pending_data"; status: "PENDING_DATA"; autoPublish: false }
  | { kind: "ineligible"; status: "REVIEW_REQUIRED"; autoPublish: false; plan: GenerationPlan }
  | { kind: "selection_blocked"; status: "REVIEW_REQUIRED"; autoPublish: false; plan: GenerationPlan }
  | {
    kind: "filed";
    status: "PUBLISHED" | "REVIEW_REQUIRED";
    autoPublish: boolean;
    listing: Listing;
    normalized: NormalizeResult;
    plan: Extract<GenerationPlan, { kind: "ready" }>;
    assessment: RenderAssessment;
    rendered: FactoryStickerRenderResult;
    model: LayoutModel;
    filing: FilingPlan;
    version: number;
    documentId: string;
    passportUrl: string;
  };

export interface RunOptions {
  /** Present for a manual regenerate; absent for the automatic ingest path. */
  regeneration?: { reasonCode: string; reasonNotes?: string | null };
  storedOverride?: StoredTemplateOverride | null;
  dealerSettings?: Record<string, unknown>;
}

/**
 * One orchestrateVehicle pass. The ordering and the early returns mirror
 * index.ts: no build sheet parks PENDING_DATA without rendering; an ineligible
 * or template-blocked vehicle parks REVIEW_REQUIRED without rendering; only a
 * rendered, QA'd document is filed, and it is filed published only when
 * evaluateAutoPublish says so.
 */
export async function runOrchestrate(listing: Listing, store: Store, opts: RunOptions = {}): Promise<Outcome> {
  if (opts.regeneration && !REGENERATION_REASONS.includes(opts.regeneration.reasonCode as typeof REGENERATION_REASONS[number])) {
    throw new Error("reason_required");
  }
  if (opts.regeneration?.reasonCode === "other" && !opts.regeneration.reasonNotes) {
    throw new Error("reason_notes_required");
  }
  const mc = listing.mc_attributes;
  const sheet = (mc.build_sheet ?? null) as Record<string, unknown> | null;
  if (!sheet) {
    store.record = { ...store.record, generation_status: "PENDING_DATA", review_required: false, review_reason: null };
    return { kind: "pending_data", status: "PENDING_DATA", autoPublish: false };
  }
  const dealerSettings = opts.dealerSettings ?? {};
  const passportUrl = passportUrlFor(listing);
  const vin = listing.vin.toUpperCase().trim();
  const condRaw = String(listing.condition || "used").toLowerCase();
  const normalized = normalizeForSticker(listing, dealerSettings, passportUrl, NEW_TITLE);
  const plan = planGeneration({
    vin, condition: condRaw,
    corroboratingCondition: typeof mc.condition === "string" ? mc.condition : null,
    corroboratingMake: typeof mc.make === "string" ? mc.make : null,
    manufacturer: typeof sheet.manufacturer === "string" ? sheet.manufacturer : null,
    stickerSettings: (dealerSettings.factory_sticker || {}) as Record<string, unknown>,
    dealerSettings, normalized, templateVersion: TEMPLATE_VERSION,
    storedOverride: opts.storedOverride ?? null,
  });
  if (plan.kind === "ineligible" || plan.kind === "selection_blocked") {
    store.record = {
      ...store.record, generation_status: "REVIEW_REQUIRED", review_required: true,
      review_reason: plan.kind === "ineligible" ? plan.eligibility.status : plan.reason,
    };
    return { kind: plan.kind, status: "REVIEW_REQUIRED", autoPublish: false, plan };
  }

  const rendered = await renderFactorySticker(normalized.data, plan.theme);
  const model = buildRenderLayout(normalized.data, plan.theme);
  const assessment = assessRenderedSticker({
    vin, hasBuildSheet: true, normalized, plan, canonicalPassportUrl: passportUrl,
    layout: {
      pages: rendered.layout.pages, widthPt: rendered.layout.widthPt,
      heightPt: rendered.layout.heightPt, drawnStrings: rendered.layout.drawnStrings,
    },
  });
  const autoPublish = assessment.decision.autoPublish;
  const hash = sha256(rendered.pdfBytes);
  const ordered = [...store.docs].sort((a, b) => b.version - a.version);
  const filing = planDocumentFiling(ordered, hash, autoPublish);

  let documentId: string;
  if (filing.action === "update_in_place") {
    const doc = store.docs.find((d) => d.id === filing.documentId)!;
    doc.document_status = filing.targetStatus;
    doc.content_hash = hash;
    doc.pdfBytes = rendered.pdfBytes;
    doc.regeneration_reason_code = opts.regeneration?.reasonCode ?? null;
    doc.generated_by = opts.regeneration ? "user" : "system";
    for (const id of filing.supersedeIds) {
      const d = store.docs.find((x) => x.id === id)!;
      d.document_status = "superseded"; d.superseded_by = doc.id;
    }
    documentId = doc.id;
  } else if (filing.action === "reuse_identical") {
    documentId = filing.documentId;
  } else {
    documentId = `doc-${store.nextId++}`;
    store.docs.push({
      id: documentId, version: filing.version, document_status: filing.targetStatus,
      content_hash: hash, superseded_by: null, pdfBytes: rendered.pdfBytes,
      regeneration_reason_code: opts.regeneration?.reasonCode ?? null,
      generated_by: opts.regeneration ? "user" : "system",
    });
    for (const id of filing.supersedeIds) {
      const d = store.docs.find((x) => x.id === id)!;
      d.document_status = "superseded"; d.superseded_by = documentId;
    }
  }
  const status = recordStatusFor(autoPublish);
  store.record = {
    generation_status: status, review_required: !autoPublish,
    review_reason: assessment.decision.reviewReason, current_document_id: documentId,
  };
  const doc = store.docs.find((d) => d.id === documentId)!;
  return {
    kind: "filed", status, autoPublish, listing, normalized, plan, assessment, rendered, model,
    filing, version: doc.version, documentId, passportUrl,
  };
}

/** approve_publish: the only road from a held document to the passport. */
export function approvePublish(store: Store): void {
  const id = store.record.current_document_id;
  if (!id) throw new Error("nothing_to_publish");
  for (const d of store.docs) {
    if (d.id !== id && d.document_status === "published") {
      d.document_status = "superseded"; d.superseded_by = id;
    }
  }
  store.docs.find((d) => d.id === id)!.document_status = "published";
  store.record = { ...store.record, generation_status: "PUBLISHED", review_required: false };
}

export const publishedDocs = (store: Store): StoredDoc[] => store.docs.filter((d) => d.document_status === "published");
