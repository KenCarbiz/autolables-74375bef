import { useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, ShieldCheck, X } from "lucide-react";
import {
  CountTile,
  EmptyState,
  Panel,
  RowAction,
  SectionHeading,
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

const VinTimeline = ({ row, onClose }: { row: PriceRow; onClose: () => void }) => (
  <div className="fixed inset-0 z-50 flex justify-end bg-foreground/30" role="dialog" aria-modal="true">
    <button type="button" aria-label="Close" className="flex-1" onClick={onClose} />
    <div className="flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-border bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h3 className="text-al-section font-display text-foreground">{row.title}</h3>
          <p className="mt-0.5 font-mono text-al-meta text-muted-foreground">{row.vin}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="grid grid-cols-3 gap-px border-b border-border bg-border">
        {[
          { label: "Dealer-confirmed", value: money(row.confirmedPrice), at: row.confirmedAt },
          { label: "Feed", value: money(row.feedPrice), at: null },
          { label: "Website", value: money(row.websitePrice), at: row.websiteAt },
        ].map((c) => (
          <div key={c.label} className="bg-card px-4 py-3">
            <p className="text-al-meta font-bold uppercase tracking-label text-muted-foreground">{c.label}</p>
            <p className="mt-0.5 font-display text-al-section tabular-nums text-foreground">{c.value}</p>
            {c.at && <p className="text-al-meta text-muted-foreground">{formatDateTime(c.at)}</p>}
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <p className="text-al-meta font-bold uppercase tracking-label text-muted-foreground">
          Price and document events ({row.events.length})
        </p>
        {row.events.length === 0 ? (
          <p className="mt-3 text-al-body text-muted-foreground">
            No price snapshots or document flags have been recorded for this VIN.
          </p>
        ) : (
          <ol className="mt-3 space-y-3 border-l border-border pl-4">
            {row.events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-border" />
                <p className="text-al-meta text-muted-foreground">{formatDateTime(e.at)}</p>
                <p className="text-al-body text-foreground">{e.label}</p>
                <p className="text-al-meta text-muted-foreground">{e.detail}</p>
                {e.kind === "document_flag" && e.status && (
                  <p className="mt-0.5 text-al-meta text-muted-foreground">Flag status: {e.status}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  </div>
);

export const PriceIntegritySection = ({ rows, loading }: { rows: PriceRow[]; loading: boolean }) => {
  const [openVin, setOpenVin] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const review = useMemo(() => priceRowsNeedingReview(rows), [rows]);
  const unresolved = useMemo(() => countUnresolvedPriceVins(rows), [rows]);
  const monitored = rows.filter((r) => r.websitePrice != null).length;
  const matched = rows.filter((r) => r.state === "matched").length;
  const historicalEvents = rows.reduce((s, r) => s + r.historicalEvents, 0);
  const listed = showAll ? rows : rows.filter((r) => r.state !== "not_monitored");
  const selected = rows.find((r) => r.vin === openVin) ?? null;

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Price integrity"
        description="What a shopper is quoted must reconcile to what the dealership will charge. Three reads of the same number per vehicle: the price a person confirmed, the price the inventory feed carries, and the price the nightly crawl found on the website."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CountTile
          label="Needs review"
          value={unresolved}
          tone={unresolved > 0 ? "critical" : "clear"}
          means="Vehicles with an unresolved price problem right now: a live website discrepancy or an open document flag. This is the number a navigation badge may show."
        />
        <CountTile
          label="Website monitored"
          value={monitored}
          means="Vehicles with at least one real website price snapshot on record. A seeded URL with no capture yet does not count."
        />
        <CountTile
          label="Reconciled"
          value={matched}
          tone={matched > 0 ? "clear" : "neutral"}
          means="Monitored vehicles where the website price matches the reference price, allowing for the doc fee."
        />
        <CountTile
          label="Historical events"
          value={historicalEvents.toLocaleString()}
          means="Every price snapshot and document flag ever recorded across these vehicles. History, not a task list — it lives in each VIN's timeline."
        />
      </div>

      <p className="text-al-meta text-muted-foreground">
        Website monitoring is configured in Admin, under Price Integrity: seed your vehicle-detail-page URL
        pattern once and the nightly crawl captures a snapshot per vehicle from then on.
      </p>

      <Panel
        title="Price change review"
        meta="Grouped by VIN. One row is one vehicle to resolve, however many events sit behind it."
      >
        {loading ? (
          <p className="px-4 py-10 text-center text-al-body text-muted-foreground">Reconciling prices…</p>
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
              <tr key={r.vehicleId} className="hover:bg-muted/30">
                <td className="px-4 py-3">
                  <p className="text-al-card text-foreground">{r.title}</p>
                  <p className="font-mono text-al-meta text-muted-foreground">{r.stockNumber || r.vin}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="text-al-body text-foreground">{r.currentIssue}</p>
                  <p className="mt-0.5 text-al-meta text-muted-foreground">
                    {r.referenceLabel
                      ? `${r.referenceLabel} ${money(r.referencePrice)} vs website ${money(r.websitePrice)}`
                      : "No reference price on record."}
                  </p>
                </td>
                <td className="px-4 py-3 text-al-body tabular-nums text-foreground">{r.historicalEvents}</td>
                <td className="px-4 py-3 text-al-meta text-muted-foreground">{formatDateTime(r.lastCheckedAt)}</td>
                <td className="px-4 py-3 text-right">
                  <RowAction onClick={() => setOpenVin(r.vin)}>Review</RowAction>
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
            className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-al-meta font-bold text-foreground hover:bg-muted"
          >
            {showAll ? "Hide unmonitored" : "Show unmonitored"}
          </button>
        }
      >
        {loading ? (
          <p className="px-4 py-10 text-center text-al-body text-muted-foreground">Loading vehicles…</p>
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
              <tr key={r.vehicleId} className="hover:bg-muted/30">
                <td className="px-4 py-3">
                  <p className="font-mono text-al-meta text-foreground">{r.vin}</p>
                  <p className="text-al-meta text-muted-foreground">{r.title}</p>
                </td>
                <td className="px-4 py-3 text-al-body tabular-nums text-foreground">
                  {r.confirmedPrice == null ? (
                    <span className="text-muted-foreground">Not confirmed</span>
                  ) : (
                    money(r.confirmedPrice)
                  )}
                </td>
                <td className="px-4 py-3 text-al-body tabular-nums text-foreground">{money(r.feedPrice)}</td>
                <td className="px-4 py-3 text-al-body tabular-nums text-foreground">{money(r.websitePrice)}</td>
                <td className="px-4 py-3 text-al-meta text-muted-foreground">{formatDateTime(r.websiteAt)}</td>
                <td className="px-4 py-3 text-al-body tabular-nums text-foreground">
                  {r.difference == null ? (
                    "—"
                  ) : (
                    <>
                      {r.difference > 0 ? "+" : r.difference < 0 ? "−" : ""}
                      {money(Math.abs(r.difference))}
                      {r.matchedWithDocFee && (
                        <span className="ml-1 text-al-meta text-muted-foreground">after doc fee</span>
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
                    <RowAction onClick={() => setOpenVin(r.vin)}>Timeline</RowAction>
                  </div>
                </td>
              </tr>
            ))}
          </TableShell>
        )}
      </Panel>

      {selected && <VinTimeline row={selected} onClose={() => setOpenVin(null)} />}
    </div>
  );
};

export default PriceIntegritySection;
