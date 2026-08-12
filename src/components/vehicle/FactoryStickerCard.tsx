import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasWindowStickerPermission } from "@/lib/permissions/windowStickerPermissions";
import { toast } from "sonner";
import {
  AlertTriangle, Download, ExternalLink, FileText, History, Loader2, RefreshCw, ShieldCheck,
} from "lucide-react";
import RegenerateStickerDrawer from "./RegenerateStickerDrawer";
import StickerVersionHistory from "./StickerVersionHistory";
import { useWindowSticker } from "@/hooks/useWindowSticker";
import { promptRegenerationReason } from "@/lib/factorySticker/regenerationReason";
import { freshFiledDocumentAssets } from "@/lib/filedDocumentUrl";

// Factory Build Record card for the Vehicle File's Documents tab. Reads the
// per-vehicle factory_sticker_records row plus its current generated_documents
// artifact, and shows the pipeline state honestly — a draft, failed, or
// review-required record is never presented as a finished document. The
// provider's actual OEM file (vehicle_listings.oem_sticker_url) is listed as a
// separate "Original OEM Window Sticker" row so the two artifacts are never
// conflated.

interface StickerRecord {
  id: string;
  generation_status: string;
  source_classification: string | null;
  confidence_level: string | null;
  verification_status: string | null;
  reconciliation_status: string | null;
  reconciliation_difference: number | null;
  review_required: boolean;
  review_reason: string | null;
  canonical_oem_id: string | null;
  detected_make_value: string | null;
  current_document_id: string | null;
  last_error: string | null;
  published_at: string | null;
  updated_at: string | null;
}

interface StickerDoc {
  id: string;
  version: number;
  document_status: string;
  pdf_url: string | null;
  online_url: string | null;
  published_at: string | null;
  created_at: string | null;
}

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const PILL_TONE: Record<string, string> = {
  emerald: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  blue: "bg-blue-50 text-blue-700",
  rose: "bg-rose-50 text-rose-700",
  slate: "bg-slate-100 text-slate-600",
};

