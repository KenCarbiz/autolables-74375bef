// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/gmTruckCommon.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Shared 17x11 layout for the General Motors heavy-duty pickup references
// (Chevrolet Silverado 2500 High Country, GMC Sierra 3500 Denali Ultimate),
// which follow the Buick Envista label family (gmCommon.ts) with four
// equipment columns, the option and totals stack in the fifth and sixth
// columns, and the California Air Resources Board panel in place of the EPA
// fuel-economy panel. Pickups over 8,500 lb GVWR are exempt from the EPA label,
// so no EPA panel is drawn.
//
// Every printed value comes from render data. The OnStar advertisement and its
// QR, the order-information QR, the adhesive-strip notice, sales and order
// codes, the CARB emblem and the federal-law label statement are not
// reproduced; the 0.90in Vehicle Passport QR takes the advertisement's slot.

import type { FactoryStickerData } from "../../types.ts";
import { PASSPORT_QR_CAPTION } from "../../reproduction.ts";
import { Painter, type LayoutModel } from "../layout.ts";
import { VARIANT_LOGOS } from "./logoArtwork.ts";
import { INK, PAPER, type VariantLayoutBuilder } from "./shared.ts";
import { PASSPORT_QR_PT, R, T, wrap } from "./hyundaiTucsonGas.ts";
import {
  TABLOID_HEIGHT, TABLOID_WIDTH, assembleTabloid, priceRowsWithoutColors, totalMsrp, warrantySection, yearModelTrim,
  type FirstPageContext, type FirstPageResult, type PriceRow, type TabloidSpec,
} from "./tabloidCommon.ts";
import {
  PRICE_FOOTNOTE, PX, money, msrpWithOptions, optionsTotalOf, paintCatalogParts, paintCatalogSafety, paintWarranty,
} from "./catalogBlocks.ts";
import { paintCarbPanel } from "./carbPanel.ts";
import { GM_EQ_STYLE, flowGmEquipment, gmGrid, paintGmEquipmentFrame, paintGmSpecColumns, paintGmVinDealer } from "./gmCommon.ts";

export interface GmTruckBrand {
  logo: "chevrolet" | "gmc" | "cadillac" | null;
  /** Neutral wordmark printed when no logo artwork is packaged. */
  wordmark?: string;
  logoX: number;
  logoW: number;
  site: string;
  /** Right-aligned "Visit us at" label x (px). */
  siteX: number;
}

const g = gmGrid();

interface Placed {
  text: string;
  x: number;
  y: number;
  size: number;
  right?: number;
}

interface PriceStack {
  placed: Placed[];
  totalBox: { x: number; y: number; w: number; label: string; value: string; known: boolean; size: number };
  col6Used: boolean;
}

const COL5 = { L: 1128, R: 1380, top: 212, limit: 452 };
const COL6 = { L: 1400, R: 1648, top: 182, limit: 556 };

/** Greedy two-column placement of the option rows and the totals stack; null when they cannot fit at 6pt. */
function layoutPrices(d: FactoryStickerData): PriceStack | null {
  const rows: PriceRow[] = priceRowsWithoutColors(d).map((r) => ({
    label: r.label.toUpperCase(), amount: r.amount, features: r.features.map((f) => `• ${f.toUpperCase()}`),
  }));
  const totals: Array<[string, string]> = [
    ["TOTAL OPTIONS", money(optionsTotalOf(d))],
    ["TOTAL VEHICLE & OPTIONS", money(msrpWithOptions(d))],
    ["DESTINATION CHARGE", money(d.pricing.destinationCharge)],
  ];
  const total = totalMsrp(d);
  for (let size = 8; size >= 6; size -= 0.8) {
    for (const withFeatures of [true, false]) {
      const step = size + 1.4;
      const placed: Placed[] = [];
      let col = 0;
      const c = (): typeof COL5 => (col === 0 ? COL5 : COL6);
      let y = g.y(COL5.top);
      const room = (h: number): boolean => {
        while (y + h > g.y(c().limit)) {
          if (col === 1) return false;
          col = 1;
          y = g.y(COL6.top);
        }
        return true;
      };
      let ok = true;
      for (const row of rows) {
        const labelW = (c().R - c().L) * PX - 50;
        const lines = wrap(row.label, "body", size, labelW);
        const feats = withFeatures ? row.features.flatMap((f) => wrap(f, "body", size - 1, labelW - 6)) : [];
        const h = lines.length * step + feats.length * (step - 0.8) + 1;
        if (!room(h)) { ok = false; break; }
        const x0 = g.x(c().L);
        const right = g.x(c().R);
        lines.forEach((l, i) => placed.push({ text: l, x: x0, y: y + i * step, size }));
        if (row.amount) placed.push({ text: row.amount, x: x0, y, size, right });
        feats.forEach((l, i) => placed.push({ text: l, x: x0 + 6, y: y + lines.length * step + i * (step - 0.8), size: size - 1 }));
        y += h;
      }
      if (!ok) continue;
      const need = totals.length * step + 6 + 22;
      if (!room(need)) continue;
      const x0 = g.x(c().L);
      const right = g.x(c().R);
      y += 4;
      totals.forEach(([label, value], i) => {
        placed.push({ text: label, x: x0, y: y + i * step, size });
        placed.push({ text: value, x: x0, y: y + i * step, size, right });
      });
      y += totals.length * step + 6;
      return {
        placed,
        totalBox: { x: x0 - 3, y, w: right - x0 + 6, label: "TOTAL VEHICLE PRICE*", value: money(total), known: total !== undefined, size },
        col6Used: col === 1,
      };
    }
  }
  return null;
}

