// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/kiaSorentoGas.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { FactoryStickerData } from "../../types.ts";
import { Painter, formatMoney, type LayoutModel } from "../layout.ts";
import { VARIANT_LOGOS } from "./logoArtwork.ts";
import { INK, PAPER, type VariantLayoutBuilder } from "./shared.ts";
import { R, T, wrap } from "./hyundaiTucsonGas.ts";
import { TABLOID_HEIGHT, TABLOID_WIDTH, assembleTabloid, buildSections, colorText, dealerLines, flow, paintPlaced, placedResult, priceRowsWithoutColors, toEntries, totalMsrp, warrantySection, withColumns, yearModelTrim, type FirstPageContext, type FirstPageResult, type FlowStyle, type TabloidSpec, } from "./tabloidCommon.ts";
import { PRICE_FOOTNOTE, PX, Q, makeGrid, money, msrpWithOptions, paintBands, paintCatalogEpa, paintCatalogParts, paintCatalogSafety, paintPriceLines, paintWarranty, } from "./catalogBlocks.ts";
export const KIA_SORENTO_GAS_ID = "kia_2026_sorento_lx";
const EQ_STYLE: FlowStyle = { size: 13.4, lh: 15.4, hang: 6, inset: 0 };
const RED = "#e9615a";
const g = makeGrid(28, 42, 709, 1052);
function paintHeader(p: Painter, d: FactoryStickerData): void {
    const logo = VARIANT_LOGOS.kia;
    const w = 193 * PX;
    p.image(logo.png, logo.assetId, g.x(1455), g.y(100), w, (w * logo.slot.h) / logo.slot.w);
    const title = yearModelTrim(d, ["year", "model", "trim", "drivetrain"], d.vehicle.make);
    T(p, title, g.x(48), g.y(60), 15, "bold");
    const rows: Array<[
        string,
        string | null
    ]> = [
        ["EXTERIOR COLOR:", colorText(d.vehicle.exteriorColor, d.vehicle.exteriorColorCode)],
        ["INTERIOR COLOR:", colorText(d.vehicle.interiorColor, d.vehicle.interiorColorCode)],
        ["VEHICLE ID NUMBER:", d.vehicle.vin],
        ["ASSEMBLY POINT:", d.factory.finalAssemblyPoint ? d.factory.finalAssemblyPoint.toUpperCase() : null],
    ];
    let y = 94;
    for (const [label, value] of rows) {
        if (!value)
            continue;
        T(p, label, g.x(48), g.y(y), 7.6, "bold");
        T(p, value, g.x(190), g.y(y), 7.6, "body");
        y += 17;
    }
    T(p, "Sold To:", g.x(530), g.y(64), 8, "bold");
    if (d.factory.dealerCode)
        T(p, d.factory.dealerCode.toUpperCase(), g.x(530) + 36, g.y(64), 8, "body");
    dealerLines(d).slice(0, 3).forEach((l, i) => T(p, l, g.x(530), g.y(82) + i * 9, 7.4, "body"));
    T(p, "Ship To:", g.x(755), g.y(64), 8, "bold");
}
const arrow = (p: Painter, x: number, y: number, h: number): void => {
    p.path(`M0 0 L${h * 0.6} ${h / 2} L0 ${h} Z`, x, y, h * 0.6, h, PAPER);
};
function paintPrices(p: Painter, d: FactoryStickerData): number | null {
    const L = g.x(517);
    const Rt = g.x(958);
    const bar = (top: number, h: number, label: string): void => {
        R(p, L - 2, g.y(top), 350 * PX, g.y(top + h) - g.y(top), RED);
        T(p, label, L + 4, g.y(top) + (g.y(top + h) - g.y(top) - 8.4) / 2 - 0.5, 8.4, "bold", { color: PAPER });
        arrow(p, L - 2 + 350 * PX - 14, g.y(top) + 4, g.y(top + h) - g.y(top) - 8);
    };
    bar(188, 26, "MANUFACTURER'S SUGGESTED RETAIL PRICE");
    T(p, money(d.pricing.baseMsrp), Rt, g.y(193), 9.5, "bold", { align: "right" });
    T(p, "ADDITIONAL INSTALLED EQUIPMENT:", L, g.y(220), 8.8, "body");
    T(p, "(In addition to or in place of standard features)", L, g.y(237), 8, "body");
    const rows = priceRowsWithoutColors(d);
    const after = paintPriceLines(p, rows, L, Rt, g.y(254), g.y(828), { size: 8.5, labelW: 215 });
    if (after === null)
        return null;
    let y = 846;
    if (d.pricing.gasGuzzlerTax !== undefined) {
        T(p, "Gas Guzzler Tax", L, g.y(y - 22), 8.5, "body");
        T(p, formatMoney(d.pricing.gasGuzzlerTax), Rt, g.y(y - 22), 8.5, "body", { align: "right" });
    }
    T(p, "MSRP INCLUDING OPTIONS", L, g.y(y), 8.6, "body");
    T(p, money(msrpWithOptions(d)), Rt, g.y(y), 8.6, "body", { align: "right" });
    y = 888;
    T(p, "INLAND FREIGHT AND HANDLING", L, g.y(y), 7.8, "body");
    T(p, money(d.pricing.destinationCharge), Rt, g.y(y), 7.8, "body", { align: "right" });
    bar(915, 38, "TOTAL MANUFACTURER'S SUGGESTED RETAIL PRICE");
    T(p, money(totalMsrp(d)), Rt, g.y(925), 10, "bold", { align: "right" });
    return after;
}
const spec: TabloidSpec = {
    eqStyle: EQ_STYLE,
    paintFirst(p: Painter, ctx: FirstPageContext): FirstPageResult | null {
        const { d, input } = ctx;
        const priceEnd = paintPrices(p, d);
        if (priceEnd === null)
            return null;
        paintBands(p, g.x(27), g.y(42), g.x(1684), g.y(1052), 8, INK);
        paintHeader(p, d);
        if (input.layout.barcodePayload)
            p.barcode(g.x(535), g.y(975), 400 * PX, g.y(1034) - g.y(975), input.layout.barcodePayload, INK);
        R(p, g.x(40), g.y(188), 470 * PX, g.y(212) - g.y(188), INK);
        T(p, "STANDARD FEATURES", g.x(275), g.y(194), 9.8, "bold", { align: "center", color: PAPER });
        const sections = buildSections(input);
        if (!sections.length)
            T(p, "Standard equipment not available for this vehicle.", g.x(46), g.y(222), 8, "body");
        const entries = toEntries(sections, (s) => s.toUpperCase(), 3, undefined, input.equipmentNote);
        const cols = [
            ...withColumns([{ x: Q(g.x(44)), w: Q(462 * PX), top: Q(g.y(218)), bottom: Q(g.y(868)) }], ctx.extraColumns),
            { x: Q(g.x(519)), w: Q(430 * PX), top: Q(priceEnd + 6), bottom: Q(g.y(836)) },
        ];
        const { placed, rest } = flow(entries, cols, ctx.style);
        paintPlaced(p, placed, ctx.style, { headingFont: "bold" });
        const w = warrantySection(d, "Warranty");
        paintWarranty(p, d, w ? w.items : null, g.x(46), g.y(876), 460 * PX);
        paintCatalogEpa(p, d, g, 970, 187);
        const safeTop = g.y(645);
        paintCatalogSafety(p, d, g.x(968), safeTop, 470 * PX, g.y(990) - safeTop);
        paintCatalogParts(p, d, g.x(1442), safeTop, 232 * PX, g.y(1038) - safeTop);
        wrap(PRICE_FOOTNOTE, "body", 6.6, 462 * PX).forEach((l, i) => T(p, l, g.x(972), g.y(996) + i * 7.4, 6.6, "body"));
        return placedResult(entries, rest);
    },
};
export const buildKiaSorentoGasLayout: VariantLayoutBuilder = (input): LayoutModel | null => {
    const model = assembleTabloid(input, spec);
    if (model && (model.width !== TABLOID_WIDTH || model.height !== TABLOID_HEIGHT))
        return null;
    return model;
};
