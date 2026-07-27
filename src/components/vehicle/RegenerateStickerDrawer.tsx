import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, RefreshCw, X } from "lucide-react";
import {
  REGENERATION_REASONS, useWindowSticker,
  type RegenerationReasonCode,
} from "@/hooks/useWindowSticker";

// Regeneration is a decision, not a button. The drawer states what is
// currently live, demands a reason, and makes the provider-cost choice
// explicit — the stored response replays for free, a fresh pull may be
// billable. Nothing here replaces the published version: the new draft
// waits for approval.

interface Props {
  tenantId: string;
  vehicleId: string;
  vehicleLabel: string;
  vin: string;
  currentVersion: number | null;
  currentStatus: string | null;
  templateLabel: string | null;
  sourceRetrievedAt: string | null;
  onClose: () => void;
  onDone: () => void;
}

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "unknown";

const Field = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="text-[13px] font-semibold text-foreground truncate">{value}</p>
  </div>
);

export default function RegenerateStickerDrawer({
  tenantId, vehicleId, vehicleLabel, vin, currentVersion, currentStatus,
  templateLabel, sourceRetrievedAt, onClose, onDone,
}: Props) {
  const { busy, regenerate } = useWindowSticker();
  const [reasonCode, setReasonCode] = useState<RegenerationReasonCode | "">("");
  const [notes, setNotes] = useState("");
  const [dataSource, setDataSource] = useState<"reuse" | "refresh">("reuse");
  const [confirmCost, setConfirmCost] = useState(false);

  const isPublished = currentStatus === "published";
  const notesRequired = reasonCode === "other";
  const canSubmit = !!reasonCode && (!notesRequired || notes.trim().length > 0)
    && (dataSource === "reuse" || confirmCost) && !busy;

  const submit = async () => {
    if (!reasonCode) return;
    try {
      const res = await regenerate({
        tenantId, vehicleId, reasonCode, reasonNotes: notes.trim() || null, dataSource,
      });
      if (res.source_refresh && res.source_refresh.ok === false) {
        toast.warning(`Fresh source data could not be retrieved (${res.source_refresh.detail || "provider unavailable"}). Regenerated from the stored response.`);
      }
      toast.success(res.status === "PUBLISHED"
        ? "New version generated and published."
        : `New version generated${res.version ? ` (v${res.version})` : ""} — it is waiting for approval.`);
      onDone();
      onClose();
    } catch (e) {
      const detail = String((e as Error).message || e);
      toast.error(/insufficient_permission/i.test(detail)
        ? "Regenerating needs manager authority."
        : `Couldn't regenerate: ${detail}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Regenerate window sticker">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative h-full w-full max-w-xl bg-background shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-background border-b border-border px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-foreground">Regenerate Window Sticker</h2>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Create a new draft version without replacing the currently published sticker.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-md hover:bg-muted/50" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="rounded-xl border border-border p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="col-span-2 sm:col-span-4">
              <p className="text-[13px] font-bold text-foreground">{vehicleLabel}</p>
            </div>
            <Field label="VIN" value={vin} />
            <Field label="Current version" value={currentVersion ? `v${currentVersion}` : "none"} />
            <Field label="Template" value={templateLabel || "not yet selected"} />
            <Field label="Source data" value={fmtDate(sourceRetrievedAt)} />
          </div>

          {isPublished && (
            <p className="rounded-lg bg-blue-50 text-blue-800 text-[12px] px-3 py-2.5">
              Version {currentVersion} stays live on the Vehicle Passport until the new version is validated and approved.
            </p>
          )}

          <fieldset className="space-y-2">
            <legend className="text-[13px] font-bold text-foreground mb-1">Reason for regeneration</legend>
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
              {REGENERATION_REASONS.map((r) => (
                <label key={r.code} className="flex items-start gap-2 text-[12.5px] text-foreground cursor-pointer">
                  <input
                    type="radio"
                    name="regeneration-reason"
                    value={r.code}
                    checked={reasonCode === r.code}
                    onChange={() => setReasonCode(r.code)}
                    className="mt-0.5"
                  />
                  <span>{r.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="regen-notes" className="text-[13px] font-bold text-foreground">
              Notes {notesRequired ? <span className="text-rose-600">(required)</span> : <span className="font-normal text-muted-foreground">(optional)</span>}
            </label>
            <textarea
              id="regen-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px]"
              placeholder="What changed, and why this version supersedes the last one."
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-[13px] font-bold text-foreground mb-1">Data source</legend>
            <label className={`block rounded-xl border p-3 cursor-pointer ${dataSource === "reuse" ? "border-blue-600 bg-blue-50/50" : "border-border"}`}>
              <span className="flex items-start gap-2">
                <input type="radio" name="regen-source" checked={dataSource === "reuse"} onChange={() => setDataSource("reuse")} className="mt-0.5" />
                <span>
                  <span className="text-[13px] font-semibold text-foreground">Reuse saved NeoVIN data</span>
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">Recommended</span>
                  <span className="block text-[11.5px] text-muted-foreground mt-0.5">
                    No provider charge. Replays the stored response through the current template and renderer.
                  </span>
                </span>
              </span>
            </label>
            <label className={`block rounded-xl border p-3 cursor-pointer ${dataSource === "refresh" ? "border-blue-600 bg-blue-50/50" : "border-border"}`}>
              <span className="flex items-start gap-2">
                <input type="radio" name="regen-source" checked={dataSource === "refresh"} onChange={() => setDataSource("refresh")} className="mt-0.5" />
                <span>
                  <span className="text-[13px] font-semibold text-foreground">Retrieve fresh NeoVIN data</span>
                  <span className="block text-[11.5px] text-amber-700 mt-0.5 inline-flex items-start gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                    May incur a provider charge.
                  </span>
                </span>
              </span>
            </label>
            {dataSource === "refresh" && (
              <label className="flex items-start gap-2 text-[12px] text-foreground pl-1">
                <input type="checkbox" checked={confirmCost} onChange={(e) => setConfirmCost(e.target.checked)} className="mt-0.5" />
                <span>New NeoVIN data are required for this regeneration. I authorize the request and any provider charge.</span>
              </label>
            )}
          </fieldset>

          <ol className="rounded-xl border border-border p-4 space-y-2 text-[12px] text-muted-foreground">
            {[
              "A new data snapshot is captured from the source you selected.",
              "A new draft version is created for your review.",
              "The draft runs the full validation set — reconciliation, QR, barcode and page geometry.",
              "You approve before anything reaches the Vehicle Passport.",
            ].map((step, i) => (
              <li key={step} className="flex gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full bg-muted text-foreground text-[10px] font-bold grid place-items-center">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="sticky bottom-0 bg-background border-t border-border px-5 py-3.5 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-md border border-border text-[13px] font-semibold hover:bg-muted/40">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="h-9 px-4 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold inline-flex items-center gap-2 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Create {currentVersion ? `version ${currentVersion + 1}` : "version 1"} draft
          </button>
        </div>
      </div>
    </div>
  );
}
