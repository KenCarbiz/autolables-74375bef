export const DARK_SURFACE_HEX = "#162638";
export const WHITE_HEX = "#FFFFFF";
export const AA_NORMAL_TEXT = 4.5;

/** "#abc", "abc", "#aabbcc" -> "#AABBCC". Anything else -> null. */
export function normalizeHex(input: string): string | null {
  const v = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(v)) return `#${v.split("").map((c) => c + c).join("").toUpperCase()}`;
  if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v.toUpperCase()}`;
  return null;
}

export function colorError(input: string, required = true): string | null {
  if (input.trim() === "") return required ? "Enter a HEX color such as #2457D6." : null;
  return normalizeHex(input) ? null : "Not a valid HEX color. Use #RGB or #RRGGBB.";
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const n = normalizeHex(hex);
  if (!n) throw new Error(`Invalid color ${hex}`);
  const r = parseInt(n.slice(1, 3), 16);
  const g = parseInt(n.slice(3, 5), 16);
  const b = parseInt(n.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const formatRatio = (ratio: number): string => `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
