import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { MoreHorizontal, Search } from "lucide-react";
import { toast } from "sonner";
import Seo from "@/components/Seo";
import { useSmsDelivery } from "@/hooks/useSmsDelivery";
import {
  money,
  relativeTime,
  type CustomerEntry,
  type DealEntry,
} from "@/components/customers/customerBook";
import { Button, FilterSelect, InlineNote, LocalTabs, MetricStrip, PageBody, PageHeader, type LocalTab } from "@/components/product";
import { useCustomerBook } from "@/components/customers/useCustomerBook";
import {
  Chip,
  EmptyBlock,
  NextActionCell,
  PriceIntegrityChip,
  VehicleCell,
  dealStateTone,
} from "@/components/customers/CustomerUi";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// /deals — every addendum as a deal, in the state the database says it is in.
// There is no deals table: an addendum IS the deal, addendum_signings carries
// the SB 766 return window, and price integrity is the server-side
// price_verification_status that gates signing.

type DealTab = "all" | "drafts" | "out_for_signature" | "signed" | "delivered" | "returns";

const TAB_LABEL: Record<DealTab, string> = {
  all: "All",
  drafts: "Drafts",
  out_for_signature: "Out for signature",
  signed: "Signed",
  delivered: "Delivered",
  returns: "Returns",
};

const TAB_EMPTY: Record<DealTab, string> = {
  all: "No deals yet. A deal starts when an addendum is created for a vehicle.",
  drafts: "No draft deals. A deal starts here when an addendum is created and stays until the price verifies and it is sent for signature.",
  out_for_signature: "No deals are waiting on a signature.",
  signed: "No signed deals are waiting on delivery.",
  delivered: "No delivered deals in this window.",
  returns: "No deal has a return window or a return request. SB 766 stamps a three-day window on qualifying California sales signed on or after October 1, 2026.",
};

const inTab = (deal: DealEntry, tab: DealTab): boolean => {
  if (tab === "all") return true;
  if (tab === "returns") return !!deal.returnInfo;
  if (tab === "drafts") return deal.state === "draft";
  if (tab === "out_for_signature") return deal.state === "out_for_signature";
  if (tab === "signed") return deal.state === "signed";
  return deal.state === "delivered";
};

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

const ageDays = (iso: string) => `${Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000))}d`;

