import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import {
  useDealerSettings, DEFAULT_FACTORY_STICKER_SETTINGS,
  type FactoryStickerSettings,
} from "@/contexts/DealerSettingsContext";
import { toast } from "sonner";
import { promptRegenerationReason } from "@/lib/factorySticker/regenerationReason";
import { useWindowSticker } from "@/hooks/useWindowSticker";
import { freshFiledDocumentUrl } from "@/lib/filedDocumentUrl";
import { AdminButton, StatusChip, type Tone } from "@/components/admin/v2/primitives";
import { AdminIcon, SectionCard, SwitchField, useIsNarrow } from "@/components/admin/v3/editor";
import { AccordionCard } from "@/pages/admin/views/documents/hub/AccordionCard";
import { StackedRows } from "@/pages/admin/views/documents/hub/StackedRows";

// Factory Build Record review panel (Admin > Label Templates). Tenant-wide
// table of factory_sticker_records with the pipeline state, MSRP
// reconciliation, confidence, review reason and resolved OEM identity, plus
// the manager decisions: Approve & Publish / Unpublish / Regenerate — all
// executed by factory-sticker-orchestrate, which enforces manager authority
// server-side. The settings block writes dealer_profiles.settings
// .factory_sticker through the shared useDealerSettings pattern.

interface RecordRow {
  id: string;
  vehicle_id: string;
  vin: string;
  generation_status: string;
  reconciliation_status: string | null;
  reconciliation_difference: number | null;
  confidence_level: string | null;
  verification_status: string | null;
  review_required: boolean;
  review_reason: string | null;
  canonical_oem_id: string | null;
  detected_make_value: string | null;
  oem_theme_id: string | null;
  current_document_id: string | null;
  last_error: string | null;
  published_at: string | null;
  updated_at: string | null;
}

interface DocRef {
  id: string;
  version: number;
  document_status: string;
  pdf_url: string | null;
  online_url: string | null;
}

const humanize = (s: string) => s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
const fmtMoney = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const statusTone = (s: string): Tone => (s === "PUBLISHED" ? "success" : s.startsWith("FAILED") ? "danger" : ["REVIEW_REQUIRED", "PENDING_DATA"].includes(s) ? "warning" : ["SUPERSEDED", "ARCHIVED"].includes(s) ? "neutral" : "info");
const reconTone = (s: string): Tone => (s === "MATCHED" ? "success" : s === "MINOR_VARIANCE" ? "warning" : s === "REVIEW_REQUIRED" ? "danger" : "neutral");

type RowAction = "approve_publish" | "unpublish" | "regenerate";

const SETTING_ROWS: { key: keyof FactoryStickerSettings; title: string; detail: string }[] = [
  { key: "enabled", title: "Generate factory build records", detail: "Create a VIN-specific factory build record automatically when a vehicle's build data arrives at ingest." },
  { key: "used_reproduction", title: "Manufacturer-style records for used and CPO vehicles", detail: "Supplemental original-equipment history, produced alongside — never instead of — the Buyers Guide and Used Car Sticker. Always carries the AutoLabels reproduction disclosure." },
  { key: "auto_publish_used", title: "Auto-publish for used and CPO vehicles", detail: "Publish a clean, fully reconciled record to the passport without a manager decision." },
  { key: "auto_publish_new", title: "Auto-publish for new vehicles", detail: "New-car records normally wait for manager review before publishing." },
  { key: "show_on_passport", title: "Show on the customer passport", detail: "List the published record on the vehicle's Documents page for shoppers." },
  { key: "show_qr", title: "Include the passport QR", detail: "Print the vehicle passport QR code on the generated record." },
];

