import { supabase } from "@/integrations/supabase/client";
import type { StickerData, StickerBranding, StickerTemplateConfig, StickerRenderOptions } from "./templates";

// ──────────────────────────────────────────────────────────────────────
// Sticker Studio API client. PDF/PNG are produced client-side (html2canvas +
// jsPDF) for instant output; saveToVehicle / publishToPassport / saveAddendum
// persist through Supabase. The production document layer is generated_documents
// (20260620060000) with an immutable data_snapshot + version; until that
// migration is deployed, saves degrade to the legacy vehicle_listings.documents
// array so the UI never hard-fails.
//
// Maps to the documented endpoints:
//   POST /api/stickers/generate-pdf    -> client-side (jsPDF)
//   POST /api/stickers/generate-png    -> client-side (html2canvas)
//   POST /api/stickers/save-to-vehicle -> saveStickerToVehicle()
//   POST /api/passports/publish        -> publishToPassport()
// ──────────────────────────────────────────────────────────────────────

export interface DocumentSnapshot {
  config: StickerTemplateConfig;
  data: StickerData;
  branding: StickerBranding;
  options: StickerRenderOptions;
}

export interface SaveStickerArgs {
  tenantId?: string | null;
  vehicleId?: string | null;
  vin: string;
  templateId: string;
  docType: "window" | "addendum";
  labelMode?: "white" | "black";
  qrUrl?: string;
  pngDataUrl?: string;
  pdfDataUrl?: string;
  snapshot?: DocumentSnapshot;
}

export interface ApiResult {
  ok: boolean;
  url?: string;
  error?: string;
  documentId?: string;
  version?: number;
}

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

// Best-effort compliance trail. Reuses the canonical public.audit_log table.
export async function logStickerAudit(
  action: string,
  entity: { tenantId?: string | null; entityType: string; entityId?: string | null; details?: Record<string, unknown> },
): Promise<void> {
  try {
    await sb().from("audit_log").insert({
      action,
      entity_type: entity.entityType,
      entity_id: entity.entityId || "unknown",
      store_id: entity.tenantId || null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      details: entity.details || {},
    });
  } catch { /* audit is non-blocking */ }
}

// Persist a generated sticker as an immutable generated_documents row (versioned
// per vehicle + type). Falls back to the legacy documents array when the table
// isn't present yet. Returns the new document id + version on the production path.
export async function saveStickerToVehicle(args: SaveStickerArgs): Promise<ApiResult> {
  if (!args.vehicleId) return { ok: false, error: "no_vehicle" };
  const client = sb();

  // Production path: generated_documents with a frozen snapshot + version bump.
  try {
    const { data: last, error: readErr } = await client
      .from("generated_documents")
      .select("version")
      .eq("vehicle_id", args.vehicleId)
      .eq("document_type", args.docType)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!readErr) {
      const version = (last?.version || 0) + 1;
      const { data: doc, error: insErr } = await client
        .from("generated_documents")
        .insert({
          tenant_id: args.tenantId || null,
          vehicle_id: args.vehicleId,
          template_id: args.templateId,
          document_type: args.docType,
          document_status: "draft",
          version,
          label_mode: args.labelMode || "white",
          pdf_url: args.pdfDataUrl || null,
          png_url: args.pngDataUrl || null,
          online_url: args.qrUrl || null,
          data_snapshot: args.snapshot || {},
        })
        .select("id, version")
        .maybeSingle();
      if (!insErr && doc) {
        await logStickerAudit("sticker_generated", {
          tenantId: args.tenantId, entityType: args.docType, entityId: doc.id,
          details: { template_id: args.templateId, version: doc.version, vin: args.vin },
        });
        return { ok: true, documentId: doc.id, version: doc.version };
      }
    }
  } catch { /* fall through to legacy */ }

  // Fallback path: append a reference to vehicle_listings.documents.
  try {
    const { data: row } = await client.from("vehicle_listings").select("documents").eq("id", args.vehicleId).maybeSingle();
    const documents = Array.isArray(row?.documents) ? row.documents : [];
    const entry = {
      name: `${args.docType === "window" ? "Window Sticker" : "Addendum"} · ${args.templateId}`,
      type: "sticker",
      url: args.pdfDataUrl || args.pngDataUrl || "",
      created_at: new Date().toISOString(),
    };
    const { error } = await client.from("vehicle_listings").update({ documents: [...documents, entry] }).eq("id", args.vehicleId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "save_failed" };
  }
}

