// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/hyundaiTucsonGas.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { EquipmentCategory, FactoryStickerData } from "../../types.ts";
import { Painter, fuelCategoryLabel, formatMoney, measureText, wrapText, type LayoutFont, type LayoutModel, } from "../layout.ts";
import { PASSPORT_QR_CAPTION } from "../../reproduction.ts";
import { VARIANT_LOGOS } from "./logoArtwork.ts";
import { EPA_BLUE, INK, PAPER, baseline, type VariantLayoutBuilder } from "./shared.ts";
import { TABLOID_HEIGHT, TABLOID_WIDTH, assembleTabloid, colorText, dealerLines, flow, paintPlaced, assemblyLabel, paintSafetyPanel, partsFacts, placedResult, priceRows, toEntries, totalMsrp, underlined, warrantySection, withColumns, type FirstPageContext, type FirstPageResult, type FlowStyle, type Section, type TabloidSpec, } from "./tabloidCommon.ts";
export const HYUNDAI_TUCSON_GAS_ID = "hyundai_2026_tucson_se_awd";
const Q = (pt: number): number => pt / 0.612;
export const Y = (ref: number): number => 30 + (ref - 18) * 0.93;
const EQ_STYLE: FlowStyle = { size: 13, lh: 15.5, hang: 6, inset: 0 };
const HYUNDAI_HIERARCHY: Array<[
    string,
    EquipmentCategory[]
]> = [
    ["Advanced Safety Technologies", ["SAFETY_SECURITY"]],
    ["Powertrain Technology", ["POWERTRAIN"]],
    ["Exterior", ["EXTERIOR"]],
    ["Comfort & Convenience", ["COMFORT_CONVENIENCE", "FUNCTIONAL"]],
    ["Interior", ["INTERIOR"]],
    ["Multimedia & Connectivity", ["TECHNOLOGY"]],
    ["Other Standard Equipment", ["OTHER"]],
];
export function hyundaiSections(d: FactoryStickerData, groups: Array<{
    hint: string;
    items: string[];
}> = []): Section[] {
    const seen = new Set<string>();
    const out: Section[] = [];
    const headings = new Set(HYUNDAI_HIERARCHY.map(([h]) => h.toUpperCase()));
    if (groups.length && groups.every((g) => headings.has(g.hint.trim().toUpperCase()))) {
        for (const g of groups) {
            const items = g.items.map((i) => i.trim()).filter((i) => i && !seen.has(i.toUpperCase()));
            items.forEach((i) => seen.add(i.toUpperCase()));
            if (items.length)
                out.push({ heading: g.hint.trim(), items });
        }
        return out;
    }
    for (const [heading, cats] of HYUNDAI_HIERARCHY) {
        const items: string[] = [];
        for (const g of d.equipment.standard) {
            if (!cats.includes(g.category))
                continue;
            for (const raw of g.items) {
                const item = raw.trim();
                if (!item || seen.has(item.toUpperCase()))
                    continue;
                seen.add(item.toUpperCase());
                items.push(item);
            }
        }
        if (items.length)
            out.push({ heading, items });
    }
    return out;
}
export const PASSPORT_QR_PT = 64.8;
export const T = (p: Painter, s: string, x: number, top: number, size: number, font: LayoutFont = "body", o: {
    align?: "left" | "right" | "center";
    color?: string;
    lh?: number;
} = {}): void => {
    const sz = Math.max(5.2, size);
    p.text(s, x, baseline(top, sz, o.lh), sz, font, o.color ?? INK, o.align ? { align: o.align } : {});
};
export const R = (p: Painter, x: number, y: number, w: number, h: number, fill: string | null, stroke?: number): void => {
    if (stroke)
        p.rect(x + stroke / 2, y + stroke / 2, w - stroke, h - stroke, fill, INK, stroke);
    else
        p.rect(x, y, w, h, fill);
};
export const wrap = (s: string, font: LayoutFont, size: number, width: number): string[] => wrapText(s, font, size, width);
export type ScaleState = {
    kind: "scored";
    score: number;
    position: number;
} | {
    kind: "unavailable";
};
export function scaleState(score: number | undefined | null): ScaleState {
    if (score === undefined || score === null || !Number.isInteger(score) || score < 1 || score > 10)
        return { kind: "unavailable" };
    return { kind: "scored", score, position: (score - 0.5) / 10 };
}
const GRADIENT = ["#e3f1fb", "#d3e8f7", "#c3dff3", "#b3d6ef", "#a3cdea", "#93c4e4", "#85bbdf", "#78b2d9", "#6ca9d3", "#61a1cd"];
export function paintScale(p: Painter, x: number, y: number, w: number, state: ScaleState, bubbleSize: number): void {
    const end = 13;
    const barH = 11;
    if (state.kind === "unavailable") {
        T(p, "Not Available", x, y + 2, 9, "bold");
        return;
    }
    const inner = w - end * 2;
    GRADIENT.forEach((c, i) => R(p, x + end + (inner / 10) * i, y, inner / 10 + 0.4, barH, c));
    R(p, x, y, end, barH, INK);
    R(p, x + w - end, y, end, barH, INK);
    T(p, "1", x + end / 2, y + 1.2, 8, "bold", { align: "center", color: PAPER });
    T(p, "10", x + w - end / 2, y + 1.2, 8, "bold", { align: "center", color: PAPER });
    const cx = x + end + inner * state.position;
    const bw = bubbleSize * (state.score >= 10 ? 1.25 : 1);
    R(p, cx - bw / 2, y - bubbleSize - 2, bw, bubbleSize, INK);
    T(p, String(state.score), cx, y - bubbleSize - 2 + (bubbleSize - bubbleSize * 0.9) / 2, bubbleSize * 0.82, "bold", { align: "center", color: PAPER });
    p.path(`M0 0 L${bubbleSize * 0.5} 0 L${bubbleSize * 0.25} ${bubbleSize * 0.3} Z`, cx - bubbleSize * 0.25, y - 2, bubbleSize * 0.5, bubbleSize * 0.3, INK);
    T(p, "Best", x + w, y + barH + 1, 7, "body", { align: "right" });
}
function paintHeader(p: Painter, d: FactoryStickerData): void {
    const logo = VARIANT_LOGOS.hyundai;
    p.image(logo.png, logo.assetId, 27, Y(51.35), 259.2, 35.65, "HYUNDAI");
    const v = d.vehicle;
    const title = [v.year > 0 ? String(v.year) : "", v.model, v.trim ?? "", v.drivetrain ?? ""].filter(Boolean).join(" ").toUpperCase();
    T(p, title, 335.9, Y(60.6), 20, "bold");
    T(p, `VIN:    ${v.vin}`, 30.1, Y(18.2), 10, "bold");
    T(p, `VIN:    ${v.vin}`, 1192.4, Y(18.2), 10, "bold", { align: "right" });
}
function paintInfoBox(p: Painter, d: FactoryStickerData): {
    bottom: number;
    soldTo: boolean;
} {
    let y = Y(106.1);
    const code = d.factory.dealerCode;
    const dealer = dealerLines(d).slice(0, 4);
    if (code && dealer.length) {
        T(p, "SOLD TO:", 30.1, y, 10, "bold");
        T(p, code.toUpperCase(), 86.8, y, 10, "bold");
        y += 12.5;
    }
    for (const line of dealer) {
        T(p, line, 30.1, y, 8, "body");
        y += 10.4;
    }
    y = dealer.length ? Math.max(y + 6, Y(175)) : Y(106.1);
    const rows: Array<[
        string,
        string | null
    ]> = [
        ["VIN:", d.vehicle.vin],
        ["EXTERIOR COLOR:", colorText(d.vehicle.exteriorColor, d.vehicle.exteriorColorCode)],
        ["INTERIOR/SEAT COLOR:", colorText(d.vehicle.interiorColor, d.vehicle.interiorColorCode)],
        ["TRANSPORT:", d.factory.transportMethod ? d.factory.transportMethod.toUpperCase() : null],
    ];
    for (const [label, value] of rows) {
        if (!value)
            continue;
        T(p, label, 30.1, y, 10, "bold");
        T(p, value, 166.1, y, 9, "body");
        y += 12.2;
    }
    if (d.factory.emissionsCode) {
        T(p, "EMISSIONS:", 30.1, y, 10, "bold");
        for (const l of wrap(d.factory.emissionsCode, "body", 9, 168)) {
            T(p, l, 166.1, y, 9, "body");
            y += 11;
        }
    }
    return { bottom: y, soldTo: !!(code && dealer.length) };
}
export function epaDate(iso: string | undefined): string | null {
    const t = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(t))
        return null;
    return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
