import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Download, Mail, Phone, RefreshCw, Search, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import Seo from "@/components/Seo";
import {
  BUCKET_EMPTY_COPY,
  BUCKET_LABEL,
  relativeTime,
  type CustomerBucket,
  type CustomerEntry,
} from "@/components/customers/customerBook";
import { useCustomerBook } from "@/components/customers/useCustomerBook";
import {
  Chip,
  EmptyBlock,
  EngagementCell,
  NextActionCell,
  TabStrip,
  TimeCell,
  VehicleCell,
} from "@/components/customers/CustomerUi";

// /customers (still routed at /leads) — the Customers workspace.
//
// A shopper becomes operationally interesting long before a lead form, so this
// screen is driven by captured engagement, not only by form fills. Two kinds of
// row appear, and they are never blended: people we can name (leads, document
// requests, deals) and anonymous shoppers whose visitor_id has no proven
// identity. An anonymous row NEVER borrows a lead's name.

const TAB_ORDER: CustomerBucket[] = ["hot", "follow_up", "working", "won", "lost"];

const telHref = (phone: string | null) => (phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null);

const matches = (c: CustomerEntry, needle: string) => {
  if (!needle) return true;
  const hay = [
    c.name,
    c.email,
    c.phone,
    ...c.vehicles.map((v) => `${v.label} ${v.vin || ""} ${v.stock || ""}`),
    ...c.deals.map((d) => d.vehicleLabel),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(needle);
};

const Customers = () => {
  const navigate = useNavigate();
  const { book, loading, error, refetch } = useCustomerBook();
  const [tab, setTab] = useState<CustomerBucket>("hot");
  const [q, setQ] = useState("");
  const [busyLead, setBusyLead] = useState<string | null>(null);

  const needle = q.trim().toLowerCase();
  const searched = useMemo(() => book.customers.filter((c) => matches(c, needle)), [book.customers, needle]);
  const tabs = useMemo(
    () => TAB_ORDER.map((key) => ({ key, label: BUCKET_LABEL[key], count: searched.filter((c) => c.bucket === key).length })),
    [searched],
  );
  const rows = useMemo(() => searched.filter((c) => c.bucket === tab), [searched, tab]);

  const identified = book.customers.filter((c) => c.identified).length;
  const anonymous = book.customers.length - identified;

  const markContacted = async (customer: CustomerEntry) => {
    const lead = customer.leads.find((l) => !l.first_response_at) || customer.leads[0];
    if (!lead) return;
    setBusyLead(lead.id);
    // deno-lint-ignore no-explicit-any -- generated types don't cover leads
    const { error: err } = await (supabase as any).from("leads").update({ status: "contacted" }).eq("id", lead.id);
    setBusyLead(null);
    if (err) {
      toast.error("Could not update this customer");
      return;
    }
    toast.success("Marked contacted");
    refetch();
  };

  const exportCsv = () => {
    const header = "Customer,Email,Phone,Vehicle,Engagement,Return status,Assigned,Last activity,Next action";
    const csv = [
      header,
      ...rows.map((c) =>
        [
          c.identified ? c.name || "" : "Unidentified shopper",
          c.email || "",
          c.phone || "",
          c.vehicles[0]?.label || "",
          c.engagement.linked ? `${c.engagement.sessions} visits / ${c.engagement.visitDays} days` : "not linked",
          c.returnStatus.label,
          c.assignedEmployee?.name || "Unassigned",
          c.lastActivityAt || "",
          c.nextAction.headline,
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `customers-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-[1520px] mx-auto p-4 lg:p-6 space-y-5">
      <Seo title="Customers" description="Every shopper working a vehicle, ordered by what they actually did." path="/customers" />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-al-page font-display text-foreground">Customers</h1>
          <p className="text-al-body text-muted-foreground mt-1 max-w-3xl">
            Everyone working a vehicle right now - people who gave you their details, and shoppers who have not yet.
            {" "}
            {identified} identified · {anonymous} anonymous with a real intent action · {book.passiveVisitors} view-only sessions not listed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refetch}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-al-body font-semibold hover:bg-muted transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!rows.length}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-al-body font-semibold hover:bg-muted transition-colors disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
        </div>
      </header>

      {error && (
        <p className="text-al-body text-destructive bg-destructive/10 rounded-lg px-4 py-2.5">
          Some customer data failed to load: {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <TabStrip tabs={tabs} active={tab} onSelect={setTab} />
        <label className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, phone, VIN, stock"
            aria-label="Search customers"
            className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-card text-al-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
      </div>

      {loading && !book.customers.length ? (
        <div className="bg-card rounded-2xl border border-border shadow-premium px-5 py-12 text-center">
          <p className="text-al-body text-muted-foreground">Loading customers...</p>
        </div>
      ) : rows.length === 0 ? (
        <EmptyBlock title={`No customers in ${BUCKET_LABEL[tab]}`} body={needle ? "No customer matches that search in this tab." : BUCKET_EMPTY_COPY[tab]} />
      ) : (
        <>
          <div className="hidden lg:block bg-card rounded-2xl border border-border shadow-premium overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-left">
                <thead className="bg-muted/40">
                  <tr className="text-al-meta uppercase tracking-wider text-muted-foreground">
                    <th className="font-semibold px-5 py-2.5">Customer</th>
                    <th className="font-semibold py-2.5">Vehicle</th>
                    <th className="font-semibold py-2.5">Engagement</th>
                    <th className="font-semibold py-2.5">Return status</th>
                    <th className="font-semibold py-2.5">Assigned employee</th>
                    <th className="font-semibold py-2.5">Last activity</th>
                    <th className="font-semibold py-2.5 pr-5">Next action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => navigate(`/customers/${encodeURIComponent(c.id)}`)}
                      className="border-t border-border align-top cursor-pointer hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-5 py-3.5 w-[15%]">
                        <CustomerIdentity customer={c} />
                      </td>
                      <td className="py-3.5 w-[15%] pr-4">
                        {c.vehicles[0] ? (
                          <VehicleCell label={c.vehicles[0].label} stock={c.vehicles[0].stock} vin={c.vehicles[0].vin} slug={c.vehicles[0].slug} />
                        ) : (
                          <span className="text-al-meta text-muted-foreground">No vehicle attached</span>
                        )}
                        {c.vehicles.length > 1 && (
                          <p className="text-al-meta text-muted-foreground mt-1">+{c.vehicles.length - 1} more</p>
                        )}
                      </td>
                      <td className="py-3.5 w-[20%] pr-4">
                        <EngagementCell engagement={c.engagement} />
                      </td>
                      <td className="py-3.5 w-[12%] pr-4">
                        <p className="text-al-body text-foreground">{c.returnStatus.label}</p>
                        <p className="text-al-meta text-muted-foreground mt-0.5">{c.returnStatus.detail}</p>
                      </td>
                      <td className="py-3.5 w-[10%] pr-4">
                        {c.assignedEmployee ? (
                          <>
                            <p className="text-al-body text-foreground">{c.assignedEmployee.name}</p>
                            <p className="text-al-meta text-muted-foreground">{c.assignedEmployee.source}</p>
                          </>
                        ) : (
                          <span className="text-al-meta text-muted-foreground">Unassigned</span>
                        )}
                      </td>
                      <td className="py-3.5 w-[8%] pr-4">
                        <TimeCell at={c.lastActivityAt} />
                      </td>
                      <td className="py-3.5 pr-5 w-[20%]">
                        <NextActionCell action={c.nextAction} />
                        <RowActions customer={c} busyLead={busyLead} onMarkContacted={markContacted} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:hidden space-y-3">
            {rows.map((c) => (
              <article key={c.id} className="bg-card rounded-2xl border border-border shadow-premium p-4 space-y-3">
                <CustomerIdentity customer={c} />
                {c.vehicles[0] && <VehicleCell label={c.vehicles[0].label} stock={c.vehicles[0].stock} vin={c.vehicles[0].vin} slug={c.vehicles[0].slug} />}
                <EngagementCell engagement={c.engagement} />
                <dl className="grid grid-cols-2 gap-2">
                  <div>
                    <dt className="text-al-meta text-muted-foreground">Return status</dt>
                    <dd className="text-al-body text-foreground">{c.returnStatus.label}</dd>
                  </div>
                  <div>
                    <dt className="text-al-meta text-muted-foreground">Assigned</dt>
                    <dd className="text-al-body text-foreground">{c.assignedEmployee?.name || "Unassigned"}</dd>
                  </div>
                  <div>
                    <dt className="text-al-meta text-muted-foreground">Last activity</dt>
                    <dd className="text-al-body text-foreground">{relativeTime(c.lastActivityAt)}</dd>
                  </div>
                </dl>
                <div className="border-t border-border pt-3">
                  <NextActionCell action={c.nextAction} />
                  <RowActions customer={c} busyLead={busyLead} onMarkContacted={markContacted} />
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const CustomerIdentity = ({ customer }: { customer: CustomerEntry }) => (
  <div className="min-w-0">
    <div className="flex items-center gap-2 min-w-0">
      <UserRound className={`w-4 h-4 shrink-0 ${customer.identified ? "text-foreground" : "text-muted-foreground"}`} />
      <Link
        to={`/customers/${encodeURIComponent(customer.id)}`}
        onClick={(e) => e.stopPropagation()}
        className="text-al-body font-semibold text-foreground truncate hover:underline underline-offset-2"
      >
        {customer.identified ? customer.name || customer.email || "Unnamed customer" : "Unidentified shopper"}
      </Link>
    </div>
    <p className="text-al-meta text-muted-foreground mt-0.5 truncate">
      {customer.identified
        ? [customer.phone, customer.email].filter(Boolean).join(" · ") || "No phone or email captured"
        : "No contact captured"}
    </p>
    {!customer.identified && (
      <div className="mt-1.5">
        <Chip tone="waiting">Anonymous session</Chip>
      </div>
    )}
  </div>
);

const RowActions = ({
  customer,
  busyLead,
  onMarkContacted,
}: {
  customer: CustomerEntry;
  busyLead: string | null;
  onMarkContacted: (c: CustomerEntry) => void;
}) => {
  const tel = telHref(customer.phone);
  const lead = customer.leads.find((l) => !l.first_response_at) || customer.leads[0] || null;
  const showMark = !!lead && lead.status !== "contacted" && lead.status !== "converted";
  const vehicle = customer.vehicles[0];
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const base = "inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-al-meta font-semibold hover:bg-muted transition-colors";
  return (
    <div className="flex flex-wrap items-center gap-2 mt-2.5">
      {tel && (
        <a href={tel} onClick={stop} className={base}>
          <Phone className="w-3.5 h-3.5" /> Call
        </a>
      )}
      {customer.email && (
        <a href={`mailto:${customer.email}`} onClick={stop} className={base}>
          <Mail className="w-3.5 h-3.5" /> Email
        </a>
      )}
      {!customer.identified && vehicle?.slug && (
        <Link to={`/v/${vehicle.slug}`} onClick={stop} className={base}>
          Open passport
        </Link>
      )}
      {!customer.identified && vehicle?.listingId && (
        <Link to={`/vehicle-file/${vehicle.listingId}`} onClick={stop} className={base}>
          Open vehicle file
        </Link>
      )}
      {showMark && (
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            onMarkContacted(customer);
          }}
          disabled={busyLead === lead?.id}
          className={`${base} disabled:opacity-40`}
        >
          Mark contacted
        </button>
      )}
    </div>
  );
};

export default Customers;
