import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, PlayCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import { ChildPageFrame } from "@/components/admin/v2/AdminShell";
import { AdminButton, AdminCard, AdminTable, EmptyState, ICON, InlineNote, KeyValueList, SkeletonBlock, StatusChip, Td, Th, type Tone } from "@/components/admin/v2/primitives";
import { SummaryList } from "@/components/detail/parts";
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
  { id: "rules", label: "Escalation tiers" },
  { id: "activity", label: "Delivery activity" },
  { id: "test", label: "Test route" },
];

const MINUTE_OPTIONS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120];
const METHOD_SHORT: Record<NotificationMethodRow["key"], string> = { email: "Email", sms: "SMS", in_app: "In-app", push: "Push" };

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

const ActivityTable = ({ state, rows, limit }: { state: "loading" | "failed" | "ready"; rows: DeliveryActivityRow[]; limit?: number }) => {
  if (state === "loading") {
    return <div className="px-4 pb-4 space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-9 w-full" />)}</div>;
  }
  if (state === "failed") {
    return <p role="status" className="px-4 pb-4 text-[13px] text-adm-muted">Delivery activity could not be read for this rooftop. It shows as Unavailable rather than zero.</p>;
  }
  if (rows.length === 0) {
    return <EmptyState compact title="No escalation notifications recorded." detail="Rows appear here after the escalation sweep attempts a notification." />;
  }
  return (
    <AdminTable caption="Escalation delivery activity" minWidth={680}>
      <thead>
        <tr>
          <Th>Date / Time</Th>
          <Th>Request</Th>
          <Th>Rooftop</Th>
          <Th>Channel</Th>
          <Th>Attempt</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {(limit ? rows.slice(0, limit) : rows).map((r) => {
          const meta = DELIVERY_RESULT_META[r.result];
          return (
            <tr key={r.id}>
              <Td className="whitespace-nowrap text-adm-muted"><time dateTime={r.at}>{formatWhen(r.at)}</time></Td>
              <Td className="max-w-[200px] truncate font-semibold">{r.requestLabel}</Td>
              <Td className="max-w-[160px] truncate">{r.rooftop}</Td>
              <Td>{r.channel}</Td>
              <Td>{r.attempt ?? "Unknown"}</Td>
              <Td><StatusChip tone={meta.tone as Tone}>{meta.label}</StatusChip></Td>
            </tr>
          );
        })}
      </tbody>
    </AdminTable>
  );
};

