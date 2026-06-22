import { supabase } from "@/integrations/supabase/client";
import { buildPersistenceContext, recordPassportViewed } from "@/lib/ctMvp/productionHooks";

// QR tracking: a stable /q/:token per vehicle + sticker type that logs a scan
// then redirects to the Vehicle Passport. Resilient — if the qr_codes table
// isn't deployed, ensureQrCode returns null and callers fall back to the direct
// passport URL, so QR codes always work.

export type StickerKind = "window" | "addendum" | "passport";

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

// Create or reuse the stable QR code for this vehicle + type; returns the
// tracking URL (/q/:token) or null if tracking isn't available.
export async function ensureQrCode(args: {
  tenantId?: string | null;
  vehicleId?: string | null;
  stickerType: StickerKind;
  destinationUrl: string;
  generatedDocumentId?: string | null;
}): Promise<string | null> {
  if (!args.tenantId || !args.vehicleId || !args.destinationUrl) return null;
  try {
    // Reuse an existing token; keep the destination fresh.
    const { data: existing } = await sb()
      .from("qr_codes")
      .select("token")
      .eq("tenant_id", args.tenantId)
      .eq("vehicle_id", args.vehicleId)
      .eq("sticker_type", args.stickerType)
      .maybeSingle();
    let token: string | undefined = existing?.token;
    if (token) {
      await sb().from("qr_codes").update({ destination_url: args.destinationUrl, generated_document_id: args.generatedDocumentId || null }).eq("token", token);
    } else {
      const { data: created, error } = await sb()
        .from("qr_codes")
        .insert({ tenant_id: args.tenantId, vehicle_id: args.vehicleId, sticker_type: args.stickerType, destination_url: args.destinationUrl, generated_document_id: args.generatedDocumentId || null })
        .select("token")
        .maybeSingle();
      if (error || !created?.token) return null;
      token = created.token;
    }
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/q/${token}`;
  } catch { return null; }
}

// Coarse device category from a user-agent string.
export function deviceCategory(ua: string): "mobile" | "tablet" | "desktop" {
  const s = ua.toLowerCase();
  if (/ipad|tablet|playbook|silk/.test(s) || (/android/.test(s) && !/mobile/.test(s))) return "tablet";
  if (/mobi|iphone|ipod|android.*mobile|windows phone/.test(s)) return "mobile";
  return "desktop";
}

export function browserName(ua: string): string {
  const s = ua.toLowerCase();
  if (s.includes("edg/")) return "Edge";
  if (s.includes("opr/") || s.includes("opera")) return "Opera";
  if (s.includes("chrome/") && !s.includes("chromium")) return "Chrome";
  if (s.includes("firefox/")) return "Firefox";
  if (s.includes("safari/") && !s.includes("chrome")) return "Safari";
  return "Other";
}

// Log a scan via the public RPC and return the destination URL.
export async function logScan(token: string): Promise<string | null> {
  try {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const { data } = await sb().rpc("log_qr_scan", {
      _token: token,
      _device: deviceCategory(ua),
      _browser: browserName(ua),
      _referrer: typeof document !== "undefined" ? document.referrer || null : null,
      _ua: ua || null,
    });

    // Best-effort CT MVP audit event. The QR RPC remains source of truth for
    // scan analytics; this writes the compliance lifecycle proof when possible.
    try {
      const { data: qr } = await sb()
        .from("qr_codes")
        .select("tenant_id, vehicle_id, sticker_type, destination_url")
        .eq("token", token)
        .maybeSingle();
      await recordPassportViewed(buildPersistenceContext({
        tenantId: qr?.tenant_id,
        vehicleId: qr?.vehicle_id,
      }), {
        token,
        stickerType: qr?.sticker_type,
        destinationUrl: qr?.destination_url,
        device: deviceCategory(ua),
        browser: browserName(ua),
        referrer: typeof document !== "undefined" ? document.referrer || null : null,
      });
    } catch { /* lifecycle proof is best-effort */ }

    return typeof data === "string" ? data : null;
  } catch { return null; }
}
