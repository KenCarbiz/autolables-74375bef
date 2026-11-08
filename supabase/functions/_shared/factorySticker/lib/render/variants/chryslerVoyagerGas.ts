// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/chryslerVoyagerGas.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// 17x11 reproduction layout for the 2026 Chrysler Voyager (gasoline), translated
// from the handoff geometry of "Chrysler_2026_Voyager_LX" (Figma file
// wOmRNh3cib1TqhkcFEUKqO, master 1:897). Geometry is written in the reference
// PDF's own points and mapped onto the page by Y(), which keeps the reference
// horizontals and compresses verticals so the content clears the mandatory
// reproduction banner above and disclosure below.
//
// Every printed value comes from render data; nothing from the reference
// sample (VIN, prices, ratings, QR, barcode, parts content) is used as a
// default. The FlexCare advertisement, the powertrain-warranty graphic, agency seals, the source QR, the
// "affixed by law" and U.S.-specification statements and the Monroney
// certification wording are intentionally not reproduced. The fuel-economy
// panel is a native rebuild of what the reference prints as a scanned image.

import type { FactoryStickerData } from "../../types.ts";
import type { Painter, LayoutModel } from "../layout.ts";
import { VARIANT_LOGOS } from "./logoArtwork.ts";
import { T, Y } from "./hyundaiTucsonGas.ts";
import { buildFcaLayout, fitSize } from "./fcaCommon.ts";
import { priceRowsWithoutColors } from "./tabloidCommon.ts";
import type { VariantLayoutBuilder } from "./shared.ts";

export const CHRYSLER_VOYAGER_GAS_ID = "chrysler_2026_voyager_lx";

function paintHeader(p: Painter, d: FactoryStickerData): void {
  const logo = VARIANT_LOGOS.chrysler;
  p.image(logo.png, logo.assetId, 54, Y(58), 234, (234 * 146) / 900);
  const v = d.vehicle;
  if (v.year > 0) {
    String(v.year).split("").forEach((ch, i) => T(p, ch, 308, Y(46) + i * 17.5, 14, "bold", { align: "center", lh: 17.5 }));
  }
  const title = [v.model, v.trim ?? ""].filter(Boolean).join(" ").toUpperCase();
  T(p, title, 333, Y(66), fitSize(title, "body", 22, 250, 13), "body");
  T(p, "For more information visit: www.chrysler.com", 869, Y(55.9), 12, "body", { align: "center" });
  T(p, "or call 1-800-CHRYSLER", 869, Y(68.9), 12, "body", { align: "center" });
}

export const buildChryslerVoyagerGasLayout: VariantLayoutBuilder = (input): LayoutModel | null => buildFcaLayout({
  frameColor: "#283488",
  paintHeader,
  specTitle: (d) => [d.vehicle.make, d.vehicle.model, d.vehicle.trim ?? ""].filter(Boolean).join(" ").toUpperCase(),
  priceRows: (d) => priceRowsWithoutColors(d),
})(input);
