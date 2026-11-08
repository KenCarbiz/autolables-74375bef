// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/priceColumns.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Greedy placement of priced option rows into one or more text columns, used by
// layouts whose reference lists options in a column that may spill into a
// neighbouring free column. Type steps down from `size` to 6pt, dropping the
// feature sub-lines first, until every row fits.

import { wrap } from "./hyundaiTucsonGas.ts";
import type { PriceRow } from "./tabloidCommon.ts";

export interface RowColumn {
  x: number;
  right: number;
  top: number;
  limit: number;
}

export interface PlacedText {
  text: string;
  x: number;
  y: number;
  size: number;
  right?: number;
}

export interface PlacedRows {
  placed: PlacedText[];
  size: number;
  /** Column and y of the cursor after the last row. */
  col: number;
  y: number;
}

export function placeRows(rows: PriceRow[], cols: RowColumn[], size: number, lead = 0.8, amountW = 52): PlacedRows | null {
  for (let s = size; s >= 6; s -= 0.8) {
    for (const withFeatures of [true, false]) {
      const step = s + lead;
      const placed: PlacedText[] = [];
      let col = 0;
      let y = cols[0].top;
      let ok = true;
      for (const row of rows) {
        const labelW = (cols[col].right - cols[col].x) - amountW;
        const lines = wrap(row.label, "body", s, labelW);
        const feats = withFeatures ? row.features.flatMap((f) => wrap(f, "body", s - 1, labelW - 6)) : [];
        const h = lines.length * step + feats.length * (step - 0.8) + 1;
        while (y + h > cols[col].limit) {
          if (col === cols.length - 1) { ok = false; break; }
          col++;
          y = cols[col].top;
        }
        if (!ok) break;
        const c = cols[col];
        lines.forEach((l, i) => placed.push({ text: l, x: c.x, y: y + i * step, size: s }));
        if (row.amount) placed.push({ text: row.amount, x: c.x, y, size: s, right: c.right });
        feats.forEach((l, i) => placed.push({ text: l, x: c.x + 6, y: y + lines.length * step + i * (step - 0.8), size: s - 1 }));
        y += h;
      }
      if (ok) return { placed, size: s, col, y };
    }
  }
  return null;
}
