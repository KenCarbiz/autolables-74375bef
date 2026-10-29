import { useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Ban, Camera, CarFront, CheckCircle2, Clock, FileText, HelpCircle, Info, MinusCircle, User, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAudit } from "@/contexts/AuditContext";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useProductRules, type ProductRule } from "@/hooks/useProductRules";
import { getDealerDocumentRules } from "@/lib/documentRules";
import { useAdminNow, useViewFixture } from "@/lib/admin/dataSource";
import { adminTabHref } from "@/lib/admin/sections";
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
  type EvidenceItem,
  type EvidenceItemState,
  type PriceTreatment,
  type ProofState,
  type PublicationState,
  type SampleVehicle,
} from "@/lib/admin/pricing/productApplicability";
import { fmtMoney } from "@/lib/admin/pricing/feePolicy";
import { ChildPageFrame } from "@/components/admin/v2/AdminShell";
import { ScrollRegion } from "@/components/admin/v2/ScrollRegion";
import { AdminButton, AdminCard, AdminLinkButton, AdminTable, InlineNote, SkeletonBlock, StatusChip, Td, Th, type Tone } from "@/components/admin/v2/primitives";
import { tenantIdOf, useInstallProofCounts, useProduct, useSampleVehicles, type AdminProduct } from "@/pages/admin/views/pricing/pricingData";
import { AdminInput, AdminSelect, CheckRow } from "@/pages/admin/views/pricing/ui";
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

const EVIDENCE_TONE: Record<EvidenceItemState, Tone> = { complete: "success", pending: "warning", required: "danger", manager_required: "danger", not_required: "neutral" };
const EVIDENCE_STATE_LABEL: Record<EvidenceItemState, string> = { complete: "Complete", pending: "Pending", required: "Required", manager_required: "Manager required", not_required: "Not required" };
const EVIDENCE_ICON: Record<EvidenceItem["key"], typeof CarFront> = { applicable: CarFront, installation_proof: Camera, disclosure: FileText, approval: User };

type MarkIcon = typeof CarFront;
const PROOF_MARK: Record<ProofState, { icon: MarkIcon; tone: Tone }> = {
  attached: { icon: CheckCircle2, tone: "success" },
  missing: { icon: AlertCircle, tone: "danger" },
  excluded: { icon: MinusCircle, tone: "neutral" },
  not_required: { icon: MinusCircle, tone: "neutral" },
  unknown: { icon: HelpCircle, tone: "neutral" },
};
const PUBLICATION_MARK: Record<PublicationState, { icon: MarkIcon; tone: Tone }> = {
  blocked: { icon: Ban, tone: "danger" },
  ready_for_review: { icon: Clock, tone: "warning" },
  publishable: { icon: CheckCircle2, tone: "success" },
  not_published: { icon: MinusCircle, tone: "neutral" },
  unknown: { icon: HelpCircle, tone: "neutral" },
};
const MARK_TEXT: Record<Tone, string> = { success: "text-adm-success", danger: "text-adm-danger", warning: "text-adm-warning", neutral: "text-adm-muted", info: "text-adm-primary" };
const CONDITION_WORD: Record<string, string> = { new: "New", used: "Used", cpo: "CPO" };
const CHIP_CLASS = "rounded-full px-3 py-1.5 text-[13px] leading-[18px]";

// Status cell: a 19px mark (the reference's glyphs measure 16-17px) in the
// tone colour beside ink text; neutral marks are filled, as drawn.
const StateMark = ({ icon: Icon, tone, children }: { icon: MarkIcon; tone: Tone; children: ReactNode }) => (
  <span className="inline-flex items-center gap-2 text-[13px] leading-[20px] text-adm-ink">
    <Icon className={cn("w-[19px] h-[19px] flex-shrink-0", MARK_TEXT[tone], tone === "neutral" && "fill-current stroke-white")} aria-hidden="true" />
    {children}
  </span>
);

