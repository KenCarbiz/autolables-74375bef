import { useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowLeft, Car, Check, MoveRight, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useAudit } from "@/contexts/AuditContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { useViewFixture } from "@/lib/admin/dataSource";
import { ADMIN_SECTIONS, adminTabHref, firstVisibleTab, resolveAdminTab, visibleSections, visibleTabs, type AdminVisibilityContext } from "@/lib/admin/sections";
import { canApply, initialReviewApply, newIdempotencyKey, reviewApplyReducer, type ImpactSnapshot, type ReviewApplyEvent, type ReviewApplyState } from "@/lib/admin/reviewApply";
import { feeChangeDiff, feeDraftFromSettings, feeDraftWarnings, fmtMoney, validateFeeDraft, type FeeDraft } from "@/lib/admin/pricing/feePolicy";
import { STATE_DOC_FEES } from "@/data/docFees";
import type { PriceDisplayMode } from "@/lib/priceModel";
import { AdminPageContainer, AdminShell } from "@/components/admin/v2/AdminShell";
import { AdminButton, AdminTable, InlineNote, SkeletonBlock, StatusChip, Td, Th, type Tone } from "@/components/admin/v2/primitives";
import { applyFeeChange, loadPolicyVersion, parseFeeReviewParams, tenantIdOf, useFeePreview, usePolicyVersion, type FeePreviewResult, type FeeScope, type PolicyVersion } from "@/pages/admin/views/pricing/pricingData";
import { AdminInput, AdminSelect, Field } from "@/pages/admin/views/pricing/ui";
import PriceRulesView from "@/pages/admin/views/pricing/PriceRulesView";
import { cn } from "@/lib/utils";

// Fee Change Review: Edit, Review, Apply. The dialog sits over the Price rules
// page it came from and dims only the workspace, as the reference draws it.
// Opening it writes nothing; the impact is computed for the exact draft under
// review; apply is refused for a stale review, an unknown count, an unknown
// policy version or a role without pricing authority. The shared server
// contracts are called by name and, until they are installed, the existing
// recalculation routine is used with its consequences stated.

export interface FeeReviewFixture {
  before: FeeDraft;
  after: FeeDraft;
  mode: PriceDisplayMode;
  scope: FeeScope;
  version: PolicyVersion;
  preview: FeePreviewResult;
  canManage: boolean;
}

const APPLY_ROLES = new Set(["owner", "admin", "general_manager", "gsm"]);
const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
// The dialog top sits 123px under the product header in the reference frame.
const DIALOG_TOP = 123;

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

type StepStatus = "done" | "current" | "todo";

// 38px circle, 18px check or 16px digit, 13/11px label pair, as measured.
const StepItem = ({ n, label, status, trailing = false }: { n: number; label: string; status: StepStatus; trailing?: boolean }) => (
  <li className={cn("flex items-center", trailing && "flex-1")}>
    <div className="flex items-center gap-3.5" data-landmark="fee-review-step">
      <span
        aria-hidden="true"
        className={cn("w-[38px] h-[38px] rounded-full flex items-center justify-center text-[16px] font-semibold flex-shrink-0", status === "todo" ? "bg-[#E8EBEF] text-adm-muted" : "bg-adm-primary text-white")}
      >
        {status === "done" ? <Check className="w-[18px] h-[18px]" strokeWidth={3} /> : n}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] leading-[18px] font-semibold text-adm-ink whitespace-nowrap">
          {status === "done" && <span className="text-adm-primary mr-1.5">{n}</span>}
          {label}
        </span>
        <span className="block text-[11px] leading-[16px] text-adm-muted whitespace-nowrap">{status === "done" ? "Completed" : status === "current" ? "Current step" : "Not started"}</span>
      </span>
    </div>
    {trailing && <span aria-hidden="true" className="hidden sm:block flex-1 h-px bg-adm-border ml-[18px] mr-[13px]" />}
  </li>
);

