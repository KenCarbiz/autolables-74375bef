import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, ChevronRight, History, Pencil, RefreshCw, XCircle } from "lucide-react";
import { useDescriptionCase, useDescriptionPermissions } from "@/hooks/useDescriptionOps";
import { ELIGIBILITY_META, STATUS_META, TONE_CLASS, factConfidenceLabel, type DescriptionStatus } from "@/lib/description/model";
import { Card, EmptyNote, btn, fmtWhen } from "./primitives";

// The vehicle's shopper-facing description, read from the SAME description
// case the Description Operations Center uses — there is no second description
// record. Regenerate runs the real orchestration; editing and the full history
// belong to the Description Intelligence screen.

export const DescriptionCard = ({ vehicleId }: { vehicleId: string }) => {
  const navigate = useNavigate();
  const { record, error, busy, generate } = useDescriptionCase(vehicleId);
  const perms = useDescriptionPermissions();
  const [showHistory, setShowHistory] = useState(false);

  const open = () => navigate(`/description-intelligence/${vehicleId}`);

  const regenerate = async () => {
    const res = await generate("vehicle_file_manual");
    if (!res.ok) { toast.error(res.error || "Could not regenerate the description"); return; }
    if (!res.generated) { toast.message(res.outcome.message); return; }
    toast.success(res.outcome.message);
  };

  if (error) {
    return (
      <Card title="Description">
        <p className="text-al-body text-red-600 inline-flex items-center gap-1.5">
          <XCircle className="w-4 h-4 shrink-0" /> The description record could not be loaded: {error}
        </p>
      </Card>
    );
  }

  if (!record) {
    return (
      <Card title="Description">
        <p className="text-al-body text-muted-foreground">Loading the description record…</p>
      </Card>
    );
  }

  const c = record.caseRow;
  const status = (c?.status ?? "UNINITIALIZED") as DescriptionStatus;
  const meta = STATUS_META[status] ?? STATUS_META.UNINITIALIZED;
  const elig = ELIGIBILITY_META[c?.publication_eligibility ?? "unknown"];
  const conf = factConfidenceLabel(c?.fact_confidence);
  const published = record.versions.find((v) => v.id === c?.published_master_version_id);
  const exceptions = record.exceptions ?? [];
  const latest = record.versions[0];

  const actions = (
    <div className="flex items-center gap-2 flex-wrap">
      <button onClick={open} className={btn} disabled={!perms.canEdit} title={perms.canEdit ? undefined : "Your role cannot edit descriptions"}>
        <Pencil className="w-3.5 h-3.5" /> Edit
      </button>
      <button onClick={regenerate} className={btn} disabled={busy || !perms.canGenerate} title={perms.canGenerate ? undefined : "Your role cannot generate descriptions"}>
        <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} /> {busy ? "Working…" : "Regenerate"}
      </button>
      <button onClick={() => setShowHistory((v) => !v)} className={btn} aria-expanded={showHistory}>
        <History className="w-3.5 h-3.5" /> History
      </button>
    </div>
  );

  return (
    <Card title="Description" action={actions}>
      {!c ? (
        <EmptyNote
          title="No description case for this vehicle yet"
          detail="Vehicles ingested from the inventory feed initialize automatically; others are picked up by reconciliation. Nothing is drafted here until a case exists."
        />
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-al-meta font-semibold px-2 py-0.5 rounded-full border ${TONE_CLASS[meta.tone]}`}>{meta.label}</span>
            <span className={`inline-flex text-al-meta font-semibold px-2 py-0.5 rounded-full border ${TONE_CLASS[elig.tone]}`}>{elig.label}</span>
            <span className={`inline-flex text-al-meta font-semibold px-2 py-0.5 rounded-full border ${TONE_CLASS[conf.tone]}`}>Facts {conf.label}</span>
          </div>

          {exceptions.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-al-body font-semibold text-amber-900 inline-flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {exceptions.length} open exception{exceptions.length === 1 ? "" : "s"} — {String(exceptions[0].title ?? "see Description Intelligence")}
              </p>
            </div>
          )}

          {published ? (
            <div className="space-y-1.5">
              <p className="text-al-meta font-bold uppercase tracking-wider text-muted-foreground">
                Published version v{String(published.version_number)}
              </p>
              <p className="text-al-body text-foreground leading-relaxed line-clamp-5 whitespace-pre-wrap">{String(published.content ?? "")}</p>
              <p className="text-al-meta text-muted-foreground">
                Updated {fmtWhen(String(published.created_at)) ?? "unknown"} · {String(published.character_count ?? 0)} characters
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-al-body text-muted-foreground">
                Nothing is published to the shopper listing yet.
                {c.publication_eligibility === "blocked" && " Blocking findings must be resolved first."}
              </p>
              {latest && (
                <p className="text-al-meta text-muted-foreground">
                  Latest draft v{String(latest.version_number)} · {fmtWhen(String(latest.created_at)) ?? "unknown"}
                </p>
              )}
            </div>
          )}

          {showHistory && (
            <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-1.5">
              {record.versions.length === 0 ? (
                <p className="text-al-body text-muted-foreground">No versions have been produced for this vehicle yet.</p>
              ) : (
                record.versions.slice(0, 8).map((v) => (
                  <div key={String(v.id)} className="flex items-center justify-between gap-3">
                    <span className="text-al-body text-foreground">
                      v{String(v.version_number)}
                      {v.id === c.published_master_version_id ? " · published" : ""}
                    </span>
                    <span className="text-al-meta text-muted-foreground tabular-nums">{fmtWhen(String(v.created_at)) ?? "unknown"}</span>
                  </div>
                ))
              )}
            </div>
          )}

          <button onClick={open} className="text-al-meta font-semibold text-primary inline-flex items-center gap-1 hover:underline">
            Open Description Intelligence <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </Card>
  );
};

export default DescriptionCard;