const Pill = ({ tone, children }: { tone: keyof typeof PILL_TONE; children: React.ReactNode }) => (
  <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${PILL_TONE[tone]}`}>{children}</span>
);

const GEN_STATUS: Record<string, { label: string; tone: keyof typeof PILL_TONE }> = {
  PENDING_DATA: { label: "Waiting for build data", tone: "amber" },
  NORMALIZING: { label: "Generating", tone: "blue" },
  VALIDATING: { label: "Generating", tone: "blue" },
  GENERATING: { label: "Generating", tone: "blue" },
  RUNNING_QA: { label: "Generating", tone: "blue" },
  READY_TO_GENERATE: { label: "Queued for rendering", tone: "blue" },
  REVIEW_REQUIRED: { label: "Needs review", tone: "amber" },
  APPROVED: { label: "Approved, not published", tone: "blue" },
  PUBLISHED: { label: "Published", tone: "emerald" },
  FAILED_RETRYABLE: { label: "Failed, will retry", tone: "rose" },
  FAILED_PERMANENT: { label: "Generation failed", tone: "rose" },
  SUPERSEDED: { label: "Superseded", tone: "slate" },
  ARCHIVED: { label: "Archived", tone: "slate" },
};

const CLASSIFICATION_LABEL: Record<string, string> = {
  REGENERATED_RECORD: "Regenerated build record",
  ORIGINAL_OEM_DOCUMENT: "Original OEM document",
  OEM_BUILD_DATA: "OEM build data",
  OEM_INVENTORY_MATCH: "OEM inventory match",
  CONFIGURATION_MATCH: "Configuration match",
  DEALER_VERIFIED: "Dealer verified",
};

const VERIFICATION_LABEL: Record<string, { label: string; tone: keyof typeof PILL_TONE }> = {
  PROVIDER_DECODED: { label: "Provider decoded", tone: "blue" },
  UNVERIFIED_GENERIC: { label: "Generic data", tone: "amber" },
  AUTO_VERIFIED: { label: "Auto verified", tone: "emerald" },
  DEALER_VERIFIED: { label: "Dealer verified", tone: "emerald" },
};

const humanize = (s: string) => s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

export default function FactoryStickerCard({
  vehicleId, tenantId, condition, oemStickerUrl, vin, vehicleLabel,
}: {
  vehicleId: string;
  tenantId: string | null;
  condition: "new" | "used" | "cpo" | null;
  oemStickerUrl: string | null;
  vin?: string | null;
  vehicleLabel?: string | null;
}) {
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const role = member?.role;
  const canRegenerate = hasWindowStickerPermission(role, "window_sticker.regenerate", isAdmin);
  const canHistory = hasWindowStickerPermission(role, "window_sticker.view_history", isAdmin);
  const canRestore = hasWindowStickerPermission(role, "window_sticker.restore_version", isAdmin);
  const canCreate = hasWindowStickerPermission(role, "window_sticker.create", isAdmin);
  const manager = canRegenerate;

  const [record, setRecord] = useState<StickerRecord | null>(null);
  const [doc, setDoc] = useState<StickerDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [regenOpen, setRegenOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { documentAssets } = useWindowSticker();

  const load = useCallback(async () => {
    if (!tenantId) { setLoading(false); return; }
    try {
      // deno-lint-ignore no-explicit-any
      const { data: rec, error } = await (supabase as any)
        .from("factory_sticker_records")
        .select("id, generation_status, source_classification, confidence_level, verification_status, reconciliation_status, reconciliation_difference, review_required, review_reason, canonical_oem_id, detected_make_value, current_document_id, last_error, published_at, updated_at")
        .eq("tenant_id", tenantId)
        .eq("vehicle_id", vehicleId)
        .maybeSingle();
      if (error) throw error;
      setRecord((rec as StickerRecord) || null);
      if (rec?.current_document_id) {
        // deno-lint-ignore no-explicit-any
        const { data: d } = await (supabase as any)
          .from("generated_documents")
          .select("id, version, document_status, pdf_url, online_url, published_at, created_at")
          .eq("id", rec.current_document_id)
          .maybeSingle();
        setDoc((d as StickerDoc) || null);
      } else {
        setDoc(null);
      }
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [tenantId, vehicleId]);

  useEffect(() => { load(); }, [load]);

  // The card thumbnail is the first page of THIS vehicle's own filed
  // document, rendered from the same immutable snapshot as its PDF.
  //
  // Both URLs are minted here rather than read off generated_documents: the
  // stored pdf_url is a seven-day credential, so an untouched sticker's
  // "View PDF" button used to start returning an InvalidJWT page after a
  // week and read as "needs regenerating" when the file had never moved.
  useEffect(() => {
    let cancelled = false;
    setThumbUrl(null);
    setFileUrl(null);
    if (!tenantId || !doc?.id) return;
    const cachedPdf = doc.pdf_url || doc.online_url || null;
    (async () => {
      const assets = await freshFiledDocumentAssets(
        (documentId) => documentAssets(tenantId, vehicleId, documentId),
        doc.id,
        cachedPdf,
      );
      if (cancelled) return;
      setThumbUrl(assets.preview_url);
      setFileUrl(assets.pdf_url);
    })();
    return () => { cancelled = true; };
  }, [tenantId, vehicleId, doc?.id, doc?.pdf_url, doc?.online_url, documentAssets]);

  const regenerate = async (action: "regenerate" | "orchestrate") => {
    if (!tenantId) { toast.error("Vehicle has no tenant"); return; }
    let reason: ReturnType<typeof promptRegenerationReason> = null;
    if (action === "regenerate") {
      reason = promptRegenerationReason();
      if (!reason) { toast.info("Regeneration cancelled — a reason is required."); return; }
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("factory-sticker-orchestrate", {
        body: {
          action, tenant_id: tenantId, vehicle_id: vehicleId,
          app_base: typeof window !== "undefined" ? window.location.origin : undefined,
          ...(reason ? { reason_code: reason.reason_code, reason_notes: reason.reason_notes } : {}),
        },
      });
      const payload = (data || {}) as { success?: boolean; error?: string; status?: string; generated?: boolean; skipped?: string; reused?: boolean };
      if (error || payload.success !== true) {
        const detail = error?.message || payload.error || "generation failed";
        toast.error(/insufficient_permission/i.test(detail)
          ? "Regenerating needs manager authority."
          : `Couldn't regenerate the build record: ${detail}`);
      } else {
        // See FactoryStickerWorkspace: a 200 with generated:false is a
        // skip, not a new version.
        toast.success(
          payload.status === "PUBLISHED" ? "Factory build record regenerated and published."
          : !payload.generated && payload.skipped
            ? `Not generated yet — ${String(payload.skipped).replace(/_/g, " ")}.`
          : "Factory build record regenerated — it is waiting for review.");
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const isNew = condition === "new";
  const title = isNew ? "Factory Window Sticker" : "Original Factory Build & MSRP Record";
  const subtitle = isNew ? "Factory Configuration & MSRP" : "VIN-Specific Factory Configuration When New";
  const status = record ? (GEN_STATUS[record.generation_status] || { label: humanize(record.generation_status), tone: "slate" as const }) : null;
  const verification = record?.verification_status ? VERIFICATION_LABEL[record.verification_status] : null;
  const recon = record?.reconciliation_status || null;
  const reconTone: keyof typeof PILL_TONE =
    recon === "MATCHED" ? "emerald" : recon === "MINOR_VARIANCE" ? "amber" : recon === "REVIEW_REQUIRED" ? "rose" : "slate";
  const docPublished = doc?.document_status === "published";
  const failed = record?.generation_status === "FAILED_RETRYABLE" || record?.generation_status === "FAILED_PERMANENT";

  return (
    <div className="rounded-2xl border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.05)] p-5 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-foreground inline-flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-blue-600" /> Factory Build Record
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Generated automatically from the saved factory build data for this VIN. Review and publishing live in Admin.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/factory-sticker/${vehicleId}`}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs font-semibold hover:bg-muted/40"
          >
            <ExternalLink className="w-3 h-3" /> Open workspace
          </Link>
          {record && canHistory && (
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs font-semibold hover:bg-muted/40"
            >
              <History className="w-3 h-3" /> Versions
            </button>
          )}
          {canRegenerate && record && (
            <button
              type="button"
              onClick={() => setRegenOpen(true)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs font-semibold hover:bg-muted/40 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Regenerate
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-4 bg-muted rounded w-2/3" />
          <div className="h-3 bg-muted rounded w-1/2" />
          <div className="h-8 bg-muted rounded w-40" />
        </div>
      ) : loadError ? (
        <p className="text-xs text-rose-600 inline-flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> Couldn't load the factory build record. Reload the page to retry.
        </p>
      ) : !record ? (
        <div className="rounded-xl border border-dashed border-border p-4 text-center">
          <p className="text-xs font-semibold text-foreground">No factory build record yet.</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            One is created automatically when this vehicle's factory build data arrives at ingest.
          </p>
          {canCreate && (
            <button
              type="button"
              onClick={() => regenerate("orchestrate")}
              disabled={busy || !tenantId}
              className="mt-2.5 inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Generate now
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-background p-3.5 space-y-2">
          {thumbUrl && (
            <a
              href={fileUrl || thumbUrl}
              target="_blank"
              rel="noreferrer"
              className="block rounded-lg border border-border overflow-hidden bg-white hover:border-blue-600 transition-colors"
            >
              <img
                src={thumbUrl}
                alt={`First page of the ${title.toLowerCase()} for this VIN`}
                className="w-full max-w-[280px] h-auto"
                loading="lazy"
              />
            </a>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">{title}</span>
            {doc && <span className="text-[11px] text-muted-foreground">v{doc.version}</span>}
            {status && <Pill tone={status.tone}>{status.label}</Pill>}
          </div>
          <p className="text-[11px] text-muted-foreground">{subtitle}</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {record.source_classification && (
              <Pill tone="slate">{CLASSIFICATION_LABEL[record.source_classification] || humanize(record.source_classification)}</Pill>
            )}
            {verification && <Pill tone={verification.tone}>{verification.label}</Pill>}
            {recon && (
              <Pill tone={reconTone}>
                MSRP {humanize(recon)}
                {record.reconciliation_difference != null && record.reconciliation_difference > 0
                  ? ` (${fmtMoney(record.reconciliation_difference)})` : ""}
              </Pill>
            )}
            {record.confidence_level && <Pill tone="slate">{humanize(record.confidence_level)} confidence</Pill>}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
            {doc?.created_at && <span>Generated {fmtDate(doc.created_at)}</span>}
            {docPublished && doc?.published_at && <span>Published {fmtDate(doc.published_at)}</span>}
            {doc && !docPublished && <span>Not visible to shoppers yet ({humanize(doc.document_status)})</span>}
          </div>
          {failed && record.last_error && (
            <p className="text-[11px] text-rose-600 inline-flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {record.last_error}
            </p>
          )}
          {record.review_required && (
            <p className="text-[11px] text-amber-700 inline-flex items-start gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>
                Needs review{record.review_reason ? `: ${record.review_reason}` : ""}.{" "}
                <Link to="/admin?tab=labels&panel=factory-sticker" className="font-semibold text-blue-600 hover:underline">
                  Review in Admin
                </Link>
              </span>
            </p>
          )}
          <div className="flex items-center gap-2 pt-0.5">
            {fileUrl ? (
              <>
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs font-semibold hover:bg-muted/40"
                >
                  <ExternalLink className="w-3 h-3" /> View
                </a>
                {fileUrl && (
                  <a
                    href={fileUrl}
                    download
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs font-semibold hover:bg-muted/40"
                  >
                    <Download className="w-3 h-3" /> Download
                  </a>
                )}
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground">No file yet — it appears here once rendering finishes.</p>
            )}
          </div>
        </div>
      )}

      {regenOpen && tenantId && (
        <RegenerateStickerDrawer
          tenantId={tenantId}
          vehicleId={vehicleId}
          vehicleLabel={vehicleLabel || title}
          vin={vin || ""}
          currentVersion={doc?.version ?? null}
          currentStatus={doc?.document_status ?? null}
          templateLabel={record?.detected_make_value || record?.canonical_oem_id || null}
          sourceRetrievedAt={record?.updated_at ?? null}
          onClose={() => setRegenOpen(false)}
          onDone={load}
        />
      )}

      {historyOpen && tenantId && (
        <StickerVersionHistory
          tenantId={tenantId}
          vehicleId={vehicleId}
          canRestore={canRestore}
          onClose={() => setHistoryOpen(false)}
          onChanged={load}
        />
      )}

      {oemStickerUrl && (
        <div className="rounded-xl border border-border bg-background p-3.5 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Original OEM Window Sticker</p>
            <p className="text-[11px] text-muted-foreground">The manufacturer's own sticker file from the provider — separate from the generated build record above.</p>
          </div>
          <a
            href={oemStickerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs font-semibold hover:bg-muted/40 shrink-0"
          >
            <ExternalLink className="w-3 h-3" /> View
          </a>
        </div>
      )}
    </div>
  );
}
