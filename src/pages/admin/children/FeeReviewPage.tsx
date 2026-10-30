import { useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MoveRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useAudit } from "@/contexts/AuditContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { useViewFixture } from "@/lib/admin/dataSource";
import { adminTabHref } from "@/lib/admin/sections";
import { canApply, initialReviewApply, newIdempotencyKey, reviewApplyReducer, type ImpactSnapshot, type ReviewApplyEvent, type ReviewApplyState } from "@/lib/admin/reviewApply";
import { feeChangeDiff, feeDraftFromSettings, feeDraftWarnings, fmtMoney, validateFeeDraft, type FeeDraft, type FeeImpactSample } from "@/lib/admin/pricing/feePolicy";
import { describeFeeBasis, resolveFeeBasis, type FeeBasis } from "@/lib/admin/pricing/feeBasis";
import { STATE_DOC_FEES } from "@/data/docFees";
import type { PriceDisplayMode } from "@/lib/priceModel";
import { AdminPageContainer, Breadcrumbs } from "@/components/admin/v2/AdminShell";
import { AdminButton, AdminTable, InlineNote, SkeletonBlock, StatusChip, Td, Th, type Tone } from "@/components/admin/v2/primitives";
import { MetricStrip } from "@/components/product";
import { applyFeeChange, loadPolicyVersion, parseFeeReviewParams, tenantIdOf, useFeePreview, usePolicyVersion, type FeePreviewResult, type FeeScope, type PolicyVersion } from "@/pages/admin/views/pricing/pricingData";
import { AdminInput, AdminSelect, Field } from "@/pages/admin/views/pricing/ui";
import { cn } from "@/lib/utils";
import vehiclePlaceholder from "@/assets/admin-v2/artwork/vehicle-placeholder.svg";

// Fee Change Review: Edit, Review, Apply, one page with a summary strip.
// Opening it writes nothing; the impact is computed for the exact draft under
// review; apply is refused for a stale review, an unknown count, an unknown
// policy version or a role without pricing authority. The shared server
// contracts are called by name and, until they are installed, the existing
// recalculation routine is used with its consequences stated.

export interface FeeReviewFixture {
  before: FeeDraft;
  after: FeeDraft;
  mode: PriceDisplayMode;
  /** The dealership's fee basis; defaults to the one its display mode implies. */
  basis?: FeeBasis;
  scope: FeeScope;
  version: PolicyVersion;
  preview: FeePreviewResult;
  canManage: boolean;
  /** Where Close returns to; defaults to the Price rules tab. */
  backHref?: string;
}

/** Router state Close hands back to Price rules so it can restore the draft and refocus its trigger. */
export interface FeeReviewReturn {
  draft: FeeDraft;
  scope: FeeScope;
}

const APPLY_ROLES = new Set(["owner", "admin", "general_manager", "gsm"]);

type FeeState = ReviewApplyState<FeeDraft>;
type FeeEvent = ReviewApplyEvent<FeeDraft>;
const reduce = (s: FeeState, e: FeeEvent): FeeState => reviewApplyReducer(s, e);

const snapshotOf = (p: FeePreviewResult, version: string | number | null): ImpactSnapshot => ({
  computedAt: new Date().toISOString(),
  version,
  counts: { eligible: p.impact.eligible, unchanged: p.impact.unchanged, excludedArchived: p.impact.excludedArchived },
  samples: p.impact.samples,
  warnings: [...p.impact.warnings, ...p.notes],
  exclusions: p.impact.exclusions,
});

const stepOf = (phase: FeeState["phase"]): 1 | 2 | 3 => {
  if (phase === "editing" || phase === "validating") return 1;
  if (phase === "applied" || phase === "partial" || phase === "failed") return 3;
  return 2;
};

const Tile = ({ value, label, hint }: { value: string; label: string; hint: string }) => (
  <div data-landmark="fee-impact-tile" className="rounded-[6px] border border-adm-border px-4 py-3">
    <p data-landmark="impact-count" className="text-[24px] leading-[30px] font-bold text-adm-ink tabular-nums">{value}</p>
    <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{label}</p>
    <p className="mt-0.5 text-[13px] leading-[18px] text-adm-muted">{hint}</p>
  </div>
);

