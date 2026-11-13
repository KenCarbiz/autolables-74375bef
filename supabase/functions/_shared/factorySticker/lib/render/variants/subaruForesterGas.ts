// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/subaruForesterGas.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { FactoryStickerData } from "../../types.ts";
import type { LayoutModel, Painter } from "../layout.ts";
import { VARIANT_LOGOS } from "./logoArtwork.ts";
import { INK, type VariantLayoutBuilder } from "./shared.ts";
import { T, wrap } from "./hyundaiTucsonGas.ts";
import { TABLOID_HEIGHT, TABLOID_WIDTH, assembleTabloid, buildSections, colorText, dealerLines, flow, paintPlaced, placedResult, priceRowsWithoutColors, toEntries, totalMsrp, warrantySection, withColumns, type FirstPageContext, type FirstPageResult, type FlowStyle, type TabloidSpec, } from "./tabloidCommon.ts";
import { PRICE_FOOTNOTE, PX, Q, makeGrid, money, paintCatalogEpa, paintCatalogParts, paintCatalogSafety, paintPriceLines, paintWarranty, } from "./catalogBlocks.ts";
export const SUBARU_FORESTER_GAS_ID = "subaru_2026_forester_wilderness";
const EQ_STYLE: FlowStyle = { size: 13.4, lh: 15.6, hang: 6, inset: 0 };
const g = makeGrid(30, 55, 709, 1052);
function paintHeader(p: Painter, d: FactoryStickerData): void {
    const logo = VARIANT_LOGOS.subaru;
    const w = 235 * PX;
    p.image(logo.png, logo.assetId, g.x(1405), g.y(58), w, (w * logo.slot.h) / logo.slot.w);
    const v = d.vehicle;
    const wordmark = v.model.toUpperCase();
    T(p, wordmark, g.x(52), g.y(58), 22, "bold");
    const title = [v.year > 0 ? String(v.year) : "", v.make, v.model, v.trim ?? ""].filter(Boolean).join(" ").toUpperCase();
    const rows: Array<[
        string,
        string | null
    ]> = [
        ["VIN", v.vin],
        ["Vehicle", title],
        ["Port/Assembly", d.factory.finalAssemblyPoint ? d.factory.finalAssemblyPoint.toUpperCase() : null],
        ["Deliver by/Carrier", d.factory.transportMethod ? d.factory.transportMethod.toUpperCase() : null],
    ];
    let y = 54;
    for (const [label, value] of rows) {
        if (!value)
            continue;
        T(p, label, g.x(372), g.y(y), 8, "bold");
        T(p, value, g.x(484), g.y(y), label === "VIN" ? 9 : 7.6, label === "VIN" ? "bold" : "body");
        y += 14;
    }
}
function paintPrices(p: Painter, d: FactoryStickerData): number | null {
    const L = g.x(1219);
    const Rt = g.x(1634);
    T(p, "OPTIONAL EQUIPMENT AND OTHER ITEMS", L, g.y(110), 10.5, "bold");
    T(p, "Manufacturer's Suggested Retail Price", L, g.y(132), 8.6, "body");
    T(p, money(d.pricing.baseMsrp), Rt, g.y(132), 8.6, "bold", { align: "right" });
    const color = colorText(d.vehicle.exteriorColor, d.vehicle.exteriorColorCode);
    let y = 150;
    if (color) {
        T(p, `Exterior Color: ${color}`, L, g.y(y), 8.6, "body");
        y += 18;
    }
    const after = paintPriceLines(p, priceRowsWithoutColors(d), L, Rt, g.y(y + 4), g.y(960), { size: 8.6, labelW: 285 });
    if (after === null)
        return null;
    let ty = 975;
    if (d.pricing.gasGuzzlerTax !== undefined) {
        T(p, "Gas Guzzler Tax", L, g.y(ty - 20), 8.6, "body");
        T(p, money(d.pricing.gasGuzzlerTax), Rt, g.y(ty - 20), 8.6, "body", { align: "right" });
    }
    T(p, "Destination and Delivery", L, g.y(ty), 9.4, "bold");
    T(p, money(d.pricing.destinationCharge), Rt, g.y(ty), 9.4, "bold", { align: "right" });
    ty += 20;
    T(p, "Total Suggested Retail Price", L, g.y(ty), 9.4, "bold");
    T(p, money(totalMsrp(d)), Rt, g.y(ty), 9.4, "bold", { align: "right" });
    wrap(PRICE_FOOTNOTE, "body", 6.4, 420 * PX).forEach((l, i) => T(p, l, L, g.y(1022) + i * 7, 6.4, "body"));
    return after;
}
const spec: TabloidSpec = {
    eqStyle: EQ_STYLE,
    paintFirst(p: Painter, ctx: FirstPageContext): FirstPageResult | null {
        const { d, input } = ctx;
        const priceEnd = paintPrices(p, d);
        if (priceEnd === null)
            return null;
        paintHeader(p, d);
        const sTop = g.y(112);
        paintCatalogSafety(p, d, g.x(52), sTop, 458 * PX, g.y(480) - sTop);
        paintCatalogParts(p, d, g.x(515), sTop, 233 * PX, g.y(480) - sTop);
        paintCatalogEpa(p, d, g, 52, 481);
        T(p, "SOLD TO:", g.x(56), g.y(952), 7.4, "bold");
        if (d.factory.dealerCode)
            T(p, d.factory.dealerCode.toUpperCase(), g.x(56) + 40, g.y(952), 7.4, "bold");
        dealerLines(d).slice(0, 3).forEach((l, i) => T(p, l, g.x(56), g.y(970) + i * 9, 7.2, "body"));
        wrap(PRICE_FOOTNOTE, "body", 6.4, 250 * PX).forEach((l, i) => T(p, l, g.x(56), g.y(1018) + i * 7, 6.4, "body"));
        if (input.layout.barcodePayload)
            p.barcode(g.x(330), g.y(965), 415 * PX, g.y(1040) - g.y(965), input.layout.barcodePayload, INK);
        T(p, "STANDARD EQUIPMENT", g.x(764), g.y(110), 10.5, "bold");
        const sections = buildSections(input);
        if (!sections.length)
            T(p, "Standard equipment not available for this vehicle.", g.x(764), g.y(134), 8, "body");
        const entries = toEntries(sections, (s) => s.toUpperCase(), 3, undefined, input.equipmentNote);
        const cols = [
            ...withColumns([{ x: Q(g.x(764)), w: Q(430 * PX), top: Q(g.y(132)), bottom: Q(g.y(905)) }], ctx.extraColumns),
            { x: Q(g.x(1219)), w: Q(415 * PX), top: Q(priceEnd + 6), bottom: Q(g.y(946)) },
        ];
        const { placed, rest } = flow(entries, cols, ctx.style);
        paintPlaced(p, placed, ctx.style, { headingFont: "bold" });
        const w = warrantySection(d, "Warranty");
        paintWarranty(p, d, w ? w.items : null, g.x(764), g.y(916), 420 * PX, "LIMITED WARRANTY");
        return placedResult(entries, rest);
    },
};
export const buildSubaruForesterGasLayout: VariantLayoutBuilder = (input): LayoutModel | null => {
    const model = assembleTabloid(input, spec);
    if (model && (model.width !== TABLOID_WIDTH || model.height !== TABLOID_HEIGHT))
        return null;
    return model;
};
