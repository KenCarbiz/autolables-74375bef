import { describe, expect, it } from "vitest";
import { DEFAULT_CALIBRATION, PAPER, buildPrintCss, calibrationTransform, calibrationTransformCss, normalizeCalibration, type PrintCalibration } from "@/lib/stickerStudio/printConfig";
import {
  adjustedRect, calibrationChanges, calibrationFromFields, canNudge, confirmationView, fieldsFromCalibration, inToMm, mmToIn, nudge, profileFromRow, replaceProfile, resetAdjustments, stepToInches,
  validateAlignment, validateProfileDraft, type PrintProfile, type PrintProfileRow,
} from "./printWizard";

const cal = (p: Partial<PrintCalibration> = {}): PrintCalibration => ({ ...DEFAULT_CALIBRATION, ...p });

const row = (id: string, location: string | null, extra: Record<string, unknown> = {}): PrintProfileRow => ({
  id, location_id: location, printer_name: `Printer ${id}`, x_offset_inches: 0, y_offset_inches: 0, scale_percentage: 100, label_mode: "white", updated_at: "2026-11-01T00:00:00Z", ...extra,
});

describe("units", () => {
  it("round-trips inches and millimeters", () => {
    for (const inches of [0, 0.01, 0.025, 0.05, 0.1, -0.375, 1, -1]) expect(mmToIn(inToMm(inches))).toBeCloseTo(inches, 10);
    for (const mm of [0.25, 0.5, 1, 2, -3.2]) expect(inToMm(mmToIn(mm))).toBeCloseTo(mm, 10);
  });

  it("converts 25.4 mm to exactly one inch", () => {
    expect(mmToIn(25.4)).toBe(1);
    expect(inToMm(1)).toBe(25.4);
  });

  it("round-trips a millimeter entry through the stored inch value", () => {
    const base = cal();
    const fields = { ...fieldsFromCalibration(base, "mm"), xOffsetIn: "1.5", yOffsetIn: "-0.75" };
    const next = calibrationFromFields(base, fields, "mm");
    expect(next.xOffsetIn).toBeCloseTo(1.5 / 25.4, 4);
    expect(fieldsFromCalibration(next, "mm").xOffsetIn).toBe("1.5");
    expect(fieldsFromCalibration(next, "mm").yOffsetIn).toBe("-0.75");
  });

  it("turns a chosen step into inches", () => {
    expect(stepToInches(0.05, "in")).toBe(0.05);
    expect(stepToInches(1, "mm")).toBeCloseTo(0.03937, 5);
  });
});

describe("directional movement", () => {
  it("moves right and down as positive, matching the print transform", () => {
    const start = cal();
    expect(nudge(start, "right", 0.05).xOffsetIn).toBe(0.05);
    expect(nudge(start, "left", 0.05).xOffsetIn).toBe(-0.05);
    expect(nudge(start, "down", 0.05).yOffsetIn).toBe(0.05);
    expect(nudge(start, "up", 0.05).yOffsetIn).toBe(-0.05);
  });

  it("changes only the axis it names and leaves the rest alone", () => {
    const start = cal({ xOffsetIn: 0.1, yOffsetIn: 0.2, scalePct: 101, printerName: "X" });
    const next = nudge(start, "right", 0.01);
    expect(next).toEqual({ ...start, xOffsetIn: 0.11 });
  });

  it("does not drift on repeated small steps", () => {
    let c = cal();
    for (let i = 0; i < 30; i++) c = nudge(c, "right", 0.01);
    expect(c.xOffsetIn).toBe(0.3);
  });

  it("stops at the stored range and reports it", () => {
    const edge = cal({ xOffsetIn: 1 });
    expect(nudge(edge, "right", 0.1).xOffsetIn).toBe(1);
    expect(canNudge(edge, "right", 0.1)).toBe(false);
    expect(canNudge(edge, "left", 0.1)).toBe(true);
  });

  it("moves the drawn border the same way the sheet moves", () => {
    const moved = nudge(cal(), "right", 0.1);
    expect(adjustedRect("window", moved).x).toBeGreaterThan(adjustedRect("window", cal()).x);
    const down = nudge(cal(), "down", 0.1);
    expect(adjustedRect("window", down).y).toBeGreaterThan(0);
  });
});

