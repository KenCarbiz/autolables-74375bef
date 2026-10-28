import { useEffect, useMemo, useReducer, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAudit } from "@/contexts/AuditContext";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useProductRules, type ProductRule } from "@/hooks/useProductRules";
import { getDealerDocumentRules } from "@/lib/documentRules";
import { useAdminNow, useViewFixture } from "@/lib/admin/dataSource";
import { ADMIN_SECTIONS, adminTabHref } from "@/lib/admin/sections";
import { canApply, initialReviewApply, isUnchanged, newIdempotencyKey, reviewApplyReducer, type ReviewApplyEvent, type ReviewApplyState } from "@/lib/admin/reviewApply";
import {
  draftFromRule,
  draftToRulePatch,
  evidenceChecklist,
  priceTreatmentOf,
  sampleResult,
  validateApplicabilityDraft,
  PROOF_LABEL,
  PUBLICATION_LABEL,
  type ApplicabilityDraft,
  type EvidenceItemState,
  type PriceTreatment,
  type ProofState,
  type PublicationState,
  type SampleVehicle,
} from "@/lib/admin/pricing/productApplicability";
import { fmtMoney } from "@/lib/admin/pricing/feePolicy";
import { ChildPageFrame } from "@/components/admin/v2/AdminShell";
import { AdminButton, AdminCard, AdminLinkButton, AdminTable, InlineNote, SkeletonBlock, StatusChip, Td, Th, type Tone } from "@/components/admin/v2/primitives";
import { tenantIdOf, useInstallProofCounts, useProduct, useSampleVehicles, type AdminProduct } from "@/pages/admin/views/pricing/pricingData";
import { AdminInput, AdminSelect, CheckRow, Field } from "@/pages/admin/views/pricing/ui";
import { cn } from "@/lib/utils";

// Product applicability: the condition, mileage and model-year limits for one
// product, its price treatment, the evidence a vehicle needs before the
// product can be published with it, and real scoped vehicles run through the
// same rule matcher the addendum uses. Eligible is never read as installed;
// a proof is reported only when a verified record exists.

export interface ProductApplicabilityFixture {
  product: AdminProduct;
  rule: ProductRule | null;
  vehicles: SampleVehicle[];
  /** Verified-proof count per VIN, or null when the read failed. */
  proofs: Record<string, number> | null;
  policy: { requireManagerApproval: boolean; requireInstallVerification: boolean };
  rulesExist: boolean;
}

interface PolicyDraft {
  rule: ApplicabilityDraft;
  treatment: PriceTreatment;
  price: number;
}

type State = ReviewApplyState<PolicyDraft>;
type Event = ReviewApplyEvent<PolicyDraft>;
const reduce = (s: State, e: Event): State => reviewApplyReducer(s, e);

const EVIDENCE_TONE: Record<EvidenceItemState, Tone> = { complete: "success", pending: "neutral", required: "warning", manager_required: "info", not_required: "neutral" };
const EVIDENCE_STATE_LABEL: Record<EvidenceItemState, string> = { complete: "Complete", pending: "Pending", required: "Required", manager_required: "Manager required", not_required: "Not required" };
const PROOF_TONE: Record<ProofState, Tone> = { attached: "success", missing: "danger", excluded: "neutral", not_required: "neutral", unknown: "neutral" };
const PUBLICATION_TONE: Record<PublicationState, Tone> = { blocked: "danger", ready_for_review: "info", publishable: "success", not_published: "neutral", unknown: "neutral" };

const conditionSummary = (c: ApplicabilityDraft["conditions"]): string => {
  const parts = [c.new ? "New" : null, c.used ? "Used" : null, c.cpo ? "CPO" : null].filter(Boolean);
  return parts.length === 3 ? "New, Used and CPO" : parts.join(" and ") || "None";
};

