import { useMemo, useState } from "react";
import { AdminButton } from "@/components/admin/v2/primitives";
import {
  AdminIcon, AdminIconTile, BlockedFeatureNotice, DetailDrawer, EditorEmpty, FieldRow, IconButton, INPUT_CLASS, PreviewOnlyNotice, SectionCard, SelectField, StatusBadge, type StatusState,
} from "@/components/admin/v3/editor";
import { cn } from "@/lib/utils";
import { adminTabHref } from "@/lib/admin/sections";
import { emailEnabled, notificationMethodRows, withEmailMethod } from "@/lib/admin/routingDraft";
import { isAgentAvailable, closedPillCopy, type CustomerPassportContactSettings, type PassportAgent, type WorkingHoursBlock } from "@/lib/passportRouting";
import {
  escalationPlanOf, findSampleTime, formatInstant, hoursSummary, reasonText, simulateRoute, TIER_NAME, traceTiers, US_TIME_ZONES, type RoutingDraft,
} from "./routingModel";
import { OwnerLink, ToggleRow } from "./customerParts";
import { newAgent } from "./controls";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const isEmailish = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

export const agentAvailability = (a: PassportAgent, now: Date): { state: StatusState; label: string } => {
  if (!a.acceptsPassportLeads) return { state: "disabled", label: "Not receiving leads" };
  if (a.manualOverride === "unavailable") return { state: "disabled", label: "Paused" };
  if (!isAgentAvailable(a, now)) return { state: "unavailable", label: a.status === "offline" || a.status === "away" ? (a.status === "away" ? "Away" : "Offline") : "Unavailable now" };
  return { state: "enabled", label: "Available" };
};

