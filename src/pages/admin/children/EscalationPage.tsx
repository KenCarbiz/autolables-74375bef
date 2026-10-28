import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bell, Check, ChevronDown, Info, Mail, MessageCircleMore, Monitor, PlayCircle, Send, Truck, type LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import { ChildPageFrame } from "@/components/admin/v2/AdminShell";
import { AdminButton, AdminCard, AdminTable, EmptyState, ICON, InlineNote, KeyValueList, SkeletonBlock, StatusChip, Td, Th } from "@/components/admin/v2/primitives";
import { adminTabHref } from "@/lib/admin/sections";
import { useAdminNow, useViewFixture } from "@/lib/admin/dataSource";
import {
  AUDIT_ACTION_ESCALATED,
  AUDIT_ACTION_ESCALATION_FAILED,
  DELIVERY_RESULT_META,
  buildTierPlan,
  deliveryActivityFromAudit,
  escalationComplete,
  namedAgents,
  notificationMethodRows,
  isEmail,
  withEmailMethod,
  type AuditRowLike,
  type DeliveryActivityRow,
  type DeliveryResult,
  type NotificationMethodRow,
  type TierPlan,
} from "@/lib/admin/routingDraft";
import { resolveCustomerPassportRouting, type PassportRoutingResult } from "@/lib/passportRouting";
import { useRoutingDraft } from "@/pages/admin/views/customer/useRoutingDraft";
import { RoutingReviewDialog } from "@/pages/admin/views/customer/RoutingReviewDialog";
import { Field, ToggleRow, inputCls, selectCls } from "@/pages/admin/views/customer/controls";

// Escalation rules (reference 09). Tiers edit the same routing draft as
// Contact & Routing; delivery activity is read from audit_log and reported
// in the sender's own vocabulary: attempted, accepted, failed. Delivery is
// never claimed because the current sender does not report it.

export interface EscalationFixture {
  /** Null means the read failed; the page then shows Unavailable, never zero. */
  activity: AuditRowLike[] | null;
}

type TabId = "rules" | "activity" | "test";
const TABS: Array<{ id: TabId; label: string }> = [
  { id: "rules", label: "Rules" },
  { id: "activity", label: "Delivery activity" },
  { id: "test", label: "Test route" },
];

const MINUTE_OPTIONS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120];
const METHOD_ICON: Record<NotificationMethodRow["key"], LucideIcon> = { email: Mail, sms: MessageCircleMore, in_app: Monitor, push: Bell };
const METHOD_SHORT: Record<NotificationMethodRow["key"], string> = { email: "Email", sms: "SMS", in_app: "In-app", push: "Push" };

// The reference draws each state in a tinted 36px circle: a 20px glyph for
// the states the sender reports as requests, a solid 22px mark for the two
// outcomes.
// The reference's state rows are 57, 59, 59 and 56px tall.
const STATE_ROW_PAD = ["pt-[8px] pb-[11px]", "pt-[10px] pb-[11px]", "pt-[10px] pb-[11px]", "pt-[8px] pb-[10px]"];

const DELIVERY_STATES: Array<{ title: string; detail: string; mark: ReactNode }> = [
  { title: "Attempted", detail: "The request to send was made to the sender.", mark: <span className="w-9 h-9 rounded-full bg-adm-selected text-adm-primary flex items-center justify-center"><Send className="w-5 h-5" /></span> },
  { title: "Accepted", detail: "The sender accepted the notification for delivery.", mark: <span className="w-9 h-9 rounded-full bg-adm-success-bg flex items-center justify-center"><span className="w-[22px] h-[22px] rounded-full bg-adm-success text-white flex items-center justify-center"><Check className="w-3.5 h-3.5 stroke-[3]" /></span></span> },
  { title: "Delivered", detail: "The recipient received it. The current sender does not report this, so it is never claimed.", mark: <span className="w-9 h-9 rounded-full bg-adm-selected text-adm-primary flex items-center justify-center"><Truck className="w-6 h-6" /></span> },
  { title: "Failed", detail: "The sender refused or could not be reached. The lead stays where it was.", mark: <span className="w-9 h-9 rounded-full bg-adm-danger-bg flex items-center justify-center"><span className="w-[22px] h-[22px] rounded-full bg-adm-danger text-white flex items-center justify-center text-[14px] leading-none font-bold">!</span></span> },
];

const humanize = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const formatWhen = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const formatDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const formatTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

