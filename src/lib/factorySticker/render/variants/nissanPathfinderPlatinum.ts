// Catalog entry for the 2026 Nissan Pathfinder Platinum. Production already
// serves this reference with the owner-approved Letter master, so the catalog
// layout delegates to it and renders byte-identically (served_by_approved_master).

import { NISSAN_PATHFINDER_CONFIG, buildLetterVariantLayout } from "./letterMonroney.ts";
import type { VariantLayoutBuilder } from "./shared.ts";

export const NISSAN_PATHFINDER_PLATINUM_ID = "nissan_2026_pathfinder_platinum";

export const buildNissanPathfinderPlatinumLayout: VariantLayoutBuilder = (input) =>
  buildLetterVariantLayout(NISSAN_PATHFINDER_CONFIG.variantKey, input);
