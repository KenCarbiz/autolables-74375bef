import { DEFAULT_CALIBRATION, PAPER, calibrationTransform, normalizeCalibration, type PrintCalibration } from "@/lib/stickerStudio/printConfig";
import type { StickerType } from "@/lib/stickerStudio/templates";

export const MM_PER_IN = 25.4;

export const inToMm = (inches: number): number => inches * MM_PER_IN;
export const mmToIn = (mm: number): number => mm / MM_PER_IN;

const round = (n: number, places: number): number => {
  const f = 10 ** places;
  return Math.round((n + Number.EPSILON) * f) / f;
};

export type Unit = "in" | "mm";

export const OFFSET_LIMIT_IN = 1;
export const SCALE_MIN = 80;
export const SCALE_MAX = 120;

export const STEPS_BY_UNIT: Record<Unit, readonly number[]> = {
  in: [0.01, 0.025, 0.05, 0.1],
  mm: [0.25, 0.5, 1, 2],
};

export const stepToInches = (step: number, unit: Unit): number => round(unit === "in" ? step : mmToIn(step), 5);

export const formatLength = (inches: number, unit: Unit): string =>
  unit === "in" ? `${round(inches, 3).toFixed(3)} in` : `${round(inches * MM_PER_IN, 2).toFixed(2)} mm`;

export const formatStep = (step: number, unit: Unit): string => `${step} ${unit}`;

export type Direction = "up" | "down" | "left" | "right";

/**
 * Moves the printed sheet. The render applies translate(x, y) from the top-left corner, so right and down are
 * positive. Results stay on the same 0.0001 in grid and inside the stored range.
 */
export function nudge(cal: PrintCalibration, direction: Direction, stepIn: number): PrintCalibration {
  const dx = direction === "right" ? stepIn : direction === "left" ? -stepIn : 0;
  const dy = direction === "down" ? stepIn : direction === "up" ? -stepIn : 0;
  const clamp = (n: number) => Math.min(OFFSET_LIMIT_IN, Math.max(-OFFSET_LIMIT_IN, round(n, 4)));
  return { ...cal, xOffsetIn: clamp(cal.xOffsetIn + dx), yOffsetIn: clamp(cal.yOffsetIn + dy) };
}

export const canNudge = (cal: PrintCalibration, direction: Direction, stepIn: number): boolean => {
  const next = nudge(cal, direction, stepIn);
  return next.xOffsetIn !== cal.xOffsetIn || next.yOffsetIn !== cal.yOffsetIn;
};

export const isAdjusted = (cal: Pick<PrintCalibration, "xOffsetIn" | "yOffsetIn" | "scalePct">): boolean =>
  cal.xOffsetIn !== DEFAULT_CALIBRATION.xOffsetIn || cal.yOffsetIn !== DEFAULT_CALIBRATION.yOffsetIn || cal.scalePct !== DEFAULT_CALIBRATION.scalePct;

/** Clears only the alignment transform. Safe margins, stock and printer label are left as saved. */
export const resetAdjustments = (cal: PrintCalibration): PrintCalibration => ({
  ...cal,
  xOffsetIn: DEFAULT_CALIBRATION.xOffsetIn,
  yOffsetIn: DEFAULT_CALIBRATION.yOffsetIn,
  scalePct: DEFAULT_CALIBRATION.scalePct,
});

export interface Rect { x: number; y: number; w: number; h: number }

export const paperRect = (type: StickerType): Rect => ({ x: 0, y: 0, w: PAPER[type].widthIn, h: PAPER[type].heightIn });

/** Where the sheet border lands: the paper rectangle run through the same transform the print CSS applies. */
export function adjustedRect(type: StickerType, cal: Pick<PrintCalibration, "xOffsetIn" | "yOffsetIn" | "scalePct">): Rect {
  const t = calibrationTransform(cal);
  const p = paperRect(type);
  return { x: t.xIn + t.scale * p.x, y: t.yIn + t.scale * p.y, w: t.scale * p.w, h: t.scale * p.h };
}

export interface PaperFormat { type: StickerType; name: string; sizeLabel: string; use: string; widthIn: number; heightIn: number }

export const PAPER_FORMATS: readonly PaperFormat[] = [
  { type: "window", name: "Letter", sizeLabel: "8.5 x 11 in", use: "Window sticker", widthIn: PAPER.window.widthIn, heightIn: PAPER.window.heightIn },
  { type: "addendum", name: "Half letter", sizeLabel: "4.5 x 11 in", use: "Addendum", widthIn: PAPER.addendum.widthIn, heightIn: PAPER.addendum.heightIn },
];

export const paperLabel = (type: StickerType): string => {
  const f = PAPER_FORMATS.find((x) => x.type === type);
  return f ? `${f.name} ${f.sizeLabel}, ${f.use.toLowerCase()}` : type;
};

