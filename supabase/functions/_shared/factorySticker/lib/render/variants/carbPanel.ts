// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/carbPanel.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// California Air Resources Board "Environmental Performance" panel shared by
// the heavy-duty pickup templates. Geometry is written in the references'
// 700 x 452 px panel (100 dpi) and scaled to the rectangle it is given.
//
// The data model carries no CARB letter grades, so both rating scales print an
// explicit "Not Available" in place of the grade and pointer, except for a
// vehicle whose only fuel is electricity: CARB's label specification exempts
// those from testing and fixes both ratings at A+ (California Environmental
// Performance Label Specifications for 2021+ MDVs, section on zero-emission
// vehicles), with the note that upstream electricity emissions are excluded. The fuel-type tag
// is drawn only when the record states a fuel type (EPA match or engine text).
// The California Air Resources Board emblem is not reproduced; its name is
// printed as a plain wordmark.

import type { FactoryStickerData } from "../../types.ts";
import { Painter, fuelCategoryLabel, measureText } from "../layout.ts";
import { INK, PAPER } from "./shared.ts";
import { R, T, wrap } from "./hyundaiTucsonGas.ts";

const GREEN = "#20b04b";
const TRACK = "#d9d9d9";

/** "Diesel Vehicle" etc. from the verified EPA fuel type, else from engine text that names diesel; null when the record does not say. */
export function carbFuelTag(d: FactoryStickerData): string | null {
  if (d.vehicle.fuelType) return fuelCategoryLabel(d.vehicle.fuelType);
  return /diesel/i.test(d.vehicle.engine ?? "") ? "Diesel Vehicle" : null;
}

/** Grades fixed by rule, never estimated: A+/A+ only when the verified EPA fuel type is electricity alone. */
export function carbGrades(d: FactoryStickerData): { ghg: "A+"; smog: "A+" } | null {
  return /^\s*electricity\s*$/i.test(d.vehicle.fuelType ?? "") ? { ghg: "A+", smog: "A+" } : null;
}

export function paintCarbPanel(p: Painter, d: FactoryStickerData, x: number, y: number, w: number, h: number): void {
  const k = w / 700;
  const ky = h / 452;
  const X = (px: number): number => x + px * k;
  const Yy = (px: number): number => y + px * ky;
  const W = (px: number): number => px * k;
  const H = (px: number): number => px * ky;

  R(p, x, y, w, h, INK);
  let title = 24 * k;
  while (title > 8 && measureText("California Air Resources Board", "bold", title) > W(325)) title -= 0.25;
  T(p, "California Air Resources Board", X(8), Yy(13), title, "bold", { color: PAPER });
  const tag = carbFuelTag(d);
  if (tag) {
    R(p, X(372), Yy(7), W(322), H(36), GREEN);
    T(p, tag, X(688), Yy(16), 16.5 * k, "bold", { align: "right" });
  }

  R(p, X(6), Yy(50), W(688), H(114), PAPER);
  T(p, "Environmental Performance", X(350), Yy(62), 36 * k, "bold", { align: "center" });
  const note = ["These ratings are not directly comparable to the U.S. EPA/DOT light-duty vehicle label ratings.", "For information on how to compare, please see www.arb.ca.gov/ep_label."];
  note.forEach((l, i) => T(p, l, X(350), Yy(116) + i * H(18), 15.2 * k, "body", { align: "center" }));

  R(p, X(6), Yy(171), W(688), H(177), PAPER);
  T(p, "Protect the environment. Choose vehicles with higher ratings:", X(350), Yy(180), 21 * k, "bold", { align: "center" });
  const head = (label: string, px: number): void => {
    T(p, label, X(px), Yy(222), 21 * k, "bold");
    T(p, "(tailpipe only)", X(px) + measureText(label, "bold", 21 * k) + 4, Yy(226), 13 * k, "body");
  };
  head("Greenhouse Gas Rating", 14);
  head("Smog Rating", 470);
  const track = (px: number, width: number, grade: string | null): void => {
    const ty = Yy(262);
    const th = H(30);
    const cap = W(34);
    R(p, X(px), ty, W(width), th, TRACK);
    R(p, X(px), ty, cap, th, INK);
    R(p, X(px + width) - cap, ty, cap, th, INK);
    T(p, "A+", X(px) + cap / 2, ty + th * 0.2, 16 * k, "bold", { align: "center", color: PAPER });
    T(p, "D", X(px + width) - cap / 2, ty + th * 0.2, 16 * k, "bold", { align: "center", color: PAPER });
    if (grade) {
      // The pointer sits on the track beside the A+ end the grade names.
      const mw = W(40);
      R(p, X(px) + cap + W(4), ty + H(3), mw, th - H(6), "#0b7a34");
      T(p, grade, X(px) + cap + W(4) + mw / 2, ty + th * 0.22, 15 * k, "bold", { align: "center", color: PAPER });
    } else {
      T(p, "Not Available", X(px) + W(width) / 2, ty + th * 0.22, 15 * k, "bold", { align: "center" });
    }
    T(p, "Cleaner", X(px), ty + th + H(6), 14 * k, "body");
  };
  const grades = carbGrades(d);
  track(14, 310, grades?.ghg ?? null);
  track(470, 200, grades?.smog ?? null);
  if (grades) T(p, "Does not include emissions from producing electricity.", X(350), Yy(322), 14 * k, "body", { align: "center" });

  const foot = wrap("Vehicle emissions are a primary contributor to climate change and smog. Ratings are determined by the California Air Resources Board based on this vehicle's measured emissions.", "body", 15.2 * k, W(672));
  foot.forEach((l, i) => T(p, l, X(10), Yy(362) + i * H(19), 15.2 * k, "body", { color: PAPER }));
  T(p, "CALIFORNIA AIR RESOURCES BOARD", X(690), Yy(420), 15 * k, "bold", { align: "right", color: PAPER });
}
