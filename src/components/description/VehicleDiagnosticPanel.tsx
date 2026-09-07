import { channelMeta } from "@/lib/description/model";

// The expanded diagnostic area. Validator codes, severities, channel keys and
// the raw exception payload live here and only here: the row above this panel
// stays in vehicle language.

export interface DiagnosticException {
  id: string;
  exception_type: string;
  severity: string;
  blocking: boolean;
  status: string;
  title: string;
  summary: string | null;
  channel: string | null;
  created_at: string;
  details_json: unknown;
}

export interface VehicleDiagnosticPanelProps {
  vin: string;
  caseStatus: string | null;
  eligibility: string | null;
  factConfidence: number | null;
  currentSourceVersion: string | null;
  processedSourceVersion: string | null;
  lastRunAt: string | null;
  presentChannels: string[];
  configuredChannels: string[];
  exceptions: DiagnosticException[];
  onOpenRecord: () => void;
  onOpenStudio: () => void;
}

const SEVERITY_CLASS: Record<string, string> = {
  critical: "bg-rose-50 text-rose-700",
  high: "bg-rose-50 text-rose-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-muted text-muted-foreground",
  info: "bg-muted text-muted-foreground",
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Never";

const channelLabel = (key: string) => channelMeta(key)?.label ?? key;

const Field = ({ label, value }: { label: string; value: string }) => (
  <div>
    <dt className="text-al-meta uppercase tracking-wide text-muted-foreground">{label}</dt>
    <dd className="text-al-body text-foreground font-mono break-all">{value}</dd>
  </div>
);

export function VehicleDiagnosticPanel({
  vin, caseStatus, eligibility, factConfidence, currentSourceVersion, processedSourceVersion,
  lastRunAt, presentChannels, configuredChannels, exceptions, onOpenRecord, onOpenStudio,
}: VehicleDiagnosticPanelProps) {
  const missingChannels = configuredChannels.filter((c) => !presentChannels.includes(c));

  return (
    <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-al-card text-foreground">Diagnostic detail</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenRecord}
            className="min-h-[36px] px-3 rounded-lg border border-border bg-card text-al-meta font-semibold text-foreground hover:border-primary"
          >
            Open description record
          </button>
          <button
            type="button"
            onClick={onOpenStudio}
            className="min-h-[36px] px-3 rounded-lg border border-border bg-card text-al-meta font-semibold text-foreground hover:border-primary"
          >
            Open studio
          </button>
        </div>
      </div>

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="VIN" value={vin || "—"} />
        <Field label="Case status code" value={caseStatus || "NO_CASE"} />
        <Field label="Publication eligibility" value={eligibility || "unknown"} />
        <Field label="Fact confidence" value={factConfidence != null ? `${factConfidence}%` : "not evaluated"} />
        <Field label="Source data version" value={currentSourceVersion || "—"} />
        <Field label="Processed version" value={processedSourceVersion || "—"} />
        <Field label="Last orchestrated" value={when(lastRunAt)} />
        <Field label="Open exception events" value={String(exceptions.length)} />
      </dl>

      <div>
        <p className="text-al-meta uppercase tracking-wide text-muted-foreground mb-1.5">Channel variants</p>
        {configuredChannels.length === 0 ? (
          <p className="text-al-body text-muted-foreground">
            No channels are enabled for this dealership yet, so no variants are expected.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {configuredChannels.map((c) => (
              <span
                key={c}
                className={`inline-flex items-center gap-1 text-al-meta font-semibold px-2 py-0.5 rounded-full ${
                  presentChannels.includes(c) ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"
                }`}
              >
                {channelLabel(c)}
                <span className="font-mono">{presentChannels.includes(c) ? "present" : "absent"}</span>
              </span>
            ))}
          </div>
        )}
        {missingChannels.length > 0 && (
          <p className="text-al-meta text-muted-foreground mt-1.5">
            {missingChannels.length} of {configuredChannels.length} enabled channels have no variant on the current master version.
          </p>
        )}
      </div>

      <div>
        <p className="text-al-meta uppercase tracking-wide text-muted-foreground mb-1.5">Exception events</p>
        {exceptions.length === 0 ? (
          <p className="text-al-body text-muted-foreground">No open exception events for this vehicle.</p>
        ) : (
          <ul className="space-y-2">
            {exceptions.map((e) => (
              <li key={e.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-al-body font-semibold text-foreground">{e.title}</p>
                    {e.summary ? <p className="text-al-meta text-muted-foreground mt-0.5">{e.summary}</p> : null}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-al-meta font-semibold px-2 py-0.5 rounded-full ${SEVERITY_CLASS[e.severity] ?? SEVERITY_CLASS.info}`}>
                      {e.severity}
                    </span>
                    {e.blocking && (
                      <span className="text-al-meta font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700">blocking</span>
                    )}
                  </div>
                </div>
                <p className="text-al-meta font-mono text-muted-foreground mt-1.5">
                  {e.exception_type}
                  {e.channel ? ` - ${e.channel}` : ""} - {e.status} - {when(e.created_at)}
                </p>
                <details className="mt-1.5">
                  <summary className="text-al-meta font-semibold text-foreground cursor-pointer">Raw payload</summary>
                  <pre className="mt-1.5 max-h-56 overflow-auto rounded-lg bg-muted p-2 text-al-meta font-mono text-muted-foreground whitespace-pre-wrap break-all">
                    {JSON.stringify(e.details_json ?? {}, null, 2)}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default VehicleDiagnosticPanel;
