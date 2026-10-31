import { useMemo, useReducer, useState } from "react";
import { PlayCircle } from "lucide-react";
import { countDisplay, type CountValue, type RunOutcome } from "@/lib/admin/health";
import { canApply, diffFields, initialReviewApply, isUnchanged, newIdempotencyKey, reviewApplyReducer, type ImpactSnapshot, type ReviewApplyEvent, type ReviewApplyState } from "@/lib/admin/reviewApply";
import type { FeedConfigRow } from "@/lib/admin/integrations/feed";
import { runFeedNow, saveFeedConfig, type FeedConfigDraft } from "@/lib/admin/integrations/queries";
import { FilterSelect } from "@/components/product";
import { AdminButton, AdminCard, AdminTable, InlineNote, KeyValueList, Td, Th } from "@/components/admin/v2/primitives";
import type { Viewer } from "./common";

// The one editor for the inventory feed configuration. Every change is
// reviewed against a computed impact before `save_marketcheck_config` is
// called, and a manual run is a separate confirmed action that states its
// cost. Opening the card writes nothing.

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const FREQUENCIES: Array<{ value: string; label: string }> = [
  { value: "nightly", label: "Every 24 hours" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every two weeks" },
  { value: "monthly", label: "Monthly" },
];

export const toDraft = (cfg: FeedConfigRow | null): FeedConfigDraft => ({
  enabled: !!cfg?.enabled,
  source: cfg?.source ?? "",
  frequency: cfg?.frequency ?? "nightly",
  day_of_week: cfg?.day_of_week ?? 0,
  run_hour: cfg?.run_hour ?? 3,
  max_vehicles: cfg?.max_vehicles ?? 1000,
});

export function validateDraft(d: FeedConfigDraft): string[] {
  const errors: string[] = [];
  if (d.enabled && !d.source.trim()) errors.push("Enter the dealer website domain before enabling the feed.");
  if (d.source.trim() && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d.source.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, ""))) errors.push("The source must be a website domain, such as dealer.example.");
  if (!Number.isInteger(d.run_hour) || d.run_hour < 0 || d.run_hour > 23) errors.push("Run hour must be between 0 and 23.");
  if (!Number.isInteger(d.max_vehicles) || d.max_vehicles < 1) errors.push("The vehicle cap must be at least 1.");
  return errors;
}

export function computeImpact(original: FeedConfigDraft, draft: FeedConfigDraft, activeVehicles: CountValue, version: string | null, now: number): ImpactSnapshot {
  const active = activeVehicles.kind === "known" ? activeVehicles.value : null;
  const warnings: string[] = [];
  if (draft.enabled && !original.enabled) warnings.push("Enabling schedules the next pull. It spends provider calls at the next run hour.");
  if (!draft.enabled && original.enabled) warnings.push("Disabling stops scheduled pulls. Inventory is retained as it is.");
  if (draft.source.trim() !== original.source.trim()) warnings.push("Changing the source does not clear the rooftop pin. Review the source identity after the first run against the new source.");
  if (active !== null && draft.max_vehicles < active) warnings.push(`The cap (${draft.max_vehicles}) is below the active inventory (${active}). Vehicles beyond the cap are not pulled.`);
  if (active === null) warnings.push("The active inventory count could not be read, so the effect of the cap is unknown.");
  return {
    computedAt: new Date(now).toISOString(),
    version,
    counts: { active_vehicles: active },
    samples: [],
    warnings,
    exclusions: ["Archived vehicles are never pulled or retired by a schedule change."],
  };
}

const reducer = (s: ReviewApplyState<FeedConfigDraft>, e: ReviewApplyEvent<FeedConfigDraft>): ReviewApplyState<FeedConfigDraft> => reviewApplyReducer(s, e);

const FIELD_LABEL: Record<keyof FeedConfigDraft, string> = {
  enabled: "Scheduled pull",
  source: "Source domain",
  frequency: "Frequency",
  day_of_week: "Day of week",
  run_hour: "Run hour (UTC)",
  max_vehicles: "Vehicle cap",
};