// Publish the vehicle's online passport (the QR destination) and mark the most
// recent generated document published with its online URL.
export async function publishToPassport(vehicleId?: string | null, tenantId?: string | null): Promise<ApiResult> {
  if (!vehicleId) return { ok: false, error: "no_vehicle" };
  const client = sb();
  try {
    const { data: row, error } = await client
      .from("vehicle_listings")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", vehicleId)
      .select("slug")
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = row?.slug ? `${origin}/v/${row.slug}` : undefined;
    // Best-effort: flag the latest generated doc as published.
    try {
      const { data: latest } = await client
        .from("generated_documents")
        .select("id")
        .eq("vehicle_id", vehicleId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest?.id) {
        await client.from("generated_documents")
          .update({ document_status: "published", published_at: new Date().toISOString(), online_url: url || null })
          .eq("id", latest.id);
      }
    } catch { /* non-blocking */ }
    await logStickerAudit("passport_published", { tenantId, entityType: "passport", entityId: vehicleId, details: { url } });
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "publish_failed" };
  }
}

// Persist structured per-vehicle addendum state into vehicle_addendums (+ items).
// Best-effort: no-ops cleanly when the tables aren't deployed.
export interface AddendumItemInput {
  itemType: "installed" | "benefit" | "available_upgrade";
  name: string;
  price?: string;
  note?: string;
  isSelected?: boolean;
}
export interface SaveAddendumArgs {
  tenantId?: string | null;
  vehicleId?: string | null;
  baseMsrp?: string;
  items: AddendumItemInput[];
}
const num = (v?: string) => Number(String(v || "").replace(/[^0-9.]/g, "")) || 0;

export async function saveAddendumState(args: SaveAddendumArgs): Promise<ApiResult> {
  if (!args.vehicleId || !args.tenantId) return { ok: false, error: "no_vehicle" };
  const client = sb();
  try {
    const installed = args.items.filter((i) => i.itemType === "installed");
    const upgrades = args.items.filter((i) => i.itemType === "available_upgrade");
    const installedTotal = installed.reduce((s, i) => s + num(i.price), 0);
    const availableTotal = upgrades.reduce((s, i) => s + num(i.price), 0);
    const selectedTotal = upgrades.filter((i) => i.isSelected).reduce((s, i) => s + num(i.price), 0);
    const baseMsrp = num(args.baseMsrp);

    const { data: head, error: headErr } = await client
      .from("vehicle_addendums")
      .upsert({
        tenant_id: args.tenantId,
        vehicle_id: args.vehicleId,
        base_msrp: baseMsrp,
        installed_total: installedTotal,
        available_upgrades_total: availableTotal,
        selected_upgrades_total: selectedTotal,
        total_msrp: baseMsrp + installedTotal + selectedTotal,
        status: "draft",
      }, { onConflict: "tenant_id,vehicle_id" })
      .select("id")
      .maybeSingle();
    if (headErr || !head?.id) return { ok: false, error: headErr?.message || "addendum_unavailable" };

    await client.from("vehicle_addendum_items").delete().eq("vehicle_addendum_id", head.id);
    if (args.items.length) {
      await client.from("vehicle_addendum_items").insert(
        args.items.map((i, idx) => ({
          vehicle_addendum_id: head.id,
          item_type: i.itemType,
          name: i.name,
          description: i.note || null,
          price: num(i.price),
          is_installed: i.itemType === "installed",
          is_included: i.itemType === "benefit",
          is_selected: !!i.isSelected,
          display_order: idx,
        })),
      );
    }
    return { ok: true, documentId: head.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "addendum_failed" };
  }
}
