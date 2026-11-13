// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/ramLimitedDiesel.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { FactoryStickerData } from "../../types.ts";
import type { LayoutModel, Painter } from "../layout.ts";
import { VARIANT_LOGOS } from "./logoArtwork.ts";
import { PASSPORT_QR_CAPTION } from "../../reproduction.ts";
import { PASSPORT_QR_PT, T, Y } from "./hyundaiTucsonGas.ts";
import { INK } from "./shared.ts";
import { EPA_W, EPA_X, PARTS_X, buildFcaLayout, fitSize, paintSafety } from "./fcaCommon.ts";
import { paintCarbPanel } from "./carbPanel.ts";
import { priceRowsWithoutColors } from "./tabloidCommon.ts";
import type { VariantLayoutBuilder } from "./shared.ts";
export const RAM_2500_DIESEL_ID = "ram_2026_2500_limited";
function modelLine(d: FactoryStickerData): string {
    const v = d.vehicle;
    const model = v.model.replace(new RegExp(`^${v.make}\\s+`, "i"), "").replace(/\s+pickup$/i, "");
    return [v.make, model, v.trim ?? "", v.drivetrain ?? ""].filter(Boolean).join(" ").toUpperCase();
}
function paintHeader(p: Painter, d: FactoryStickerData): void {
    const logo = VARIANT_LOGOS.ram;
    const w = 44;
    p.image(logo.png, logo.assetId, 57, Y(50), w, (w * logo.slot.h) / logo.slot.w);
    if (d.vehicle.year > 0)
        T(p, `${d.vehicle.year} MODEL YEAR`, 118, Y(53), 12.5, "bold");
    const title = modelLine(d);
    T(p, title, 120, Y(70), fitSize(title, "bold", 27, 520, 14), "bold");
    T(p, "For more information visit: www.ramtrucks.com", 880, Y(55.9), 12, "body", { align: "center" });
    T(p, "or call 1-866-RAMINFO", 880, Y(68.9), 12, "body", { align: "center" });
}
const paintRightFor = (master: boolean) => (p: Painter, d: FactoryStickerData): void => {
    paintCarbPanel(p, d, EPA_X, Y(101), EPA_W, Y(426) - Y(101));
    paintSafety(p, d, master);
    const url = d.document.passportUrl.trim();
    if (!url)
        return;
    const y = Y(446);
    p.qr(PARTS_X + 2, y, PASSPORT_QR_PT, url, INK);
    T(p, "VEHICLE PASSPORT", PARTS_X + PASSPORT_QR_PT + 10, y + 20, 9, "bold");
    T(p, PASSPORT_QR_CAPTION, PARTS_X + PASSPORT_QR_PT + 10, y + 33, 8, "body");
};
export const makeRam2500HdLayout = (masterGeometry: boolean): VariantLayoutBuilder => (input): LayoutModel | null => buildFcaLayout({
    frameColor: "#000000",
    paintHeader,
    specTitle: modelLine,
    priceRows: (d) => priceRowsWithoutColors(d),
    paintRight: paintRightFor(masterGeometry),
    masterGeometry,
})(input);
export const buildRam2500DieselLayout: VariantLayoutBuilder = makeRam2500HdLayout(false);