export interface AlignmentFields { xOffsetIn: string; yOffsetIn: string; scalePct: string; printerName: string; topSafeMarginIn: string; leftSafeMarginIn: string }
export type AlignmentErrors = Partial<Record<keyof AlignmentFields, string>>;

const parse = (v: string): number => (v.trim() === "" ? Number.NaN : Number(v));
export const SAFE_MARGIN_MAX_IN = 2;

/** Validates what the person typed. A value outside the stored range is an error, never a silent clamp. */
export function validateAlignment(f: AlignmentFields, unit: Unit): AlignmentErrors {
  const errors: AlignmentErrors = {};
  const limit = unit === "in" ? OFFSET_LIMIT_IN : round(inToMm(OFFSET_LIMIT_IN), 1);
  for (const key of ["xOffsetIn", "yOffsetIn"] as const) {
    const n = parse(f[key]);
    if (!Number.isFinite(n)) errors[key] = "Enter a number.";
    else if (Math.abs(n) > limit) errors[key] = `Keep it between -${limit} and ${limit} ${unit}.`;
  }
  const marginLimit = unit === "in" ? SAFE_MARGIN_MAX_IN : round(inToMm(SAFE_MARGIN_MAX_IN), 1);
  for (const key of ["topSafeMarginIn", "leftSafeMarginIn"] as const) {
    const n = parse(f[key]);
    if (!Number.isFinite(n)) errors[key] = "Enter a number.";
    else if (n < 0 || n > marginLimit) errors[key] = `Keep it between 0 and ${marginLimit} ${unit}.`;
  }
  const s = parse(f.scalePct);
  if (!Number.isFinite(s)) errors.scalePct = "Enter a number.";
  else if (s < SCALE_MIN || s > SCALE_MAX) errors.scalePct = `Keep scale between ${SCALE_MIN} and ${SCALE_MAX} percent.`;
  if (f.printerName.length > 80) errors.printerName = "Use 80 characters or fewer.";
  return errors;
}

const lengthField = (inches: number, unit: Unit): string => String(unit === "in" ? round(inches, 4) : round(inToMm(inches), 2));
const lengthIn = (text: string, unit: Unit): number => round(unit === "in" ? Number(text) : mmToIn(Number(text)), 4);

export const fieldsFromCalibration = (cal: PrintCalibration, unit: Unit): AlignmentFields => ({
  xOffsetIn: lengthField(cal.xOffsetIn, unit),
  yOffsetIn: lengthField(cal.yOffsetIn, unit),
  scalePct: String(round(cal.scalePct, 2)),
  printerName: cal.printerName ?? "",
  topSafeMarginIn: lengthField(cal.topSafeMarginIn, unit),
  leftSafeMarginIn: lengthField(cal.leftSafeMarginIn, unit),
});

export function calibrationFromFields(base: PrintCalibration, f: AlignmentFields, unit: Unit): PrintCalibration {
  return normalizeCalibration({
    ...base,
    xOffsetIn: lengthIn(f.xOffsetIn, unit),
    yOffsetIn: lengthIn(f.yOffsetIn, unit),
    scalePct: Number(f.scalePct),
    topSafeMarginIn: lengthIn(f.topSafeMarginIn, unit),
    leftSafeMarginIn: lengthIn(f.leftSafeMarginIn, unit),
    printerName: f.printerName.trim() || undefined,
  });
}

export interface CalibrationChange { id: string; label: string; before: string; after: string }

const dir = (n: number, pos: string, neg: string, unit: Unit): string => (n === 0 ? formatLength(0, unit) : `${formatLength(Math.abs(n), unit)} ${n > 0 ? pos : neg}`);

