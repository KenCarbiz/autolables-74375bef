// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/jeepWranglerGas.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
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
    if (v.year > 0)
        T(p, `${v.year} MODEL YEAR (${String(v.year).slice(-2)}MY)`, 165.4, Y(38.3), 14.8, "bold");
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
