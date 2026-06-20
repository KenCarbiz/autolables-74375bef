import { supabase } from "@/integrations/supabase/client";

// ──────────────────────────────────────────────────────────────────────
// Sticker Studio API client. PDF/PNG are produced client-side (html2canvas +
// jsPDF) for instant output; saveToVehicle / publishToPassport persist through
// Supabase. Where the production document-storage layer (generated_documents +
// a generated-docs bucket, per the architecture doc) isn't deployed yet, these
// degrade gracefully and report it, so the UI never hard-fails.
//
// Maps to the documented endpoints:
//   POST /api/stickers/generate-pdf   -> client-side (jsPDF)
//   POST /api/stickers/generate-png   -> client-side (html2canvas)
//   POST /api/stickers/save-to-vehicle-> saveStickerToVehicle()
//   POST /api/passports/publish       -> publishToPassport()
// ──────────────────────────────────────────────────────────────────────

export interface SaveStickerArgs {
  vehicleId?: string | null;
  vin: string;
  templateId: string;
  docType: "window" | "addendum";
  pngDataUrl?: string;
  pdfDataUrl?: string;
}

export interface ApiResult {
  ok: boolean;
  url?: string;
  error?: string;
}

// Persist a generated sticker onto the vehicle record. v1 appends a reference to
// vehicle_listings.documents (best-effort); the production path uploads the
// binaries to the generated-docs bucket and writes a generated_documents row.
export async function saveStickerToVehicle(args: SaveStickerArgs): Promise<ApiResult> {
  if (!args.vehicleId) return { ok: false, error: "no_vehicle" };
  try {
    // deno-lint-ignore no-explicit-any
    const sb = supabase as any;
    const { data: row } = await sb.from("vehicle_listings").select("documents").eq("id", args.vehicleId).maybeSingle();
    const documents = Array.isArray(row?.documents) ? row.documents : [];
    const entry = {
      name: `${args.docType === "window" ? "Window Sticker" : "Addendum"} · ${args.templateId}`,
      type: "sticker",
      url: args.pdfDataUrl || args.pngDataUrl || "",
      created_at: new Date().toISOString(),
    };
    const { error } = await sb.from("vehicle_listings").update({ documents: [...documents, entry] }).eq("id", args.vehicleId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "save_failed" };
  }
}

// Publish the vehicle's online passport (the QR destination). v1 flips the
// listing to published; the production path renders the passport HTML version.
export async function publishToPassport(vehicleId?: string | null): Promise<ApiResult> {
  if (!vehicleId) return { ok: false, error: "no_vehicle" };
  try {
    // deno-lint-ignore no-explicit-any
    const sb = supabase as any;
    const { data: row, error } = await sb
      .from("vehicle_listings")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", vehicleId)
      .select("slug")
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return { ok: true, url: row?.slug ? `${origin}/v/${row.slug}` : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "publish_failed" };
  }
}
