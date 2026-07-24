import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, Sparkles, XCircle } from "lucide-react";
import { useDescriptionCase } from "@/hooks/useDescriptionOps";
import { STATUS_META, TONE_CLASS, ELIGIBILITY_META, factConfidenceLabel, type DescriptionStatus } from "@/lib/description/model";

// Vehicle File → Shopper Passport → Merchandising Content.
// Reads the SAME description case the Operations Center uses — there is no
// second description record anywhere in the product.

export default function MerchandisingContentSection({ vehicleId }: { vehicleId: string }) {
  const navigate = useNavigate();
  const { record } = useDescriptionCase(vehicleId);

  if (!record) return <div className="h-32 rounded-2xl border border-border bg-card animate-pulse" />;

  const c = record.caseRow;
  const status = (c?.status ?? "UNINITIALIZED") as DescriptionStatus;
  const meta = STATUS_META[status] ?? STATUS_META.UNINITIALIZED;
  const elig = ELIGIBILITY_META[c?.publication_eligibility ?? "unknown"];
  const conf = factConfidenceLabel(c?.fact_confidence);
  const published = record.versions.find((v) => v.id === c?.published_master_version_id);
  const exceptions = record.exceptions ?? [];

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h3 className="text-[14px] font-bold text-foreground inline-flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-500" /> Merchandising content
        </h3>
        <button onClick={() => navigate(`/description-intelligence/${vehicleId}`)}
          className="h-9 px-3 rounded-lg border border-border text-[12.5px] font-semibold text-foreground hover:border-primary hover:text-primary inline-flex items-center gap-1">
          Open description intelligence <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {!c ? (
        <p className="text-[12.5px] text-muted-foreground">
          No description case yet. Vehicles ingested from the inventory feed initialize automatically; others are picked up by reconciliation.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${TONE_CLASS[meta.tone]}`}>
              {status === "PUBLISHED" ? <CheckCircle2 className="w-3 h-3" />
                : status.startsWith("FAILED") ? <XCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
              {meta.label}
            </span>
            <span className={`inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full border ${TONE_CLASS[elig.tone]}`}>{elig.label}</span>
            <span className={`inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full border ${TONE_CLASS[conf.tone]}`}>Facts {conf.label}</span>
          </div>

          {exceptions.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 mb-3">
              <p className="text-[12px] font-semibold text-amber-900 inline-flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                {exceptions.length} open exception{exceptions.length === 1 ? "" : "s"} — {exceptions[0].title}
              </p>
            </div>
          )}

          {published ? (
            <>
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
                Published version v{published.version_number}
              </p>
              <p className="text-[12.5px] text-foreground leading-relaxed line-clamp-4 whitespace-pre-wrap">{published.content}</p>
              <p className="text-[11px] text-muted-foreground mt-2">
                Updated {new Date(published.created_at).toLocaleString()} · {published.character_count} characters
              </p>
            </>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">
              Nothing is published to the shopper listing yet.
              {c.publication_eligibility === "blocked" && " Blocking findings must be resolved first."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