const EPA_X = 704;
const EPA_W = 504;
function paintEpa(p: Painter, d: FactoryStickerData): void {
    const r = d.regulatory;
    const top = Y(96);
    const bottom = Y(420);
    R(p, EPA_X, top, EPA_W, bottom - top, INK);
    R(p, EPA_X + 3, Y(133), EPA_W - 6, bottom - Y(133) - 3, PAPER);
    T(p, "EPA", EPA_X + 4, Y(98.5), 9.5, "bold", { color: PAPER, lh: 10 });
    T(p, "DOT", EPA_X + 4, Y(98.5) + 10.2, 9.5, "bold", { color: PAPER, lh: 10 });
    T(p, "Fuel Economy and Environment", EPA_X + 33, Y(104.5), 15.5, "bold", { color: PAPER });
    if (d.vehicle.fuelType) {
        R(p, 1053, Y(99), 152, Y(127) - Y(99), EPA_BLUE);
        T(p, fuelCategoryLabel(d.vehicle.fuelType), 1200, Y(107), 10, "bold", { align: "right" });
    }
    const footerTop = Y(344);
    R(p, EPA_X + 3, footerTop, EPA_W - 6, bottom - footerTop - 3, INK);
    const retrieved = epaDate(r.epaRetrievedAt);
    const note = "Actual results will vary for many reasons, including driving conditions and how you drive and maintain your vehicle. "
        + (retrieved
            ? `Cost figures are fueleconomy.gov estimates retrieved ${retrieved} and may differ from those printed on the original label.`
            : "Cost estimates are current EPA estimates and may differ from those printed on the original label.");
    wrap(note, "bold", 7.5, 470).forEach((l, i) => T(p, l, 712.6, footerTop + 4 + i * 8.6, 7.5, "bold", { color: PAPER, lh: 8.6 }));
    T(p, "fueleconomy.gov", 712.6, Y(386), 22, "bold", { color: PAPER });
    T(p, "Calculate personalized estimates and compare vehicles", 712.6, Y(410), 8, "bold", { color: PAPER });
    const mpgOk = r.epaStatus === "VERIFIED" && r.combinedMpg !== undefined;
    if (!mpgOk) {
        wrap("Fuel economy and environment information is not available from verified EPA records for this exact configuration.", "bold", 12, 460)
            .forEach((l, i) => T(p, l, 730, Y(160) + i * 15, 12, "bold", { lh: 15 }));
        return;
    }
    T(p, "Fuel Economy", 746.7, Y(135.5), 11, "bold");
    p.path("M0 3 h9 v12 h-9 Z M10.5 6 l2.6 2.6 v5.2 a1.5 1.5 0 0 1 -3 0 v-3.4 h-1.1", 712, Y(165), 28, 28, INK);
    p.text(String(Math.round(r.combinedMpg!)), 746.7, Y(207), 54, "bold", INK);
    T(p, "MPG", 840.2, Y(156.4), 18, "bold");
    T(p, "combined city/hwy", 746.7, Y(209), 8, "body");
    if (r.cityMpg !== undefined) {
        T(p, String(Math.round(r.cityMpg)), 840.2, Y(186), 20, "bold");
        T(p, "city", 840.2, Y(209), 8, "body");
    }
    if (r.highwayMpg !== undefined) {
        T(p, String(Math.round(r.highwayMpg)), 885.6, Y(186), 20, "bold");
        T(p, "highway", 885.6, Y(209), 8, "body");
    }
    if (r.epaClassNote)
        wrap(r.epaClassNote, "body", 8, 145).slice(0, 3).forEach((l, i) => T(p, l, 898.6, Y(150) + i * 8.2, 8, "body", { lh: 8.2 }));
    const gallons = r.gallonsPer100Miles ?? (r.combinedMpg! > 0 ? 100 / r.combinedMpg! : undefined);
    if (gallons !== undefined) {
        T(p, gallons.toFixed(1), 746.7, Y(224.1), 20, "bold");
        T(p, "gallons per 100 miles", 783, Y(232.8), 8, "body");
    }
    const delta = r.fiveYearCostDifference;
    if (delta !== undefined && delta !== 0) {
        const saves = delta > 0;
        T(p, saves ? "You save" : "You spend", 1053, Y(138), 18, "bold");
        T(p, formatMoney(Math.abs(delta)).replace(/\.00$/, ""), 1053, Y(160), 34, "bold");
        (saves ? ["in fuel costs", "over 5 years"] : ["more in fuel costs", "over 5 years"])
            .forEach((l, i) => T(p, l, 1072.7, Y(199.3) + i * 13, 12.5, "bold", { lh: 12.5 }));
        ["compared to the", "average new vehicle."].forEach((l, i) => T(p, l, 1072.7, Y(228.6) + i * 12.7, 10, "body", { lh: 12 }));
    }
    else if (delta === undefined) {
        T(p, "5-year fuel cost", 1053, Y(138), 12, "bold");
        T(p, "vs. average new vehicle:", 1053, Y(138) + 14, 10, "body");
        T(p, "Not Available", 1053, Y(138) + 30, 12, "bold");
    }
    R(p, EPA_X + 3, Y(258), EPA_W - 6, 2.2, INK);
    if (r.annualFuelCost !== undefined) {
        T(p, "Annual fuel", 712.6, Y(268), 13, "bold");
        T(p, "cost", 712.6 + measureText("Annual fuel", "bold", 13) + 4, Y(268), 20, "bold");
        T(p, formatMoney(r.annualFuelCost).replace(/\.00$/, ""), 721.5, Y(296.2), 38, "bold");
    }
    const ghgHead = "Fuel Economy & Greenhouse Gas Rating";
    T(p, ghgHead, 861.5, Y(268.4), 9, "bold");
    T(p, "(tailpipe only)", 861.5 + measureText(ghgHead, "bold", 9) + 3, Y(269.9), 7, "body");
    paintScale(p, 861.5, Y(303), 206, scaleState(r.greenhouseGasRating), 14);
    T(p, "Smog Rating", 1099.6, Y(268.4), 9, "bold");
    T(p, "(tailpipe only)", 1158.1, Y(269.9), 7, "body");
    paintScale(p, 1100, Y(303), 100, scaleState(r.smogRating), 14);
    if (r.co2TailpipeGpm !== undefined) {
        const line = `This vehicle emits ${Math.round(r.co2TailpipeGpm)} grams CO2 per mile (tailpipe only). The best emits 0 grams per mile (tailpipe only). Producing and distributing fuel also create emissions; learn more at fueleconomy.gov.`;
        const lines = wrap(line, "body", 7, 340).slice(0, 3);
        lines.forEach((l, i) => T(p, l, 861.5, footerTop - 3 - (lines.length - i) * 8.2, 7, "body", { lh: 8.2 }));
    }
}
function paintPassport(p: Painter, url: string): void {
    if (!url)
        return;
    const gapTop = Y(420);
    const gapBottom = Y(515.9);
    const y = gapTop + (gapBottom - gapTop - PASSPORT_QR_PT) / 2 + 2;
    p.qr(EPA_X + 4, y, PASSPORT_QR_PT, url, INK);
    T(p, "VEHICLE PASSPORT", EPA_X + PASSPORT_QR_PT + 14, y + 20, 9, "bold");
    T(p, PASSPORT_QR_CAPTION, EPA_X + PASSPORT_QR_PT + 14, y + 33, 8, "body");
}
function paintRight(p: Painter, d: FactoryStickerData, barcodePayload: string): boolean {
    const top = Y(515.9);
    const bottom = Y(748.4);
    const left = 704.4;
    const width = 496.1;
    R(p, left, top, width, bottom - top, null, 2.85);
    const note = "Original manufacturer's suggested retail prices shown. Excludes taxes, title, license, dealer-installed items and current selling price.";
    wrap(note, "body", 8.5, width - 12).forEach((l, i) => T(p, l, 710.4, top + 5 + i * 9.3, 8.5, "body", { lh: 9.3 }));
    const ruleA = Y(561.2);
    R(p, left, ruleA, width, 2.4, INK);
    const ruleB = Y(700.1);
    R(p, left, ruleB, width, 2.4, INK);
    if (barcodePayload)
        p.barcode(710.4, ruleB + 6, 288, bottom - ruleB - 14, barcodePayload, INK);
    const f = partsFacts(d);
    const NA = "NOT AVAILABLE";
    const cx = left + width / 2;
    const limit = ruleB - 3;
    const SIZE = 10;
    const STEP = 10.4;
    let y = ruleA + 5;
    const line = (s: string, draw: boolean, size = SIZE, step = STEP): void => {
        for (const l of wrap(s.toUpperCase(), "bold", size, width - 20)) {
            if (draw)
                T(p, l, cx, y, size, "bold", { align: "center" });
            y += step;
        }
    };
    const run = (draw: boolean): void => {
        y = ruleA + 5;
        line("PARTS CONTENT INFORMATION", draw, 11, 11);
        line("FOR VEHICLE IN THIS CARLINE:", draw);
        line(`U.S./CANADIAN PARTS CONTENT: ${f.usCan?.value ?? NA}`, draw);
        if (f.other.length)
            for (const e of f.other)
                line(`${e.label}: ${e.value}`, draw);
        else
            line(`MAJOR SOURCES OF FOREIGN PARTS CONTENT: ${NA}`, draw);
        y += 2;
        if (draw)
            T(p, "Note: Parts content does not include final assembly, distribution, or other non-parts costs.", 710.4, y, 7.5, "body");
        y += 9;
        if (draw)
            T(p, "FOR THIS VEHICLE:", 710.4, y, SIZE, "bold");
        y += STEP;
        line(`${f.assembly ? assemblyLabel(d) : "FINAL ASSEMBLY POINT"}: ${f.assembly ?? NA}`, draw);
        line("COUNTRY OF ORIGIN:", draw);
        line(`ENGINE: ${f.engine?.value ?? NA}`, draw);
        line(`TRANSMISSION: ${f.trans?.value ?? NA}`, draw);
        if (!f.usCan || !f.engine || !f.trans || !f.assembly) {
            y += 1;
            if (draw)
                T(p, "NOT AVAILABLE: not in the verified source data for this VIN.", 710.4, y, 7.5, "body");
            y += 9;
        }
    };
    run(false);
    if (y > limit)
        return false;
    run(true);
    return true;
}
function paintPricing(p: Painter, d: FactoryStickerData): boolean {
    const L = 356.1;
    const Rt = 668.2;
    const pr = d.pricing;
    T(p, "Manufacturer's Suggested Retail Price:", L, Y(358.7), 8, "bold");
    T(p, pr.baseMsrp !== undefined ? formatMoney(pr.baseMsrp) : "NOT AVAILABLE", Rt, Y(358.7), 8, "bold", { align: "right" });
    const limit = Y(712);
    let y = Y(374.2);
    const rows = priceRows(d);
    if (rows.length) {
        const head = "ADDED FEATURES:";
        T(p, head, L, y, 10, "bold");
        R(p, L, y + 10.2, measureText(head, "bold", 10), 0.8, INK);
        y += 10.5 + 0.5;
        for (const row of rows) {
            const top = y;
            for (const l of wrap(row.label, "body", 8, 235)) {
                T(p, l, L, y, 8, "body");
                y += 8.5;
            }
            if (row.amount)
                T(p, row.amount, Rt, top, 8, "body", { align: "right" });
            for (const f of row.features) {
                for (const l of wrap(f, "body", 7, 230)) {
                    T(p, l, L + 8, y, 7, "body");
                    y += 7.6;
                }
            }
        }
    }
    if (pr.gasGuzzlerTax !== undefined) {
        y += 3;
        T(p, "Gas Guzzler Tax", L, y, 8, "body");
        T(p, formatMoney(pr.gasGuzzlerTax), Rt, y, 8, "body", { align: "right" });
        y += 8.5;
    }
    if (y > limit)
        return false;
    const freight = Y(720.7) - 3.5;
    T(p, "Inland Freight & Handling :", L, freight, 8, "body");
    T(p, pr.destinationCharge !== undefined ? formatMoney(pr.destinationCharge) : "NOT AVAILABLE", Rt - 1, freight, 8, "body", { align: "right" });
    const total = totalMsrp(d);
    T(p, "Total Price :", L, Y(729.1), 12, "bold");
    T(p, total !== undefined ? formatMoney(total) : "NOT AVAILABLE", Rt - 1, Y(729.1), 12, "bold", { align: "right" });
    return true;
}
const spec: TabloidSpec = {
    eqStyle: EQ_STYLE,
    fixedStyle: true,
    paintFirst(p: Painter, ctx: FirstPageContext): FirstPageResult | null {
        const { d, input } = ctx;
        if (!paintPricing(p, d))
            return null;
        if (!paintRight(p, d, input.layout.barcodePayload))
            return null;
        paintHeader(p, d);
        const frameTop = Y(99.2);
        const midY = Y(351.5);
        const botY = Y(748.4);
        const info = paintInfoBox(p, d);
        const featuresTop = info.soldTo ? midY : Math.min(midY, Math.max(Y(160), info.bottom + 8));
        if (featuresTop === midY) {
            R(p, 24.1 - 1.4, frameTop, 338 - 24.1 + 1.4, midY - frameTop, null, 2.85);
            R(p, 24.1 - 1.4, midY, 350.1 - 24.1 + 1.4, botY - midY, null, 2.85);
            R(p, 350.1, midY, 677.5 - 350.1, botY - midY, null, 2.85);
        }
        else {
            R(p, 24.1 - 1.4, frameTop, 338 - 24.1 + 1.4, botY - frameTop, null, 2.85);
            R(p, 24.1 - 1.4, featuresTop, 338 - 24.1 + 1.4, 2.85, INK);
            R(p, 338 - 2.85, midY, 677.5 - 338 + 2.85, botY - midY, null, 2.85);
        }
        paintSafetyPanel(p, d, Q(335.9), Q(frameTop), Q(677.5 - 335.9), Q(midY - frameTop), {
            headerH: 36,
            footerH: 80,
            subFrac: 0.29,
            valFrac: 0.57,
            titleSize: 22.6,
            labelSize: 17.4,
            noteSize: 12.1,
            footSize: 13.8,
            stretch: 1.04,
        });
        paintEpa(p, d);
        paintPassport(p, d.document.passportUrl.trim());
        const warranty = warrantySection(d, "Warranty");
        const sections = [...(warranty ? [warranty] : []), ...hyundaiSections(d, input.equipmentGroups)];
        const headTop = featuresTop + (Y(359) - midY);
        const listTop = featuresTop + (Y(371) - midY);
        underlined(p, "STANDARD FEATURES:", Q(30.1), Q(headTop), Q(10));
        if (!sections.length)
            T(p, "Standard equipment not available for this vehicle.", Q(30.1) * 0.612, listTop + 2, 8, "body");
        const entries = toEntries(sections, (s) => s.toUpperCase(), 3, undefined, input.equipmentNote);
        const colW = featuresTop === midY ? 314 : 302;
        const cols = withColumns([{ x: Q(30.1), w: Q(colW), top: Q(listTop), bottom: Q(Y(743)) }], ctx.extraColumns);
        const { placed, rest } = flow(entries, cols, ctx.style);
        paintPlaced(p, placed, ctx.style, { headingFont: "bold" });
        return placedResult(entries, rest);
    },
};
export const buildHyundaiTucsonGasLayout: VariantLayoutBuilder = (input): LayoutModel | null => {
    const model = assembleTabloid(input, spec);
    if (model && (model.width !== TABLOID_WIDTH || model.height !== TABLOID_HEIGHT))
        return null;
    return model;
};
