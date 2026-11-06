export type VinReason = "empty" | "bad_format" | "check_digit_mismatch";

export interface VinResult {
  ok: boolean;
  vin: string;
  reason: VinReason | null;
}

const FORMAT = /^[A-HJ-NPR-Z0-9]{17}$/;
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};

export const normalizeVin = (raw: unknown): string => (typeof raw === "string" ? raw.trim().toUpperCase() : "");

export function computeCheckDigit(vin: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    const value = c >= "0" && c <= "9" ? Number(c) : TRANSLIT[c] ?? 0;
    sum += value * WEIGHTS[i];
  }
  const r = sum % 11;
  return r === 10 ? "X" : String(r);
}

export function validateVin(raw: unknown): VinResult {
  const vin = normalizeVin(raw);
  if (!vin) return { ok: false, vin, reason: "empty" };
  if (!FORMAT.test(vin)) return { ok: false, vin, reason: "bad_format" };
  if (computeCheckDigit(vin) !== vin[8]) return { ok: false, vin, reason: "check_digit_mismatch" };
  return { ok: true, vin, reason: null };
}
