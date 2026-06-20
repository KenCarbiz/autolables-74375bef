import { useAuth } from "@/contexts/AuthContext";
import { useDealerDocumentRules } from "@/lib/documentRules";
import { useEffect } from "react";
import { useVehicleDocuments } from "@/lib/stickerStudio/useVehicleDocuments";
import { useVehicleQrScans } from "@/lib/stickerStudio/useQrAnalytics";
import { useVehicleStaleFlags } from "@/lib/stickerStudio/useStaleFlags";
import { reconcileVehicleStale } from "@/lib/stickerStudio/staleDetection";
import { useTenant } from "@/contexts/TenantContext";
import { AlertTriangle } from "lucide-react";
import {
  transitionDocument, STATUS_META, allowedActions,
  type GeneratedDocument, type DocumentAction, type DocumentStatus,
} from "@/lib/stickerStudio/documentWorkflow";
import { FileText, ExternalLink, Printer, Send, Check, X, Globe, Archive, Layers, RefreshCw, QrCode } from "lucide-react";
import { toast } from "sonner";

// Generated-documents manager for the Vehicle File. Lists every sticker /
// addendum / passport doc for the vehicle with its lifecycle status, version,
// and milestone dates, and exposes role-gated lifecycle actions. Internal
// document state only — it never touches the customer signing flow.

const toneClass: Record<string, string> = {
  slate: "bg-slate-100 text-slate-600",
  amber: "bg-amber-50 text-amber-700",
  emerald: "bg-emerald-50 text-emerald-700",
  blue: "bg-blue-50 text-blue-700",
  violet: "bg-violet-50 text-violet-700",
  rose: "bg-rose-50 text-rose-700",
};

const TYPE_LABEL: Record<string, string> = { window: "Window Sticker", addendum: "Addendum", passport: "Vehicle Passport" };
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

const ACTION_META: Record<DocumentAction, { label: string; icon: typeof Check }> = {
  submit:       { label: "Submit for approval", icon: Send },
  approve:      { label: "Approve",             icon: Check },
  reject:       { label: "Reject",              icon: X },
  mark_printed: { label: "Mark printed",        icon: Printer },
  publish:      { label: "Publish",             icon: Globe },
  unpublish:    { label: "Unpublish",           icon: Globe },
  supersede:    { label: "Supersede",           icon: Layers },
  archive:      { label: "Archive",             icon: Archive },
};