const MISMATCH_NOTE = "The stored sale price differs from this total; its source is not verified and it is kept for review.";

// The vehicle price before the fee. On a fee-inclusive basis it is the part
// of the kept total that the fee does not take, so it moves when the fee does.
const SellingChange = ({ s }: { s: FeeImpactSample }) =>
  s.sellingBefore != null && Math.round(s.sellingBefore * 100) !== Math.round(s.sellingPrice * 100) ? (
    <Change before={s.sellingBefore} after={s.sellingPrice} neutral />
  ) : (
    <>
      <p className="text-[14px] leading-[20px] text-adm-ink tabular-nums">{fmtMoney(s.sellingPrice)}</p>
      <p className="text-[13px] leading-[18px] text-adm-muted">No change</p>
    </>
  );

const Thumb = () => (
  <span aria-hidden="true" className="w-[65px] h-10 rounded-md bg-adm-workspace flex-shrink-0 inline-flex items-center justify-center">
    <img src={vehiclePlaceholder} alt="" className="w-[62%] h-auto" />
  </span>
);

const DeltaMark = ({ down = false }: { down?: boolean }) => (
  <svg viewBox="0 0 14 9" className={cn("w-[14px] h-[9px] fill-current flex-shrink-0", down && "rotate-180")} aria-hidden="true">
    <path d="M7 0.5 13.5 8.5H0.5z" />
  </svg>
);

const Change = ({ before, after, neutral = false }: { before: number | null; after: number; neutral?: boolean }) => {
  const d = before == null ? null : after - before;
  const up = d != null && d > 0.005;
  const down = d != null && d < -0.005;
  return (
    <>
      <p className="flex items-center gap-2 h-5 text-[14px] leading-[20px] text-adm-ink tabular-nums whitespace-nowrap">
        <span>{fmtMoney(before)}</span>
        <MoveRight className="w-[17px] h-[17px] text-adm-muted flex-shrink-0" aria-hidden="true" />
        <span>{fmtMoney(after)}</span>
      </p>
      <p className={cn("mt-0 flex items-center gap-1.5 text-[13px] leading-[18px] tabular-nums", neutral ? "text-adm-muted" : up ? "text-adm-danger" : down ? "text-adm-success" : "text-adm-muted")}>
        {d == null ? "Previous total unknown" : up || down ? (
          <>
            <DeltaMark down={down} />
            {fmtMoney(Math.abs(d))}
          </>
        ) : (
          "No change"
        )}
      </p>
    </>
  );
};

const TABLE_CLASS = "[&_th]:py-2 [&_th]:px-3 [&_td]:px-3 md:[&_th]:px-4 md:[&_td]:px-4 [&_th]:text-[13px] [&_th]:text-adm-ink [&_th]:border-r [&_td]:border-r [&_th:last-child]:border-r-0 [&_td:last-child]:border-r-0 [&_tbody_tr:last-child>td]:border-b-0";

const RESULT_TONE: Record<"applied" | "partial" | "failed", Tone> = { applied: "success", partial: "warning", failed: "danger" };
const RESULT_LABEL: Record<"applied" | "partial" | "failed", string> = { applied: "Applied", partial: "Partially applied", failed: "Not applied" };

export default function FeeReviewPage() {
  const fixture = useViewFixture<FeeReviewFixture>("fee-review");
  const { loading } = useDealerSettings();
  if (!fixture && loading) {
    return (
      <AdminPageContainer>
        <SkeletonBlock className="h-64 w-full" />
      </AdminPageContainer>
    );
  }
  return <FeeReviewDialog fixture={fixture} />;
}