export default function FactoryStickerPanel() {
  const { tenant } = useTenant();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const { settings, updateSettings } = useDealerSettings();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const manager = hasDealerCapability(member?.role, "can_approve_print", isAdmin);

  const fs: FactoryStickerSettings = { ...DEFAULT_FACTORY_STICKER_SETTINGS, ...(settings.factory_sticker || {}) };

  const [rows, setRows] = useState<RecordRow[]>([]);
  const [docs, setDocs] = useState<Record<string, DocRef>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<{ id: string; action: RowAction } | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const { documentAssets } = useWindowSticker();

  // generated_documents.pdf_url is a seven-day credential, so a row that has
  // been sitting in this table for a week has a stale one. Signing on click
  // costs one round trip and always opens the file that is actually filed.
  const openPreview = async (vehicleId: string, documentId: string, cached: string | null) => {
    setPreviewing(documentId);
    try {
      const url = await freshFiledDocumentUrl(
        (id) => documentAssets(tenantId!, vehicleId, id),
        documentId,
        cached,
      );
      if (!url) { toast.error("That document's file could not be opened. Try regenerating it."); return; }
      window.open(url, "_blank", "noreferrer");
    } finally {
      setPreviewing(null);
    }
  };

  const load = useCallback(async () => {
    if (!tenantId) { setLoading(false); return; }
    try {
      // deno-lint-ignore no-explicit-any
      const { data, error } = await (supabase as any)
        .from("factory_sticker_records")
        .select("id, vehicle_id, vin, generation_status, reconciliation_status, reconciliation_difference, confidence_level, verification_status, review_required, review_reason, canonical_oem_id, detected_make_value, oem_theme_id, current_document_id, last_error, published_at, updated_at")
        .eq("tenant_id", tenantId)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      const list = (data || []) as RecordRow[];
      setRows(list);
      const docIds = list.map((r) => r.current_document_id).filter((x): x is string => !!x);
      if (docIds.length) {
        // deno-lint-ignore no-explicit-any
        const { data: dd } = await (supabase as any)
          .from("generated_documents")
          .select("id, version, document_status, pdf_url, online_url")
          .in("id", docIds);
        const map: Record<string, DocRef> = {};
        for (const d of (dd || []) as DocRef[]) map[d.id] = d;
        setDocs(map);
      } else {
        setDocs({});
      }
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const act = async (row: RecordRow, action: RowAction) => {
    if (!tenantId) return;
    let reason: ReturnType<typeof promptRegenerationReason> = null;
    if (action === "regenerate") {
      reason = promptRegenerationReason();
      if (!reason) { toast.info("Regeneration cancelled — a reason is required."); return; }
    }
    setBusy({ id: row.id, action });
    try {
      const { data, error } = await supabase.functions.invoke("factory-sticker-orchestrate", {
        body: {
          action, tenant_id: tenantId, vehicle_id: row.vehicle_id,
          app_base: typeof window !== "undefined" ? window.location.origin : undefined,
          ...(reason ? { reason_code: reason.reason_code, reason_notes: reason.reason_notes } : {}),
        },
      });
      const payload = (data || {}) as { success?: boolean; error?: string };
      if (error || payload.success !== true) {
        const detail = error?.message || payload.error || "action failed";
        toast.error(/insufficient_permission/i.test(detail)
          ? "This decision needs manager authority."
          : `Couldn't ${action === "approve_publish" ? "publish" : action} ${row.vin}: ${detail}`);
      } else {
        toast.success(
          action === "approve_publish" ? `${row.vin} approved and published`
          : action === "unpublish" ? `${row.vin} unpublished — back in review`
          : `${row.vin} queued for regeneration`,
        );
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  const changeSetting = async (key: keyof FactoryStickerSettings, next: boolean, title: string) => {
    const ok = await updateSettings({ factory_sticker: { ...fs, [key]: next } });
    if (ok) toast.success(`${title} updated`);
  };

  const narrow = useIsNarrow();
  const btn = "min-h-[44px] sm:min-h-[32px]";
  const refresh = (
    <AdminButton onClick={() => { setLoading(true); load(); }} className="min-h-[44px] sm:min-h-[36px]">
      <AdminIcon name="refresh" /> Refresh
    </AdminButton>
  );

  return (
    <div className="space-y-4">
      <SectionCard
        id="factory-sticker"
        icon="shield-check"
        title="Factory Build Records"
        description="VIN-specific factory build and MSRP records, generated automatically at ingest. Approve and publish decisions need print-approval authority; they run through the sticker orchestrator."
        actions={narrow ? undefined : refresh}
      >
        {narrow && <div>{refresh}</div>}
        {loading ? (
          <div role="status" aria-busy="true" className="space-y-2 animate-pulse motion-reduce:animate-none">
            <span className="sr-only">Loading factory build records</span>
            {[0, 1, 2].map((i) => <div key={i} className="h-10 bg-adm-workspace rounded-md" aria-hidden="true" />)}
          </div>
        ) : loadError ? (
          <p role="alert" className="inline-flex items-center gap-2 text-[14px] leading-[20px] font-medium text-adm-danger">
            <AdminIcon name="alert" /> Couldn't load factory build records. Refresh to retry.
          </p>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-adm-border p-6 text-center">
            <p className="text-[15px] leading-[22px] font-semibold text-adm-ink">No factory build records yet.</p>
            <p className="text-[14px] leading-[20px] text-adm-muted mt-0.5">Records are created automatically when a vehicle's factory build data arrives at ingest.</p>
          </div>
        ) : (
          <>
            <div className="-mx-4 sm:-mx-6">
              <StackedRows
                caption="Factory build records"
                rows={rows}
                rowKey={(r) => r.id}
                columns={[
                  {
                    id: "vehicle",
                    header: "Vehicle",
                    primary: true,
                    cell: (r) => {
                      const doc = r.current_document_id ? docs[r.current_document_id] : undefined;
                      return (
                        <>
                          <Link to={`/vehicle-file/${r.vehicle_id}?tab=documents`} className="inline-flex items-center min-h-[44px] sm:min-h-0 font-mono font-semibold text-adm-primary hover:underline break-all">{r.vin}</Link>
                          {doc && <span className="block text-[13px] leading-[18px] font-normal text-adm-muted">v{doc.version} . {humanize(doc.document_status)}</span>}
                        </>
                      );
                    },
                  },
                  {
                    id: "status",
                    header: "Status",
                    cell: (r) => (
                      <>
                        <StatusChip tone={statusTone(r.generation_status)} className="text-[13px]">{humanize(r.generation_status)}</StatusChip>
                        {r.last_error && ["FAILED_RETRYABLE", "FAILED_PERMANENT"].includes(r.generation_status) && <span className="block mt-1 text-[13px] leading-[18px] text-adm-danger">{r.last_error}</span>}
                      </>
                    ),
                  },
                  {
                    id: "recon",
                    header: "MSRP reconciliation",
                    cell: (r) =>
                      r.reconciliation_status ? (
                        <>
                          <StatusChip tone={reconTone(r.reconciliation_status)} className="text-[13px]">{humanize(r.reconciliation_status)}</StatusChip>
                          {r.reconciliation_difference != null && r.reconciliation_difference > 0 && <span className="block mt-1 text-[13px] leading-[18px] text-adm-muted tabular-nums">Off by {fmtMoney(r.reconciliation_difference)}</span>}
                        </>
                      ) : <span className="text-adm-muted">Not reconciled</span>,
                  },
                  {
                    id: "confidence",
                    header: "Confidence",
                    cell: (r) => (
                      <>
                        {r.confidence_level ? humanize(r.confidence_level) : <span className="text-adm-muted">Not rated</span>}
                        {r.verification_status && <span className="block text-[13px] leading-[18px] text-adm-muted">{humanize(r.verification_status)}</span>}
                      </>
                    ),
                  },
                  { id: "review", header: "Review reason", cell: (r) => (r.review_required ? <span className="text-adm-warning">{r.review_reason || "Needs review"}</span> : <span className="text-adm-muted">None</span>) },
                  {
                    id: "oem",
                    header: "OEM",
                    cell: (r) => (
                      <>
                        {r.detected_make_value || r.canonical_oem_id || <span className="text-adm-muted">Unknown</span>}
                        {r.oem_theme_id && <span className="block font-mono text-[13px] leading-[18px] text-adm-muted break-all">{r.oem_theme_id}</span>}
                      </>
                    ),
                  },
                  {
                    id: "actions",
                    header: "Actions",
                    cell: (r) => {
                      const doc = r.current_document_id ? docs[r.current_document_id] : undefined;
                      const previewUrl = doc?.pdf_url || doc?.online_url || null;
                      const rowBusy = busy?.id === r.id;
                      const published = r.generation_status === "PUBLISHED";
                      const canPublish = !!r.current_document_id && !published && !["SUPERSEDED", "ARCHIVED"].includes(r.generation_status);
                      return (
                        <div className="flex items-center gap-2 flex-wrap">
                          {doc && (
                            <AdminButton size="sm" className={btn} onClick={() => openPreview(r.vehicle_id, doc.id, previewUrl)} disabled={previewing === doc.id}>
                              <AdminIcon name={previewing === doc.id ? "refresh" : "external-link"} /> Preview
                            </AdminButton>
                          )}
                          {manager && canPublish && (
                            <AdminButton size="sm" variant="primary" className={btn} onClick={() => act(r, "approve_publish")} disabled={!!busy}>
                              <AdminIcon name={rowBusy && busy?.action === "approve_publish" ? "refresh" : "check-circle"} /> Approve &amp; Publish
                            </AdminButton>
                          )}
                          {manager && published && (
                            <AdminButton size="sm" className={btn} onClick={() => act(r, "unpublish")} disabled={!!busy}>
                              <AdminIcon name={rowBusy && busy?.action === "unpublish" ? "refresh" : "globe"} /> Unpublish
                            </AdminButton>
                          )}
                          {manager && (
                            <AdminButton size="sm" className={btn} onClick={() => act(r, "regenerate")} disabled={!!busy}>
                              <AdminIcon name="refresh" /> Regenerate
                            </AdminButton>
                          )}
                        </div>
                      );
                    },
                  },
                ]}
              />
            </div>
            {!manager && <p className="text-[13px] leading-[18px] text-adm-muted">Publish, unpublish and regenerate need print-approval authority. Ask a manager to decide.</p>}
          </>
        )}
      </SectionCard>

      <AccordionCard id="factory-sticker-settings" icon="settings" title="Factory Build Record settings" description="Store-wide controls for how factory build records are generated and published." summary={`${SETTING_ROWS.filter((r) => fs[r.key]).length} of ${SETTING_ROWS.length} settings on`}>
        <ul className="grid gap-3 md:grid-cols-2">
          {SETTING_ROWS.map((s) => (
            <li key={s.key} className="rounded-lg border border-adm-divider px-3.5 py-2.5">
              <SwitchField label={s.title} checked={fs[s.key]} onChange={(next) => void changeSetting(s.key, next, s.title)} />
              <p className="ml-[52px] pb-1 text-[13px] leading-[18px] text-adm-muted">{s.detail}</p>
            </li>
          ))}
        </ul>
      </AccordionCard>
    </div>
  );
}
