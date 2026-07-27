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
import {
  AlertTriangle, CheckCircle2, ExternalLink, Globe, Loader2, RefreshCw,
} from "lucide-react";

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

const STATUS_TONE: Record<string, string> = {
  PUBLISHED: "bg-emerald-50 text-emerald-700",
  APPROVED: "bg-blue-50 text-blue-700",
  REVIEW_REQUIRED: "bg-amber-50 text-amber-700",
  PENDING_DATA: "bg-amber-50 text-amber-700",
  READY_TO_GENERATE: "bg-blue-50 text-blue-700",
  NORMALIZING: "bg-blue-50 text-blue-700",
  VALIDATING: "bg-blue-50 text-blue-700",
  GENERATING: "bg-blue-50 text-blue-700",
  RUNNING_QA: "bg-blue-50 text-blue-700",
  FAILED_RETRYABLE: "bg-rose-50 text-rose-700",
  FAILED_PERMANENT: "bg-rose-50 text-rose-700",
  SUPERSEDED: "bg-slate-100 text-slate-600",
  ARCHIVED: "bg-slate-100 text-slate-600",
};

const RECON_TONE: Record<string, string> = {
  MATCHED: "bg-emerald-50 text-emerald-700",
  MINOR_VARIANCE: "bg-amber-50 text-amber-700",
  REVIEW_REQUIRED: "bg-rose-50 text-rose-700",
  INSUFFICIENT_DATA: "bg-slate-100 text-slate-600",
};

