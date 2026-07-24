import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, Clock, Copy, Download,
  Loader2, Lock, LockOpen, RefreshCw, ShieldCheck, XCircle, History, Save,
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

export default function DescriptionIntelligence() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const perms = useDescriptionPermissions();
  const { record, busy, error, generate, publishInternally, saveManualVersion, setChannelLock, resolveException } =
    useDescriptionCase(vehicleId);

  const [tab, setTab] = useState<"master" | "channels" | "history">("master");
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [openChannel, setOpenChannel] = useState<string | null>(null);
  const [mobileSection, setMobileSection] = useState<string | null>("master");

  const caseRow = record?.caseRow;
  const vehicle = record?.vehicle;
  const versions = record?.versions ?? [];
  const current = useMemo(
    () => versions.find((v) => v.id === selectedVersionId) ?? versions[0] ?? null,
    [versions, selectedVersionId],
  );
  const snapshot = record?.snapshot;
  const facts = (snapshot?.facts_json ?? {}) as Record<string, any>;
  const conflicts = (snapshot?.conflicts_json ?? []) as Array<any>;
  const excluded = (snapshot?.excluded_claims_json ?? []) as Array<any>;
  const findings = (record?.findings ?? []).filter((f) => !current || f.version_id === current.id);
  const blockingFindings = findings.filter((f) => f.blocking);
  const warnings = findings.filter((f) => f.severity === "warning");
  const exceptions = record?.exceptions ?? [];
  const blockingException = exceptions.find((e) => e.blocking);

  const status = (caseRow?.status ?? "UNINITIALIZED") as DescriptionStatus;
  const meta = STATUS_META[status] ?? STATUS_META.UNINITIALIZED;
  const elig = ELIGIBILITY_META[caseRow?.publication_eligibility ?? "unknown"];
  const conf = factConfidenceLabel(caseRow?.fact_confidence);
  const stepIdx = lifecycleIndex(status);
  const isPublished = caseRow?.published_master_version_id === current?.id;

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => {
    const res = await fn();
    if (!res.ok) { toast.error(res.error || "Action failed"); return false; }
    toast.success(okMsg);
    return true;
  };

  const doGenerate = () => act(() => generate("manual_regenerate"), "New version generated");
  const doPublish = async () => {
    if (!current) return;
    await act(() => publishInternally(current.id), "Published internally to the shopper listing");
  };
  const doSave = async () => {
    if (draft == null) return;
    const reason = window.prompt("Reason for this edit (recorded in history)") || "manual edit";
    const ok = await act(() => saveManualVersion(draft, reason), "Saved as a new version");
    if (ok) setDraft(null);
  };

  const copyChannel = async (content: string, label: string) => {
    try { await navigator.clipboard.writeText(content); toast.success(`${label} copy copied`); }
    catch { toast.error("Clipboard unavailable"); }
  };
  const downloadChannel = (content: string, label: string) => {
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

  // ── Vehicle identity (left) ────────────────────────────────────────
  const identity = (
    <div className="space-y-4">
      <Card title="Vehicle identity">
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
            ["Source freshness", vehicle?.enriched_at ? new Date(vehicle.enriched_at).toLocaleString() : "—"],
          ].map(([k, v]) => (
            <div key={k as string} className="flex items-start justify-between gap-2">
              <dt className="text-muted-foreground shrink-0">{k}</dt>
              <dd className="text-foreground font-medium text-right break-all">{v as string}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="Trusted vehicle facts">
        {Object.keys(facts).length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No fact snapshot yet. Generate a description to build one.</p>
        ) : (
          <ul className="space-y-1.5">
            {Object.values(facts).slice(0, 12).map((f: any) => {
              const fm = FACT_STATUS_META[f.status] ?? FACT_STATUS_META.pending;
              return (
                <li key={f.field} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="text-foreground capitalize truncate" title={`${f.field}: ${f.value} — source ${f.source}`}>
                    {String(f.field).replace(/_/g, " ")}
                  </span>
                  <Pill tone={fm.tone}>{fm.label}</Pill>
                </li>
              );
            })}
          </ul>
        )}
        {Object.keys((snapshot?.market_context_json ?? {})).length > 0 && (
          <p className="mt-3 pt-3 border-t border-border text-[11px] text-muted-foreground">
            Market value and comparables are <b>calculated market analysis</b>, not verified vehicle facts. They never become a claim about this vehicle.
          </p>
        )}
        {excluded.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-[11px] font-bold text-amber-700 mb-1">Excluded from copy ({excluded.length})</p>
            <ul className="space-y-0.5">
              {excluded.slice(0, 5).map((e, i) => (
                <li key={i} className="text-[11px] text-muted-foreground">{e.claim || e.field} — {String(e.reason).replace(/_/g, " ")}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );

  // ── Exception review (screen 03 state) ─────────────────────────────
  const exceptionBanner = blockingException && (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 mb-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-amber-900">
            {EXCEPTION_LABELS[blockingException.exception_type] || "Review required"} — {blockingException.title}
          </p>
          <p className="text-[12.5px] text-amber-800 mt-0.5">{blockingException.summary}</p>

          {Array.isArray(blockingException.details_json?.values) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3">
              {blockingException.details_json.values.map((v: any, i: number) => (
                <div key={i} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-[12px] font-bold text-foreground capitalize">{String(v.source).replace(/_/g, " ")}</p>
                    <Pill tone={String(v.value) === "not listed" ? "red" : "emerald"}>
                      {String(v.value) === "not listed" ? "Not listed" : "Included"}
                    </Pill>
                  </div>
                  <p className="text-[12px] text-muted-foreground">Claim</p>
                  <p className="text-[12.5px] text-foreground">{String(v.value)}</p>
                </div>
              ))}
            </div>
          )}

          <p className="text-[11.5px] text-amber-800 mt-3 inline-flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Claim excluded from customer description until resolved.
          </p>

          {perms.canResolve && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
              <button disabled={busy}
                onClick={() => act(() => resolveException(blockingException.id, "confirmed_included", true), "Resolved — regenerating")}
                className="h-11 px-3 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 text-[12.5px] font-semibold text-left disabled:opacity-60">
                Confirm included<span className="block text-[11px] font-normal opacity-80">Include in description</span>
              </button>
              <button disabled={busy}
                onClick={() => act(() => resolveException(blockingException.id, "confirmed_not_included", true), "Resolved — regenerating")}
                className="h-11 px-3 rounded-lg border border-rose-300 bg-rose-50 text-rose-800 text-[12.5px] font-semibold text-left disabled:opacity-60">
                Confirm not included<span className="block text-[11px] font-normal opacity-80">Exclude from description</span>
              </button>
              <button disabled={busy}
                onClick={() => act(() => resolveException(blockingException.id, "keep_excluded", false), "Kept excluded")}
                className="h-11 px-3 rounded-lg border border-border bg-card text-foreground text-[12.5px] font-semibold text-left disabled:opacity-60">
                Keep excluded<span className="block text-[11px] font-normal opacity-80">Keep current exclusion</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // ── Center workspace ───────────────────────────────────────────────
  const workspace = (
    <div className="space-y-4">
      <Card>
        {/* Lifecycle */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="inline-flex items-center gap-2">
            {status === "PUBLISHED" || status === "READY"
              ? <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              : status.startsWith("FAILED") ? <XCircle className="w-5 h-5 text-red-500" />
              : <Clock className="w-5 h-5 text-amber-500" />}
            <div>
              <p className="text-[14px] font-bold text-foreground leading-tight">{meta.label}</p>
              <p className="text-[11.5px] text-muted-foreground">{meta.help}</p>
            </div>
          </div>
          {versions.length > 0 && (
            <select value={current?.id ?? ""} onChange={(e) => { setSelectedVersionId(e.target.value); setDraft(null); }}
              aria-label="Select version"
              className="h-9 px-2.5 rounded-lg border border-border bg-card text-[12.5px] font-medium">
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version_number}{v.id === versions[0].id ? " (latest)" : ""}{v.manual_edit ? " · edited" : ""}
                </option>
              ))}
            </select>
          )}
        </div>
        <ol className="flex items-center gap-1 flex-wrap" aria-label="Description lifecycle">
          {LIFECYCLE_STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-1">
              <span className={`text-[10.5px] font-semibold px-2 py-1 rounded-md border ${
                i <= stepIdx ? "bg-primary/10 text-primary border-primary/20" : "bg-muted/40 text-muted-foreground border-border"}`}>{s}</span>
              {i < LIFECYCLE_STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground/50" />}
            </li>
          ))}
        </ol>
      </Card>

      {/* Tabs */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-1 border-b border-border px-2" role="tablist">
          {([["master", "Master description"], ["channels", "Channel variants"], ["history", "Version history"]] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`h-11 px-3.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors ${
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
                  <button onClick={doGenerate} disabled={busy}
                    className="mt-3 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Generate now
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                  <p className="text-[11.5px] text-muted-foreground">
                    v{current.version_number} · {current.character_count} chars · {current.created_by_type === "user" ? "manual edit" : "generated"} · {new Date(current.created_at).toLocaleString()}
                  </p>
                  {caseRow?.master_locked && <Pill tone="amber"><Lock className="w-3 h-3" /> Locked</Pill>}
                </div>
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
                      className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save as new version
                    </button>
                  )}
                  {perms.canGenerate && (
                    <button onClick={doGenerate} disabled={busy}
                      className="h-10 px-4 rounded-lg border border-border text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Regenerate
                    </button>
                  )}
                  <button onClick={() => copyChannel(draft ?? current.content, "Master")}
                    className="h-10 px-3.5 rounded-lg border border-border text-[13px] font-semibold inline-flex items-center gap-1.5">
                    <Copy className="w-4 h-4" /> Copy
                  </button>
                </div>
              </>
            )
          )}

          {tab === "channels" && (
            (record.channels.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground py-6 text-center">No channel variants yet.</p>
            ) : (
              <div className="space-y-2">
                {record.channels.map((cv) => {
                  const cm = channelMeta(cv.channel);
                  const conn = connectorLabel(cm);
                  const open = openChannel === cv.id;
                  return (
                    <div key={cv.id} className="rounded-xl border border-border">
                      <button onClick={() => setOpenChannel(open ? null : cv.id)}
                        aria-expanded={open}
                        className="w-full flex items-center gap-2.5 p-3 text-left">
                        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
                        <span className="text-[13px] font-semibold text-foreground flex-1 min-w-0 truncate">{cm?.label || cv.channel}</span>
                        {cv.locked && <Pill tone="amber"><Lock className="w-3 h-3" /> Locked</Pill>}
                        {cv.potentially_stale && <Pill tone="amber">Stale</Pill>}
                        <span className="text-[11px] text-muted-foreground">{cv.character_count}/{cv.character_limit}</span>
                        <Pill tone={conn.tone}>{conn.label}</Pill>
                      </button>
                      {open && (
                        <div className="px-3 pb-3 border-t border-border pt-3">
                          {cv.seo_title && <p className="text-[12px] mb-1"><b>SEO title:</b> {cv.seo_title}</p>}
                          {cv.meta_description && <p className="text-[12px] mb-2"><b>Meta:</b> {cv.meta_description}</p>}
                          <p className="text-[13px] text-foreground whitespace-pre-wrap leading-relaxed">{cv.content}</p>
                          {cm?.deliveryMode !== "internal_projection" && (
                            <p className="text-[11.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2.5">
                              {cm?.connectorStatus === "not_configured"
                                ? "No connector is configured for this destination. AutoLabels cannot deliver here — copy or download the text to publish it manually."
                                : "Export only. AutoLabels does not deliver to this destination automatically."}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                            <button onClick={() => copyChannel(cv.content, cm?.label || cv.channel)}
                              className="h-9 px-3 rounded-lg border border-border text-[12px] font-semibold inline-flex items-center gap-1.5">
                              <Copy className="w-3.5 h-3.5" /> Copy
                            </button>
                            <button onClick={() => downloadChannel(cv.content, cm?.label || cv.channel)}
                              className="h-9 px-3 rounded-lg border border-border text-[12px] font-semibold inline-flex items-center gap-1.5">
                              <Download className="w-3.5 h-3.5" /> Download
                            </button>
                            {perms.canLock && (
                              <button onClick={() => act(() => setChannelLock(cv.id, !cv.locked, "manual edit protected"), cv.locked ? "Channel unlocked" : "Channel locked")}
                                className="h-9 px-3 rounded-lg border border-border text-[12px] font-semibold inline-flex items-center gap-1.5">
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
            ))
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
                      <p className="text-[11px] text-muted-foreground">{new Date(v.created_at).toLocaleString()}</p>
                    </div>
                    <p className="text-[11.5px] text-muted-foreground mt-1">
                      {v.character_count} chars · {v.created_by_type === "user" ? "manual" : "automation"}
                      {v.edit_reason ? ` · ${v.edit_reason}` : ""} · validation {v.validation_status}
                    </p>
                    {v.id !== current?.id && (
                      <button onClick={() => { setSelectedVersionId(v.id); setDraft(null); setTab("master"); }}
                        className="mt-2 h-8 px-3 rounded-lg border border-border text-[12px] font-semibold inline-flex items-center gap-1">
                        <History className="w-3.5 h-3.5" /> View this version
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      </div>

      {/* Validation findings — separate from the quality score by design */}
      <Card title="Validation findings">
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
    </div>
  );

  // ── Right rail ─────────────────────────────────────────────────────
  const rail = (
    <div className="space-y-4">
      <Card title="Publication eligibility">
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
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Content quality</dt>
            <dd className="font-bold text-foreground">{caseRow?.quality_score ?? "—"}<span className="text-muted-foreground font-normal">/100</span></dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Fact confidence</dt>
            <dd><Pill tone={conf.tone}>{conf.label}</Pill></dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Internal publication</dt>
            <dd className="font-semibold text-foreground">{isPublished ? "Published" : "Not yet published"}</dd>
          </div>
        </dl>
      </Card>

      <Card title="Channel readiness">
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
          Only the Vehicle Passport and Dealer Website are published by AutoLabels. Marketplace destinations are export-only until a connector is configured.
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

      {perms.canPublish && current && (
        <div className="space-y-2">
          <button onClick={doPublish}
            disabled={busy || caseRow?.publication_eligibility === "blocked" || isPublished}
            title={caseRow?.publication_eligibility === "blocked" ? "Blocked by validation" : undefined}
            className="w-full h-11 rounded-xl bg-primary text-primary-foreground text-[13.5px] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            {isPublished ? "Published internally" : "Publish internally"}
          </button>
          {caseRow?.publication_eligibility === "blocked" && (
            <p className="text-[11px] text-red-600 text-center">Resolve blocking findings before publishing.</p>
          )}
        </div>
      )}
      {!perms.canPublish && (
        <p className="text-[11.5px] text-muted-foreground text-center">
          Publishing requires manager approval permission.
        </p>
      )}
    </div>
  );

  return (
    <div className="max-w-[1480px] mx-auto p-4 sm:p-6 pb-24 lg:pb-6">
      <button onClick={() => navigate("/description-operations")}
        className="text-[12.5px] font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-3">
        <ArrowLeft className="w-4 h-4" /> Back to operations
      </button>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
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

      {exceptionBanner}

      {/* Desktop three-column */}
      <div className="hidden lg:grid grid-cols-[300px_minmax(0,1fr)_320px] gap-4 items-start">
        {identity}{workspace}{rail}
      </div>

      {/* Mobile / tablet: identity → eligibility → exceptions → accordions */}
      <div className="lg:hidden space-y-4">
        <Card>
          <p className="text-[13px] font-bold text-foreground">{vehicle?.ymm}</p>
          <p className="text-[11.5px] text-muted-foreground">{vehicle?.trim} · {vehicle?.mileage ? `${Number(vehicle.mileage).toLocaleString()} mi` : "—"}</p>
          <div className={`mt-3 rounded-xl border p-3 ${TONE_CLASS[elig.tone]}`}>
            <p className="text-[13px] font-bold inline-flex items-center gap-1.5">
              {elig.tone === "emerald" ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              {elig.label}
            </p>
            <p className="text-[11.5px] mt-0.5 opacity-90">{meta.help}</p>
          </div>
        </Card>
        {[["master", "Master description", workspace],
          ["facts", "Trusted facts", identity],
          ["rail", "Readiness & channels", rail]].map(([key, label, node]) => (
          <div key={key as string} className="rounded-2xl border border-border bg-card overflow-hidden">
            <button onClick={() => setMobileSection(mobileSection === key ? null : (key as string))}
              aria-expanded={mobileSection === key}
              className="w-full min-h-[52px] px-4 flex items-center justify-between gap-2">
              <span className="text-[13px] font-bold text-foreground">{label as string}</span>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${mobileSection === key ? "rotate-180" : ""}`} />
            </button>
            {mobileSection === key && <div className="px-3 pb-3">{node as React.ReactNode}</div>}
          </div>
        ))}
      </div>

      {/* Sticky mobile action — only when exactly one action is valid */}
      {perms.canPublish && current && !isPublished && caseRow?.publication_eligibility === "eligible" && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 p-3 bg-card border-t border-border z-40">
          <button onClick={doPublish} disabled={busy}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground text-[14px] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Publish internally
          </button>
        </div>
      )}
    </div>
  );
}
