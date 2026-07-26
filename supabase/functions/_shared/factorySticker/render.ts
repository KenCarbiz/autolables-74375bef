// ──────────────────────────────────────────────────────────────────────
// Factory Window Sticker renderer — INTERFACE CONTRACT.
//
// This file defines the one seam between the orchestration layer
// (factory-sticker-orchestrate) and the renderer. The renderer
// implementation replaces the BODY of renderFactorySticker (and bumps
// FACTORY_STICKER_RENDERER_VERSION); the signature and result shape are
// the contract and must not change without updating the orchestrator's
// QA checks, which assert:
//   * the VIN appears in layout.drawnStrings,
//   * data.barcodePayload === VIN,
//   * data.passportUrl === the canonical passport URL (the QR payload),
//   * layout.pages is 1 or 2.
//
// Until the renderer lands, the stub throws "renderer_pending" — the
// orchestrator treats that as "not yet available" (the record stays
// READY_TO_GENERATE), NOT as a generation failure.
// ──────────────────────────────────────────────────────────────────────

// Bumped by the renderer implementation on every layout-affecting change;
// part of the generation fingerprint, so a bump regenerates stale stickers.
export const FACTORY_STICKER_RENDERER_VERSION = "0.0.0-pending";

export interface FactoryStickerTheme {
  oemThemeId: string;
  oemThemeVersion: string;
  canonicalOemId: string | null;
  templateFamilyId: string;
  templateVersion: string;
  logoAssetId: string | null;
  logoAssetVersion: string | null;
}

export interface FactoryStickerRenderData {
  vin: string;
  condition: "new" | "used" | "cpo";
  title: string;
  identity: { year: string; make: string; model: string; trim: string | null };
  pricing: {
    baseMsrp: number | null;
    destinationCharge: number | null;
    optionsTotal: number | null;
    totalMsrp: number | null;
  };
  packages: Array<{ name: string; code: string | null; msrp: number | null; contents: string[] }>;
  options: Array<{ name: string; code: string | null; msrp: number | null }>;
  standardEquipment: Record<string, string[]>;
  keyFeatures: Record<string, string[]>;
  colors: {
    exterior: { name: string | null; code: string | null };
    interior: { name: string | null; code: string | null };
  };
  assembly: { plant: string | null; city: string | null; country: string | null };
  epa: {
    city: number | null;
    highway: number | null;
    combined: number | null;
    annualFuelCost: number | null;
    ghgScore: number | null;
    rangeMiles: number | null;
    fuelType: string | null;
  } | null;
  dealer: {
    name: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    phone: string | null;
  };
  /** QR payload — MUST equal the canonical passport URL. */
  passportUrl: string;
  /** Barcode payload — MUST equal the VIN. */
  barcodePayload: string;
  /** Generic (typical-for-trim) decode: the sticker must label, never assert. */
  generic: boolean;
  disclaimers: string[];
}

export interface FactoryStickerRenderResult {
  pdfBytes: Uint8Array;
  previewSvg: string;
  layout: { pages: number; drawnStrings: string[] };
}

// deno-lint-ignore require-await
export async function renderFactorySticker(
  _data: FactoryStickerRenderData,
  _theme: FactoryStickerTheme,
): Promise<FactoryStickerRenderResult> {
  throw new Error("renderer_pending");
}
