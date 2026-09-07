import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Mail, Phone } from "lucide-react";
import Seo from "@/components/Seo";
import AddendumStatusTimeline from "@/components/addendum/AddendumStatusTimeline";
import {
  BUCKET_LABEL,
  dwellLabel,
  money,
  relativeTime,
} from "@/components/customers/customerBook";
import { useCustomerBook } from "@/components/customers/useCustomerBook";
import {
  Chip,
  EmptyBlock,
  NextActionCell,
  PriceIntegrityChip,
  SectionCard,
  dealStateTone,
} from "@/components/customers/CustomerUi";
import { mmss } from "@/lib/shopperActivity";

// /customers/:id — one customer, assembled from every source that can honestly
// claim them. Engagement is shown only when a proven visitor link exists; a
// shopper we cannot name stays unnamed here too.

const CustomerRecord = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { book, loading } = useCustomerBook();
  const customerId = id ? decodeURIComponent(id) : "";
  const customer = useMemo(() => book.customers.find((c) => c.id === customerId) || null, [book.customers, customerId]);

  const sameVehicleShoppers = useMemo(() => {
    if (!customer) return 0;
    const vins = new Set(customer.vehicles.map((v) => v.vin).filter((v): v is string => !!v));
    if (!vins.size) return 0;
    return book.customers.filter((c) => c.id !== customer.id && !c.identified && c.vehicles.some((v) => v.vin && vins.has(v.vin))).length;
  }, [book.customers, customer]);

  if (loading && !customer) {
    return (
      <div className="max-w-5xl mx-auto p-4 lg:p-6">
        <p className="text-al-body text-muted-foreground">Loading customer...</p>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="max-w-5xl mx-auto p-4 lg:p-6 space-y-4">
        <BackLink />
        <EmptyBlock
          title="Customer not found"
          body="This record is not in the current customer window. It may be older than the activity window, or it may belong to another store."
        />
      </div>
    );
  }

  const bridged = customer.documentRequests.filter((r) => r.visitor_id).length > 0;

  return (
    <div className="max-w-5xl mx-auto p-4 lg:p-6 space-y-5">
      <Seo
        title={customer.identified ? `${customer.name || "Customer"} - Customer record` : "Unidentified shopper"}
        description="One customer, assembled from leads, document requests, tracked engagement and deals."
        path={`/customers/${customerId}`}
      />
      <BackLink />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-al-page font-display text-foreground">
            {customer.identified ? customer.name || customer.email || "Unnamed customer" : "Unidentified shopper"}
          </h1>
          <p className="text-al-body text-muted-foreground mt-1">
            {customer.identified ? "Contact captured" : "No contact captured"} · Last activity {relativeTime(customer.lastActivityAt)}
          </p>
        </div>
        <Chip tone={customer.bucket === "hot" ? "attention" : customer.bucket === "won" ? "good" : "neutral"}>
          {BUCKET_LABEL[customer.bucket]}
        </Chip>
      </header>

      <div className="bg-card rounded-2xl border border-border shadow-premium p-5">
        <p className="text-al-meta uppercase tracking-wider text-muted-foreground">Next action</p>
        <div className="mt-1.5">
          <NextActionCell action={customer.nextAction} />
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {customer.phone && (
            <a
              href={`tel:${customer.phone.replace(/[^\d+]/g, "")}`}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-al-body font-semibold hover:brightness-110 transition-all"
            >
              <Phone className="w-4 h-4" /> Call {customer.phone}
            </a>
          )}
          {customer.email && (
            <a
              href={`mailto:${customer.email}`}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border text-al-body font-semibold hover:bg-muted transition-colors"
            >
              <Mail className="w-4 h-4" /> Email
            </a>
          )}
        </div>
      </div>

      <SectionCard title="Contact" subtitle={bridged ? "Identity proven by a document request that carries the same visitor id as their browsing." : "Identity from a form only."}>
        <dl className="grid sm:grid-cols-2 gap-4">
          <Field label="Name" value={customer.identified ? customer.name || "Not given" : "Unidentified shopper - no contact captured"} />
          <Field label="Phone" value={customer.phone || "Not captured"} />
          <Field label="Email" value={customer.email || "Not captured"} />
          <Field label="Assigned employee" value={customer.assignedEmployee ? `${customer.assignedEmployee.name} (${customer.assignedEmployee.source})` : "Unassigned"} />
          <Field
            label="Lead source"
            value={
              customer.leads.length
                ? customer.leads.map((l) => `${l.source || "unknown"}${l.sub_source ? ` / ${l.sub_source}` : ""}`).join(", ")
                : "No lead form was ever submitted"
            }
          />
          <Field
            label="First response"
            value={
              customer.leads.length
                ? customer.leads[0].first_response_at
                  ? `Logged ${relativeTime(customer.leads[0].first_response_at)}`
                  : "Never logged"
                : "Not applicable"
            }
          />
        </dl>
        {!customer.identified && (
          <p className="text-al-body text-muted-foreground mt-4 border-t border-border pt-4">
            This shopper is a browser session, not a person on file. The clickstream carries a visitor id only - no name, phone or email
            was ever submitted - so nothing here may be attributed to a named customer. Work the vehicle instead.
          </p>
        )}
      </SectionCard>

      <SectionCard title="Vehicles of interest" subtitle={`${customer.vehicles.length} ${customer.vehicles.length === 1 ? "vehicle" : "vehicles"} touched`}>
        {customer.vehicles.length === 0 ? (
          <EmptyBlock title="No vehicle attached" body="No lead, document request, deal or tracked session names a vehicle for this customer." />
        ) : (
          <ul className="space-y-3">
            {customer.vehicles.map((v) => (
              <li key={v.vin || v.label} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border p-4">
                <div className="min-w-0">
                  <p className="text-al-card text-foreground">{v.label}</p>
                  <p className="text-al-meta text-muted-foreground mt-0.5">
                    {v.stock ? `Stock ${v.stock}` : "No stock number"}
                    {v.vin ? ` · VIN ${v.vin}` : ""}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {v.sources.map((s) => (
                      <Chip key={s}>{s}</Chip>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {v.slug && (
                    <a
                      href={`/v/${v.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center h-8 px-3 rounded-md border border-border text-al-meta font-semibold hover:bg-muted transition-colors"
                    >
                      Passport
                    </a>
                  )}
                  {v.listingId && (
                    <button
                      type="button"
                      onClick={() => navigate(`/vehicle-file/${v.listingId}`)}
                      className="inline-flex items-center h-8 px-3 rounded-md border border-border text-al-meta font-semibold hover:bg-muted transition-colors"
                    >
                      Vehicle file
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Engagement"
        subtitle={customer.engagement.linked ? "Every line below is a captured event, with the move it implies." : "Nothing links this customer to a browsing session."}
      >
        {!customer.engagement.linked ? (
          <div className="space-y-4">
            <EmptyBlock
              title="No engagement linked to this customer"
              body="Passport activity is keyed on an anonymous visitor id. A lead form does not capture that id, so this person's browsing cannot be proven. A document request from the passport does capture it - that is the only bridge that exists today."
            />
            {sameVehicleShoppers > 0 && (
              <p className="text-al-body text-muted-foreground">
                {sameVehicleShoppers} anonymous {sameVehicleShoppers === 1 ? "shopper is" : "shoppers are"} active on the same vehicle. They
                are not this person - treat it as competition for the car, and move on price and availability.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Field label="Visits" value={String(customer.engagement.sessions)} />
              <Field label="Days active" value={String(customer.engagement.visitDays)} />
              <Field label="Reading time" value={dwellLabel(customer.engagement.dwellSeconds)} />
              <Field label="First seen" value={relativeTime(customer.engagement.firstAt)} />
            </dl>

            <div>
              <h3 className="text-al-card text-foreground">What they did, and what to do about it</h3>
              <ul className="mt-2 divide-y divide-border">
                {customer.engagement.facts.map((f) => (
                  <li key={f.key} className="py-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-al-body font-semibold text-foreground">
                        {f.label}
                        {f.count > 1 ? ` x${f.count}` : ""}
                      </p>
                      <p className="text-al-meta text-muted-foreground mt-0.5">{f.action}</p>
                    </div>
                    <span className="text-al-meta text-muted-foreground whitespace-nowrap">{relativeTime(f.lastAt)}</span>
                  </li>
                ))}
              </ul>
            </div>

            {customer.engagement.modules.length > 0 && (
              <div>
                <h3 className="text-al-card text-foreground">Where the attention went</h3>
                <ul className="mt-2 space-y-1.5">
                  {customer.engagement.modules.map((m) => (
                    <li key={m.module} className="flex items-center justify-between gap-3 text-al-body">
                      <span className="text-foreground">{m.label}</span>
                      <span className="text-muted-foreground tabular-nums">{mmss(m.seconds)}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-al-meta text-muted-foreground mt-2">
                  Lead with the section they spent the most time in - it is the objection they are still working through.
                </p>
              </div>
            )}
          </div>
        )}
        <p className="text-al-meta text-muted-foreground mt-5 border-t border-border pt-4">
          Not captured by this platform: walkaround video request, send, open, completion and replay. No code emits those events, so they
          are not shown as zeros here.
        </p>
      </SectionCard>

      <SectionCard title="Deals" subtitle={`${customer.deals.length} ${customer.deals.length === 1 ? "deal" : "deals"} on file`}>
        {customer.deals.length === 0 ? (
          <EmptyBlock title="No deal yet" body="No addendum on this store carries this customer's name or email." />
        ) : (
          <ul className="space-y-4">
            {customer.deals.map((deal) => (
              <li key={deal.id} className="rounded-xl border border-border p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-al-card text-foreground">{deal.vehicleLabel}</p>
                    <p className="text-al-meta text-muted-foreground mt-0.5">
                      {deal.stock ? `Stock ${deal.stock} · ` : ""}
                      {money(deal.amount)}
                      {deal.employeeName ? ` · Sold by ${deal.employeeName}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={dealStateTone(deal.state)}>{deal.stateLabel}</Chip>
                    <PriceIntegrityChip integrity={deal.priceIntegrity} />
                  </div>
                </div>
                {deal.returnInfo && (
                  <p className="text-al-body text-foreground">
                    {deal.returnInfo.label}
                    {deal.returnInfo.reason ? ` - "${deal.returnInfo.reason}"` : ""}
                  </p>
                )}
                <NextActionCell action={deal.nextAction} />
                {deal.state === "out_for_signature" && <AddendumStatusTimeline addendumId={deal.id} />}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Activity" subtitle="Leads, document requests, tracked engagement, signatures and returns in one trail.">
        {customer.activity.length === 0 ? (
          <EmptyBlock title="No activity recorded" body="Nothing has been captured for this customer yet." />
        ) : (
          <ol className="divide-y divide-border">
            {customer.activity.map((a, i) => (
              <li key={`${a.at}-${i}`} className="py-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-al-body font-semibold text-foreground">{a.label}</p>
                  <p className="text-al-meta text-muted-foreground mt-0.5">{a.detail}</p>
                </div>
                <span className="text-al-meta text-muted-foreground whitespace-nowrap">{relativeTime(a.at)}</span>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>
    </div>
  );
};

const BackLink = () => (
  <Link to="/leads" className="inline-flex items-center gap-1.5 text-al-body font-semibold text-muted-foreground hover:text-foreground transition-colors">
    <ArrowLeft className="w-4 h-4" /> Customers
  </Link>
);

const Field = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <dt className="text-al-meta uppercase tracking-wider text-muted-foreground">{label}</dt>
    <dd className="text-al-body text-foreground mt-0.5 break-words">{value}</dd>
  </div>
);

export default CustomerRecord;
