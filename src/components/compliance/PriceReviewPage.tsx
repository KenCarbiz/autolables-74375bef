import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Crumbs, DetailLayout, fmtDateTime } from "@/components/detail/parts";
import { LinkButton, LocalTabs, PageBody, PageHeader, Panel, QueryState, StatusText, Td, Th, WorkTable, type Tone } from "@/components/product";
import { PRICE_STATE_LABEL, money, type PriceRow, type PriceState } from "./complianceData";
import { useComplianceCenterData } from "./useComplianceCenterData";
import { complianceVinParam } from "./childLinks";

const STATE_TONE: Record<PriceState, Tone> = {
  matched: "success",
  differs: "danger",
  awaiting_snapshot: "neutral",
  not_monitored: "neutral",
  no_price: "warning",
};

const hostOf = (url: string | null): string => {
  if (!url) return "Unknown";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const sum = (a: number | null, b: number): number | null => (a == null ? null : a + b);

const Evidence = ({ row }: { row: PriceRow }) => {
  const referenceTotal = sum(row.referencePrice, row.docFee);
  const differs = row.state === "differs" && row.difference != null;
  const gapText =
    row.difference == null
      ? "No website price has been captured to compare."
      : row.difference === 0
        ? "Website price matches the reference price."
        : `Website price is ${money(Math.abs(row.difference))} ${row.difference < 0 ? "lower" : "higher"} than the ${row.referenceLabel === "Feed" ? "feed" : "confirmed"} price${row.matchedWithDocFee ? " after the doc fee" : ""}.`;
  return (
    <Panel title="Pricing evidence" flush inset="sm">
      <WorkTable caption="Pricing evidence" minWidth={560}>
        <thead>
          <tr>
            <Th>Item</Th>
            <Th>Value</Th>
            <Th>Source</Th>
            <Th>Updated</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Td>Dealer-confirmed price</Td>
            <Td className="tabular-nums">{row.confirmedPrice == null ? <span className="text-adm-muted">Not confirmed</span> : money(row.confirmedPrice)}</Td>
            <Td>Dealer confirmation</Td>
            <Td>{fmtDateTime(row.confirmedAt)}</Td>
          </tr>
          <tr>
            <Td>Feed price</Td>
            <Td className="tabular-nums">{money(row.feedPrice)}</Td>
            <Td>Inventory feed</Td>
            <Td>Unknown</Td>
          </tr>
          <tr>
            <Td>Website advertised price</Td>
            <Td className="tabular-nums">{money(row.websitePrice)}</Td>
            <Td className="max-w-[170px] truncate">{hostOf(row.websiteUrl)}</Td>
            <Td>{fmtDateTime(row.websiteAt)}</Td>
          </tr>
          <tr>
            <Td>Doc fee</Td>
            <Td className="tabular-nums">{money(row.docFee)}</Td>
            <Td>Dealer configuration</Td>
            <Td>Unknown</Td>
          </tr>
          <tr className="font-semibold">
            <Td>Reference total</Td>
            <Td className="tabular-nums">{money(referenceTotal)}</Td>
            <td colSpan={2} className="border-b border-adm-border px-3 py-3.5 font-normal text-adm-muted">
              {row.referencePrice == null ? "No reference price" : `${money(row.referencePrice)} + ${money(row.docFee)} doc fee`}
            </td>
          </tr>
        </tbody>
      </WorkTable>
      <div className={`flex flex-wrap items-center gap-3 border-t px-4 py-3 text-[14px] leading-[20px] ${differs ? "border-[#F3B4AE] bg-adm-danger-bg" : "border-adm-border bg-adm-workspace"}`}>
        <span className="font-semibold text-adm-ink">Comparison result</span>
        <StatusText tone={STATE_TONE[row.state]}>{PRICE_STATE_LABEL[row.state]}</StatusText>
        <span className="text-adm-ink">{gapText}</span>
      </div>
    </Panel>
  );
};

const History = ({ row }: { row: PriceRow }) => (
  <Panel title={`Price and document events (${row.events.length})`} flush inset="sm">
    {row.events.length === 0 ? (
      <p className="px-4 pb-4 text-[14px] leading-[20px] text-adm-muted">No price snapshots or document flags have been recorded for this VIN.</p>
    ) : (
      <WorkTable caption="Price events" minWidth={560}>
        <thead>
          <tr>
            <Th>Date and time</Th>
            <Th>Event</Th>
            <Th>Detail</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {row.events.map((e) => (
            <tr key={e.id}>
              <Td className="whitespace-nowrap">{fmtDateTime(e.at)}</Td>
              <Td>{e.label}</Td>
              <Td className="max-w-[360px] truncate">{e.detail}</Td>
              <Td>{e.kind === "document_flag" && e.status ? e.status : "Recorded"}</Td>
            </tr>
          ))}
        </tbody>
      </WorkTable>
    )}
  </Panel>
);

export default function PriceReviewPage() {
  const { vin: raw } = useParams<{ vin: string }>();
  const vin = complianceVinParam(raw);
  const data = useComplianceCenterData();
  const row = useMemo(() => data.priceRows.find((r) => r.vin === vin) ?? null, [data.priceRows, vin]);
  const [params] = useSearchParams();
  const tab = params.get("tab") === "history" ? "history" : "details";
  const base = `/compliance/price-review/${vin}`;

  const crumbs = [
    { label: "Compliance", to: "/compliance" },
    { label: "Price integrity", to: "/compliance?tab=price" },
    { label: row?.stockNumber || vin },
  ];

  const status: "loading" | "error" | "empty" | "ready" = data.loading ? "loading" : data.error ? "error" : !row ? "empty" : "ready";

  return (
    <PageBody width="wide">
      <Crumbs items={crumbs} />
      <PageHeader
        title={row ? `Price review — ${row.title.split(" ").slice(0, 3).join(" ")}` : "Price review"}
        description={<span className="font-mono">VIN {vin}{row?.stockNumber ? `  |  Stock ${row.stockNumber}` : ""}</span>}
        meta={row && (
          <dl className="flex flex-wrap items-start gap-x-6 gap-y-1 text-left">
            {[
              { label: "Review reason", value: <span title={row.currentIssue ?? undefined} className="block max-w-[170px] truncate">{row.currentIssue ?? "No open issue"}</span> },
              { label: "Review status", value: <StatusText tone={STATE_TONE[row.state]}>{PRICE_STATE_LABEL[row.state]}</StatusText> },
              { label: "Open document flags", value: row.openFlags },
              { label: "Last checked", value: fmtDateTime(row.lastCheckedAt) },
            ].map((f) => (
              <div key={f.label}>
                <dt className="text-[12px] leading-[18px] text-adm-muted">{f.label}</dt>
                <dd className="text-[13px] leading-[18px] font-semibold text-adm-ink">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      />
      <QueryState
        status={status}
        onRetry={data.refresh}
        errorTitle="Compliance data could not be loaded"
        errorDetail={data.error}
        emptyTitle="No price review for this VIN"
        emptyDetail="The vehicle is not in active inventory for this store."
        emptyAction={<LinkButton to="/compliance?tab=price">Back to Price integrity</LinkButton>}
      >
        {row && (
          <>
            <LocalTabs
              label="Price review"
              tabs={[
                { key: "details", label: "Details", to: base, active: tab === "details" },
                { key: "history", label: "History", to: `${base}?tab=history`, count: row.historicalEvents, active: tab === "history" },
              ]}
            />
            {tab === "history" ? (
              <History row={row} />
            ) : (
              <DetailLayout width="wide"
                main={<Evidence row={row} />}
                aside={
                  <Panel title="Proposed change" titleSize="md" inset="sm" flush>
                    <WorkTable caption="Current and proposed price" minWidth={300}>
                      <thead>
                        <tr><Th>Field</Th><Th align="right">Current</Th><Th align="right">Proposed</Th></tr>
                      </thead>
                      <tbody>
                        <tr><Td>Selling price</Td><Td align="right" className="tabular-nums">{money(row.websitePrice)}</Td><Td align="right" className="tabular-nums">{money(row.referencePrice)}</Td></tr>
                        <tr><Td>Doc fee</Td><Td align="right" className="tabular-nums">{money(row.docFee)}</Td><Td align="right" className="tabular-nums">{money(row.docFee)}</Td></tr>
                        <tr className="font-semibold"><Td>Total</Td><Td align="right" className="tabular-nums">{money(sum(row.websitePrice, row.docFee))}</Td><Td align="right" className="tabular-nums">{money(sum(row.referencePrice, row.docFee))}</Td></tr>
                      </tbody>
                    </WorkTable>
                    <div className="space-y-3 px-4 py-3">
                      <p className="rounded-md bg-[#EEF3FF] px-3 py-2.5 text-[13px] leading-[19px] text-adm-ink">
                        {row.difference == null || row.difference === 0 ? "No change is proposed." : `Proposed is the ${row.referenceLabel === "Feed" ? "feed" : "confirmed"} price, ${money(Math.abs(row.difference))} ${row.difference > 0 ? "below" : "above"} the website. Correct it in the vehicle file; the nightly crawl then re-checks the website.`}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <LinkButton to={`/vehicle-file/${row.vehicleId}`} variant="primary">Open vehicle file</LinkButton>
                        <LinkButton to="/compliance?tab=price">Cancel</LinkButton>
                      </div>
                    </div>
                  </Panel>
                }
              />
            )}
          </>
        )}
      </QueryState>
    </PageBody>
  );
}