const describeChanges = (before: PolicyDraft, after: PolicyDraft): Array<{ field: string; before: string; after: string }> => {
  const rows: Array<{ field: string; before: string; after: string }> = [];
  if (!isUnchanged(before.rule.conditions, after.rule.conditions)) rows.push({ field: "Condition", before: conditionSummary(before.rule.conditions), after: conditionSummary(after.rule.conditions) });
  if ((before.rule.mileageMax ?? 0) !== (after.rule.mileageMax ?? 0)) rows.push({ field: "Mileage", before: before.rule.mileageMax ? `Up to ${before.rule.mileageMax.toLocaleString()} mi` : "No limit", after: after.rule.mileageMax ? `Up to ${after.rule.mileageMax.toLocaleString()} mi` : "No limit" });
  if (before.rule.yearMin !== after.rule.yearMin || before.rule.yearMax !== after.rule.yearMax) rows.push({ field: "Model years", before: `${before.rule.yearMin || "Any"} to ${before.rule.yearMax || "Any"}`, after: `${after.rule.yearMin || "Any"} to ${after.rule.yearMax || "Any"}` });
  if (before.treatment !== after.treatment) rows.push({ field: "Price treatment", before: before.treatment === "installed" ? "Installed product" : "Optional accessory", after: after.treatment === "installed" ? "Installed product" : "Optional accessory" });
  if (before.price !== after.price) rows.push({ field: "Price", before: fmtMoney(before.price), after: fmtMoney(after.price) });
  return rows;
};

