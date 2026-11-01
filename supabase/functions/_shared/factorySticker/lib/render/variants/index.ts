// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/index.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { LETTER_VARIANT_CONFIGS, buildLetterVariantLayout } from "./letterMonroney.ts";
import type { VariantLayoutBuilder } from "./shared.ts";

export type { VariantLayoutBuilder, VariantRenderInput } from "./shared.ts";

/** Dedicated layout builders keyed by reference-variant key. */
export const VARIANT_LAYOUTS: Record<string, VariantLayoutBuilder> = {
  ...Object.fromEntries(
    Object.keys(LETTER_VARIANT_CONFIGS).map((key) => [key, (input) => buildLetterVariantLayout(key, input)] as const),
  ),
};