const DeliveryFootnote = () => (
  <p className="px-4 pb-4 text-[12px] leading-[18px] text-adm-muted">
    <span className="font-semibold text-adm-ink">Accepted does not mean delivered.</span>{" "}
    A notification can be accepted by the sender and still not reach the recipient. A failed notification stays eligible for retry.
  </p>
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
  const activeMethods = methods.filter((m) => m.enabled && m.supported).map((m) => METHOD_SHORT[m.key]).join(", ") || "None";
  const tierStatus = (missing: boolean) =>
    !rules.enabled ? <StatusChip tone="neutral">Off</StatusChip> : missing ? <StatusChip tone="warning">Missing</StatusChip> : <StatusChip tone="success">Active</StatusChip>;

  const tabs = (
    <div role="tablist" aria-label="Escalation views" className="border-b border-adm-border overflow-x-auto">
      <div className="flex items-stretch gap-6 min-w-max">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "inline-flex items-center h-10 text-[14px] leading-[20px] font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors focus-visible:outline-2 focus-visible:outline-adm-primary",
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
    <AdminCard inset="sm" flush title={api.fixture ? "Example delivery activity" : full ? "Delivery activity" : "Delivery activity (recent)"}>
      <ActivityTable state={activityState} rows={activity} limit={full ? undefined : 5} />
      <DeliveryFootnote />
    </AdminCard>
  );

  return (
    <ChildPageFrame section="customer-experience"
      crumbs={[
        { label: "Administration", href: "/admin" },
        { label: "Customer Experience", href: adminTabHref("routing") },
        { label: "Contact & Routing", href: adminTabHref("routing") },
        { label: "Escalation" },
      ]}
      title="Escalation & Delivery"
      badge={dirty ? <StatusChip tone="warning">Draft</StatusChip> : undefined}
      backHref={adminTabHref("routing")}
      backLabel="Back to Contact & Routing"
      actions={
        <>
          {dirty && state.phase !== "applying" && <AdminButton variant="secondary" onClick={api.discard}>Discard</AdminButton>}
          <AdminButton variant="primary" data-parity="review-changes" disabled={!canReview} onClick={onReview}>Review changes</AdminButton>
        </>
      }
      tabs={tabs}
    >
      {ro && <InlineNote tone="info" title="View only." className="mb-4">Your role can see escalation rules but cannot change them.</InlineNote>}

      {tab === "rules" && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
          <div className="flex flex-col gap-4 min-w-0">
            <AdminCard
              inset="sm"
              flush
              title={<span className="inline-flex items-center gap-3">Escalation tiers {dirty && <StatusChip tone="warning">Keep draft</StatusChip>}</span>}
              action={<ToggleRow compact id="escalation-on" label="Escalation" checked={rules.enabled} onChange={(v) => patchRules({ enabled: v })} disabled={ro} />}
            >
              <AdminTable caption="Escalation tiers" minWidth={760}>
                <thead>
                  <tr>
                    <Th className="w-12">Tier</Th>
                    <Th>Trigger</Th>
                    <Th className="w-[150px]">Response window</Th>
                    <Th>Recipients</Th>
                    <Th>Method</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  <tr data-landmark="escalation-tier">
                    <Td>1</Td>
                    <Td>First response target</Td>
                    <Td><MinutesSelect id="sla-minutes" label="First response target" value={rules.firstResponseSlaMinutes} disabled={inputsOff} onChange={(v) => patchRules({ firstResponseSlaMinutes: v })} /></Td>
                    <Td className="text-adm-muted">No one is notified</Td>
                    <Td className="text-adm-muted">None</Td>
                    <Td>{tierStatus(false)}</Td>
                  </tr>
                  <tr data-landmark="escalation-tier">
                    <Td>2</Td>
                    <Td>No response, escalate to BDC</Td>
                    <Td><MinutesSelect id="bdc-after" label="Escalate to BDC after" value={rules.escalateToBdcAfterMinutes ?? rules.firstResponseSlaMinutes} allowOff disabled={inputsOff} onChange={(v) => patchRules({ escalateToBdcAfterMinutes: v })} /></Td>
                    <Td className="max-w-[240px]">
                      <DestinationState label="BDC" email={bdcEmail} editing={editing.bdc} onEdit={() => setEditing((e) => ({ ...e, bdc: true }))} />
                      {editing.bdc && (
                        <Field label="BDC email">
                          <input type="email" value={bdcEmail} disabled={ro} placeholder="bdc@yourdealership.com" onChange={(e) => api.patchRouting({ bdcSettings: { enabled: false, showBdcAsTeam: true, ...(cfg.bdcSettings || {}), bdcEmail: e.target.value } })} className={inputCls} />
                        </Field>
                      )}
                    </Td>
                    <Td>{activeMethods}</Td>
                    <Td>{tierStatus(bdcMissing)}</Td>
                  </tr>
                  <tr data-landmark="escalation-tier">
                    <Td>3</Td>
                    <Td>Still no response, escalate to manager</Td>
                    <Td><MinutesSelect id="manager-after" label="Escalate to manager after" value={rules.escalateToManagerAfterMinutes ?? 0} allowOff disabled={inputsOff} onChange={(v) => patchRules({ escalateToManagerAfterMinutes: v })} /></Td>
                    <Td className="max-w-[240px]">
                      <DestinationState label="Sales manager" email={mgrEmail} editing={editing.manager} onEdit={() => setEditing((e) => ({ ...e, manager: true }))} />
                      {editing.manager && (
                        <Field label="Sales manager email">
                          <input type="email" value={mgrEmail} disabled={ro} placeholder="manager@yourdealership.com" onChange={(e) => api.patchRouting({ managerFallback: { enabled: false, ...(cfg.managerFallback || {}), managerEmail: e.target.value } })} className={inputCls} />
                        </Field>
                      )}
                    </Td>
                    <Td>{activeMethods}</Td>
                    <Td>{tierStatus(mgrMissing)}</Td>
                  </tr>
                </tbody>
              </AdminTable>
              <p className={cn("px-4 py-3 text-[12px] leading-[18px]", state.validation.length ? "text-adm-danger" : "text-adm-muted")} role="status">{helper}</p>
            </AdminCard>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <AdminCard inset="sm" flush title="Supported methods">
                <AdminTable caption="Supported methods" minWidth={0}>
                  <tbody>
                    {methods.map((m) => (
                      <tr key={m.key}>
                        <Td className="font-medium">{METHOD_SHORT[m.key]}</Td>
                        <Td className="text-adm-muted">{m.supported ? (m.enabled ? "Supported (on)" : "Supported (off)") : "Not supported"}</Td>
                        <Td align="right">
                          {m.supported && (
                            <button type="button" disabled={ro} onClick={() => api.patchRouting({ escalationRules: withEmailMethod(rules, !m.enabled) })} className="font-semibold text-adm-primary hover:underline disabled:opacity-50">
                              {m.enabled ? "Turn off" : "Turn on"}
                            </button>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </AdminTable>
              </AdminCard>
              <AdminCard inset="sm" title="Review test route">
                <SummaryList rows={[{ label: "Last test", value: dry ? formatWhen(new Date(dry.at).toISOString()) : "Not run" }, { label: "Result", value: dry ? "Dry run complete" : "Unknown" }]} />
                <AdminButton variant="outline" className="mt-3 w-full" onClick={() => setTab("test")}>Open test route</AdminButton>
              </AdminCard>
            </div>

            {activityCard(false)}
          </div>

          <AdminCard inset="sm" title="Scope & applicability">
            <SummaryList
              rows={[
                { label: "Account scope", value: storeCount > 1 ? `All rooftops (${storeCount})` : "This rooftop" },
                { label: "Rule storage", value: "Once per account" },
                { label: "Affected rooftops", value: <span data-parity="store-name">{(storeCount > 1 ? stores.map((s) => s.name) : [api.currentStoreName]).join(", ")}</span> },
              ]}
            />
            <p className="mt-3 text-[13px] leading-[18px] text-adm-muted">Escalation rules apply to every rooftop in this account.</p>
          </AdminCard>
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