const Tile = ({ icon: Icon, tone, value, label, hint }: { icon: typeof Car; tone: "success" | "neutral"; value: string; label: string; hint: string }) => (
  <div data-landmark="fee-impact-tile" className="flex items-start gap-4 rounded-[8px] border border-adm-border bg-adm-workspace px-4 py-[13px]">
    <span aria-hidden="true" className={cn("w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0", tone === "success" ? "bg-adm-success-bg text-adm-success" : "bg-adm-border/50 text-adm-muted")}>
      <Icon className="w-7 h-7" />
    </span>
    <div className="min-w-0">
      <p data-landmark="impact-count" className="text-[24px] leading-[28px] font-bold text-adm-ink tabular-nums">{value}</p>
      <p className="text-[15px] leading-[20px] font-semibold text-adm-ink">{label}</p>
      <p className="text-[13px] leading-[18px] text-adm-muted">{hint}</p>
    </div>
  </div>
);

const Thumb = () => <span aria-hidden="true" className="w-[65px] h-10 rounded-md bg-adm-workspace flex-shrink-0 inline-block" />;

const DeltaMark = ({ down = false }: { down?: boolean }) => (
  <svg viewBox="0 0 14 9" className={cn("w-[14px] h-[9px] fill-current flex-shrink-0", down && "rotate-180")} aria-hidden="true">
    <path d="M7 0.5 13.5 8.5H0.5z" />
  </svg>
);