// Card with the reference's 20px title; AdminCard fixes its title at 16px.
const Panel = ({ title, description, children, bodyClassName }: { title: string; description?: ReactNode; children: ReactNode; bodyClassName?: string }) => (
  <section className="rounded-[10px] border border-adm-border bg-adm-surface pt-4 pb-3">
    <header className="px-6">
      <h3 className="text-[20px] leading-[26px] font-bold text-adm-ink">{title}</h3>
      {description && <p className="mt-1 text-[13px] leading-[18px] text-adm-muted">{description}</p>}
    </header>
    <div className={cn("mt-5 px-6", bodyClassName)}>{children}</div>
  </section>
);

const Badge = ({ tone, children }: { tone: Tone; children: ReactNode }) => (
  <StatusChip tone={tone} className="rounded-full px-3 py-1 text-[13px] leading-[18px] gap-2">
    <span aria-hidden="true" className="w-2 h-2 rounded-full bg-current flex-shrink-0" />
    {children}
  </StatusChip>
);

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

  const errors = [...validateApplicabilityDraft(draft.rule), ...(Number.isFinite(draft.price) && draft.price >= 0 ? [] : ["Price must be zero or more."])];
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
        ruleId = created.id;
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
  const badge = !product ? null : dirty ? <Badge tone="warning">Unsaved changes</Badge> : !product.is_active ? <Badge tone="warning">Draft policy</Badge> : rule ? <Badge tone="success">Active policy</Badge> : <Badge tone="neutral">No limits</Badge>;
  const editorHref = (focus: string) => `${adminTabHref("products")}&product=${encodeURIComponent(productId ?? "")}&focus=${focus}`;
  const tabs = [
    { id: "details", label: "Details", href: editorHref("details") },
    { id: "applicability", label: "Applicability", href: "#", active: true },
    { id: "evidence", label: "Installation evidence", href: editorHref("document") },
    { id: "disclosures", label: "Disclosures", href: editorHref("disclosures") },
  ];

  if (live && (productQuery.isLoading || !productId)) {
    return (
      <ChildPageFrame section="pricing" crumbs={crumbs} title={<SkeletonBlock className="h-9 w-72" />} backHref={adminTabHref("applicability")} backLabel="Back to applicability">
        <SkeletonBlock className="h-64 w-full" />
      </ChildPageFrame>
    );
  }
  if (!product) {
    return (
      <ChildPageFrame section="pricing" crumbs={crumbs} title="Product not found" backHref={adminTabHref("products")} backLabel="Back to products">
        <InlineNote tone="danger">{productQuery.isError ? "The product could not be read." : "This product does not exist for your dealership."}</InlineNote>
      </ChildPageFrame>
    );
  }

  const reviewing = state.phase === "reviewing" || state.phase === "applying";

  return (
    <ChildPageFrame section="pricing"
      crumbs={crumbs}
      title={product.name}
      badge={badge}
      backHref={adminTabHref("applicability")}
      backLabel="Back to applicability"
      tabs={
        <nav aria-label="Product views" className="border-b border-adm-border">
          <ScrollRegion label="Product views" revealSelector='[aria-current="page"]'>
          <ul className="flex items-stretch gap-4 min-w-max">
            {tabs.map((t) => (
              <li key={t.id}>
                <Link
                  to={t.href}
                  aria-current={t.active ? "page" : undefined}
                  className={cn("inline-flex items-center h-11 px-3.5 text-[14px] leading-[20px] font-semibold whitespace-nowrap border-b-2 -mb-px focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-adm-primary", t.active ? "text-adm-primary border-adm-primary" : "text-adm-muted border-transparent hover:text-adm-ink")}
                >
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
          </ScrollRegion>
        </nav>
      }
    >
      <div className="space-y-4">
        {state.phase === "applied" && state.result && <InlineNote tone="success" title="Applied">{state.result.message}</InlineNote>}
        {state.error && state.phase !== "applied" && <InlineNote tone="danger">{state.error}</InlineNote>}

        <div className="grid grid-cols-1 min-[1536px]:grid-cols-[minmax(0,697fr)_minmax(0,583fr)] gap-[15px] items-start">
          <Panel title="Applicability rules" description="Choose which inventory is eligible for this product." bodyClassName="pl-[21px] pr-[19px] pb-1">
            {/* Reference rows: 81, 101 and 108px with dividers inset 16px from the box edge. */}
            <div className="rounded-[8px] border border-adm-border bg-adm-surface" data-landmark="applicability-rules">
              <fieldset className="mx-4 pt-[9px] pb-[17px] border-b border-adm-border">
                <legend className="float-left w-full p-0 text-[14px] leading-[20px] font-semibold text-adm-ink">Condition</legend>
                <div className="clear-left pt-3 flex flex-wrap items-center gap-y-2">
                  <CheckRow size="lg" className="gap-2 w-[104px]" checked={draft.rule.conditions.new} onChange={(v) => setConditions({ new: v })} label="New" />
                  <CheckRow size="lg" className="gap-2 w-[102px]" checked={draft.rule.conditions.used} onChange={(v) => setConditions({ used: v })} label="Used" />
                  <CheckRow
                    size="lg"
                    className="gap-2"
                    checked={draft.rule.conditions.cpo}
                    onChange={() => undefined}
                    disabled
                    title="Certified pre-owned follows Used in the current rule model."
                    label={
                      <>
                        CPO
                        <span className="sr-only"> (Certified pre-owned, follows Used in the current rule model)</span>
                      </>
                    }
                  />
                </div>
              </fieldset>
              <fieldset className="mx-4 pt-[14px] pb-4 border-b border-adm-border">
                <legend className="float-left w-full p-0 text-[14px] leading-[20px] font-semibold text-adm-ink">
                  Mileage <span className="font-normal text-adm-muted">(optional limit)</span>
                </legend>
                <div className="clear-left pt-1 flex flex-wrap items-center gap-y-3">
                  <CheckRow size="lg" className="w-[129px]" type="radio" name="mileage" checked={draft.rule.mileageMax == null} onChange={() => setRule({ mileageMax: null })} label="No limit" />
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                    <CheckRow size="lg" type="radio" name="mileage" checked={draft.rule.mileageMax != null} onChange={() => setRule({ mileageMax: draft.rule.mileageMax ?? 100_000 })} label="Set maximum mileage" />
                    <div className="flex items-center gap-[14px]">
                      <AdminInput
                        type="number"
                        min={0}
                        step={1000}
                        value={draft.rule.mileageMax ?? ""}
                        disabled={draft.rule.mileageMax == null}
                        onChange={(e) => setRule({ mileageMax: Number(e.target.value) })}
                        aria-label="Maximum mileage"
                        className="h-[46px] w-[175px] text-[15px]"
                      />
                      <span className="text-[14px] leading-[20px] text-adm-ink">miles</span>
                    </div>
                  </div>
                </div>
              </fieldset>
              <div className="px-4 pt-[14px] pb-4">
                <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">
                  Model year range <span className="font-normal text-adm-muted">(optional)</span>
                </p>
                <div className="mt-[11px] flex flex-wrap items-center gap-x-5 gap-y-3">
                  <AdminSelect id="year-min" aria-label="Model year from" value={draft.rule.yearMin} onChange={(e) => setRule({ yearMin: e.target.value })} className="h-[46px] w-full max-w-[237px] text-[15px]">
                    <option value="">Any year</option>
                    {years.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </AdminSelect>
                  <span className="text-[14px] leading-[20px] text-adm-ink">to</span>
                  <AdminSelect id="year-max" aria-label="Model year to" value={draft.rule.yearMax} onChange={(e) => setRule({ yearMax: e.target.value })} className="h-[46px] w-full max-w-[228px] text-[15px]">
                    <option value="">Any year</option>
                    {years.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </AdminSelect>
                </div>
                {errors.length > 0 && <InlineNote tone="danger" className="mt-3">{errors.join(" ")}</InlineNote>}
              </div>
            </div>

            {/* The reference draws the proof note as the bottom band of the price box. */}
            <div className="mt-4 rounded-[8px] border border-adm-border bg-adm-surface overflow-hidden" data-landmark="price-treatment">
              <div className="px-4 pt-[13px] pb-[25px]">
                <h4 className="text-[18px] leading-[24px] font-semibold text-adm-ink">Price treatment</h4>
                <p className="mt-[3px] text-[13px] leading-[18px] text-adm-muted">Select how this product is priced and enter the amount.</p>
                <div className="mt-[11px] grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_195px] gap-x-6 gap-y-3">
                  <div className="pt-1.5 space-y-[18px]">
                    <CheckRow size="lg" type="radio" name="treatment" controlClassName="mt-[3px]" labelClassName="text-[14px]" checked={draft.treatment === "installed"} onChange={() => dispatch({ type: "edit", draft: { ...draft, treatment: "installed" } })} label={<span className="font-semibold">Installed product</span>} detail="Added to the vehicle; itemized in the advertised price." />
                    <CheckRow size="lg" type="radio" name="treatment" controlClassName="mt-[3px]" labelClassName="text-[14px]" checked={draft.treatment === "optional"} onChange={() => dispatch({ type: "edit", draft: { ...draft, treatment: "optional" } })} label={<span className="font-semibold">Optional accessory</span>} detail="Customer can choose to add at time of purchase." />
                  </div>
                  <div>
                    <label htmlFor="product-price" className="block text-[14px] leading-[20px] font-semibold text-adm-ink">Price</label>
                    <div className="relative mt-1">
                      <span aria-hidden="true" className="absolute left-[14px] top-1/2 -translate-y-1/2 text-[16px] text-adm-muted">$</span>
                      <AdminInput id="product-price" type="number" min={0} step="0.01" value={draft.price} onChange={(e) => dispatch({ type: "edit", draft: { ...draft, price: Number(e.target.value) || 0 } })} className="h-[45px] pl-[49px] text-[15px]" />
                    </div>
                  </div>
                </div>
              </div>
              <div role="status" className="flex items-start gap-3.5 bg-adm-selected px-4 pt-[11px] pb-[13px]">
                <Info className="w-9 h-9 text-adm-primary flex-shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-[14px] leading-[21px] font-semibold text-adm-ink">Installed status requires proof before publication.</p>
                  <p className="text-[13px] leading-[18px] text-adm-muted">Installation evidence is required for each vehicle before this product can be published with it.</p>
                </div>
              </div>
            </div>
          </Panel>

          <div className="space-y-[11px]">
            <Panel title="Evidence checklist" description="Items required for this product before publication." bodyClassName="px-[17px] pb-[3px]">
              <ul className="rounded-[8px] border border-adm-border bg-adm-surface divide-y divide-adm-border" data-landmark="evidence-checklist">
                {checklist.map((item) => {
                  const Icon = EVIDENCE_ICON[item.key];
                  return (
                    <li key={item.key} className="flex flex-wrap sm:flex-nowrap items-start sm:items-center gap-x-5 gap-y-2 pl-4 pr-3 pt-[9px] pb-[14px] min-h-[63px]">
                      <Icon className="w-8 h-8 text-adm-muted flex-shrink-0" strokeWidth={1.5} aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{item.label}</p>
                        <p className="mt-0.5 text-[13px] leading-[18px] text-adm-muted">{item.detail}</p>
                      </div>
                      <div className="flex flex-shrink-0 basis-full pl-[52px] sm:basis-auto sm:pl-0">
                        <StatusChip tone={EVIDENCE_TONE[item.state]} className={CHIP_CLASS}>{EVIDENCE_STATE_LABEL[item.state]}</StatusChip>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>

            <Panel title="Sample vehicle results" description="Real vehicles from your inventory, run through the same matcher the addendum uses." bodyClassName="mt-[18px] pl-[15px] pr-2 pb-[3px]">
              {live && vehiclesQuery.isLoading ? (
                <p className="text-[13px] text-adm-muted">Loading vehicles…</p>
              ) : live && vehiclesQuery.isError ? (
                <p role="status" className="text-[13px] text-adm-muted">Inventory could not be read, so sample results are Unknown.</p>
              ) : vehicles.length === 0 ? (
                <p className="text-[13px] text-adm-muted">No active vehicles to sample yet.</p>
              ) : (
                <div className="rounded-[8px] border border-adm-border overflow-hidden" data-landmark="sample-results">
                  <AdminTable caption="Sample vehicle results" minWidth={560} className="[&_th]:px-4 [&_td]:px-4 [&_th]:py-[10px] [&_th]:text-[13px] [&_th]:text-adm-ink [&_td]:py-[7px] [&_th]:border-r [&_td]:border-r [&_th:last-child]:border-r-0 [&_td:last-child]:border-r-0 [&_tbody_tr:last-child>td]:border-b-0">
                    <thead>
                      <tr>
                        <Th className="w-[164px]">Vehicle</Th>
                        <Th className="w-[89px]">Eligible</Th>
                        <Th className="w-[153px]">Evidence</Th>
                        <Th>Publication</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r) => (
                        <tr key={r.vehicle.vin}>
                          <Td>
                            <p className="text-[14px] leading-[20px] font-semibold text-adm-ink whitespace-nowrap">{[r.vehicle.year, r.vehicle.make, r.vehicle.model].filter(Boolean).join(" ")}</p>
                            <p className="text-[12px] leading-[18px] text-adm-muted whitespace-nowrap">{[r.vehicle.trim, r.vehicle.condition ? CONDITION_WORD[r.vehicle.condition.toLowerCase()] ?? r.vehicle.condition : null, r.vehicle.mileage != null ? `${r.vehicle.mileage.toLocaleString()} mi` : null].filter(Boolean).join(" · ")}</p>
                          </Td>
                          <Td><StateMark icon={r.eligible ? CheckCircle2 : XCircle} tone={r.eligible ? "success" : "danger"}>{r.eligible ? "Yes" : "No"}</StateMark></Td>
                          <Td>{proofsLoading && r.eligible && r.proof === "unknown" ? <span className="text-adm-muted text-[12px]">Checking…</span> : <StateMark icon={PROOF_MARK[r.proof].icon} tone={PROOF_MARK[r.proof].tone}>{PROOF_LABEL[r.proof]}</StateMark>}</Td>
                          <Td>{proofsLoading && r.eligible && r.publication === "unknown" ? <span className="text-adm-muted text-[12px]">Checking…</span> : <StateMark icon={PUBLICATION_MARK[r.publication].icon} tone={PUBLICATION_MARK[r.publication].tone}>{PUBLICATION_LABEL[r.publication]}</StateMark>}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </AdminTable>
                </div>
              )}
            </Panel>
          </div>
        </div>

        {reviewing && (
          <AdminCard title="Review changes" description="These changes apply to every addendum built after they are saved.">
            <div className="rounded-[10px] border border-adm-border overflow-hidden">
              <AdminTable caption="Changes to apply" minWidth={420}>
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

        <div className="flex items-center justify-end gap-3 flex-wrap">
          <AdminLinkButton to={adminTabHref("applicability")} className="h-[42px] px-[29px] text-[15px]">Cancel</AdminLinkButton>
          {reviewing ? (
            <>
              <AdminButton className="h-[42px] px-[18px] text-[15px]" onClick={() => dispatch({ type: "edit", draft })} disabled={state.phase === "applying"}>Back to edit</AdminButton>
              <AdminButton variant="primary" className="h-[42px] px-[18px] text-[15px]" onClick={apply} disabled={state.phase === "applying" || !canApply(state).ok || !tenantId} data-landmark="applicability-apply">{state.phase === "applying" ? "Applying…" : "Apply changes"}</AdminButton>
            </>
          ) : (
            <AdminButton variant="primary" className="h-[42px] px-[18px] text-[15px]" onClick={startReview} disabled={!dirty || errors.length > 0} data-landmark="applicability-review">Review changes</AdminButton>
          )}
        </div>
      </div>
    </ChildPageFrame>
  );
}
