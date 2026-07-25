import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, Clock, Copy, Download,
  Loader2, Lock, LockOpen, RefreshCw, ShieldCheck, XCircle, History, Save, Link2,
} from "lucide-react";
import { useDescriptionCase, useDescriptionPermissions } from "@/hooks/useDescriptionOps";
import {
  STATUS_META, TONE_CLASS, CHANNEL_META, channelMeta, connectorLabel, ELIGIBILITY_META,
  EXCEPTION_LABELS, FACT_STATUS_META, factConfidenceLabel, LIFECYCLE_STEPS, lifecycleIndex,
  type DescriptionStatus,
} from "@/lib/description/model";
import { toast } from "sonner";

// /description-intelligence/:vehicleId — the operational record for one VIN.
// Everything shown here is stored server-side; no state is manufactured in the
// browser and no action reports success unless the server confirmed it.

const Pill = ({ tone, children }: { tone: keyof typeof TONE_CLASS; children: React.ReactNode }) => (
  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${TONE_CLASS[tone]}`}>{children}</span>
);

const Card = ({ title, children, action }: { title?: string; children: React.ReactNode; action?: React.ReactNode }) => (
  <div className="rounded-2xl border border-border bg-card p-4">
    {title && (
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-[13px] font-bold text-foreground">{title}</h2>
        {action}
      </div>
    )}
    {children}
  </div>
);

const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString() : "—");

export default function DescriptionIntelligence() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const perms = useDescriptionPermissions();
  const {
    record, busy, error, generate, publishInternally, saveManualVersion,
    setChannelLock, setMasterLock, approveVersion, resolveException,
  } = useDescriptionCase(vehicleId);

  const [tab, setTab] = useState<"master" | "channels" | "history">("master");
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [openChannel, setOpenChannel] = useState<string | null>(null);
  const [mobileSection, setMobileSection] = useState<string | null>("master");
  const [regenChannels, setRegenChannels] = useState<string[]>([]);
  const [showLineage, setShowLineage] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const caseRow = record?.caseRow;
  const vehicle = record?.vehicle;
  const versions = record?.versions ?? [];
  const current = useMemo(
    () => versions.find((v) => v.id === selectedVersionId) ?? versions[0] ?? null,
    [versions, selectedVersionId],
  );
  const snapshot = record?.snapshot;
  const facts = (snapshot?.facts_json ?? {}) as Record<string, any>;
  const findings = (record?.findings ?? []).filter((f) => !current || f.version_id === current.id);
  const blockingFindings = findings.filter((f) => f.blocking);
  const warnings = findings.filter((f) => f.severity === "warning");
  const exceptions = record?.exceptions ?? [];
  // Prefer a TYPED conflict (one that names the disputed field) over the
  // generic VALIDATION_FAILED that is raised alongside it. Picking by recency
  // would target the generic one, whose details carry no field — the override
  // would be written under a key nothing reads and the real conflict would
  // stay open forever.
  const blockingException =
    exceptions.find((e) => e.blocking && e.details_json?.field)
    ?? exceptions.find((e) => e.blocking && Array.isArray(e.details_json?.values))
    ?? exceptions.find((e) => e.blocking);

  const status = (caseRow?.status ?? "UNINITIALIZED") as DescriptionStatus;
  const meta = STATUS_META[status] ?? STATUS_META.UNINITIALIZED;
  const elig = ELIGIBILITY_META[caseRow?.publication_eligibility ?? "unknown"] ?? ELIGIBILITY_META.unknown;
  const conf = factConfidenceLabel(caseRow?.fact_confidence);
  const stepIdx = lifecycleIndex(status);
  const isPublished = caseRow?.published_master_version_id === current?.id;
  const isApproved = current?.approval_status === "approved";

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => {
    const res = await fn();
    if (!res.ok) { toast.error(res.error || "Action failed"); return false; }
    toast.success(okMsg);
    return true;
  };

  const doGenerate = async (channels?: string[]) => {
    const res = await generate("manual_regenerate", channels);
    if (!res.ok) { toast.error(res.error || "Action failed"); return false; }
    // the server tells us whether a version was actually produced
    toast.success(res.generated === false
      ? "Nothing to regenerate — the vehicle data has not changed"
      : channels?.length ? `Regenerated ${channels.length} channel${channels.length === 1 ? "" : "s"}` : "New version generated");
    return true;
  };
  const doPublish = async () => {
    if (!current) return;
    await act(() => publishInternally(current.id), "Published internally to the shopper listing");
  };
  const doSave = async () => {
    if (draft == null) return;
    const reason = window.prompt("Reason for this edit (recorded in history)") || "manual edit";
    const ok = await act(() => saveManualVersion(draft, reason), "Saved as a new version and validated");
    if (ok) setDraft(null);
  };

  const copyText = async (content: string, label: string) => {
    try { await navigator.clipboard.writeText(content); toast.success(`${label} copy copied`); }
    catch { toast.error("Clipboard unavailable"); }
  };
  const downloadText = (content: string, label: string) => {
    const blob = new Blob([content], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(vehicle?.vin || "vehicle")}-${label.replace(/\s+/g, "-").toLowerCase()}.txt`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  if (error) {
    return (
      <div className="max-w-[1480px] mx-auto p-6">
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <XCircle className="w-9 h-9 text-red-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-foreground">Could not load this description record.</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="max-w-[1480px] mx-auto p-4 sm:p-6">
        <div className="h-8 w-52 rounded-lg bg-muted animate-pulse mb-4" />
        <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)_320px] gap-4">
          <div className="h-[420px] rounded-2xl border border-border bg-card animate-pulse" />
          <div className="h-[520px] rounded-2xl border border-border bg-card animate-pulse" />
          <div className="h-[420px] rounded-2xl border border-border bg-card animate-pulse" />
        </div>
      </div>
    );
  }

  const conflictField = blockingException
    ? String(blockingException.details_json?.field || blockingException.exception_type)
    : "";
  const conflictLabel = conflictField.replace(/^equipment:/, "");
  const conflictValues: Array<any> = Array.isArray(blockingException?.details_json?.values)
    ? blockingException!.details_json.values : [];
  const affectedSentence = (current?.content || "")
    .split(/(?<=[.!?])\s+/)
    .find((s: string) => conflictLabel && s.toLowerCase().includes(conflictLabel.toLowerCase()));

  // ── Vehicle identity + trusted facts (left) ────────────────────────
  const identity = (
    <div className="space-y-4">
      <Card title="Vehicle Identity">
        {vehicle?.hero_image_url && (
          <img src={vehicle.hero_image_url} alt="" className="w-full aspect-[16/10] object-cover rounded-xl border border-border mb-3" />
        )}
        <p className="text-[15px] font-bold text-foreground leading-tight">{vehicle?.ymm || "Vehicle"}</p>
        <p className="text-[12.5px] text-muted-foreground">{vehicle?.trim || "—"}</p>
        <dl className="mt-3 space-y-1.5 text-[12px]">
          {[["Stock #", (vehicle?.mc_attributes || {}).stock_no || "—"],
            ["VIN", vehicle?.vin || "—"],
            ["Mileage", vehicle?.mileage ? `${Number(vehicle.mileage).toLocaleString()} mi` : "—"],
            ["Condition", String(vehicle?.condition || "—").toUpperCase()],
          ].map(([k, v]) => (
            <div key={k as string} className="flex items-start justify-between gap-2">
              <dt className="text-muted-foreground shrink-0">{k}</dt>
              <dd className="text-foreground font-medium text-right break-all">{v as string}</dd>
            </div>
          ))}
          <div className="flex items-start justify-between gap-2 pt-1.5 border-t border-border">
            <dt className="text-muted-foreground shrink-0">Source Freshness</dt>
            <dd className="text-foreground font-medium text-right">
              {fmt(vehicle?.enriched_at)}
              {vehicle?.feed_source ? <span className="block text-[11px] text-muted-foreground">({vehicle.feed_source} sync)</span> : null}
            </dd>
          </div>
        </dl>
      </Card>

      <Card title="Trusted Vehicle Facts">
        {Object.keys(facts).length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No fact snapshot yet. Generate a description to build one.</p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {Object.values(facts).slice(0, 12).map((f: any) => {
                const fm = FACT_STATUS_META[f.status] ?? FACT_STATUS_META.pending;
                return (
                  <li key={f.field} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="text-foreground capitalize truncate inline-flex items-center gap-1.5 min-w-0">
                      {f.status === "verified"
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        : <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                      <span className="truncate">{String(f.field).replace(/_/g, " ")}</span>
                    </span>
                    <Pill tone={fm.tone}>{fm.label}</Pill>
                  </li>
                );
              })}
            </ul>
            <button onClick={() => setShowLineage((v) => !v)}
              className="mt-3 text-[12px] font-semibold text-primary inline-flex items-center gap-1 min-h-[44px]">
              <Link2 className="w-3.5 h-3.5" /> {showLineage ? "Hide Source Lineage" : "View Source Lineage"}
            </button>
            {showLineage && (
              <ul className="mt-1 space-y-1.5 border-t border-border pt-2.5">
                {Object.values(facts).map((f: any) => (
                  <li key={`lin-${f.field}`} className="text-[11px]">
                    <span className="font-semibold text-foreground capitalize">{String(f.field).replace(/_/g, " ")}</span>
                    <span className="block text-muted-foreground">
                      {String(f.value).slice(0, 60)} · source {f.source} · {f.status}
                      {f.observed_at ? ` · ${new Date(f.observed_at).toLocaleDateString()}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {Object.keys((snapshot?.market_context_json ?? {})).length > 0 && (
          <p className="mt-3 pt-3 border-t border-border text-[11px] text-muted-foreground">
            Market value and comparables are <b>calculated market analysis</b>, not verified vehicle facts. They never become a claim about this vehicle.
          </p>
        )}
      </Card>
    </div>
  );

  // ── Exception review (mockup screen 03) ────────────────────────────
  const exceptionBanner = blockingException && (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-[14px] font-bold text-amber-900">
          Review required — {(EXCEPTION_LABELS[blockingException.exception_type] || "exception").toLowerCase()}.
        </p>
        <p className="text-[12.5px] text-amber-800 mt-0.5">
          {blockingException.summary || "Resolve the conflict below to remove the block for this vehicle."}
        </p>
      </div>
    </div>
  );

  const conflictCard = blockingException && (
    <Card>
      <h2 className="text-[14px] font-bold text-foreground">Source Conflict: {conflictLabel}</h2>
      <p className="text-[12px] text-muted-foreground mt-0.5 mb-3">The following sources disagree on this claim.</p>

      {conflictValues.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {conflictValues.map((v: any, i: number) => {
            const notListed = String(v.value).toLowerCase().includes("not listed");
            return (
              <div key={i} className={`rounded-xl border p-3 ${notListed ? "border-rose-200 bg-rose-50/60" : "border-emerald-200 bg-emerald-50/60"}`}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-[12px] font-bold text-foreground capitalize">{String(v.source).replace(/_/g, " ")}</p>
                  <Pill tone={notListed ? "red" : "emerald"}>{notListed ? "Not confirmed" : "Included"}</Pill>
                </div>
                <p className="text-[11px] text-muted-foreground">Claim</p>
                <p className="text-[12.5px] text-foreground mb-1.5">{notListed ? conflictLabel : String(v.value)}</p>
                <p className="text-[11px] text-muted-foreground">Source</p>
                <p className="text-[12px] text-foreground mb-1.5 capitalize">{String(v.source).replace(/_/g, " ")}</p>
                <p className="text-[11px] text-muted-foreground">Last Updated</p>
                <p className="text-[12px] text-foreground">{fmt(snapshot?.created_at)}</p>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[12px] text-amber-900 inline-flex items-center gap-1.5 w-full">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Claim excluded from customer description until resolved.
      </p>

      <h3 className="text-[13px] font-bold text-foreground mt-4 pt-4 border-t border-border">Choose Resolution</h3>
      <p className="text-[12px] text-muted-foreground mt-0.5 mb-2">How would you like to resolve this source conflict?</p>
      {perms.canResolve ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {([
            ["Confirm Included", "Include in description", "emerald",
              () => resolveException(blockingException.id, conflictField, "include", true), "Resolved — regenerating"],
            ["Confirm Not Included", "Exclude from description", "rose",
              () => resolveException(blockingException.id, conflictField, "exclude", true), "Resolved — regenerating"],
            ["Keep Excluded", "Keep current exclusion", "slate",
              () => resolveException(blockingException.id, conflictField, "exclude", false), "Kept excluded"],
          ] as const).map(([title, sub, tone, fn, msg]) => (
            <button key={title} disabled={busy} onClick={() => act(fn as any, msg as string)}
              className={`min-h-[72px] px-3 py-2 rounded-xl border text-center disabled:opacity-60 ${
                tone === "emerald" ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                : tone === "rose" ? "border-rose-300 bg-rose-50 text-rose-800"
                : "border-border bg-card text-foreground"}`}>
              <span className="block text-[12.5px] font-semibold">{title}</span>
              <span className="block text-[11px] opacity-80 mt-0.5">{sub}</span>
            </button>
          ))}
          <button disabled={busy}
            onClick={() => act(async () => {
              await navigator.clipboard.writeText(
                `Verify ${conflictLabel} on VIN ${vehicle?.vin} (stock ${(vehicle?.mc_attributes || {}).stock_no || "—"}).`,
              ).catch(() => undefined);
              return { ok: true };
            }, "Verification request copied for the data team")}
            className="min-h-[72px] px-3 py-2 rounded-xl border border-blue-300 bg-blue-50 text-blue-800 text-center disabled:opacity-60">
            <span className="block text-[12.5px] font-semibold">Request Verification</span>
            <span className="block text-[11px] opacity-80 mt-0.5">Open with data team</span>
          </button>
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">Resolving a source conflict requires manager permission.</p>
      )}
    </Card>
  );

  // Right rail while a blocking exception is open (mockup screen 03)
  const exceptionRail = blockingException && (
    <div className="space-y-4">
      <Card>
        <h2 className="text-[13px] font-bold text-foreground inline-flex items-center gap-2">
          Blocking Findings
          <span className="w-5 h-5 grid place-items-center rounded-full bg-red-100 text-red-700 text-[11px] font-bold">
            {Math.max(blockingFindings.length, 1)}
          </span>
        </h2>
        <p className="text-[12px] text-foreground mt-2">{blockingException.title}</p>
        <p className="text-[11.5px] text-muted-foreground">Must be resolved to publish.</p>
      </Card>

      <Card title="Publication Status">
        <p className="text-[18px] font-bold text-red-600 leading-none">Blocked</p>
        <p className="text-[11.5px] text-muted-foreground mt-1">All publications are blocked until resolved.</p>
      </Card>

      <Card title="Current Version">
        <p className="text-[13px] font-bold text-foreground">v{current?.version_number ?? "—"}</p>
        <p className="text-[11.5px] text-muted-foreground">Last generated: {fmt(current?.created_at)}</p>
      </Card>

      {affectedSentence && (
        <Card title="Affected Sentence (Excluded)">
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[12px] text-amber-900 leading-relaxed">
            {affectedSentence}
          </p>
        </Card>
      )}

      <Card title="Audit Timeline">
        <ol className="space-y-2.5 relative">
          <span aria-hidden className="absolute left-[3px] top-2 bottom-2 w-px bg-border" />
          {[["Conflict detected", snapshot?.created_at],
            ["AutoLabels validation", current?.created_at],
            ["Review required", blockingException.created_at]].map(([label, when]) => (
            <li key={label as string} className="flex items-start gap-2.5 relative">
              <span className="w-[7px] h-[7px] rounded-full bg-amber-500 mt-1.5 shrink-0 ring-2 ring-card z-10" />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-semibold text-foreground">{label as string}</span>
                <span className="block text-[11px] text-muted-foreground">{fmt(when as string)}</span>
              </span>
            </li>
          ))}
        </ol>
      </Card>

      {perms.canResolve && (
        <button disabled={busy}
          onClick={() => act(() => resolveException(blockingException.id, conflictField, "exclude", true), "Resolved — regenerating")}
          className="w-full min-h-[44px] rounded-xl bg-primary text-primary-foreground text-[13.5px] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Resolve &amp; Regenerate
        </button>
      )}
    </div>
  );

  // ── Center workspace ───────────────────────────────────────────────
  const workspace = (
    <div className="space-y-4">
      <Card title="Lifecycle Status" action={
        versions.length > 0 ? (
          <label className="inline-flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Version</span>
            <select value={current?.id ?? ""} onChange={(e) => { setSelectedVersionId(e.target.value); setDraft(null); }}
              aria-label="Select version"
              className="min-h-[44px] px-2.5 rounded-lg border border-border bg-card text-[12.5px] font-medium">
              {versions.map((v, i) => (
                <option key={v.id} value={v.id}>{v.version_number}{i === 0 ? " (Latest)" : ""}</option>
              ))}
            </select>
          </label>
        ) : undefined
      }>
        <div className="inline-flex items-center gap-2">
          {status === "PUBLISHED" || status === "READY"
            ? <CheckCircle2 className="w-6 h-6 text-emerald-600" />
            : status.startsWith("FAILED") ? <XCircle className="w-6 h-6 text-red-500" />
            : <Clock className="w-6 h-6 text-amber-500" />}
          <div>
            <p className={`text-[17px] font-bold leading-tight ${
              status === "READY" ? "text-emerald-700" : status === "PUBLISHED" ? "text-emerald-700"
              : status.startsWith("FAILED") ? "text-red-600" : "text-foreground"}`}>
              {status === "READY" ? "Ready to Publish" : meta.label}
            </p>
            <p className="text-[11.5px] text-muted-foreground">
              {status === "READY" ? "All validations passed. Eligible for internal publication." : meta.help}
            </p>
          </div>
        </div>
      </Card>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-1 border-b border-border px-2 overflow-x-auto" role="tablist">
          {([["master", "Master Description"], ["channels", "Channel Variants"], ["history", "Version History"]] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`min-h-[44px] px-3.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap ${
                tab === k ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="p-4">
          {tab === "master" && (
            !current ? (
              <div className="text-center py-8">
                <p className="text-sm font-semibold text-foreground">No description has been generated yet.</p>
                <p className="text-xs text-muted-foreground mt-1">New vehicles generate automatically at ingest.</p>
                {perms.canGenerate && (
                  <button onClick={() => doGenerate()} disabled={busy}
                    className="mt-3 min-h-[44px] px-4 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Generate Now
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                  <h3 className="text-[12px] font-bold text-foreground">Canonical Master Description</h3>
                  <div className="inline-flex items-center gap-1.5">
                    {caseRow?.master_locked && <Pill tone="amber"><Lock className="w-3 h-3" /> Locked</Pill>}
                    {isApproved && <Pill tone="emerald">Approved</Pill>}
                  </div>
                </div>
                <p className="text-[11.5px] text-muted-foreground mb-2">
                  v{current.version_number} · {current.character_count} chars · {current.created_by_type === "user" ? "manual edit" : "generated"} · {fmt(current.created_at)}
                </p>
                <textarea
                  value={draft ?? current.content}
                  onChange={(e) => setDraft(e.target.value)}
                  readOnly={!perms.canEdit}
                  aria-label="Master description"
                  className="w-full min-h-[240px] rounded-xl border border-border bg-background p-3 text-[13.5px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {perms.canEdit && draft != null && draft !== current.content && (
                    <button onClick={doSave} disabled={busy}
                      className="min-h-[44px] px-4 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save As New Version
                    </button>
                  )}
                  {perms.canGenerate && (
                    <button onClick={() => doGenerate()} disabled={busy}
                      className="min-h-[44px] px-4 rounded-lg border border-border text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Regenerate
                    </button>
                  )}
                  <button onClick={() => copyText(draft ?? current.content, "Master")}
                    className="min-h-[44px] px-3.5 rounded-lg border border-border text-[13px] font-semibold inline-flex items-center gap-1.5">
                    <Copy className="w-4 h-4" /> Copy
                  </button>
                  {perms.canLock && (
                    <button onClick={() => act(() => setMasterLock(!caseRow?.master_locked, "manual edit protected"),
                      caseRow?.master_locked ? "Master unlocked" : "Master locked")}
                      className="min-h-[44px] px-3.5 rounded-lg border border-border text-[13px] font-semibold inline-flex items-center gap-1.5">
                      {caseRow?.master_locked ? <><LockOpen className="w-4 h-4" /> Unlock</> : <><Lock className="w-4 h-4" /> Lock</>}
                    </button>
                  )}
                </div>
              </>
            )
          )}

          {tab === "channels" && (
            record.channels.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground py-6 text-center">No channel variants yet.</p>
            ) : (
              <div className="space-y-2">
                {record.channels.map((cv) => {
                  const cm = channelMeta(cv.channel);
                  const conn = connectorLabel(cm);
                  const open = openChannel === cv.id;
                  return (
                    <div key={cv.id} className="rounded-xl border border-border">
                      <button onClick={() => setOpenChannel(open ? null : cv.id)} aria-expanded={open}
                        className="w-full flex items-center gap-2.5 p-3 text-left min-h-[52px]">
                        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
                        <span className="text-[13px] font-semibold text-foreground flex-1 min-w-0 truncate">{cm?.label || cv.channel}</span>
                        {cv.locked && <Pill tone="amber"><Lock className="w-3 h-3" /> Locked</Pill>}
                        {cv.potentially_stale && <Pill tone="amber">Stale</Pill>}
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">{cv.character_count}/{cv.character_limit}</span>
                        <Pill tone={conn.tone}>{conn.label}</Pill>
                      </button>
                      {open && (
                        <div className="px-3 pb-3 border-t border-border pt-3">
                          {cv.seo_title && <p className="text-[12px] mb-1"><b>SEO title:</b> {cv.seo_title}</p>}
                          {cv.meta_description && <p className="text-[12px] mb-2"><b>Meta:</b> {cv.meta_description}</p>}
                          <p className="text-[13px] text-foreground whitespace-pre-wrap leading-relaxed">{cv.content}</p>
                          {cm?.deliveryMode !== "internal_projection" && (
                            <p className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2.5">
                              {cm?.connectorStatus === "not_configured"
                                ? "No connector is configured for this destination. AutoLabels cannot deliver here — copy or download the text to publish it manually."
                                : "Export only. AutoLabels does not deliver to this destination automatically."}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                            <button onClick={() => copyText(cv.content, cm?.label || cv.channel)}
                              className="min-h-[44px] px-3 rounded-lg border border-border text-[12px] font-semibold inline-flex items-center gap-1.5">
                              <Copy className="w-3.5 h-3.5" /> Copy
                            </button>
                            <button onClick={() => downloadText(cv.content, cm?.label || cv.channel)}
                              className="min-h-[44px] px-3 rounded-lg border border-border text-[12px] font-semibold inline-flex items-center gap-1.5">
                              <Download className="w-3.5 h-3.5" /> Download
                            </button>
                            {perms.canLock && (
                              <button onClick={() => act(() => setChannelLock(cv.id, !cv.locked, "manual edit protected"), cv.locked ? "Channel unlocked" : "Channel locked")}
                                className="min-h-[44px] px-3 rounded-lg border border-border text-[12px] font-semibold inline-flex items-center gap-1.5">
                                {cv.locked ? <><LockOpen className="w-3.5 h-3.5" /> Unlock</> : <><Lock className="w-3.5 h-3.5" /> Lock</>}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}

          {tab === "history" && (
            versions.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground py-6 text-center">No versions yet.</p>
            ) : (
              <ul className="space-y-2">
                {versions.map((v) => (
                  <li key={v.id} className={`rounded-xl border p-3 ${v.id === current?.id ? "border-primary bg-primary/[0.03]" : "border-border"}`}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-[12.5px] font-semibold text-foreground">
                        v{v.version_number} · {v.version_type}
                        {caseRow?.published_master_version_id === v.id && <span className="ml-2"><Pill tone="emerald">Published</Pill></span>}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{fmt(v.created_at)}</p>
                    </div>
                    <p className="text-[11.5px] text-muted-foreground mt-1">
                      {v.character_count} chars · {v.created_by_type === "user" ? "manual" : "automation"}
                      {v.edit_reason ? ` · ${v.edit_reason}` : ""} · validation {v.validation_status}
                    </p>
                    {v.id !== current?.id && (
                      <button onClick={() => { setSelectedVersionId(v.id); setDraft(null); setTab("master"); }}
                        className="mt-2 min-h-[44px] px-3 rounded-lg border border-border text-[12px] font-semibold inline-flex items-center gap-1">
                        <History className="w-3.5 h-3.5" /> View This Version
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      </div>

      <Card title="Validation Findings" action={
        findings.length > 0 ? (
          <span className="text-[12px] font-semibold text-muted-foreground">
            {blockingFindings.length} blocking · {warnings.length} warning
          </span>
        ) : undefined
      }>
        {findings.length === 0 ? (
          <p className="text-[12.5px] text-emerald-700 inline-flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> No blocking issues.
          </p>
        ) : (
          <ul className="space-y-2">
            {findings.map((f) => (
              <li key={f.id} className="flex items-start gap-2.5">
                {f.blocking ? <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  : f.severity === "warning" ? <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  : <CheckCircle2 className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />}
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold text-foreground">{f.message}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {f.validator_code}{f.blocking ? " · blocks publication" : " · does not block"}
                    {f.source_reference ? ` · ${f.source_reference}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Selective regeneration — rebuild only what changed */}
      {perms.canGenerate && record.channels.length > 0 && (
        <Card title="Selective Regeneration">
          <p className="text-[12px] text-muted-foreground -mt-2 mb-2.5">Regenerate content for the selected channels.</p>
          <div className="flex items-center gap-3 flex-wrap">
            {CHANNEL_META.map((cm) => (
              <label key={cm.key} className="inline-flex items-center gap-1.5 text-[12px] text-foreground min-h-[44px]">
                <input type="checkbox" checked={regenChannels.includes(cm.key)}
                  onChange={(e) => setRegenChannels((cur) =>
                    e.target.checked ? [...cur, cm.key] : cur.filter((k) => k !== cm.key))} />
                {cm.label}
              </label>
            ))}
          </div>
          <button disabled={busy || regenChannels.length === 0}
            onClick={async () => { const ok = await doGenerate(regenChannels); if (ok) setRegenChannels([]); }}
            className="mt-2 min-h-[44px] px-4 rounded-lg border border-primary text-primary text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Regenerate Selected
          </button>
        </Card>
      )}
    </div>
  );

  // ── Right rail (normal state) ──────────────────────────────────────
  const rail = (
    <div className="space-y-4">
      <Card title="Publication Eligibility">
        <p className={`text-[22px] font-bold leading-none ${
          elig.tone === "emerald" ? "text-emerald-600" : elig.tone === "red" ? "text-red-600" : "text-amber-600"}`}>
          {elig.label}
        </p>
        <p className="text-[11.5px] text-muted-foreground mt-1">
          {blockingFindings.length > 0
            ? `${blockingFindings.length} blocking finding${blockingFindings.length === 1 ? "" : "s"} must be resolved.`
            : warnings.length > 0 ? `${warnings.length} warning${warnings.length === 1 ? "" : "s"} to review.`
            : "Meets all requirements for internal publication."}
        </p>
        <dl className="mt-3 space-y-2 text-[12px]">
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
            <dt className="text-muted-foreground">Content Quality</dt>
            <dd className="font-bold text-foreground">{caseRow?.quality_score ?? "—"}<span className="text-muted-foreground font-normal">/100</span></dd>
          </div>
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
            <dt className="text-muted-foreground">Fact Confidence</dt>
            <dd><Pill tone={conf.tone}>{conf.label}</Pill></dd>
          </div>
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
            <dt className="text-muted-foreground">Internal Publication</dt>
            <dd className="font-semibold text-foreground">{isPublished ? "Published" : "Not yet published"}</dd>
          </div>
        </dl>
      </Card>

      <Card title="Channel Readiness">
        <ul className="space-y-1.5">
          {CHANNEL_META.map((cm) => {
            const conn = connectorLabel(cm);
            const cv = record.channels.find((c) => c.channel === cm.key);
            return (
              <li key={cm.key} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="text-foreground truncate">{cm.label}</span>
                <Pill tone={cv ? conn.tone : "slate"}>{cv ? conn.label : "Not generated"}</Pill>
              </li>
            );
          })}
        </ul>
        <p className="text-[11px] text-muted-foreground mt-3 pt-3 border-t border-border">
          Only the Vehicle Passport is published by AutoLabels. Every other destination is export-only until a connector is configured.
        </p>
      </Card>

      {exceptions.length > 0 && (
        <Card title={`Exceptions (${exceptions.length})`}>
          <ul className="space-y-2">
            {exceptions.map((e) => (
              <li key={e.id} className="flex items-start gap-2">
                <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${e.blocking ? "text-red-500" : "text-amber-500"}`} />
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-foreground">{EXCEPTION_LABELS[e.exception_type] || e.exception_type}</p>
                  <p className="text-[11px] text-muted-foreground">{e.title}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {current && (
        <div className="space-y-2">
          {perms.canPublish && (
            <button onClick={doPublish}
              disabled={busy || caseRow?.publication_eligibility === "blocked" || isPublished}
              className="w-full min-h-[44px] rounded-xl bg-primary text-primary-foreground text-[13.5px] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              {isPublished ? "Published Internally" : "Publish Internally"}
            </button>
          )}
          {perms.canApprove && !isApproved && (
            <button onClick={() => act(() => approveVersion(current.id, true), "Version approved")}
              disabled={busy}
              className="w-full min-h-[44px] rounded-xl border border-primary text-primary text-[13.5px] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50">
              <CheckCircle2 className="w-4 h-4" /> Approve Version
            </button>
          )}
          {caseRow?.publication_eligibility === "blocked" && (
            <p className="text-[11px] text-red-600 text-center">Resolve blocking findings before publishing.</p>
          )}
          {!perms.canPublish && (
            <p className="text-[11.5px] text-muted-foreground text-center">
              Publishing requires manager approval permission.
            </p>
          )}
        </div>
      )}
    </div>
  );

  const activeRail = blockingException ? exceptionRail : rail;

  return (
    <div className="max-w-[1480px] mx-auto p-4 sm:p-6 pb-24 lg:pb-6">
      <button onClick={() => navigate("/description-operations")}
        className="hidden lg:inline-flex text-[12.5px] font-semibold text-muted-foreground hover:text-foreground items-center gap-1.5 mb-3 min-h-[44px]">
        <ArrowLeft className="w-4 h-4" /> Back to Operations
      </button>

      <div className="hidden lg:flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="min-w-0">
          <h1 className="font-display text-[22px] sm:text-[24px] font-bold tracking-tight text-foreground leading-tight">
            {vehicle?.ymm || "Vehicle"} <span className="text-muted-foreground font-medium">{vehicle?.trim || ""}</span>
          </h1>
          <p className="text-[12px] text-muted-foreground">
            Stock # {(vehicle?.mc_attributes || {}).stock_no || "—"} · <span className="font-mono">{vehicle?.vin}</span>
          </p>
        </div>
        <Pill tone={meta.tone}>{meta.label}</Pill>
      </div>

      {/* Desktop three-column */}
      <div className="hidden lg:grid grid-cols-[300px_minmax(0,1fr)_320px] gap-4 items-start">
        {identity}
        <div className="space-y-4 min-w-0">
          {exceptionBanner}
          {conflictCard}
          {workspace}
        </div>
        {activeRail}
      </div>

      {/* Mobile / tablet */}
      <div className="lg:hidden space-y-4">
        {vehicle?.hero_image_url && (
          <img src={vehicle.hero_image_url} alt="" className="w-full aspect-[16/9] object-cover rounded-2xl border border-border" />
        )}
        <div>
          <p className="text-[20px] font-bold text-foreground leading-tight">{vehicle?.ymm}</p>
          <p className="text-[15px] text-muted-foreground">{vehicle?.trim}</p>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Stock # {(vehicle?.mc_attributes || {}).stock_no || "—"} · {vehicle?.mileage ? `${Number(vehicle.mileage).toLocaleString()} mi` : "—"}
          </p>
        </div>

        <div className={`rounded-2xl border p-3.5 ${TONE_CLASS[elig.tone]}`}>
          <p className="text-[15px] font-bold inline-flex items-center gap-2">
            {elig.tone === "emerald" ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            {status === "READY" ? "Ready to Publish" : elig.label}
          </p>
          <p className="text-[12px] mt-0.5 opacity-90">
            {status === "READY" ? "Eligible for internal publication." : meta.help}
          </p>
          <ol className="flex items-center justify-between gap-1 mt-3">
            {["Data Sync", "Validate", "Generate", "Review", "Publish"].map((s, i) => (
              <li key={s} className="flex flex-col items-center gap-1 flex-1 min-w-0 relative">
                {i > 0 && <span aria-hidden className={`absolute top-[10px] right-1/2 w-full h-0.5 ${i <= stepIdx ? "bg-emerald-500" : "bg-border"}`} />}
                <span className={`w-7 h-7 rounded-full grid place-items-center text-[11px] font-bold relative z-10 ${
                  i <= stepIdx ? "bg-emerald-500 text-white" : "bg-white/70 text-muted-foreground border border-border"}`}>
                  {i <= stepIdx ? "✓" : i + 1}
                </span>
                <span className="text-[9.5px] text-center leading-tight truncate w-full">{s}</span>
              </li>
            ))}
          </ol>
        </div>

        {blockingException ? (
          <>{exceptionBanner}{conflictCard}</>
        ) : (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-emerald-800 inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> No blocking issues
            </span>
            <ChevronRight className="w-4 h-4 text-emerald-700" />
          </div>
        )}

        {/* Master description reads as an excerpt on mobile */}
        {current && (
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <button onClick={() => setMobileSection(mobileSection === "master" ? null : "master")}
              aria-expanded={mobileSection === "master"}
              className="w-full min-h-[52px] px-4 flex items-center justify-between gap-2">
              <span className="text-[13px] font-bold text-foreground">Master Description</span>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${mobileSection === "master" ? "rotate-180" : ""}`} />
            </button>
            {mobileSection === "master" && (
              <div className="px-4 pb-4">
                <p className={`text-[13px] text-foreground leading-relaxed whitespace-pre-wrap ${expanded ? "" : "line-clamp-6"}`}>
                  {current.content}
                </p>
                <button onClick={() => setExpanded((v) => !v)}
                  className="mt-1.5 text-[12.5px] font-semibold text-primary min-h-[44px]">
                  {expanded ? "Show less" : "Read more"}
                </button>
              </div>
            )}
          </div>
        )}

        {[["facts", "Trusted Facts", identity],
          ["readiness", "Channel Readiness", activeRail],
          ["history", "Version History", (
            <ul className="space-y-2">
              {versions.map((v) => (
                <li key={`m-${v.id}`} className="rounded-xl border border-border p-3">
                  <p className="text-[12.5px] font-semibold text-foreground">v{v.version_number} · {v.version_type}</p>
                  <p className="text-[11px] text-muted-foreground">{fmt(v.created_at)} · validation {v.validation_status}</p>
                </li>
              ))}
              {versions.length === 0 && <p className="text-[12px] text-muted-foreground">No versions yet.</p>}
            </ul>
          )]].map(([key, label, node]) => (
          <div key={key as string} className="rounded-2xl border border-border bg-card overflow-hidden">
            <button onClick={() => setMobileSection(mobileSection === key ? null : (key as string))}
              aria-expanded={mobileSection === key}
              className="w-full min-h-[52px] px-4 flex items-center justify-between gap-2">
              <span className="text-[13px] font-bold text-foreground inline-flex items-center gap-1.5">
                {(key === "facts" || key === "readiness") && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                {label as string}
              </span>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${mobileSection === key ? "rotate-180" : ""}`} />
            </button>
            {mobileSection === key && <div className="px-3 pb-3">{node as React.ReactNode}</div>}
          </div>
        ))}
      </div>

      {/* Sticky mobile action — only when exactly one action is valid */}
      {perms.canPublish && current && !isPublished && !blockingException
        && caseRow?.publication_eligibility === "eligible" && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 p-3 bg-card border-t border-border z-40">
          <button onClick={doPublish} disabled={busy}
            className="w-full min-h-[48px] rounded-xl bg-primary text-primary-foreground text-[14px] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Publish Internally
          </button>
        </div>
      )}
    </div>
  );
}