function paintPrices(p: Painter, d: FactoryStickerData): boolean {
  const stack = layoutPrices(d);
  if (!stack) return false;
  const L = g.x(COL5.L);
  const Rt = g.x(COL5.R);
  wrap("OPTIONS INSTALLED BY THE MANUFACTURER (MAY REPLACE STANDARD EQUIPMENT SHOWN)", "body", 5.8, (COL5.R - COL5.L) * PX)
    .forEach((l, i) => T(p, l, L, g.y(178) + i * 6.6, 5.8, "body"));
  for (const t of stack.placed) T(p, t.text, t.right ?? t.x, t.y, t.size, "body", t.right !== undefined ? { align: "right" } : {});
  const b = stack.totalBox;
  R(p, b.x, b.y, b.w, 22, null, 2);
  T(p, b.label, b.x + 5, b.y + 6, 7.4, "bold");
  T(p, b.value, b.x + b.w - 5, b.y + (b.known ? 5.5 : 7), b.known ? 8.6 : 7, "bold", { align: "right" });

  T(p, "MANUFACTURER'S SUGGESTED RETAIL PRICE", Rt, g.y(466), 5.8, "body", { align: "right" });
  R(p, g.x(1126), g.y(478), 256 * PX, g.y(504) - g.y(478), null, 2);
  const base = d.pricing.baseMsrp;
  T(p, "STANDARD VEHICLE PRICE", L + 2, g.y(486), 7.2, "bold");
  T(p, money(base), Rt - 3, g.y(486), base !== undefined ? 8.6 : 7, "bold", { align: "right" });
  R(p, g.x(1126), g.y(513), 256 * PX, g.y(540) - g.y(513), INK);
  T(p, "OPTIONS & PRICING", L + 4, g.y(520), 10, "bold", { color: PAPER });
  return true;
}

function paintHeader(p: Painter, d: FactoryStickerData, brand: GmTruckBrand): void {
  if (brand.logo) {
    const logo = VARIANT_LOGOS[brand.logo];
    const w = brand.logoW * PX;
    const h = (w * logo.slot.h) / logo.slot.w;
    p.image(logo.png, logo.assetId, g.x(brand.logoX), g.y(91) - h / 2, w, h);
  } else if (brand.wordmark) {
    T(p, brand.wordmark.toUpperCase(), g.x(brand.logoX), g.y(70), 34, "bold");
  }
  const title = yearModelTrim(d, ["year", "model", "trim", "drivetrain"], d.vehicle.make);
  wrap(title, "bold", 19, 450 * PX).slice(0, 2).forEach((l, i) => T(p, l, g.x(722), g.y(60 + i * 31), 19, "bold", { align: "center" }));
  paintGmSpecColumns(p, d, g, { leftX: 961, rightX: 1236, leftW: 270, rightW: 400, engineLabel: "ENG", transmissionLabel: "TRANS" });
  T(p, `Visit us at ${brand.site}`, g.x(brand.siteX), g.y(150), 9, "bold");
}

function paintBottom(p: Painter, ctx: FirstPageContext): void {
  const { d, input } = ctx;
  paintCarbPanel(p, d, g.x(44), g.y(575), 701 * PX, g.y(1027) - g.y(575));
  const top = g.y(575);
  paintCatalogSafety(p, d, g.x(750), top, 450 * PX, g.y(895) - top);
  paintCatalogParts(p, d, g.x(1205), top, 310 * PX, g.y(895) - top, 1);
  wrap(PRICE_FOOTNOTE, "body", 6.4, 118 * PX).forEach((l, i) => T(p, l, g.x(1528), g.y(590) + i * 7.2, 6.4, "body"));

  const w = warrantySection(d, "Warranty");
  paintWarranty(p, d, w ? w.items : null, g.x(760), g.y(944), 285 * PX);
  const url = d.document.passportUrl.trim();
  if (url) {
    const qx = g.x(1190) - PASSPORT_QR_PT;
    const qy = g.y(1034) - PASSPORT_QR_PT;
    p.qr(qx, qy, PASSPORT_QR_PT, url, INK);
    T(p, "VEHICLE PASSPORT", qx - 6, qy + 22, 8.5, "bold", { align: "right" });
    T(p, PASSPORT_QR_CAPTION, qx - 6, qy + 34, 7.5, "body", { align: "right" });
  }
  R(p, g.x(1205), g.y(903), 450 * PX, g.y(1043) - g.y(903), null, 1.4);
  paintGmVinDealer(p, d, input.layout.barcodePayload, g, {
    x: 1218, vinY: 934, dealerY: 960, dealerLinesY: 974, assemblyY: 914, barcodeY: 910, barcodeX: 1392, barcodeW: 250,
  });
}

const makeSpec = (brand: GmTruckBrand): TabloidSpec => ({
  eqStyle: GM_EQ_STYLE,
  paintFirst(p: Painter, ctx: FirstPageContext): FirstPageResult | null {
    if (!paintPrices(p, ctx.d)) return null;
    paintHeader(p, ctx.d, brand);
    paintGmEquipmentFrame(p, g, ctx.extraColumns ? [] : [310, 585, 850, 1120, 1385]);
    const equipment = flowGmEquipment(p, ctx, g, [[50, 252], [320, 258], [592, 254], [858, 255]]);
    paintBottom(p, ctx);
    return equipment;
  },
});

export const buildGmTruckLayout = (brand: GmTruckBrand): VariantLayoutBuilder => {
  const spec = makeSpec(brand);
  return (input): LayoutModel | null => {
    const model = assembleTabloid(input, spec);
    if (model && (model.width !== TABLOID_WIDTH || model.height !== TABLOID_HEIGHT)) return null;
    return model;
  };
};
