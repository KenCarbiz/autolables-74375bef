// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/chryslerPacificaPhev.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { paintVariantLogo } from "./shared.ts";
// Dedicated reproduction layout for the Chrysler 2024 Pacifica Select PHEV
// (Figma master 25:4667, review 25:4945). See stellantisCommon.ts.

import type { FactoryStickerData } from "../../types.ts";
import type { Painter } from "../layout.ts";
import { T, Tfit, buildStellantisPhevLayout, type StellantisVariantConfig } from "./stellantisCommon.ts";
import type { VariantLayoutBuilder } from "./shared.ts";

function paintHeader(p: Painter, d: FactoryStickerData, _displayMake: string): void {
  const v = d.vehicle;
  paintVariantLogo(p, "chrysler");
  if (v.year > 0) {
    String(v.year).split("").forEach((digit, i) =>
      T(p, digit, 533.2, 78.05 + i * 27.758, 27.6, "bold", { align: "center", lh: 27.758 }));
  }
  Tfit(p, v.model.toUpperCase(), 571.93, 103.59, 32.962, "body", 700, { spacing: 0.17 });
  if (v.trim) Tfit(p, v.trim.toUpperCase(), 571.93, 136.55, 32.962, "body", 700, { spacing: 0.13 });
}

export const CHRYSLER_PACIFICA_PHEV_CONFIG: StellantisVariantConfig = {
  variantKey: "chrysler-2024-pacifica-select-phev",
  frameColor: "#283488",
  paintHeader,
  specTitle: (d, displayMake) =>
    [displayMake, d.vehicle.model, d.vehicle.trim ?? ""].filter(Boolean).join(" ").toUpperCase(),
};

export const buildChryslerPacificaPhevLayout: VariantLayoutBuilder = (input) =>
  buildStellantisPhevLayout(CHRYSLER_PACIFICA_PHEV_CONFIG, input);
