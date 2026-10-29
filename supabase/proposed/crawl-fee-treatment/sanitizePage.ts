// PROPOSED, NOT DEPLOYED. Turns a captured dealer page into a regression
// fixture that keeps the real markup structure but no real identifiers or
// prices: VINs are mapped to synthetic ones, named strings are replaced,
// scripts other than JSON-LD and all external references are dropped, and
// every unsigned price of $10,000 or more (the stage figures: MSRP, dealer
// price, customer total) is shifted by one offset. Signed adjustments
// (discounts, incentives, fees) keep their amounts, so every stack's
// arithmetic still closes after sanitising.

export interface SanitizeOptions {
  /** Real VIN -> synthetic VIN. Unmapped VINs get a generated stand-in. */
  vinMap?: Record<string, string>;
  /** Literal strings to replace (dealer name, phone, street address...). */
  replacements?: [string, string][];
  /** Added to every unsigned price of $10,000 or more. */
  priceOffset: number;
}

const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/gi;
const looksLikeVin = (s: string) => /\d/.test(s) && /[A-Z]/i.test(s);

export function sanitizePage(html: string, opts: SanitizeOptions): { html: string; vinMap: Record<string, string> } {
  const map: Record<string, string> = Object.fromEntries(Object.entries(opts.vinMap ?? {}).map(([k, v]) => [k.toUpperCase(), v.toUpperCase()]));
  let n = Object.keys(map).length;
  const synth = () => `5XSAN${String(++n).padStart(12, "0")}`;
  let out = html
    .replace(/<script\b(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<(?:iframe|noscript)\b[\s\S]*?<\/(?:iframe|noscript)>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/\s(?:src|srcset|href|action|data-src)=("[^"]*"|'[^']*')/gi, (m, v) => (/^["']\/viewdetails\//i.test(v) ? m : ""))
    .replace(/<input\b[^>]*type=["']?hidden[^>]*>/gi, "");
  out = out.replace(VIN_RE, (v) => {
    if (!looksLikeVin(v)) return v;
    const key = v.toUpperCase();
    map[key] ??= synth();
    return v === v.toLowerCase() ? map[key].toLowerCase() : map[key];
  });
  for (const [from, to] of opts.replacements ?? []) out = out.split(from).join(to);
  out = out.replace(/([+\-−–]\s*)?\$\s?(\d{1,3}(?:,\d{3})+|\d{5,7})(\.\d{2})?/g, (m, sign: string | undefined, amt: string, cents: string | undefined) => {
    if (sign) return m;
    const v = Number(amt.replace(/,/g, ""));
    if (v < 10000) return m;
    return `$${(v + opts.priceOffset).toLocaleString("en-US")}${cents ?? ""}`;
  });
  return { html: out, vinMap: map };
}
