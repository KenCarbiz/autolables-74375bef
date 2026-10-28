import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, Bell, Building2, CheckCircle2, Mail, MessageSquare, PlayCircle, Send, Smartphone, Truck, type LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import { ChildPageFrame } from "@/components/admin/v2/AdminShell";
import { AdminButton, AdminCard, AdminTable, EmptyState, InlineNote, KeyValueList, SkeletonBlock, StatusChip, Td, Th } from "@/components/admin/v2/primitives";
import { adminTabHref } from "@/lib/admin/sections";
import { useAdminNow, useViewFixture } from "@/lib/admin/dataSource";
import { describeAge } from "@/lib/admin/health";
import {
  AUDIT_ACTION_ESCALATED,
  AUDIT_ACTION_ESCALATION_FAILED,
  DELIVERY_RESULT_META,
  buildTierPlan,
  deliveryActivityFromAudit,
  escalationComplete,
  namedAgents,
  notificationMethodRows,
  withEmailMethod,
  type AuditRowLike,
  type DeliveryActivityRow,
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
const METHOD_ICON: Record<NotificationMethodRow["key"], LucideIcon> = { email: Mail, sms: MessageSquare, in_app: Bell, push: Smartphone };
const METHOD_SHORT: Record<NotificationMethodRow["key"], string> = { email: "Email", sms: "SMS", in_app: "In-app", push: "Push" };

const DELIVERY_STATES: Array<{ icon: LucideIcon; wrap: string; title: string; detail: string }> = [
  { icon: Send, wrap: "bg-adm-selected text-adm-primary", title: "Attempted", detail: "The request to send was made to the sender." },
  { icon: CheckCircle2, wrap: "bg-adm-success-bg text-adm-success", title: "Accepted", detail: "The sender accepted the notification for delivery." },
  { icon: Truck, wrap: "bg-adm-selected text-adm-primary", title: "Delivered", detail: "The recipient received it. The current sender does not report delivery, so this state is never claimed." },
  { icon: AlertCircle, wrap: "bg-adm-danger-bg text-adm-danger", title: "Failed", detail: "The sender refused or could not be reached. The lead stays where it was." },
];

const humanize = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const formatWhen = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

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

const MinutesSelect = ({ id, label, value, onChange, allowOff = false, disabled }: { id: string; label: string; value: number; onChange: (v: number) => void; allowOff?: boolean; disabled: boolean }) => {
  const options = Array.from(new Set([...(allowOff ? [0] : []), ...MINUTE_OPTIONS, value])).filter((m) => m >= 0).sort((a, b) => a - b);
  return (
    <select id={id} aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className={cn(selectCls, "mt-0 w-[190px]")}>
      {options.map((m) => <option key={m} value={m}>{m === 0 ? (allowOff ? "Off" : "0 minutes") : `${m} minutes`}</option>)}
    </select>
  );
};

const Step = ({ n, title, hint, last = false, children }: { n: number; title: string; hint: string; last?: boolean; children: ReactNode }) => (
  <li className={cn("relative pl-11", last ? "pb-1" : "pb-6")}>
    {!last && <span aria-hidden="true" className="absolute left-[15px] top-9 bottom-0 w-px bg-adm-border" />}
    <span className="absolute left-0 top-0 w-8 h-8 rounded-full bg-adm-selected text-adm-primary text-[13px] font-semibold flex items-center justify-center">{n}</span>
    <p className="text-[14px] leading-[20px] font-semibold text-adm-ink pt-1">{title}</p>
    <p className="text-[12px] leading-[18px] text-adm-muted">{hint}</p>
    <div className="mt-3">{children}</div>
  </li>
);

const Destination = ({ label, missing, children }: { label: string; missing: boolean; children?: ReactNode }) => (
  <div className="min-w-[240px] flex-1 max-w-[320px]">
    <div className={cn("h-9 px-3 rounded-[6px] border bg-adm-surface flex items-center text-[14px] font-semibold text-adm-ink", missing ? "border-adm-danger" : "border-adm-border")}>{label}</div>
    {children}
    {missing && (
      <p className="mt-1 text-[12px] leading-[18px] text-adm-danger flex items-center gap-1" role="alert">
        <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
        Destination required
      </p>
    )}
  </div>
);

const ActivityBody = ({ state, rows, now }: { state: "loading" | "failed" | "ready"; rows: DeliveryActivityRow[]; now: number }) => {
  if (state === "loading") {
    return <div className="px-6 pb-4 space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-9 w-full" />)}</div>;
  }
  if (state === "failed") {
    return <p role="status" className="px-6 pb-4 text-[13px] text-adm-muted">Delivery activity could not be read for this rooftop. It shows as Unavailable rather than zero.</p>;
  }
  if (rows.length === 0) {
    return <div className="px-6"><EmptyState compact title="No escalation notifications recorded." detail="Rows appear here after the escalation sweep attempts a notification." /></div>;
  }
  return (
    <AdminTable caption="Escalation delivery activity">
      <thead>
        <tr>
          <Th>Request</Th>
          <Th>Rooftop</Th>
          <Th>Channel</Th>
          <Th>Attempt</Th>
          <Th>Result</Th>
          <Th>Date and time</Th>
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
              <Td><StatusChip tone={meta.tone} icon={meta.tone !== "neutral"}>{meta.label}</StatusChip></Td>
              <Td className="text-adm-muted whitespace-nowrap">
                <time dateTime={r.at}>{formatWhen(r.at)}</time>
                <span className="block text-[11px]">{describeAge(r.at, now)}</span>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </AdminTable>
  );
};

