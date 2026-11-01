import { useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTenant } from "@/contexts/TenantContext";
import { useViewFixture } from "@/lib/admin/dataSource";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";
import {
  ADMIN_UNAVAILABLE_COPY, describeDownPayment, estimatorCoverage, formatMoney, normalizeEstimatorConfig, resolveEstimate, ruleLabel,
  sameEstimatorConfig, validateEstimatorConfig, type EstimatorConfig, type YearRule,
} from "@/lib/payment/estimator";
import { useEstimatorSource, useRequestId, type EstimatorFixture, type PreviewVehicle } from "@/pages/admin/views/brand/paymentEstimator/data";
import { exampleVehicle } from "@/pages/admin/views/brand/paymentEstimator/preview";
import { Al97Dialog, Al97Frame, Banner, Card, Glyph, KeyVals, Savebar, useFixtureCopy } from "@/components/admin/al97/al97ui";

// Payment estimator summary and review (AL97 06 and 17), beside the approved
// editor. It reads the same source (useEstimatorSource), runs the shared
// resolver for the preview and writes only through the source's apply, which
// is apply_payment_estimator_settings with the base version and a request id.
// A live page has no draft of its own, so Review stays disabled until a draft
// exists; drafts are edited on the Payment estimator editor.

const EDITOR = ADMIN_CHILD_ROUTES.paymentEstimator;
const pct = (n: number) => `${n.toFixed(2)}%`;
const months = (r: YearRule | undefined) => {
  const m = r ? r.terms.filter((t) => t.enabled).map((t) => t.months).sort((a, b) => a - b) : [];
  return m.length ? `${m.join(" / ")} months` : "None";
};
const aprs = (r: YearRule) => r.terms.filter((t) => t.enabled && t.aprPercent != null).sort((a, b) => a.months - b.months).map((t) => (t.aprPercent as number).toFixed(2)).join(" / ");
const onOff = (b: boolean) => (b ? "On" : "Off");

export interface ReviewRow { setting: string; before: string; after: string }

export function reviewRows(before: EstimatorConfig, after: EstimatorConfig): ReviewRow[] {
  const rows: ReviewRow[] = [];
  if (before.enabled !== after.enabled) rows.push({ setting: "Estimator", before: onOff(before.enabled), after: onOff(after.enabled) });
  const bd = describeDownPayment(before.downPayment), ad = describeDownPayment(after.downPayment);
  if (bd !== ad) rows.push({ setting: "Down payment", before: bd, after: ad });
  const sc = (c: EstimatorConfig) => shopperLabel(c);
  if (sc(before) !== sc(after)) rows.push({ setting: "Shopper adjustments", before: sc(before), after: sc(after) });
  const prior = new Map(before.rules.map((r) => [r.id, r]));
  const changed = after.rules.filter((r) => { const b = prior.get(r.id); return !b || JSON.stringify(b) !== JSON.stringify(r); });
  for (const r of changed) {
    const b = prior.get(r.id);
    const rate = (x: YearRule | undefined) => `${x && !x.enabled ? "Off · " : ""}${x && aprs(x) ? `${months(x)} at ${aprs(x)}%` : months(x)}`;
    rows.push({ setting: `Year range ${ruleLabel(r)}`, before: rate(b), after: rate(r) });
    const term = (x: YearRule | undefined) => (x?.defaultTermMonths != null ? `${x.defaultTermMonths} months` : "None");
    if (term(b) !== term(r)) rows.push({ setting: changed.length === 1 ? "Default term" : `Default term ${ruleLabel(r)}`, before: term(b), after: term(r) });
  }
  const next = new Set(after.rules.map((r) => r.id));
  for (const b of before.rules) if (!next.has(b.id)) rows.push({ setting: `Year range ${ruleLabel(b)}`, before: months(b), after: "Removed" });
  return rows;
}