const Change = ({ before, after }: { before: number | null; after: number }) => {
  const d = before == null ? null : after - before;
  const up = d != null && d > 0.005;
  const down = d != null && d < -0.005;
  return (
    <>
      <p className="flex items-center gap-2 h-5 text-[15px] leading-[20px] text-adm-ink tabular-nums whitespace-nowrap">
        <span>{fmtMoney(before)}</span>
        <MoveRight className="w-[26px] h-[26px] text-adm-muted flex-shrink-0" aria-hidden="true" />
        <span>{fmtMoney(after)}</span>
      </p>
      <p className={cn("mt-0 flex items-center gap-1.5 text-[13px] leading-[18px] tabular-nums", up ? "text-adm-danger" : down ? "text-adm-success" : "text-adm-muted")}>
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

const TABLE_CLASS = "[&_th]:py-2 [&_th]:text-[13px] [&_th]:text-adm-ink [&_th]:border-r [&_td]:border-r [&_th:last-child]:border-r-0 [&_td:last-child]:border-r-0 [&_tbody_tr:last-child>td]:border-b-0";

const RESULT_TONE: Record<"applied" | "partial" | "failed", Tone> = { applied: "success", partial: "warning", failed: "danger" };
const RESULT_LABEL: Record<"applied" | "partial" | "failed", string> = { applied: "Applied", partial: "Partially applied", failed: "Not applied" };

const BUTTON_41 = "h-[41px] px-6 text-[15px] gap-2.5";

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
  const { settings, updateSettings, reload } = useDealerSettings();
  const audit = useAudit();
  const tenantId = tenantIdOf(tenant);
  const live = !fixture;
  const dialogRef = useRef<HTMLDivElement>(null);

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

  const role = member?.role;
  const roleAllowed = isAdmin || APPLY_ROLES.has(`${role ?? ""}`.trim().toLowerCase());
  const canManage = fixture ? fixture.canManage : roleAllowed && hasDealerCapability(role, "can_manage_settings", isAdmin);

  const previewing = state.phase === "validating" || state.phase === "reviewing" || state.phase === "applying";
  const preview = useFeePreview({ tenantId, draft: state.draft, includeArchived: scope === "all", enabled: live && previewing });
  const version = usePolicyVersion(tenantId, live && previewing);

  useEffect(() => {
    if (fixture || state.phase !== "validating") return;
    if (!tenantId) { dispatch({ type: "invalidate", reason: "No dealership context; the impact cannot be computed." }); return; }
    if (preview.isError) { dispatch({ type: "invalidate", reason: preview.error instanceof Error ? preview.error.message : "The impact could not be computed." }); return; }
    if (!preview.data || version.isLoading) return;
    dispatch({ type: "review", impact: snapshotOf(preview.data, version.data?.version ?? null), idempotencyKey: newIdempotencyKey("doc-fee") });
  }, [fixture, state.phase, tenantId, preview.data, preview.isError, preview.error, version.data, version.isLoading]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const backHref = adminTabHref("price-rules");
  const close = () => navigate(backHref);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

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
  const applyReason = !canManage
    ? "Your role cannot apply pricing changes. Ask an owner, general manager or GSM."
    : !versionKnown
      ? "The policy version could not be read, so the change cannot be applied safely."
      : gate.ok
        ? null
        : gate.reason ?? null;
  const applyEnabled = state.phase === "reviewing" && canManage && versionKnown && gate.ok && (fixture ? true : !!tenantId);

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
      updateSettings: (patch) => updateSettings(patch),
    });
    if (outcome.kind === "conflict") { dispatch({ type: "conflict", changedFields: ["doc_fee"] }); return; }
    if (outcome.path === "fallback" && outcome.result.status !== "failed") {
      audit.log({
        store_id: tenantId,
        user_id: user?.id ?? "",
        action: "settings_updated",
        entity_type: "doc_fee_policy",
        entity_id: tenantId,
        details: {
          before: state.original,
          after: state.draft,
          scope,
          idempotency_key: state.idempotencyKey,
          expected_version: state.impact.version,
          affected: outcome.result.affected,
          path: "recalc_tenant_doc_fee",
          status: outcome.result.status,
        },
      });
    }
    dispatch({ type: "result", result: outcome.result });
    qc.invalidateQueries({ queryKey: ["admin-v2"] });
    if (outcome.path === "server") void reload?.();
  };

  const ctx = useMemo<AdminVisibilityContext>(() => ({ role, isAdmin, features: { feature_product_rules: settings.feature_product_rules, feature_invoicing: settings.feature_invoicing, feature_warranty: settings.feature_warranty } }), [role, isAdmin, settings.feature_product_rules, settings.feature_invoicing, settings.feature_warranty]);
  const resolved = resolveAdminTab("price-rules");
  const sections = fixture ? [...ADMIN_SECTIONS] : visibleSections(ctx);
  const tabs = resolved ? (fixture ? resolved.section.tabs.filter((t) => !t.unpictured) : visibleTabs(resolved.section, ctx)) : [];

  const eligibleLabel = scope === "all" ? "vehicles" : "active vehicles";
  const eligibleCount = impact?.eligible ?? null;
  const applyLabel = state.phase === "applying" ? "Applying…" : `Apply to ${eligibleCount == null ? "Unknown" : eligibleCount.toLocaleString()} ${eligibleLabel}`;
  const footNote: ReactNode = step === 2 ? (applyReason ?? "Requires pricing-management permission. Change will be audited.") : step === 3 ? "This review is complete." : "Nothing is changed until the review is applied.";

  return (
    <div className="relative">
      <div aria-hidden="true" className="pointer-events-none select-none">
        {resolved && (
          <AdminShell sections={sections} activeSection={resolved.section} activeTab={resolved.tab} tabsForSection={tabs} firstTabFor={(s) => (fixture ? s.tabs[0] : firstVisibleTab(s, ctx))}>
            <PriceRulesView />
          </AdminShell>
        )}
      </div>
      <div className="absolute inset-0 z-40 bg-[#626A75]/[0.64]" onClick={close} aria-hidden="true" />
      {/* The reference draws the review 18px left of the content column centre on desktop; narrow widths centre it. */}
      <div aria-hidden="true" data-landmark="fee-review-top" className="absolute inset-x-0 top-0 pointer-events-none" style={{ height: DIALOG_TOP }} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fee-review-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{ top: DIALOG_TOP }}
        className="absolute z-50 left-1/2 -translate-x-1/2 lg:left-[calc(50%-18px)] w-[min(907px,calc(100%-32px))] rounded-[12px] border border-adm-border bg-adm-surface shadow-2xl outline-none px-7 pt-6 pb-6 text-adm-ink"
      >
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="fee-review-title" className="text-[22px] leading-[28px] font-bold text-adm-ink">Review document fee change</h2>
            <p className="mt-1 text-[13px] leading-[18px] text-adm-muted">Confirm the new fee and the vehicles it will update before anything is applied.</p>
          </div>
          <button type="button" onClick={close} aria-label="Close review" className="-mt-2 -mr-3 w-9 h-9 rounded-md inline-flex items-center justify-center text-adm-muted hover:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary flex-shrink-0">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </header>
        <ol className="mt-[17px] mx-auto flex items-center flex-wrap gap-y-3 w-full max-w-[640px]" data-landmark="fee-review-steps" aria-label="Review steps">
          <StepItem n={1} label="Edit" status={step > 1 ? "done" : "current"} trailing />
          <StepItem n={2} label="Review" status={step === 2 ? "current" : step > 2 ? "done" : "todo"} trailing />
          <StepItem n={3} label="Apply" status={step === 3 ? (state.phase === "applied" ? "done" : "current") : "todo"} />
        </ol>

        {step === 1 && (
          <div className="mt-[31px] space-y-5">
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
              <InlineNote tone="danger" className="mt-[31px]" title={state.phase === "conflict" ? "The policy changed after this review." : "The review is no longer valid."}>
                {state.phase === "conflict" ? "Reload and review the change again before applying it." : state.error}
              </InlineNote>
            )}
            {state.error && state.phase === "reviewing" && <InlineNote tone="danger" className="mt-[31px]">{state.error}</InlineNote>}

            <div className={cn("grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_312px] gap-7 items-start", state.phase === "conflict" || state.phase === "invalidated" || (state.error && state.phase === "reviewing") ? "mt-5" : "mt-[31px]")}>
              <section aria-labelledby="fee-change-summary" data-landmark="fee-change-summary">
                <h3 id="fee-change-summary" className="text-[16px] leading-[22px] font-semibold text-adm-ink">Change summary</h3>
                <div className="mt-2.5 rounded-[8px] border border-adm-border overflow-hidden">
                  <AdminTable caption="Before and after" className={cn(TABLE_CLASS, "[&_td]:py-[11px]")}>
                    <thead>
                      <tr>
                        <Th className="w-[192px]">Field</Th>
                        <Th className="w-[168px]">Before</Th>
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
                <div className="mt-2.5 space-y-2">
                  <Tile icon={Car} tone="success" value={eligibleCount == null ? "Unknown" : eligibleCount.toLocaleString()} label={`${eligibleLabel} eligible`} hint="Rows will be updated only when values differ" />
                  {scope === "all" ? (
                    <Tile icon={Archive} tone="neutral" value={impact ? impact.includedArchived.toLocaleString() : "Unknown"} label="archived vehicles included" hint="Archived records will be recalculated too" />
                  ) : (
                    <Tile icon={Archive} tone="neutral" value={impact ? impact.excludedArchived.toLocaleString() : "Unknown"} label="archived vehicles excluded" hint="No changes will be made to archived records" />
                  )}
                </div>
                {impact && impact.unchanged > 0 && <p className="mt-2 text-[12px] leading-[18px] text-adm-muted">{impact.unchanged.toLocaleString()} {impact.unchanged === 1 ? "vehicle already carries" : "vehicles already carry"} these values and will not be touched.</p>}
              </section>
            </div>

            <section aria-labelledby="fee-sample-impact" data-landmark="fee-example-impact" className="-mt-1">
              <h3 id="fee-sample-impact" className="text-[16px] leading-[22px] font-semibold text-adm-ink">Example vehicle impact</h3>
              {impact && impact.samples.length > 0 ? (
                <div className="mt-2.5 rounded-[8px] border border-adm-border overflow-hidden">
                  <AdminTable caption="Example vehicles" className={cn(TABLE_CLASS, "[&_td]:py-3")}>
                    <thead>
                      <tr>
                        <Th className="w-[300px]">Vehicle</Th>
                        <Th className="w-[140px]">Selling price</Th>
                        <Th className="w-[177px]">Document fee</Th>
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
                                <p className="text-[13px] leading-[18px] text-adm-muted">{s.stock ? `Stock ${s.stock} · ` : ""}VIN …{s.vinSuffix}</p>
                              </div>
                            </div>
                          </Td>
                          <Td>
                            <p className="text-[15px] leading-[20px] text-adm-ink tabular-nums">{fmtMoney(s.sellingPrice)}</p>
                            <p className="text-[13px] leading-[18px] text-adm-muted">No change</p>
                          </Td>
                          <Td><Change before={s.feeBefore} after={s.feeAfter} /></Td>
                          <Td><Change before={s.totalBefore} after={s.totalAfter} /></Td>
                        </tr>
                      ))}
                    </tbody>
                  </AdminTable>
                </div>
              ) : (
                <p className="mt-2.5 text-[13px] text-adm-muted">{impact ? "No vehicle would change." : "The example rows are not available."}</p>
              )}
            </section>

            <div className="mt-5 space-y-2 [&>div]:py-[7px] [&>div>svg]:w-[26px] [&>div>svg]:h-[26px]">
              {previewResult?.source === "client" ? (
                <InlineNote tone="warning">Until the dedicated routine is installed, applying uses the existing recalculation, which also updates archived vehicles and refreshes each recalculated vehicle's verification stamp.</InlineNote>
              ) : (
                <InlineNote tone="warning">Source verification dates and mismatch flags will be preserved.</InlineNote>
              )}
              {scope === "active" && <InlineNote tone="neutral">Archived records require a separate authorized action.</InlineNote>}
              {impact?.warnings.map((w) => (
                <InlineNote key={w} tone="warning">{w}</InlineNote>
              ))}
              {previewResult?.notes.filter((n) => !/existing recalculation/.test(n)).map((n) => (
                <InlineNote key={n} tone="info">{n}</InlineNote>
              ))}
              {impact?.exclusions.filter((x) => !/^Archived records/.test(x)).map((x) => (
                <InlineNote key={x} tone="neutral">{x}</InlineNote>
              ))}
            </div>
          </>
        )}

        {step === 3 && state.result && (
          <div className="mt-[31px] space-y-3">
            <div className="flex items-center gap-3">
              <StatusChip tone={RESULT_TONE[state.result.status]} icon>{RESULT_LABEL[state.result.status]}</StatusChip>
              {state.result.affected != null && <span className="text-[13px] text-adm-muted">{state.result.affected.toLocaleString()} {state.result.affected === 1 ? "vehicle" : "vehicles"} updated</span>}
            </div>
            <p className="text-[14px] leading-[20px] text-adm-ink">{state.result.message}</p>
            {state.result.auditEventId && <p className="text-[12px] leading-[18px] text-adm-muted">Audit event {state.result.auditEventId}</p>}
          </div>
        )}
        {step === 3 && !state.result && state.error && <InlineNote tone="danger" className="mt-[31px]">{state.error}</InlineNote>}

        <footer className="mt-6 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            {step === 1 && (
              <Link to={backHref} className="inline-flex items-center justify-center h-[41px] px-6 rounded-md border border-adm-border bg-adm-surface text-[15px] font-semibold text-adm-ink hover:bg-adm-workspace">Cancel</Link>
            )}
            {step === 2 && (
              <AdminButton data-landmark="fee-back" className={BUTTON_41} onClick={() => dispatch({ type: "edit", draft: state.draft })} disabled={state.phase === "applying"}>
                <ArrowLeft className="w-5 h-5" aria-hidden="true" />
                Back to edit
              </AdminButton>
            )}
            {step === 3 && state.result?.status !== "applied" && (
              <AdminButton className={BUTTON_41} onClick={() => dispatch({ type: "edit", draft: state.draft })}>
                <ArrowLeft className="w-5 h-5" aria-hidden="true" />
                Back to edit
              </AdminButton>
            )}
          </div>
          <div className="flex flex-col items-end min-w-0">
            {step === 1 && (
              <AdminButton variant="primary" className={BUTTON_41} disabled={unchanged || state.phase === "validating"} onClick={startReview}>{state.phase === "validating" ? "Computing…" : "Review changes"}</AdminButton>
            )}
            {step === 2 && (
              <AdminButton variant="primary" data-landmark="fee-apply" className="h-[41px] px-4 text-[15px]" disabled={!applyEnabled} onClick={onApply}>{applyLabel}</AdminButton>
            )}
            {step === 3 && (
              <AdminButton variant="primary" className={BUTTON_41} onClick={close}>Done</AdminButton>
            )}
            <p className="mt-1.5 text-[11px] leading-[16px] text-adm-muted text-right">{footNote}</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
