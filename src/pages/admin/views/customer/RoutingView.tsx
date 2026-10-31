import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Building, Building2, ChevronRight, CircleAlert, CircleCheck, Clock, FileText, GripVertical, Headset, Mail, MessageSquare, Plus, ShieldCheck, Smartphone, Trash2, TriangleAlert, User, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminButton, AdminCard, ICON, InlineNote, SectionTitle } from "@/components/admin/v2/primitives";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import type { RoutingReadiness } from "@/lib/admin/effectivePolicy";
import { namedAgents, notificationMethodRows, routingOrderRows, withEmailMethod, type NotificationMethodRow, type RoutingOrderRow } from "@/lib/admin/routingDraft";
import type { ContactMode, CustomerPassportContactSettings, PassportAgent, RoutingPriorityItem } from "@/lib/passportRouting";
import { useRoutingDraft } from "./useRoutingDraft";
import { RoutingPreview } from "./RoutingPreview";
import { RoutingReviewDialog } from "./RoutingReviewDialog";
import { DAY_NAMES, Field, ToggleRow, inputCls, newAgent, selectCls } from "./controls";

// Contact & Routing (reference 08). The order list and the readiness rail
// describe the draft exactly as the resolver and the readiness rule read it;
// every control from the legacy Lead Routing panel sits below the fold and
// edits the same draft. Nothing is saved until Review & Apply.

const ORDER_ICON: Record<RoutingPriorityItem, LucideIcon> = {
  crm_owner: User,
  vehicle_assigned_agent: User,
  available_sales_rotation: Users,
  bdc: Headset,
  sales_manager: ShieldCheck,
  dealership_default: Building2,
};

const READINESS_META: Record<string, { icon: LucideIcon; href: string; description: string }> = {
  default_contact: { icon: User, href: "#routing-default-contact", description: "Store contact for unassigned requests." },
  sales_rotation: { icon: Users, href: "#routing-rotation", description: "At least two salespeople required." },
  manager_recipient: { icon: ShieldCheck, href: "#routing-manager", description: "Manager for escalations." },
  bdc_destination: { icon: Headset, href: "#routing-bdc", description: "BDC destination for routing and escalation." },
  after_hours: { icon: Clock, href: "#routing-hours", description: "Handle requests outside business hours." },
  escalation: { icon: Bell, href: ADMIN_CHILD_ROUTES.escalation, description: "Every escalation tier needs a destination." },
};

// The readiness rail lists the routing checks; the two escalation checks are
// reported by the Response and escalation card, which owns those tiers.
const RAIL_CHECKS = ["default_contact", "sales_rotation", "manager_recipient", "after_hours"];

const METHOD_ICON: Record<NotificationMethodRow["key"], LucideIcon> = { email: Mail, sms: MessageSquare, in_app: Bell, push: Smartphone };
const SUMMARY_METHODS: NotificationMethodRow["key"][] = ["email", "in_app"];

const MODE_LABEL: Record<ContactMode, string> = {
  smart_routing: "Smart routing",
  assigned_agent: "the assigned agent",
  bdc: "the BDC team",
  dealership_default: "the store contact",
};

const iconBtn = "w-8 h-8 rounded-md inline-flex items-center justify-center text-adm-muted hover:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary flex-shrink-0";

// The reference draws the row and rail glyphs (user, users, shield, clock,
// mail, bell, building) 22 to 24px: a 24px lucide users glyph measures 24x20
// in the mock, so the inline size from the shared scale is too small here.
const ROW_ICON = "w-6 h-6";

type PillTone = "success" | "danger" | "warning" | "neutral";

// The mock's state chips are 29px pills with a 16px mark 12px in and the
// label 8px after it, wider than the shared StatusChip (28px, 6px radius).
const PILL: Record<PillTone, { cls: string; icon: LucideIcon | null }> = {
  success: { cls: "bg-adm-success-bg text-adm-success", icon: CircleCheck },
  danger: { cls: "bg-adm-danger-bg text-adm-danger", icon: CircleAlert },
  warning: { cls: "bg-adm-warning-bg text-adm-warning", icon: TriangleAlert },
  neutral: { cls: "bg-adm-workspace text-adm-muted border border-adm-border", icon: null },
};