export function RosterList({ agents, now, canEdit, onEdit, onAdd }: { agents: PassportAgent[]; now: Date; canEdit: boolean; onEdit: (a: PassportAgent) => void; onAdd: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[14px] leading-[20px] text-adm-muted">People who can receive passport leads. Logins are managed in <OwnerLink to={adminTabHref("team")}>People & Access</OwnerLink>.</p>
        <AdminButton variant="secondary" disabled={!canEdit} onClick={onAdd}><AdminIcon name="plus" />Add salesperson</AdminButton>
      </div>
      {agents.length === 0 ? (
        <EditorEmpty artwork="activity" title="No salespeople on the roster" description="Smart routing skips the rotation and the assigned-salesperson steps until someone is added. The BDC, manager and store contact still work." />
      ) : (
        <ul aria-label="Salespeople" className="divide-y divide-adm-divider rounded-lg border border-adm-divider">
          {agents.map((a) => {
            const av = agentAvailability(a, now);
            return (
              <li key={a.id} className="flex items-center gap-3 px-3 py-2 min-h-[56px]">
                <AdminIconTile name="user" tone="neutral" />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] leading-[20px] font-semibold text-adm-ink truncate">{a.name || "Unnamed"}</p>
                  <p className="text-[13px] leading-[18px] text-adm-muted truncate">{[a.title, a.phone || a.email].filter(Boolean).join(" | ") || "No contact details"}</p>
                </div>
                <StatusBadge state={av.state} label={av.label} className="hidden sm:inline-flex" />
                <IconButton name="edit" label={`Edit ${a.name || "salesperson"}`} disabled={!canEdit} onClick={() => onEdit(a)} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function PersonDrawer({ person, existing, onClose, onSave, onRemove }: { person: PassportAgent | null; existing: boolean; onClose: () => void; onSave: (a: PassportAgent) => void; onRemove: (id: string) => void }) {
  const [form, setForm] = useState<PassportAgent | null>(person);
  const [seen, setSeen] = useState<PassportAgent | null>(person);
  if (person !== seen) { setSeen(person); setForm(person); }
  const f = form;
  const set = (p: Partial<PassportAgent>) => setForm((x) => (x ? { ...x, ...p } : x));
  const nameError = f && !f.name.trim() ? "Enter a name." : null;
  const emailError = f?.email && !isEmailish(f.email) ? "Enter a valid email address." : null;
  const invalid = !!nameError || !!emailError;
  return (
    <DetailDrawer
      open={!!person}
      onClose={onClose}
      title={existing ? "Edit salesperson" : "Add salesperson"}
      description="Changes join the draft. Nothing is saved until you review and apply."
      footer={f ? (
        <>
          {existing && <AdminButton variant="danger" onClick={() => { onRemove(f.id); onClose(); }}>Remove</AdminButton>}
          <AdminButton variant="secondary" onClick={onClose}>Cancel</AdminButton>
          <AdminButton variant="primary" disabled={invalid} onClick={() => { onSave({ ...f, name: f.name.trim() }); onClose(); }}>{existing ? "Update draft" : "Add to draft"}</AdminButton>
        </>
      ) : undefined}
    >
      {f && (
        <div className="space-y-4">
          <FieldRow label="Name" required error={nameError}>{(p) => <input {...p} className={INPUT_CLASS} value={f.name} onChange={(e) => set({ name: e.target.value })} />}</FieldRow>
          <FieldRow label="Title" optional>{(p) => <input {...p} className={INPUT_CLASS} value={f.title ?? ""} onChange={(e) => set({ title: e.target.value })} />}</FieldRow>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="Phone" optional>{(p) => <input {...p} inputMode="tel" className={INPUT_CLASS} value={f.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} />}</FieldRow>
            <FieldRow label="Text number" optional>{(p) => <input {...p} inputMode="tel" className={INPUT_CLASS} value={f.smsNumber ?? ""} onChange={(e) => set({ smsNumber: e.target.value })} />}</FieldRow>
          </div>
          <FieldRow label="Email" optional error={emailError}>{(p) => <input {...p} type="email" className={INPUT_CLASS} value={f.email ?? ""} onChange={(e) => set({ email: e.target.value })} />}</FieldRow>
          <FieldRow label="Availability" help="Paused keeps the person on the roster but never routes to them.">
            {(p) => (
              <SelectField {...p} value={f.manualOverride === "unavailable" ? "unavailable" : f.status} onChange={(e) => {
                const v = e.target.value;
                if (v === "unavailable") set({ manualOverride: "unavailable" });
                else set({ manualOverride: null, status: v as PassportAgent["status"] });
              }}>
                <option value="available">Available</option>
                <option value="busy">Busy</option>
                <option value="away">Away</option>
                <option value="offline">Offline</option>
                <option value="unavailable">Paused (manual)</option>
              </SelectField>
            )}
          </FieldRow>
          <ToggleRow label="Receives passport leads" description="Off keeps the record but removes the person from every routing step." checked={f.acceptsPassportLeads} onChange={(v) => set({ acceptsPassportLeads: v })} />
        </div>
      )}
    </DetailDrawer>
  );
}

export const blankPerson = () => newAgent();

export function RotationDrawer({ open, onClose, draft, set, canEdit, rosterCount }: { open: boolean; onClose: () => void; draft: RoutingDraft; set: <K extends keyof RoutingDraft>(k: K, v: RoutingDraft[K]) => void; canEdit: boolean; rosterCount: number }) {
  const r = draft.salesRotationSettings;
  const patch = (p: Partial<typeof r>) => set("salesRotationSettings", { ...r, ...p });
  return (
    <DetailDrawer open={open} onClose={onClose} title="Sales rotation" description="Used by the third step when no CRM owner or assigned salesperson can take the request." footer={<AdminButton variant="primary" onClick={onClose}>Done</AdminButton>}>
      <div className="space-y-4">
        <ToggleRow label="Rotation on" description={r.enabled ? `${rosterCount} ${rosterCount === 1 ? "person" : "people"} can receive rotated leads.` : "Off: the rotation step is skipped."} checked={r.enabled} disabled={!canEdit} onChange={(v) => patch({ enabled: v })} />
        <FieldRow label="Method" help="Weighted uses the same pick as least recent until per-person weights exist.">
          {(p) => (
            <SelectField {...p} value={r.method} disabled={!canEdit} onChange={(e) => patch({ method: e.target.value as typeof r.method })}>
              <option value="round_robin">Round robin</option>
              <option value="least_recent">Least recent</option>
              <option value="weighted">Weighted</option>
            </SelectField>
          )}
        </FieldRow>
        <ToggleRow label="Only available people" description="Skips anyone who is off, paused, away or outside their own hours." checked={r.onlyAvailableUsers} disabled={!canEdit} onChange={(v) => patch({ onlyAvailableUsers: v })} />
        <ToggleRow label="Respect CRM ownership" description="A returning shopper stays with the person already working their lead." checked={r.respectCrmOwnership} disabled={!canEdit} onChange={(v) => patch({ respectCrmOwnership: v })} />
        <FieldRow label="Max open leads per person" optional help="Empty means no cap.">
          {(p) => <input {...p} type="number" min={0} step={1} inputMode="numeric" className={INPUT_CLASS} disabled={!canEdit} value={r.maxOpenLeadsPerUser ?? ""} onChange={(e) => patch({ maxOpenLeadsPerUser: e.target.value === "" ? undefined : Number(e.target.value) })} />}
        </FieldRow>
      </div>
    </DetailDrawer>
  );
}

export function EscalationDrawer({ open, onClose, draft, set, canEdit }: { open: boolean; onClose: () => void; draft: RoutingDraft; set: <K extends keyof RoutingDraft>(k: K, v: RoutingDraft[K]) => void; canEdit: boolean }) {
  const rules = draft.escalationRules;
  const patch = (p: Partial<typeof rules>) => set("escalationRules", { ...rules, ...p });
  const routing = useMemo(() => ({ ...draft } as unknown as CustomerPassportContactSettings), [draft]);
  const plan = escalationPlanOf(routing);
  const methods = notificationMethodRows(rules);
  const num = (v: string): number | undefined => (v === "" ? undefined : Number(v));
  return (
    <DetailDrawer open={open} onClose={onClose} title="Response and escalation" description="How long a request can go unanswered before it moves to the BDC and then the manager." footer={<AdminButton variant="primary" onClick={onClose}>Done</AdminButton>}>
      <div className="space-y-4">
        <ToggleRow label="Escalation on" description={rules.enabled ? "Unanswered requests move up in the order below." : "Off: nothing is escalated."} checked={rules.enabled} disabled={!canEdit} onChange={(v) => patch({ enabled: v })} />
        <div className="grid gap-4 sm:grid-cols-3">
          <FieldRow label="First response (min)" required={rules.enabled} error={rules.enabled && !(Number(rules.firstResponseSlaMinutes) > 0) ? "Use 1 or more." : null}>
            {(p) => <input {...p} type="number" min={1} inputMode="numeric" className={INPUT_CLASS} disabled={!canEdit || !rules.enabled} value={rules.firstResponseSlaMinutes ?? ""} onChange={(e) => patch({ firstResponseSlaMinutes: Number(e.target.value) })} />}
          </FieldRow>
          <FieldRow label="To BDC after (min)" optional>
            {(p) => <input {...p} type="number" min={0} inputMode="numeric" className={INPUT_CLASS} disabled={!canEdit || !rules.enabled} value={rules.escalateToBdcAfterMinutes ?? ""} onChange={(e) => patch({ escalateToBdcAfterMinutes: num(e.target.value) })} />}
          </FieldRow>
          <FieldRow label="To manager after (min)" optional>
            {(p) => <input {...p} type="number" min={0} inputMode="numeric" className={INPUT_CLASS} disabled={!canEdit || !rules.enabled} value={rules.escalateToManagerAfterMinutes ?? ""} onChange={(e) => patch({ escalateToManagerAfterMinutes: num(e.target.value) })} />}
          </FieldRow>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-[14px] leading-[20px] font-semibold text-adm-ink">Notification methods</legend>
          {methods.map((m) => (
            <ToggleRow key={m.key} label={m.label} description={m.supported ? m.detail : "Not supported by the current sender, so it is never used."} checked={m.enabled} disabled={!canEdit || !m.supported || !rules.enabled} badge={!m.supported ? <StatusBadge state="unavailable" /> : undefined} onChange={(v) => patch(withEmailMethod(rules, v))} />
          ))}
        </fieldset>
        <div>
          <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">Where each step sends</p>
          {!plan.enabled ? (
            <p className="mt-1 text-[13px] leading-[18px] text-adm-muted">Escalation is off.</p>
          ) : (
            <ul className="mt-2 divide-y divide-adm-divider rounded-lg border border-adm-divider">
              {plan.tiers.map((t) => (
                <li key={t.key} className="flex items-start gap-3 px-3 py-2.5">
                  <AdminIcon name={t.to ? "check-circle" : "alert"} className={t.to ? "text-adm-success mt-0.5" : "text-adm-warning mt-0.5"} />
                  <div className="min-w-0 text-[14px] leading-[20px]">
                    <p className="font-medium text-adm-ink">{t.label} after {t.afterMinutes} min</p>
                    <p className="text-[13px] leading-[18px] text-adm-muted break-words">{t.to ? `Emails ${t.to}` : "No valid email address, so this step never sends. Add one in the section for this step."}</p>
                  </div>
                </li>
              ))}
              {plan.tiers.length === 0 && <li className="px-3 py-2.5 text-[13px] text-adm-muted">No step has a time set.</li>}
            </ul>
          )}
          {!emailEnabled(rules) && rules.enabled && <p role="status" className="mt-2 text-[13px] leading-[18px] text-adm-warning">Email notifications are off, so no escalation message can be sent.</p>}
        </div>
      </div>
    </DetailDrawer>
  );
}

export function HoursEditor({ draft, set, canEdit, storeHoursText, storeTimezone }: { draft: RoutingDraft; set: <K extends keyof RoutingDraft>(k: K, v: RoutingDraft[K]) => void; canEdit: boolean; storeHoursText: string; storeTimezone: string }) {
  const blocks = draft.businessHours;
  const setDay = (day: number, p: Partial<WorkingHoursBlock> | null) => {
    const rest = blocks.filter((b) => b.dayOfWeek !== day);
    if (p === null) return set("businessHours", rest);
    const cur = blocks.find((b) => b.dayOfWeek === day) ?? { dayOfWeek: day, startTime: "09:00", endTime: "19:00" };
    set("businessHours", [...rest, { ...cur, ...p }].sort((a, b) => a.dayOfWeek - b.dayOfWeek));
  };
  const tz = draft.timezone ?? "";
  const known = US_TIME_ZONES.some(([z]) => z === tz);
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-adm-divider p-4 space-y-3">
        <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">Where hours come from today</p>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[200px_1fr] text-[14px] leading-[20px]">
          <dt className="text-adm-muted">Routing hours (used by routing)</dt>
          <dd className="min-w-0 break-words">{hoursSummary(blocks)}</dd>
          <dt className="text-adm-muted">Store hours text (display only)</dt>
          <dd className="min-w-0 break-words">{storeHoursText.trim() || "Not set"}</dd>
          <dt className="text-adm-muted">Store time zone</dt>
          <dd className="min-w-0 break-words">{storeTimezone.trim() || "Not set"}</dd>
        </dl>
        <p className="text-[13px] leading-[18px] text-adm-muted">Routing reads only the routing hours below. The store hours text is shown to shoppers but routing does not parse it. Edit store hours in <OwnerLink to={adminTabHref("hours-contact")}>Hours & Contact</OwnerLink>.</p>
        <BlockedFeatureNotice migrationId="20261114000000" feature="Shared structured store hours">
          <p className="text-[13px] leading-[18px] text-adm-muted">Until that update is applied, the routing hours below stay as the only override. Nothing here is borrowed from Hours & Contact.</p>
        </BlockedFeatureNotice>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-[14px] leading-[20px] font-semibold text-adm-ink">Routing hours</legend>
        <p className="text-[13px] leading-[18px] text-adm-muted">Leave every day off to treat the store as always open. Outside these hours shoppers get the after-hours behavior below.</p>
        <ul className="divide-y divide-adm-divider rounded-lg border border-adm-divider">
          {DAYS.map((name, day) => {
            const b = blocks.find((x) => x.dayOfWeek === day);
            const bad = !!b && b.startTime >= b.endTime;
            return (
              <li key={day} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5">
                <div className="w-[170px] max-sm:w-full"><ToggleRow label={name} checked={!!b} disabled={!canEdit} onChange={(on) => setDay(day, on ? {} : null)} description={b ? undefined : "Closed"} /></div>
                {b && (
                  <div className="flex items-center gap-2 min-w-0 pb-1 sm:pb-0">
                    <input type="time" aria-label={`${name} opens`} className={cn(INPUT_CLASS, "w-[130px]")} disabled={!canEdit} value={b.startTime} aria-invalid={bad || undefined} onChange={(e) => setDay(day, { startTime: e.target.value })} />
                    <span className="text-[14px] text-adm-muted">to</span>
                    <input type="time" aria-label={`${name} closes`} className={cn(INPUT_CLASS, "w-[130px]")} disabled={!canEdit} value={b.endTime} aria-invalid={bad || undefined} onChange={(e) => setDay(day, { endTime: e.target.value })} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>

      <FieldRow label="Routing time zone" optional help={tz ? "Hours are evaluated in this time zone." : "Not set: hours are evaluated in the routing service's own time zone, which may not be the store's. Set it so hours match the store."}>
        {(p) => (
          <SelectField {...p} disabled={!canEdit} value={tz} onChange={(e) => set("timezone", e.target.value || undefined)}>
            <option value="">Not set</option>
            {!known && tz && <option value={tz}>{tz}</option>}
            {US_TIME_ZONES.map(([z, label]) => <option key={z} value={z}>{label} ({z})</option>)}
          </SelectField>
        )}
      </FieldRow>

      <div className="grid gap-4 sm:grid-cols-2">
        <FieldRow label="After-hours behavior">
          {(p) => (
            <SelectField {...p} disabled={!canEdit} value={draft.afterHoursBehavior.mode} onChange={(e) => set("afterHoursBehavior", { ...draft.afterHoursBehavior, mode: e.target.value as CustomerPassportContactSettings["afterHoursBehavior"]["mode"] })}>
              <option value="dealership_capture">Capture the lead for the next business day</option>
              <option value="bdc_capture">Route to the BDC</option>
              <option value="schedule_only">Schedule only</option>
              <option value="ai_assistant">AI assistant</option>
              <option value="hide_agent_show_store">Hide the person, show the store</option>
            </SelectField>
          )}
        </FieldRow>
        <FieldRow label="After-hours message">
          {(p) => <input {...p} className={INPUT_CLASS} disabled={!canEdit} value={draft.afterHoursBehavior.message} onChange={(e) => set("afterHoursBehavior", { ...draft.afterHoursBehavior, message: e.target.value })} />}
        </FieldRow>
      </div>
      {draft.afterHoursBehavior.mode === "bdc_capture" && !draft.bdcSettings?.enabled && (
        <p role="status" className="text-[13px] leading-[18px] text-adm-warning">BDC capture needs the BDC turned on. Until then after-hours requests go to the store contact.</p>
      )}
    </div>
  );
}

export function SimulationDrawer({ open, onClose, routing, agents, rotationState, now, timezone }: { open: boolean; onClose: () => void; routing: CustomerPassportContactSettings; agents: PassportAgent[]; rotationState?: Record<string, string>; now: Date; timezone?: string }) {
  const roster = agents.filter((a) => a.name.trim());
  const [assigned, setAssigned] = useState("");
  const [owner, setOwner] = useState("");
  const [when, setWhen] = useState<"now" | "open" | "closed">("now");
  const sample = useMemo(() => (when === "now" ? now : findSampleTime(routing.businessHours, timezone, when === "open", now)), [when, now, routing.businessHours, timezone]);
  const input = useMemo(() => (sample ? { routing, agents, assignedAgentId: assigned || null, crmOwnerAgentId: owner || null, now: sample, rotationState } : null), [sample, routing, agents, assigned, owner, rotationState]);
  const result = input ? simulateRoute(input) : null;
  const trace = input ? traceTiers(input) : [];
  const idOptions = (
    <>
      <option value="">None</option>
      {roster.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      <option value="__other_account__">A user from another account</option>
    </>
  );
  return (
    <DetailDrawer open={open} onClose={onClose} title="Route simulation" description="Runs your draft through the same resolver the public Passport uses." footer={<AdminButton variant="primary" onClick={onClose}>Close</AdminButton>}>
      <div className="space-y-4">
        <PreviewOnlyNotice>This simulation sends no message, creates no lead and changes no rotation memory.</PreviewOnlyNotice>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Salesperson assigned to the vehicle">{(p) => <SelectField {...p} value={assigned} onChange={(e) => setAssigned(e.target.value)}>{idOptions}</SelectField>}</FieldRow>
          <FieldRow label="CRM owner of the shopper">{(p) => <SelectField {...p} value={owner} onChange={(e) => setOwner(e.target.value)}>{idOptions}</SelectField>}</FieldRow>
        </div>
        <FieldRow label="When" help={when !== "now" && !sample ? "No routing hours are set, so there is no closed time to try." : sample ? `Using ${formatInstant(sample, timezone)}.` : undefined}>
          {(p) => (
            <SelectField {...p} value={when} onChange={(e) => setWhen(e.target.value as typeof when)}>
              <option value="now">Now</option>
              <option value="open">A time inside routing hours</option>
              <option value="closed">A time outside routing hours</option>
            </SelectField>
          )}
        </FieldRow>
        {result ? (
          <div className="space-y-4" aria-live="polite">
            <div className="rounded-lg border border-adm-divider p-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge state="enabled" label={`Goes to ${TIER_NAME[result.routingTargetType]}`} />
                {result.afterHours && <StatusBadge state="stale" label="After hours" />}
              </div>
              <p className="text-[14px] leading-[20px] text-adm-ink">{reasonText(result.routingReason)}</p>
              <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-[14px] leading-[20px]">
                <dt className="text-adm-muted">Shopper sees</dt><dd className="min-w-0 break-words">{result.displayName}</dd>
                <dt className="text-adm-muted">Buttons</dt><dd className="min-w-0 break-words">{result.callLabel} and {result.contactLabel}</dd>
                <dt className="text-adm-muted">Phone</dt><dd className="min-w-0 break-words">{result.phone ?? "None"}</dd>
                <dt className="text-adm-muted">Email</dt><dd className="min-w-0 break-words">{result.email ?? "None"}</dd>
              </dl>
              {assigned === "__other_account__" || owner === "__other_account__" ? <p className="text-[13px] leading-[18px] text-adm-muted">A user who is not on this account's roster is never routed to, so that step is skipped.</p> : null}
            </div>
            <div>
              <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">Each step on its own</p>
              {result.afterHours && <p className="mt-1 text-[13px] leading-[18px] text-adm-muted">Outside routing hours the live-person steps are skipped and the after-hours behavior decides.</p>}
              <ol className="mt-2 divide-y divide-adm-divider rounded-lg border border-adm-divider">
                {trace.map((t, i) => (
                  <li key={t.tier} className="flex items-center gap-3 px-3 py-2 min-h-[44px] text-[14px] leading-[20px]">
                    <span className="w-6 text-adm-muted tabular-nums">{i + 1}</span>
                    <span className="flex-1 min-w-0">{t.name}</span>
                    <StatusBadge state={t.takes ? "enabled" : "unavailable"} label={t.takes ? "Could take it" : "Skipped"} />
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ) : (
          <EditorEmpty artwork="search" title="Nothing to simulate for that time" description="Add routing hours first, then choose a time outside them." />
        )}
      </div>
    </DetailDrawer>
  );
}

export function AfterHoursDrawer({ open, onClose, routing, agents, now, timezone }: { open: boolean; onClose: () => void; routing: CustomerPassportContactSettings; agents: PassportAgent[]; now: Date; timezone?: string }) {
  const roster = agents.filter((a) => a.name.trim());
  const closedAt = useMemo(() => findSampleTime(routing.businessHours, timezone, false, now), [routing.businessHours, timezone, now]);
  const openAt = useMemo(() => findSampleTime(routing.businessHours, timezone, true, now), [routing.businessHours, timezone, now]);
  const assigned = roster.find((a) => isAgentAvailable(a, openAt ?? now))?.id ?? null;
  const side = (at: Date | null) => (at ? simulateRoute({ routing, agents, assignedAgentId: assigned, now: at }) : null);
  const open_ = side(openAt);
  const closed = side(closedAt);
  const Card = ({ title, at, r }: { title: string; at: Date | null; r: ReturnType<typeof side> }) => (
    <div className="rounded-lg border border-adm-divider p-4 space-y-2 min-w-0">
      <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{title}</p>
      {at && r ? (
        <>
          <p className="text-[13px] leading-[18px] text-adm-muted">{formatInstant(at, timezone)}</p>
          <p className="text-[14px] leading-[20px] text-adm-ink break-words">{r.afterHours ? "We're closed right now." : r.displayName}</p>
          <p className="text-[13px] leading-[18px] text-adm-muted break-words">{r.afterHours ? r.afterHoursMessage : r.displaySubtitle}</p>
          <p className="text-[13px] leading-[18px] text-adm-ink">Pill: {closedPillCopy(r).title}</p>
          <p className="text-[13px] leading-[18px] text-adm-muted">Buttons: {r.callLabel} and {r.contactLabel}</p>
          <p className="text-[13px] leading-[18px] text-adm-muted">Goes to {TIER_NAME[r.routingTargetType]}</p>
        </>
      ) : <p className="text-[13px] leading-[18px] text-adm-muted">Add routing hours to preview this state.</p>}
    </div>
  );
  return (
    <DetailDrawer open={open} onClose={onClose} title="After-hours preview" description="The same request, once inside and once outside your routing hours." footer={<AdminButton variant="primary" onClick={onClose}>Close</AdminButton>}>
      <div className="space-y-4">
        <PreviewOnlyNotice>Previews your draft with the shared resolver. It sends nothing.</PreviewOnlyNotice>
        <Card title="Open" at={openAt} r={open_} />
        <Card title="Closed" at={closedAt} r={closed} />
      </div>
    </DetailDrawer>
  );
}

export function CustomerPreview({ routing, agents, now, timezone }: { routing: CustomerPassportContactSettings; agents: PassportAgent[]; now: Date; timezone?: string }) {
  const [profile, setProfile] = useState<"assigned" | "generic">("assigned");
  const [hours, setHours] = useState<"open" | "closed">("open");
  const roster = agents.filter((a) => a.name.trim());
  const at = findSampleTime(routing.businessHours, timezone, hours === "open", now);
  const person = at ? roster.find((a) => isAgentAvailable(a, at)) : undefined;
  const r = at ? simulateRoute({ routing: { ...routing, showAgentProfile: profile === "assigned" }, agents, assignedAgentId: person?.id ?? null, now: at }) : null;
  const tab = (id: "assigned" | "generic" | "open" | "closed", label: string, on: boolean, pick: () => void) => (
    <button key={id} type="button" aria-pressed={on} onClick={pick} className={cn("min-h-[44px] sm:min-h-[40px] px-3 rounded-md text-[14px] font-medium border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary", on ? "bg-adm-selected border-adm-primary text-adm-primary" : "bg-adm-surface border-adm-border text-adm-ink hover:bg-adm-workspace")}>{label}</button>
  );
  return (
    <SectionCard icon="eye" title="Customer preview" description="What a shopper sees in the Passport contact area for this draft.">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Profile">
        {tab("assigned", "Assigned profile", profile === "assigned", () => setProfile("assigned"))}
        {tab("generic", "Generic", profile === "generic", () => setProfile("generic"))}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Store state">
        {tab("open", "Open", hours === "open", () => setHours("open"))}
        {tab("closed", "Closed", hours === "closed", () => setHours("closed"))}
      </div>
      {r ? (
        <div className="rounded-xl bg-[#2563EB] text-white p-4 space-y-3" data-preview-surface="">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-full bg-white/15 inline-grid place-items-center flex-shrink-0"><AdminIcon name={r.afterHours ? "clock" : r.displayMode === "agent" ? "user" : "users"} size="control" /></span>
            <div className="min-w-0">
              <p className="text-[14px] leading-[20px] font-bold break-words">{r.afterHours ? "We're closed right now." : r.displayName}</p>
              <p className="text-[13px] leading-[18px] text-white/85 break-words">{r.afterHours ? r.afterHoursMessage : r.displaySubtitle}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <span className="min-h-[44px] rounded-lg bg-white/15 border border-white/40 text-[13px] font-bold inline-flex items-center justify-center text-center px-2">{r.callLabel}</span>
            <span className="min-h-[44px] rounded-lg bg-white/15 border border-white/40 text-[13px] font-bold inline-flex items-center justify-center text-center px-2">{r.contactLabel}</span>
          </div>
        </div>
      ) : <p className="text-[13px] leading-[18px] text-adm-muted">Add routing hours to preview the closed state.</p>}
      {profile === "assigned" && !person && at && <p className="text-[13px] leading-[18px] text-adm-muted" role="status">No salesperson is available at that time, so the shopper sees the store contact.</p>}
      <p className="text-[13px] leading-[18px] text-adm-muted">Draft preview. Not what shoppers see until you apply.</p>
    </SectionCard>
  );
}
