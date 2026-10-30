import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ExternalLink, ShieldCheck } from "lucide-react";
import { MetricStrip } from "@/components/product";
import { priceReviewHref } from "./childLinks";
import {
  EmptyState,
  Panel,
  RowAction,
  StateBadge,
  TableShell,
  formatDateTime,
} from "./primitives";
import {
  PRICE_STATE_LABEL,
  countUnresolvedPriceVins,
  money,
  priceRowsNeedingReview,
  type PriceRow,
  type PriceState,
} from "./complianceData";

const STATE_TONE: Record<PriceState, "neutral" | "critical" | "attention" | "clear"> = {
  matched: "clear",
  differs: "critical",
  awaiting_snapshot: "neutral",
  not_monitored: "neutral",
  no_price: "attention",
};

export const PriceIntegritySection = ({ rows, loading }: { rows: PriceRow[]; loading: boolean }) => {
  const [showAll, setShowAll] = useState(false);

  const review = useMemo(() => priceRowsNeedingReview(rows), [rows]);
  const unresolved = useMemo(() => countUnresolvedPriceVins(rows), [rows]);
  const monitored = rows.filter((r) => r.websitePrice != null).length;
  const matched = rows.filter((r) => r.state === "matched").length;
  const historicalEvents = rows.reduce((s, r) => s + r.historicalEvents, 0);
  const listed = showAll ? rows : rows.filter((r) => r.state !== "not_monitored");

  return (
    <div className="flex flex-col gap-6">
      <MetricStrip
        label="Price integrity summary"
        metrics={[
          { label: "Needs review", value: loading ? null : unresolved, hint: "Live discrepancy or open flag", tone: unresolved > 0 ? "danger" : "success", loading },
          { label: "Website monitored", value: loading ? null : monitored, hint: "With a real price snapshot", loading },
          { label: "Reconciled", value: loading ? null : matched, hint: "Website matches reference", tone: matched > 0 ? "success" : "neutral", loading },
          { label: "Historical events", value: loading ? null : historicalEvents.toLocaleString(), hint: "Snapshots and document flags", loading },
        ]}
      />

      <Panel
        title="Price change review"
        meta="Grouped by VIN. One row is one vehicle to resolve, however many events sit behind it."
      >
        {loading ? (
          <p className="px-4 py-10 text-center text-[14px] leading-[20px] text-adm-muted">Reconciling prices…</p>
        ) : review.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            tone="clear"
            headline="No open issues in this category."
            body="No in-stock vehicle has a live price discrepancy or an unresolved document flag."
          />
        ) : (
          <TableShell headers={["Vehicle", "Current issue", "Historical events", "Last checked", "Action"]}>
            {review.map((r) => (
              <tr key={r.vehicleId} className="hover:bg-adm-workspace">
                <td className="px-4 py-3">
                  <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{r.title}</p>
                  <p className="font-mono text-[12px] leading-[18px] text-adm-muted">{r.stockNumber || r.vin}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="text-[14px] leading-[20px] text-adm-ink">{r.currentIssue}</p>
                  <p className="mt-0.5 text-[12px] leading-[18px] text-adm-muted">
                    {r.referenceLabel
                      ? `${r.referenceLabel} ${money(r.referencePrice)} vs website ${money(r.websitePrice)}`
                      : "No reference price on record."}
                  </p>
                </td>
                <td className="px-4 py-3 text-[14px] leading-[20px] tabular-nums text-adm-ink">{r.historicalEvents}</td>
                <td className="px-4 py-3 text-[12px] leading-[18px] text-adm-muted">{formatDateTime(r.lastCheckedAt)}</td>
                <td className="px-4 py-3 text-right">
                  <Link to={priceReviewHref(r.vin)} className="font-semibold text-adm-primary hover:underline">Review</Link>
                </td>
              </tr>
            ))}
          </TableShell>
        )}
      </Panel>

      <Panel
        title="Every monitored vehicle"
        meta="Current state per VIN. Historical changes live in the VIN timeline, not in this list."
        action={
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="inline-flex h-8 items-center rounded-lg border border-adm-border px-3 text-[12px] leading-[18px] font-bold text-adm-ink hover:bg-adm-workspace"
          >
            {showAll ? "Hide unmonitored" : "Show unmonitored"}
          </button>
        }
      >
        {loading ? (
          <p className="px-4 py-10 text-center text-[14px] leading-[20px] text-adm-muted">Loading vehicles…</p>
        ) : listed.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            headline="No vehicles to reconcile."
            body="Nothing in active inventory has a price snapshot yet. Seed your vehicle-detail-page URL pattern so the nightly crawl has a target per vehicle."
          />
        ) : (
          <TableShell
            headers={[
              "VIN",
              "Dealer-confirmed",
              "Feed",
              "Website",
              "Snapshot",
              "Difference",
              "State",
              "Action",
            ]}
          >
            {listed.map((r) => (
              <tr key={r.vehicleId} className="hover:bg-adm-workspace">
                <td className="px-4 py-3">
                  <p className="font-mono text-[12px] leading-[18px] text-adm-ink">{r.vin}</p>
                  <p className="text-[12px] leading-[18px] text-adm-muted">{r.title}</p>
                </td>
                <td className="px-4 py-3 text-[14px] leading-[20px] tabular-nums text-adm-ink">
                  {r.confirmedPrice == null ? (
                    <span className="text-adm-muted">Not confirmed</span>
                  ) : (
                    money(r.confirmedPrice)
                  )}
                </td>
                <td className="px-4 py-3 text-[14px] leading-[20px] tabular-nums text-adm-ink">{money(r.feedPrice)}</td>
                <td className="px-4 py-3 text-[14px] leading-[20px] tabular-nums text-adm-ink">{money(r.websitePrice)}</td>
                <td className="px-4 py-3 text-[12px] leading-[18px] text-adm-muted">{formatDateTime(r.websiteAt)}</td>
                <td className="px-4 py-3 text-[14px] leading-[20px] tabular-nums text-adm-ink">
                  {r.difference == null ? (
                    "—"
                  ) : (
                    <>
                      {r.difference > 0 ? "+" : r.difference < 0 ? "−" : ""}
                      {money(Math.abs(r.difference))}
                      {r.matchedWithDocFee && (
                        <span className="ml-1 text-[12px] leading-[18px] text-adm-muted">after doc fee</span>
                      )}
                    </>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StateBadge tone={STATE_TONE[r.state]}>{PRICE_STATE_LABEL[r.state]}</StateBadge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {r.websiteUrl && (
                      <RowAction href={r.websiteUrl}>
                        <ExternalLink className="h-3.5 w-3.5" /> Listing
                      </RowAction>
                    )}
                    <Link to={priceReviewHref(r.vin)} className="font-semibold text-adm-primary hover:underline">History</Link>
                  </div>
                </td>
              </tr>
            ))}
          </TableShell>
        )}
      </Panel>

    </div>
  );
};

export default PriceIntegritySection;
