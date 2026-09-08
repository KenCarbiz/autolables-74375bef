import { vinNormalize, VinValidationError } from "@/lib/factorySticker/validate";

// What produced the characters. A Code-39 barcode is exact, so an I, O or Q
// inside it is a bad read and must be reported rather than "fixed". A person
// reading the dashboard plate genuinely transcribes 1/0/0 as I/O/Q, so that
// substitution is applied only to hand-entered and OCR text.
export type VinScanSource = "barcode" | "typed";

export interface VinScanReading {
  ok: true;
  vin: string;
  raw: string;
  /** Characters outside the VIN were dropped — a Code-39 wrapper or check digit. */
  trimmed: boolean;
  /** I/O/Q were read back as 1/0/0. */
  corrected: boolean;
}

export type VinScanReason = "empty" | "too_short" | "too_long" | "characters";

export interface VinScanRejection {
  ok: false;
  raw: string;
  reason: VinScanReason;
  message: string;
}

export type VinScanOutcome = VinScanReading | VinScanRejection;

const MAX_PAYLOAD = 40;

const strip = (raw: string): string => String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const ocrFix = (candidate: string): string => candidate.replace(/I/g, "1").replace(/[OQ]/g, "0");

const accepts = (candidate: string): string | null => {
  try {
    return vinNormalize(candidate);
  } catch (err) {
    if (err instanceof VinValidationError) return null;
    throw err;
  }
};

const reject = (raw: string, reason: VinScanReason, message: string): VinScanRejection => ({
  ok: false,
  raw,
  reason,
  message,
});

/**
 * Turn what a scanner, a camera or a thumb produced into a VIN we can resolve.
 *
 * Door-jamb Code-39 labels do not all encode the bare VIN: some prefix the
 * Roman-numeral style "I" delimiter, some append a check character, and readers
 * differ on whether they hand back the `*` start/stop pair. So every 17-character
 * window of the payload is offered to the ONE VIN validator this app has
 * (vinNormalize), exact reads first, before any character is second-guessed.
 */
export const normalizeScannedVin = (
  raw: string,
  source: VinScanSource = "typed",
): VinScanOutcome => {
  const cleaned = strip(raw);

  if (!cleaned) {
    return reject(
      raw,
      "empty",
      "Nothing was read. Aim at the barcode on the driver's door jamb, or type the 17-character VIN from the dashboard plate.",
    );
  }

  if (cleaned.length < 17) {
    return reject(
      raw,
      "too_short",
      `That read ${cleaned.length} of the 17 characters a VIN needs. Hold the camera steady over the whole barcode, or type the VIN from the dashboard plate.`,
    );
  }

  if (cleaned.length > MAX_PAYLOAD) {
    return reject(
      raw,
      "too_long",
      `That read ${cleaned.length} characters, so more than the VIN was in frame. Aim at the VIN barcode on its own, or type the 17-character VIN.`,
    );
  }

  const offsets = Array.from({ length: cleaned.length - 16 }, (_, i) => i);

  for (const offset of offsets) {
    const hit = accepts(cleaned.slice(offset, offset + 17));
    if (hit) return { ok: true, vin: hit, raw, trimmed: cleaned.length !== 17, corrected: false };
  }

  if (source === "typed") {
    for (const offset of offsets) {
      const hit = accepts(ocrFix(cleaned.slice(offset, offset + 17)));
      if (hit) return { ok: true, vin: hit, raw, trimmed: cleaned.length !== 17, corrected: true };
    }
  }

  return reject(
    raw,
    "characters",
    "That read contains an I, O or Q. A VIN never uses those letters — on the plate they are the digits 1, 0 and 0. Scan again, or type the VIN.",
  );
};