const Pill = ({ tone, children }: { tone: PillTone; children: string }) => {
  const Icon = PILL[tone].icon;
  return (
    <span className={cn("inline-flex items-center gap-2 h-[29px] px-3 rounded-full text-[12px] leading-[18px] font-semibold whitespace-nowrap", PILL[tone].cls)}>
      {Icon && <Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />}
      {children}
    </span>
  );
};

const OrderRow = ({ row }: { row: RoutingOrderRow }) => {
  const Icon = ORDER_ICON[row.key];
  return (
    <li data-landmark="order-row" className="min-h-[67.5px] rounded-[6px] border border-adm-border bg-adm-surface flex items-stretch">
      <div className="min-w-0 flex-1 flex items-center py-[13px]">
        <GripVertical className={cn(ICON.inline, "-ml-[3px] text-adm-muted flex-shrink-0")} aria-hidden="true" />
        <span className="ml-[14px] w-[34px] h-[34px] rounded-full bg-adm-workspace text-adm-ink text-[14px] font-semibold flex items-center justify-center flex-shrink-0">{row.step}</span>
        <div className="min-w-0 flex-1 ml-[21px] pr-3">
          <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{row.title}</p>
          <p className="text-[12px] leading-[18px] text-adm-muted">{row.description}</p>
        </div>
      </div>
      <div className="relative sm:w-[230px] flex-shrink-0 flex items-center pl-[13px] pr-[3px] pt-[11px] pb-[15px] before:content-[''] before:absolute before:left-0 before:top-2 before:bottom-[7px] before:w-px before:bg-adm-border">
        {row.state === "incomplete" ? (
          <Pill tone="danger">Incomplete</Pill>
        ) : row.state === "off" ? (
          <Pill tone="neutral">Off</Pill>
        ) : (
          <span className="hidden sm:flex items-center gap-[13px] min-w-0">
            <Icon className={cn(ROW_ICON, "text-adm-muted flex-shrink-0")} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-[14px] leading-[20px] font-semibold text-adm-ink truncate">{row.owner}</span>
              <span className="block text-[11px] leading-[16px] text-adm-muted truncate">{row.ownerDetail}</span>
            </span>
          </span>
        )}
        <a href={`#${row.anchor}`} aria-label={`Edit ${row.title}`} className={cn(iconBtn, "ml-auto mt-1")}><ChevronRight className={ICON.chevron} aria-hidden="true" /></a>
      </div>
    </li>
  );
};

type Check = RoutingReadiness["checks"][number];

const ReadinessRow = ({ check, chip }: { check: Check; chip: { tone: PillTone; label: string } }) => {
  const meta = READINESS_META[check.key] ?? { icon: Bell, href: "#routing-contact-mode", description: check.detail };
  const Icon = meta.icon;
  const body = (
    <>
      <Icon className={cn(ROW_ICON, "text-adm-muted flex-shrink-0")} aria-hidden="true" />
      <span className="min-w-0 flex-1 ml-3 sm:ml-[22px]">
        <span className="block text-[13px] leading-[18px] font-bold text-adm-ink">{check.label}</span>
        <span className="block text-[11px] leading-[16px] text-adm-muted">{meta.description}</span>
      </span>
      <span className="sm:w-[146px] flex-shrink-0 flex items-center">
        <Pill tone={chip.tone}>{chip.label}</Pill>
      </span>
      <span className="w-8 h-8 flex items-center justify-center flex-shrink-0" aria-hidden="true"><ChevronRight className={cn(ICON.chevron, "text-adm-muted")} /></span>
    </>
  );
  const cls = "flex items-center pl-[18px] pr-[3px] py-[9px] hover:bg-adm-workspace/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary";
  return <li title={check.detail}>{meta.href.startsWith("#") ? <a href={meta.href} className={cls}>{body}</a> : <Link to={meta.href} className={cls}>{body}</Link>}</li>;
};

