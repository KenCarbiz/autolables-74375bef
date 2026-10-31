import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AdminPageContainer } from "@/components/admin/v2/AdminShell";
import { AdminButton, AdminCard, InlineNote, SkeletonBlock } from "@/components/admin/v2/primitives";
import { ReviewDialog } from "@/components/admin/v2/ReviewDialog";
import { useViewFixture } from "@/lib/admin/dataSource";
import { adminTabHref } from "@/lib/admin/sections";
import { cn } from "@/lib/utils";
import {
  CUSTOMER_UNAVAILABLE_MESSAGE, chargeTreatment, downPaymentExplanation, estimatorChanges, estimatorCoverage, newRuleId,
  normalizeEstimatorConfig, sameEstimatorConfig, validateEstimatorConfig,
  type EstimatorConfig, type YearRule,
} from "@/lib/payment/estimator";
import { useBeforeUnload, useEstimatorSource, useRequestId, type EstimatorFixture, type PublishedEstimator } from "@/pages/admin/views/brand/paymentEstimator/data";
import { EstimatorIcon } from "@/pages/admin/views/brand/paymentEstimator/icons";
import { FieldError, NumberField, Segmented, SwitchRow, fieldDomId, useMediaQuery } from "@/pages/admin/views/brand/paymentEstimator/parts";
import { EXAMPLE_VEHICLE_ID, PreviewPanel } from "@/pages/admin/views/brand/paymentEstimator/preview";
import { RateMatrix, RuleCards, RuleDialog } from "@/pages/admin/views/brand/paymentEstimator/rules";
import settingsTile from "@/assets/admin-v2/payment-estimator/settings-tile.svg";
import ratesTile from "@/assets/admin-v2/payment-estimator/rates-tile.svg";
import shieldTile from "@/assets/admin-v2/payment-estimator/shield-tile.svg";
import previewTile from "@/assets/admin-v2/payment-estimator/preview-tile.svg";

// Administration -> Dealership & Brand -> Document defaults -> Payment
// estimator. One rooftop's retail finance assumptions, edited as a draft,
// previewed live through the customer resolver, and written only through
// Review changes -> Apply against the version the draft started from.

type SectionId = "availability" | "rates" | "price" | "publish";
const SECTIONS: Array<{ id: SectionId; label: string; tile: string }> = [
  { id: "availability", label: "Availability & defaults", tile: settingsTile },
  { id: "rates", label: "Terms & rates", tile: ratesTile },
  { id: "price", label: "Price & disclosures", tile: shieldTile },
  { id: "publish", label: "Preview & publish", tile: previewTile },
];

interface StoreDraft {
  draft: EstimatorConfig;
  /** The published version this draft started from; Apply sends it as the base. */
  base: PublishedEstimator;
}

type ApplyPhase =
  | { kind: "idle" }
  | { kind: "reviewing" }
  | { kind: "applying" }
  | { kind: "applied"; version: number }
  | { kind: "conflict" }
  | { kind: "failed"; message: string };

const BACK_HREF = adminTabHref("document-defaults");