const fieldValue = (field: keyof FeedConfigDraft, v: unknown): string => {
  if (field === "enabled") return v ? "On" : "Off";
  if (field === "frequency") return FREQUENCIES.find((f) => f.value === v)?.label ?? String(v);
  if (field === "day_of_week") return DAYS[Number(v)] ?? String(v);
  if (field === "run_hour") return `${String(v).padStart(2, "0")}:00`;
  return v === "" || v === null || v === undefined ? "—" : String(v);
};

export interface FeedSettingsCardProps {
  tenantId: string | null;
  config: FeedConfigRow | null;
  configLoadFailed: boolean;
  activeVehicles: CountValue;
  viewer: Viewer;
  outcome: RunOutcome | null;
  now: number;
  onChanged: () => void;
  embedded?: boolean;
}

export default function FeedSettingsCard({ tenantId, config, configLoadFailed, activeVehicles, viewer, outcome, now, onChanged, embedded = false }: FeedSettingsCardProps) {
  const Shell = embedded ? EmbeddedShell : AdminCard;
  const original = useMemo(() => toDraft(config), [config]);
  const [state, dispatch] = useReducer(reducer, original, (o: FeedConfigDraft) => initialReviewApply(o));
  const [manual, setManual] = useState<{ step: "idle" | "confirm" | "running" | "done"; message?: string; ok?: boolean }>({ step: "idle" });

  const notGranted = config?.allowed === false && !viewer.isAdmin;
  const readOnly = !viewer.canManageSettings || !tenantId || configLoadFailed;
  const draft = state.draft;
  const unchanged = isUnchanged(draft, state.original);
  const gate = canApply(state);

  const edit = (patch: Partial<FeedConfigDraft>) => dispatch({ type: "edit", draft: { ...draft, ...patch } });

  const review = () => {
    const errors = validateDraft(draft);
    dispatch({ type: "validate", errors });
    if (errors.length) return;
    dispatch({ type: "review", impact: computeImpact(state.original, draft, activeVehicles, config?.updated_at ?? null, now), idempotencyKey: newIdempotencyKey("feed-config") });
  };

  const apply = async () => {
    if (!tenantId || !gate.ok) return;
    dispatch({ type: "apply" });
    const { error } = await saveFeedConfig(tenantId, draft);
    if (error) {
      dispatch({ type: "result", result: { status: "failed", affected: null, message: error } });
      return;
    }
    dispatch({ type: "result", result: { status: "applied", affected: 1, message: "Feed settings applied. The next scheduled run uses them." } });
    onChanged();
  };

  const manualDisabledReason = !tenantId
    ? "Live data only."
    : !viewer.canManageSettings
      ? "Only settings managers can start a run."
      : config?.allowed === false
        ? "The inventory feed is not granted on this plan."
        : !config?.source
          ? "Set a source domain first."
          : outcome === "provider_rate_limited"
            ? "Disabled while the provider is rate limiting. A manual run would be refused and still spend a call."
            : null;

  const startManual = async () => {
    if (!tenantId || manualDisabledReason) return;
    setManual({ step: "running" });
    const result = await runFeedNow(tenantId);
    setManual({ step: "done", ok: result.ok, message: result.message });
    onChanged();
  };

  if (notGranted) {
    return (
      <Shell title="Feed settings" description="Schedule, source and cap for the inventory pull.">
        <InlineNote tone="neutral" title="Not granted on this plan">The inventory feed is enabled by AutoLabels support. Nothing here can be changed until it is granted.</InlineNote>
      </Shell>
    );
  }

  const settingsRows = [
    { label: FIELD_LABEL.enabled, value: fieldValue("enabled", original.enabled) },
    { label: FIELD_LABEL.source, value: fieldValue("source", original.source) },
    { label: FIELD_LABEL.frequency, value: fieldValue("frequency", original.frequency) },
    ...(original.frequency === "nightly" ? [] : [{ label: FIELD_LABEL.day_of_week, value: fieldValue("day_of_week", original.day_of_week) }]),
    { label: FIELD_LABEL.run_hour, value: fieldValue("run_hour", original.run_hour) },
    { label: FIELD_LABEL.max_vehicles, value: fieldValue("max_vehicles", original.max_vehicles) },
  ];

  return (
    <Shell title="Feed settings" description="Schedule, source and cap for the inventory pull. Changes are reviewed before they are applied.">
      <div className="space-y-4">
        {configLoadFailed && <InlineNote tone="warning" title="Settings could not be read">Nothing can be changed until the configuration loads.</InlineNote>}
        {readOnly ? (
          <>
            <KeyValueList rows={settingsRows} />
            {!viewer.canManageSettings && <p className="text-[12px] leading-[18px] text-adm-muted">Only settings managers can change the feed.</p>}
          </>
        ) : state.phase === "reviewing" || state.phase === "applying" ? (
          <ReviewPanel state={state} onBack={() => dispatch({ type: "edit", draft })} onApply={apply} gateReason={gate.ok ? null : gate.reason ?? null} />
        ) : (
          <form
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
            onSubmit={(e) => { e.preventDefault(); review(); }}
            aria-label="Feed settings"
          >
            <label className="flex items-center gap-2 text-[14px] text-adm-ink sm:col-span-2">
              <input type="checkbox" checked={draft.enabled} onChange={(e) => edit({ enabled: e.target.checked })} className="h-4 w-4 rounded border-adm-border" />
              Scheduled pull enabled
            </label>
            <Field label={FIELD_LABEL.source} htmlFor="feed-source">
              <input id="feed-source" value={draft.source} onChange={(e) => edit({ source: e.target.value })} placeholder="dealer.example" className={INPUT} />
            </Field>
            <Field label={FIELD_LABEL.max_vehicles} htmlFor="feed-cap">
              <input id="feed-cap" type="number" min={1} value={draft.max_vehicles} onChange={(e) => edit({ max_vehicles: Number(e.target.value) })} className={INPUT} />
            </Field>
            <Field label={FIELD_LABEL.frequency} htmlFor="feed-frequency">
              <FilterSelect label={FIELD_LABEL.frequency} className="w-full" value={draft.frequency} onChange={(v) => edit({ frequency: v })} options={FREQUENCIES.map((f) => ({ value: f.value, label: f.label }))} />
            </Field>
            <Field label={FIELD_LABEL.run_hour} htmlFor="feed-hour">
              <FilterSelect label={FIELD_LABEL.run_hour} className="w-full" value={String(draft.run_hour)} onChange={(v) => edit({ run_hour: Number(v) })} options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, "0")}:00` }))} />
            </Field>
            {draft.frequency !== "nightly" && (
              <Field label={FIELD_LABEL.day_of_week} htmlFor="feed-day">
                <FilterSelect label={FIELD_LABEL.day_of_week} className="w-full" value={String(draft.day_of_week)} onChange={(v) => edit({ day_of_week: Number(v) })} options={DAYS.map((d, i) => ({ value: String(i), label: d }))} />
              </Field>
            )}
            {state.validation.length > 0 && (
              <ul className="sm:col-span-2 space-y-1" role="alert">
                {state.validation.map((v) => <li key={v} className="text-[13px] text-adm-danger">{v}</li>)}
              </ul>
            )}
            {state.result && state.phase !== "editing" && (
              <div className="sm:col-span-2">
                <InlineNote tone={state.result.status === "applied" ? "success" : "danger"} title={state.result.status === "applied" ? "Applied" : "Not applied"}>{state.result.message}</InlineNote>
              </div>
            )}
            <div className="sm:col-span-2 flex items-center gap-2 flex-wrap">
              <AdminButton type="submit" variant="primary" disabled={unchanged}>Review changes</AdminButton>
              {!unchanged && <AdminButton type="button" variant="ghost" onClick={() => dispatch({ type: "reset" })}>Discard</AdminButton>}
              <span className="text-[12px] text-adm-muted">Nothing is saved until the review is applied.</span>
            </div>
          </form>
        )}

        <div className="border-t border-adm-border pt-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-[14px] font-semibold text-adm-ink">Manual run</p>
              <p className="text-[12px] leading-[18px] text-adm-muted">Starts one inventory pull now, outside the schedule. Each run spends provider calls against the monthly quota.</p>
            </div>
            {manual.step === "idle" || manual.step === "done" ? (
              <div className="flex flex-col items-end gap-1">
                <AdminButton variant="secondary" size="sm" disabled={!!manualDisabledReason} onClick={() => setManual({ step: "confirm" })} aria-describedby="manual-run-hint">
                  <PlayCircle className="w-4 h-4" aria-hidden="true" />
                  Run feed now
                </AdminButton>
                {manualDisabledReason && <span id="manual-run-hint" className="text-[12px] text-adm-muted text-right max-w-xs">{manualDisabledReason}</span>}
              </div>
            ) : null}
          </div>
          {manual.step === "confirm" && (
            <InlineNote
              tone="info"
              title="Confirm the manual run"
              className="mt-3"
              action={
                <div className="flex items-center gap-2">
                  <AdminButton variant="ghost" size="sm" onClick={() => setManual({ step: "idle" })}>Cancel</AdminButton>
                  <AdminButton variant="primary" size="sm" onClick={startManual}>Run now</AdminButton>
                </div>
              }
            >
              This makes one MarketCheck inventory request for this rooftop now. It counts against the monthly quota, one call per page of results, and the result is recorded as a run.
            </InlineNote>
          )}
          {manual.step === "running" && <p role="status" className="mt-3 text-[13px] text-adm-muted">Running the feed…</p>}
          {manual.step === "done" && manual.message && (
            <InlineNote tone={manual.ok ? "success" : "warning"} title={manual.ok ? "Run finished" : "Run did not complete"} className="mt-3">{manual.message}</InlineNote>
          )}
        </div>
      </div>
    </Shell>
  );
}

const EmbeddedShell = ({ description, children }: { title?: string; description?: string; children: React.ReactNode }) => (
  <div className="space-y-3">
    {description && <p className="text-[13px] leading-[18px] text-adm-muted">{description}</p>}
    {children}
  </div>
);

const INPUT = "w-full h-9 rounded-md border border-adm-border bg-adm-surface px-3 text-[14px] text-adm-ink focus-visible:outline-2 focus-visible:outline-adm-primary";

const Field = ({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) => (
  <div>
    <label htmlFor={htmlFor} className="block text-[12px] leading-[18px] font-semibold text-adm-muted mb-1">{label}</label>
    {children}
  </div>
);

const ReviewPanel = ({ state, onBack, onApply, gateReason }: { state: ReviewApplyState<FeedConfigDraft>; onBack: () => void; onApply: () => void; gateReason: string | null }) => {
  const changes = diffFields(state.original as unknown as Record<string, unknown>, state.draft as unknown as Record<string, unknown>);
  const impact = state.impact;
  return (
    <div className="space-y-4" aria-label="Review changes">
      <AdminTable caption="Changes to apply">
        <thead>
          <tr>
            <Th>Setting</Th>
            <Th>Current</Th>
            <Th>After</Th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.field}>
              <Td className="font-semibold">{FIELD_LABEL[c.field as keyof FeedConfigDraft] ?? c.field}</Td>
              <Td className="text-adm-muted">{fieldValue(c.field as keyof FeedConfigDraft, c.before)}</Td>
              <Td>{fieldValue(c.field as keyof FeedConfigDraft, c.after)}</Td>
            </tr>
          ))}
        </tbody>
      </AdminTable>
      {impact && (
        <div className="space-y-2">
          <KeyValueList rows={[{ label: "Active vehicles", value: countDisplay(impact.counts.active_vehicles === null ? { kind: "failed" } : { kind: "known", value: impact.counts.active_vehicles }) }]} />
          {impact.warnings.map((w) => <InlineNote key={w} tone="warning">{w}</InlineNote>)}
          {impact.exclusions.map((x) => <p key={x} className="text-[12px] leading-[18px] text-adm-muted">{x}</p>)}
        </div>
      )}
      {gateReason && <p className="text-[13px] text-adm-danger" role="alert">{gateReason}</p>}
      {state.error && <p className="text-[13px] text-adm-danger" role="alert">{state.error}</p>}
      <div className="flex items-center gap-2">
        <AdminButton variant="primary" onClick={onApply} disabled={!!gateReason || state.phase === "applying"}>{state.phase === "applying" ? "Applying…" : "Apply"}</AdminButton>
        <AdminButton variant="secondary" onClick={onBack} disabled={state.phase === "applying"}>Back to editing</AdminButton>
      </div>
    </div>
  );
};
