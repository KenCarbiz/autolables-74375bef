import { LETTER_VARIANT_CONFIGS, buildLetterVariantLayout } from "./letterMonroney.ts";
import type { VariantLayoutBuilder } from "./shared.ts";

export type { VariantLayoutBuilder, VariantRenderInput } from "./shared.ts";

/** Dedicated layout builders keyed by reference-variant key. */
export const VARIANT_LAYOUTS: Record<string, VariantLayoutBuilder> = {
  ...Object.fromEntries(
    Object.keys(LETTER_VARIANT_CONFIGS).map((key) => [key, (input) => buildLetterVariantLayout(key, input)] as const),
  ),
};
