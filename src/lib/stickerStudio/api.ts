import { supabase } from "@/integrations/supabase/client";
import type { StickerData, StickerBranding, StickerTemplateConfig, StickerRenderOptions } from "./templates";
import { recordUsageEvent } from "@/lib/entitlements/usage";
import { buildPersistenceContext, recordPassportGenerated, recordStickerGenerated } from "@/lib/ctMvp/productionHooks";

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

// The sticker/addendum pages freeze only the identity fields stale detection
// compares (detectStale reads data.{vin,stock,price,msrp,mileage,vehicleTitle});
// Sticker Studio saves the full render state. Both shapes satisfy this input.
export interface SnapshotInput extends Partial<Omit<DocumentSnapshot, "data">> {
  data: Partial<StickerData>;
}

export interface SaveStickerArgs {
  tenantId?: string | null;
  vehicleId?: string | null;
  vin: string;
  templateId: string;
  docType: "window" | "addendum" | "cpo_sheet";
  labelMode?: "white" | "black";
  qrUrl?: string;
  pngDataUrl?: string;
  pdfDataUrl?: string;
  snapshot?: SnapshotInput;
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

  // Resolve the active template_version for this template_key (string id like
  // "window-modern"). Joins sticker_templates → sticker_template_versions to
  // get the latest version. Falls back to 1 for built-in templates.
  let templateVersion = 1;
  try {
    const { data: tpl } = await client
      .from("sticker_templates")
      .select("id")
      .eq("template_key", args.templateId)
      .maybeSingle();
    if (tpl?.id) {
      const { data: ver } = await client
        .from("sticker_template_versions")
        .select("version")
        .eq("template_id", tpl.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ver?.version) templateVersion = ver.version;
    }
  } catch { /* keep default of 1 */ }

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
      const snapshot = {
        ...(args.snapshot || {}),
        template_id: args.templateId,
        template_version: templateVersion,
      };
      const { data: doc, error: insErr } = await client
        .from("generated_documents")
        .insert({
          tenant_id: args.tenantId || null,
          vehicle_id: args.vehicleId,
          template_id: args.templateId,
          template_version: templateVersion,
          document_type: args.docType,
          document_status: "draft",
          version,
          label_mode: args.labelMode || "white",
          pdf_url: args.pdfDataUrl || null,
          png_url: args.pngDataUrl || null,
          online_url: args.qrUrl || null,
          data_snapshot: snapshot,
        })
        .select("id, version")
        .maybeSingle();
      if (!insErr && doc) {
        // Keep one live doc per vehicle + type: supersede prior live versions.
        try {
          await client.from("generated_documents")
            .update({ document_status: "superseded" })
            .eq("vehicle_id", args.vehicleId)
            .eq("document_type", args.docType)
            .neq("id", doc.id)
            .in("document_status", ["draft", "pending_approval", "approved", "printed", "published"]);
        } catch { /* best-effort */ }
        await logStickerAudit("sticker_generated", {
          tenantId: args.tenantId, entityType: args.docType, entityId: doc.id,
          details: { template_id: args.templateId, template_version: templateVersion, version: doc.version, vin: args.vin },
        });
        await recordStickerGenerated({
          tenantId: args.tenantId,
          vehicleId: args.vehicleId,
          vin: args.vin,
          documentType: args.docType,
          templateId: args.templateId,
          documentId: doc.id,
        });
        await recordUsageEvent({ tenantId: args.tenantId, featureKey: args.docType === "window" ? "window_stickers" : args.docType === "cpo_sheet" ? "cpo_sheets" : "addendum_stickers", metric: "stickers_generated", entityType: args.docType, entityId: doc.id });
        return { ok: true, documentId: doc.id, version: doc.version };
      }
    }
  } catch { /* fall through to legacy */ }

  // Fallback path: append a reference to vehicle_listings.documents.
  try {
    const entry = {
      name: `${args.docType === "window" ? "Window Sticker" : args.docType === "cpo_sheet" ? "CPO Sheet" : "Addendum"} · ${args.templateId}`,
      type: "sticker",
      url: args.pdfDataUrl || args.pngDataUrl || "",
      created_at: new Date().toISOString(),
    };
    // Server-side append: the read-then-write this replaces could drop any
    // document attached between the select and the update.
    const { error } = await client.rpc("append_vehicle_document", {
      _vehicle_id: args.vehicleId, _doc: entry,
    });
    if (error) return { ok: false, error: error.message };
    await recordStickerGenerated({
      tenantId: args.tenantId,
      vehicleId: args.vehicleId,
      vin: args.vin,
      documentType: args.docType,
      templateId: args.templateId,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "save_failed" };
  }
}