export function shopperLabel(c: EstimatorConfig): string {
  const s = c.shopperControls;
  const parts = [s.downPayment && "down payment", s.term && "eligible terms", s.aprOverride && "their own APR"].filter(Boolean) as string[];
  if (!parts.length) return "None";
  const text = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type Phase = { kind: "idle" } | { kind: "applying" } | { kind: "applied"; version: number } | { kind: "conflict" } | { kind: "failed"; message: string };

export default function PaymentAssumptionsPage() {
  const fixture = useViewFixture<EstimatorFixture>("payment-estimator");
  const src = useEstimatorSource();
  const copy = useFixtureCopy();
  const [params] = useSearchParams();
  const { tenant } = useTenant();
  const published = src.published;
  const draft = useMemo(() => (fixture?.draft ? normalizeEstimatorConfig(fixture.draft) : published.config), [fixture, published.config]);
  const base = published.version;
  const dirty = !sameEstimatorConfig(draft, published.config);
  const issues = useMemo(() => validateEstimatorConfig(draft), [draft]);
  const rows = useMemo(() => reviewRows(published.config, draft), [published.config, draft]);
  const coverage = useMemo(() => estimatorCoverage(draft, src.vehicles), [draft, src.vehicles]);
  const coverageKnown = src.vehiclesState === "ready";
  const warnings = draft.enabled && coverageKnown && (coverage.noRule.length > 0 || coverage.missingYear.length > 0);

  const [open, setOpen] = useState(params.get("review") === "1" || !!fixture?.openReview);
  const [ack, setAck] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [requestId, renewRequestId] = useRequestId();
  const trigger = useRef<HTMLButtonElement>(null);

  const store = src.storeName ?? "This store";
  const scopeText = src.accountWide ? "Whole account" : `${store} only`;
  const scopeLabel = { account: copy("pay.account", tenant?.name ?? "This account"), store: src.storeName };

  const reviewBlocked = !dirty ? "No draft changes. Edit assumptions on the Payment estimator editor."
    : issues.length ? `${issues.length} ${issues.length === 1 ? "setting needs" : "settings need"} fixing on the Payment estimator editor first.`
    : null;
  const applyBlocked = !src.canManage ? "Your role can view these settings but not change them. An owner, general manager or GSM can apply changes."
    : src.state === "not_installed" ? "The payment settings table isn't installed yet (pending migration), so nothing can be applied."
    : src.state !== "ready" ? "Settings are not loaded, so nothing can be applied."
    : reviewBlocked ? reviewBlocked
    : !coverageKnown ? "Inventory coverage for this store is unknown, so nothing can be applied."
    : warnings && !ack ? "Confirm you reviewed the vehicles that will show no estimate."
    : phase.kind === "applying" ? "Applying."
    : phase.kind === "conflict" ? "Newer settings exist. Close this review and start again from the latest version."
    : null;

  const apply = async () => {
    if (applyBlocked) return;
    setPhase({ kind: "applying" });
    const out = await src.apply({ baseVersion: base, config: draft, requestId });
    if (out.status === "applied") { renewRequestId(); setPhase({ kind: "applied", version: out.version }); setOpen(false); return; }
    if (out.status === "conflict") { src.reload(); setPhase({ kind: "conflict" }); return; }
    if (out.status === "unchanged") { renewRequestId(); setPhase({ kind: "failed", message: "These settings already match what is published. Nothing was changed." }); return; }
    setPhase({ kind: "failed", message: out.message });
  };

  const vehicle: PreviewVehicle = src.vehicles.find((v) => v.sellingPrice != null && resolveEstimate(draft, v, {}, { validate: "matched" }).status === "available")
    ?? exampleVehicle(draft, src.priceContext.price_display_mode === "website_sale_price");
  const estimate = resolveEstimate(draft, vehicle, {}, { validate: "matched" });
  const isExample = !src.vehicles.includes(vehicle);
  const termCols = [...new Set(draft.rules.flatMap((r) => r.terms.map((t) => t.months)))].filter(Number.isFinite).sort((a, b) => a - b);
  const sortedRules = [...draft.rules].sort((a, b) => (b.startYear ?? 0) - (a.startYear ?? 0));

  const reviewButton = (
    <><span id="pay-review-reason" className="sr-only">{reviewBlocked ?? ""}</span>
      <button ref={trigger} type="button" className="btn primary" disabled={!!reviewBlocked} title={reviewBlocked ?? undefined} aria-describedby={reviewBlocked ? "pay-review-reason" : undefined} onClick={() => { setPhase({ kind: "idle" }); setOpen(true); }}>Review changes</button></>
  );

  const main = open ? <div className="work" /> : (
    <div className="work">
      <Banner tone="blue" icon="info" title="Draft assumptions — not a lender offer" detail={copy("pay.banner", "Store-entered configuration below. No APR, term or down payment is supplied automatically.")} />
      {phase.kind === "applied" && <Banner tone="blue" icon="info" title={`Applied as version ${phase.version}`} detail="Customers now see estimates from these settings." />}
      <div className="split">
        <div><div>
          <Card id="pa-availability" title="Availability & down payment">
            <div className="toggle-row"><div><strong>Show retail payment estimates</strong><p>Customers see an estimate only when a complete year rule matches.</p></div><span role="img" aria-label={`Show retail payment estimates: ${draft.enabled ? "on" : "off"}`} className={`switch ${draft.enabled ? "on" : ""}`} /></div>
            <div className="fields">
              <div className="field"><span>Default down payment</span><div className="input" aria-readonly="true">{describeDownPayment(draft.downPayment)}</div></div>
              <div className="field"><span>Shopper adjustments</span><div className="input" aria-readonly="true">{shopperLabel(draft)} ▾<Glyph name="chevron" /></div></div>
            </div>
            <KeyVals rows={[["Price basis", "Customer selling price"], ["Taxes / title / registration", "Excluded; disclosed beside estimate"]]} />
          </Card>
        </div></div>
        <div><div>
          <Card id="pa-preview" title="Customer preview">
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
      <Card id="pa-terms" title="Terms & assumed APR by vehicle year" description={`${copy("pay.values", "Store-entered values")}. Overlaps, missing APRs and an unavailable default block Apply.`}
        action={<Link to={EDITOR} className="btn"><Glyph name="plus" />Add year range</Link>}>
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Model years</th>{termCols.map((m) => <th key={m} scope="col">{m} months</th>)}<th scope="col">Default</th></tr></thead>
            <tbody>{sortedRules.length === 0
              ? <tr><td colSpan={termCols.length + 2}>No year ranges. Unmatched vehicles show no estimate.</td></tr>
              : sortedRules.map((r) => (
                <tr key={r.id}>
                  <td>{ruleLabel(r)}{r.enabled ? "" : " (off)"}</td>
                  {termCols.map((m) => { const t = r.terms.find((x) => x.months === m); return <td key={m}>{t && t.enabled ? (t.aprPercent != null ? pct(t.aprPercent) : "Missing APR") : "Not offered"}</td>; })}
                  <td>{r.defaultTermMonths != null ? `${r.defaultTermMonths} months` : "Not set"}</td>
                </tr>
              ))}</tbody>
          </table>
        </div>
      </Card>
      <Savebar title={`${dirty ? "Draft" : "Published"} · ${draft.rules.length} ${copy("pay.ranges", "year")} ${draft.rules.length === 1 ? "range" : "ranges"}`}
        detail="Unmatched vehicles show no estimate. Review coverage and disclosures before applying." action={reviewButton} />
    </div>
  );

  return (
    <>
      <Al97Frame section="brand" trail={[{ label: "Dealership & Brand", to: adminTabHref("document-defaults") }]}
        crumb={open ? "Payment estimator / review" : "Payment estimator"} title={open ? "Payment estimator / review" : "Payment estimator"}
        subtitle={open ? `${src.accountWide ? "Whole account" : store} · exact store and base version` : `Retail finance assumptions · ${scopeText}`}
        scopeLabel={scopeLabel} main={main}>
        {open && <div className="invnet-ov mt-10 flex justify-center">{reviewButton}</div>}
      </Al97Frame>
      <Al97Dialog
        open={open}
        onOpenChange={(o) => { if (phase.kind !== "applying") setOpen(o); }}
        returnFocus={trigger}
        title="Review payment changes"
        description={`${scopeText} · ${copy("pay.reviewNote", `version ${base} to ${base + 1}`)}`}
        footer={<>
          <button type="button" className="btn" disabled={phase.kind === "applying"} onClick={() => setOpen(false)}>Keep editing</button>
          <span id="pay-apply-reason" className="sr-only">{applyBlocked ?? ""}</span>
          <button type="button" className="btn primary" disabled={!!applyBlocked} title={applyBlocked ?? undefined} aria-describedby={applyBlocked ? "pay-apply-reason" : undefined} aria-busy={phase.kind === "applying"} onClick={() => void apply()}>
            {phase.kind === "applying" ? "Applying…" : phase.kind === "failed" ? "Retry apply" : "Apply changes"}
          </button>
        </>}
      >
        {phase.kind === "conflict" && <Banner tone="red" icon="warning" title="Not applied: newer settings exist" detail="Someone applied a newer version. Nothing was overwritten." />}
        {phase.kind === "failed" && <Banner tone="red" icon="warning" title="Not applied" detail={`${phase.message} Retry uses the same request, so it can never apply twice.`} />}
        <Banner tone="blue" icon="info" title={copy("pay.reviewTitle", "Store assumptions")} detail={copy("pay.reviewDetail", "Every rate is this store's assumption, never a lender offer or an approval.")} />
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Setting</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
            <tbody>{rows.length ? rows.map((r) => <tr key={r.setting}><td>{r.setting}</td><td>{r.before}</td><td>{r.after}</td></tr>) : <tr><td colSpan={3}>No changes</td></tr>}</tbody>
          </table>
        </div>
        <KeyVals rows={[
          ["Covered vehicles", coverageKnown ? copy("pay.coverage", `${coverage.covered} of ${coverage.total} current vehicles`) : src.vehiclesState === "loading" ? "Checking" : "Unknown"],
          ["Unmatched years", coverageKnown && coverage.uncoveredYears.length ? copy("pay.unmatched", `${coverage.uncoveredYears.join(", ")} · no estimate; no fallback APR`) : "No estimate; do not use a fallback APR"],
          ["Base version", `${base} · rechecked at Apply`],
        ]} />
        {warnings && (
          <label className="checkline">
            <input type="checkbox" className="sr-only" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            {`${ack ? "☑" : "□"} I reviewed uncovered vehicles and the estimate disclosures.`}
          </label>
        )}
      </Al97Dialog>
    </>
  );
}