export default function EscalationPage() {
  const api = useRoutingDraft();
  const now = useAdminNow();
  const { tenant } = useTenant();
  const fixture = useViewFixture<EscalationFixture>("escalation");
  const [tab, setTab] = useState<TabId>("rules");
  const [open, setOpen] = useState(false);
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
    <AdminCard title={api.fixture ? "Example delivery activity" : "Delivery activity"} description="Recent escalation notifications for this rule. Accepted does not mean delivered." flush>
      <ActivityBody state={activityState} rows={activity} now={now} />
      <div className="px-6 pb-6 pt-4 space-y-2">
        <InlineNote tone="info" title="Accepted does not mean delivered.">A notification can be accepted by the sender and still not reach the recipient.</InlineNote>
        {full && <InlineNote tone="neutral" title="Older rows read as Attempted.">Rows recorded before delivery outcomes were tracked carry no acceptance, so they are never promoted to Accepted.</InlineNote>}
      </div>
    </AdminCard>
  );

  return (
    <ChildPageFrame
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
      tabs={tabs}
    >
      {ro && <InlineNote tone="info" title="View only." className="mb-4">Your role can see escalation rules but cannot change them.</InlineNote>}

      {tab === "rules" && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          <AdminCard
            title={<span className="inline-flex items-center gap-2 flex-wrap">Unanswered customer requests {dirty && <StatusChip tone="warning">Keep draft</StatusChip>}</span>}
            description="Configure how and when to escalate unanswered customer requests."
            action={<ToggleRow compact id="escalation-on" label="Escalation" checked={rules.enabled} onChange={(v) => patchRules({ enabled: v })} disabled={ro} />}
          >
            {!rules.enabled && <p className="mb-4 text-[13px] text-adm-muted" role="status">Escalation is off. Unanswered requests are never escalated until it is on.</p>}
            <ol>
              <Step n={1} title="First response" hint="If a customer request is not answered within the time below, the first-response target is missed and the escalation clock starts.">
                <div className="flex flex-wrap items-start gap-3">
                  <MinutesSelect id="sla-minutes" label="First response target" value={rules.firstResponseSlaMinutes} disabled={inputsOff} onChange={(v) => patchRules({ firstResponseSlaMinutes: v })} />
                  <span className="text-[12px] text-adm-muted self-center">Send to</span>
                  <Destination label="Target only" missing={false}>
                    <p className="mt-1 text-[12px] leading-[18px] text-adm-muted">No one is notified at this step. The tiers below count from the request.</p>
                  </Destination>
                </div>
              </Step>
              <Step n={2} title="BDC escalation" hint="If there is still no response, notify the BDC desk.">
                <div className="flex flex-wrap items-start gap-3">
                  <MinutesSelect id="bdc-after" label="Escalate to BDC after" value={rules.escalateToBdcAfterMinutes ?? rules.firstResponseSlaMinutes} allowOff disabled={inputsOff} onChange={(v) => patchRules({ escalateToBdcAfterMinutes: v })} />
                  <span className="text-[12px] text-adm-muted self-center">Send to</span>
                  <Destination label="BDC desk" missing={bdcMissing}>
                    <Field label="BDC email" className="mt-2">
                      <input type="email" value={cfg.bdcSettings?.bdcEmail || ""} disabled={ro} placeholder="bdc@yourdealership.com" onChange={(e) => api.patchRouting({ bdcSettings: { enabled: false, showBdcAsTeam: true, ...(cfg.bdcSettings || {}), bdcEmail: e.target.value } })} className={inputCls} />
                    </Field>
                  </Destination>
                </div>
              </Step>
              <Step n={3} title="Manager escalation" hint="If there is still no response, send a final escalation to the sales manager." last>
                <div className="flex flex-wrap items-start gap-3">
                  <MinutesSelect id="manager-after" label="Escalate to manager after" value={rules.escalateToManagerAfterMinutes ?? 0} allowOff disabled={inputsOff} onChange={(v) => patchRules({ escalateToManagerAfterMinutes: v })} />
                  <span className="text-[12px] text-adm-muted self-center">Send to</span>
                  <Destination label="Sales manager" missing={mgrMissing}>
                    <Field label="Sales manager email" className="mt-2">
                      <input type="email" value={cfg.managerFallback?.managerEmail || ""} disabled={ro} placeholder="manager@yourdealership.com" onChange={(e) => api.patchRouting({ managerFallback: { enabled: false, ...(cfg.managerFallback || {}), managerEmail: e.target.value } })} className={inputCls} />
                    </Field>
                  </Destination>
                </div>
              </Step>
            </ol>

            <div className="mt-2 pt-5 border-t border-adm-border">
              <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">Scope</p>
              <p className="text-[12px] leading-[18px] text-adm-muted">Which rooftops this rule applies to.</p>
              <div className="mt-2 inline-flex items-center gap-2 h-9 px-3 rounded-[6px] border border-adm-border bg-adm-surface text-[14px] font-semibold text-adm-ink">
                <Building2 className="w-4 h-4 text-adm-muted" aria-hidden="true" />
                {storeCount > 1 ? `All rooftops (${storeCount})` : "This rooftop"}
              </div>
              {storeCount > 1 ? (
                <>
                  <div className="mt-2 flex flex-wrap gap-2">{stores.map((s) => <StatusChip key={s.id} tone="neutral">{s.name}</StatusChip>)}</div>
                  <p className="mt-2 text-[12px] leading-[18px] text-adm-muted">Escalation rules are stored once per account and apply to every rooftop.</p>
                </>
              ) : (
                <p className="mt-1 text-[12px] leading-[18px] text-adm-muted">{api.currentStoreName}</p>
              )}
            </div>

            <div className="mt-5">
              <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">Notification methods</p>
              <p className="text-[12px] leading-[18px] text-adm-muted">Select how escalation notifications are sent.</p>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2" role="group" aria-label="Notification methods">
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
                        "rounded-[6px] border px-3 py-2.5 text-left flex items-start gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary",
                        m.enabled ? "border-adm-primary bg-adm-selected" : "border-adm-border bg-adm-surface",
                        !m.supported && "opacity-60 cursor-not-allowed",
                      )}
                    >
                      <Icon className={cn("w-4 h-4 mt-0.5 flex-shrink-0", m.enabled ? "text-adm-primary" : "text-adm-muted")} aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block text-[13px] leading-[18px] font-semibold text-adm-ink">{METHOD_SHORT[m.key]}</span>
                        <span className="block text-[11px] leading-[16px] text-adm-muted">{m.supported ? "Send by email" : "Not supported"}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 flex items-center gap-3 flex-wrap">
              <AdminButton variant="primary" disabled={!canReview} onClick={onReview}>Review changes</AdminButton>
              {dirty && state.phase !== "applying" && <AdminButton variant="ghost" onClick={api.discard}>Discard</AdminButton>}
              <p className={cn("text-[12px] leading-[18px]", state.validation.length ? "text-adm-danger" : "text-adm-muted")} role="status">{helper}</p>
            </div>
          </AdminCard>

          <div className="space-y-4">
            <AdminCard title="Delivery states" description="Possible states when sending an escalation notification.">
              <ul className="divide-y divide-adm-border -my-1">
                {DELIVERY_STATES.map((s) => (
                  <li key={s.title} className="flex items-center gap-3 py-3">
                    <span className={cn("w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0", s.wrap)} aria-hidden="true"><s.icon className="w-4 h-4" /></span>
                    <span className="min-w-0">
                      <span className="block text-[14px] leading-[20px] font-semibold text-adm-ink">{s.title}</span>
                      <span className="block text-[12px] leading-[18px] text-adm-muted">{s.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <InlineNote tone="warning" title="A failed notification stays eligible for retry." className="mt-4">If a notification fails, the lead keeps its level and the next sweep tries again.</InlineNote>
            </AdminCard>
            {activityCard(false)}
          </div>
        </div>
      )}

      {tab === "activity" && activityCard(true)}

      {tab === "test" && (
        <AdminCard title="Test route" description="A dry run of the current draft against the routing resolver and the escalation plan. No message is sent and nothing is recorded.">
          <div className="flex items-center gap-3 flex-wrap">
            <AdminButton variant="primary" onClick={runDry}><PlayCircle className="w-4 h-4" aria-hidden="true" />Run dry run</AdminButton>
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
