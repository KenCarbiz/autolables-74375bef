// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/catalogPage.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { FactoryStickerData } from "../../types.ts";
import { PAGE_MARGIN, Painter, fitOk, validateModel, type LayoutModel } from "../layout.ts";
import { REPRODUCTION_BANNER } from "../../reproduction.ts";
import { INK, PAPER, type VariantLayoutBuilder, type VariantRenderInput } from "./shared.ts";
import { Q } from "./catalogBlocks.ts";
import { R, T, wrap } from "./hyundaiTucsonGas.ts";
import { MAX_EXTRA_COLUMNS, bx, buildSections, disclosureLines, flow, formatMoney, paintPlaced, placedResult, priceRowsWithoutColors, styleLadder, toEntries, totalMsrp, tx, wrapD, withColumns, type ColumnSpec, type FirstPageContext, type FirstPageResult, type PriceRow, type TabloidSpec, } from "./tabloidCommon.ts";
const UNIT = 0.612;
const DISPLAY_PT = 1.224 / 2;
export interface PageSize {
    widthPt: number;
    heightPt: number;
    frame?: string;
}
function paintBanner(p: Painter, widthUnits: number): void {
    bx(p, 30, 15, widthUnits - 60, 24, null, 1.6);
    tx(p, REPRODUCTION_BANNER, 38, 18.5, 15.4, "bold");
    tx(p, "PAGE 1 OF 1", widthUnits - 40, 21, 11, "bold", { align: "right" });
}
function disclosureHeight(lines: string[], widthUnits: number): number {
    let n = 0;
    for (const para of lines)
        n += wrapD(para, "body", 13.2, widthUnits - 60).length;
    return 24 + n * 17;
}
function paintDisclosure(p: Painter, lines: string[], top: number, widthUnits: number): void {
    tx(p, REPRODUCTION_BANNER, 30, top, 15.4, "bold");
    let y = top + 24;
    for (const para of lines) {
        for (const line of wrapD(para, "body", 13.2, widthUnits - 60)) {
            tx(p, line, 30, y, 13.2, "body", { lh: 17 });
            y += 17;
        }
    }
}
export function assembleCatalogPage(input: VariantRenderInput, spec: TabloidSpec, page: PageSize): LayoutModel | null {
    const d = input.layout.data;
    const widthUnits = page.widthPt / UNIT;
    const disclosure = disclosureLines(input);
    const bottomUnits = page.heightPt / UNIT - 15;
    const footerTop = Math.min(bottomUnits - 96, bottomUnits - disclosureHeight(disclosure, widthUnits));
    for (const style of styleLadder(spec.eqStyle)) {
        for (let extraColumns = 0; extraColumns <= MAX_EXTRA_COLUMNS; extraColumns++) {
            const ctx: FirstPageContext = { input, d, footerTop, style, extraColumns };
            const probe = spec.paintFirst(new Painter(null), ctx);
            if (probe === null)
                return null;
            if (probe.rest.length)
                continue;
            const drawn: string[] = [];
            const p = new Painter(drawn);
            if (page.frame) {
                const m = PAGE_MARGIN;
                R(p, m, m, page.widthPt - 2 * m, page.heightPt - 2 * m, page.frame);
                R(p, m + 2, m + 2, page.widthPt - 2 * m - 4, 17, PAPER);
                R(p, m + 2, footerTop * UNIT - 4, page.widthPt - 2 * m - 4, page.heightPt - m - 2 - (footerTop * UNIT - 4), PAPER);
            }
            paintBanner(p, widthUnits);
            spec.paintFirst(p, ctx);
            paintDisclosure(p, disclosure, footerTop, widthUnits);
            const model: LayoutModel = {
                width: page.widthPt,
                height: page.heightPt,
                mode: style === spec.eqStyle ? "STANDARD" : "DENSE",
                pages: [{ primitives: p.primitives }],
                drawnStrings: drawn,
                printedEquipment: probe.printed,
                fontFamilies: { heading: "Helvetica-Bold", body: "Helvetica", numeric: "Courier" },
                fit: fitOk(0, style.size * DISPLAY_PT),
            };
            validateModel(model);
            return model;
        }
    }
    return null;
}
export const catalogPageBuilder = (spec: TabloidSpec, page: PageSize): VariantLayoutBuilder => (input) => {
    const model = assembleCatalogPage(input, spec, page);
    return model && model.width === page.widthPt && model.height === page.heightPt ? model : null;
};
export interface PtColumn {
    x: number;
    w: number;
    top: number;
    bottom: number;
}
export function flowEquipmentColumns(p: Painter, ctx: FirstPageContext, cols: PtColumn[], o: {
    upper?: boolean;
    bullet?: "dot" | "square";
    unavailableAt?: [
        number,
        number
    ];
    tail?: PtColumn[];
} = {}): FirstPageResult {
    const sections = buildSections(ctx.input);
    if (!sections.length && o.unavailableAt)
        T(p, "Standard equipment not available for this vehicle.", o.unavailableAt[0], o.unavailableAt[1], 8, "body");
    const entries = toEntries(sections, (s) => (o.upper ? s.toUpperCase() : s), 4, undefined, ctx.input.equipmentNote)
        .map((e) => (o.upper && !e.heading && !e.note ? { ...e, text: e.text.toUpperCase() } : e));
    const base: ColumnSpec[] = cols.map((c) => ({ x: Q(c.x), w: Q(c.w), top: Q(c.top), bottom: Q(c.bottom) }));
    const tail: ColumnSpec[] = (o.tail ?? []).map((c) => ({ x: Q(c.x), w: Q(c.w), top: Q(c.top), bottom: Q(c.bottom) }));
    const { placed, rest } = flow(entries, [...withColumns(base, ctx.extraColumns), ...tail], ctx.style);
    paintPlaced(p, placed, ctx.style, { headingFont: "bold", ...(o.bullet ? { bullet: o.bullet } : {}) });
    return placedResult(entries, rest);
}
export interface PriceListOptions {
    x: number;
    y: number;
    w: number;
    limit: number;
    amountRight?: number;
}
export function paintPriceList(p: Painter | null, d: FactoryStickerData, o: PriceListOptions): number | null {
    const rows: PriceRow[] = priceRowsWithoutColors(d);
    for (let size = 8; size >= 5.6; size -= 0.6) {
        for (const withFeatures of [true, false]) {
            const probe = new Painter(null);
            const end = layoutRows(probe, rows, o, size, withFeatures);
            if (end === null)
                continue;
            if (p)
                layoutRows(p, rows, o, size, withFeatures);
            return end;
        }
    }
    return null;
}
function layoutRows(p: Painter, rows: PriceRow[], o: PriceListOptions, size: number, withFeatures: boolean): number | null {
    const right = o.amountRight ?? o.x + o.w;
    const step = size + 1.5;
    let y = o.y;
    for (const row of rows) {
        const lines = wrap(row.label, "body", size, o.w - 56);
        const feats = withFeatures ? row.features.flatMap((f) => wrap(`- ${f}`, "body", size - 0.8, o.w - 64)) : [];
        const h = lines.length * step + feats.length * (step - 0.8) + 1;
        if (y + h > o.limit)
            return null;
        lines.forEach((l, i) => T(p, l, o.x, y + i * step, size, "body"));
        if (row.amount)
            T(p, row.amount, right, y, size, "body", { align: "right" });
        feats.forEach((l, i) => T(p, l, o.x + 8, y + lines.length * step + i * (step - 0.8), size - 0.8, "body"));
        y += h;
    }
    return y;
}
export function paintTotals(p: Painter, d: FactoryStickerData, o: {
    x: number;
    right: number;
    y: number;
    destinationLabel: string;
    totalLabel: string;
    size: number;
}): void {
    T(p, o.destinationLabel, o.x, o.y, o.size, "body");
    T(p, d.pricing.destinationCharge !== undefined ? formatMoney(d.pricing.destinationCharge) : "N/A", o.right, o.y, o.size, "body", { align: "right" });
    p.rect(o.x, o.y + o.size + 4, o.right - o.x, 1, INK);
    const total = totalMsrp(d);
    T(p, o.totalLabel, o.x, o.y + o.size + 8, o.size + 1.4, "bold");
    T(p, total !== undefined ? formatMoney(total) : "N/A", o.right, o.y + o.size + 8, o.size + 1.4, "bold", { align: "right" });
}
