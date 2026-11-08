// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/fiat500eEv.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// 17x11 reproduction layout for the 2025 Fiat 500e (electric), translated from
// "Fiat_2025_500e_Giorgio_Armani" (Figma file CN6z6UNk9YFEEfe1Nvk9mS, master
// 1:933). It shares the FCA label family (fcaCommon.ts); the right-hand panels
// are the electric fuel-economy panel (evPanels.ts), the safety panel, the
// parts-content box and the Passport QR in place of the FlexCare advertisement.
// The FIAT and 500e lockup is taken from the reference label PDF
// (logoArtwork.ts). The reference is a 2025 example.

import type { FactoryStickerData } from "../../types.ts";
import type { Painter, LayoutModel } from "../layout.ts";
import { T, Y } from "./hyundaiTucsonGas.ts";
import { buildFcaLayout, paintParts, paintPassport, paintSafety } from "./fcaCommon.ts";
import { PX, type Grid } from "./catalogBlocks.ts";
import { paintEvEpa } from "./evPanels.ts";
import { VARIANT_LOGOS } from "./logoArtwork.ts";
import { priceRowsWithoutColors } from "./tabloidCommon.ts";
import type { VariantLayoutBuilder } from "./shared.ts";

export const FIAT_500E_EV_ID = "fiat_2025_500e_giorgio_armani";

const grid: Grid = { x: (px) => px * PX, y: (px) => Y(px * PX), k: 0.93 * PX };

function paintHeader(p: Painter, d: FactoryStickerData): void {
  // Lockup slots are the reference's 100 dpi pixels; 0.72 converts to points.
  for (const key of ["fiat", "fiat500"] as const) {
    const l = VARIANT_LOGOS[key];
    const top = Y(l.slot.y * PX);
    p.image(l.png, l.assetId, l.slot.x * PX, top, l.slot.w * PX, Y((l.slot.y + l.slot.h) * PX) - top);
  }
  const v = d.vehicle;
  if (v.year > 0) T(p, `${v.year} MODEL YEAR`, 143, Y(98), 14, "bold");
  T(p, "For more information visit: www.fiatusa.com", 880, Y(66), 12, "body", { align: "center" });
  T(p, "or call 1-888-CIAOFIAT", 880, Y(79), 12, "body", { align: "center" });
}

function paintRight(p: Painter, d: FactoryStickerData): void {
  paintEvEpa(p, d, grid, 868, 101 / PX, { mode: "ev", widthPx: 760, qr: false });
  paintSafety(p, d);
  paintParts(p, d);
  paintPassport(p, d.document.passportUrl.trim());
}

export const buildFiat500eEvLayout: VariantLayoutBuilder = (input): LayoutModel | null => buildFcaLayout({
  frameColor: "#4fc3d4",
  paintHeader,
  specTitle: (d) => [d.vehicle.make, d.vehicle.model, d.vehicle.trim ?? ""].filter(Boolean).join(" ").toUpperCase(),
  priceRows: (d) => priceRowsWithoutColors(d),
  paintRight,
})(input);
