import { useMemo, useState } from "react";
import { ExternalLink, Mail, MessageSquare, Phone } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import Seo from "@/components/Seo";
import { Button, LinkButton, PageBody, PageHeader, Panel, QueryState } from "@/components/product";
import { Crumbs, SummaryList } from "@/components/detail/parts";
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
  dealStateTone,
} from "@/components/customers/CustomerUi";
import { mmss } from "@/lib/shopperActivity";
import { AddTaskDialog, LogContactDialog, useCustomerFollowUp } from "@/components/customers/CustomerFollowUp";
import { fmtDay } from "@/components/detail/parts";

// /customers/:id — one customer, assembled from every source that can honestly
// claim them. Engagement is shown only when a proven visitor link exists; a
// shopper we cannot name stays unnamed here too.

const timelineStamp = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
};

const CustomerRecord = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { book, loading } = useCustomerBook();
  const customerId = id ? decodeURIComponent(id) : "";
  const customer = useMemo(() => book.customers.find((c) => c.id === customerId) || null, [book.customers, customerId]);

  const followUp = useCustomerFollowUp(customer);
  const [taskOpen, setTaskOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [showAllTimeline, setShowAllTimeline] = useState(false);

  const sameVehicleShoppers = useMemo(() => {
    if (!customer) return 0;
    const vins = new Set(customer.vehicles.map((v) => v.vin).filter((v): v is string => !!v));
    if (!vins.size) return 0;
    return book.customers.filter((c) => c.id !== customer.id && !c.identified && c.vehicles.some((v) => v.vin && vins.has(v.vin))).length;
  }, [book.customers, customer]);

  if (loading && !customer) {
    return (
      <PageBody width="form">
        <QueryState status="loading" />
      </PageBody>
    );
  }

  if (!customer) {
    return (
      <PageBody width="form">
        <Crumbs items={[{ label: "Customers", to: "/customers" }, { label: "Not found" }]} />
        <EmptyBlock
          title="Customer not found"
          body="This record is not in the current customer window. It may be older than the activity window, or it may belong to another store."
        />
      </PageBody>
    );
  }

  const bridged = customer.documentRequests.filter((r) => r.visitor_id).length > 0;
  const title = customer.identified ? customer.name || customer.email || "Unnamed customer" : "Unidentified shopper";
  const primaryVehicle = customer.vehicles[0] ?? null;
  const timeline = [...customer.activity, ...followUp.contacts].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const callHref = customer.phone ? `tel:${customer.phone.replace(/[^\d+]/g, "")}` : null;
  const leadSource = customer.leads.length
    ? customer.leads.map((l) => `${l.source || "unknown"}${l.sub_source ? ` / ${l.sub_source}` : ""}`).join(", ")
    : "No lead form submitted";

  return (
    <PageBody width="wide">
      <Seo
        title={customer.identified ? `${customer.name || "Customer"} - Customer record` : "Unidentified shopper"}
        description="One customer, assembled from leads, document requests, tracked engagement and deals."
        path={`/customers/${customerId}`}
      />
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            {title}
            <Chip size="lg" tone={customer.identified ? "good" : "neutral"}>{customer.identified ? "Identified" : "Unidentified"}</Chip>
            <Chip size="lg" tone={customer.bucket === "hot" ? "attention" : customer.bucket === "won" ? "good" : "neutral"}>
              {BUCKET_LABEL[customer.bucket]}
            </Chip>
          </span>
        }
        description={`${customer.identified ? "Contact captured" : "No contact captured"} · Last activity ${relativeTime(customer.lastActivityAt)}`}
        actions={
          <>
            <Button onClick={() => setTaskOpen(true)}>Add task</Button>
            <Button variant="primary" onClick={() => setContactOpen(true)}>Log contact</Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)_320px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel className="[&>div]:flex [&>div]:flex-col [&>div]:gap-5">
            <section aria-label="Contact information">
            <h3 className="mb-2 text-[16px] leading-[22px] font-semibold text-adm-ink">Contact information</h3>
            <SummaryList
              rows={[
                { label: "Name", value: customer.identified ? customer.name || "Not given" : "Unidentified" },
                { label: "Phone", value: customer.phone || "Not captured" },
                { label: "Email", value: <span className="break-all">{customer.email || "Not captured"}</span> },
                { label: "Lead source", value: leadSource },
                {
                  label: "First response",
                  value: customer.leads.length
                    ? customer.leads[0].first_response_at ? `Logged ${relativeTime(customer.leads[0].first_response_at)}` : "Never logged"
                    : "Not applicable",
                },
              ]}
            />
            {!customer.identified && (
              <p className="mt-3 border-t border-adm-border pt-3 text-[13px] leading-[18px] text-adm-muted">
                This shopper is a browser session, not a person on file. Nothing here may be attributed to a named customer.
              </p>
            )}
            </section>
            <section aria-label="Communication consent" className="border-t border-adm-border pt-4">
              <h3 className="mb-2 text-[16px] leading-[22px] font-semibold text-adm-ink">Communication consent</h3>
              <SummaryList dense rows={[{ label: "Email", value: "Unknown" }, { label: "SMS", value: "Unknown" }, { label: "Phone", value: "Unknown" }]} />
            </section>
            <section aria-label="Assigned to" className="border-t border-adm-border pt-4">
              <h3 className="mb-1 text-[16px] leading-[22px] font-semibold text-adm-ink">Assigned to</h3>
              <p className="text-[14px] leading-[20px] text-adm-ink">
                {customer.assignedEmployee ? customer.assignedEmployee.name : "Unassigned"}
              </p>
              {customer.assignedEmployee && <p className="text-[13px] leading-[18px] text-adm-muted">{customer.assignedEmployee.source}</p>}
            </section>
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Current vehicle journey" description={`${customer.vehicles.length} ${customer.vehicles.length === 1 ? "vehicle" : "vehicles"} touched`}>
            {customer.vehicles.length === 0 ? (
              <p className="text-[14px] leading-[20px] text-adm-muted">No lead, document request, deal or tracked session names a vehicle for this customer.</p>
            ) : (
              <ul className="divide-y divide-adm-border">
                {customer.vehicles.map((v) => (
                  <li key={v.vin || v.label} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    {v.photo && <img src={v.photo} alt="" className="h-[56px] w-[84px] shrink-0 rounded-[6px] border border-adm-border object-cover" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] leading-[20px] font-semibold text-adm-ink">{v.label}</p>
                      <p className="truncate text-[13px] leading-[18px] text-adm-muted">
                        {v.stock ? `Stock ${v.stock}` : "No stock number"}{v.vin ? ` · VIN ${v.vin}` : ""} · {v.sources.join(", ")}
                      </p>
                    <span className="mt-1 flex items-center gap-4 text-[14px] font-semibold">
                      {v.slug && <a href={`/v/${v.slug}`} target="_blank" rel="noopener noreferrer" className="text-adm-primary hover:underline">Passport</a>}
                      {v.listingId && <button type="button" onClick={() => navigate(`/vehicle-file/${v.listingId}`)} className="text-adm-primary hover:underline">Vehicle file</button>}
                    </span>
                    </div>

                  </li>
                ))}
              </ul>
            )}
          <div className="mt-5 border-t border-adm-border pt-4">
          <h3 className="mb-3 text-[16px] leading-[22px] font-semibold text-adm-ink">Intent timeline</h3>
            {timeline.length === 0 ? (
              <p className="text-[14px] leading-[20px] text-adm-muted">Nothing has been captured for this customer yet.</p>
            ) : (
              <>
              <ol className="relative ml-[124px] border-l border-adm-border">
                {(showAllTimeline ? timeline : timeline.slice(0, 6)).map((a, i) => (
                  <li key={`${a.at}-${i}`} className="relative pb-4 pl-5 last:pb-0">
                    <span className="absolute -left-[5px] top-[7px] h-[9px] w-[9px] rounded-full bg-adm-primary" aria-hidden="true" />
                    <span className="absolute -left-[124px] top-[2px] w-[112px] whitespace-nowrap text-right text-[12px] leading-[18px] text-adm-muted" title={relativeTime(a.at)}>{timelineStamp(a.at)}</span>
                    <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{a.label}</p>
                    <p className="text-[13px] leading-[18px] text-adm-muted">{a.detail}</p>
                  </li>
                ))}
              </ol>
              {timeline.length > 6 && (
                <button type="button" onClick={() => setShowAllTimeline((v) => !v)} className="mt-3 text-[14px] font-semibold text-adm-primary hover:underline">
                  {showAllTimeline ? "Show fewer" : `Show all ${timeline.length}`}
                </button>
              )}
              </>
            )}
          </div>
          </Panel>

          <Panel
            title="Engagement"
            description={customer.engagement.linked ? "Every line is a captured event, with the move it implies." : "Nothing links this customer to a browsing session."}
          >
            {!customer.engagement.linked ? (
              <div className="space-y-2 text-[14px] leading-[20px] text-adm-muted">
                <p>Passport activity is keyed on an anonymous visitor id. A lead form does not capture it, so this person's browsing cannot be proven. A document request from the passport is the only bridge that exists today.</p>
                {sameVehicleShoppers > 0 && (
                  <p>{sameVehicleShoppers} anonymous {sameVehicleShoppers === 1 ? "shopper is" : "shoppers are"} active on the same vehicle. They are not this person.</p>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <SummaryList
                  rows={[
                    { label: "Visits", value: String(customer.engagement.sessions) },
                    { label: "Days active", value: String(customer.engagement.visitDays) },
                    { label: "Reading time", value: dwellLabel(customer.engagement.dwellSeconds) },
                    { label: "First seen", value: relativeTime(customer.engagement.firstAt) },
                  ]}
                />
                <ul className="divide-y divide-adm-border">
                  {customer.engagement.facts.map((f) => (
                    <li key={f.key} className="flex flex-wrap items-start justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{f.label}{f.count > 1 ? ` x${f.count}` : ""}</p>
                        <p className="text-[13px] leading-[18px] text-adm-muted">{f.action}</p>
                      </div>
                      <span className="whitespace-nowrap text-[13px] text-adm-muted">{relativeTime(f.lastAt)}</span>
                    </li>
                  ))}
                </ul>
                {customer.engagement.modules.length > 0 && (
                  <SummaryList rows={customer.engagement.modules.map((m) => ({ label: m.label, value: mmss(m.seconds) }))} />
                )}
              </div>
            )}
          </Panel>

          <Panel title={`Deals (${customer.deals.length})`}>
            {customer.deals.length === 0 ? (
              <p className="text-[14px] leading-[20px] text-adm-muted">No addendum on this store carries this customer's name or email.</p>
            ) : (
              <ul className="divide-y divide-adm-border">
                {customer.deals.map((deal) => (
                  <li key={deal.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-[14px] leading-[20px] font-semibold text-adm-ink">{deal.vehicleLabel}</p>
                      <span className="shrink-0 whitespace-nowrap"><Chip tone={dealStateTone(deal.state)}>{deal.stateLabel}</Chip></span>
                    </div>
                    <p className="text-[13px] leading-[18px] text-adm-muted">
                      {money(deal.amount)}{deal.employeeName ? ` · Sold by ${deal.employeeName}` : ""}
                    </p>
                    {deal.returnInfo && <p className="text-[13px] leading-[18px] text-adm-ink">{deal.returnInfo.label}</p>}
                    {deal.state === "out_for_signature" && (
                      <details>
                        <summary className="cursor-pointer text-[13px] font-semibold text-adm-primary">Signing status</summary>
                        <div className="mt-2"><AddendumStatusTimeline addendumId={deal.id} /></div>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Panel title={`Tasks (${followUp.tasks.filter((t) => t.status !== "completed").length + (customer.nextAction ? 1 : 0)})`}>
            {!customer.nextAction && followUp.tasks.length === 0 ? (
              <p className="text-[14px] leading-[20px] text-adm-muted">No open task.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {customer.nextAction && <li><NextActionCell action={customer.nextAction} /></li>}
                {followUp.tasks.map((t) => {
                  const done = t.status === "completed";
                  const overdue = !done && !!t.due_at && new Date(t.due_at).getTime() < Date.now();
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-3 text-[14px] leading-[20px]">
                      <label className="flex min-w-0 items-center gap-2">
                        <input type="checkbox" checked={done} onChange={() => void followUp.toggleTask(t)} className="h-4 w-4 shrink-0 accent-[#2457D6]" />
                        <span className={`truncate ${done ? "text-adm-muted line-through" : "text-adm-ink"}`}>{t.title}</span>
                      </label>
                      <span className={`shrink-0 text-[13px] ${overdue ? "font-semibold text-adm-danger" : "text-adm-muted"}`}>{t.due_at ? fmtDay(t.due_at) : ""}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          <Panel title="Contact actions">
            <div className="grid grid-cols-2 gap-2">
              {callHref ? <LinkButton variant="secondary" className="w-full whitespace-nowrap px-2" to={callHref}><Phone className="h-5 w-5 text-adm-primary" aria-hidden="true" /> Call</LinkButton> : null}
              {customer.phone ? <LinkButton variant="secondary" className="w-full whitespace-nowrap px-2" to={`sms:${customer.phone.replace(/[^\d+]/g, "")}`}><MessageSquare className="h-5 w-5 text-adm-primary" aria-hidden="true" /> Send SMS</LinkButton> : null}
              {customer.email ? <LinkButton variant="secondary" className="w-full whitespace-nowrap px-2" to={`mailto:${customer.email}`}><Mail className="h-5 w-5 text-adm-primary" aria-hidden="true" /> Send email</LinkButton> : null}
              <Button className="w-full whitespace-nowrap px-2" onClick={() => setContactOpen(true)}>Log contact</Button>
              {primaryVehicle?.slug ? <LinkButton variant="secondary" className="col-span-2 w-full whitespace-nowrap px-2" to={`/v/${primaryVehicle.slug}`}><ExternalLink className="h-5 w-5 shrink-0 text-adm-primary" aria-hidden="true" /> Open Passport</LinkButton> : null}
              {!callHref && !customer.email && !primaryVehicle?.slug ? (
                <p className="text-[14px] leading-[20px] text-adm-muted">No contact method captured.</p>
              ) : null}
            </div>
          </Panel>
        </div>
      </div>
      <AddTaskDialog open={taskOpen} onOpenChange={setTaskOpen} onSave={followUp.addTask} />
      <LogContactDialog open={contactOpen} onOpenChange={setContactOpen} onSave={followUp.logContact} />
    </PageBody>
  );
};

export default CustomerRecord;