const Deals = () => {
  const navigate = useNavigate();
  const { book, loading, error, refetch } = useCustomerBook();
  const { sendSigningLink } = useSmsDelivery();
  // Lifecycle view and search live in the URL so opening a deal and returning keeps them.
  const [searchParams, setSearchParams] = useSearchParams();
  const stateParam = searchParams.get("state");
  const tab: DealTab = stateParam && stateParam in TAB_LABEL ? (stateParam as DealTab) : "all";
  const q = searchParams.get("q") ?? "";
  const setQ = (v: string) => {
    const n = new URLSearchParams(searchParams);
    if (v) n.set("q", v); else n.delete("q");
    setSearchParams(n, { replace: true });
  };

  const customerById = useMemo(() => {
    const m = new Map<string, CustomerEntry>();
    for (const c of book.customers) m.set(c.id, c);
    return m;
  }, [book.customers]);

  const [docState, setDocState] = useState("all");
  const needle = q.trim().toLowerCase();
  const searched = useMemo(
    () =>
      book.deals.filter((d) =>
        (docState === "all" || d.state === docState) &&
        (!needle
          ? true
          : `${d.vehicleLabel} ${d.stock || ""} ${d.vin || ""} ${d.customerName || ""} ${d.employeeName || ""}`.toLowerCase().includes(needle)),
      ),
    [book.deals, needle, docState],
  );

  const tabs = useMemo(
    () =>
      (Object.keys(TAB_LABEL) as DealTab[]).map((key) => ({
        key,
        label: TAB_LABEL[key],
        count: searched.filter((d) => inTab(d, key)).length,
      })),
    [searched],
  );

  const rows = useMemo(() => searched.filter((d) => inTab(d, tab)), [searched, tab]);

  const signingUrl = (deal: DealEntry) => (deal.signingToken ? `${window.location.origin}/sign/${deal.signingToken}` : null);

  const copyLink = (deal: DealEntry) => {
    const url = signingUrl(deal);
    if (!url) {
      toast.error("No signing link on this deal");
      return;
    }
    navigator.clipboard.writeText(url).then(
      () => toast.success("Signing link copied"),
      () => toast.error("Could not copy the link"),
    );
  };

  const textLink = async (deal: DealEntry, phone: string) => {
    const url = signingUrl(deal);
    if (!url) {
      toast.error("No signing link on this deal");
      return;
    }
    const result = await sendSigningLink(phone, url, deal.vehicleLabel);
    if (result.success) toast.success(result.message);
    else toast.error(result.message);
  };

  const view = (deal: DealEntry) => {
    const url = signingUrl(deal);
    if (url) {
      window.open(url, "_blank", "noopener");
      return;
    }
    if (deal.listingId) {
      navigate(`/vehicle-file/${deal.listingId}`);
      return;
    }
    toast.error("This deal has no signing link and no matching vehicle file yet");
  };

  return (
    <PageBody width="wide">
      <Seo title="Deals" description="Every deal, its signature state, its price integrity, and what it needs next." path="/deals" />

      <PageHeader title="Deals" />

      {error && (
        <InlineNote tone="danger" title="Some deal data failed to load" action={<Button size="sm" onClick={refetch}>Retry</Button>}>
          {error}
        </InlineNote>
      )}

      <LocalTabs
        label="Deal lifecycle views"
        tabs={tabs.map((t): LocalTab => ({ key: t.key, label: t.label, to: `/deals?state=${t.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`, count: loading && !book.deals.length ? null : t.count, active: t.key === tab }))}
      />
      <MetricStrip boxed
        numberFirst
        label="Deal totals"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect label="Filter by document state" value={docState} onChange={setDocState} className="min-w-[170px]"
              options={[
                { value: "all", label: "All document states" },
                { value: "draft", label: "Draft" },
                { value: "out_for_signature", label: "Out for signature" },
                { value: "signed", label: "Signed" },
                { value: "delivered", label: "Delivered" },
              ]} />
            <label className="relative block">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-adm-muted" aria-hidden="true" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search deals..."
                aria-label="Search deals"
                className="h-9 w-[220px] rounded-[6px] border border-adm-border bg-adm-surface pl-9 pr-3 text-[14px] text-adm-ink placeholder:text-adm-muted focus:outline-none focus:ring-2 focus:ring-adm-primary"
              />
            </label>
          </div>
        }
        metrics={[
          { label: "Total deals", value: loading && !book.deals.length ? null : searched.length },
          { label: "Out for signature", value: loading && !book.deals.length ? null : searched.filter((d) => d.state === "out_for_signature").length },
          { label: "Signed", value: loading && !book.deals.length ? null : searched.filter((d) => d.state === "signed").length },
          { label: "Delivered", value: loading && !book.deals.length ? null : searched.filter((d) => d.state === "delivered").length },
        ]}
      />


      {loading && !book.deals.length ? (
        <div role="status" aria-label="Loading" className="rounded-[6px] border border-adm-border bg-adm-surface px-5 py-12 text-center">
          <p className="text-[14px] text-adm-muted">Loading deals...</p>
        </div>
      ) : rows.length === 0 && error && !book.deals.length ? null : rows.length === 0 ? (
        <EmptyBlock title={`No deals in ${TAB_LABEL[tab]}`} body={needle ? "No deal matches that search in this tab." : TAB_EMPTY[tab]} />
      ) : (
        <>
          <div className="hidden lg:block bg-adm-surface rounded-[6px] border border-adm-border overflow-hidden">
            <table className="w-full table-fixed text-left">
              <thead className="bg-adm-workspace">
                <tr className="text-[12px] leading-[18px] text-adm-muted">
                  <th className="font-semibold px-4 py-2.5 w-[8%]">Stock #</th>
                  <th className="font-semibold py-2.5 w-[27%]">Vehicle</th>
                  <th className="font-semibold py-2.5 w-[11%]">Customer</th>
                  <th className="font-semibold py-2.5 w-[9%] text-right pr-4">Selling price</th>
                  <th className="font-semibold py-2.5 w-[13%]">Document state</th>
                  <th className="font-semibold py-2.5 w-[11%]">Price integrity</th>
                  <th className="font-semibold py-2.5 pl-3 w-[4%]">Age</th>
                  <th className="font-semibold py-2.5 w-[14%]">Next action</th>
                  <th className="font-semibold py-2.5 pr-3 w-[3%]"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((deal) => {
                  const customer = deal.customerId ? customerById.get(deal.customerId) || null : null;
                  return (
                    <tr key={deal.id} className="h-14 border-t border-adm-border hover:bg-adm-workspace transition-colors">
                      <td className="px-4 pr-3 text-[13px] text-adm-muted truncate">{deal.stock || "Unknown"}</td>
                      <td className="pr-3 text-[14px] truncate">
                        <Link to={`/deals/${encodeURIComponent(deal.id)}`} className="font-medium text-adm-ink hover:text-adm-primary hover:underline">{deal.vehicleLabel}</Link>
                      </td>
                      <td className="pr-3 text-[14px] text-adm-ink truncate">
                        {deal.customerName && deal.customerId
                          ? <Link to={`/customers/${encodeURIComponent(deal.customerId)}`} className="text-adm-primary hover:underline">{deal.customerName}</Link>
                          : deal.customerName || "No customer"}
                      </td>
                      <td className="pr-4 text-[14px] text-adm-ink text-right tabular-nums truncate">{deal.sellingPrice != null ? money(deal.sellingPrice) : "Unknown"}</td>
                      <td className="pr-3 whitespace-nowrap"><Chip tone={dealStateTone(deal.state)}>{deal.stateLabel}</Chip></td>
                      <td className="pr-3 whitespace-nowrap"><PriceIntegrityChip integrity={deal.priceIntegrity} /></td>
                      <td className="pl-3 pr-3 text-[13px] text-adm-muted tabular-nums whitespace-nowrap">{ageDays(deal.createdAt)}</td>
                      <td className="pr-3 text-[14px] truncate">
                        <Link to={`/deals/${encodeURIComponent(deal.id)}`} className="text-adm-primary hover:underline">{deal.nextAction.headline}</Link>
                      </td>
                      <td className="pr-3 text-right">
                        <DealMenu deal={deal} customer={customer} onCopy={copyLink} onText={textLink} onView={view} onOpenVehicleFile={(id) => navigate(`/vehicle-file/${id}`)} onOpenCustomer={(id) => navigate(`/customers/${encodeURIComponent(id)}`)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="lg:hidden space-y-3">
            {rows.map((deal) => {
              const customer = deal.customerId ? customerById.get(deal.customerId) || null : null;
              return (
                <article key={deal.id} className="bg-adm-surface rounded-2xl border border-adm-border shadow-premium p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <VehicleCell label={deal.vehicleLabel} stock={deal.stock} vin={deal.vin} slug={deal.slug} />
                    <span className="text-[12px] leading-[18px] text-adm-muted whitespace-nowrap">{dateLabel(deal.createdAt)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={dealStateTone(deal.state)}>{deal.stateLabel}</Chip>
                    <PriceIntegrityChip integrity={deal.priceIntegrity} />
                    <span className="text-[14px] leading-[20px] text-adm-ink tabular-nums">{deal.sellingPrice != null ? money(deal.sellingPrice) : "Unknown"}</span>
                  </div>
                  <p className="text-[12px] leading-[18px] text-adm-muted">
                    {deal.customerName || "No customer on the deal"}
                    {deal.employeeName ? ` · Sold by ${deal.employeeName}` : ""}
                    {deal.signedAt ? ` · Signed ${relativeTime(deal.signedAt)}` : ""}
                  </p>
                  <div className="border-t border-adm-border pt-3">
                    <NextActionCell action={deal.nextAction} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/deals/${encodeURIComponent(deal.id)}`}
                      className="inline-flex items-center h-9 px-4 rounded-md border border-adm-primary text-adm-primary text-[14px] leading-[20px] font-semibold"
                    >
                      Open
                    </Link>
                    <DealMenu deal={deal} customer={customer} onCopy={copyLink} onText={textLink} onView={view} onOpenVehicleFile={(id) => navigate(`/vehicle-file/${id}`)} onOpenCustomer={(id) => navigate(`/customers/${encodeURIComponent(id)}`)} />
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </PageBody>
  );
};

const DealMenu = ({
  deal,
  customer,
  onCopy,
  onText,
  onView,
  onOpenVehicleFile,
  onOpenCustomer,
}: {
  deal: DealEntry;
  customer: CustomerEntry | null;
  onCopy: (deal: DealEntry) => void;
  onText: (deal: DealEntry, phone: string) => void;
  onView: (deal: DealEntry) => void;
  onOpenVehicleFile: (listingId: string) => void;
  onOpenCustomer: (customerId: string) => void;
}) => {
  const phone = customer?.phone || null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center justify-center h-8 w-8 rounded-md text-adm-muted hover:bg-adm-workspace transition-colors"
        aria-label={`More actions for ${deal.vehicleLabel}`}
      >
        <MoreHorizontal className="w-5 h-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {deal.signingToken && <DropdownMenuItem onSelect={() => onView(deal)}>View signing page</DropdownMenuItem>}
        {deal.signingToken && <DropdownMenuItem onSelect={() => onCopy(deal)}>Copy signing link</DropdownMenuItem>}
        {deal.signingToken && phone && <DropdownMenuItem onSelect={() => onText(deal, phone)}>Text the signing link</DropdownMenuItem>}
        {deal.listingId && <DropdownMenuItem onSelect={() => onOpenVehicleFile(deal.listingId as string)}>Open vehicle file</DropdownMenuItem>}
        {deal.slug && (
          <DropdownMenuItem onSelect={() => window.open(`/v/${deal.slug}`, "_blank", "noopener")}>Open vehicle passport</DropdownMenuItem>
        )}
        {customer && <DropdownMenuItem onSelect={() => onOpenCustomer(customer.id)}>Open customer record</DropdownMenuItem>}
        {!deal.signingToken && !deal.listingId && !customer && (
          <DropdownMenuItem disabled>No linked records on this deal</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default Deals;