export default function ProductApplicabilityPage() {
  const fixture = useViewFixture<ProductApplicabilityFixture>("product-applicability");
  const { productId: paramId } = useParams<{ productId: string }>();
  const productId = fixture ? fixture.product.id : paramId ?? null;
  const qc = useQueryClient();
  const { user } = useAuth();
  const audit = useAudit();
  const { tenant } = useTenant();
  const { settings } = useDealerSettings();
  const tenantId = tenantIdOf(tenant);
  const now = useAdminNow();
  const live = !fixture;

  const productQuery = useProduct(productId, live);
  const { rules, loading: rulesLoading, addRule, updateRule } = useProductRules();
  const vehiclesQuery = useSampleVehicles(tenantId, 6, live);

  const product = fixture?.product ?? productQuery.data ?? null;
  const rule = useMemo<ProductRule | null>(() => (fixture ? fixture.rule : rules.find((r) => r.product_id === productId) ?? null), [fixture, rules, productId]);
  const rulesExist = fixture ? fixture.rulesExist : rules.some((r) => r.product_id === productId);
  const vehicles = useMemo(() => fixture?.vehicles ?? vehiclesQuery.data ?? [], [fixture, vehiclesQuery.data]);
  const vins = useMemo(() => vehicles.map((v) => v.vin), [vehicles]);
  const proofsQuery = useInstallProofCounts(tenantId, productId, vins, live && vins.length > 0);
  const proofs: Record<string, number> | null = fixture ? fixture.proofs : proofsQuery.isError ? null : proofsQuery.data ?? (vins.length === 0 ? {} : null);
  const proofsLoading = live && vins.length > 0 && proofsQuery.isLoading;
  const policy = fixture?.policy ?? {
    requireManagerApproval: getDealerDocumentRules(settings).requireApprovalBeforePublish,
    requireInstallVerification: !!settings.require_install_verification,
  };

  const stored = useMemo<PolicyDraft | null>(() => {
    if (!product) return null;
    return { rule: draftFromRule(rule), treatment: priceTreatmentOf(product).treatment, price: Number(product.price) || 0 };
  }, [product, rule]);

  const [state, dispatch] = useReducer(reduce, null, (): State => initialReviewApply<PolicyDraft>({ rule: draftFromRule(null), treatment: "installed", price: 0 }));
  const synced = useRef(false);
  useEffect(() => {
    if (!stored || synced.current) return;
    if (live && rulesLoading) return;
    synced.current = true;
    dispatch({ type: "reset", original: stored });
  }, [stored, live, rulesLoading]);

  const draft = state.draft;
  const setRule = (patch: Partial<ApplicabilityDraft>) => dispatch({ type: "edit", draft: { ...draft, rule: { ...draft.rule, ...patch } } });
  const setConditions = (patch: Partial<ApplicabilityDraft["conditions"]>) => {
    const next = { ...draft.rule.conditions, ...patch };
    if ("used" in patch) next.cpo = !!patch.used;
    setRule({ conditions: next });
  };

  const errors = validateApplicabilityDraft(draft.rule);
  const dirty = synced.current && !isUnchanged(draft, state.original);
  const checklist = product ? evidenceChecklist({ ...product, available_preinstalled: draft.treatment === "installed" ? product.available_preinstalled : false, badge_type: draft.treatment === "installed" ? "installed" : "optional" }, policy, rulesExist) : [];
  const results = vehicles.map((v) => sampleResult(draft.rule, draft.treatment, policy, v, proofs ? proofs[v.vin.toUpperCase()] ?? 0 : null));
  const yearNow = new Date(now).getFullYear();
  const years = Array.from({ length: yearNow + 1 - 2008 + 1 }, (_, i) => String(yearNow + 1 - i));

  const startReview = () => {
    dispatch({ type: "validate", errors });
    if (errors.length) return;
    dispatch({
      type: "review",
      impact: { computedAt: new Date(now).toISOString(), version: rule?.id ?? "new", counts: { eligibleSamples: results.filter((r) => r.eligible).length }, samples: results, warnings: [], exclusions: [] },
      idempotencyKey: newIdempotencyKey("applicability"),
    });
  };

  const apply = async () => {
    if (!productId || !product) return;
    const gate = canApply(state);
    if (!gate.ok) { dispatch({ type: "error", message: gate.reason ?? "The change cannot be applied." }); return; }
    dispatch({ type: "apply" });
    try {
      const patch = draftToRulePatch(draft.rule);
      let ruleId = rule?.id ?? null;
      if (rule) await updateRule(rule.id, patch);
      else {
        const created = await addRule({ product_id: productId, makes: [], models: [], trims: [], body_styles: [], ...patch });
        ruleId = created?.id ?? null;
      }
      const treatmentChanged = draft.treatment !== state.original.treatment || draft.price !== state.original.price;
      if (treatmentChanged) {
        const { error } = await supabase
          .from("products")
          .update({ badge_type: draft.treatment, price_label: draft.treatment === "installed" ? "Included in Selling Price" : "If Accepted", price: draft.price })
          .eq("id", productId);
        if (error) throw new Error(error.message);
      }
      audit.log({
        store_id: tenantId ?? "",
        user_id: user?.id ?? "",
        action: rule ? "rule_updated" : "rule_added",
        entity_type: "product_rule",
        entity_id: ruleId ?? productId,
        details: { product_id: productId, ...patch, treatment: draft.treatment, price: draft.price, changes: describeChanges(state.original, draft) },
      });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product_rules"] });
      qc.invalidateQueries({ queryKey: ["admin-v2"] });
      dispatch({ type: "result", result: { status: "applied", affected: 1, message: "Applicability saved. Addenda built from now on use the new limits." } });
    } catch (e) {
      dispatch({ type: "error", message: e instanceof Error ? e.message : "The change could not be saved." });
    }
  };

  const crumbs = [
    { label: "Administration", href: "/admin" },
    { label: "Pricing & Products", href: adminTabHref("price-rules") },
    { label: "Products", href: adminTabHref("products") },
    { label: product?.name ?? "Product" },
  ];
  const badge = !product ? null : dirty ? <StatusChip tone="warning">Unsaved changes</StatusChip> : !product.is_active ? <StatusChip tone="neutral">Draft policy</StatusChip> : rule ? <StatusChip tone="success">Active policy</StatusChip> : <StatusChip tone="neutral">No limits</StatusChip>;
  const editorHref = (focus: string) => `${adminTabHref("products")}&product=${encodeURIComponent(productId ?? "")}&focus=${focus}`;
  const tabs = [
    { id: "details", label: "Details", href: editorHref("details") },
    { id: "applicability", label: "Applicability", href: "#", active: true },
    { id: "evidence", label: "Installation evidence", href: editorHref("document") },
    { id: "disclosures", label: "Disclosures", href: editorHref("disclosures") },
  ];
  const pricingSection = ADMIN_SECTIONS.find((s) => s.id === "pricing");

  if (live && (productQuery.isLoading || !productId)) {
    return (
      <ChildPageFrame crumbs={crumbs} title={<SkeletonBlock className="h-9 w-72" />} backHref={adminTabHref("applicability")} backLabel="Back to applicability">
        <SkeletonBlock className="h-64 w-full" />
      </ChildPageFrame>
    );
  }
  if (!product) {
    return (
      <ChildPageFrame crumbs={crumbs} title="Product not found" backHref={adminTabHref("products")} backLabel="Back to products">
        <InlineNote tone="danger">{productQuery.isError ? "The product could not be read." : "This product does not exist for your dealership."}</InlineNote>
      </ChildPageFrame>
    );
  }

  return (
    <ChildPageFrame
      crumbs={crumbs}
      title={product.name}
      badge={badge}
      subtitle={pricingSection?.description}
      backHref={adminTabHref("applicability")}
      backLabel="Back to applicability"
      tabs={
        <nav aria-label="Product views" className="border-b border-adm-border overflow-x-auto">
          <ul className="flex items-stretch gap-5 min-w-max">
            {tabs.map((t) => (
              <li key={t.id}>
                <Link
                  to={t.href}
                  aria-current={t.active ? "page" : undefined}
                  className={cn("inline-flex items-center h-9 text-[13px] leading-[18px] font-semibold whitespace-nowrap border-b-2 -mb-px", t.active ? "text-adm-primary border-adm-primary" : "text-adm-muted border-transparent hover:text-adm-ink")}
                >
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      }
    >
      <div className="space-y-4">
        {state.phase === "applied" && state.result && <InlineNote tone="success" title="Applied">{state.result.message}</InlineNote>}
        {state.error && state.phase !== "applied" && <InlineNote tone="danger">{state.error}</InlineNote>}

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-4 items-start">
          <div className="space-y-4">
            <AdminCard title="Applicability rules" description="Vehicles outside these limits never receive this product on an addendum.">
              <div className="space-y-5">
                <fieldset>
                  <legend className="text-[12px] leading-[18px] font-semibold text-adm-muted mb-1">Condition</legend>
                  <CheckRow checked={draft.rule.conditions.new} onChange={(v) => setConditions({ new: v })} label="New" />
                  <CheckRow checked={draft.rule.conditions.used} onChange={(v) => setConditions({ used: v })} label="Used" />
                  <CheckRow checked={draft.rule.conditions.cpo} onChange={() => undefined} disabled label="Certified pre-owned" detail="Follows Used in the current rule model." />
                </fieldset>
                <fieldset>
                  <legend className="text-[12px] leading-[18px] font-semibold text-adm-muted mb-1">Mileage</legend>
                  <CheckRow type="radio" name="mileage" checked={draft.rule.mileageMax == null} onChange={() => setRule({ mileageMax: null })} label="No limit" />
                  <CheckRow type="radio" name="mileage" checked={draft.rule.mileageMax != null} onChange={() => setRule({ mileageMax: draft.rule.mileageMax ?? 100_000 })} label="Set maximum mileage" />
                  {draft.rule.mileageMax != null && (
                    <div className="pl-8 mt-1 max-w-[220px]">
                      <AdminInput type="number" min={0} step={1000} value={draft.rule.mileageMax} onChange={(e) => setRule({ mileageMax: Number(e.target.value) })} aria-label="Maximum mileage" />
                    </div>
                  )}
                </fieldset>
                <div className="grid grid-cols-2 gap-3 max-w-[460px]">
                  <Field label="Model year from" htmlFor="year-min">
                    <AdminSelect id="year-min" value={draft.rule.yearMin} onChange={(e) => setRule({ yearMin: e.target.value })}>
                      <option value="">Any</option>
                      {years.map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </AdminSelect>
                  </Field>
                  <Field label="Model year to" htmlFor="year-max">
                    <AdminSelect id="year-max" value={draft.rule.yearMax} onChange={(e) => setRule({ yearMax: e.target.value })}>
                      <option value="">Any</option>
                      {years.map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </AdminSelect>
                  </Field>
                </div>
                {errors.length > 0 && <InlineNote tone="danger">{errors.join(" ")}</InlineNote>}
              </div>
            </AdminCard>

            <AdminCard title="Price treatment">
              <div className="space-y-3">
                <CheckRow type="radio" name="treatment" checked={draft.treatment === "installed"} onChange={() => dispatch({ type: "edit", draft: { ...draft, treatment: "installed" } })} label="Installed product" detail="Added to the vehicle and itemized inside the advertised price." />
                <CheckRow type="radio" name="treatment" checked={draft.treatment === "optional"} onChange={() => dispatch({ type: "edit", draft: { ...draft, treatment: "optional" } })} label="Optional accessory" detail="Customer can choose to add at time of purchase." />
                <Field label="Price" htmlFor="product-price" className="max-w-[220px]">
                  <AdminInput id="product-price" type="number" min={0} step="0.01" value={draft.price} onChange={(e) => dispatch({ type: "edit", draft: { ...draft, price: Number(e.target.value) || 0 } })} />
                </Field>
                <InlineNote tone="info">Installed status requires proof before publication.</InlineNote>
              </div>
            </AdminCard>
          </div>

          <div className="space-y-4">
            <AdminCard title="Evidence checklist">
              <ul className="divide-y divide-adm-border -my-1">
                {checklist.map((item) => (
                  <li key={item.key} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{item.label}</p>
                      <p className="text-[12px] leading-[18px] text-adm-muted">{item.detail}</p>
                    </div>
                    <StatusChip tone={EVIDENCE_TONE[item.state]}>{EVIDENCE_STATE_LABEL[item.state]}</StatusChip>
                  </li>
                ))}
              </ul>
            </AdminCard>

            <AdminCard title="Sample vehicle results" description="Real vehicles from your inventory, run through the same matcher the addendum uses." flush>
              {live && vehiclesQuery.isLoading ? (
                <p className="px-6 pb-6 text-[13px] text-adm-muted">Loading vehicles…</p>
              ) : live && vehiclesQuery.isError ? (
                <p role="status" className="px-6 pb-6 text-[13px] text-adm-muted">Inventory could not be read, so sample results are Unknown.</p>
              ) : vehicles.length === 0 ? (
                <p className="px-6 pb-6 text-[13px] text-adm-muted">No active vehicles to sample yet.</p>
              ) : (
                <AdminTable caption="Sample vehicle results">
                  <thead>
                    <tr>
                      <Th>Vehicle</Th>
                      <Th>Eligible</Th>
                      <Th>Evidence</Th>
                      <Th>Publication</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.vehicle.vin}>
                        <Td>
                          <p className="font-semibold text-adm-ink">{[r.vehicle.year, r.vehicle.make, r.vehicle.model].filter(Boolean).join(" ")}</p>
                          <p className="text-[12px] leading-[18px] text-adm-muted">{[r.vehicle.trim, r.vehicle.condition, r.vehicle.mileage != null ? `${r.vehicle.mileage.toLocaleString()} mi` : null].filter(Boolean).join(" · ")}</p>
                        </Td>
                        <Td><StatusChip tone={r.eligible ? "success" : "neutral"}>{r.eligible ? "Eligible" : "Not eligible"}</StatusChip></Td>
                        <Td>{proofsLoading && r.eligible && r.proof === "unknown" ? <span className="text-adm-muted text-[12px]">Checking…</span> : <StatusChip tone={PROOF_TONE[r.proof]}>{PROOF_LABEL[r.proof]}</StatusChip>}</Td>
                        <Td>{proofsLoading && r.eligible && r.publication === "unknown" ? <span className="text-adm-muted text-[12px]">Checking…</span> : <StatusChip tone={PUBLICATION_TONE[r.publication]}>{PUBLICATION_LABEL[r.publication]}</StatusChip>}</Td>
                      </tr>
                    ))}
                  </tbody>
                </AdminTable>
              )}
            </AdminCard>
          </div>
        </div>

        {(state.phase === "reviewing" || state.phase === "applying") && (
          <AdminCard title="Review changes" description="These changes apply to every addendum built after they are saved.">
            <div className="rounded-[10px] border border-adm-border overflow-hidden">
              <AdminTable caption="Changes to apply">
                <thead>
                  <tr>
                    <Th>Field</Th>
                    <Th>Before</Th>
                    <Th>After</Th>
                  </tr>
                </thead>
                <tbody>
                  {describeChanges(state.original, draft).map((row) => (
                    <tr key={row.field}>
                      <Td className="text-adm-muted">{row.field}</Td>
                      <Td>{row.before}</Td>
                      <Td className="font-semibold">{row.after}</Td>
                    </tr>
                  ))}
                </tbody>
              </AdminTable>
            </div>
            <p className="mt-3 text-[12px] leading-[18px] text-adm-muted">{results.filter((r) => r.eligible).length} of {results.length} sampled vehicles would be eligible. Change will be audited.</p>
          </AdminCard>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-adm-border pt-4">
          <AdminLinkButton to={adminTabHref("applicability")}>Cancel</AdminLinkButton>
          {state.phase === "reviewing" || state.phase === "applying" ? (
            <>
              <AdminButton onClick={() => dispatch({ type: "edit", draft })} disabled={state.phase === "applying"}>Back to edit</AdminButton>
              <AdminButton variant="primary" onClick={apply} disabled={state.phase === "applying" || !canApply(state).ok || !tenantId}>{state.phase === "applying" ? "Applying…" : "Apply changes"}</AdminButton>
            </>
          ) : (
            <AdminButton variant="primary" onClick={startReview} disabled={!dirty || errors.length > 0}>Review changes</AdminButton>
          )}
        </div>
      </div>
    </ChildPageFrame>
  );
}
