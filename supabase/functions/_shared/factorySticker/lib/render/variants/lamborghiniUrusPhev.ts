// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/lamborghiniUrusPhev.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { FactoryStickerData } from "../../types.ts";
import { Painter, type LayoutModel } from "../layout.ts";
import { PAPER, type VariantLayoutBuilder } from "./shared.ts";
import { R, T, wrap } from "./hyundaiTucsonGas.ts";
import { TABLOID_HEIGHT, TABLOID_WIDTH, assembleTabloid, colorText, dealerLines, type FirstPageContext, type FirstPageResult, type FlowStyle, type TabloidSpec, } from "./tabloidCommon.ts";
import { PRICE_FOOTNOTE, PX, makeGrid, money, paintCatalogParts, paintCatalogSafety } from "./catalogBlocks.ts";
import { paintEvEpa } from "./evPanels.ts";
import { VARIANT_LOGOS } from "./logoArtwork.ts";
import { flowEquipmentColumns, paintPriceList, paintTotals } from "./catalogPage.ts";
export const LAMBORGHINI_URUS_PHEV_ID = "lamborghini_2026_urus_se";
const EQ_STYLE: FlowStyle = { size: 12.8, lh: 14.8, hang: 6, inset: 0 };
function paintDealerColumn(p: Painter, x: number, y: number, label: string, lines: string[]): void {
    T(p, label, x, y, 7.4, "bold");
    lines.slice(0, 4).forEach((l, i) => T(p, l, x, y + 10 + i * 8, 6.6, "body"));
}
const spec: TabloidSpec = {
    eqStyle: EQ_STYLE,
    paintFirst(p: Painter, ctx: FirstPageContext): FirstPageResult | null {
        const { d, input } = ctx;
        const v = d.vehicle;
        const g = makeGrid(36, 120, ctx.footerTop * 0.612 - 8, 1060);
        const left = g.x(183);
        const right = g.x(468);
        T(p, [v.make, v.model].filter(Boolean).join(" "), left, g.y(138), 14, "body");
        const logo = VARIANT_LOGOS.lamborghini;
        p.image(logo.png, logo.assetId, g.x(logo.slot.x), g.y(logo.slot.y), logo.slot.w * PX, g.y(logo.slot.y + logo.slot.h) - g.y(logo.slot.y));
        const table: Array<[
            string,
            string | null
        ]> = [
            ["Model", [v.make, v.model, v.trim ?? ""].filter(Boolean).join(" ")],
            ["Year", v.year > 0 ? String(v.year) : null],
            ["Vehicle ID Number", v.vin],
            ["Exterior", colorText(v.exteriorColor, v.exteriorColorCode)],
            ["Interior", colorText(v.interiorColor, v.interiorColorCode)],
            ["Engine", v.engine ?? null],
            ["Transmission", v.transmission ?? null],
        ];
        let ty = 168;
        for (const [label, value] of table) {
            if (!value)
                continue;
            T(p, label, left, g.y(ty), 7.8, "bold");
            T(p, value, right, g.y(ty), 7.8, "body", { align: "right" });
            ty += 15;
        }
        const mTop = ty + 12;
        T(p, "Manufacturer's Suggested Retail Price", left, g.y(mTop), 8.4, "bold");
        T(p, "Base Vehicle Price", left, g.y(mTop + 15), 8, "bold");
        T(p, money(d.pricing.baseMsrp), right, g.y(mTop + 15), 8, "body", { align: "right" });
        T(p, "Optional Equipment", left, g.y(mTop + 30), 8, "bold");
        const end = paintPriceList(p, d, { x: left, y: g.y(mTop + 45), w: right - left, limit: g.y(860), amountRight: right });
        if (end === null)
            return null;
        const totalsY = Math.max(end + 10, g.y(812));
        paintTotals(p, d, { x: left, right, y: totalsY, destinationLabel: "Destination Charge", totalLabel: "Total Suggested Retail Price", size: 7.8 });
        const noteY = totalsY + 34;
        const noteLines = wrap(PRICE_FOOTNOTE, "body", 6.2, right - left);
        noteLines.forEach((l, i) => T(p, l, left, noteY + i * 7.2, 6.2, "body", { align: "left" }));
        const tailTop = noteY + noteLines.length * 7.2 + 8;
        const barcodeTop = g.y(1004);
        if (tailTop > barcodeTop - 20)
            return null;
        const result = flowEquipmentColumns(p, ctx, [{ x: g.x(505), w: 245 * PX, top: g.y(168), bottom: g.y(1050) }], {
            tail: [{ x: left, w: right - left, top: tailTop, bottom: barcodeTop - 6 }],
            unavailableAt: [g.x(508), g.y(174)],
        });
        if (input.layout.barcodePayload)
            p.barcode(left, barcodeTop, 250 * PX, g.y(1052) - barcodeTop, input.layout.barcodePayload, "#000000");
        const dealer = dealerLines(d);
        paintDealerColumn(p, g.x(1106), g.y(132), "Dealer sold to", dealer);
        paintDealerColumn(p, g.x(1280), g.y(132), "Dealer Delivered to", d.factory.transportMethod ? [`Transport method: ${d.factory.transportMethod}`] : []);
        const gr = makeGrid(g.y(210), 210, g.y(210) + 453 * PX, 210 + 453);
        paintEvEpa(p, d, gr, 800, 210, { mode: "phev", widthPx: 700, qr: true });
        const safetyTop = Math.max(g.y(630), gr.y(210 + 453) + 6);
        const safetyBottom = Math.max(g.y(850), safetyTop + 182);
        paintCatalogSafety(p, d, g.x(800), safetyTop, 700 * PX, safetyBottom - safetyTop);
        const partsTop = safetyBottom + 4;
        paintCatalogParts(p, d, g.x(800), partsTop, 700 * PX, Math.min(g.y(1030), ctx.footerTop * 0.612 - 8) - partsTop, 2);
        return result;
    },
};
export const buildLamborghiniUrusPhevLayout: VariantLayoutBuilder = (input): LayoutModel | null => {
    const model = assembleTabloid(input, spec);
    if (model && (model.width !== TABLOID_WIDTH || model.height !== TABLOID_HEIGHT))
        return null;
    return model;
};
