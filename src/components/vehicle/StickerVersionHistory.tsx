import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, History, Loader2, RotateCcw, X } from "lucide-react";
import { useWindowSticker, REGENERATION_REASONS, type StickerVersion } from "@/hooks/useWindowSticker";

// Every version a vehicle's sticker has ever had, newest first. Approved
// versions are preserved, never overwritten: this panel is how an
// authorized user reads and restores them.

interface Props {
  tenantId: string;
  vehicleId: string;
  canRestore: boolean;
  onClose: () => void;
  onChanged: () => void;
}

const REASON_LABEL = new Map(REGENERATION_REASONS.map((r) => [r.code as string, r.label]));

const STATUS_TONE: Record<string, string> = {
  published: "bg-emerald-50 text-emerald-700",
  pending_approval: "bg-amber-50 text-amber-700",
  draft: "bg-slate-100 text-slate-600",
  superseded: "bg-slate-100 text-slate-500",
  archived: "bg-slate-100 text-slate-500",
  rejected: "bg-rose-50 text-rose-700",
};

const humanize = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const fmtWhen = (d?: string | null) =>
  d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : null;

export default function StickerVersionHistory({ tenantId, vehicleId, canRestore, onClose, onChanged }: Props) {
  const { versionHistory, documentAssets, restoreVersion, busy } = useWindowSticker();
  const [versions, setVersions] = useState<StickerVersion[] | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await versionHistory(tenantId, vehicleId);
      setVersions(res.versions);
      setCurrentId(res.current_document_id);
      setError(null);
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  }, [tenantId, vehicleId, versionHistory]);

  useEffect(() => { load(); }, [load]);

  const open = async (documentId: string, download: boolean) => {
    try {
      const assets = await documentAssets(tenantId, vehicleId, documentId);
      if (!assets.pdf_url) { toast.error("That version has no stored PDF."); return; }
      if (download) {
        const a = document.createElement("a");
        a.href = assets.pdf_url;
        a.download = `window-sticker-v${assets.version ?? ""}.pdf`;
        a.click();
      } else {
        window.open(assets.pdf_url, "_blank", "noreferrer");
      }
    } catch (e) {
      toast.error(`Couldn't open that version: ${String((e as Error).message || e)}`);
    }
  };

  const restore = async (documentId: string, version: number) => {
    try {
      await restoreVersion(tenantId, vehicleId, documentId);
      toast.success(`Version ${version} restored as the active draft — approve it to publish.`);
      await load();
      onChanged();
    } catch (e) {
      const detail = String((e as Error).message || e);
      toast.error(/insufficient_permission/i.test(detail)
        ? "Restoring a version needs manager authority."
        : `Couldn't restore that version: ${detail}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Window sticker version history">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative h-full w-full max-w-lg bg-background shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-background border-b border-border px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-foreground inline-flex items-center gap-2">
              <History className="w-4 h-4 text-blue-600" /> Version history
            </h2>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Approved versions are preserved and never overwritten.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-md hover:bg-muted/50" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {error && <p className="text-[12px] text-rose-600">Couldn't load the history: {error}</p>}
          {!versions && !error && (
            <div className="space-y-2 animate-pulse">
              <div className="h-16 bg-muted rounded-xl" />
              <div className="h-16 bg-muted rounded-xl" />
            </div>
          )}
          {versions && versions.length === 0 && (
            <p className="text-[12px] text-muted-foreground">No versions have been generated for this vehicle yet.</p>
          )}
          {versions?.map((v) => (
            <div key={v.id} className={`rounded-xl border p-3.5 space-y-2 ${v.id === currentId ? "border-blue-600" : "border-border"}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-bold text-foreground">Version {v.version}</span>
                <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_TONE[v.status] || "bg-slate-100 text-slate-600"}`}>
                  {humanize(v.status)}
                </span>
                {v.id === currentId && <span className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Active</span>}
              </div>
              <div className="text-[11.5px] text-muted-foreground space-y-0.5">
                {fmtWhen(v.published_at || v.created_at) && (
                  <p>{v.published_at ? "Published" : "Created"} {fmtWhen(v.published_at || v.created_at)}</p>
                )}
                <p>{v.generated_by === "user" ? "Generated manually" : "Generated automatically"}
                  {v.data_source ? ` · ${v.data_source === "refresh" ? "fresh provider data" : "stored provider data"}` : ""}</p>
                {v.reason_code && <p>Reason: {REASON_LABEL.get(v.reason_code) || humanize(v.reason_code)}</p>}
                {v.reason_notes && <p className="italic">"{v.reason_notes}"</p>}
                {v.template_family_id && (
                  <p>Template {v.template_key || v.template_family_id}
                    {v.template_version ? ` v${v.template_version}` : ""}
                    {v.renderer_version ? ` · renderer ${v.renderer_version}` : ""}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap pt-0.5">
                <button type="button" onClick={() => open(v.id, false)} className="h-8 px-3 rounded-md border border-border text-[12px] font-semibold hover:bg-muted/40">
                  View
                </button>
                <button type="button" onClick={() => open(v.id, true)} className="h-8 px-3 rounded-md border border-border text-[12px] font-semibold hover:bg-muted/40 inline-flex items-center gap-1.5">
                  <Download className="w-3 h-3" /> PDF
                </button>
                {canRestore && v.id !== currentId && (
                  <button
                    type="button"
                    onClick={() => restore(v.id, v.version)}
                    disabled={busy}
                    className="h-8 px-3 rounded-md border border-border text-[12px] font-semibold hover:bg-muted/40 inline-flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />} Restore
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
