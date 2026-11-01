import { Link } from "react-router-dom";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useAdminNow, useViewFixture } from "@/lib/admin/dataSource";
import { adminTabHref } from "@/lib/admin/sections";
import { countDisplay, type CountValue } from "@/lib/admin/health";
import { effectiveFee, fmtMoney } from "@/lib/admin/pricing/feePolicy";
import { isDecidedBasis, resolveFeeBasis, type FeeBasis } from "@/lib/admin/pricing/feeBasis";
import { customerPrice, defaultFeeBasis } from "@/lib/admin/pricing/previewPricing";
import type { ConsistencyAssessment } from "@/lib/admin/pricing/priceConsistency";
import { integrityQueueRow, isSchemaMismatch, previewListing, summarizeIntegrity, type IntegrityChip } from "@/lib/admin/pricing/integrity";
import type { PriceDisplayMode } from "@/lib/priceModel";
import { tenantIdOf, useConsistency, useListingCounts } from "@/pages/admin/views/pricing/pricingData";
import { formatClock } from "@/pages/admin/children/inventoryNetwork/overviewModel";
import { Al97Frame, Banner, Card, Glyph, KeyVals, Metrics, Savebar, useFixtureCopy, type MetricItem } from "@/components/admin/al97/al97ui";
import readUnavailable from "@/assets/al97/read-unavailable.svg";

// Pricing integrity. Reads the same consistency rows and listing counts as
// Price rules and shows the three checks apart: stored arithmetic, source
// evidence and customer output. A failed read is Unknown and nothing is shown
// as verified; opening the page changes no price.

export interface PricingIntegrityFixture {
  account: string;
  store: string | null;
  policy: { feeEnabled: boolean; feeAmount: number; mode: PriceDisplayMode; feeBasis?: FeeBasis };
  counts: { active: CountValue | null; eligible: CountValue | null; archived: CountValue | null };
  /** Null means the read failed. */
  consistency: { rows: ConsistencyAssessment[]; truncated: boolean } | null;
  error?: string | null;
  checkedAt?: string | null;
}

const PRICE_RULES = adminTabHref("price-rules");
const TRAIL = [{ label: "Pricing & Products", to: PRICE_RULES }];
const QUEUE_LIMIT = 3;

const Chip = ({ chip }: { chip: IntegrityChip }) => <span className={`chip ${chip.tone === "neutral" ? "" : chip.tone}`}>{chip.label}</span>;
const known = (c: CountValue | null): boolean => !!c && c.kind === "known";