function FeeReviewDialog({ fixture }: { fixture: FeeReviewFixture | null }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const { user, isAdmin } = useAuth();
  const { member } = useEntitlements();
  const { tenant } = useTenant();
  const { settings, reload } = useDealerSettings();
  const audit = useAudit();
  const tenantId = tenantIdOf(tenant);
  const live = !fixture;

  const original = useMemo(() => fixture?.before ?? feeDraftFromSettings(settings), [fixture, settings]);
  const parsed = useMemo(() => parseFeeReviewParams(params, original), [params, original]);
  const [scope, setScope] = useState<FeeScope>(fixture?.scope ?? parsed.scope);
  const [state, dispatch] = useReducer(reduce, null, (): FeeState => {
    if (fixture) {
      let s = initialReviewApply(fixture.before);
      s = reduce(s, { type: "edit", draft: fixture.after });
      s = reduce(s, { type: "validate", errors: [] });
      return reduce(s, { type: "review", impact: snapshotOf(fixture.preview, fixture.version.version), idempotencyKey: "fixture" });
    }
    const s = initialReviewApply(original);
    return parsed.provided ? reduce(s, { type: "edit", draft: parsed.draft }) : s;
  });
  const mode: PriceDisplayMode = fixture?.mode ?? settings.price_display_mode ?? "advertised_before_doc";
  const basis: FeeBasis = fixture?.basis ?? resolveFeeBasis(fixture ? { price_display_mode: fixture.mode } : settings).basis;

  const role = member?.role;
  const roleAllowed = isAdmin || APPLY_ROLES.has(`${role ?? ""}`.trim().toLowerCase());
  const canManage = fixture ? fixture.canManage : roleAllowed && hasDealerCapability(role, "can_manage_settings", isAdmin);

  const previewing = state.phase === "validating" || state.phase === "reviewing" || state.phase === "applying";
  const preview = useFeePreview({ tenantId, draft: state.draft, includeArchived: scope === "all", basis, enabled: live && previewing });
  const version = usePolicyVersion(tenantId, live && previewing);

  useEffect(() => {
    if (fixture || state.phase !== "validating") return;
    if (!tenantId) { dispatch({ type: "invalidate", reason: "No dealership context; the impact cannot be computed." }); return; }
    if (preview.isError) { dispatch({ type: "invalidate", reason: preview.error instanceof Error ? preview.error.message : "The impact could not be computed." }); return; }
    if (!preview.data || version.isLoading) return;
    dispatch({ type: "review", impact: snapshotOf(preview.data, version.data?.version ?? null), idempotencyKey: newIdempotencyKey("doc-fee") });
  }, [fixture, state.phase, tenantId, preview.data, preview.isError, preview.error, version.data, version.isLoading]);

  const backHref = fixture?.backHref ?? adminTabHref("price-rules");
  const returnState: { feeReviewReturn: FeeReviewReturn } = { feeReviewReturn: { draft: state.draft, scope } };
  const close = () => navigate(backHref, { state: returnState });

  const step = stepOf(state.phase);
  const previewResult = fixture ? fixture.preview : preview.data ?? null;
  const impact = previewResult?.impact ?? null;
  const versionNow = fixture ? fixture.version : version.data ?? null;
  // Changed fields, plus the price basis so the reader sees which total the fee lands in.
  const diff = feeChangeDiff(state.original, state.draft, mode, state.impact?.version ?? versionNow?.version ?? null).filter((row) => row.changed || row.field === "Price basis");
  const errors = state.validation;
  const warnings = feeDraftWarnings(state.draft);
  const unchanged = state.draft.enabled === state.original.enabled && state.draft.amount === state.original.amount && state.draft.stateCode === state.original.stateCode;
  const versionKnown = state.impact?.version != null;
  const gate = canApply(state);
  const blocked = previewResult?.blocked ?? null;
  const applyReason = !canManage
    ? "Your role cannot apply pricing changes. Ask an owner, general manager or GSM."
    : blocked
      ? blocked
    : !versionKnown
      ? "The policy version could not be read, so the change cannot be applied safely."
      : gate.ok
        ? null
        : gate.reason ?? null;
  const applyEnabled = state.phase === "reviewing" && canManage && !blocked && versionKnown && gate.ok && (fixture ? true : !!tenantId);

  const startReview = () => {
    const errs = validateFeeDraft(state.draft);
    dispatch({ type: "validate", errors: errs });
  };

  const onApply = async () => {
    if (!tenantId || !state.impact || !state.idempotencyKey || !applyEnabled) return;
    const fresh = await loadPolicyVersion(tenantId);
    const check = canApply(state, fresh.version);
    if (!check.ok) {
      if (fresh.version !== state.impact.version) dispatch({ type: "conflict", changedFields: ["doc_fee"] });
      else dispatch({ type: "error", message: check.reason ?? "The change cannot be applied." });
      return;
    }
    dispatch({ type: "apply" });
    const outcome = await applyFeeChange({
      tenantId,
      draft: state.draft,
      expectedVersion: state.impact.version,
      idempotencyKey: state.idempotencyKey,
      includeArchived: scope === "all",
    });
    if (outcome.kind === "conflict") { dispatch({ type: "conflict", changedFields: ["doc_fee"] }); return; }
    dispatch({ type: "result", result: outcome.result });
    qc.invalidateQueries({ queryKey: ["admin-v2"] });
    void reload?.();
  };

  const eligibleLabel = scope === "all" ? "vehicles" : "active vehicles";
  const eligibleCount = impact?.eligible ?? null;
  const applyLabel = state.phase === "applying" ? "Applying…" : `Apply to ${eligibleCount == null ? "Unknown" : eligibleCount.toLocaleString()} ${eligibleLabel}`;
  const footNote: ReactNode = step === 2 ? (applyReason ?? "Requires pricing-management permission. Change will be audited.") : step === 3 ? "This review is complete." : "Nothing is changed until the review is applied.";

  const STEP_NAMES = ["Edit", "Review", "Apply"] as const;
  const feeValue = (d: FeeDraft) => (d.enabled && Number.isFinite(d.amount) ? fmtMoney(d.amount) : "Off");
  const delta = state.original.enabled && state.draft.enabled && Number.isFinite(state.original.amount) && Number.isFinite(state.draft.amount) ? state.draft.amount - state.original.amount : null;
  const deltaLabel = delta === null ? "Unknown" : Math.abs(delta) < 0.005 ? "No change" : `${delta > 0 ? "+" : "-"}${fmtMoney(Math.abs(delta))}`;
  const primary =
    step === 1 ? (
      <AdminButton variant="primary" disabled={unchanged || state.phase === "validating"} onClick={startReview}>{state.phase === "validating" ? "Computing…" : "Review changes"}</AdminButton>
    ) : step === 2 ? (
      <AdminButton variant="primary" data-landmark="fee-apply" disabled={!applyEnabled} onClick={onApply}>{applyLabel}</AdminButton>
    ) : (
      <AdminButton variant="primary" onClick={close}>Done</AdminButton>
    );

  return (
    <AdminPageContainer>
      <div className="space-y-4">
        <Breadcrumbs crumbs={[{ label: "Administration", href: "/admin" }, { label: "Pricing & Products", href: backHref }, { label: "Fee change review" }]} />
        <section aria-labelledby="fee-review-title" className="space-y-4 text-adm-ink">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 id="fee-review-title" className="text-[28px] leading-[36px] font-bold text-adm-ink">Fee change review: document fee</h1>
                {step < 3 && <StatusChip>Draft</StatusChip>}
              </div>
              <p className="mt-0.5 text-[14px] leading-[20px] text-adm-muted">Step {step} of 3, {STEP_NAMES[step - 1]}. Confirm the new fee and the vehicles it will update before anything is applied.</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">{primary}</div>
          </header>
          <MetricStrip
            label="Fee change summary"
            metrics={[
              { label: "Current fee", value: feeValue(state.original) },
              { label: "Proposed fee", value: feeValue(state.draft) },
              { label: "Change", value: deltaLabel, tone: delta === null || Math.abs(delta) < 0.005 ? "neutral" : delta > 0 ? "danger" : "success" },
              { label: eligibleLabel === "vehicles" ? "Impacted vehicles" : "Impacted active vehicles", value: eligibleCount == null ? null : eligibleCount.toLocaleString() },
            ]}
          />
          <div data-fee-review-body>
        {step === 1 && (
          <div className="rounded-[6px] border border-adm-border bg-adm-surface p-6 space-y-5">
            <div className="flex items-center justify-between gap-4 rounded-md border border-adm-border px-3 py-2.5">
              <div>
                <p className="text-[14px] font-semibold text-adm-ink">Charge a document fee</p>
                <p className="text-[12px] text-adm-muted">When off, stored totals equal the selling price.</p>
              </div>
              <Switch checked={state.draft.enabled} onCheckedChange={(v) => dispatch({ type: "edit", draft: { ...state.draft, enabled: v } })} aria-label="Charge a document fee" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Jurisdiction" htmlFor="review-fee-state">
                <AdminSelect id="review-fee-state" value={state.draft.stateCode} onChange={(e) => dispatch({ type: "edit", draft: { ...state.draft, stateCode: e.target.value } })}>
                  <option value="">Not set</option>
                  {STATE_DOC_FEES.map((s) => (
                    <option key={s.stateCode} value={s.stateCode}>{s.state}</option>
                  ))}
                </AdminSelect>
              </Field>
              <Field label="Document fee" htmlFor="review-fee-amount">
                <AdminInput id="review-fee-amount" type="number" inputMode="decimal" step="0.01" min={0} value={Number.isFinite(state.draft.amount) ? state.draft.amount : ""} disabled={!state.draft.enabled} onChange={(e) => dispatch({ type: "edit", draft: { ...state.draft, amount: e.target.value === "" ? NaN : Number(e.target.value) } })} />
              </Field>
              <Field label="Scope" htmlFor="review-scope">
                <AdminSelect id="review-scope" value={scope} onChange={(e) => setScope(e.target.value as FeeScope)}>
                  <option value="active">Active inventory (default)</option>
                  <option value="all">Include archived records</option>
                </AdminSelect>
              </Field>
            </div>
            {errors.length > 0 && <InlineNote tone="danger">{errors.join(" ")}</InlineNote>}
            {warnings.map((w) => (
              <InlineNote key={w} tone="warning">{w}</InlineNote>
            ))}
            {state.phase === "validating" && <p role="status" className="text-[13px] text-adm-muted">Computing the impact for this draft…</p>}
          </div>
        )}

        {step === 2 && (
          <>
            {(state.phase === "conflict" || state.phase === "invalidated") && (
              <InlineNote tone="danger" className="mt-0" title={state.phase === "conflict" ? "The policy changed after this review." : "The review is no longer valid."}>
                {state.phase === "conflict" ? "Reload and review the change again before applying it." : state.error}
              </InlineNote>
            )}
            {state.error && state.phase === "reviewing" && <InlineNote tone="danger" className="mt-0">{state.error}</InlineNote>}

            <div className={cn("grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_312px] gap-7 items-start", state.phase === "conflict" || state.phase === "invalidated" || (state.error && state.phase === "reviewing") ? "mt-5" : "mt-7")}>
              <section aria-labelledby="fee-change-summary" data-landmark="fee-change-summary">
                <h3 id="fee-change-summary" className="text-[16px] leading-[22px] font-semibold text-adm-ink">Change summary</h3>
                <div className="mt-3 rounded-[6px] border border-adm-border overflow-hidden">
                  <AdminTable caption="Before and after" className={cn(TABLE_CLASS, "[&_td]:py-[10px]")}>
                    <thead>
                      <tr>
                        <Th className="md:w-[193px]">Field</Th>
                        <Th className="md:w-[168px]">Before</Th>
                        <Th>After</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff.map((row) => (
                        <tr key={row.field}>
                          <Td className="text-adm-ink">{row.field}</Td>
                          <Td>{row.before}</Td>
                          <Td>{row.after}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </AdminTable>
                </div>
              </section>

              <section aria-labelledby="fee-expected-impact">
                <h3 id="fee-expected-impact" className="text-[16px] leading-[22px] font-semibold text-adm-ink">Expected impact</h3>
                <div className="mt-3.5 space-y-2">
                  <Tile value={eligibleCount == null ? "Unknown" : eligibleCount.toLocaleString()} label={`${eligibleLabel} eligible`} hint={(impact?.basis ?? basis) === "includes_fee" ? "Totals stay; the fee comes out of the vehicle price" : "Rows will be updated only when values differ"} />
                  {scope === "all" ? (
                    <Tile value={impact ? impact.includedArchived.toLocaleString() : "Unknown"} label="archived vehicles included" hint="Archived records will be recalculated too" />
                  ) : (
                    <Tile value={impact ? impact.excludedArchived.toLocaleString() : "Unknown"} label="archived vehicles excluded" hint="No changes will be made to archived records" />
                  )}
                </div>
                {impact && impact.unchanged > 0 && <p className="mt-2 text-[12px] leading-[18px] text-adm-muted">{impact.unchanged.toLocaleString()} {impact.unchanged === 1 ? "vehicle already carries" : "vehicles already carry"} these values and will not be touched.</p>}
              </section>
            </div>

            <section aria-labelledby="fee-sample-impact" data-landmark="fee-example-impact" className="max-md:mt-5 md:-mt-0.5">
              <h3 id="fee-sample-impact" className="text-[16px] leading-[22px] font-semibold text-adm-ink">Example vehicle impact</h3>
              {impact && impact.samples.length > 0 ? (
                <>
                <ul className="md:hidden mt-[11px] space-y-2" aria-label="Example vehicles">
                  {impact.samples.map((s) => (
                    <li key={s.vinSuffix} className="rounded-[6px] border border-adm-border px-3 pt-3 pb-1">
                      <div className="flex items-center gap-3">
                        <Thumb />
                        <div className="min-w-0">
                          <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{s.vehicle}</p>
                          <p className="text-[13px] leading-[18px] text-adm-muted">{s.stock ? `Stock ${s.stock}` : `VIN …${s.vinSuffix}`}</p>
                        </div>
                      </div>
                      <dl className="mt-2 divide-y divide-adm-border">
                        <div className="flex items-start justify-between gap-3 py-2">
                          <dt className="text-[13px] leading-[20px] font-semibold text-adm-ink">Selling price</dt>
                          <dd className="flex flex-col items-end"><SellingChange s={s} /></dd>
                        </div>
                        <div className="flex items-start justify-between gap-3 py-2">
                          <dt className="text-[13px] leading-[20px] font-semibold text-adm-ink">Document fee</dt>
                          <dd className="flex flex-col items-end"><Change before={s.feeBefore} after={s.feeAfter} /></dd>
                        </div>
                        <div className="flex items-start justify-between gap-3 py-2">
                          <dt className="text-[13px] leading-[20px] font-semibold text-adm-ink">Advertised total</dt>
                          <dd className="flex flex-col items-end"><Change before={s.totalBefore} after={s.totalAfter} /></dd>
                        </div>
                      </dl>
                      {s.sourceMismatch && <p className="pb-2 text-[12px] leading-[18px] text-adm-warning">{MISMATCH_NOTE}</p>}
                    </li>
                  ))}
                </ul>
                <div className="max-md:hidden mt-[11px] rounded-[6px] border border-adm-border overflow-hidden">
                  <AdminTable caption="Example vehicles" className={cn(TABLE_CLASS, "[&_th]:pt-[9px] [&_td]:py-[11px]")}>
                    <thead>
                      <tr>
                        <Th className="w-[258px]">Vehicle</Th>
                        <Th className="w-[168px]">Selling price</Th>
                        <Th className="w-[192px]">Document fee</Th>
                        <Th>Advertised total</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {impact.samples.map((s) => (
                        <tr key={s.vinSuffix}>
                          <Td>
                            <div className="flex items-center gap-4">
                              <Thumb />
                              <div className="min-w-0">
                                <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{s.vehicle}</p>
                                <p className="text-[13px] leading-[18px] text-adm-muted" title={`VIN …${s.vinSuffix}`}>{s.stock ? `Stock ${s.stock}` : `VIN …${s.vinSuffix}`}</p>
                              </div>
                            </div>
                          </Td>
                          <Td><SellingChange s={s} /></Td>
                          <Td><Change before={s.feeBefore} after={s.feeAfter} /></Td>
                          <Td>
                            <Change before={s.totalBefore} after={s.totalAfter} />
                            {s.sourceMismatch && <p className="text-[12px] leading-[18px] text-adm-warning">{MISMATCH_NOTE}</p>}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </AdminTable>
                </div>
                </>
              ) : (
                <p className="mt-2.5 text-[13px] text-adm-muted">{impact ? "No vehicle would change." : "The example rows are not available."}</p>
              )}
            </section>

            <div className="mt-[19px] space-y-[9px] [&>div]:py-[7.5px] [&>div>svg]:w-6 [&>div>svg]:h-6">
              {previewResult?.source === "client" ? null : (
                <InlineNote tone="warning" className="border-[#FCE3B6]">Source verification dates and mismatch flags will be preserved.</InlineNote>
              )}
              {blocked && <InlineNote tone="danger" title="This change cannot be applied yet.">{blocked}</InlineNote>}
              {scope === "active" && <InlineNote tone="neutral">Archived records require a separate authorized action.</InlineNote>}
              {impact?.warnings.filter((w) => w !== describeFeeBasis("includes_fee") && w !== describeFeeBasis("before_fee")).map((w) => (
                <InlineNote key={w} tone="warning">{w}</InlineNote>
              ))}
              {previewResult?.notes.map((n) => (
                <InlineNote key={n} tone="info">{n}</InlineNote>
              ))}
              {impact?.exclusions.filter((x) => !/^Archived records/.test(x)).map((x) => (
                <InlineNote key={x} tone="neutral">{x}</InlineNote>
              ))}
            </div>
          </>
        )}

        {step === 3 && state.result && (
          <div className="mt-0 space-y-3">
            <div className="flex items-center gap-3">
              <StatusChip tone={RESULT_TONE[state.result.status]} icon>{RESULT_LABEL[state.result.status]}</StatusChip>
              {state.result.affected != null && <span className="text-[13px] text-adm-muted">{state.result.affected.toLocaleString()} {state.result.affected === 1 ? "vehicle" : "vehicles"} updated</span>}
            </div>
            <p className="text-[14px] leading-[20px] text-adm-ink">{state.result.message}</p>
            {state.result.auditEventId && <p className="text-[12px] leading-[18px] text-adm-muted">Audit event {state.result.auditEventId}</p>}
          </div>
        )}
        {step === 3 && !state.result && state.error && <InlineNote tone="danger" className="mt-0">{state.error}</InlineNote>}
        </div>

        <footer className="flex items-start justify-between gap-x-4 gap-y-2 flex-wrap">
          <div className="flex items-center gap-2">
            {step === 1 && (
              <Link to={backHref} state={returnState} className="inline-flex items-center justify-center min-h-[36px] px-4 rounded-md border border-adm-border bg-adm-surface text-[14px] font-semibold text-adm-ink hover:bg-adm-workspace">Cancel</Link>
            )}
            {step === 2 && (
              <AdminButton data-landmark="fee-back" onClick={() => dispatch({ type: "edit", draft: state.draft })} disabled={state.phase === "applying"}>
                <ArrowLeft className="w-5 h-5" aria-hidden="true" />
                Back to edit
              </AdminButton>
            )}
            {step === 3 && state.result?.status !== "applied" && (
              <AdminButton onClick={() => dispatch({ type: "edit", draft: state.draft })}>
                <ArrowLeft className="w-5 h-5" aria-hidden="true" />
                Back to edit
              </AdminButton>
            )}
          </div>
          <p className="text-[12px] leading-[18px] text-adm-muted text-right">{footNote}</p>
        </footer>
        </section>
      </div>
    </AdminPageContainer>
  );
}