const Pill = ({ tone, children }: { tone: string; children: React.ReactNode }) => (
  <span className={`inline-flex text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap ${tone}`}>{children}</span>
);

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
    setBusy({ id: row.id, action });
    try {
      const { data, error } = await supabase.functions.invoke("factory-sticker-orchestrate", {
        body: {
          action, tenant_id: tenantId, vehicle_id: row.vehicle_id,
          app_base: typeof window !== "undefined" ? window.location.origin : undefined,
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

  const btn = "inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="space-y-3">
      <div id="factory-sticker" className="bg-card rounded-lg p-4 shadow-premium">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
          <div>
            <h4 className="text-sm font-bold text-foreground">Factory Build Records</h4>
            <p className="text-xs text-muted-foreground">
              VIN-specific factory build and MSRP records, generated automatically at ingest. Approve and
              publish decisions need print-approval authority; they run through the sticker orchestrator.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setLoading(true); load(); }}
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-border text-xs font-semibold hover:bg-muted"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="space-y-2 mt-3 animate-pulse">
            {[0, 1, 2].map((i) => <div key={i} className="h-9 bg-muted rounded" />)}
          </div>
        ) : loadError ? (
          <p className="text-xs text-rose-600 mt-3 inline-flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Couldn't load factory build records. Refresh to retry.
          </p>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center mt-3">
            <p className="text-xs font-semibold text-foreground">No factory build records yet.</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Records are created automatically when a vehicle's factory build data arrives at ingest.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[11px] font-semibold text-muted-foreground border-b border-border">
                  <th scope="col" className="px-2.5 py-2">Vehicle</th>
                  <th scope="col" className="px-2.5 py-2">Status</th>
                  <th scope="col" className="px-2.5 py-2">MSRP Reconciliation</th>
                  <th scope="col" className="px-2.5 py-2">Confidence</th>
                  <th scope="col" className="px-2.5 py-2">Review Reason</th>
                  <th scope="col" className="px-2.5 py-2">OEM</th>
                  <th scope="col" className="px-2.5 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const doc = r.current_document_id ? docs[r.current_document_id] : undefined;
                  const previewUrl = doc?.pdf_url || doc?.online_url || null;
                  const rowBusy = busy?.id === r.id;
                  const published = r.generation_status === "PUBLISHED";
                  const canPublish = !!r.current_document_id && !published
                    && !["SUPERSEDED", "ARCHIVED"].includes(r.generation_status);
                  return (
                    <tr key={r.id} className="align-top hover:bg-muted/30 transition-colors">
                      <td className="px-2.5 py-2.5">
                        <Link to={`/vehicle-file/${r.vehicle_id}?tab=documents`} className="font-mono font-semibold text-foreground hover:text-blue-600 hover:underline whitespace-nowrap">
                          {r.vin}
                        </Link>
                        {doc && <p className="text-[10px] text-muted-foreground mt-0.5">v{doc.version} · {humanize(doc.document_status)}</p>}
                      </td>
                      <td className="px-2.5 py-2.5">
                        <Pill tone={STATUS_TONE[r.generation_status] || "bg-slate-100 text-slate-600"}>{humanize(r.generation_status)}</Pill>
                        {r.last_error && ["FAILED_RETRYABLE", "FAILED_PERMANENT"].includes(r.generation_status) && (
                          <p className="text-[10px] text-rose-600 mt-1 max-w-[220px]">{r.last_error}</p>
                        )}
                      </td>
                      <td className="px-2.5 py-2.5">
                        {r.reconciliation_status ? (
                          <>
                            <Pill tone={RECON_TONE[r.reconciliation_status] || "bg-slate-100 text-slate-600"}>{humanize(r.reconciliation_status)}</Pill>
                            {r.reconciliation_difference != null && r.reconciliation_difference > 0 && (
                              <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">off by {fmtMoney(r.reconciliation_difference)}</p>
                            )}
                          </>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2.5 py-2.5">
                        {r.confidence_level ? humanize(r.confidence_level) : "—"}
                        {r.verification_status && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">{humanize(r.verification_status)}</p>
                        )}
                      </td>
                      <td className="px-2.5 py-2.5 max-w-[240px]">
                        {r.review_required
                          ? <span className="text-amber-700">{r.review_reason || "Needs review"}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2.5 py-2.5 whitespace-nowrap">
                        {r.detected_make_value || r.canonical_oem_id || "—"}
                        {r.oem_theme_id && <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{r.oem_theme_id}</p>}
                      </td>
                      <td className="px-2.5 py-2.5">
                        <div className="flex items-center gap-1.5 justify-end flex-wrap">
                          {previewUrl && (
                            <a href={previewUrl} target="_blank" rel="noreferrer" className={`${btn} border-border text-foreground hover:bg-muted`}>
                              <ExternalLink className="w-3 h-3" /> Preview
                            </a>
                          )}
                          {manager && canPublish && (
                            <button type="button" onClick={() => act(r, "approve_publish")} disabled={!!busy}
                              className={`${btn} bg-blue-600 text-white border-blue-600 hover:bg-blue-700`}>
                              {rowBusy && busy?.action === "approve_publish" ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                              Approve &amp; Publish
                            </button>
                          )}
                          {manager && published && (
                            <button type="button" onClick={() => act(r, "unpublish")} disabled={!!busy}
                              className={`${btn} border-amber-200 text-amber-700 hover:bg-amber-50`}>
                              {rowBusy && busy?.action === "unpublish" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Globe className="w-3 h-3" />}
                              Unpublish
                            </button>
                          )}
                          {manager && (
                            <button type="button" onClick={() => act(r, "regenerate")} disabled={!!busy}
                              className={`${btn} border-border text-foreground hover:bg-muted`}>
                              {rowBusy && busy?.action === "regenerate" ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                              Regenerate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!manager && (
              <p className="text-[11px] text-muted-foreground mt-2">
                Publish, unpublish and regenerate need print-approval authority — ask a manager to decide.
              </p>
            )}
          </div>
        )}
      </div>

      <div id="factory-sticker-settings" className="bg-card rounded-lg p-4 shadow-premium">
        <h4 className="text-sm font-bold text-foreground mb-1">Factory Build Record settings</h4>
        <p className="text-xs text-muted-foreground mb-3">
          Store-wide controls for how factory build records are generated and published.
        </p>
        <div className="space-y-3">
          {SETTING_ROWS.map((s) => {
            const on = fs[s.key];
            return (
              <div key={s.key} className="flex items-start justify-between gap-3">
                <div className="pr-2">
                  <p className="text-sm font-semibold text-foreground">{s.title}</p>
                  <p className="text-xs text-muted-foreground">{s.detail}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={s.title}
                  onClick={() => void changeSetting(s.key, !on, s.title)}
                  className={`shrink-0 h-7 w-12 rounded-full transition-colors relative mt-0.5 ${on ? "bg-emerald-600" : "bg-muted"}`}
                >
                  <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
