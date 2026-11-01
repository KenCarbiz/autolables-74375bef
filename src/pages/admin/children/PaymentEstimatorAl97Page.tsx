import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AdminButton, AdminCard, InlineNote, SkeletonBlock } from "@/components/admin/v2/primitives";
import { ReviewDialog } from "@/components/admin/v2/ReviewDialog";
import { useTenant } from "@/contexts/TenantContext";
import { useViewFixture } from "@/lib/admin/dataSource";
import { adminTabHref } from "@/lib/admin/sections";
import { cn } from "@/lib/utils";
import {
  ADMIN_UNAVAILABLE_COPY, CUSTOMER_UNAVAILABLE_MESSAGE, chargeTreatment, describeDownPayment, downPaymentExplanation, estimatorChanges, estimatorCoverage,
  formatMoney, newRuleId, normalizeEstimatorConfig, resolveEstimate, ruleLabel, sameEstimatorConfig, validateEstimatorConfig,
  type EstimatorConfig, type YearRule,
} from "@/lib/payment/estimator";
import { useBeforeUnload, useEstimatorSource, useRequestId, type EstimatorFixture, type PublishedEstimator } from "@/pages/admin/views/brand/paymentEstimator/data";
import { EstimatorIcon } from "@/pages/admin/views/brand/paymentEstimator/icons";
import { FieldError, NumberField, Segmented, SwitchRow, fieldDomId, useMediaQuery } from "@/pages/admin/views/brand/paymentEstimator/parts";
import { EXAMPLE_VEHICLE_ID, PreviewPanel, exampleVehicle } from "@/pages/admin/views/brand/paymentEstimator/preview";
import { RuleCards, RuleDialog } from "@/pages/admin/views/brand/paymentEstimator/rules";
import { Al97Frame, Banner, Card, Glyph, KeyVals, Savebar, useFixtureCopy } from "@/components/admin/al97/al97ui";
import { shopperLabel } from "./PaymentAssumptionsPage";

// Payment estimator in the AL97 layout (pilot replacing PaymentEstimatorPage
// on the same route). Behaviour is the approved editor's: per-store drafts,
// validation, the shared resolver for previews, Review -> Apply through
// apply_payment_estimator_settings with the starting version and a request id
// that is kept for retries. Down payment and shopper adjustments open as
// dialogs from their fields; ranges open the existing range dialog.

interface StoreDraft { draft: EstimatorConfig; base: PublishedEstimator }

type ApplyPhase =
  | { kind: "idle" }
  | { kind: "reviewing" }
  | { kind: "applying" }
  | { kind: "applied"; version: number }
  | { kind: "conflict" }
  | { kind: "failed"; message: string };

const BACK_HREF = adminTabHref("document-defaults");
const pct = (n: number) => `${n.toFixed(2)}%`;

