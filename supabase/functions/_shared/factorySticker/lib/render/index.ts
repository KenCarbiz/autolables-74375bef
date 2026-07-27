// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/index.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Browser/vitest entry point for the Factory Window Sticker renderer.
// The Deno edge runtime uses the same pipeline via
// supabase/functions/_shared/factorySticker/render.ts with an esm.sh
// pdf-lib binding.

import * as pdfLib from "pdf-lib";
import { RENDERER_VERSION, runRenderPipeline } from "./contract.ts";
import type {
  FactoryStickerRenderData,
  FactoryStickerRenderResult,
  FactoryStickerTheme,
} from "./contract.ts";
import type { PdfLibModule } from "./toPdf.ts";

export const FACTORY_STICKER_RENDERER_VERSION = RENDERER_VERSION;

export type {
  FactoryStickerRenderData,
  FactoryStickerRenderResult,
  FactoryStickerTheme,
} from "./contract.ts";
export { buildStickerLayout } from "./layout.ts";
export type { LayoutModel, StickerLayoutInput } from "./layout.ts";
export { layoutToSvg } from "./previewSvg.ts";

export async function renderFactorySticker(
  data: FactoryStickerRenderData,
  theme: FactoryStickerTheme,
): Promise<FactoryStickerRenderResult> {
  return runRenderPipeline(data, theme, pdfLib as unknown as PdfLibModule);
}