/** One row per changed value, worded for the review dialog. */
export function calibrationChanges(before: PrintCalibration, after: PrintCalibration, unit: Unit = "in"): CalibrationChange[] {
  const rows: CalibrationChange[] = [];
  const push = (id: string, label: string, b: string, a: string, differs: boolean) => { if (differs) rows.push({ id, label, before: b, after: a }); };
  push("printerName", "Printer label", before.printerName || "Not set", after.printerName || "Not set", (before.printerName ?? "") !== (after.printerName ?? ""));
  push("xOffsetIn", "Horizontal offset", dir(before.xOffsetIn, "right", "left", unit), dir(after.xOffsetIn, "right", "left", unit), before.xOffsetIn !== after.xOffsetIn);
  push("yOffsetIn", "Vertical offset", dir(before.yOffsetIn, "down", "up", unit), dir(after.yOffsetIn, "down", "up", unit), before.yOffsetIn !== after.yOffsetIn);
  push("scalePct", "Scale", `${before.scalePct} percent`, `${after.scalePct} percent`, before.scalePct !== after.scalePct);
  push("topSafeMarginIn", "Top safe margin", formatLength(before.topSafeMarginIn, unit), formatLength(after.topSafeMarginIn, unit), before.topSafeMarginIn !== after.topSafeMarginIn);
  push("leftSafeMarginIn", "Side safe margin", formatLength(before.leftSafeMarginIn, unit), formatLength(after.leftSafeMarginIn, unit), before.leftSafeMarginIn !== after.leftSafeMarginIn);
  push("labelMode", "Label stock", before.labelMode === "black" ? "Black label" : "White label", after.labelMode === "black" ? "Black label" : "White label", before.labelMode !== after.labelMode);
  push("showCropMarks", "Crop marks on print", before.showCropMarks ? "On" : "Off", after.showCropMarks ? "On" : "Off", before.showCropMarks !== after.showCropMarks);
  push("showSafeArea", "Safe-area guide on print", before.showSafeArea ? "On" : "Off", after.showSafeArea ? "On" : "Off", before.showSafeArea !== after.showSafeArea);
  return rows;
}

export interface PrintProfile {
  id: string;
  locationId: string | null;
  printerName: string;
  calibration: PrintCalibration;
  updatedAt: string | null;
  /** Null when the verification columns are not deployed; a date or "none" once they are. */
  verification: { deployed: false } | { deployed: true; verifiedAt: string | null; verifiedBy: string | null };
}

export type PrintProfileRow = Record<string, unknown> & { id: string; location_id: string | null };

const num = (v: unknown): number | undefined => (v === null || v === undefined || v === "" ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined);

export function profileFromRow(row: PrintProfileRow): PrintProfile {
  const cal = normalizeCalibration({
    labelMode: row.label_mode === "black" ? "black" : "white",
    xOffsetIn: num(row.x_offset_inches),
    yOffsetIn: num(row.y_offset_inches),
    scalePct: num(row.scale_percentage),
    topSafeMarginIn: num(row.top_safe_margin_inches),
    leftSafeMarginIn: num(row.left_safe_margin_inches),
    showCropMarks: row.show_crop_marks === true,
    showSafeArea: row.show_safe_area === true,
    printerName: typeof row.printer_name === "string" && row.printer_name.trim() ? row.printer_name.trim() : undefined,
  });
  const deployed = "calibration_verified_at" in row;
  return {
    id: row.id,
    locationId: row.location_id ?? null,
    printerName: cal.printerName ?? "",
    calibration: cal,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    verification: deployed
      ? { deployed: true, verifiedAt: typeof row.calibration_verified_at === "string" ? row.calibration_verified_at : null, verifiedBy: typeof row.calibration_verified_by === "string" ? row.calibration_verified_by : null }
      : { deployed: false },
  };
}

export type ConfirmationView =
  | { state: "unavailable"; label: string; reason: string }
  | { state: "not_verified"; label: string; reason: string }
  | { state: "confirmed"; label: string; reason: string };

export const VERIFY_MIGRATION_ID = "20261114010000";

/** A profile is only ever shown as confirmed when a person's recorded confirmation exists. */
export function confirmationView(p: PrintProfile): ConfirmationView {
  if (!p.verification.deployed) {
    return { state: "unavailable", label: "Not verified", reason: `Nobody has confirmed this profile, and a confirmation cannot be recorded until database update ${VERIFY_MIGRATION_ID} is applied.` };
  }
  if (!p.verification.verifiedAt) {
    return { state: "not_verified", label: "Not verified", reason: "No person has confirmed a printed test sheet for this profile." };
  }
  return { state: "confirmed", label: "Confirmed by a person", reason: "A person recorded that a printed test sheet matched. This does not test the printer connection." };
}

/** Replaces one profile by id and returns every other profile untouched. */
export function replaceProfile(list: readonly PrintProfile[], id: string, next: PrintProfile): PrintProfile[] {
  return list.map((p) => (p.id === id ? next : p));
}

export interface ProfileDraft { printerName: string; locationId: string | null }
export type ProfileErrors = Partial<Record<"printerName" | "locationId", string>>;

export function validateProfileDraft(d: ProfileDraft, existing: readonly PrintProfile[], editingId: string | null): ProfileErrors {
  const errors: ProfileErrors = {};
  const name = d.printerName.trim();
  if (!name) errors.printerName = "Enter the printer label people will recognise.";
  else if (name.length > 80) errors.printerName = "Use 80 characters or fewer.";
  if (existing.some((p) => p.id !== editingId && p.locationId === d.locationId)) {
    errors.locationId = "This location already has a printer profile. Edit that one instead.";
  }
  return errors;
}