// The mock's row rules start under the title and stop at the value, leaving
// the icon and the chevron columns open.
const TimingRow = ({ icon: Icon, title, hint, value, last = false }: { icon: LucideIcon; title: string; hint: string; value: string; last?: boolean }) => (
  <li className={cn("relative flex items-center gap-[3px] pt-2 pl-[5px] pr-[5px]", last ? "pb-2" : "pb-[9px] after:content-[''] after:absolute after:left-[49px] after:right-[40px] after:bottom-0 after:h-px after:bg-adm-border")}>
    <Icon className="w-[22px] h-[22px] text-adm-muted flex-shrink-0" aria-hidden="true" />
    <span className="min-w-0 flex-1 ml-[19px]">
      <span className="block text-[13px] leading-[18px] font-bold text-adm-ink">{title}</span>
      <span className="block text-[11px] leading-[16px] text-adm-muted break-words">{hint}</span>
    </span>
    <span className="text-[14px] leading-[20px] text-adm-ink whitespace-nowrap">{value}</span>
    <Link to={ADMIN_CHILD_ROUTES.escalation} aria-label={`${title}: open escalation rules`} className={iconBtn}><ChevronRight className={ICON.chevron} aria-hidden="true" /></Link>
  </li>
);

const minutesLabel = (v: number | undefined | null, off: string): string => (v && v > 0 ? `${v} ${v === 1 ? "minute" : "minutes"}` : off);

const ScopeBadge = ({ count }: { count: number }) => (
  <div data-parity="scope" className="flex items-center gap-[14px]" title="Routing is stored once per account and applies to every rooftop.">
    <span className="text-[13px] leading-[18px] text-adm-muted">Scope</span>
    <span className="inline-flex items-center gap-[11px] h-[42px] min-w-[191px] pl-[11px] pr-4 rounded-[6px] border border-adm-border bg-adm-surface text-[13px] leading-[18px] text-adm-ink">
      <Building className="w-[22px] h-[22px] text-adm-muted flex-shrink-0" aria-hidden="true" />
      {count > 1 ? `Whole account (${count} rooftops)` : "Whole account"}
    </span>
  </div>
);

