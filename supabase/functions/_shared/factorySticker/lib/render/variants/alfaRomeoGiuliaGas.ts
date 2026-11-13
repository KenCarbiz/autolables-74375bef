// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/alfaRomeoGiuliaGas.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { FactoryStickerData } from "../../types.ts";
import type { LayoutModel, Painter } from "../layout.ts";
import { VARIANT_LOGOS } from "./logoArtwork.ts";
import { T, Y } from "./hyundaiTucsonGas.ts";
import { buildFcaLayout, fitSize } from "./fcaCommon.ts";
import { priceRowsWithoutColors } from "./tabloidCommon.ts";
import type { VariantLayoutBuilder } from "./shared.ts";
export const ALFA_ROMEO_GIULIA_GAS_ID = "alfa_romeo_2026_giulia_veloce";
const FRAME = "#c11726";
function paintHeader(p: Painter, d: FactoryStickerData): void {
    const logo = VARIANT_LOGOS.alfaromeo;
    const size = 80;
    p.image(logo.png, logo.assetId, 59, Y(38), size, (size * logo.slot.h) / logo.slot.w);
    const v = d.vehicle;
    const title = [v.model, v.trim ?? "", v.drivetrain ?? ""].filter(Boolean).join(" ").toUpperCase();
    if (title)
        T(p, title, 144, Y(62), fitSize(title, "bold", 29, 480, 16), "bold");
    if (v.year > 0)
        T(p, `${v.year} MODEL YEAR`, 143, Y(97), 13, "bold");
    T(p, "For more information visit: www.AlfaRomeoUSA.com", 875, Y(55.9), 12, "body", { align: "center" });
    T(p, "or call 1-844-ALFA-USA (1-844-253-2872)", 875, Y(68.9), 12, "body", { align: "center" });
}
export const buildAlfaRomeoGiuliaGasLayout: VariantLayoutBuilder = (input): LayoutModel | null => buildFcaLayout({
    frameColor: FRAME,
    paintHeader,
    specTitle: (d) => [d.vehicle.make, d.vehicle.model].filter(Boolean).join(" ").toUpperCase(),
    priceRows: (d) => priceRowsWithoutColors(d),
})(input);