export default function PaymentEstimatorAl97Page() {
  const src = useEstimatorSource();
  const fixture = useViewFixture<EstimatorFixture>("payment-estimator");
  const copy = useFixtureCopy();
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const isPhone = useMediaQuery("(max-width: 767px)");

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

  const [downOpen, setDownOpen] = useState(false);
  const [shopperOpen, setShopperOpen] = useState(false);
  const [ruleOpen, setRuleOpen] = useState<{ id: string; isNew: boolean } | null>(() =>
    fixture?.openRuleId && (fixture.openRuleId === "new" || !isPhone) ? { id: fixture.openRuleId === "new" ? "fixture-new" : fixture.openRuleId, isNew: fixture.openRuleId === "new" } : null);
  const [cardOpen, setCardOpen] = useState<string | null>(fixture?.openRuleId && fixture.openRuleId !== "new" ? fixture.openRuleId : null);

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

  const blankRule = (id: string): YearRule => ({ id, enabled: true, startYear: null, endYear: null, defaultTermMonths: null, terms: [] });
  const addRule = () => {
    const id = newRuleId();
    if (isPhone) { update({ ...draft, rules: [...draft.rules, blankRule(id)] }); setCardOpen(id); }
    else setRuleOpen({ id, isNew: true });
  };
  const dialogRule = ruleOpen ? (draft.rules.find((r) => r.id === ruleOpen.id) ?? blankRule(ruleOpen.id)) : null;

  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const onLeave = (e: MouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a || !(dirty || otherDirty.length)) return;
    e.preventDefault();
    setLeaveTo(a.getAttribute("href") ?? BACK_HREF);
  };

  const storeName = src.storeName ?? "this store";
  const scopeText = src.accountWide ? "Whole account" : `${storeName} only`;
  const issueFor = (path: string) => issues.find((i) => i.path === path)?.message ?? null;
  const priceForExplain = realVehicles.find((v) => v.sellingPrice != null)?.sellingPrice ?? 30000;
  const priceIsExample = !realVehicles.some((v) => v.sellingPrice != null);
  const includesDoc = realVehicles.find((v) => v.sellingPrice != null)?.includesDocFee ?? src.priceContext.price_display_mode === "website_sale_price";
  const charges = chargeTreatment(includesDoc);
  const downIssue = issueFor(`downPayment.${draft.downPayment.mode}`);

  const vehicle = realVehicles.find((v) => v.sellingPrice != null && resolveEstimate(draft, v, {}, { validate: "matched" }).status === "available") ?? realVehicles[0] ?? exampleVehicle(draft, includesDoc);
  const estimate = resolveEstimate(draft, vehicle, {}, { validate: "matched" });
  const isExample = vehicle.id === EXAMPLE_VEHICLE_ID;
  const termCols = [...new Set(draft.rules.flatMap((r) => r.terms.map((t) => t.months)))].filter(Number.isFinite).sort((a, b) => a - b);
  const sortedRules = [...draft.rules].sort((a, b) => (b.startYear ?? 0) - (a.startYear ?? 0));

  const status = (() => {
    if (phase.kind === "applying") return { title: "Applying…", detail: `Writing ${storeName}'s settings.` };
    if (phase.kind === "applied" && !dirty) return { title: `Applied as version ${phase.version}`, detail: "Customers see the new assumptions on their next Passport load." };
    if (phase.kind === "failed") return { title: "Couldn't apply", detail: `${phase.message} Your draft is kept; you can retry.` };
    if (blockedReason && dirty) return { title: "Can't apply", detail: blockedReason };
    if (staleBase) return { title: "Settings changed elsewhere", detail: `Someone applied version ${published.version} after you started. Compare your draft with it before review.` };
    if (dirty && issues.length) return { title: issues.length === 1 ? "1 problem to fix" : `${issues.length} problems to fix`, detail: issues[0].message };
    if (dirty) return { title: `Draft · ${draft.rules.length} ${copy("pay.ranges", "year")} ${draft.rules.length === 1 ? "range" : "ranges"}`, detail: "Unmatched vehicles show no estimate. Review coverage and disclosures before applying." };
    return { title: "No changes pending", detail: published.version > 0 ? `Published version ${published.version}.` : "Nothing has been applied for this store yet." };
  })();

  const errorSummary = showErrors && issues.length > 0 && (
    <div ref={errorSummaryRef} tabIndex={-1} role="alert" aria-labelledby="pe-errors-title" className="rounded-[8px] border border-adm-danger bg-adm-danger-bg px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-danger">
      <p id="pe-errors-title" className="text-[15px] font-semibold text-adm-danger">{issues.length === 1 ? "1 problem to fix before review" : `${issues.length} problems to fix before review`}</p>
      <ul className="mt-1 list-disc pl-5 text-[13px] leading-[20px] text-adm-danger">
        {issues.map((i) => (
          <li key={`${i.path}-${i.message}`}>
            <button type="button" className="text-left underline" onClick={() => {
              const rid = i.path.split(".")[1];
              if (i.path.startsWith("rules") && rid) { if (isPhone) setCardOpen(rid); else setRuleOpen({ id: rid, isNew: false }); return; }
              setDownOpen(true);
              requestAnimationFrame(() => document.getElementById(fieldDomId(i.path))?.focus());
            }}>{i.message}</button>
          </li>
        ))}
      </ul>
    </div>
  );

  const notices = (
    <>
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
      {errorSummary}
      {staleBase && (
        <InlineNote tone="warning" title="Newer settings were applied" action={<AdminButton className="min-h-[44px]" onClick={rebase}>Compare with latest</AdminButton>}>
          Version {published.version} was applied after you started editing. Your draft is kept; compare it with the latest before reviewing.
        </InlineNote>
      )}
    </>
  );

  const loading = src.state === "loading" && !src.isFixture;
  const editors = (
    <>
      <div className="split">
        <div><div>
          <Card id="pe-availability" title="Availability & down payment">
            <div className="toggle-row">
              <div><strong>Show retail payment estimates</strong><p id="pe-enabled-hint">Customers see an estimate only when a complete year rule matches.</p></div>
              <button type="button" role="switch" aria-checked={draft.enabled} aria-label="Show retail payment estimates on Passport" aria-describedby="pe-enabled-hint" disabled={disabled}
                className={cn("switch", draft.enabled && "on")} onClick={() => update({ ...draft, enabled: !draft.enabled })} />
            </div>
            <div className="fields">
              <div className="field">
                <span id="pe-down-label">Default down payment</span>
                <button type="button" className={cn("input", downIssue && "bad")} aria-labelledby="pe-down-label pe-down-value" aria-haspopup="dialog" onClick={() => setDownOpen(true)}>
                  <span id="pe-down-value">{describeDownPayment(draft.downPayment)}</span>
                </button>
                {downIssue && <small className="text-adm-danger">{downIssue}</small>}
              </div>
              <div className="field">
                <span id="pe-shopper-label">Shopper adjustments</span>
                <button type="button" className="input" aria-labelledby="pe-shopper-label pe-shopper-value" aria-haspopup="dialog" onClick={() => setShopperOpen(true)}>
                  <span id="pe-shopper-value">{shopperLabel(draft)} ▾</span><Glyph name="chevron" />
                </button>
              </div>
            </div>
            <KeyVals rows={[["Price basis", includesDoc ? "Customer selling price, doc fee included" : "Customer selling price"], ["Taxes / title / registration", "Excluded; disclosed beside estimate"]]} />
          </Card>
        </div></div>
        <div><div>
          <Card id="pe-preview" title="Customer preview">
            {estimate.status === "available" ? (
              <div className="payment">
                <small>{isExample ? "ILLUSTRATIVE VEHICLE" : copy("pay.vehicle", "CURRENT VEHICLE")} · MODEL YEAR {vehicle.modelYear}</small>
                <b>{formatMoney(Math.round(estimate.monthlyPayment))}<span>/mo</span></b>
                <p>{formatMoney(estimate.sellingPrice)} selling price · {formatMoney(estimate.downPayment)} down</p>
                <span className="chip blue">{estimate.termMonths} months · {pct(estimate.aprPercent)} assumed APR</span>
              </div>
            ) : (
              <div className="payment"><small>NO ESTIMATE</small><p>{ADMIN_UNAVAILABLE_COPY[estimate.reason]}</p></div>
            )}
            <p className="fine">Estimated payment only. Not a credit approval or guaranteed rate. Taxes, title and registration excluded.</p>
          </Card>
        </div></div>
      </div>
      <Card id="pe-terms" title="Terms & assumed APR by vehicle year" description={`${copy("pay.values", "Store-entered values")}. Overlaps, missing APRs and an unavailable default block Apply.`}
        action={!isPhone ? <button type="button" className="btn" onClick={addRule} disabled={disabled}><Glyph name="plus" />Add year range</button> : undefined}>
        {isPhone
          ? <RuleCards rules={draft.rules} issues={issues} disabled={disabled} onChange={updateRule} onRemove={removeRule} onAdd={addRule} openId={cardOpen} setOpenId={setCardOpen} />
          : (
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">Model years</th>{termCols.map((m) => <th key={m} scope="col">{m} months</th>)}<th scope="col">Default</th></tr></thead>
                <tbody>{sortedRules.length === 0
                  ? <tr><td colSpan={termCols.length + 2}>No year ranges. Unmatched vehicles show no estimate.</td></tr>
                  : sortedRules.map((r) => (
                    <tr key={r.id}>
                      <td><button type="button" className="textbtn" aria-label={`Edit ${ruleLabel(r)}`} onClick={() => setRuleOpen({ id: r.id, isNew: false })}>{ruleLabel(r)}{r.enabled ? "" : " (off)"}</button></td>
                      {termCols.map((m) => { const t = r.terms.find((x) => x.months === m); return <td key={m}>{t && t.enabled ? (t.aprPercent != null ? pct(t.aprPercent) : "Missing APR") : "Not offered"}</td>; })}
                      <td>{r.defaultTermMonths != null ? `${r.defaultTermMonths} months` : "Not set"}</td>
                    </tr>
                  ))}</tbody>
              </table>
            </div>
          )}
        {issues.filter((i) => /overlap/i.test(i.message)).map((i) => <p key={i.message} className="mt-2 text-[13px] text-adm-danger">{i.message}</p>)}
      </Card>
    </>
  );

  const main = (
    <div className="work">
      {notices}
      {src.state !== "error" && (
        <Banner tone="blue" icon="info" title="Draft assumptions — not a lender offer"
          detail={`${copy("pay.banner", "No APR, term or down payment is supplied automatically.")}${src.accountWide ? " These settings reach every vehicle in this account until stores are set up separately." : ""}`} />
      )}
      {loading ? <><SkeletonBlock className="h-24 w-full" /><SkeletonBlock className="h-72 w-full" /></> : src.state !== "error" && editors}
      <div role="status" aria-live="polite">
        <Savebar title={status.title} detail={status.detail}
          action={<>
            {dirty && phase.kind !== "applying" && <button type="button" className="btn" onClick={discard}>Discard</button>}
            <button type="button" className="btn primary" onClick={openReview} disabled={!dirty || (!canReview && issues.length === 0)} aria-disabled={!canReview}>Review changes</button>
          </>} />
      </div>
    </div>
  );

  const more = !loading && src.state !== "error" && (
    <div className="mt-4 space-y-4">
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
              <p className="mt-2 text-[12px] text-adm-muted">{coverage.total} vehicles read {src.vehiclesCheckedAt ? new Date(src.vehiclesCheckedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}. Reading inventory never changes it. Model years with no range get no estimate; nothing rolls forward when the calendar year changes.</p>
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
      <PreviewPanel className="self-start" draft={draft} vehicles={realVehicles} vehiclesState={src.vehiclesState} checkedAt={src.vehiclesCheckedAt} exampleIncludesDocFee={includesDoc} />
      <AdminCard title="Price basis and disclosures" titleSize="lg" description="The estimate starts from the same selling price the customer sees on the Passport. It is not edited here.">
        <p className="text-[14px] text-adm-ink">{charges.basis}.</p>
        <p className="mt-1 text-[13px] text-adm-muted">Documentation fees and accessories already inside that price are counted once and never added again. To change how prices are shown, use <Link className="font-semibold text-adm-primary underline" to={adminTabHref("price-rules")}>Price rules</Link>.</p>
        <p className="mt-3 text-[14px] font-semibold text-adm-ink">Excluded from every estimate</p>
        <ul className="list-disc pl-5 text-[14px] leading-[22px] text-adm-ink">{charges.excluded.map((c) => <li key={c}>{c}</li>)}</ul>
        <div className="mt-3 rounded-[6px] bg-adm-workspace px-4 py-3 text-[13px] leading-[20px] text-adm-ink">
          <p>Estimated payment for illustration only, using the dealership's assumed APR. Not a credit approval, a guaranteed rate or a financing offer. {charges.summary}</p>
          <p className="mt-2 text-adm-muted">When a vehicle has no matching range: “{CUSTOMER_UNAVAILABLE_MESSAGE}”</p>
        </div>
        <InlineNote tone="warning" className="mt-3" title="Needs disclosure review">This wording has not been reviewed for your state's advertising rules. Have it reviewed before turning the estimator on; this screen is not legal approval.</InlineNote>
      </AdminCard>
      <AdminCard title="Published settings" titleSize="lg">
        <p className="text-[14px] text-adm-ink">{published.version > 0 ? `Version ${published.version}${published.updatedAt ? `, applied ${new Date(published.updatedAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}.` : "Never applied. Customers see no estimate from this store yet."}</p>
        <p className="mt-1 text-[13px] text-adm-muted">Each apply is recorded with who made it, when, and the values before and after.</p>
      </AdminCard>
    </div>
  );

  return (
    <>
      <Al97Frame section="brand" trail={[{ label: "Dealership & Brand", to: BACK_HREF }]} crumb="Payment estimator" title="Payment estimator"
        subtitle={`Retail finance assumptions · ${scopeText}`} scopeLabel={{ account: copy("pay.account", tenant?.name ?? "This account"), store: src.storeName }}
        main={main} onLeave={onLeave}>
        {more}
      </Al97Frame>

      {downOpen && (
        <ReviewDialog open title="Default down payment" subtitle="A suggested starting amount for every vehicle at this store. It is not a lender requirement." onClose={() => setDownOpen(false)} className="max-w-[640px]"
          footer={<div className="flex w-full justify-end"><AdminButton variant="primary" className="min-h-[44px] px-6" onClick={() => setDownOpen(false)}>Done</AdminButton></div>}>
          <Segmented label="Down payment basis" value={draft.downPayment.mode} disabled={disabled}
            onChange={(mode) => update({ ...draft, downPayment: { ...draft.downPayment, mode } })}
            options={[{ value: "amount", label: "Dollar amount", icon: <EstimatorIcon name="dollar" size={20} /> }, { value: "percent", label: "Percentage", icon: <EstimatorIcon name="percent" size={20} /> }]} />
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
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
          {downIssue && <FieldError id={`${fieldDomId(`downPayment.${draft.downPayment.mode}`)}-err`}>{downIssue}</FieldError>}
          <p className="text-[12px] text-adm-muted">Percentage means a share of the Passport selling price, not MSRP or trade value. A dollar amount above a vehicle's price is capped at the price, so nothing is financed.</p>
        </ReviewDialog>
      )}

      {shopperOpen && (
        <ReviewDialog open title="Shopper adjustments" subtitle="Available terms always follow the vehicle's matching model-year range." onClose={() => setShopperOpen(false)} className="max-w-[640px]"
          footer={<div className="flex w-full justify-end"><AdminButton variant="primary" className="min-h-[44px] px-6" onClick={() => setShopperOpen(false)}>Done</AdminButton></div>}>
          <div className="divide-y divide-adm-border">
            <SwitchRow label="Change down payment" checked={draft.shopperControls.downPayment} disabled={disabled} onChange={(v) => update({ ...draft, shopperControls: { ...draft.shopperControls, downPayment: v } })} />
            <SwitchRow label="Choose an eligible term" checked={draft.shopperControls.term} disabled={disabled} onChange={(v) => update({ ...draft, shopperControls: { ...draft.shopperControls, term: v } })} />
            <SwitchRow label="Try their own APR" hint="Shown as “Your assumed APR”. It never changes this store's APR." checked={draft.shopperControls.aprOverride} disabled={disabled} onChange={(v) => update({ ...draft, shopperControls: { ...draft.shopperControls, aprOverride: v } })} />
          </div>
        </ReviewDialog>
      )}

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

      {leaveTo && (
        <ReviewDialog open title="Leave with unsaved changes?" subtitle="Draft payment changes are not saved anywhere until you apply them." onClose={() => setLeaveTo(null)}
          className="max-w-[520px]"
          footer={
            <div className="flex w-full justify-end gap-2">
              <AdminButton variant="secondary" className="min-h-[44px]" onClick={() => setLeaveTo(null)}>Stay</AdminButton>
              <AdminButton variant="danger" className="min-h-[44px]" onClick={() => { const to = leaveTo; setDrafts({}); setLeaveTo(null); navigate(to); }}>Discard and leave</AdminButton>
            </div>
          }>
          <p className="text-[14px] text-adm-ink">{dirty ? `${storeName}: ${changes.length} ${changes.length === 1 ? "change" : "changes"}.` : ""} {otherDirty.length ? "Other stores also have draft changes." : ""}</p>
        </ReviewDialog>
      )}
    </>
  );
}
