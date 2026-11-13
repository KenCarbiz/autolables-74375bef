// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/toyota4runnerGas.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { FactoryStickerData } from "../../types.ts";
import type { Painter } from "../layout.ts";
import { T } from "./hyundaiTucsonGas.ts";
import { colorText, type FlowStyle } from "./tabloidCommon.ts";
import { eqCol, buildToyotaFamilyLayout, type ToyotaFamilyConfig } from "./toyotaCommon.ts";
import { makeGrid, type Grid } from "./catalogBlocks.ts";
export const TOYOTA_4RUNNER_GAS_ID = "toyota_2026_4runner_trd_sport";
const g = makeGrid(30, 55, 709, 1052);
function header(p: Painter, d: FactoryStickerData, grid: Grid): void {
    const v = d.vehicle;
    const trimLine = [v.drivetrain ?? "", v.trim ?? ""].filter(Boolean).join(" ").toUpperCase();
    const rows: Array<[
        string,
        string | null,
        number,
        number,
        number,
        boolean
    ]> = [
        ["DESC.:", v.model ? v.model.toUpperCase() : null, 135, 146, 11.4, true],
        ["VIN:", v.vin, 135, 168, 12.6, true],
        ["YR/MDL:", v.year > 0 ? String(v.year) : null, 135, 188, 7.6, false],
        ["CLR:", colorText(v.exteriorColor, v.exteriorColorCode), 135, 206, 7.6, false],
        ["FINAL ASSEMBLY POINT:", d.factory.finalAssemblyPoint ? d.factory.finalAssemblyPoint.toUpperCase() : null, 243, 224, 7.6, false],
    ];
    const y0: Record<string, number> = { "DESC.:": 150, "VIN:": 172, "YR/MDL:": 189, "CLR:": 207, "FINAL ASSEMBLY POINT:": 225 };
    for (const [label, value, vx, y, size, bold] of rows) {
        T(p, label, grid.x(75), grid.y(y0[label]), 6.4, "body");
        if (value)
            T(p, value, grid.x(vx), grid.y(y), size, bold ? "bold" : "body");
    }
    if (trimLine)
        T(p, trimLine, grid.x(480), grid.y(146), 8.4, "bold", { align: "right" });
}
const EQ_STYLE: FlowStyle = { size: 13.4, lh: 15.6, hang: 6, inset: 0 };
const config: ToyotaFamilyConfig = {
    eqStyle: EQ_STYLE,
    grid: g,
    logo: { key: "toyota", x: 86, y: 63, w: 259 },
    header,
    eqHeading: { text: "STANDARD EQUIPMENT", x: 633, y: 64, size: 10.4, align: "center", note: { text: "UNLESS REPLACED BY OPTIONAL EQUIPMENT", x: 540, y: 85, size: 5.8 } },
    eqColumns: (grid, extra, priceEnd) => {
        const a = eqCol(grid, 514, 250, 100, 590);
        const b = { ...eqCol(grid, 799, 396, 0, 815), top: priceEnd / 0.612 + 6 };
        const c = eqCol(grid, 1215, 435, 70, 690);
        if (extra <= 0)
            return [a, b, c];
        const half = (col: typeof c): [
            typeof c,
            typeof c
        ] => {
            const gap = 12;
            const w = (col.w - gap) / 2;
            return [{ ...col, w }, { ...col, x: col.x + w + gap, w }];
        };
        if (extra === 1)
            return [a, b, ...half(c)];
        return [a, ...half(b), ...half(c)];
    },
    options: {
        baseLabel: { text: "BASE MANUFACTURER'S SUGGESTED RETAIL PRICE", x: 799, y: 66, size: 7.6 },
        right: 1192,
        rowsX: 799,
        rowsTop: 98,
        rowsLimit: 815,
        labelW: 340,
        size: 8.2,
    },
    totals: {
        msrp: { label: "MANUFACTURER'S SUGGESTED RETAIL PRICE", labelX: 799, labelAlign: "left", y: 828, size: 7.4 },
        delivery: { label: "DELIVERY, PROCESSING AND HANDLING FEE", labelX: 799, labelAlign: "left", y: 857, size: 7.4 },
        total: { label: "TOTAL SUGGESTED RETAIL PRICE", labelX: 799, labelAlign: "left", y: 935, size: 8.8 },
        amountRight: 1192,
        footnote: { x: 765, y: 975, w: 420 },
    },
    safety: { x: 52, y: 238, w: 448, h: 352 },
    epa: { x: 50, y: 593 },
    parts: { x: 1215, y: 700, w: 435, h: 222 },
    partsColumns: 2,
    delivered: { x: 1215, y: 932, w: 435, h: 50, framed: false },
    barcode: { x: 1219, y: 1018, w: 255, h: 22 },
};
export const buildToyota4runnerGasLayout = buildToyotaFamilyLayout(config);
