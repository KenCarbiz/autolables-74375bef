// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/infinitiQx60Sport.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Catalog entry for the 2026 INFINITI QX60 Sport. Production already serves
// this reference with the owner-approved Letter master, so the catalog layout
// delegates to it and renders byte-identically (served_by_approved_master).

import { INFINITI_QX60_CONFIG, buildLetterVariantLayout } from "./letterMonroney.ts";
import type { VariantLayoutBuilder } from "./shared.ts";

export const INFINITI_QX60_SPORT_ID = "infiniti_2026_qx60_sport";

export const buildInfinitiQx60SportLayout: VariantLayoutBuilder = (input) =>
  buildLetterVariantLayout(INFINITI_QX60_CONFIG.variantKey, input);