describe("preview transform equals render transform", () => {
  const cases = [cal(), cal({ xOffsetIn: 0.125, yOffsetIn: -0.0625, scalePct: 100 }), cal({ xOffsetIn: -0.5, yOffsetIn: 0.3, scalePct: 98.5 }), cal({ scalePct: 103 })];

  it.each(cases)("buildPrintCss and the preview read one transform (%#)", (c) => {
    const css = buildPrintCss("window", c);
    const m = css.match(/transform: translate\((-?[\d.]+)in, (-?[\d.]+)in\) scale\(([\d.]+)\); transform-origin: top left/);
    expect(m).not.toBeNull();
    const t = calibrationTransform(c);
    expect(Number(m![1])).toBe(t.xIn);
    expect(Number(m![2])).toBe(t.yIn);
    expect(Number(m![3])).toBeCloseTo(t.scale, 10);
    expect(css).toContain(calibrationTransformCss(c));
  });

  it.each(cases)("the drawn border is the paper rectangle through that transform (%#)", (c) => {
    for (const type of ["window", "addendum"] as const) {
      const t = calibrationTransform(c);
      const r = adjustedRect(type, c);
      expect(r.x).toBeCloseTo(t.xIn, 10);
      expect(r.y).toBeCloseTo(t.yIn, 10);
      expect(r.w).toBeCloseTo(PAPER[type].widthIn * t.scale, 10);
      expect(r.h).toBeCloseTo(PAPER[type].heightIn * t.scale, 10);
    }
  });

  it("keeps print CSS output byte for byte as it was", () => {
    const c = cal({ xOffsetIn: 0.1, yOffsetIn: -0.2, scalePct: 99 });
    expect(buildPrintCss("addendum", c)).toBe(`
    @page { size: 4.5in 11in; margin: 0; }
    @media print {
      html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
      .sticker-print-sheet { transform: translate(0.1in, -0.2in) scale(0.99); transform-origin: top left; box-shadow: none !important; }
      .sticker-print-sheet, .sticker-print-sheet * { box-shadow: none !important; }
      .sticker-print-sheet * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
  `);
  });

  it("keeps real paper dimensions with no crop or stretch", () => {
    expect(adjustedRect("window", cal())).toEqual({ x: 0, y: 0, w: 8.5, h: 11 });
    expect(adjustedRect("addendum", cal())).toEqual({ x: 0, y: 0, w: 4.5, h: 11 });
    const r = adjustedRect("window", cal({ scalePct: 105 }));
    expect(r.w / r.h).toBeCloseTo(8.5 / 11, 10);
  });
});

describe("reset and validation", () => {
  it("resets only the alignment transform", () => {
    const c = cal({ xOffsetIn: 0.3, yOffsetIn: -0.1, scalePct: 102, topSafeMarginIn: 0.4, printerName: "Keep me", showCropMarks: true });
    expect(resetAdjustments(c)).toEqual({ ...c, xOffsetIn: 0, yOffsetIn: 0, scalePct: 100 });
  });

  it("rejects values the stored range would silently clamp", () => {
    const f = { ...fieldsFromCalibration(cal(), "in"), xOffsetIn: "4.5", scalePct: "140", yOffsetIn: "", topSafeMarginIn: "-1" };
    const errors = validateAlignment(f, "in");
    expect(errors.xOffsetIn).toMatch(/between/);
    expect(errors.scalePct).toMatch(/between 80 and 120/);
    expect(errors.yOffsetIn).toBe("Enter a number.");
    expect(errors.topSafeMarginIn).toMatch(/between 0/);
    expect(normalizeCalibration({ xOffsetIn: 4.5 }).xOffsetIn).toBe(1);
  });

  it("applies the millimeter limit in millimeters", () => {
    expect(validateAlignment({ ...fieldsFromCalibration(cal(), "mm"), xOffsetIn: "20" }, "mm").xOffsetIn).toBeUndefined();
    expect(validateAlignment({ ...fieldsFromCalibration(cal(), "mm"), xOffsetIn: "30" }, "mm").xOffsetIn).toMatch(/25.4/);
  });

  it("lists review rows only for what changed", () => {
    const rows = calibrationChanges(cal(), cal({ xOffsetIn: 0.05, yOffsetIn: -0.02 }));
    expect(rows.map((r) => r.id)).toEqual(["xOffsetIn", "yOffsetIn"]);
    expect(rows[0].after).toBe("0.050 in right");
    expect(rows[1].after).toBe("0.020 in up");
    expect(calibrationChanges(cal(), cal())).toEqual([]);
  });
});

describe("profiles", () => {
  const list = (): PrintProfile[] => [profileFromRow(row("a", null)), profileFromRow(row("b", "loc-b")), profileFromRow(row("c", "loc-c"))];

  it("replaces one profile and returns every other object untouched", () => {
    const before = list();
    const changed = { ...before[1], calibration: cal({ xOffsetIn: 0.2 }) };
    const after = replaceProfile(before, "b", changed);
    expect(after[1]).toBe(changed);
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
    expect(before[1].calibration.xOffsetIn).toBe(0);
  });

  it("never reports a profile as verified unless a recorded confirmation exists", () => {
    expect(confirmationView(profileFromRow(row("a", null)))).toMatchObject({ state: "unavailable", label: "Unavailable" });
    expect(confirmationView(profileFromRow(row("a", null, { calibration_verified_at: null })))).toMatchObject({ state: "not_verified", label: "Not verified" });
    expect(confirmationView(profileFromRow(row("a", null, { test_sheet_printed_at: "2026-11-01T00:00:00Z", calibration_verified_at: null }))).state).toBe("not_verified");
    expect(confirmationView(profileFromRow(row("a", null, { calibration_verified_at: "2026-11-02T00:00:00Z", calibration_verified_by: "u1" }))).state).toBe("confirmed");
  });

  it("requires a label and one profile per location", () => {
    const profiles = list();
    expect(validateProfileDraft({ printerName: " ", locationId: "loc-z" }, profiles, null).printerName).toBeTruthy();
    expect(validateProfileDraft({ printerName: "Lobby", locationId: "loc-b" }, profiles, null).locationId).toMatch(/already has/);
    expect(validateProfileDraft({ printerName: "Lobby", locationId: "loc-b" }, profiles, "b")).toEqual({});
  });
});
