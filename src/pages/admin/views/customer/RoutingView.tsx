import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Clock, Headset, Plus, ShieldCheck, Trash2, User, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminButton, AdminCard, AdminTable, InlineNote, SectionTitle, StatusChip, Td, Th } from "@/components/admin/v2/primitives";
import { SummaryList } from "@/components/detail/parts";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import { namedAgents, routingOrderRows, type RoutingOrderRow } from "@/lib/admin/routingDraft";
import type { ContactMode, CustomerPassportContactSettings, PassportAgent, RoutingPriorityItem } from "@/lib/passportRouting";
import { useRoutingDraft } from "./useRoutingDraft";
import { RoutingPreview } from "./RoutingPreview";
import { RoutingReviewDialog } from "./RoutingReviewDialog";
import { DAY_NAMES, Field, ToggleRow, inputCls, newAgent, selectCls } from "./controls";

// Contact & Routing (reference 08). The order list and the readiness rail
// describe the draft exactly as the resolver and the readiness rule read it;
// every control from the legacy Lead Routing panel sits below the fold and
// edits the same draft. Nothing is saved until Review & Apply.

const READINESS_META: Record<string, { icon: LucideIcon; href: string; description: string }> = {
  default_contact: { icon: User, href: "#routing-default-contact", description: "Store contact for unassigned requests." },
  sales_rotation: { icon: Users, href: "#routing-rotation", description: "At least two salespeople required." },
  manager_recipient: { icon: ShieldCheck, href: "#routing-manager", description: "Manager for escalations." },
  bdc_destination: { icon: Headset, href: "#routing-bdc", description: "BDC destination for routing and escalation." },
  after_hours: { icon: Clock, href: "#routing-hours", description: "Handle requests outside business hours." },
  escalation: { icon: Bell, href: ADMIN_CHILD_ROUTES.escalation, description: "Every escalation tier needs a destination." },
};

const MODE_LABEL: Record<ContactMode, string> = {
  smart_routing: "Smart routing",
  assigned_agent: "the assigned agent",
  bdc: "the BDC team",
  dealership_default: "the store contact",
};

const minutesLabel = (v: number | undefined | null, off: string): string => (v && v > 0 ? `${v} ${v === 1 ? "minute" : "minutes"}` : off);

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
  const smart = cfg.contactMode === "smart_routing";

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

  const blockers = readiness.checks.filter((c) => c.state === "missing");
  const hoursLine = (day: number) => {
    const b = cfg.businessHours.find((x) => x.dayOfWeek === day);
    return b ? `${b.startTime} to ${b.endTime}` : "Closed";
  };
  const statusChip = (st: RoutingOrderRow["state"]) =>
    st === "ok" ? <StatusChip tone="success">Active</StatusChip> : st === "off" ? <StatusChip tone="neutral">Disabled</StatusChip> : <StatusChip tone="warning">Incomplete</StatusChip>;

  return (
    <div>
      {ro && <InlineNote tone="info" title="View only." className="mb-4">Your role can see routing but cannot change it. Ask an administrator for changes.</InlineNote>}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
        <AdminCard
          inset="sm"
          flush
          title="Lead routing rules (in order)"
          action={<ToggleRow compact id="smart-routing" label="Smart routing" checked={smart} onChange={setSmart} disabled={ro} switchSize="routing" />}
        >
          <AdminTable caption="Lead routing rules" minWidth={640} className={cn(!smart && "opacity-60")}>
            <thead>
              <tr>
                <Th className="w-12">#</Th>
                <Th>Condition</Th>
                <Th>Recipients</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} data-landmark="order-row">
                  <Td className="tabular-nums text-adm-muted">{r.step}</Td>
                  <Td className="font-medium">{r.title}</Td>
                  <Td className="max-w-[260px] truncate text-adm-muted">{r.owner}{r.ownerDetail ? `, ${r.ownerDetail.toLowerCase()}` : ""}</Td>
                  <Td>{statusChip(r.state)}</Td>
                  <Td align="right"><a href={`#${r.anchor}`} aria-label={`Edit ${r.title}`} className="font-semibold text-adm-primary hover:underline">Edit</a></Td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
          {!smart && (
            <p className="px-4 py-3 text-[12px] leading-[18px] text-adm-muted" role="status">
              Smart routing is off. Every request goes to {MODE_LABEL[cfg.contactMode]}. The order above applies when it is on.
            </p>
          )}
        </AdminCard>

        <div className="flex flex-col gap-4">
          <AdminCard inset="sm" title="Routing settings" action={<Link to={ADMIN_CHILD_ROUTES.escalation} className="text-[14px] font-semibold text-adm-primary hover:underline">Review escalation rules</Link>}>
            <SummaryList
              rows={[
                ...(cfg.businessHours.length === 0
                  ? [{ label: "Business hours", value: "Not set" }]
                  : DAY_NAMES.map((d, i) => ({ label: d, value: hoursLine(i) })).filter((_, i) => cfg.businessHours.some((b) => b.dayOfWeek === i))),
                { label: "First response", value: rules.enabled ? minutesLabel(rules.firstResponseSlaMinutes, "Not set") : "Off" },
                { label: "Route to BDC", value: rules.enabled ? minutesLabel(rules.escalateToBdcAfterMinutes ?? rules.firstResponseSlaMinutes, "Off") : "Off" },
                { label: "Route to manager", value: rules.enabled ? minutesLabel(rules.escalateToManagerAfterMinutes, "Off") : "Off" },
              ]}
              dense
            />
          </AdminCard>
          <section data-landmark="readiness-list" aria-label="Routing blockers" className={cn("rounded-[6px] border px-4 py-3", blockers.length ? "border-[#F3B4AE] bg-adm-danger-bg" : "border-adm-border bg-adm-surface")}>
            <h3 className={cn("text-[16px] leading-[22px] font-semibold", blockers.length ? "text-adm-danger" : "text-adm-ink")}>Routing blockers</h3>
            {blockers.length === 0 ? (
              <p className="mt-1 text-[13px] leading-[18px] text-adm-muted">No blockers. Every step that is on has a recipient.</p>
            ) : (
              <ul className="mt-1 text-[13px] leading-[18px] text-adm-ink">
                {blockers.map((c) => {
                  const meta = READINESS_META[c.key];
                  return (
                    <li key={c.key} className="flex items-baseline justify-between gap-3 py-0.5">
                      <span className="min-w-0 truncate">{c.label}: {meta?.description ?? c.detail}</span>
                      {meta?.href.startsWith("#") ? <a href={meta.href} className="font-semibold text-adm-primary hover:underline">Review</a> : <Link to={meta?.href ?? ADMIN_CHILD_ROUTES.escalation} className="font-semibold text-adm-primary hover:underline">Review</Link>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
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
          <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">Draft configuration</p>
          <p className={cn("text-[12px] leading-[18px]", statusDanger ? "text-adm-danger" : "text-adm-muted")} role="status">{status}</p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && phase !== "applying" && <AdminButton variant="secondary" onClick={api.discard}>Discard</AdminButton>}
          <AdminButton variant="primary" data-parity="review-changes" className="min-w-[149px]" disabled={!canReview} onClick={onReview}>Review changes</AdminButton>
        </div>
      </div>

      <RoutingReviewDialog api={api} open={open} onClose={closeReview} />
    </div>
  );
}
