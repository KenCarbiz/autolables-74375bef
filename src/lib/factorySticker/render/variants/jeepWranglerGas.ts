// 17x11 reproduction layout for the 2026 Jeep Wrangler (gasoline), translated
// from the handoff geometry of "Jeep_2026_Wrangler_Willys_392" (Figma file
// iIZJSBEBc0Ywk6fzKIQTFF, master 1:824). Geometry is written in the reference
// PDF's own points and mapped onto the page by Y(), which keeps the reference
// horizontals and compresses verticals so the content clears the mandatory
// reproduction banner above and disclosure below.
//
// Every printed value comes from render data; nothing from the reference
// sample (VIN, prices, ratings, QR, barcode, parts content) is used as a
// default. The FlexCare advertisement, agency seals, the source QR, the
// "affixed by law" and U.S.-specification statements and the Monroney
// certification wording are intentionally not reproduced. The fuel-economy
// panel is a native rebuild of what the reference prints as a scanned image.

import type { FactoryStickerData } from "../../types.ts";
import type { Painter, LayoutModel } from "../layout.ts";
import { VARIANT_LOGOS } from "./logoArtwork.ts";
import { T, Y } from "./hyundaiTucsonGas.ts";
import { buildFcaLayout, fitSize } from "./fcaCommon.ts";
import { priceRows } from "./tabloidCommon.ts";
import type { VariantLayoutBuilder } from "./shared.ts";

export const JEEP_WRANGLER_GAS_ID = "jeep_2026_wrangler_willys_392";

function paintHeader(p: Painter, d: FactoryStickerData): void {
  const logo = VARIANT_LOGOS.jeep;
  p.image(logo.png, logo.assetId, 54, Y(61), 97, (97 * logo.slot.h) / logo.slot.w);
  const v = d.vehicle;
  if (v.year > 0) T(p, `${v.year} MODEL YEAR (${String(v.year).slice(-2)}MY)`, 165.4, Y(38.3), 14.8, "bold");
  // Jeep's header names four-wheel drive "4X4"; the spec line keeps the decoded "(4WD)".
  const drive = v.drivetrain && /^(4WD|4X4|AWD-4WD)$/i.test(v.drivetrain.trim()) ? "4X4" : v.drivetrain ?? "";
  const title = [v.model, v.trim ?? "", drive].filter(Boolean).join(" ").toUpperCase();
  T(p, title, 165.2, Y(72.7), fitSize(title, "bold", 25, 590, 14), "bold");
  T(p, "For more information visit: www.jeep.com", 869, Y(55.9), 12, "body", { align: "center" });
  T(p, "or call 1-877-IAM-JEEP", 869, Y(68.9), 12, "body", { align: "center" });
}

export const buildJeepWranglerGasLayout: VariantLayoutBuilder = (input): LayoutModel | null => buildFcaLayout({
  frameColor: "#7c8355",
  paintHeader,
  specTitle: (d) => [d.vehicle.make, d.vehicle.model, d.vehicle.trim ?? ""].filter(Boolean).join(" ").toUpperCase() + (d.vehicle.drivetrain ? ` (${d.vehicle.drivetrain.toUpperCase()})` : ""),
  priceRows: (d) => priceRows(d),
})(input);
