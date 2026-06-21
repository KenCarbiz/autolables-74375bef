// ──────────────────────────────────────────────────────────────────────
// Sticker asset resolution + readiness. Templates render a dealer logo, an
// optional vehicle photo, and a QR code. This centralizes how those resolve so
// print is never broken: logos fall back to the dealer name, photos fall back
// to a clean placeholder, and the QR has a guaranteed white quiet zone (it is
// never inverted on black label). Reuses existing branding + vehicle data —
// no new asset store.
// ──────────────────────────────────────────────────────────────────────

export type AssetState = "ready" | "missing" | "low_res";

export interface AssetReadiness {
  logo: AssetState;
  vehiclePhoto: AssetState;
  qr: AssetState;
  logoWidth?: number;
}

// Minimum natural width (px) we consider safe for crisp print of a logo.
const LOGO_MIN_PRINT_WIDTH = 200;

// Probe an image URL for its natural dimensions. Resolves null on error so a
// broken/blocked URL is treated as missing rather than hanging.
export function probeImage(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (!url || typeof Image === "undefined") { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    let settled = false;
    const done = (v: { width: number; height: number } | null) => { if (!settled) { settled = true; resolve(v); } };
    img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => done(null);
    img.src = url;
    window.setTimeout(() => done(null), 6000);
  });
}

// Classify a logo URL into ready / low_res / missing.
export async function classifyLogo(url?: string | null): Promise<{ state: AssetState; width?: number }> {
  if (!url) return { state: "missing" };
  const dims = await probeImage(url);
  if (!dims) return { state: "missing" };
  if (dims.width < LOGO_MIN_PRINT_WIDTH) return { state: "low_res", width: dims.width };
  return { state: "ready", width: dims.width };
}

// Resolve the QR destination, preferring the trackable /q route already encoded
// into the sticker data; falls back to the passport URL. (The generator sets
// data.qrUrl to the tracking URL when QR analytics is on.)
export function resolveQrUrl(qrUrl: string | undefined, fallback: string | undefined): string {
  return (qrUrl && qrUrl.trim()) || (fallback && fallback.trim()) || "";
}