export default function PricingIntegrityPage() {
  const fx = useViewFixture<PricingIntegrityFixture>("pricing-integrity");
  const now = useAdminNow();
  const copy = useFixtureCopy();
  const { tenant, currentStore } = useTenant();
  const { settings } = useDealerSettings();
  const tenantId = fx ? null : tenantIdOf(tenant);
  const live = !fx;

  const policy = fx?.policy ?? {
    feeEnabled: !!settings.doc_fee_enabled,
    feeAmount: Number(settings.doc_fee_amount) || 0,
    mode: (settings.price_display_mode || "advertised_before_doc") as PriceDisplayMode,
  };
  const fee = effectiveFee({ enabled: policy.feeEnabled, amount: policy.feeAmount, stateCode: "" });
  const feeBasis: FeeBasis = fx ? fx.policy.feeBasis ?? "unconfigured" : resolveFeeBasis(settings).basis;

  const countsQ = useListingCounts(tenantId, live);
  const consistencyQ = useConsistency(tenantId, fee, policy.mode, live);
  const countOf = (k: "active" | "eligible" | "archived"): CountValue | null =>
    fx ? fx.counts[k] : countsQ.isError ? { kind: "failed" } : countsQ.isLoading ? { kind: "loading" } : countsQ.data?.[k] ?? null;
  const active = countOf("active");
  const eligible = countOf("eligible");
  const archived = countOf("archived");

  const loading = live && (consistencyQ.isLoading || (!tenantId && !tenant));
  const rows = fx ? fx.consistency?.rows ?? null : consistencyQ.data?.rows ?? null;
  const truncated = fx ? !!fx.consistency?.truncated : !!consistencyQ.data?.truncated;
  const error = fx ? fx.error ?? null : consistencyQ.error instanceof Error ? consistencyQ.error.message : null;
  const checkedAt = fx ? fx.checkedAt ?? null : consistencyQ.dataUpdatedAt ? new Date(consistencyQ.dataUpdatedAt).toISOString() : null;
  const scopeLabel = { account: fx?.account ?? tenant?.name ?? "This account", store: fx ? fx.store : currentStore?.name ?? null };
  const retry = () => { if (live) void consistencyQ.refetch(); };
  const more = (
    <p className="mt-4 text-[13px] text-adm-muted">
      The full consistency table, the fee policy and Fee Change Review stay on <Link to={PRICE_RULES} className="font-semibold text-adm-primary hover:underline">Price rules</Link>.
    </p>
  );

  if (loading) {
    return (
      <Al97Frame section="pricing" trail={TRAIL} crumb="Pricing integrity" title="Pricing integrity" subtitle="Stored arithmetic, source evidence and customer output are separate checks." scopeLabel={scopeLabel}
        main={<div className="work" aria-busy="true"><Banner tone="blue" icon="info" title="Checking prices" detail="Reading listings and website observations. Nothing is shown as verified until the read answers." /></div>}>
        {more}
      </Al97Frame>
    );
  }

  if (!rows) {
    const schema = isSchemaMismatch(error);
    const stats: MetricItem[] = [
      { label: "Active listings", value: countDisplay(active), sub: "All active tenant listings", icon: "car", known: known(active) },
      { label: "Fee-basis eligible", value: countDisplay(eligible), sub: "A different population", icon: "dollar", known: known(eligible) },
      { label: "Source verification", value: "Unknown", sub: "Evidence not rechecked", icon: "shield" },
      { label: "Archived excluded", value: countDisplay(archived), sub: "No archive recalculation", icon: "archive", known: known(archived) },
    ];
    const main = (
      <div className="work">
        <Banner tone="amber" icon="warning" title="Price consistency could not be checked"
          detail={`${schema ? "The listings reader does not match the database schema." : "The pricing read did not answer."} No vehicle should appear verified because the read failed.`} />
        <Metrics label="Pricing integrity summary" items={stats} />
        <div className="split">
          <div>
            <Card id="pi-preview" title="Customer price preview">
              <div className="empty">
                <img className="art" src={readUnavailable} alt="" />
                <h3>Preview unavailable</h3>
                <p>{active?.kind === "known" && active.value > 0 ? "Inventory exists, but its pricing data could not be read." : "Pricing data could not be read."}</p>
                <button type="button" className="btn" onClick={retry}><Glyph name="retry" />Retry read</button>
              </div>
            </Card>
          </div>
          <div>
            <Card id="pi-diagnostics" title="Read diagnostics">
              <KeyVals rows={[
                ["Schema contract", schema ? <span className="chip red">Mismatch</span> : <span className="chip amber">Read failed</span>],
                ["Problem", copy("pricing.problem", error ?? "No error detail returned")],
                ["Stored listing shape", "ymm + supported attributes"],
                ["Required fix", schema ? "Shared normalized listing adapter" : "Retry the read, then check access"],
              ]} />
              <p className="fine">Do not add guessed columns or silently parse incomplete values as verified facts.</p>
            </Card>
          </div>
        </div>
        <Card id="pi-checks" title="Evidence checks">
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Check</th><th scope="col">Meaning</th><th scope="col">Status</th></tr></thead>
              <tbody>
                <tr><td>Arithmetic</td><td>Stored price components reconcile</td><td><span className="chip neutral">Separate check</span></td></tr>
                <tr><td>Source identity</td><td>Exact VIN and page provenance</td><td><span className="chip amber">Review evidence</span></td></tr>
                <tr><td>Fee treatment</td><td>Page evidence supports the fee basis</td><td><span className="chip neutral">Not inferred</span></td></tr>
                <tr><td>Customer output</td><td>Passport and document use governed price</td><td><span className="chip amber">Not verified in this run</span></td></tr>
              </tbody>
            </table>
          </div>
        </Card>
        <Savebar title="No prices changed" detail={copy("pricing.failedSave", "Repair reads first. Nothing on this page changes a price or the pricing policy.")}
          action={<Link to={PRICE_RULES} className="btn">Open evidence review</Link>} />
      </div>
    );
    return <Al97Frame section="pricing" trail={TRAIL} crumb="Pricing integrity" title="Pricing integrity" subtitle="Stored arithmetic, source evidence and customer output are separate checks." scopeLabel={scopeLabel} main={main}>{more}</Al97Frame>;
  }

  const summary = summarizeIntegrity(rows);
  const preview = previewListing(rows);
  const price = preview
    ? isDecidedBasis(feeBasis)
      ? customerPrice(preview.stored, fee, policy.mode, feeBasis)
      : customerPrice(preview.stored, fee, policy.mode, defaultFeeBasis(policy.mode))
    : null;
  const queue = rows.slice(0, QUEUE_LIMIT).map(integrityQueueRow);
  const stats: MetricItem[] = [
    { label: "Active listings", value: countDisplay(active), sub: copy("pricing.activeSub", "All active tenant listings"), icon: "car", known: known(active) },
    { label: "Arithmetic checked", value: `${summary.checked.toLocaleString()}${truncated ? "+" : ""}`, sub: truncated ? "First vehicles by VIN" : "Current read model", icon: "calculator" },
    { label: "Source verified", value: summary.verified.toLocaleString(), sub: "Evidence checks passed", icon: "shield" },
    { label: "Needs evidence", value: summary.needsEvidence.toLocaleString(), sub: "Not marked verified", icon: "warning" },
  ];
  const caption = copy("caption", "");
  const main = (
    <div className="work">
      <Banner tone="blue" icon="info" title="Pricing data loaded" detail="The shared listing adapter answered. Arithmetic and source verification remain separate checks." />
      <Metrics label="Pricing integrity summary" items={stats} />
      <div className="split">
        <div>
          <Card id="pi-preview" title="Customer price preview">
            {preview && price ? (
              <>
                <KeyVals rows={[
                  ["Vehicle", [preview.row.vehicle, preview.row.listing.stock].filter(Boolean).join(" · ")],
                  [price.includesFee ? "Selling price before fee" : "Selling price", fmtMoney(price.sellingPrice)],
                  ["Document fee", fmtMoney(price.docFee)],
                  ["Customer total", fmtMoney(price.total)],
                ]} />
                <p className="fine">{copy("pricing.previewFine", `${price.includesFee ? "Fee-inclusive" : "Before-fee"} display.`)} Taxes, title and registration excluded. Governed price is counted once.</p>
              </>
            ) : (
              <div className="empty"><h3>No priced vehicle to preview</h3><p>No active vehicle has a stored price the preview can read.</p></div>
            )}
          </Card>
        </div>
        <div>
          <Card id="pi-outcome" title="Verification outcome">
            <KeyVals rows={[
              ["Listing reader", <span className="chip green">Loaded</span>],
              ["Arithmetic", summary.breakdownConflicts === 0 ? <span className="chip green">Reconciled</span> : <span className="chip amber">{summary.breakdownConflicts} breakdown {summary.breakdownConflicts === 1 ? "conflict" : "conflicts"}</span>],
              ["Page identity", summary.observed > 0 ? <span className="chip green">{copy("pricing.pageIdentity", "Exact VIN match")}</span> : <span className="chip">No pages observed</span>],
              ["Fee basis", <span className="chip blue">Page evidence required</span>],
              ["Checked at", copy("pricing.checkedAt", checkedAt ? formatClock(checkedAt, now) : "Not recorded")],
            ]} />
          </Card>
        </div>
      </div>
      <Card id="pi-queue" title="Price evidence queue">
        <div className="table-wrap">
          <table>
            <caption className="sr-only">{`First ${queue.length} of ${rows.length} vehicles; the full table is on Price rules.`}</caption>
            <thead><tr><th scope="col">Vehicle</th><th scope="col">Arithmetic</th><th scope="col">Source identity</th><th scope="col">Fee evidence</th><th scope="col">Next action</th></tr></thead>
            <tbody>
              {queue.map((q) => (
                <tr key={q.id}>
                  <td>{q.vehicle}</td>
                  <td><Chip chip={q.arithmetic} /></td>
                  <td><Chip chip={q.identity} /></td>
                  <td><Chip chip={q.fee} /></td>
                  <td>{q.action.href ? <Link to={q.action.href}>{q.action.label}</Link> : q.action.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Savebar title={copy("pricing.readySave", "Read only; prices unchanged")} detail="Do not equate a successful query or arithmetic match with verified website evidence."
        action={<Link to={PRICE_RULES} className="btn">Open evidence review</Link>} />
    </div>
  );
  return <Al97Frame section="pricing" trail={TRAIL} crumb="Pricing integrity / ready" title="Pricing integrity / ready" subtitle={`Successful reader state${caption}`} scopeLabel={scopeLabel} main={main}>{more}</Al97Frame>;
}