// Flip a specific generated_documents row to 'published' and set its online URL.
// Called after saveStickerToVehicle() when the listing is already published.
export async function markDocumentPublished(documentId: string, onlineUrl: string): Promise<ApiResult> {
  try {
    const { error } = await sb().from("generated_documents")
      .update({ document_status: "published", published_at: new Date().toISOString(), online_url: onlineUrl })
      .eq("id", documentId);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "mark_published_failed" };
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
      .select("slug, vin")
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
    await recordPassportGenerated(buildPersistenceContext({
      tenantId,
      vehicleId,
      vin: row?.vin,
      stock: row?.stock_number,
    }), { url });
    await recordUsageEvent({ tenantId, featureKey: "vehicle_passport", metric: "documents_published", entityType: "passport", entityId: vehicleId });
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

// ──────────────────────────────────────────────────────────────────────
// Downstream sync — moving a line between Installed Equipment and Available
// Upgrades in the Sticker Studio is a real merchandising decision, so it has to
// reach the two places that act on it: the addendum the customer signs, and the
// get-ready install work. Both are best-effort and never block the save.
// ──────────────────────────────────────────────────────────────────────

export interface LineSyncArgs {
  tenantId?: string | null;
  vin?: string | null;
  installedNames: string[];
  optionalNames: string[];
}

const normalizeName = (name: string) => name.trim().toLowerCase();

/**
 * A signed addendum is an executed legal record: it is never rewritten. When the
 * equipment behind it materially changes, the signed version is preserved and
 * marked "Revised — Signature Required" so a manager sees a new signature is
 * owed. The DB enforces the same rule with a trigger.
 */
async function flagSignedAddendumIfMaterialChange(
  tenantId: string, vin: string, installed: Set<string>, optional: Set<string>,
): Promise<void> {
  try {
    const { data: signed } = await sb()
      .from("addendums")
      .select("id, products_snapshot, revision_required_at")
      .eq("tenant_id", tenantId)
      .eq("vehicle_vin", vin)
      .not("customer_signed_at", "is", null)
      .order("customer_signed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!signed?.id || signed.revision_required_at || !Array.isArray(signed.products_snapshot)) return;

    const drifted = (signed.products_snapshot as { name?: string; badge_type?: string }[]).filter((p) => {
      const key = normalizeName(String(p?.name || ""));
      if (installed.has(key)) return p.badge_type !== "installed";
      if (optional.has(key)) return p.badge_type !== "optional";
      return false;
    });
    if (!drifted.length) return;

    await sb().rpc("flag_addendum_revision", {
      _addendum_id: signed.id,
      _reason: `Equipment status changed after signature: ${drifted.map((p) => p.name).join(", ")}`,
    });
  } catch { /* never block the dealer's save on the revision flag */ }
}

// Re-badge the products on the vehicle's open addendum so the customer signs
// the same installed/optional split shown in the studio. A signed addendum is
// an immutable record — it is never rewritten.
export async function syncAddendumProductBadges(args: LineSyncArgs): Promise<ApiResult> {
  const vin = (args.vin || "").trim().toUpperCase();
  if (!vin || !args.tenantId) return { ok: false, error: "no_vehicle" };
  const installed = new Set(args.installedNames.map(normalizeName));
  const optional = new Set(args.optionalNames.map(normalizeName));
  if (!installed.size && !optional.size) return { ok: true };
  try {
    const { data: row } = await sb()
      .from("addendums")
      .select("id, products_snapshot")
      .eq("tenant_id", args.tenantId)
      .eq("vehicle_vin", vin)
      .is("customer_signed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!row?.id || !Array.isArray(row.products_snapshot)) {
      // No open addendum. If the customer already signed one, the executed
      // record stays exactly as signed — but a material equipment change means
      // it no longer reflects the deal, so it is flagged for re-signature.
      await flagSignedAddendumIfMaterialChange(args.tenantId, vin, installed, optional);
      return { ok: true };
    }

    let changed = false;
    const next = (row.products_snapshot as { name?: string; badge_type?: string }[]).map((product) => {
      const key = normalizeName(String(product?.name || ""));
      const badge = installed.has(key) ? "installed" : optional.has(key) ? "optional" : null;
      if (!badge || badge === product.badge_type) return product;
      changed = true;
      return { ...product, badge_type: badge };
    });
    if (!changed) return { ok: true };

    const { error } = await sb().from("addendums").update({ products_snapshot: next }).eq("id", row.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, documentId: row.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "badge_sync_failed" };
  }
}

export interface GetReadyAccessory { productId: string; productName: string; installed?: boolean }
export interface GetReadyChecklistItem { id: string; label: string; category: string; status: string; assignedTo?: string; department?: string }

// Pure reconciliation between the addendum's installed lines and the get-ready
// accessory list. Two invariants:
//   1. An accessory with installed=true is never retired — the install proof is
//      evidence the part is physically on the car.
//   2. Only accessories this sync created ("addendum:" prefix) are retired, so
//      shop work queued from the product catalog is left alone.
export function reconcileGetReadyAccessories(
  accessories: GetReadyAccessory[],
  items: GetReadyChecklistItem[],
  installedNames: string[],
): { accessories: GetReadyAccessory[]; items: GetReadyChecklistItem[]; added: GetReadyAccessory[]; retired: GetReadyAccessory[] } {
  const wanted = installedNames.map((name) => name.trim()).filter(Boolean);
  const wantedKeys = new Set(wanted.map(normalizeName));
  const isOurs = (a: GetReadyAccessory) => String(a.productId || "").startsWith("addendum:");

  const retired = accessories.filter((a) => isOurs(a) && !a.installed && !wantedKeys.has(normalizeName(a.productName || "")));
  const retiredSet = new Set(retired);
  const kept = accessories.filter((a) => !retiredSet.has(a));

  const existingKeys = new Set(kept.map((a) => normalizeName(a.productName || "")));
  const added = wanted
    .filter((name) => !existingKeys.has(normalizeName(name)))
    .map((name) => ({ productId: `addendum:${normalizeName(name)}`, productName: name, installed: false }));

  const retiredLabels = new Set(retired.map((a) => normalizeName(`Install: ${a.productName}`)));
  const nextItems = items
    .filter((i) => !(i.category === "accessory" && i.status === "pending" && retiredLabels.has(normalizeName(i.label || ""))))
    .concat(added.map((a) => ({
      id: crypto.randomUUID(),
      label: `Install: ${a.productName}`,
      category: "accessory",
      assignedTo: "",
      status: "pending",
      department: "detail",
    })));

  return { accessories: [...kept, ...added], items: nextItems, added, retired };
}

// Queue / retire the matching get-ready install work for the vehicle's record.
export async function syncGetReadyInstalls(args: LineSyncArgs): Promise<ApiResult> {
  const vin = (args.vin || "").trim().toUpperCase();
  if (!vin) return { ok: false, error: "no_vehicle" };
  try {
    const { data: row } = await sb()
      .from("get_ready_records")
      .select("id, items, accessories_to_install")
      .eq("vin", vin)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!row?.id) return { ok: true };

    const next = reconcileGetReadyAccessories(
      Array.isArray(row.accessories_to_install) ? row.accessories_to_install : [],
      Array.isArray(row.items) ? row.items : [],
      args.installedNames,
    );
    if (!next.added.length && !next.retired.length) return { ok: true };

    const { error } = await sb()
      .from("get_ready_records")
      .update({ accessories_to_install: next.accessories, items: next.items })
      .eq("id", row.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, documentId: row.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "get_ready_sync_failed" };
  }
}
