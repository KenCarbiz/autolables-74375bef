import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MoreHorizontal, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import Seo from "@/components/Seo";
import { useSmsDelivery } from "@/hooks/useSmsDelivery";
import {
  money,
  relativeTime,
  type CustomerEntry,
  type DealEntry,
} from "@/components/customers/customerBook";
import { useCustomerBook } from "@/components/customers/useCustomerBook";
import {
  Chip,
  EmptyBlock,
  NextActionCell,
  PriceIntegrityChip,
  TabStrip,
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

type DealTab = "drafts" | "out_for_signature" | "signed" | "delivered" | "returns";

const TAB_LABEL: Record<DealTab, string> = {
  drafts: "Drafts",
  out_for_signature: "Out for signature",
  signed: "Signed",
  delivered: "Delivered",
  returns: "Returns",
};

const TAB_EMPTY: Record<DealTab, string> = {
  drafts: "No draft deals. A deal starts here when an addendum is created and stays until the price verifies and it is sent for signature.",
  out_for_signature: "No deals are waiting on a signature.",
  signed: "No signed deals are waiting on delivery.",
  delivered: "No delivered deals in this window.",
  returns: "No deal has a return window or a return request. SB 766 stamps a three-day window on qualifying California sales signed on or after October 1, 2026.",
};

const inTab = (deal: DealEntry, tab: DealTab): boolean => {
  if (tab === "returns") return !!deal.returnInfo;
  if (tab === "drafts") return deal.state === "draft";
  if (tab === "out_for_signature") return deal.state === "out_for_signature";
  if (tab === "signed") return deal.state === "signed";
  return deal.state === "delivered";
};

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

const Deals = () => {
  const navigate = useNavigate();
  const { book, loading, error, refetch } = useCustomerBook();
  const { sendSigningLink } = useSmsDelivery();
  const [tab, setTab] = useState<DealTab>("out_for_signature");
  const [q, setQ] = useState("");

  const customerById = useMemo(() => {
    const m = new Map<string, CustomerEntry>();
    for (const c of book.customers) m.set(c.id, c);
    return m;
  }, [book.customers]);

  const needle = q.trim().toLowerCase();
  const searched = useMemo(
    () =>
      book.deals.filter((d) =>
        !needle
          ? true
          : `${d.vehicleLabel} ${d.stock || ""} ${d.vin || ""} ${d.customerName || ""} ${d.employeeName || ""}`.toLowerCase().includes(needle),
      ),
    [book.deals, needle],
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
    <div className="max-w-[1520px] mx-auto p-4 lg:p-6 space-y-5">
      <Seo title="Deals" description="Every deal, its signature state, its price integrity, and what it needs next." path="/deals" />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-al-page font-display text-foreground">Deals</h1>
          <p className="text-al-body text-muted-foreground mt-1 max-w-3xl">
            Every addendum in the state the database says it is in. Price integrity is the server-side check that gates signing - a
            mismatch cannot be signed around.
          </p>
        </div>
        <button
          type="button"
          onClick={refetch}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-al-body font-semibold hover:bg-muted transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      {error && (
        <p className="text-al-body text-destructive bg-destructive/10 rounded-lg px-4 py-2.5">Some deal data failed to load: {error}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <TabStrip tabs={tabs} active={tab} onSelect={setTab} />
        <label className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search vehicle, stock, VIN, customer"
            aria-label="Search deals"
            className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-card text-al-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
      </div>

      {loading && !book.deals.length ? (
        <div className="bg-card rounded-2xl border border-border shadow-premium px-5 py-12 text-center">
          <p className="text-al-body text-muted-foreground">Loading deals...</p>
        </div>
      ) : rows.length === 0 ? (
        <EmptyBlock title={`No deals in ${TAB_LABEL[tab]}`} body={needle ? "No deal matches that search in this tab." : TAB_EMPTY[tab]} />
      ) : (
        <>
          <div className="hidden lg:block bg-card rounded-2xl border border-border shadow-premium overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-left">
                <thead className="bg-muted/40">
                  <tr className="text-al-meta uppercase tracking-wider text-muted-foreground">
                    <th className="font-semibold px-5 py-2.5">Date</th>
                    <th className="font-semibold py-2.5">Vehicle</th>
                    <th className="font-semibold py-2.5">Stock</th>
                    <th className="font-semibold py-2.5">Customer</th>
                    <th className="font-semibold py-2.5 text-right pr-4">Amount</th>
                    <th className="font-semibold py-2.5">State</th>
                    <th className="font-semibold py-2.5">Price integrity</th>
                    <th className="font-semibold py-2.5">Next action</th>
                    <th className="font-semibold py-2.5 pr-5 text-right">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((deal) => {
                    const customer = deal.customerId ? customerById.get(deal.customerId) || null : null;
                    return (
                      <tr key={deal.id} className="border-t border-border align-top hover:bg-muted/30 transition-colors">
                        <td className="px-5 py-3.5 text-al-meta text-muted-foreground tabular-nums whitespace-nowrap">{dateLabel(deal.createdAt)}</td>
                        <td className="py-3.5 pr-4 w-[16%]">
                          <VehicleCell label={deal.vehicleLabel} stock={null} vin={deal.vin} slug={deal.slug} />
                        </td>
                        <td className="py-3.5 pr-4 text-al-body text-foreground whitespace-nowrap">{deal.stock || "--"}</td>
                        <td className="py-3.5 pr-4 w-[13%]">
                          <p className="text-al-body text-foreground truncate">{deal.customerName || "No customer on the deal"}</p>
                          {deal.employeeName && <p className="text-al-meta text-muted-foreground truncate">Sold by {deal.employeeName}</p>}
                        </td>
                        <td className="py-3.5 pr-4 text-al-body text-foreground text-right tabular-nums whitespace-nowrap">{money(deal.amount)}</td>
                        <td className="py-3.5 pr-4">
                          <Chip tone={dealStateTone(deal.state)}>{deal.stateLabel}</Chip>
                          <p className="text-al-meta text-muted-foreground mt-1">{deal.returnInfo ? deal.returnInfo.label : deal.stateDetail}</p>
                        </td>
                        <td className="py-3.5 pr-4">
                          <PriceIntegrityChip integrity={deal.priceIntegrity} />
                        </td>
                        <td className="py-3.5 pr-4 w-[22%]">
                          <NextActionCell action={deal.nextAction} />
                        </td>
                        <td className="py-3.5 pr-5">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => view(deal)}
                              className="inline-flex items-center h-8 px-3 rounded-md bg-primary text-primary-foreground text-al-meta font-semibold hover:brightness-110 transition-all"
                            >
                              View
                            </button>
                            <DealMenu deal={deal} customer={customer} onCopy={copyLink} onText={textLink} onOpenVehicleFile={(id) => navigate(`/vehicle-file/${id}`)} onOpenCustomer={(id) => navigate(`/customers/${encodeURIComponent(id)}`)} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:hidden space-y-3">
            {rows.map((deal) => {
              const customer = deal.customerId ? customerById.get(deal.customerId) || null : null;
              return (
                <article key={deal.id} className="bg-card rounded-2xl border border-border shadow-premium p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <VehicleCell label={deal.vehicleLabel} stock={deal.stock} vin={deal.vin} slug={deal.slug} />
                    <span className="text-al-meta text-muted-foreground whitespace-nowrap">{dateLabel(deal.createdAt)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={dealStateTone(deal.state)}>{deal.stateLabel}</Chip>
                    <PriceIntegrityChip integrity={deal.priceIntegrity} />
                    <span className="text-al-body text-foreground tabular-nums">{money(deal.amount)}</span>
                  </div>
                  <p className="text-al-meta text-muted-foreground">
                    {deal.customerName || "No customer on the deal"}
                    {deal.employeeName ? ` · Sold by ${deal.employeeName}` : ""}
                    {deal.signedAt ? ` · Signed ${relativeTime(deal.signedAt)}` : ""}
                  </p>
                  <div className="border-t border-border pt-3">
                    <NextActionCell action={deal.nextAction} />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => view(deal)}
                      className="inline-flex items-center h-9 px-4 rounded-md bg-primary text-primary-foreground text-al-body font-semibold"
                    >
                      View
                    </button>
                    <DealMenu deal={deal} customer={customer} onCopy={copyLink} onText={textLink} onOpenVehicleFile={(id) => navigate(`/vehicle-file/${id}`)} onOpenCustomer={(id) => navigate(`/customers/${encodeURIComponent(id)}`)} />
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

const DealMenu = ({
  deal,
  customer,
  onCopy,
  onText,
  onOpenVehicleFile,
  onOpenCustomer,
}: {
  deal: DealEntry;
  customer: CustomerEntry | null;
  onCopy: (deal: DealEntry) => void;
  onText: (deal: DealEntry, phone: string) => void;
  onOpenVehicleFile: (listingId: string) => void;
  onOpenCustomer: (customerId: string) => void;
}) => {
  const phone = customer?.phone || null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors"
        aria-label={`More actions for ${deal.vehicleLabel}`}
      >
        <MoreHorizontal className="w-4 h-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
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