export default function PaymentEstimatorPage() {
  const src = useEstimatorSource();
  const fixture = useViewFixture<EstimatorFixture>("payment-estimator");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const isPhone = useMediaQuery("(max-width: 767px)");
  const isDesktopNav = useMediaQuery("(min-width: 1280px)");

  const section = (SECTIONS.find((s) => s.id === (fixture?.section ?? params.get("section")))?.id ?? "availability") as SectionId;
  const setSection = (id: SectionId) => { const p = new URLSearchParams(params); p.set("section", id); setParams(p, { replace: true }); };

  // Drafts are kept per rooftop. Switching store shows that store's own draft
  // or its published settings; a draft never moves to another store.
  const [drafts, setDrafts] = useState<Record<string, StoreDraft>>(() =>
    fixture?.draft && src.storeId ? { [src.storeId]: { draft: normalizeEstimatorConfig(fixture.draft), base: src.published } } : {});
  const storeId = src.storeId;
  const entry = storeId ? drafts[storeId] : undefined;
  const published = src.published;
  const draft = entry?.draft ?? published.config;
  const dirty = !!entry && !sameEstimatorConfig(entry.draft, published.config);
  const staleBase = !!entry && entry.base.version !== published.version;
  const otherDirty = Object.keys(drafts).filter((id) => id !== storeId && !sameEstimatorConfig(drafts[id].draft, drafts[id].base.config));
  useBeforeUnload(dirty || otherDirty.length > 0);

  const issues = useMemo(() => validateEstimatorConfig(draft), [draft]);
  const changes = useMemo(() => estimatorChanges(published.config, draft), [published.config, draft]);
  const realVehicles = useMemo(() => src.vehicles.filter((v) => v.id !== EXAMPLE_VEHICLE_ID), [src.vehicles]);
  const coverage = useMemo(() => estimatorCoverage(draft, realVehicles), [draft, realVehicles]);

  const disabled = !src.canManage || src.state === "loading" || src.state === "error";
  const update = useCallback((next: EstimatorConfig) => {
    if (!storeId) return;
    setDrafts((d) => ({ ...d, [storeId]: { draft: next, base: d[storeId]?.base ?? published } }));
  }, [storeId, published]);
  const updateRule = (r: YearRule) => update({ ...draft, rules: draft.rules.map((x) => (x.id === r.id ? r : x)) });
  const removeRule = (id: string) => update({ ...draft, rules: draft.rules.filter((x) => x.id !== id) });

  const [phase, setPhase] = useState<ApplyPhase>(fixture?.openReview ? { kind: "reviewing" } : { kind: "idle" });
  const [requestId, renewRequestId] = useRequestId();
  const [showErrors, setShowErrors] = useState(false);
  const [ack, setAck] = useState(false);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setAck(false); }, [draft]);

  const discard = () => { if (!storeId) return; setDrafts((d) => { const n = { ...d }; delete n[storeId]; return n; }); setPhase({ kind: "idle" }); setShowErrors(false); };
  const rebase = () => { if (!storeId || !entry) return; setDrafts((d) => ({ ...d, [storeId]: { draft: entry.draft, base: published } })); setPhase({ kind: "idle" }); };

  const blockedReason = src.isFixture && !fixture?.openReview ? null
    : !src.canManage ? "Your role can view these settings but not change them. An owner, general manager or GSM can apply changes."
    : src.state === "not_installed" ? "The payment settings table isn't installed yet (pending migration), so nothing can be applied."
    : src.state !== "ready" ? "Settings are not loaded, so nothing can be applied."
    : null;
  const canReview = dirty && issues.length === 0 && !blockedReason && !staleBase && phase.kind !== "applying";

  const openReview = () => {
    if (issues.length) { setShowErrors(true); requestAnimationFrame(() => errorSummaryRef.current?.focus()); return; }
    if (canReview) setPhase({ kind: "reviewing" });
  };

  const warnings = useMemo(() => {
    const w: string[] = [];
    if (!draft.enabled) return w;
    if (coverage.uncoveredYears.length) w.push(`${coverage.noRule.length} ${coverage.noRule.length === 1 ? "vehicle" : "vehicles"} in model ${coverage.uncoveredYears.length === 1 ? "year" : "years"} ${coverage.uncoveredYears.join(", ")} will show no estimate.`);
    if (coverage.missingYear.length) w.push(`${coverage.missingYear.length} ${coverage.missingYear.length === 1 ? "vehicle has" : "vehicles have"} no model year and will show no estimate.`);
    return w;
  }, [draft.enabled, coverage]);

  const apply = async () => {
    if (!entry || phase.kind === "applying") return;
    if (warnings.length && !ack) return;
    setPhase({ kind: "applying" });
    const out = await src.apply({ baseVersion: entry.base.version, config: entry.draft, requestId });
    if (out.status === "applied") {
      renewRequestId();
      setDrafts((d) => { const n = { ...d }; if (storeId) delete n[storeId]; return n; });
      setPhase({ kind: "applied", version: out.version });
      return;
    }
    if (out.status === "conflict") { src.reload(); setPhase({ kind: "conflict" }); return; }
    if (out.status === "unchanged") { renewRequestId(); setPhase({ kind: "failed", message: "These settings already match what is published. Nothing was changed." }); return; }
    setPhase({ kind: "failed", message: out.status === "denied" || out.status === "invalid" || out.status === "failed" ? out.message : "Nothing was saved." });
  };

  // ── Rule dialog (desktop) and phone cards ──────────────────────────────
  const [ruleOpen, setRuleOpen] = useState<{ id: string; isNew: boolean } | null>(() =>
    fixture?.openRuleId && (fixture.openRuleId === "new" || !isPhone) ? { id: fixture.openRuleId === "new" ? "fixture-new" : fixture.openRuleId, isNew: fixture.openRuleId === "new" } : null);
  const [cardOpen, setCardOpen] = useState<string | null>(fixture?.openRuleId && fixture.openRuleId !== "new" ? fixture.openRuleId : null);
  const blankRule = (id: string): YearRule => ({ id, enabled: true, startYear: null, endYear: null, defaultTermMonths: null, terms: [] });
  const addRule = () => {
    const id = newRuleId();
    if (isPhone) { update({ ...draft, rules: [...draft.rules, blankRule(id)] }); setCardOpen(id); }
    else setRuleOpen({ id, isNew: true });
  };
  const dialogRule = ruleOpen ? (draft.rules.find((r) => r.id === ruleOpen.id) ?? blankRule(ruleOpen.id)) : null;

  // ── Leaving ────────────────────────────────────────────────────────────
  const [leaveAsk, setLeaveAsk] = useState(false);
  const onBack = (e: React.MouseEvent) => { if (dirty || otherDirty.length) { e.preventDefault(); setLeaveAsk(true); } };

  const storeName = src.storeName ?? "this store";
  const issueFor = (path: string) => issues.find((i) => i.path === path)?.message ?? null;
  const priceForExplain = realVehicles.find((v) => v.sellingPrice != null)?.sellingPrice ?? 30000;
  const priceIsExample = !realVehicles.some((v) => v.sellingPrice != null);
  const includesDoc = realVehicles.find((v) => v.sellingPrice != null)?.includesDocFee ?? src.priceContext.price_display_mode === "website_sale_price";
  const charges = chargeTreatment(includesDoc);

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <Link to={BACK_HREF} onClick={onBack} className="inline-flex min-h-[44px] items-center gap-1 text-[14px] font-semibold text-adm-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary">
          <EstimatorIcon name="back" size={16} /> Back to Document defaults
        </Link>
        <h1 className="text-[28px] leading-[36px] lg:text-[32px] lg:leading-[40px] font-bold text-adm-ink">Payment estimator</h1>
        <p className="mt-0.5 text-[14px] leading-[20px] text-adm-muted">Retail finance assumptions for this store's Passport payment estimate. Lease is not estimated.</p>
      </div>
      <div className="flex min-h-[58px] w-full max-w-[380px] items-center gap-3 rounded-[8px] border border-adm-border bg-adm-surface px-4 py-2 sm:w-auto" aria-live="polite">
        <EstimatorIcon name="store" size={24} className="flex-shrink-0 text-adm-muted" />
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-adm-ink">Editing payment settings for {storeName}</p>
          <p className="text-[12px] text-adm-muted">{src.accountWide ? "Account-wide: these settings reach every vehicle in this account until stores are set up separately." : "Changes apply to this rooftop only, never the whole group."}</p>
        </div>
      </div>
    </div>
  );

  if (src.state === "loading" && !src.isFixture) {
    return (
      <AdminPageContainer>
        <div className="space-y-4">{header}<SkeletonBlock className="h-24 w-full" /><SkeletonBlock className="h-72 w-full" /></div>
      </AdminPageContainer>
    );
  }

  const errorSummary = showErrors && issues.length > 0 && (
    <div ref={errorSummaryRef} tabIndex={-1} role="alert" aria-labelledby="pe-errors-title" className="rounded-[8px] border border-adm-danger bg-adm-danger-bg px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-danger">
      <p id="pe-errors-title" className="text-[15px] font-semibold text-adm-danger">{issues.length === 1 ? "1 problem to fix before review" : `${issues.length} problems to fix before review`}</p>
      <ul className="mt-1 list-disc pl-5 text-[13px] leading-[20px] text-adm-danger">
        {issues.map((i) => (
          <li key={`${i.path}-${i.message}`}>
            <button type="button" className="text-left underline" onClick={() => {
              const target = i.path.startsWith("rules") ? "rates" : "availability";
              setSection(target);
              const rid = i.path.split(".")[1];
              if (target === "rates" && isPhone && rid) setCardOpen(rid);
              requestAnimationFrame(() => (document.getElementById(fieldDomId(i.path)) ?? document.getElementById(fieldDomId(`rules.${rid}.terms`)))?.focus());
            }}>{i.message}</button>
          </li>
        ))}
      </ul>
    </div>
  );

  const body: Record<SectionId, ReactNode> = {
    availability: (
      <div className="space-y-4">
        <AdminCard title="Estimator availability" titleSize="lg" description="Turning this off hides every payment estimate and payment calculator on this store's Passports. Saved ranges and rates are kept for later.">
          <SwitchRow label="Show retail payment estimates on Passport" checked={draft.enabled} disabled={disabled} onChange={(v) => update({ ...draft, enabled: v })}
            hint={draft.enabled ? "On. Vehicles with a matching model-year range show an estimate." : "Off. Customers see no estimate and no payment calculator."} />
        </AdminCard>
        <AdminCard title="Default down payment" titleSize="lg" description="A suggested starting amount for every vehicle at this store. It is not a lender requirement, and shoppers can change it if you allow it.">
          <Segmented label="Down payment basis" value={draft.downPayment.mode} disabled={disabled}
            onChange={(mode) => update({ ...draft, downPayment: { ...draft.downPayment, mode } })}
            options={[{ value: "amount", label: "Dollar amount", icon: <EstimatorIcon name="dollar" size={20} /> }, { value: "percent", label: "Percentage", icon: <EstimatorIcon name="percent" size={20} /> }]} />
          <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-2">
            {draft.downPayment.mode === "percent" ? (
              <div>
                <label htmlFor={fieldDomId("downPayment.percent")} className="block text-[14px] font-semibold text-adm-ink">Percentage of selling price</label>
                <NumberField id={fieldDomId("downPayment.percent")} value={draft.downPayment.percent} suffix="%" placeholder="10" disabled={disabled}
                  invalid={!!issueFor("downPayment.percent")} describedBy={`pe-down-explain${issueFor("downPayment.percent") ? ` ${fieldDomId("downPayment.percent")}-err` : ""}`}
                  onChange={(v) => update({ ...draft, downPayment: { ...draft.downPayment, percent: v } })} className="mt-1 w-[180px]" />
              </div>
            ) : (
              <div>
                <label htmlFor={fieldDomId("downPayment.amount")} className="block text-[14px] font-semibold text-adm-ink">Dollar amount</label>
                <NumberField id={fieldDomId("downPayment.amount")} value={draft.downPayment.amount} prefix="$" placeholder="2,000" disabled={disabled}
                  invalid={!!issueFor("downPayment.amount")} describedBy={`pe-down-explain${issueFor("downPayment.amount") ? ` ${fieldDomId("downPayment.amount")}-err` : ""}`}
                  onChange={(v) => update({ ...draft, downPayment: { ...draft.downPayment, amount: v } })} className="mt-1 w-[180px]" />
              </div>
            )}
            <p id="pe-down-explain" className="pb-3 text-[14px] text-adm-muted" aria-live="polite">
              {downPaymentExplanation(draft.downPayment, priceForExplain) ?? "Enter a value to see how it applies."}
              {priceIsExample && downPaymentExplanation(draft.downPayment, priceForExplain) ? " (illustrative $30,000 example)" : ""}
            </p>
          </div>
          {issueFor(`downPayment.${draft.downPayment.mode}`) && <FieldError id={`${fieldDomId(`downPayment.${draft.downPayment.mode}`)}-err`}>{issueFor(`downPayment.${draft.downPayment.mode}`)}</FieldError>}
          <p className="mt-2 text-[12px] text-adm-muted">Percentage means a share of the Passport selling price, not MSRP or trade value. A dollar amount above a vehicle's price is capped at the price, so nothing is financed.</p>
        </AdminCard>
        <AdminCard title="Shopper adjustments" titleSize="lg" description="Available terms always follow the vehicle's matching model-year range.">
          <div className="divide-y divide-adm-border">
            <SwitchRow label="Change down payment" checked={draft.shopperControls.downPayment} disabled={disabled} onChange={(v) => update({ ...draft, shopperControls: { ...draft.shopperControls, downPayment: v } })} />
            <SwitchRow label="Choose an eligible term" checked={draft.shopperControls.term} disabled={disabled} onChange={(v) => update({ ...draft, shopperControls: { ...draft.shopperControls, term: v } })} />
            <SwitchRow label="Try their own APR" hint="Shown as “Your assumed APR”. It never changes this store's APR." checked={draft.shopperControls.aprOverride} disabled={disabled} onChange={(v) => update({ ...draft, shopperControls: { ...draft.shopperControls, aprOverride: v } })} />
          </div>
        </AdminCard>
      </div>
    ),
    rates: (
      <AdminCard title="Terms & rates" titleSize="lg" description="One row per model-year range. Turn on each term you offer and enter its assumed APR; the default term is the one a shopper sees first."
        action={!isPhone && draft.rules.length > 0 ? <AdminButton variant="secondary" className="min-h-[44px]" onClick={addRule} disabled={disabled}><EstimatorIcon name="plus" size={20} /> Add year range</AdminButton> : undefined}>
        {isPhone
          ? <RuleCards rules={draft.rules} issues={issues} disabled={disabled} onChange={updateRule} onRemove={removeRule} onAdd={addRule} openId={cardOpen} setOpenId={setCardOpen} />
          : <RateMatrix rules={draft.rules} issues={issues} disabled={disabled} onChange={updateRule} onEdit={(id) => setRuleOpen({ id, isNew: false })} onAdd={addRule} />}
        {issues.filter((i) => /overlap/i.test(i.message)).map((i) => <p key={i.message} className="mt-2 text-[13px] text-adm-danger">{i.message}</p>)}
        <p className="mt-3 text-[12px] text-adm-muted">Model years with no range get no estimate. Nothing rolls forward when the calendar year changes.</p>
        {realVehicles.length > 0 && (
          <p className="mt-1 text-[13px] text-adm-ink">
            {coverage.covered} of {coverage.total} vehicles in this store's inventory are covered.
            {coverage.covered < coverage.total && <> <button type="button" className="font-semibold text-adm-primary underline min-h-[44px]" onClick={() => setSection("publish")}>See what's missing</button></>}
          </p>
        )}
      </AdminCard>
    ),
    price: (
      <div className="space-y-4">
        <AdminCard title="Price basis" titleSize="lg" description="The estimate starts from the same selling price the customer sees on the Passport. It is not edited here.">
          <p className="text-[14px] text-adm-ink">{charges.basis}.</p>
          <p className="mt-1 text-[13px] text-adm-muted">Documentation fees and accessories already inside that price are counted once and never added again. To change how prices are shown, use <Link className="font-semibold text-adm-primary underline" to={adminTabHref("price-rules")}>Price rules</Link>.</p>
        </AdminCard>
        <AdminCard title="Taxes, title and registration" titleSize="lg" description="No tax, title or registration inputs are configured for estimates, so they are excluded and the payment is never called all-in.">
          <ul className="list-disc pl-5 text-[14px] leading-[22px] text-adm-ink">{charges.excluded.map((c) => <li key={c}>{c}</li>)}</ul>
        </AdminCard>
        <AdminCard title="What customers read" titleSize="lg" description="Shown with every estimate. The assumptions (term, down payment, assumed APR) always appear beside the number.">
          <div className="rounded-[6px] bg-adm-workspace px-4 py-3 text-[13px] leading-[20px] text-adm-ink">
            <p>Estimated payment for illustration only, using the dealership's assumed APR. Not a credit approval, a guaranteed rate or a financing offer. {charges.summary}</p>
            <p className="mt-2 text-adm-muted">When a vehicle has no matching range: “{CUSTOMER_UNAVAILABLE_MESSAGE}”</p>
          </div>
          <InlineNote tone="warning" className="mt-3" title="Needs disclosure review">This wording has not been reviewed for your state's advertising rules. Have it reviewed before turning the estimator on; this screen is not legal approval.</InlineNote>
        </AdminCard>
      </div>
    ),
    publish: (
      <div className="space-y-4">
        <AdminCard title="Inventory coverage" titleSize="lg" description="Which of this store's vehicles the draft ranges give an estimate. This checks configuration only, not availability or lender eligibility.">
          {src.vehiclesState === "loading" ? <SkeletonBlock className="h-20 w-full" />
            : src.vehiclesState === "error" ? <InlineNote tone="danger" title="Inventory couldn't be read">Coverage is unknown. Nothing has been changed.</InlineNote>
            : realVehicles.length === 0 ? <p className="text-[14px] text-adm-muted">This store has no inventory yet, so there is nothing to check.</p>
            : (
              <>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {([["Covered", coverage.covered, "success"], ["No matching range", coverage.noRule.length, "danger"], ["Unknown model year", coverage.missingYear.length, "warning"], ["No published price", coverage.noPrice.length, "neutral"]] as const).map(([l, n, tone]) => (
                    <div key={l} className="rounded-[6px] border border-adm-border px-3 py-2">
                      <dt className="text-[12px] text-adm-muted">{l}</dt>
                      <dd className={cn("text-[22px] font-bold tabular-nums", tone === "success" ? "text-adm-success" : tone === "danger" && n ? "text-adm-danger" : tone === "warning" && n ? "text-adm-warning" : "text-adm-ink")}>{n}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-[12px] text-adm-muted">{coverage.total} vehicles read {src.vehiclesCheckedAt ? new Date(src.vehiclesCheckedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}. Reading inventory never changes it.</p>
                {[...coverage.noRule.map((v) => ({ v, why: `No range for ${v.modelYear}` })), ...coverage.missingYear.map((v) => ({ v, why: "Model year unknown" }))].slice(0, 25).length > 0 && (
                  <ul className="mt-3 divide-y divide-adm-border rounded-[6px] border border-adm-border">
                    {[...coverage.noRule.map((v) => ({ v, why: `No range for ${v.modelYear}` })), ...coverage.missingYear.map((v) => ({ v, why: "Model year unknown" }))].slice(0, 25).map(({ v, why }) => (
                      <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
                        <span className="min-w-0 truncate text-adm-ink">{v.label}{v.vin ? ` · ${v.vin.slice(-6)}` : ""}</span>
                        <span className="text-adm-danger">{why}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
        </AdminCard>
        <AdminCard title="Published settings" titleSize="lg">
          <p className="text-[14px] text-adm-ink">{published.version > 0 ? `Version ${published.version}${published.updatedAt ? `, applied ${new Date(published.updatedAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}.` : "Never applied. Customers see no estimate from this store yet."}</p>
          <p className="mt-1 text-[13px] text-adm-muted">Each apply is recorded with who made it, when, and the values before and after.</p>
        </AdminCard>
      </div>
    ),
  };

  const nav = isDesktopNav ? (
    <nav aria-label="Payment estimator sections" className="self-start rounded-[8px] border border-adm-border bg-adm-surface p-2">
      <ul className="space-y-1">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => setSection(s.id)} aria-current={section === s.id ? "page" : undefined}
              className={cn("flex min-h-[48px] w-full items-center gap-3 rounded-md px-2 text-left text-[14px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary",
                section === s.id ? "bg-adm-selected text-adm-primary" : "text-adm-ink hover:bg-adm-workspace")}>
              <img src={s.tile} alt="" width={40} height={40} className="flex-shrink-0" />
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  ) : (
    <div>
      <label htmlFor="pe-section" className="block text-[13px] font-semibold text-adm-ink">Section</label>
      <select id="pe-section" value={section} onChange={(e) => setSection(e.target.value as SectionId)}
        className="mt-1 h-12 w-full rounded-md border border-adm-border bg-adm-surface px-3 text-[15px] font-semibold text-adm-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary">
        {SECTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
    </div>
  );

  const statusLine = (() => {
    if (phase.kind === "applying") return { tone: "neutral", title: "Applying…", detail: `Writing ${storeName}'s settings.` };
    if (phase.kind === "applied" && !dirty) return { tone: "success", title: `Applied as version ${phase.version}`, detail: "Customers see the new assumptions on their next Passport load." };
    if (phase.kind === "failed") return { tone: "danger", title: "Couldn't apply", detail: `${phase.message} Your draft is kept; you can retry.` };
    if (blockedReason && dirty) return { tone: "warning", title: "Can't apply", detail: blockedReason };
    if (staleBase) return { tone: "warning", title: "Settings changed elsewhere", detail: `Someone applied version ${published.version} after you started. Compare your draft with it before review.` };
    if (dirty && issues.length) return { tone: "danger", title: issues.length === 1 ? "1 problem to fix" : `${issues.length} problems to fix`, detail: issues[0].message };
    if (dirty) return { tone: "warning", title: changes.length === 1 ? "1 draft change" : `${changes.length} draft changes`, detail: "Nothing changes for customers until you apply." };
    return { tone: "success", title: "No changes pending", detail: published.version > 0 ? `Published version ${published.version}.` : "Nothing has been applied for this store yet." };
  })();

  return (
    <AdminPageContainer className="pb-0">
      <div className="space-y-4">
        {header}
        {otherDirty.length > 0 && (
          <InlineNote tone="warning" title="Unsaved changes for another store">
            {src.otherStores.filter((s) => otherDirty.includes(s.id)).map((s) => s.name).join(", ") || "Another store"} has draft payment changes. They stay with that store; switch back to it to review or discard them.
          </InlineNote>
        )}
        {src.state === "not_installed" && <InlineNote tone="warning" title="Pending migration">The payment settings table isn't installed in this environment yet. You can draft and preview, but nothing can be applied.</InlineNote>}
        {src.state === "error" && <InlineNote tone="danger" title="Settings couldn't be loaded" action={<AdminButton className="min-h-[44px]" onClick={src.reload}>Retry</AdminButton>}>Nothing is shown as blank or overwritten. Retry to load {storeName}'s settings.</InlineNote>}
        {!src.canManage && src.state !== "error" && <InlineNote tone="info" title="View only">Your role can view these settings. An owner, general manager or GSM can change them.</InlineNote>}
        {src.state === "ready" && published.version === 0 && !entry && (
          <InlineNote tone="info" title="Not set up yet">This store has no payment settings, so customers see no estimate. Choose a down payment, add model-year ranges with their APRs, then turn the estimator on and apply.</InlineNote>
        )}

        {src.state !== "error" && (
          <div className={cn("grid grid-cols-1 gap-4 xl:grid-cols-[220px_minmax(0,1fr)]", section !== "rates" && "min-[1440px]:grid-cols-[220px_minmax(480px,1fr)_366px]")}>
            {nav}
            <div className="min-w-0 space-y-4">
              {errorSummary}
              {staleBase && (
                <InlineNote tone="warning" title="Newer settings were applied" action={<AdminButton className="min-h-[44px]" onClick={rebase}>Compare with latest</AdminButton>}>
                  Version {published.version} was applied after you started editing. Your draft is kept; compare it with the latest before reviewing.
                </InlineNote>
              )}
              {body[section]}
            </div>
            <PreviewPanel className={cn("xl:col-start-2 self-start", section === "rates" ? "xl:max-w-[640px]" : "min-[1440px]:col-start-auto")} draft={draft} vehicles={realVehicles} vehiclesState={src.vehiclesState}
              checkedAt={src.vehiclesCheckedAt} exampleIncludesDocFee={includesDoc} />
          </div>
        )}

        <div className="sticky bottom-0 z-10 -mx-4 sm:-mx-6 border-t border-adm-border bg-adm-surface px-4 sm:px-6 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <div className="flex flex-wrap items-center justify-between gap-3" role="status" aria-live="polite">
            <div className="flex min-w-0 flex-1 basis-[240px] items-start gap-3">
              <EstimatorIcon name={statusLine.tone === "success" ? "check" : statusLine.tone === "danger" || statusLine.tone === "warning" ? "warning" : "info"} size={24}
                className={cn("mt-0.5 flex-shrink-0", statusLine.tone === "success" ? "text-adm-success" : statusLine.tone === "danger" ? "text-adm-danger" : statusLine.tone === "warning" ? "text-adm-warning" : "text-adm-muted")} />
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-adm-ink">{statusLine.title}</p>
                <p className="text-[12px] leading-[18px] text-adm-muted break-words">{statusLine.detail}</p>
              </div>
            </div>
            <div className="flex w-full gap-2 sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">
              {dirty && phase.kind !== "applying" && <AdminButton variant="secondary" className="min-h-[44px]" onClick={discard}>Discard</AdminButton>}
              <AdminButton variant="primary" className="min-h-[44px] px-6" onClick={openReview} disabled={!dirty || (!canReview && issues.length === 0)} aria-disabled={!canReview}>Review changes</AdminButton>
            </div>
          </div>
        </div>
      </div>

      {dialogRule && ruleOpen && (
        <RuleDialog rule={dialogRule} isNew={ruleOpen.isNew} issues={issues} disabled={disabled}
          onClose={() => setRuleOpen(null)}
          onRemove={() => { removeRule(dialogRule.id); setRuleOpen(null); }}
          onSave={(r) => { update({ ...draft, rules: ruleOpen.isNew ? [...draft.rules, r] : draft.rules.map((x) => (x.id === r.id ? r : x)) }); setRuleOpen(null); }} />
      )}

      {(phase.kind === "reviewing" || phase.kind === "applying" || phase.kind === "conflict" || (phase.kind === "failed" && dirty)) && (
        <ReviewDialog
          open
          title="Review payment changes"
          subtitle={<>For <strong className="text-adm-ink">{storeName}</strong> only · from version {entry?.base.version ?? published.version} to {(entry?.base.version ?? published.version) + 1}</>}
          onClose={() => { if (phase.kind !== "applying") setPhase({ kind: "idle" }); }}
          footer={
            <>
              <p className="text-[12px] text-adm-muted">Applying records you, the time, and every value before and after.</p>
              <div className="flex gap-2">
                <AdminButton variant="secondary" className="min-h-[44px]" disabled={phase.kind === "applying"} onClick={() => setPhase({ kind: "idle" })}>Keep editing</AdminButton>
                {phase.kind === "conflict"
                  ? <AdminButton variant="primary" className="min-h-[44px] px-6" onClick={rebase}>Compare with latest</AdminButton>
                  : <AdminButton variant="primary" className="min-h-[44px] px-6" disabled={phase.kind === "applying" || !!blockedReason || (warnings.length > 0 && !ack)} aria-busy={phase.kind === "applying"} onClick={() => void apply()}>
                      {phase.kind === "applying" ? "Applying…" : phase.kind === "failed" ? "Retry apply" : "Apply changes"}
                    </AdminButton>}
              </div>
            </>
          }
        >
          {phase.kind === "conflict" && <InlineNote tone="danger" title="Not applied: newer settings exist">Someone applied a newer version while you were editing. Nothing was overwritten. Compare your draft with the latest, then review again.</InlineNote>}
          {phase.kind === "failed" && <InlineNote tone="danger" title="Not applied">{phase.message} Your draft is kept; Retry uses the same request, so it can never apply twice.</InlineNote>}
          {blockedReason && <InlineNote tone="warning" title="Can't apply">{blockedReason}</InlineNote>}
          <table className="w-full border-collapse text-[13px]">
            <caption className="sr-only">Changes for {storeName}</caption>
            <thead><tr className="text-left text-[12px] text-adm-muted"><th scope="col" className="py-1 pr-3 font-semibold">Setting</th><th scope="col" className="py-1 pr-3 font-semibold">Before</th><th scope="col" className="py-1 font-semibold">After</th></tr></thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.field} className="border-t border-adm-border align-top">
                  <th scope="row" className="py-2 pr-3 text-left font-semibold text-adm-ink">{c.field}</th>
                  <td className="py-2 pr-3 text-adm-muted break-words">{c.before}</td>
                  <td className="py-2 text-adm-ink break-words">{c.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {warnings.length > 0 && (
            <div className="rounded-[6px] border border-adm-warning bg-adm-warning-bg px-4 py-3">
              <p className="text-[14px] font-semibold text-adm-warning">Coverage gaps</p>
              <ul className="mt-1 list-disc pl-5 text-[13px] text-adm-ink">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              <label className="mt-2 flex min-h-[44px] items-center gap-2 text-[13px] text-adm-ink">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="h-5 w-5 accent-[#2457D6]" />
                I understand these vehicles will show no payment estimate.
              </label>
            </div>
          )}
          {draft.enabled && <p className="text-[12px] text-adm-muted">Every rate here is the store's assumption. Nothing is filled in automatically, and no rate is shown as an approval or lender offer.</p>}
        </ReviewDialog>
      )}

      {leaveAsk && (
        <ReviewDialog open title="Leave with unsaved changes?" subtitle="Draft payment changes are not saved anywhere until you apply them." onClose={() => setLeaveAsk(false)}
          className="max-w-[520px]"
          footer={
            <div className="flex w-full justify-end gap-2">
              <AdminButton variant="secondary" className="min-h-[44px]" onClick={() => setLeaveAsk(false)}>Stay</AdminButton>
              <AdminButton variant="danger" className="min-h-[44px]" onClick={() => { setDrafts({}); setLeaveAsk(false); navigate(BACK_HREF); }}>Discard and leave</AdminButton>
            </div>
          }>
          <p className="text-[14px] text-adm-ink">{dirty ? `${storeName}: ${changes.length} ${changes.length === 1 ? "change" : "changes"}.` : ""} {otherDirty.length ? "Other stores also have draft changes." : ""}</p>
        </ReviewDialog>
      )}
    </AdminPageContainer>
  );
}

