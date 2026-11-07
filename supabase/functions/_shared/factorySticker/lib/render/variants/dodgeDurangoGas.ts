// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/dodgeDurangoGas.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// 17x11 reproduction layout for the 2026 Dodge Durango (gasoline), translated
// from the handoff geometry of "Dodge_2026_Durango_GT_Blacktop" (Figma file
// YS8oPxN3wIbn3ijLmhmuDc, master 1:824). It shares the FCA label family with
// the Wrangler and Voyager (fcaCommon.ts); only the header artwork, frame
// colour and title differ. The Durango reference prints the 5-year/60,000-mile
// powertrain graphic and the FlexCare advertisement, which are not reproduced.

import type { FactoryStickerData } from "../../types.ts";
import type { LayoutModel, Painter } from "../layout.ts";
import { VARIANT_LOGOS } from "./logoArtwork.ts";
import { T, Y } from "./hyundaiTucsonGas.ts";
import { buildFcaLayout, fitSize } from "./fcaCommon.ts";
import { priceRowsWithoutColors } from "./tabloidCommon.ts";
import type { VariantLayoutBuilder } from "./shared.ts";

export const DODGE_DURANGO_GAS_ID = "dodge_2026_durango_gt_blacktop";

function paintHeader(p: Painter, d: FactoryStickerData): void {
  const logo = VARIANT_LOGOS.dodge;
  p.image(logo.png, logo.assetId, 88, Y(52), 141, (141 * logo.slot.h) / logo.slot.w);
  const v = d.vehicle;
  if (v.year > 0) {
    String(v.year).split("").forEach((ch, i) => T(p, ch, 70, Y(45) + i * 12.5, 11, "bold", { align: "center", lh: 12.5 }));
  }
  const title = [v.model, v.trim ?? "", v.drivetrain ?? ""].filter(Boolean).join(" ").toUpperCase();
  T(p, title, 88, Y(70), fitSize(title, "bold", 27, 520, 14), "bold");
  T(p, "For more information visit: www.dodge.com", 869, Y(55.9), 12, "body", { align: "center" });
  T(p, "or call 1-800-4ADODGE", 869, Y(68.9), 12, "body", { align: "center" });
}

export const buildDodgeDurangoGasLayout: VariantLayoutBuilder = (input): LayoutModel | null => buildFcaLayout({
  frameColor: "#000000",
  paintHeader,
  specTitle: (d) => [d.vehicle.make, d.vehicle.model, d.vehicle.trim ?? ""].filter(Boolean).join(" ").toUpperCase() + (d.vehicle.drivetrain ? ` ${d.vehicle.drivetrain.toUpperCase()}` : ""),
  priceRows: (d) => priceRowsWithoutColors(d),
})(input);
