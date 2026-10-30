import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { MoreHorizontal, Mail, Phone, Search, UserRound } from "lucide-react";
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
import { Button, FilterSelect, InlineNote, LocalTabs, MetricStrip, PageBody, PageHeader, Td, Th, WorkTable, type LocalTab } from "@/components/product";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCustomerBook } from "@/components/customers/useCustomerBook";
import {
  Chip,
  EmptyBlock,
  EngagementCell,
  NextActionCell,
  VehicleCell,
} from "@/components/customers/CustomerUi";

const maskContact = (value: string | null | undefined): string => {
  if (!value) return "Not captured";
  const at = value.indexOf("@");
  if (at > 0) return `${value[0]}***${value.slice(at)}`;
  return `***${value.replace(/\D/g, "").slice(-4)}`;
};

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

const lastIntent = (c: CustomerEntry): string | null => c.engagement.facts[0]?.label ?? null;

const Customers = () => {
  const navigate = useNavigate();
  const { book, loading, error, refetch } = useCustomerBook();
  // Stage and search live in the URL so opening a record and going back keeps them.
  const [searchParams, setSearchParams] = useSearchParams();
  const stage = searchParams.get("stage");
  const tab: CustomerBucket = TAB_ORDER.includes(stage as CustomerBucket) ? (stage as CustomerBucket) : "hot";
  const q = searchParams.get("q") ?? "";
  const setQ = (v: string) => {
    const n = new URLSearchParams(searchParams);
    if (v) n.set("q", v); else n.delete("q");
    setSearchParams(n, { replace: true });
  };
  const [busyLead, setBusyLead] = useState<string | null>(null);
  const [intent, setIntent] = useState("all");

  const needle = q.trim().toLowerCase();
  const intents = useMemo(
    () => Array.from(new Set(book.customers.map(lastIntent).filter((v): v is string => !!v))).sort(),
    [book.customers],
  );
  const searched = useMemo(
    () => book.customers.filter((c) => matches(c, needle) && (intent === "all" || lastIntent(c) === intent)),
    [book.customers, needle, intent],
  );
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
    <PageBody width="wide">
      <Seo title="Customers" description="Every shopper working a vehicle, ordered by what they actually did." path="/customers" />

      <PageHeader
        title="Customers"
      />

      {error && (
        <InlineNote tone="danger" title="Some customer data failed to load" action={<Button size="sm" onClick={refetch}>Retry</Button>}>
          {error}
        </InlineNote>
      )}

      <LocalTabs
        label="Customer stages"
        tabs={tabs.map((t): LocalTab => ({ key: t.key, label: t.label, to: `/customers?stage=${t.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`, count: loading && !book.customers.length ? null : t.count, active: t.key === tab }))}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
        <div className="min-w-0 flex-1">
          <MetricStrip boxed
            label="Customer totals"
            metrics={[
              { label: BUCKET_LABEL[tab], value: loading && !book.customers.length ? null : rows.length, tone: "danger" },
              { label: "Total active", value: loading && !book.customers.length ? null : searched.length },
              { label: "Identified", value: loading && !book.customers.length ? null : identified, tone: "info" },
              { label: "Anonymous", value: loading && !book.customers.length ? null : anonymous },
            ]}
          />
        </div>
        <div className="flex items-center gap-2">
          <FilterSelect
            label="Filter by intent type"
            value={intent}
            onChange={setIntent}
            className="min-w-[170px]"
            options={[{ value: "all", label: "All intent types" }, ...intents.map((i) => ({ value: i, label: i }))]}
          />
          <label className="relative block w-56">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-adm-muted" aria-hidden="true" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search customers..."
              aria-label="Search customers"
              className="h-10 w-full rounded-[6px] border border-adm-border bg-adm-surface pl-10 pr-3 text-[14px] text-adm-ink placeholder:text-adm-muted focus:outline-none focus:ring-2 focus:ring-adm-primary"
            />
          </label>
        </div>
      </div>

      {loading && !book.customers.length ? (
        <div role="status" aria-label="Loading" className="rounded-[6px] border border-adm-border bg-adm-surface px-5 py-12 text-center">
          <p className="text-[14px] text-adm-muted">Loading customers...</p>
        </div>
      ) : rows.length === 0 && error && !book.customers.length ? null : rows.length === 0 ? (
        <EmptyBlock title={`No customers in ${BUCKET_LABEL[tab]}`} body={needle || intent !== "all" ? "No customer matches that filter in this tab." : BUCKET_EMPTY_COPY[tab]} />
      ) : (
        <>
          <div className="hidden lg:block overflow-hidden rounded-[6px] border border-adm-border bg-adm-surface">
            <WorkTable caption="Customers" className="[&_th]:px-2 [&_td]:px-2 [&_td]:py-2.5">
              <thead>
                <tr>
                  <Th>Type</Th>
                  <Th>Customer</Th>
                  <Th>Contact</Th>
                  <Th>Vehicle</Th>
                  <Th>Owner</Th>
                  <Th>Last intent</Th>
                  <Th>Next action</Th>
                  <Th align="right">Updated</Th>
                  <Th><span className="sr-only">More</span></Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => navigate(`/customers/${encodeURIComponent(c.id)}`)}
                    className="cursor-pointer hover:bg-adm-workspace"
                  >
                    <Td className="whitespace-nowrap"><Chip tone={c.identified ? "good" : "neutral"}>{c.identified ? "Identified" : "Anonymous"}</Chip></Td>
                    <Td className="whitespace-nowrap">
                      <Link
                        to={`/customers/${encodeURIComponent(c.id)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="block text-[14px] font-semibold text-adm-primary hover:underline"
                      >
                        {c.identified ? c.name || c.email || "Unnamed customer" : "Online shopper"}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap text-adm-muted">{c.identified ? maskContact(c.email || c.phone) : "Not captured"}</Td>
                    <Td className="max-w-[215px]"><span className="block truncate" title={c.vehicles[0]?.label}>{c.vehicles[0]?.label ?? "None attached"}</span></Td>
                    <Td className="whitespace-nowrap">{c.assignedEmployee?.name ?? <span className="text-adm-muted">Unassigned</span>}</Td>
                    <Td className="whitespace-nowrap">{lastIntent(c) ?? <span className="text-adm-muted">None linked</span>}</Td>
                    <Td className="max-w-[130px]"><span className="block truncate text-[14px] font-semibold text-adm-primary" title={c.nextAction.headline}>{c.nextAction.headline}</span></Td>
                    <Td align="right" className="whitespace-nowrap text-adm-muted">{relativeTime(c.lastActivityAt)}</Td>
                    <Td align="right" className="w-10" >
                      <span onClick={(e) => e.stopPropagation()}>
                        <RowMenu customer={c} busyLead={busyLead} onMarkContacted={markContacted} />
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </WorkTable>
            <div className="flex items-center justify-between border-t border-adm-border px-4 py-3 text-[13px] leading-[18px] text-adm-muted">
              <span>{rows.length} {rows.length === 1 ? "customer" : "customers"} <button type="button" onClick={exportCsv} className="ml-3 font-semibold text-adm-primary hover:underline">Export CSV</button></span>
              <span>{book.passiveVisitors} view-only sessions are not listed</span>
            </div>
          </div>

          <div className="lg:hidden space-y-3">
            {rows.map((c) => (
              <article key={c.id} className="bg-adm-surface rounded-2xl border border-adm-border shadow-premium p-4 space-y-3">
                <CustomerIdentity customer={c} />
                {c.vehicles[0] && <VehicleCell label={c.vehicles[0].label} stock={c.vehicles[0].stock} vin={c.vehicles[0].vin} slug={c.vehicles[0].slug} />}
                <EngagementCell engagement={c.engagement} />
                <dl className="grid grid-cols-2 gap-2">
                  <div>
                    <dt className="text-[12px] leading-[18px] text-adm-muted">Return status</dt>
                    <dd className="text-[14px] leading-[20px] text-adm-ink">{c.returnStatus.label}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] leading-[18px] text-adm-muted">Assigned</dt>
                    <dd className="text-[14px] leading-[20px] text-adm-ink">{c.assignedEmployee?.name || "Unassigned"}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] leading-[18px] text-adm-muted">Last activity</dt>
                    <dd className="text-[14px] leading-[20px] text-adm-ink">{relativeTime(c.lastActivityAt)}</dd>
                  </div>
                </dl>
                <div className="border-t border-adm-border pt-3">
                  <NextActionCell action={c.nextAction} />
                  <RowActions customer={c} busyLead={busyLead} onMarkContacted={markContacted} />
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </PageBody>
  );
};

const CustomerIdentity = ({ customer }: { customer: CustomerEntry }) => (
  <div className="min-w-0">
    <div className="flex items-center gap-2 min-w-0">
      <UserRound className={`w-4 h-4 shrink-0 ${customer.identified ? "text-adm-ink" : "text-adm-muted"}`} />
      <Link
        to={`/customers/${encodeURIComponent(customer.id)}`}
        onClick={(e) => e.stopPropagation()}
        className="text-[14px] leading-[20px] font-semibold text-adm-ink truncate hover:underline underline-offset-2"
      >
        {customer.identified ? customer.name || customer.email || "Unnamed customer" : "Unidentified shopper"}
      </Link>
    </div>
    <p className="text-[12px] leading-[18px] text-adm-muted mt-0.5 truncate">
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

const RowMenu = ({
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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="More actions" className="rounded-[6px] p-1 text-adm-muted hover:bg-adm-workspace">
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {tel && <DropdownMenuItem asChild><a href={tel}>Call</a></DropdownMenuItem>}
        {customer.email && <DropdownMenuItem asChild><a href={`mailto:${customer.email}`}>Email</a></DropdownMenuItem>}
        {vehicle?.slug && <DropdownMenuItem asChild><Link to={`/v/${vehicle.slug}`}>Open passport</Link></DropdownMenuItem>}
        {vehicle?.listingId && <DropdownMenuItem asChild><Link to={`/vehicle-file/${vehicle.listingId}`}>Open vehicle file</Link></DropdownMenuItem>}
        {showMark && <DropdownMenuItem disabled={busyLead === lead?.id} onSelect={() => onMarkContacted(customer)}>Mark contacted</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

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
  const base = "inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-adm-border text-[12px] leading-[18px] font-semibold hover:bg-adm-workspace transition-colors";
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
