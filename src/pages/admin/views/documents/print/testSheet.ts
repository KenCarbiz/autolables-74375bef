import type { PrintCalibration } from "@/lib/stickerStudio/printConfig";
import type { StickerType } from "@/lib/stickerStudio/templates";

/**
 * Opens the existing /print/test-label sheet in a new tab with the adjustments on screen. autoprint is off: the
 * sheet shows a Print button and the dialog only opens when the person presses it. Nothing is recorded.
 */
export function openTestSheet(type: StickerType, cal: PrintCalibration): { ok: boolean; reason?: string } {
  try {
    const key = `test-label-${crypto.randomUUID()}`;
    localStorage.setItem(key, JSON.stringify({ size: type, calibration: cal, autoprint: false }));
    const w = window.open(`/print/test-label?h=${key}`, "_blank", "noopener");
    if (!w) {
      localStorage.removeItem(key);
      return { ok: false, reason: "Allow pop-ups for this site to open the test sheet." };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "The test sheet could not be opened in this browser." };
  }
}
