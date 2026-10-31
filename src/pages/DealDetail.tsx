import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import Seo from "@/components/Seo";
import {
  EmptyState,
  LinkButton,
  LocalTabs,
  PageBody,
  PageHeader,
  Panel,
  SkeletonBlock,
  StatusText,
  Td,
  Th,
  WorkTable,
  type LocalTab,
  type Tone,
} from "@/components/product";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import DealNumberField from "@/components/customers/DealNumberField";
import { money, type DealEntry } from "@/components/customers/customerBook";
import { useCustomerBook } from "@/components/customers/useCustomerBook";
import { useVehicleDocuments } from "@/lib/stickerStudio/useVehicleDocuments";
import { STATUS_META, type GeneratedDocument } from "@/lib/stickerStudio/documentWorkflow";
import { Crumbs, DetailLayout, FactStrip, SummaryList, fmtDateTime, fmtDay } from "@/components/detail/parts";

// /deals/:id — one deal, read from the same customer book as the Deals list.
// There is no deals table: the id is the addendum id. Nothing here signs,
// sends or overwrites a price; Resolve price opens the evidence review.

type DealTabKey = "summary" | "documents" | "signing" | "delivery" | "history";

const TABS: { key: DealTabKey; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "documents", label: "Documents" },
  { key: "signing", label: "Signing" },
  { key: "delivery", label: "Delivery" },
  { key: "history", label: "History" },
];

const DOC_TYPE_LABEL: Record<string, string> = {
  window: "Window sticker",
  addendum: "Addendum",
  passport: "Vehicle passport",
  cpo_sheet: "CPO sheet",
  buyers_guide: "FTC Buyers Guide",
  factory_sticker: "Factory build record",
};

const DOC_TONE: Record<string, Tone> = {
  approved: "success",
  printed: "success",
  published: "success",
  pending_approval: "warning",
  rejected: "danger",
};

const dealTone = (state: DealEntry["state"]): Tone => (state === "draft" ? "neutral" : state === "out_for_signature" ? "warning" : "success");

const shortDay = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Unknown");

const shortId = (id: string) => id.slice(0, 8).toUpperCase();

interface Check {
  label: string;
  value: string;
  tone: Tone;
}

const eligibilityChecks = (deal: DealEntry, docs: GeneratedDocument[] | null): Check[] => {
  const price: Check =
    deal.priceIntegrity.state === "verified"
      ? { label: "Price verification", value: "Verified", tone: "success" }
      : deal.priceIntegrity.state === "mismatch"
        ? { label: "Price verification", value: "Required", tone: "danger" }
        : { label: "Price verification", value: deal.priceIntegrity.state === "untracked" ? "Not tracked" : "Pending", tone: "warning" };
  const documents: Check =
    docs === null
      ? { label: "Documents generated", value: "Unknown", tone: "neutral" }
      : docs.length
        ? { label: "Documents generated", value: `${docs.length} on file`, tone: "success" }
        : { label: "Documents generated", value: "None on file", tone: "warning" };
  return [
    price,
    documents,
    deal.customerName
      ? { label: "Customer identity", value: "Named", tone: "success" }
      : { label: "Customer identity", value: "Missing", tone: "warning" },
    deal.signingToken
      ? { label: "Signing link", value: "Issued", tone: "success" }
      : { label: "Signing link", value: "Not issued", tone: "neutral" },
  ];
};