async function loadActivity(tenantId: string, limit: number): Promise<AuditRowLike[]> {
  const db = supabase as unknown as { from: (t: string) => any };
  const { data, error } = await db
    .from("audit_log")
    .select("id, action, entity_id, created_at, details")
    .eq("store_id", tenantId)
    .in("action", [AUDIT_ACTION_ESCALATED, AUDIT_ACTION_ESCALATION_FAILED])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AuditRowLike[];
}

// The reference draws its own chevron on every select (14px from the right on
// the time, 10px on the destination), so the native arrow is replaced.
const SelectChevron = ({ right }: { right: string }) => (
  <ChevronDown className={cn(ICON.chevron, "pointer-events-none absolute top-1/2 -translate-y-1/2 text-adm-ink", right)} aria-hidden="true" />
);

const MinutesSelect = ({ id, label, value, onChange, allowOff = false, disabled }: { id: string; label: string; value: number; onChange: (v: number) => void; allowOff?: boolean; disabled: boolean }) => {
  const options = Array.from(new Set([...(allowOff ? [0] : []), ...MINUTE_OPTIONS, value])).filter((m) => m >= 0).sort((a, b) => a - b);
  return (
    <div className="relative">
      <select id={id} aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className={cn(selectCls, "mt-0 h-[34px] w-full appearance-none pl-4 pr-10")}>
        {options.map((m) => <option key={m} value={m}>{m === 0 ? (allowOff ? "Off" : "0 minutes") : `${m} minutes`}</option>)}
      </select>
      <SelectChevron right="right-[14px]" />
    </div>
  );
};

const Step = ({ n, title, hint, last = false, className, children }: { n: number; title: string; hint: string; last?: boolean; className?: string; children: ReactNode }) => (
  <li data-landmark="escalation-tier" className={cn("relative pl-[57px]", last ? "pb-[9px]" : "pb-[15px]", className)}>
    {!last && <span aria-hidden="true" className="absolute left-4 top-[38px] bottom-0 w-px bg-adm-border" />}
    <span className="absolute left-0 top-0 w-[34px] h-[34px] rounded-full bg-adm-selected text-adm-primary text-[14px] font-semibold flex items-center justify-center">{n}</span>
    <p className="text-[14px] leading-[20px] font-semibold text-adm-ink pt-0.5">{title}</p>
    <p className="text-[12px] leading-[18px] text-adm-muted">{hint}</p>
    {children}
  </li>
);

/** One tier's controls: the time, then Send to and the destination, with its state on the line below. */
const TierControls = ({ minutes, destination, note, extra, className }: { minutes: ReactNode; destination: ReactNode; note: ReactNode; extra?: ReactNode; className?: string }) => (
  <div className={cn("mt-1.5 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,264px)_minmax(61px,1fr)_minmax(0,230px)] gap-x-3 2xl:gap-x-0 gap-y-2 items-center", className)}>
    {minutes}
    <span className="sm:self-start sm:mt-1 2xl:pl-5 text-[12px] leading-[18px] text-adm-muted whitespace-nowrap">Send to</span>
    {destination}
    <div className="sm:col-start-3 -mt-1">{note}</div>
    {extra && <div className="sm:col-start-3">{extra}</div>}
  </div>
);

const DestinationSelect = ({ label, tier, missing }: { label: string; tier: string; missing: boolean }) => (
  <div className="relative">
    <select aria-label={`${tier}: send to`} data-landmark="tier-destination" defaultValue={label} className={cn(selectCls, "mt-0 h-[34px] w-full appearance-none pl-3 pr-9 font-semibold", missing ? "border-[#F04438]" : "border-adm-border")}>
      <option value={label}>{label}</option>
    </select>
    <SelectChevron right="right-[10px]" />
  </div>
);

