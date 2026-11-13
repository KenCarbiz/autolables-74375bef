// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/lexusRx350Gas.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { FactoryStickerData } from "../../types.ts";
import type { Painter } from "../layout.ts";
import { T } from "./hyundaiTucsonGas.ts";
import { colorText, yearModelTrim, type FlowStyle } from "./tabloidCommon.ts";
import { eqCol, buildToyotaFamilyLayout, splitColumns, type ToyotaFamilyConfig } from "./toyotaCommon.ts";
import { makeGrid, type Grid } from "./catalogBlocks.ts";
export const LEXUS_RX350_GAS_ID = "lexus_2026_rx_350_awd";
const g = makeGrid(30, 55, 709, 1052);
function header(p: Painter, d: FactoryStickerData, grid: Grid): void {
    const v = d.vehicle;
    const rows: Array<[
        string,
        string | null,
        number,
        number,
        number
    ]> = [
        ["DESCRIPTION", yearModelTrim(d, ["year", "model", "trim"], "Lexus").toUpperCase(), 601, 66, 11.2],
        ["COLOR", colorText(v.exteriorColor, v.exteriorColorCode)?.toUpperCase() ?? null, 601, 88, 8.6],
        ["VIN", v.vin, 601, 106, 8.6],
        ["FINAL ASSEMBLY POINT", d.factory.finalAssemblyPoint ? d.factory.finalAssemblyPoint.toUpperCase() : null, 650, 124, 8.6],
    ];
    for (const [label, value, vx, y, size] of rows) {
        T(p, label, grid.x(519), grid.y(y) + 1.5, 5.6, "body");
        if (value)
            T(p, value, grid.x(vx), grid.y(y), size, label === "DESCRIPTION" ? "bold" : "body");
    }
}
const EQ_STYLE: FlowStyle = { size: 13.4, lh: 15.6, hang: 6, inset: 0 };
const config: ToyotaFamilyConfig = {
    eqStyle: EQ_STYLE,
    grid: g,
    logo: { key: "lexus", x: 75, y: 58, w: 350 },
    frame: [57, 51, 1492, 1044],
    header,
    eqHeading: { text: "STANDARD EQUIPMENT", x: 89, y: 160, size: 10.4, spacing: 2.4, note: { text: "UNLESS REPLACED BY INSTALLED OPTIONS", x: 444, y: 164, size: 5.8 } },
    eqColumns: (grid, extra, priceEnd) => [
        ...splitColumns([eqCol(grid, 89, 380, 186, 575), eqCol(grid, 475, 375, 186, 575)], extra),
        { ...eqCol(grid, 856, 594, 0, 608), top: priceEnd / 0.612 + 6 },
    ],
    options: {
        heading: { text: "INSTALLED OPTIONS", x: 856, y: 160, size: 10.4, spacing: 2.4 },
        baseLabel: { text: "BASE MANUFACTURER'S SUGGESTED RETAIL PRICE", x: 858, y: 182, size: 7.8 },
        right: 1447,
        rowsX: 890,
        rowsTop: 204,
        rowsLimit: 602,
        labelW: 480,
        size: 8.4,
    },
    totals: {
        msrp: { label: "MANUFACTURER'S SUGGESTED RETAIL PRICE", labelX: 1286, labelAlign: "right", y: 620, size: 7.4 },
        delivery: { label: "DELIVERY, PROCESSING AND HANDLING FEE", labelX: 1286, labelAlign: "right", y: 650, size: 7.4 },
        total: { label: "TOTAL", labelX: 1286, labelAlign: "right", y: 671, size: 9.4 },
        amountRight: 1447,
        footnote: { x: 1235, y: 698, w: 235 },
    },
    safety: { x: 771, y: 686, w: 451, h: 349 },
    epa: { x: 65, y: 583 },
    parts: { x: 1230, y: 738, w: 255, h: 210 },
    partsColumns: 1,
    delivered: { x: 970, y: 65, w: 220, h: 76, framed: true },
    barcode: { x: 1230, y: 1000, w: 248, h: 30 },
};
export const buildLexusRx350GasLayout = buildToyotaFamilyLayout(config);