const DealDetail = () => {
  const { id = "" } = useParams<{ id: string }>();
  const dealId = decodeURIComponent(id);
  const [searchParams] = useSearchParams();
  const { book, loading, error, refetch } = useCustomerBook();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const canEditDealNumber = hasDealerCapability(member?.role, "can_create_documents", isAdmin);
  const deal = useMemo(() => book.deals.find((d) => d.id === dealId) || null, [book.deals, dealId]);
  const docsState = useVehicleDocuments(deal?.listingId ?? null);

  if (loading && !deal) {
    return (
      <PageBody width="wide">
        <div role="status" aria-label="Loading deal" className="flex flex-col gap-3">
          <SkeletonBlock className="h-5 w-40" />
          <SkeletonBlock className="h-10 w-1/3" />
          <SkeletonBlock className="h-20 w-full" />
          <SkeletonBlock className="h-64 w-full" />
        </div>
      </PageBody>
    );
  }

  if (!deal) {
    return (
      <PageBody width="form">
        <Crumbs items={[{ label: "Deals", to: "/deals" }, { label: "Not found" }]} />
        <EmptyState
          title={error ? "Deals could not be loaded" : "Deal not found"}
          detail={
            error
              ? error
              : "This deal is not in the current deal window. It may be older than the window, or it may belong to another store."
          }
          action={
            error ? (
              <button type="button" onClick={refetch} className="text-[14px] font-semibold text-adm-primary hover:underline">Retry</button>
            ) : (
              <LinkButton to="/deals" variant="primary">Back to deals</LinkButton>
            )
          }
        />
      </PageBody>
    );
  }

  const tabParam = searchParams.get("tab");
  const tab: DealTabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as DealTabKey) : "summary";
  const docs: GeneratedDocument[] | null = deal.listingId && docsState.available && !docsState.loading ? docsState.documents : null;
  const checks = eligibilityChecks(deal, docs);
  const blocked = deal.state === "draft" || deal.state === "out_for_signature" ? checks.some((c) => c.tone === "danger" || c.tone === "warning") : false;
  const eligibility: { label: string; tone: Tone; note: string } =
    deal.state === "signed" || deal.state === "delivered"
      ? { label: "Signed", tone: "success", note: "The signed output is immutable." }
      : deal.priceIntegrity.state !== "verified"
        ? { label: "Not ready", tone: "danger", note: "Customer signing is blocked until the price is verified." }
        : blocked
          ? { label: "Not ready", tone: "warning", note: "Resolve the open checks before the deal goes out for signature." }
          : { label: "Ready", tone: "success", note: "Every check below is clear." };

  const resolveTo = deal.listingId ? `/vehicle-file/${deal.listingId}?tab=compliance` : null;
  const docRoute = (docId: string) => `/vehicle-file/${deal.listingId}/documents/${docId}`;

  const tabs: LocalTab[] = TABS.map((t) => ({
    key: t.key,
    label: t.label,
    to: t.key === "summary" ? `/deals/${encodeURIComponent(deal.id)}` : `/deals/${encodeURIComponent(deal.id)}?tab=${t.key}`,
    active: tab === t.key,
  }));

  const recentDocs = (docs || []).slice(0, 4);

  const docsTable = (rows: GeneratedDocument[]) => (
    <WorkTable caption="Documents on file for this deal's vehicle" minWidth={560}>
      <thead>
        <tr><Th>Document</Th><Th>Version</Th><Th>Updated</Th><Th>Status</Th></tr>
      </thead>
      <tbody>
        {rows.map((d) => (
          <tr key={d.id}>
            <Td className="font-semibold whitespace-nowrap">
              <Link to={docRoute(d.id)} className="text-adm-primary hover:underline">{DOC_TYPE_LABEL[d.document_type] || d.document_type}</Link>
            </Td>
            <Td className="whitespace-nowrap">v{d.version}</Td>
            <Td className="text-adm-muted whitespace-nowrap">{shortDay(d.created_at)}</Td>
            <Td><StatusText tone={DOC_TONE[d.document_status] || "neutral"}>{STATUS_META[d.document_status]?.label || d.document_status}</StatusText></Td>
          </tr>
        ))}
      </tbody>
    </WorkTable>
  );

  const docsBody = (rows: GeneratedDocument[], emptyText: string) =>
    docs === null ? (
      <p className="text-[14px] leading-[20px] text-adm-muted">
        {deal.listingId ? (docsState.loading ? "Reading documents." : "Documents could not be read.") : "This deal has no matching vehicle file, so no documents can be listed."}
      </p>
    ) : rows.length ? (
      docsTable(rows)
    ) : (
      <p className="text-[14px] leading-[20px] text-adm-muted">{emptyText}</p>
    );

  const timeline = [
    { at: deal.createdAt, label: "Deal created" },
    { at: deal.customerSignedAt, label: "Customer signed" },
    { at: deal.employeeSignedAt, label: "Dealer counter-signed" },
    { at: deal.deliveredAt, label: "Delivered" },
    ...(deal.returnInfo?.requestedAt ? [{ at: deal.returnInfo.requestedAt, label: "Return requested" }] : []),
  ]
    .filter((e): e is { at: string; label: string } => !!e.at)
    .sort((a, b) => b.at.localeCompare(a.at));

  const snapshot = (
    <Panel title="Deal snapshot" titleSize="sm" inset="sm">
      <SummaryList
        rows={[
          { label: "Deal #", value: <DealNumberField addendumId={deal.id} canEdit={canEditDealNumber} /> },
          { label: "Selling price", value: money(deal.sellingPrice) },
          { label: "Add-on options total", value: money(deal.amount) },
          {
            label: "Price check",
            value:
              deal.priceIntegrity.state === "mismatch" && deal.priceIntegrity.delta != null
                ? `${deal.priceIntegrity.label}, off by ${money(Math.abs(deal.priceIntegrity.delta))}`
                : deal.priceIntegrity.label,
          },
        ]}
      />
      <p className="mt-2 text-[12px] leading-[18px] text-adm-muted">Tax, fees and MSRP are not stored on the deal record and are not estimated here.</p>
    </Panel>
  );

  const eligibilityPanel = (
    <Panel title="Signing eligibility" titleSize="sm" inset="sm">
      <StatusText tone={eligibility.tone}>{eligibility.label}</StatusText>
      <p className="mt-1.5 text-[13px] leading-[18px] text-adm-muted">{eligibility.note}</p>
      <ul className="mt-3 divide-y divide-adm-border border-t border-adm-border">
        {checks.map((c) => (
          <li key={c.label} className="flex items-center justify-between gap-3 py-2 text-[14px] leading-[20px]">
            <span className="text-adm-ink">{c.label}</span>
            <StatusText tone={c.tone}>{c.value}</StatusText>
          </li>
        ))}
      </ul>
    </Panel>
  );

  const recentPanel = (
    <Panel title="Recent documents" titleSize="sm" inset="sm" flush>
      <div className="px-4 pb-4">{docsBody(recentDocs, "No generated documents are on file for this vehicle.")}</div>
    </Panel>
  );

  return (
    <PageBody width="wide">
      <Seo title={`Deal ${shortId(deal.id)}`} description="One deal: snapshot, signing eligibility and documents." path={`/deals/${deal.id}`} />
      <Crumbs items={[{ label: "Deals", to: "/deals" }, { label: shortId(deal.id) }]} />

      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            Deal {shortId(deal.id)}
            <StatusText tone={dealTone(deal.state)}>{deal.stateLabel}</StatusText>
          </span>
        }
        description={deal.returnInfo ? deal.returnInfo.label : deal.stateDetail}
        actions={
          <>
            {deal.listingId && (
              <LinkButton to={`/vehicle-file/${deal.listingId}`}>View vehicle</LinkButton>
            )}
            {deal.customerId && deal.customerName && (
              <LinkButton to={`/customers/${encodeURIComponent(deal.customerId)}`}>Customer record</LinkButton>
            )}
            {deal.priceIntegrity.state !== "verified" && resolveTo && deal.state !== "signed" && deal.state !== "delivered" ? (
              <LinkButton to={resolveTo} variant="primary">Resolve price</LinkButton>
            ) : deal.signingToken ? (
              <a
                href={`${window.location.origin}/sign/${deal.signingToken}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-md font-semibold text-[14px] leading-[20px] min-h-[36px] px-3.5 bg-adm-primary text-white border border-adm-primary hover:bg-adm-primary-hover"
              >
                Open signing link
              </a>
            ) : null}
          </>
        }
      />

      <FactStrip
        label="Deal identity"
        facts={[
          { label: "Customer", value: deal.customerName || "None on the deal" },
          { label: "Selected vehicle", value: deal.vehicleLabel },
          { label: "VIN", value: <span className="font-mono">{deal.vin || "Unknown"}</span> },
          { label: "Created", value: fmtDay(deal.createdAt) },
          { label: "Last updated", value: fmtDay(deal.updatedAt) },
          { label: "Owner", value: deal.employeeName || "Unassigned" },
        ]}
        className="lg:grid-cols-6"
      />

      <LocalTabs tabs={tabs} label="Deal sections" />

      {tab === "summary" && (
        <div className="grid gap-6 lg:grid-cols-[260px_300px_minmax(0,1fr)] lg:items-start">
          {snapshot}
          {eligibilityPanel}
          {recentPanel}
        </div>
      )}

      {tab === "documents" && (
        <DetailLayout
          main={
            <Panel title="Documents" titleSize="sm" inset="sm">
              {docsBody(docs || [], "No generated documents are on file for this vehicle.")}
            </Panel>
          }
          aside={eligibilityPanel}
        />
      )}

      {tab === "signing" && (
        <DetailLayout
          main={
            <Panel title="Signing" titleSize="sm" inset="sm">
              <SummaryList
                rows={[
                  { label: "State", value: deal.stateLabel },
                  { label: "Customer signed", value: fmtDateTime(deal.customerSignedAt) },
                  { label: "Dealer counter-signed", value: fmtDateTime(deal.employeeSignedAt) },
                  { label: "Signing link", value: deal.signingToken ? "Issued" : "Not issued" },
                ]}
              />
              <p className="mt-3 text-[14px] leading-[20px] text-adm-ink">{deal.nextAction.headline}</p>
              <p className="text-[13px] leading-[18px] text-adm-muted">{deal.nextAction.detail}</p>
            </Panel>
          }
          aside={eligibilityPanel}
        />
      )}

      {tab === "delivery" && (
        <DetailLayout
          main={
            <Panel title="Delivery" titleSize="sm" inset="sm">
              <SummaryList
                rows={[
                  { label: "Delivered", value: deal.deliveredAt ? fmtDateTime(deal.deliveredAt) : "Not delivered" },
                  { label: "Return window", value: deal.returnInfo ? deal.returnInfo.label : "None recorded" },
                  { label: "Window closes", value: deal.returnInfo?.closesAt ? fmtDateTime(deal.returnInfo.closesAt) : "Unknown" },
                ]}
              />
            </Panel>
          }
          aside={snapshot}
        />
      )}

      {tab === "history" && (
        <DetailLayout
          main={
            <Panel title="History" titleSize="sm" inset="sm">
              {timeline.length ? (
                <ol className="divide-y divide-adm-border">
                  {timeline.map((e) => (
                    <li key={`${e.label}-${e.at}`} className="flex items-center justify-between gap-4 py-2 text-[14px] leading-[20px]">
                      <span className="text-adm-ink">{e.label}</span>
                      <span className="text-adm-muted tabular-nums">{fmtDateTime(e.at)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-[14px] leading-[20px] text-adm-muted">No dated events are recorded for this deal.</p>
              )}
            </Panel>
          }
          aside={snapshot}
        />
      )}
    </PageBody>
  );
};

export default DealDetail;