// The reference's mark is a filled 12x12 triangle on a 16px line, so the
// state line keeps the tier pitch at the mock's 115 to 119px.
const DestinationState = ({ label, email, editing, onEdit }: { label: string; email: string; editing: boolean; onEdit: () => void }) => {
  const missing = email.trim().length === 0;
  if (missing) {
    return (
      <p role="alert" className="min-h-4 flex flex-wrap items-center gap-x-1.5 text-[12px] leading-[16px] text-adm-danger">
        <AlertTriangle className="w-4 h-4 fill-current stroke-white flex-shrink-0" aria-hidden="true" />
        <span>Destination required</span>
        {!editing && <button type="button" aria-label={`Add ${label} email`} onClick={onEdit} className="ml-1 font-semibold text-adm-primary hover:underline">Add email</button>}
      </p>
    );
  }
  if (!isEmail(email)) {
    return (
      <p role="alert" className="min-h-4 flex flex-wrap items-center gap-x-1.5 text-[12px] leading-[16px] text-adm-danger min-w-0">
        <AlertTriangle className="w-4 h-4 fill-current stroke-white flex-shrink-0" aria-hidden="true" />
        <span className="min-w-0 [overflow-wrap:anywhere]">Not a valid email address: {email}</span>
        {!editing && <button type="button" aria-label={`Change ${label} email`} onClick={onEdit} className="ml-1 font-semibold text-adm-primary hover:underline">Change</button>}
      </p>
    );
  }
  return (
    <p className="min-h-4 flex flex-wrap items-center gap-x-2 text-[12px] leading-[16px] text-adm-muted min-w-0">
      <span className="min-w-0 [overflow-wrap:anywhere]" data-parity="destination-email">{email}</span>
      {!editing && <button type="button" aria-label={`Change ${label} email`} onClick={onEdit} className="font-semibold text-adm-primary hover:underline">Change</button>}
    </p>
  );
};

const ResultMark = ({ result }: { result: DeliveryResult }) => {
  if (result === "failed") return <span className="w-[22px] h-[22px] rounded-full bg-adm-danger text-white flex items-center justify-center flex-shrink-0 text-[14px] leading-none font-bold" aria-hidden="true">!</span>;
  if (result === "accepted") return <span className="w-[22px] h-[22px] rounded-full bg-adm-success text-white flex items-center justify-center flex-shrink-0" aria-hidden="true"><Check className="w-3.5 h-3.5 stroke-[3]" /></span>;
  return <span className="w-[22px] h-[22px] rounded-full bg-adm-workspace text-adm-muted flex items-center justify-center flex-shrink-0" aria-hidden="true"><Send className="w-3 h-3" /></span>;
};

// The reference's columns are 110/99/87/76/136/103 of 611 with 11px text in
// ink-coloured headers and cells.
const ACTIVITY_COLUMNS = ["18%", "16.2%", "14.2%", "12.4%", "22.3%", "16.9%"];
const ACTIVITY_TABLE_CLS =
  "mb-0 [&_table]:text-[11px] [&_table]:leading-[16px] [&_th]:text-[11px] [&_th]:leading-[16px] [&_th]:text-adm-ink [&_th]:py-[6px] [&_th]:px-3 [&_td]:py-1 [&_td]:px-3 [&_th+th]:border-l [&_td+td]:border-l [&_th+th]:border-adm-border [&_td+td]:border-adm-border [&_tbody_tr:last-child>td]:border-b-0";

