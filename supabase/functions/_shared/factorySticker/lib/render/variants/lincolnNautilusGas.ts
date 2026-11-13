// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/lincolnNautilusGas.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { FactoryStickerData } from "../../types.ts";
import { Painter, formatMoney, type LayoutModel } from "../layout.ts";
import { VARIANT_LOGOS } from "./logoArtwork.ts";
import { INK, PAPER, type VariantLayoutBuilder } from "./shared.ts";
import { R, T, wrap } from "./hyundaiTucsonGas.ts";
import { TABLOID_HEIGHT, TABLOID_WIDTH, assembleTabloid, buildSections, colorText, dealerLines, flow, paintPlaced, placedResult, priceRowsWithoutColors, toEntries, totalMsrp, warrantySection, type FirstPageContext, type FirstPageResult, type FlowStyle, type TabloidSpec, } from "./tabloidCommon.ts";
import { PRICE_FOOTNOTE, PX, Q, makeGrid, msrpWithOptions, optionsTotalOf, paintCatalogEpa, paintCatalogSafety } from "./catalogBlocks.ts";
import { fitSize } from "./fcaCommon.ts";
import { placeRows } from "./priceColumns.ts";
export const LINCOLN_NAUTILUS_GAS_ID = "lincoln_2026_nautilus_premiere";
const BROWN = "#3f2e2e";
const EQ_STYLE: FlowStyle = { size: 11.4, lh: 12.4, hang: 5, inset: 9 };
const FRAME_TOP = 35;
const FRAME_BOTTOM = 1063;
const X = (px: number): number => px * PX;
type Ym = (px: number) => number;
const plain = (n: number | undefined): string => (n === undefined ? "NOT AVAILABLE" : formatMoney(n));
function paintHeader(p: Painter, d: FactoryStickerData, m: Ym): void {
    const v = d.vehicle;
    R(p, X(45), m(55), X(180), m(180) - m(55), PAPER);
    const logo = VARIANT_LOGOS.lincoln;
    const h = m(160) - m(75);
    const w = (h * logo.slot.w) / logo.slot.h;
    p.image(logo.png, logo.assetId, X(135) - w / 2, m(75), w, h);
    T(p, "VEHICLE DESCRIPTION", X(233), m(61), 7.4, "bold", { color: PAPER });
    const name = [v.make, v.model].filter(Boolean).join(" ").toUpperCase();
    if (name)
        T(p, name, X(233), m(80), fitSize(name, "bold", 26, X(520), 14), "bold", { color: PAPER });
    const lines = [
        [v.year > 0 ? String(v.year) : "", v.drivetrain ?? "", v.trim ?? ""].filter(Boolean).join(" ").toUpperCase(),
        v.engine?.toUpperCase() ?? "",
        v.transmission?.toUpperCase() ?? "",
    ].filter(Boolean);
    lines.forEach((l, i) => T(p, l, X(297), m(119) + i * 9.2, 7.6, "bold", { color: PAPER }));
    let y = 119;
    for (const [label, value] of [["EXTERIOR", colorText(v.exteriorColor, v.exteriorColorCode)], ["INTERIOR", colorText(v.interiorColor, v.interiorColorCode)]] as const) {
        if (!value)
            continue;
        T(p, label, X(597), m(y), 7.6, "bold", { color: PAPER });
        T(p, value.toUpperCase(), X(609), m(y) + 9, fitSize(value.toUpperCase(), "bold", 7.6, X(320), 5.8), "bold", { color: PAPER });
        y += 27;
    }
}
function paintPricing(p: Painter, d: FactoryStickerData, m: Ym): boolean {
    const rows = priceRowsWithoutColors(d).map((r) => ({
        label: r.label.toUpperCase(),
        amount: r.amount,
        features: r.features.map((f) => `• ${f.toUpperCase()}`),
    }));
    const top = m(500);
    const limit = m(602);
    const placed = placeRows(rows, [
        { x: X(50), right: X(335), top, limit },
        { x: X(350), right: X(625), top, limit },
    ], 7.4, 0.6);
    if (!placed)
        return false;
    T(p, "INCLUDED ON THIS VEHICLE", X(50), m(447), 8, "bold");
    T(p, "(MSRP)", X(335), m(447), 8, "bold", { align: "right" });
    T(p, "(MSRP)", X(925), m(447), 8, "bold", { align: "right" });
    T(p, "OPTIONAL EQUIPMENT/OTHER", X(50), m(480), 8, "bold");
    R(p, X(50), m(480) + 9, X(193), 0.8, INK);
    for (const t of placed.placed)
        T(p, t.text, t.right ?? t.x, t.y, t.size, "body", t.right !== undefined ? { align: "right" } : {});
    const pr = d.pricing;
    const L = X(640);
    const Rt = X(925);
    T(p, "PRICE INFORMATION", L, m(456), 8, "bold");
    R(p, L, m(456) + 9, X(125), 0.8, INK);
    const row = (label: string, value: string, i: number): void => {
        const y = m(474) + i * 11 + (i >= 2 ? 8 : 0);
        T(p, label, L, y, 7.6, "body");
        T(p, value, Rt, y, value === "NOT AVAILABLE" ? 6 : 7.6, "body", { align: "right" });
    };
    row("BASE PRICE", plain(pr.baseMsrp), 0);
    row("TOTAL OPTIONS/OTHER", plain(optionsTotalOf(d)), 1);
    R(p, X(830), m(474) + 2 * 11 + 2, X(95), 0.8, INK);
    row("TOTAL VEHICLE & OPTIONS/OTHER", plain(msrpWithOptions(d)), 2);
    row("DESTINATION & DELIVERY", plain(pr.destinationCharge), 3);
    if (pr.gasGuzzlerTax !== undefined)
        row("GAS GUZZLER TAX", plain(pr.gasGuzzlerTax), 4);
    return true;
}
function paintBottom(p: Painter, d: FactoryStickerData, input: FirstPageContext["input"], m: Ym): void {
    const f = d.factory;
    R(p, X(45), m(862), X(300), m(1045) - m(862), PAPER);
    R(p, X(350), m(862), X(275), m(1045) - m(862), PAPER);
    T(p, "SOLD TO", X(56), m(872), 7.4, "bold");
    if (f.dealerCode)
        T(p, f.dealerCode.toUpperCase(), X(56) + 44, m(872), 7.4, "bold");
    dealerLines(d).slice(0, 4).forEach((l, i) => T(p, l, X(60), m(890) + i * 9, 7.6, "body"));
    const origin = f.finalAssemblyPoint ?? f.assemblyPlant;
    if (origin) {
        T(p, "FINAL ASSEMBLY PLANT", X(360), m(872), 6, "body", { color: BROWN });
        T(p, origin.toUpperCase(), X(360), m(886), 8, "body");
    }
    if (f.transportMethod) {
        T(p, "METHOD OF TRANSP.", X(360), m(930), 6, "body", { color: BROWN });
        T(p, f.transportMethod.toUpperCase(), X(360), m(944), 8, "body");
    }
    const total = totalMsrp(d);
    T(p, "TOTAL MSRP", X(652), m(878), 13, "bold", { color: PAPER });
    T(p, total !== undefined ? formatMoney(total) : "NOT AVAILABLE", X(925), m(878), total !== undefined ? 13 : 9, "bold", { align: "right", color: PAPER });
    wrap(PRICE_FOOTNOTE, "body", 6.4, X(272)).forEach((l, i) => T(p, l, X(652), m(920) + i * 7.4, 6.4, "body", { color: PAPER }));
    R(p, X(945), m(868), X(448), m(922) - m(868), PAPER);
    T(p, d.vehicle.vin, X(1169), m(871), 8.4, "bold", { align: "center" });
    if (input.layout.barcodePayload)
        p.barcode(X(955), m(888), X(428), m(918) - m(888), input.layout.barcodePayload, INK);
    const wTop = m(928);
    R(p, X(945), wTop, X(700), m(1045) - wTop, PAPER, 1.4);
    p.path("M10 0 L20 18 L0 18 Z", X(956), wTop + 8, 20, 18, null, INK, 1.6);
    T(p, "!", X(956) + 10, wTop + 14, 10, "bold", { align: "center" });
    const warning = "WARNING: Operating, servicing and maintaining a passenger vehicle, pickup truck, van, or off-road vehicle can expose you to chemicals including engine exhaust, carbon monoxide, phthalates, and lead, which are known to the State of California to cause cancer and birth defects or other reproductive harm. To minimize exposure, avoid breathing exhaust, do not idle the engine except as necessary, service your vehicle in a well-ventilated area and wear gloves or wash your hands frequently when servicing your vehicle. For more information go to www.P65Warnings.ca.gov/passenger-vehicle.";
    wrap(warning, "body", 7, X(640)).forEach((l, i) => T(p, l, X(1000), wTop + 6 + i * 8, 7, "body"));
}
const spec: TabloidSpec = {
    eqStyle: EQ_STYLE,
    paintFirst(p: Painter, ctx: FirstPageContext): FirstPageResult | null {
        const { d, input } = ctx;
        const bottom = ctx.footerTop * 0.612 - 6;
        const m: Ym = (px) => 28 + (px - FRAME_TOP) * ((bottom - 28) / (FRAME_BOTTOM - FRAME_TOP));
        R(p, X(25), m(FRAME_TOP), X(1650), m(FRAME_BOTTOM) - m(FRAME_TOP), BROWN);
        R(p, X(45), m(180), X(890), m(860) - m(180), PAPER);
        if (!paintPricing(p, d, m))
            return null;
        paintHeader(p, d, m);
        T(p, "STANDARD EQUIPMENT", X(50), m(187), 8, "bold");
        T(p, "INCLUDED AT NO EXTRA CHARGE", X(50) + 98, m(187), 8, "bold");
        R(p, X(50) + 98, m(187) + 9, X(215), 0.8, INK);
        paintBottom(p, d, input, m);
        const g = makeGrid(m(60), 60, m(60) + 0.7 * 450, 510);
        paintCatalogEpa(p, d, g, 945, 60);
        const safetyTop = m(60) + 0.7 * 453 + 4;
        paintCatalogSafety(p, d, X(945), safetyTop, X(448), m(862) - safetyTop);
        const warranty = warrantySection(d, "Warranty");
        const sections = [...buildSections(input), ...(warranty ? [warranty] : [])];
        const entries = toEntries(sections, (s) => s.toUpperCase(), 6, undefined, input.equipmentNote)
            .map((e) => (e.heading || e.note ? e : { ...e, text: e.text.toUpperCase() }));
        if (!sections.length)
            entries.unshift({ text: "Standard equipment not available for this vehicle.", heading: false, gapBefore: 0, note: true });
        if (!warranty) {
            const at = entries.length && entries[entries.length - 1].note ? entries.length - 1 : entries.length;
            entries.splice(at, 0, { text: "WARRANTY", heading: true, gapBefore: 6 }, { text: "Not available for this vehicle.", heading: false, gapBefore: 0, note: true });
        }
        const n = 4 + ctx.extraColumns;
        const gap = 10;
        const w = (880 - gap * (n - 1)) / n;
        const region = (y0: number, y1: number) => Array.from({ length: n }, (_, i) => ({
            x: Q(X(50 + i * (w + gap))),
            w: Q(X(w)),
            top: Q(m(y0)),
            bottom: Q(m(y1)),
        }));
        const { placed, rest } = flow(entries, [...region(213, 436), ...region(630, 856)], ctx.style);
        paintPlaced(p, placed, ctx.style, { bullet: "dot" });
        return placedResult(entries, rest);
    },
};
export const buildLincolnNautilusGasLayout: VariantLayoutBuilder = (input): LayoutModel | null => {
    const model = assembleTabloid(input, spec);
    if (model && (model.width !== TABLOID_WIDTH || model.height !== TABLOID_HEIGHT))
        return null;
    return model;
};