export default function GeneratedDocumentsSection({ vehicleId }: { vehicleId: string }) {
  const { user, isAdmin } = useAuth();
  const manager = isAdmin; // managers/admins approve, publish, override; sales generate + submit + print
  const rules = useDealerDocumentRules();
  const { documents, loading, available, reload } = useVehicleDocuments(vehicleId);
  const scans = useVehicleQrScans(vehicleId);
  const { tenant } = useTenant();
  const { flags: staleFlags, reload: reloadStale } = useVehicleStaleFlags(vehicleId);

  // Re-check this vehicle's live data against its printed/published stickers.
  useEffect(() => {
    if (!vehicleId || !tenant?.id) return;
    let done = false;
    (async () => { await reconcileVehicleStale(vehicleId, tenant.id, rules); if (!done) reloadStale(); })();
    return () => { done = true; };
  }, [vehicleId, tenant?.id, rules, reloadStale]);

  // Apply dealer document rules on top of the role-based action set.
  const gatedActions = (status: DocumentStatus): DocumentAction[] =>
    allowedActions(status, manager).filter((a) => {
      if (a === "mark_printed" && !manager && !rules.allowSalesPrintApproved) return false;
      if (a === "publish" && !manager && rules.requireApprovalBeforePublish) return false;
      return true;
    });

  if (loading) return <p className="text-xs text-muted-foreground">Loading documents…</p>;
  if (!available) {
    return (
      <div className="rounded-xl border border-dashed border-border p-4 text-center">
        <FileText className="w-5 h-5 text-muted-foreground/40 mx-auto mb-1.5" />
        <p className="text-xs text-muted-foreground">Document history appears here once the generated_documents migration is applied.</p>
      </div>
    );
  }
  if (documents.length === 0) {
    return <p className="text-xs text-muted-foreground">No documents generated yet. Use a template above to create one.</p>;
  }

  const act = async (doc: GeneratedDocument, action: DocumentAction) => {
    let reason: string | undefined;
    if (action === "reject") {
      reason = window.prompt("Reason for rejection (optional)") || undefined;
    }
    const r = await transitionDocument({ doc, action, actorId: user?.id, reason });
    if (r.ok) { toast.success(`${ACTION_META[action].label} done`); reload(); }
    else toast.error(r.error || "Action failed");
  };

  const openDoc = (doc: GeneratedDocument) => {
    const url = doc.online_url || doc.pdf_url || doc.png_url;
    if (!url) { toast.error("No file URL on this document"); return; }
    window.open(url, "_blank", "noopener");
  };
  // Reprint from the frozen snapshot via the vector print route.
  const printDoc = (doc: GeneratedDocument) => {
    // deno-lint-ignore no-explicit-any
    const snap = (doc as any).data_snapshot;
    if (!snap?.config) { openDoc(doc); return; }
    try {
      const key = `sticker-print-${crypto.randomUUID()}`;
      localStorage.setItem(key, JSON.stringify(snap));
      window.open(`/print/sticker/${snap.config.id}?h=${key}`, "_blank", "noopener");
    } catch { toast.error("Couldn't open print view"); }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">Generated documents</h3>
        <div className="flex items-center gap-3">
          {scans.count > 0 && (
            <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1" title={scans.last ? `Last scan ${new Date(scans.last).toLocaleString()}` : undefined}>
              <QrCode className="w-3 h-3" /> {scans.count} QR {scans.count === 1 ? "scan" : "scans"}
            </span>
          )}
          <button onClick={reload} className="text-[11px] font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Refresh</button>
        </div>
      </div>

      {staleFlags.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700 inline-flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {staleFlags.length} document {staleFlags.length === 1 ? "issue" : "issues"} need review</p>
          <ul className="mt-1 space-y-0.5">
            {staleFlags.slice(0, 4).map((f) => (
              <li key={f.id} className="text-[11px] text-amber-800">· {f.reason} <span className="opacity-70">(was {String(f.old_value)}, now {String(f.new_value)})</span></li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] text-amber-700">Regenerate the sticker from the current data, or resolve in the Document Review queue.</p>
        </div>
      )}

      <div className="space-y-2">
        {documents.map((doc) => {
          const meta = STATUS_META[doc.document_status as DocumentStatus] || STATUS_META.draft;
          const actions = gatedActions(doc.document_status as DocumentStatus);
          return (
            <div key={doc.id} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{TYPE_LABEL[doc.document_type] || doc.document_type}</span>
                    <span className="text-[11px] text-muted-foreground">v{doc.version}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${toneClass[meta.tone]}`}>{meta.label}</span>
                    {doc.label_mode === "black" && <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-900 text-white">Black</span>}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 font-mono truncate">{doc.template_id}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px] text-muted-foreground">
                    <span>Generated {fmtDate(doc.created_at)}</span>
                    {doc.approved_at && <span>Approved {fmtDate(doc.approved_at)}</span>}
                    {doc.printed_at && <span>Printed {fmtDate(doc.printed_at)}{doc.print_count ? ` ·×${doc.print_count}` : ""}</span>}
                    {doc.published_at && <span>Published {fmtDate(doc.published_at)}</span>}
                    {doc.reject_reason && <span className="text-rose-600">Rejected: {doc.reject_reason}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => openDoc(doc)} title="Open" className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"><ExternalLink className="w-3.5 h-3.5" /></button>
                  <button onClick={() => printDoc(doc)} title="Print" className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"><Printer className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              {actions.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border flex flex-wrap gap-1.5">
                  {actions.map((a) => {
                    const am = ACTION_META[a];
                    const Icon = am.icon;
                    const danger = a === "reject" || a === "archive";
                    const primary = a === "approve" || a === "publish";
                    return (
                      <button
                        key={a}
                        onClick={() => act(doc, a)}
                        className={`h-7 px-2.5 rounded-md text-[11px] font-semibold inline-flex items-center gap-1 border ${primary ? "bg-blue-600 text-white border-blue-600 hover:bg-blue-700" : danger ? "border-rose-200 text-rose-600 hover:bg-rose-50" : "border-border text-foreground hover:bg-muted"}`}
                      >
                        <Icon className="w-3 h-3" /> {am.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {!manager && (doc.document_status === "pending_approval") && (
                <p className="mt-1.5 text-[10px] text-amber-600 font-semibold">Requires manager approval</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