const ActivityBody = ({ state, rows }: { state: "loading" | "failed" | "ready"; rows: DeliveryActivityRow[] }) => {
  if (state === "loading") {
    return <div className="px-4 pb-2 space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-9 w-full" />)}</div>;
  }
  if (state === "failed") {
    return <p role="status" className="px-4 pb-2 text-[13px] text-adm-muted">Delivery activity could not be read for this rooftop. It shows as Unavailable rather than zero.</p>;
  }
  if (rows.length === 0) {
    return <div className="px-4"><EmptyState compact title="No escalation notifications recorded." detail="Rows appear here after the escalation sweep attempts a notification." /></div>;
  }
  return (
    <AdminTable inset caption="Escalation delivery activity" minWidth={640} className={ACTIVITY_TABLE_CLS}>
      <colgroup>{ACTIVITY_COLUMNS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
      <thead>
        <tr>
          <Th>Request</Th>
          <Th>Rooftop</Th>
          <Th>Channel</Th>
          <Th>Attempt</Th>
          <Th>Result</Th>
          <Th>Date &amp; time</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const meta = DELIVERY_RESULT_META[r.result];
          return (
            <tr key={r.id}>
              <Td className="font-semibold">{r.requestLabel}</Td>
              <Td>{r.rooftop}</Td>
              <Td>{r.channel}</Td>
              <Td>{r.attempt ?? "Unknown"}</Td>
              <Td className="!pr-1"><span className="inline-flex items-center gap-[6px]"><ResultMark result={r.result} />{meta.label}</span></Td>
              <Td className="text-adm-muted whitespace-nowrap">
                <time dateTime={r.at} className="block">{formatDay(r.at)}</time>
                <span className="block">{formatTime(r.at)}</span>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </AdminTable>
  );
};

const cardTitle = (text: string, leading = "leading-[26px]") => <span className={cn("text-[18px]", leading)}>{text}</span>;

// Notes drawn to the reference: the retry note on its peach tint with a 28px
// mark beside the title line, the delivery note with a 20px mark.
const RetryNote = () => (
  <div role="status" className="flex items-start gap-[14px] rounded-[8px] border border-[#FDE1BB] bg-adm-warning-bg pl-[11px] pr-4 pt-[12px] pb-[11px]">
    <AlertTriangle className="w-7 h-7 -mt-[2px] text-[#8B2D00] flex-shrink-0" aria-hidden="true" />
    <p className="min-w-0">
      <span className="block text-[15px] leading-[20px] font-semibold text-adm-ink">A failed notification stays eligible for retry.</span>
      <span className="block mt-0.5 text-[12px] leading-[18px] text-adm-muted">If a notification fails, the lead keeps its level and the next sweep tries again.</span>
    </p>
  </div>
);

const DeliveryNote = () => (
  <div role="status" className="flex items-start gap-[11px] rounded-[8px] border border-adm-selected bg-adm-selected pl-3 pr-4 pt-[6px] pb-[3px]">
    <Info className="w-5 h-5 mt-px text-adm-primary flex-shrink-0" aria-hidden="true" />
    <p className="min-w-0">
      <span className="block text-[12px] leading-[16px] font-semibold text-adm-primary">Accepted does not mean delivered.</span>
      <span className="block mt-0.5 text-[11px] leading-[16px] text-adm-muted">A notification can be accepted by the sender and still not reach the recipient.</span>
    </p>
  </div>
);

export default function EscalationPage() {
  const api = useRoutingDraft();
  const now = useAdminNow();
  const { tenant } = useTenant();
  const fixture = useViewFixture<EscalationFixture>("escalation");
  const [tab, setTab] = useState<TabId>("rules");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ bdc: boolean; manager: boolean }>({ bdc: false, manager: false });
  const [dry, setDry] = useState<{ result: PassportRoutingResult; plan: TierPlan; at: number } | null>(null);

  const { draft, dirty, canEdit, loading, state, stores, storeCount } = api;
  const cfg = draft.routing;
  const rules = cfg.escalationRules;
  const plan = useMemo(() => buildTierPlan(cfg), [cfg]);
  const complete = escalationComplete(draft);
  const methods = notificationMethodRows(rules);
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const limit = tab === "activity" ? 100 : 25;

  const live = useQuery({
    queryKey: ["admin-v2", "escalation-activity", tenantId, limit],
    enabled: !fixture && !api.fixture && !!tenantId,
    queryFn: () => loadActivity(tenantId as string, limit),
    staleTime: 30_000,
  });
  const activityState: "loading" | "failed" | "ready" = fixture
    ? (fixture.activity ? "ready" : "failed")
    : api.fixture ? "ready"
    : live.isError ? "failed"
    : live.isLoading || !tenantId ? "loading"
    : "ready";
  const activity = useMemo(() => {
    const nameOf = (id: string | null) => (id ? stores.find((s) => s.id === id)?.name : undefined) ?? "This rooftop";
    return deliveryActivityFromAudit(fixture?.activity ?? live.data ?? [], nameOf);
  }, [fixture, live.data, stores]);

  const bdcTier = plan.tiers.find((t) => t.key === "bdc") ?? null;
  const mgrTier = plan.tiers.find((t) => t.key === "manager") ?? null;
  const bdcMissing = plan.enabled && !!bdcTier && bdcTier.to === null;
  const mgrMissing = plan.enabled && !!mgrTier && mgrTier.to === null;
  const bdcEmail = cfg.bdcSettings?.bdcEmail || "";
  const mgrEmail = cfg.managerFallback?.managerEmail || "";
  const ro = !canEdit;
  const inputsOff = ro || !rules.enabled;
  const patchRules = (p: Partial<typeof rules>) => api.patchRouting({ escalationRules: { ...rules, ...p } });
  const canReview = dirty && complete.complete && canEdit && !loading && state.phase !== "applying";
  const helper = state.validation[0] ?? (!complete.complete ? "Complete all required fields to review your changes." : !dirty ? "No changes to review." : "Nothing is written until you review and apply.");
  const onReview = () => {
    const r = api.review();
    if (r === "reviewing" || r === "conflict") setOpen(true);
  };
  const closeReview = () => {
    setOpen(false);
    if (state.phase === "reviewing") api.cancelReview();
  };
  const runDry = () => setDry({ result: resolveCustomerPassportRouting(cfg, { agents: namedAgents(draft.agents), now: new Date(now) }), plan, at: now });

  const tabs = (
    <div role="tablist" aria-label="Escalation views" className="border-b border-adm-border overflow-x-auto">
      <div className="flex items-stretch gap-5 min-w-max">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "inline-flex items-center h-9 text-[13px] leading-[18px] font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors focus-visible:outline-2 focus-visible:outline-adm-primary",
              tab === t.id ? "text-adm-primary border-adm-primary" : "text-adm-muted border-transparent hover:text-adm-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );

  const activityCard = (full: boolean) => (
    <AdminCard
      inset="sm"
      flush
      title={cardTitle(api.fixture ? "Example delivery activity" : "Delivery activity", "leading-[22px]")}
      description="Recent escalation notifications for this rule. Accepted does not mean delivered."
      headerClassName="pt-[13px] pb-3"
    >
      <ActivityBody state={activityState} rows={activity} />
      <div className="px-4 pt-[9px] pb-3 space-y-2">
        <DeliveryNote />
        {full && <InlineNote tone="neutral" title="Older rows read as Attempted.">Rows recorded before delivery outcomes were tracked carry no acceptance, so they are never promoted to Accepted.</InlineNote>}
      </div>
    </AdminCard>
  );

  return (
    <ChildPageFrame section="customer-experience"
      crumbs={[
        { label: "Administration", href: "/admin" },
        { label: "Customer Experience", href: adminTabHref("passport-modules") },
        { label: "Contact & Routing", href: adminTabHref("routing") },
        { label: "Escalation" },
      ]}
      title="Escalation rules"
      badge={dirty ? <StatusChip tone="warning">Draft</StatusChip> : undefined}
      backHref={adminTabHref("routing")}
      backLabel="Back to Contact & Routing"
      actions={<div className="hidden sm:block"><ToggleRow compact id="escalation-on" label="Escalation" checked={rules.enabled} onChange={(v) => patchRules({ enabled: v })} disabled={ro} /></div>}
      tabs={tabs}
    >
      {ro && <InlineNote tone="info" title="View only." className="mb-4">Your role can see escalation rules but cannot change them.</InlineNote>}

      {tab === "rules" && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,660fr)_minmax(0,645fr)] gap-4 xl:gap-[13px] items-start">
          <AdminCard
            inset="sm"
            title={<span className="relative sm:top-[3px] inline-flex items-center gap-[18px] flex-wrap">{cardTitle("Unanswered customer requests")} {dirty && <StatusChip tone="warning" className="py-0">Keep draft</StatusChip>}</span>}
            action={
              <>
                <p className="hidden sm:block max-w-[212px] text-[12px] leading-[18px] text-adm-muted">Configure how and when to escalate unanswered customer requests.</p>
                <div className="sm:hidden"><ToggleRow compact id="escalation-on-sm" label="Escalation" checked={rules.enabled} onChange={(v) => patchRules({ enabled: v })} disabled={ro} /></div>
              </>
            }
            bodyClassName="pt-1.5 pb-3 pr-[13px]"
          >
            <p className="sm:hidden mb-3 text-[12px] leading-[18px] text-adm-muted">Configure how and when to escalate unanswered customer requests.</p>
            {!rules.enabled && <p className="mb-4 text-[13px] text-adm-muted" role="status">Escalation is off. Unanswered requests are never escalated until it is on.</p>}
            <ol>
              <Step n={1} title="First response" hint="If a customer request is not answered within the time below, the escalation clock starts.">
                <TierControls
                  minutes={<MinutesSelect id="sla-minutes" label="First response target" value={rules.firstResponseSlaMinutes} disabled={inputsOff} onChange={(v) => patchRules({ firstResponseSlaMinutes: v })} />}
                  destination={<DestinationSelect label="Target only" tier="First response" missing={false} />}
                  note={<p className="h-4 flex items-center text-[12px] leading-[16px] text-adm-muted">No one is notified at this step.</p>}
                />
              </Step>
              <Step n={2} title="BDC escalation" hint="If there is still no response, notify the BDC desk." className="pb-[17px]">
                <TierControls
                  minutes={<MinutesSelect id="bdc-after" label="Escalate to BDC after" value={rules.escalateToBdcAfterMinutes ?? rules.firstResponseSlaMinutes} allowOff disabled={inputsOff} onChange={(v) => patchRules({ escalateToBdcAfterMinutes: v })} />}
                  destination={<DestinationSelect label="BDC desk" tier="BDC escalation" missing={bdcMissing} />}
                  note={<DestinationState label="BDC" email={bdcEmail} editing={editing.bdc} onEdit={() => setEditing((e) => ({ ...e, bdc: true }))} />}
                  extra={editing.bdc && (
                    <Field label="BDC email">
                      <input type="email" value={bdcEmail} disabled={ro} placeholder="bdc@yourdealership.com" onChange={(e) => api.patchRouting({ bdcSettings: { enabled: false, showBdcAsTeam: true, ...(cfg.bdcSettings || {}), bdcEmail: e.target.value } })} className={inputCls} />
                    </Field>
                  )}
                />
              </Step>
              <Step n={3} title="Manager escalation" hint="If there is still no response, send a final escalation to the sales manager." last>
                <TierControls
                  className="mt-2"
                  minutes={<MinutesSelect id="manager-after" label="Escalate to manager after" value={rules.escalateToManagerAfterMinutes ?? 0} allowOff disabled={inputsOff} onChange={(v) => patchRules({ escalateToManagerAfterMinutes: v })} />}
                  destination={<DestinationSelect label="Sales manager" tier="Manager escalation" missing={mgrMissing} />}
                  note={<DestinationState label="Sales manager" email={mgrEmail} editing={editing.manager} onEdit={() => setEditing((e) => ({ ...e, manager: true }))} />}
                  extra={editing.manager && (
                    <Field label="Sales manager email">
                      <input type="email" value={mgrEmail} disabled={ro} placeholder="manager@yourdealership.com" onChange={(e) => api.patchRouting({ managerFallback: { enabled: false, ...(cfg.managerFallback || {}), managerEmail: e.target.value } })} className={inputCls} />
                    </Field>
                  )}
                />
              </Step>
            </ol>

            <div className="pt-3 border-t border-adm-border">
              <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">Scope</p>
              <p className="text-[12px] leading-[18px] text-adm-muted">Escalation rules are stored once per account and apply to every rooftop.</p>
              <div className="mt-[6px] inline-flex items-center h-[29px] min-w-[232px] px-3 rounded-[6px] border border-adm-border bg-adm-surface text-[14px] font-semibold text-adm-ink">
                {storeCount > 1 ? `All rooftops (${storeCount})` : "This rooftop"}
              </div>
              <div className="mt-[7px] flex flex-wrap gap-2">
                {storeCount > 1 ? stores.map((s) => <span key={s.id} data-parity="store-name" className="flex"><StatusChip tone="info">{s.name}</StatusChip></span>) : <span data-parity="store-name" className="flex"><StatusChip tone="info">{api.currentStoreName}</StatusChip></span>}
              </div>
            </div>

            <div className="mt-[13px]">
              <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">Notification methods</p>
              <p className="text-[12px] leading-[18px] text-adm-muted">Select how escalation notifications are sent.</p>
              <div className="mt-[6px] grid grid-cols-2 sm:grid-cols-[148fr_149fr_152fr_154fr] gap-2 sm:mr-1" role="group" aria-label="Notification methods">
                {methods.map((m) => {
                  const Icon = METHOD_ICON[m.key];
                  return (
                    <button
                      key={m.key}
                      type="button"
                      role="checkbox"
                      aria-checked={m.enabled}
                      disabled={!m.supported || ro}
                      onClick={() => api.patchRouting({ escalationRules: withEmailMethod(rules, !m.enabled) })}
                      className={cn(
                        "rounded-[6px] border px-3 pt-[5px] pb-[8px] text-left flex items-start gap-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary",
                        m.enabled ? "border-adm-primary/90 bg-adm-selected shadow-[inset_0_0_0_1px_#FFFFFF]" : "border-adm-border bg-adm-surface enabled:hover:border-adm-primary/50 enabled:hover:bg-adm-workspace",
                        !m.supported && "opacity-60 cursor-not-allowed",
                      )}
                    >
                      {m.enabled ? (
                        <span className="mt-px w-[22px] h-[22px] rounded-full bg-adm-primary text-white flex items-center justify-center flex-shrink-0" aria-hidden="true"><Icon className="w-3.5 h-3.5" strokeWidth={2.5} /></span>
                      ) : (
                        <Icon className={cn(ICON.status, "text-adm-muted flex-shrink-0")} aria-hidden="true" />
                      )}
                      <span className="min-w-0">
                        <span className="block text-[12px] leading-[18px] font-semibold text-adm-ink">{METHOD_SHORT[m.key]}</span>
                        <span className="block text-[11px] leading-[16px] text-adm-muted">{m.supported ? "Send by email" : "Not supported"}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-[10px] flex items-center gap-[15px] flex-wrap">
              <AdminButton variant="primary" data-parity="review-changes" className="min-h-[33px] w-[286px] rounded max-w-full disabled:opacity-100 disabled:bg-adm-border disabled:border-adm-border disabled:text-adm-muted" disabled={!canReview} onClick={onReview}>Review changes</AdminButton>
              {dirty && state.phase !== "applying" && <AdminButton variant="ghost" className="min-h-[34px]" onClick={api.discard}>Discard</AdminButton>}
              <p className={cn("text-[12px] leading-[18px]", state.validation.length ? "text-adm-danger" : "text-adm-muted")} role="status">{helper}</p>
            </div>
          </AdminCard>

          <div className="space-y-[9px]">
            <AdminCard inset="sm" title={cardTitle("Delivery states")} description="Possible states when sending an escalation notification." headerClassName="pt-3" bodyClassName="pt-[11px] pb-[15px]">
              <ul data-landmark="delivery-states" className="rounded-[10px] border border-adm-border divide-y divide-adm-border">
                {DELIVERY_STATES.map((s, i) => (
                  <li key={s.title} className={cn("flex items-center gap-[22px] px-[14px]", STATE_ROW_PAD[i])}>
                    <span className="flex-shrink-0" aria-hidden="true">{s.mark}</span>
                    <span className="min-w-0">
                      <span className="block text-[14px] leading-[18px] font-semibold text-adm-ink">{s.title}</span>
                      <span className="block pt-[2px] text-[12px] leading-[18px] text-adm-muted">{s.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div data-landmark="retry-note" className="mt-4">
                <RetryNote />
              </div>
            </AdminCard>
            {activityCard(false)}
          </div>
        </div>
      )}

      {tab === "activity" && activityCard(true)}

      {tab === "test" && (
        <AdminCard title="Test route" description="A dry run of the current draft against the routing resolver and the escalation plan. No message is sent and nothing is recorded.">
          <div className="flex items-center gap-3 flex-wrap">
            <AdminButton variant="primary" onClick={runDry}><PlayCircle className={ICON.button} aria-hidden="true" />Run dry run</AdminButton>
            {dry && <AdminButton variant="ghost" onClick={() => setDry(null)}>Clear</AdminButton>}
          </div>
          {dry && (
            <div className="mt-5 space-y-4">
              <KeyValueList
                rows={[
                  { label: "Evaluated at", value: formatWhen(new Date(dry.at).toISOString()) },
                  { label: "Shopper sees", value: <>{dry.result.displayName}<span className="block text-adm-muted">{dry.result.displaySubtitle}</span></> },
                  { label: "Routed to", value: humanize(dry.result.routingTargetType) },
                  { label: "After hours", value: dry.result.afterHours ? "Yes, the after-hours flow applies right now" : "No" },
                  { label: "First response target", value: dry.plan.enabled ? `${dry.plan.firstResponseSlaMinutes} minutes` : "Escalation is off" },
                  {
                    label: "Escalation tiers",
                    value: dry.plan.enabled && dry.plan.tiers.length ? (
                      <ul className="space-y-1">{dry.plan.tiers.map((t) => <li key={t.key}>After {t.afterMinutes} minutes: {t.label} ({t.to ? "destination set" : "no destination, nothing would send"})</li>)}</ul>
                    ) : "None",
                  },
                  { label: "Notification method", value: dry.plan.methods.length ? dry.plan.methods.map(humanize).join(", ") : "None supported, nothing would send" },
                ]}
              />
              <InlineNote tone="neutral" title="No message is sent.">This evaluates the draft only. Applying the draft is a separate, reviewed step.</InlineNote>
            </div>
          )}
        </AdminCard>
      )}

      <RoutingReviewDialog api={api} open={open} onClose={closeReview} title="Review escalation changes" />
    </ChildPageFrame>
  );
}
