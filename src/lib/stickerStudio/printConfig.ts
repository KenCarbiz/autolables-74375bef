import type { StickerType } from "./templates";

// ──────────────────────────────────────────────────────────────────────
// Print configuration for Sticker Studio output. Centralizes paper sizes,
// safe margins, QR quiet zone, label mode, and per-dealer calibration so the
// browser print path (today) and a future server/headless render share one
// source of truth. Maps to dealer_print_settings (20260620060000).
// ──────────────────────────────────────────────────────────────────────

export type LabelMode = "white" | "black";

export interface PaperSpec {
  widthIn: number;
  heightIn: number;
  safeMarginIn: number;   // keep content inside this for non-edge-to-edge stock
  qrQuietZoneIn: number;  // white border around the QR so scanners lock fast
}

// Window 8.5x11, addendum 4.5x11.
export const PAPER: Record<StickerType, PaperSpec> = {
  window:   { widthIn: 8.5, heightIn: 11, safeMarginIn: 0.25, qrQuietZoneIn: 0.18 },
  addendum: { widthIn: 4.5, heightIn: 11, safeMarginIn: 0.2,  qrQuietZoneIn: 0.16 },
};

export interface PrintCalibration {
  labelMode: LabelMode;
  xOffsetIn: number;       // shift right (+) / left (-) to align with pre-cut stock
  yOffsetIn: number;       // shift down (+) / up (-)
  scalePct: number;        // fine scale for printer over/under-scan (95–105 typical)
  topSafeMarginIn: number; // safe-area inset from top
  leftSafeMarginIn: number;// safe-area inset from left/right
  showCropMarks: boolean;  // print corner + center registration marks
  showSafeArea: boolean;   // print the dashed safe-area guide
  printerName?: string;
}

export const DEFAULT_CALIBRATION: PrintCalibration = {
  labelMode: "white",
  xOffsetIn: 0,
  yOffsetIn: 0,
  scalePct: 100,
  topSafeMarginIn: 0.25,
  leftSafeMarginIn: 0.25,
  showCropMarks: false,
  showSafeArea: false,
};

// Clamp calibration to sane bounds so a bad stored value can't push the sheet
// off the page or invert it.
export function normalizeCalibration(c: Partial<PrintCalibration> | null | undefined): PrintCalibration {
  const clamp = (n: number | undefined, lo: number, hi: number, fb: number) =>
    Math.min(hi, Math.max(lo, Number.isFinite(n as number) ? (n as number) : fb));
  return {
    labelMode: c?.labelMode === "black" ? "black" : "white",
    xOffsetIn: clamp(c?.xOffsetIn, -1, 1, 0),
    yOffsetIn: clamp(c?.yOffsetIn, -1, 1, 0),
    scalePct: clamp(c?.scalePct, 80, 120, 100),
    topSafeMarginIn: clamp(c?.topSafeMarginIn, 0, 2, 0.25),
    leftSafeMarginIn: clamp(c?.leftSafeMarginIn, 0, 2, 0.25),
    showCropMarks: !!c?.showCropMarks,
    showSafeArea: !!c?.showSafeArea,
    printerName: c?.printerName,
  };
}

// CSS for the chrome-free print route: page sized to the exact paper, zero
// margin, calibration applied as a transform on the sheet wrapper.
export function buildPrintCss(type: StickerType, cal: PrintCalibration): string {
  const { widthIn, heightIn } = PAPER[type];
  const scale = cal.scalePct / 100;
  const transform = `translate(${cal.xOffsetIn}in, ${cal.yOffsetIn}in) scale(${scale})`;
  return `
    @page { size: ${widthIn}in ${heightIn}in; margin: 0; }
    @media print {
      html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
      .sticker-print-sheet { transform: ${transform}; transform-origin: top left; box-shadow: none !important; }
      .sticker-print-sheet, .sticker-print-sheet * { box-shadow: none !important; }
      .sticker-print-sheet * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
  `;
}

// QR pixel size for a given type, leaving the quiet zone inside the print box.
export function qrPixelSize(type: StickerType): number {
  return type === "addendum" ? 76 : 70;
}
