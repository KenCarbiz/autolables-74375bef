// ──────────────────────────────────────────────────────────────────────
// Factory Window Sticker renderer — Deno edge binding.
//
// This file is the one seam between the orchestration layer
// (factory-sticker-orchestrate) and the renderer. The engine itself lives
// in src/lib/factorySticker/render/ (pure, dependency-free TypeScript that
// is unit-tested under vitest); this file only binds the esm.sh build of
// pdf-lib and re-exports the frozen contract types. The orchestrator's QA
// checks assert:
//   * the VIN appears in layout.drawnStrings,
//   * data.barcodePayload === VIN,
//   * data.passportUrl === the canonical passport URL (the QR payload),
//   * layout.pages is 1 or 2.
// ──────────────────────────────────────────────────────────────────────

import * as pdfLib from "https://esm.sh/pdf-lib@1.17.1";
import {
  RENDERER_VERSION,
  resolveRenderProfile,
  runRenderPipeline,
} from "./lib/render/contract.ts";
import type {
  FactoryStickerRenderData,
  FactoryStickerRenderResult,
  FactoryStickerTheme,
} from "./lib/render/contract.ts";
import type { PdfLibModule } from "./lib/render/toPdf.ts";

export type {
  FactoryStickerRenderData,
  FactoryStickerRenderResult,
  FactoryStickerTheme,
} from "./lib/render/contract.ts";

// Bumped on every layout-affecting change; part of the generation
// fingerprint, so a bump regenerates stale stickers.
export const FACTORY_STICKER_RENDERER_VERSION = RENDERER_VERSION;
export { resolveRenderProfile };

// The decision layer travels with the renderer so the orchestrator can
// never select a template the renderer would not produce, or publish a
// page whose geometry the registry does not declare.
export {
  getTemplateDefinition,
  listTemplateDefinitions,
  selectOemTemplate,
  validatePageGeometry,
  listCompatibleTemplates,
  validateTemplateOverride,
} from "./lib/oem/selection.ts";
export type {
  OemTemplateDefinition,
  OemTemplateSelectionResult,
} from "./lib/oem/selection.ts";
export {
  checkRenderedCompleteness,
  buildContentManifest,
} from "./lib/render/completeness.ts";
export type { CompletenessReport, ManifestItem } from "./lib/render/completeness.ts";
export {
  classifyCondition,
  evaluateStickerEligibility,
} from "./lib/oem/eligibility.ts";
export type {
  StickerEligibilityResult,
} from "./lib/oem/eligibility.ts";

export async function renderFactorySticker(
  data: FactoryStickerRenderData,
  theme: FactoryStickerTheme,
): Promise<FactoryStickerRenderResult> {
  return runRenderPipeline(data, theme, pdfLib as unknown as PdfLibModule);
}