export default function RoutingView() {
  const api = useRoutingDraft();
  const [open, setOpen] = useState(false);
  const lastManualMode = useRef<ContactMode>("dealership_default");
  const { draft, readiness, dirty, canEdit, loading, state, now } = api;
  const cfg = draft.routing;
  const agents = draft.agents;
  const rules = cfg.escalationRules;
  const phase = state.phase;
  const errors = state.validation;
  const patch = api.patchRouting;
  const rows = routingOrderRows(draft);
  const methods = notificationMethodRows(rules).filter((m) => SUMMARY_METHODS.includes(m.key));
  const railChecks = readiness.checks.filter((c) => RAIL_CHECKS.includes(c.key));
  const escalationBlockers = readiness.checks.filter((c) => !RAIL_CHECKS.includes(c.key) && c.state === "missing").map((c) => c.label.replace(/^[A-Z](?=[a-z])/, (ch) => ch.toLowerCase()));
  const smart = cfg.contactMode === "smart_routing";
  const rotationCount = namedAgents(agents).filter((a) => a.acceptsPassportLeads !== false && a.manualOverride !== "unavailable").length;

  const chipFor = (c: Check): { tone: "success" | "danger" | "warning" | "neutral"; label: string } => {
    if (c.state === "missing") return { tone: "danger", label: "Missing" };
    if (c.state === "warning") return { tone: "warning", label: "Check" };
    if (c.key === "sales_rotation") return cfg.salesRotationSettings.enabled ? { tone: "success", label: `${rotationCount} ${rotationCount === 1 ? "salesperson" : "salespeople"}` } : { tone: "neutral", label: "Off" };
    if (c.key === "manager_recipient" && !cfg.managerFallback?.enabled) return { tone: "neutral", label: "Off" };
    if (c.key === "bdc_destination" && !cfg.bdcSettings?.enabled) return { tone: "neutral", label: "Off" };
    return { tone: "success", label: "Configured" };
  };

  const setSmart = (on: boolean) => patch({ contactMode: on ? "smart_routing" : lastManualMode.current });
  const setMode = (mode: ContactMode) => {
    if (mode !== "smart_routing") lastManualMode.current = mode;
    patch({ contactMode: mode });
  };
  const patchRules = (p: Partial<CustomerPassportContactSettings["escalationRules"]>) => patch({ escalationRules: { ...rules, ...p } });
  const patchAgent = (i: number, p: Partial<PassportAgent>) => api.setAgents((a) => a.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const setHours = (day: number, field: "startTime" | "endTime" | "enabled", value: string | boolean) =>
    patch((c) => {
      const rest = c.businessHours.filter((b) => b.dayOfWeek !== day);
      const existing = c.businessHours.find((b) => b.dayOfWeek === day);
      if (field === "enabled") return { businessHours: value ? [...rest, existing ?? { dayOfWeek: day, startTime: "09:00", endTime: "19:00" }] : rest };
      if (!existing) return {};
      return { businessHours: [...rest, { ...existing, [field]: value }] };
    });

  const onReview = () => {
    const r = api.review();
    if (r === "reviewing" || r === "conflict") setOpen(true);
  };
  const closeReview = () => {
    setOpen(false);
    if (phase === "reviewing") api.cancelReview();
  };
  const canReview = dirty && canEdit && !loading && phase !== "applying";
  const changed = api.changeRows.length;
  const status =
    phase === "applied" ? "Applied. Every consumer now reads the new configuration."
    : errors.length ? errors[0]
    : phase === "failed" && state.error ? state.error
    : dirty ? `${changed} ${changed === 1 ? "setting" : "settings"} changed. Review before applying.`
    : "No pending changes. Edits stay in this draft until you review and apply them.";
  const statusDanger = errors.length > 0 || phase === "failed";
  const ro = !canEdit;

  return (
    <div className="pt-[5px]">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-[26px] leading-[32px] font-bold text-adm-ink">Contact & Routing</h2>
          <p className="text-[15px] leading-[22px] text-adm-muted">Give every customer request a clear owner and fallback.</p>
        </div>
        <div className="mt-px"><ScopeBadge count={api.storeCount} /></div>
      </div>

      {ro && <InlineNote tone="info" title="View only." className="mt-4">Your role can see routing but cannot change it. Ask an administrator for changes.</InlineNote>}

      <div className="mt-[19px] grid grid-cols-1 xl:grid-cols-[minmax(0,622fr)_minmax(0,656fr)] gap-4 xl:gap-[14px]">
        <AdminCard
          inset="sm"
          title="Routing order"
          headerClassName="pt-[13px] pr-[14px]"
          bodyClassName="px-3 pt-[15px]"
          action={<div className="mt-[2px]"><ToggleRow compact id="smart-routing" label="Smart routing" checked={smart} onChange={setSmart} disabled={ro} switchSize="routing" /></div>}
        >
          <ol className={cn("space-y-2", !smart && "opacity-60")}>{rows.map((r) => <OrderRow key={r.key} row={r} />)}</ol>
          {!smart && (
            <p className="mt-3 text-[12px] leading-[18px] text-adm-muted" role="status">
              Smart routing is off. Every request goes to {MODE_LABEL[cfg.contactMode]}. The order above applies when it is on.
            </p>
          )}
        </AdminCard>

        <div className="space-y-[14px]">
          <AdminCard inset="sm" title="Configuration readiness" headerClassName="pt-[13px] px-[14px]" bodyClassName="px-3 pt-[15px] pb-[14px]">
            <ul data-landmark="readiness-list" className="rounded-[6px] border border-adm-border divide-y divide-adm-border">
              {railChecks.map((c) => <ReadinessRow key={c.key} check={c} chip={chipFor(c)} />)}
            </ul>
            <Link to={ADMIN_CHILD_ROUTES.escalation} data-parity="review-escalation" className="mt-[11px] inline-flex items-center gap-[15px] min-h-[36px] w-[232px] max-w-full pl-[25px] pr-2 rounded-md border border-adm-primary/40 text-[14px] font-semibold text-adm-primary whitespace-nowrap hover:bg-adm-selected focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary">
              <FileText className={cn(ICON.button, "flex-shrink-0")} aria-hidden="true" />
              Review escalation rules
            </Link>
          </AdminCard>

          {/* The escalation on/off switch lives on the Escalation child, which owns the tiers; this card reports the state. */}
          <AdminCard inset="sm" title="Response and escalation" headerClassName="pt-[14px] px-[14px]" bodyClassName="px-3 pt-[7px] pb-3">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_266px]">
              <ul>
                <TimingRow icon={Clock} title="First response" hint="Customer should get a reply within:" value={rules.enabled ? minutesLabel(rules.firstResponseSlaMinutes, "Not set") : "Off"} />
                <TimingRow icon={Users} title="Route to BDC" hint="If no response after:" value={rules.enabled ? minutesLabel(rules.escalateToBdcAfterMinutes ?? rules.firstResponseSlaMinutes, "Off") : "Off"} />
                <TimingRow icon={ShieldCheck} title="Route to manager" hint="If still no response after:" value={rules.enabled ? minutesLabel(rules.escalateToManagerAfterMinutes, "Off") : "Off"} last />
              </ul>
              <div className="pt-[5px] lg:border-l lg:border-adm-border lg:pl-[19px]">
                <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">Notification methods</p>
                <ul className="mt-2.5 space-y-[14px]">
                  {methods.map((m) => {
                    const Icon = METHOD_ICON[m.key];
                    return (
                      <li key={m.key} className="flex items-start gap-[21px]">
                        <Icon className="w-[21px] h-[21px] mt-[6px] text-adm-ink flex-shrink-0" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <ToggleRow
                            id={`method-${m.key}`}
                            label={m.label}
                            hint={m.supported ? m.detail : "Not supported yet."}
                            hintClassName="text-[11px] leading-[14px]"
                            switchSize="sm"
                            switchClassName="mt-[3px] mr-1"
                            checked={m.enabled}
                            onChange={(v) => patchRules(withEmailMethod(rules, v))}
                            disabled={ro || !m.supported}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
            {readiness.blockers.length > 0 && (
              <div role="status" className="flex items-center gap-3 rounded-[6px] border border-[#F1D58A] bg-adm-warning-bg pl-[13px] pr-3 py-[7px] text-[12px] leading-[18px] text-adm-ink">
                <TriangleAlert className="w-5 h-5 text-adm-warning flex-shrink-0" aria-hidden="true" />
                <p className="min-w-0">
                  <span className="font-semibold">Add a valid fallback before enabling this route.</span>
                  {escalationBlockers.length > 0 && <> Missing: {escalationBlockers.join(", ")}.</>}
                </p>
              </div>
            )}
          </AdminCard>
        </div>
      </div>

      <div className="mt-5">
        <SectionTitle as="h3" title="Detailed configuration" description="Every control from Lead Routing. Changes stay in the draft until you review and apply them." />
      </div>

      <div className="mt-5 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
        <div className="space-y-4 min-w-0">
          <AdminCard id="routing-contact-mode" title="Contact mode and profile">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Contact mode">
                <select value={cfg.contactMode} disabled={ro} onChange={(e) => setMode(e.target.value as ContactMode)} className={selectCls}>
                  <option value="smart_routing">Smart routing (recommended)</option>
                  <option value="assigned_agent">Assigned agent</option>
                  <option value="bdc">BDC team</option>
                  <option value="dealership_default">Dealership default</option>
                </select>
                <span className="block mt-1 text-[12px] leading-[18px] text-adm-muted">Smart routing tries CRM owner, assigned agent, rotation, BDC, manager, then the store.</span>
              </Field>
              <div className="pt-1">
                <ToggleRow id="show-agent-profile" checked={cfg.showAgentProfile} disabled={ro} onChange={(v) => patch({ showAgentProfile: v })} label="Show agent profile to shoppers" hint="Off: leads still route to the person, but shoppers see neutral dealership language." />
              </div>
              {cfg.showAgentProfile && (
                <>
                  <Field label="Agent name display">
                    <select value={cfg.agentDisplayRules.nameDisplay} disabled={ro} onChange={(e) => patch({ agentDisplayRules: { ...cfg.agentDisplayRules, nameDisplay: e.target.value as "first_name" | "full_name" | "team_only" } })} className={selectCls}>
                      <option value="first_name">First name only</option>
                      <option value="full_name">Full name</option>
                      <option value="team_only">Team only (hide the person)</option>
                    </select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <ToggleRow compact id="show-photo" checked={cfg.agentDisplayRules.showPhoto} disabled={ro} onChange={(v) => patch({ agentDisplayRules: { ...cfg.agentDisplayRules, showPhoto: v } })} label="Show photo" />
                    <ToggleRow compact id="show-title" checked={cfg.agentDisplayRules.showTitle} disabled={ro} onChange={(v) => patch({ agentDisplayRules: { ...cfg.agentDisplayRules, showTitle: v } })} label="Show title" />
                    <ToggleRow compact id="show-availability" checked={cfg.agentDisplayRules.showAvailability} disabled={ro} onChange={(v) => patch({ agentDisplayRules: { ...cfg.agentDisplayRules, showAvailability: v } })} label="Show availability" />
                    <ToggleRow compact id="show-hours" checked={cfg.agentDisplayRules.showWorkingHours} disabled={ro} onChange={(v) => patch({ agentDisplayRules: { ...cfg.agentDisplayRules, showWorkingHours: v } })} label="Show working hours" />
                  </div>
                </>
              )}
            </div>
          </AdminCard>

          <AdminCard id="routing-default-contact" title="Store contact" description="The guaranteed fallback. Every routing path ends here if nothing else is available.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Main sales phone"><input value={cfg.dealershipDefaultContact.salesPhone} disabled={ro} onChange={(e) => patch({ dealershipDefaultContact: { ...cfg.dealershipDefaultContact, salesPhone: e.target.value } })} placeholder="(860) 555-1212" className={inputCls} /></Field>
              <Field label="Sales lead inbox"><input type="email" value={cfg.dealershipDefaultContact.salesEmail} disabled={ro} onChange={(e) => patch({ dealershipDefaultContact: { ...cfg.dealershipDefaultContact, salesEmail: e.target.value } })} placeholder="sales@yourdealership.com" className={inputCls} /></Field>
            </div>
          </AdminCard>

          <AdminCard
            id="routing-roster"
            title="Sales team roster"
            description="Who can receive passport leads. Unavailable people are never shown or assigned."
            action={<AdminButton size="sm" disabled={ro} onClick={() => api.setAgents((a) => [...a, newAgent()])}><Plus className="w-4 h-4" aria-hidden="true" />Add</AdminButton>}
          >
            {agents.length === 0 && <p className="text-[13px] text-adm-muted">No salespeople yet. Smart routing will use the BDC and store fallbacks.</p>}
            <div className="space-y-3">
              {agents.map((a, i) => (
                <div key={a.id} className="rounded-[6px] border border-adm-border p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                  <Field label="Name" className="col-span-2"><input value={a.name} disabled={ro} onChange={(e) => patchAgent(i, { name: e.target.value })} placeholder="Full name" className={inputCls} /></Field>
                  <Field label="Title" className="col-span-2"><input value={a.title || ""} disabled={ro} onChange={(e) => patchAgent(i, { title: e.target.value })} className={inputCls} /></Field>
                  <Field label="Phone"><input value={a.phone || ""} disabled={ro} onChange={(e) => patchAgent(i, { phone: e.target.value })} className={inputCls} /></Field>
                  <Field label="Text number"><input value={a.smsNumber || ""} disabled={ro} onChange={(e) => patchAgent(i, { smsNumber: e.target.value })} className={inputCls} /></Field>
                  <Field label="Email" className="col-span-2"><input type="email" value={a.email || ""} disabled={ro} onChange={(e) => patchAgent(i, { email: e.target.value })} className={inputCls} /></Field>
                  <Field label="Status">
                    <select
                      value={a.manualOverride === "unavailable" ? "unavailable" : a.status}
                      disabled={ro}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "unavailable") patchAgent(i, { manualOverride: "unavailable" });
                        else patchAgent(i, { manualOverride: null, status: v as PassportAgent["status"] });
                      }}
                      className={selectCls}
                    >
                      <option value="available">Available</option>
                      <option value="busy">Busy</option>
                      <option value="away">Away</option>
                      <option value="offline">Offline</option>
                      <option value="unavailable">Paused (manual)</option>
                    </select>
                  </Field>
                  <div className="flex items-center justify-between gap-2 col-span-2 sm:col-span-3">
                    <ToggleRow compact id={`agent-leads-${a.id}`} checked={a.acceptsPassportLeads} disabled={ro} onChange={(v) => patchAgent(i, { acceptsPassportLeads: v })} label="Receives passport leads" />
                    <AdminButton size="sm" variant="danger" disabled={ro} aria-label={`Remove ${a.name || "salesperson"}`} onClick={() => api.setAgents((arr) => arr.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" aria-hidden="true" /></AdminButton>
                  </div>
                </div>
              ))}
            </div>
          </AdminCard>

          <AdminCard id="routing-rotation" title="Salesperson rotation">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-3">
                <ToggleRow id="rotation-enabled" checked={cfg.salesRotationSettings.enabled} disabled={ro} onChange={(v) => patch({ salesRotationSettings: { ...cfg.salesRotationSettings, enabled: v } })} label="Enable rotation" />
                <ToggleRow id="rotation-available-only" checked={cfg.salesRotationSettings.onlyAvailableUsers} disabled={ro} onChange={(v) => patch({ salesRotationSettings: { ...cfg.salesRotationSettings, onlyAvailableUsers: v } })} label="Only available users" hint="Never assign a lead to someone who is off, paused, or outside working hours." />
                <ToggleRow id="rotation-crm" checked={cfg.salesRotationSettings.respectCrmOwnership} disabled={ro} onChange={(v) => patch({ salesRotationSettings: { ...cfg.salesRotationSettings, respectCrmOwnership: v } })} label="Respect CRM ownership" hint="A returning shopper stays with the person already working their lead." />
              </div>
              <div className="space-y-3">
                <Field label="Method">
                  <select value={cfg.salesRotationSettings.method} disabled={ro} onChange={(e) => patch({ salesRotationSettings: { ...cfg.salesRotationSettings, method: e.target.value as "round_robin" | "weighted" | "least_recent" } })} className={selectCls}>
                    <option value="round_robin">Round robin</option>
                    <option value="least_recent">Least recent</option>
                    <option value="weighted">Weighted (uses least recent until weights exist)</option>
                  </select>
                </Field>
                <Field label="Max open leads per person">
                  <input type="number" min={0} value={cfg.salesRotationSettings.maxOpenLeadsPerUser ?? ""} disabled={ro} onChange={(e) => patch({ salesRotationSettings: { ...cfg.salesRotationSettings, maxOpenLeadsPerUser: e.target.value ? Number(e.target.value) : undefined } })} placeholder="No cap" className={inputCls} />
                </Field>
              </div>
            </div>
          </AdminCard>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <AdminCard id="routing-bdc" title="BDC fallback">
              <div className="space-y-3">
                <ToggleRow id="bdc-enabled" checked={!!cfg.bdcSettings?.enabled} disabled={ro} onChange={(v) => patch({ bdcSettings: { showBdcAsTeam: true, ...(cfg.bdcSettings || {}), enabled: v } })} label="Enable BDC" />
                <Field label="BDC phone"><input value={cfg.bdcSettings?.bdcPhone || ""} disabled={ro} onChange={(e) => patch({ bdcSettings: { enabled: false, showBdcAsTeam: true, ...(cfg.bdcSettings || {}), bdcPhone: e.target.value } })} className={inputCls} /></Field>
                <Field label="BDC email"><input type="email" value={cfg.bdcSettings?.bdcEmail || ""} disabled={ro} onChange={(e) => patch({ bdcSettings: { enabled: false, showBdcAsTeam: true, ...(cfg.bdcSettings || {}), bdcEmail: e.target.value } })} className={inputCls} /></Field>
              </div>
            </AdminCard>
            <AdminCard id="routing-manager" title="Manager fallback">
              <div className="space-y-3">
                <ToggleRow id="manager-enabled" checked={!!cfg.managerFallback?.enabled} disabled={ro} onChange={(v) => patch({ managerFallback: { ...(cfg.managerFallback || {}), enabled: v } })} label="Enable manager fallback" />
                <Field label="Manager phone"><input value={cfg.managerFallback?.managerPhone || ""} disabled={ro} onChange={(e) => patch({ managerFallback: { enabled: false, ...(cfg.managerFallback || {}), managerPhone: e.target.value } })} className={inputCls} /></Field>
                <Field label="Manager email"><input type="email" value={cfg.managerFallback?.managerEmail || ""} disabled={ro} onChange={(e) => patch({ managerFallback: { enabled: false, ...(cfg.managerFallback || {}), managerEmail: e.target.value } })} className={inputCls} /></Field>
              </div>
            </AdminCard>
          </div>

          <AdminCard id="routing-hours" title="Business hours and after-hours behavior" description="Outside these hours no one is shown as available; shoppers get the capture flow instead. Leave every day off if you do not want after-hours behavior.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
              {DAY_NAMES.map((dName, day) => {
                const block = cfg.businessHours.find((b) => b.dayOfWeek === day);
                return (
                  <div key={day} className="flex flex-wrap items-center gap-2">
                    <label className="w-16 flex items-center gap-1.5 text-[13px] font-semibold text-adm-ink cursor-pointer">
                      <input type="checkbox" checked={!!block} disabled={ro} onChange={(e) => setHours(day, "enabled", e.target.checked)} className="w-4 h-4 accent-[#2457D6]" /> {dName}
                    </label>
                    <span className="flex min-w-0 items-center gap-2 max-sm:gap-1.5">
                      <input type="time" aria-label={`${dName} opens`} value={block?.startTime || "09:00"} disabled={ro || !block} onChange={(e) => setHours(day, "startTime", e.target.value)} className="h-9 w-[110px] min-w-0 px-2 max-sm:px-1.5 rounded-[6px] border border-adm-border bg-adm-surface text-[13px] disabled:opacity-40" />
                      <span className="text-adm-muted text-[13px]">to</span>
                      <input type="time" aria-label={`${dName} closes`} value={block?.endTime || "19:00"} disabled={ro || !block} onChange={(e) => setHours(day, "endTime", e.target.value)} className="h-9 w-[110px] min-w-0 px-2 max-sm:px-1.5 rounded-[6px] border border-adm-border bg-adm-surface text-[13px] disabled:opacity-40" />
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <Field label="After-hours mode">
                <select value={cfg.afterHoursBehavior.mode} disabled={ro} onChange={(e) => patch({ afterHoursBehavior: { ...cfg.afterHoursBehavior, mode: e.target.value as CustomerPassportContactSettings["afterHoursBehavior"]["mode"] } })} className={selectCls}>
                  <option value="dealership_capture">Capture lead for next business day</option>
                  <option value="bdc_capture">Route to BDC</option>
                  <option value="schedule_only">Schedule only</option>
                  <option value="ai_assistant">AI assistant</option>
                  <option value="hide_agent_show_store">Hide agent, show store contact</option>
                </select>
              </Field>
              <Field label="After-hours message"><input value={cfg.afterHoursBehavior.message} disabled={ro} onChange={(e) => patch({ afterHoursBehavior: { ...cfg.afterHoursBehavior, message: e.target.value } })} className={inputCls} /></Field>
            </div>
          </AdminCard>
        </div>

        <div className="xl:sticky xl:top-4">
          <RoutingPreview routing={cfg} agents={agents} now={now} />
        </div>
      </div>

      <div className="mt-5 sticky bottom-0 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 py-4 xl:pt-2 xl:pb-[31px] bg-adm-surface border-t border-adm-border flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex items-baseline gap-x-5 gap-y-0 flex-wrap">
          <p className="text-[16px] leading-[22px] font-semibold text-adm-ink">Draft configuration</p>
          <p className={cn("text-[12px] leading-[18px]", statusDanger ? "text-adm-danger" : "text-adm-muted")} role="status">{status}</p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && phase !== "applying" && <AdminButton variant="ghost" onClick={api.discard}>Discard</AdminButton>}
          <AdminButton variant="primary" data-parity="review-changes" className="min-w-[149px]" disabled={!canReview} onClick={onReview}>Review changes</AdminButton>
        </div>
      </div>

      <RoutingReviewDialog api={api} open={open} onClose={closeReview} />
    </div>
  );
}
