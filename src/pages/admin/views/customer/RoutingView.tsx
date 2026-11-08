import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AdminButton } from "@/components/admin/v2/primitives";
import { AdminIcon, AdminIconTile, FieldRow, INPUT_CLASS, ScopeLabel, SectionCard, SelectField, StatusBadge, type AdminIconName } from "@/components/admin/v3/editor";
import { useAdminNow } from "@/lib/admin/dataSource";
import { deriveRoutingReadiness } from "@/lib/admin/effectivePolicy";
import { routingApplyGate } from "@/lib/admin/routingDraft";
import { adminTabHref } from "@/lib/admin/sections";
import type { ContactMode, PassportAgent } from "@/lib/passportRouting";
import { Banner } from "../brand/feeds/bits";
import { useSettingsEditor } from "../brand/feeds/useSettingsEditor";
import { ApplyChrome, Collapsible, LINK_ROW, LoadingBlock, PreviewLayout, TierBadge, ToggleRow, useToggleSet } from "./customerParts";
import {
  AfterHoursDrawer, blankPerson, CustomerPreview, EscalationDrawer, HoursEditor, PersonDrawer, RosterList, RotationDrawer, SimulationDrawer,
} from "./RoutingParts";
import {
  assembleRouting, describeRouting, hoursSummary, readRouting, ROUTING_LABELS, routingToPatch, sliceOf, tierRows, validateRouting, type RoutingDraft, type TierRow,
} from "./routingModel";

const OPTIONS = {
  read: readRouting,
  toPatch: routingToPatch,
  labels: ROUTING_LABELS,
  validate: validateRouting,
  describe: describeRouting,
  fixtureViewId: "routing",
};

const TIER_ICON: Record<TierRow["detailKey"], AdminIconName> = { crm: "user-check", assigned: "user", rotation: "users", bdc: "message", manager: "shield-check", store: "building" };
const TIER_SECTION: Record<TierRow["detailKey"], string> = { crm: "profile", assigned: "roster", rotation: "roster", bdc: "bdc", manager: "manager", store: "store" };
const TIER_HELP: Record<TierRow["detailKey"], string> = {
  crm: "The person already working this shopper in your CRM.",
  assigned: "The salesperson assigned to the vehicle.",
  rotation: "The next available person on the sales rotation.",
  bdc: "Your business development center.",
  manager: "A manager when nobody above can take it.",
  store: "The last step. It always has to work.",
};
const CHECK_LABEL_STATE: Record<string, [string, "enabled" | "setup_required" | "stale"]> = { ok: ["Ready", "enabled"], missing: ["Needs setup", "setup_required"], warning: ["Check", "stale"] };
const MODE_TEXT: Record<ContactMode, string> = { smart_routing: "Smart routing follows the order above", assigned_agent: "Assigned salesperson first, then the order above", bdc: "Everything goes to the BDC team", dealership_default: "Everything goes to the store contact" };

export default function RoutingView() {
  const ed = useSettingsEditor<RoutingDraft>(OPTIONS);
  const { edit, canEdit, settings } = ed;
  const now = new Date(useAdminNow());
  const sections = useToggleSet();
  const [drawer, setDrawer] = useState<null | "rotation" | "escalation" | "simulate" | "afterhours">(null);
  const [person, setPerson] = useState<{ agent: PassportAgent; existing: boolean } | null>(null);
  const draft = edit.draft;
  const baseline = edit.baseline;

  const slice = useMemo(() => (draft ? sliceOf(draft) : null), [draft]);
  const baseSlice = useMemo(() => (baseline ? sliceOf(baseline) : null), [baseline]);
  const gate = useMemo(() => (slice && baseSlice ? routingApplyGate(baseSlice, slice) : null), [slice, baseSlice]);
  const readiness = useMemo(() => (slice ? deriveRoutingReadiness(slice.routing, slice.agents) : null), [slice]);
  const tiers = useMemo(() => (slice ? tierRows(slice) : []), [slice]);
  const unknown = ed.unreadable;

  if (!draft || !slice || !readiness) return <LoadingBlock label="Loading contact and routing" />;

  const set = edit.set as <K extends keyof RoutingDraft>(k: K, v: RoutingDraft[K]) => void;
  const routing = assembleRouting(draft);
  const named = draft.agents.filter((a) => a.name.trim());
  const errors = edit.errors as Partial<Record<string, string>>;
  const gateForChrome = gate && !gate.ok && ed.dirty && !gate.reason?.startsWith("Nothing") ? { ok: false, reason: gate.reason } : undefined;
  const timezone = draft.timezone || undefined;
  const patchBdc = (p: Partial<NonNullable<RoutingDraft["bdcSettings"]>>) => set("bdcSettings", { enabled: false, showBdcAsTeam: true, ...(draft.bdcSettings ?? {}), ...p });
  const patchMgr = (p: Partial<NonNullable<RoutingDraft["managerFallback"]>>) => set("managerFallback", { enabled: false, ...(draft.managerFallback ?? {}), ...p });
  const rules = draft.escalationRules;
  const openFor = (t: TierRow) => {
    sections.show(TIER_SECTION[t.detailKey]);
    if (t.detailKey === "rotation") setDrawer("rotation");
    requestAnimationFrame(() => document.getElementById(`routing-${TIER_SECTION[t.detailKey]}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };
  const savePerson = (a: PassportAgent) => {
    const exists = draft.agents.some((x) => x.id === a.id);
    set("agents", exists ? draft.agents.map((x) => (x.id === a.id ? a : x)) : [...draft.agents, a]);
  };
  const dc = draft.dealershipDefaultContact;
  const storeMissing = !dc.salesPhone.trim() && !dc.salesEmail.trim();
  const dealerHours = (settings.dealer_hours ?? "") as string;
  const dealerTz = (settings.dealer_timezone ?? "") as string;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <ScopeLabel scope="all_rooftops" />
          <p className="text-[13px] leading-[18px] text-adm-muted">Routing is saved once for the account and applies to every rooftop.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <AdminButton variant="secondary" onClick={() => setDrawer("afterhours")}><AdminIcon name="clock" />After-hours preview</AdminButton>
          <AdminButton variant="secondary" onClick={() => setDrawer("simulate")}><AdminIcon name="route" />Simulate a route</AdminButton>
        </div>
      </div>

      {!canEdit && <Banner tone="neutral" icon="lock" title="You can view routing but not change it">Changing routing needs the manage settings permission. Ask an owner or manager to make the change. Everything below shows the saved configuration.</Banner>}
      {ed.unreadable && <Banner tone="danger" title="Routing could not be read">Nothing is shown as saved and nothing can be applied until settings load.</Banner>}

      <PreviewLayout previewLabel="Customer preview" preview={<CustomerPreview routing={routing} agents={named} now={now} timezone={timezone} />}>
      <div className="grid gap-4 items-start">
        <SectionCard icon="route" title="Routing order" description="Every customer request tries these six steps from the top. The first step that can take it wins.">
          <ol aria-label="Routing order" className="space-y-2">
            {tiers.map((t) => {
              const st = unknown ? "unknown" : t.state;
              return (
                <li key={t.key} data-tier={t.key} className="flex items-center gap-3 rounded-lg border border-adm-divider pl-3 pr-1 py-2 min-h-[64px]">
                  <span aria-hidden="true" className="max-sm:hidden w-7 h-7 rounded-full bg-adm-workspace text-adm-ink text-[13px] font-semibold inline-grid place-items-center flex-shrink-0">{t.step || "-"}</span>
                  <AdminIconTile name={TIER_ICON[t.detailKey]} tone="neutral" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{t.title}</p>
                    <p className="max-sm:hidden text-[13px] leading-[18px] text-adm-muted break-words">{t.note ?? (t.state === "needs_setup" || t.state === "off" ? t.ownerDetail : TIER_HELP[t.detailKey])}</p>
                    <p className="sm:hidden mt-0.5 flex items-center gap-2 text-[13px] leading-[18px] text-adm-muted"><span>Step {t.step || "-"}</span><TierBadge state={st} /></p>
                  </div>
                  <span className="max-sm:hidden"><TierBadge state={st} /></span>
                  <button type="button" aria-label={`Open ${t.title} settings`} onClick={() => openFor(t)} className="inline-grid place-items-center w-11 h-11 rounded-md text-adm-muted hover:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-adm-primary flex-shrink-0">
                    <AdminIcon name="chevron-right" />
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="text-[13px] leading-[18px] text-adm-muted">The order is set by the routing service and is not reordered here. {MODE_TEXT[draft.contactMode]}.</p>
        </SectionCard>

        <SectionCard icon="checklist" title="Readiness" description="What the draft needs before every route ends somewhere that works.">
          <ul aria-label="Readiness checks" className="divide-y divide-adm-divider rounded-lg border border-adm-divider">
            {readiness.checks.map((c) => {
              const [label, state] = unknown ? (["Unknown", "unknown"] as const) : CHECK_LABEL_STATE[c.state];
              return (
                <li key={c.key} className="flex items-start gap-3 px-3 py-2.5 min-h-[56px]">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{c.label}</p>
                    <p className="text-[13px] leading-[18px] text-adm-muted break-words">{unknown ? "Not available until settings load." : c.detail}</p>
                  </div>
                  <StatusBadge state={state} label={label} />
                </li>
              );
            })}
          </ul>
          {gate && !gate.ok && ed.dirty && <p role="alert" className="text-[14px] leading-[20px] font-medium text-adm-danger">{gate.reason}{gate.newBlockers.length ? ` ${gate.newBlockers.join(" ")}` : ""}</p>}
          <AdminButton variant="secondary" className="w-full sm:w-auto" onClick={() => setDrawer("escalation")}><AdminIcon name="bell" />Response and escalation rules</AdminButton>
        </SectionCard>
      </div>

      <div className="space-y-4">
        <Collapsible id="routing-profile" icon="user" title="Contact mode and profile" summary={`${MODE_TEXT[draft.contactMode]}. Agent profile ${draft.showAgentProfile ? "shown" : "hidden"}.`} open={sections.isOpen("profile")} onToggle={() => sections.toggle("profile")}>
          <FieldRow label="Contact mode" help="Smart routing tries CRM owner, assigned salesperson, rotation, BDC, manager, then the store.">
            {(p) => (
              <SelectField {...p} disabled={!canEdit} value={draft.contactMode} onChange={(e) => set("contactMode", e.target.value as ContactMode)}>
                <option value="smart_routing">Smart routing (recommended)</option>
                <option value="assigned_agent">Assigned salesperson first</option>
                <option value="bdc">BDC team</option>
                <option value="dealership_default">Store contact</option>
              </SelectField>
            )}
          </FieldRow>
          <ToggleRow label="Show the salesperson to shoppers" description="Off: requests still route to the person, but shoppers see neutral dealership wording." checked={draft.showAgentProfile} disabled={!canEdit} onChange={(v) => set("showAgentProfile", v)} />
          {draft.showAgentProfile && (
            <div className="space-y-3 rounded-lg border border-adm-divider p-4">
              <FieldRow label="Name shown">
                {(p) => (
                  <SelectField {...p} disabled={!canEdit} value={draft.agentDisplayRules.nameDisplay} onChange={(e) => set("agentDisplayRules", { ...draft.agentDisplayRules, nameDisplay: e.target.value as typeof draft.agentDisplayRules.nameDisplay })}>
                    <option value="first_name">First name only</option>
                    <option value="full_name">Full name</option>
                    <option value="team_only">Team only (hide the person)</option>
                  </SelectField>
                )}
              </FieldRow>
              <div className="grid gap-x-6 sm:grid-cols-2">
                {([["showPhoto", "Show photo"], ["showTitle", "Show title"], ["showAvailability", "Show availability"], ["showWorkingHours", "Show working hours"]] as const).map(([k, label]) => (
                  <ToggleRow key={k} label={label} checked={draft.agentDisplayRules[k]} disabled={!canEdit} onChange={(v) => set("agentDisplayRules", { ...draft.agentDisplayRules, [k]: v })} />
                ))}
              </div>
            </div>
          )}
        </Collapsible>

        <Collapsible id="routing-store" icon="building" title="Store fallback contact" summary={storeMissing ? "Missing. Add a phone or email before relying on any route." : [dc.salesPhone, dc.salesEmail].filter(Boolean).join(" | ")} status={storeMissing ? <StatusBadge state="setup_required" label="Needs setup" /> : undefined} open={sections.isOpen("store") || !!errors.dealershipDefaultContact} onToggle={() => sections.toggle("store")}>
          <p className="text-[14px] leading-[20px] text-adm-muted">The last step. Every route ends here when nothing else can take a request, so it needs at least a phone or an email.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="Main sales phone" error={storeMissing ? "Add a phone or an email." : null}>{(p) => <input {...p} inputMode="tel" className={INPUT_CLASS} disabled={!canEdit} value={dc.salesPhone} onChange={(e) => set("dealershipDefaultContact", { ...dc, salesPhone: e.target.value })} />}</FieldRow>
            <FieldRow label="Sales lead inbox" error={errors.dealershipDefaultContact}>{(p) => <input {...p} type="email" className={INPUT_CLASS} disabled={!canEdit} value={dc.salesEmail} onChange={(e) => set("dealershipDefaultContact", { ...dc, salesEmail: e.target.value })} />}</FieldRow>
          </div>
        </Collapsible>

        <Collapsible id="routing-roster" icon="users" title="Sales roster and rotation" summary={`${named.length} ${named.length === 1 ? "salesperson" : "salespeople"}. Rotation ${draft.salesRotationSettings.enabled ? "on" : "off"}.`} open={sections.isOpen("roster") || !!errors.agents || !!errors.salesRotationSettings} onToggle={() => sections.toggle("roster")}>
          {errors.agents && <p role="alert" className="text-[14px] font-medium text-adm-danger">{errors.agents}</p>}
          <RosterList agents={draft.agents} now={now} canEdit={canEdit} onEdit={(a) => setPerson({ agent: a, existing: true })} onAdd={() => setPerson({ agent: blankPerson(), existing: false })} />
          <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-adm-divider px-4 py-3">
            <p className="text-[14px] leading-[20px] text-adm-ink">Rotation is {draft.salesRotationSettings.enabled ? `on, ${draft.salesRotationSettings.method.replace(/_/g, " ")}` : "off"}.</p>
            <AdminButton variant="secondary" onClick={() => setDrawer("rotation")}>Rotation settings</AdminButton>
          </div>
          {errors.salesRotationSettings && <p role="alert" className="text-[14px] font-medium text-adm-danger">{errors.salesRotationSettings}</p>}
        </Collapsible>

        <Collapsible id="routing-bdc" icon="message" title="BDC" summary={draft.bdcSettings?.enabled ? [draft.bdcSettings.bdcPhone, draft.bdcSettings.bdcEmail].filter(Boolean).join(" | ") || "On, no destination" : "Off"} status={draft.bdcSettings?.enabled && !draft.bdcSettings.bdcPhone?.trim() && !draft.bdcSettings.bdcEmail?.trim() ? <StatusBadge state="setup_required" label="Needs setup" /> : undefined} open={sections.isOpen("bdc") || !!errors.bdcSettings} onToggle={() => sections.toggle("bdc")}>
          <ToggleRow label="BDC on" description="Fourth step, and the destination for BDC after-hours capture and escalation." checked={!!draft.bdcSettings?.enabled} disabled={!canEdit} onChange={(v) => patchBdc({ enabled: v })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="BDC phone" optional>{(p) => <input {...p} inputMode="tel" className={INPUT_CLASS} disabled={!canEdit} value={draft.bdcSettings?.bdcPhone ?? ""} onChange={(e) => patchBdc({ bdcPhone: e.target.value })} />}</FieldRow>
            <FieldRow label="BDC email" optional error={errors.bdcSettings} help="Escalation emails need an email address.">{(p) => <input {...p} type="email" className={INPUT_CLASS} disabled={!canEdit} value={draft.bdcSettings?.bdcEmail ?? ""} onChange={(e) => patchBdc({ bdcEmail: e.target.value })} />}</FieldRow>
          </div>
        </Collapsible>

        <Collapsible id="routing-manager" icon="shield-check" title="Manager fallback" summary={draft.managerFallback?.enabled ? [draft.managerFallback.managerPhone, draft.managerFallback.managerEmail].filter(Boolean).join(" | ") || "On, no recipient" : "Off"} status={draft.managerFallback?.enabled && !draft.managerFallback.managerPhone?.trim() && !draft.managerFallback.managerEmail?.trim() ? <StatusBadge state="setup_required" label="Needs setup" /> : undefined} open={sections.isOpen("manager") || !!errors.managerFallback} onToggle={() => sections.toggle("manager")}>
          <ToggleRow label="Manager fallback on" description="Fifth step, kept separate from the BDC. Also the second escalation recipient." checked={!!draft.managerFallback?.enabled} disabled={!canEdit} onChange={(v) => patchMgr({ enabled: v })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="Manager phone" optional>{(p) => <input {...p} inputMode="tel" className={INPUT_CLASS} disabled={!canEdit} value={draft.managerFallback?.managerPhone ?? ""} onChange={(e) => patchMgr({ managerPhone: e.target.value })} />}</FieldRow>
            <FieldRow label="Manager email" optional error={errors.managerFallback} help="Escalation emails need an email address.">{(p) => <input {...p} type="email" className={INPUT_CLASS} disabled={!canEdit} value={draft.managerFallback?.managerEmail ?? ""} onChange={(e) => patchMgr({ managerEmail: e.target.value })} />}</FieldRow>
          </div>
        </Collapsible>

        <Collapsible id="routing-hours" icon="clock" title="Hours and after-hours" summary={hoursSummary(draft.businessHours)} open={sections.isOpen("hours") || !!errors.businessHours} onToggle={() => sections.toggle("hours")}>
          {errors.businessHours && <p role="alert" className="text-[14px] font-medium text-adm-danger">{errors.businessHours}</p>}
          <HoursEditor draft={draft} set={set} canEdit={canEdit} storeHoursText={dealerHours} storeTimezone={dealerTz} />
          <div className="flex gap-2 flex-wrap">
            <AdminButton variant="secondary" onClick={() => setDrawer("afterhours")}>After-hours preview</AdminButton>
            <AdminButton variant="secondary" onClick={() => setDrawer("escalation")}>Escalation rules ({rules.enabled ? "on" : "off"})</AdminButton>
          </div>
        </Collapsible>

        <nav aria-label="Related customer settings" className="grid gap-2 sm:grid-cols-2">
          <Link to={adminTabHref("passport-modules")} className={LINK_ROW}>Passport modules and publishing<AdminIcon name="arrow-right" size="compact" /></Link>
          <Link to={adminTabHref("calls-to-action")} className={LINK_ROW}>Calls to action<AdminIcon name="arrow-right" size="compact" /></Link>
        </nav>
      </div>
      </PreviewLayout>

      <ApplyChrome
        api={ed}
        gate={gateForChrome}
        scope={<ScopeLabel scope="all_rooftops" />}
        timing="Takes effect for the next customer request. Requests already routed are not changed."
        impact={<p className="text-[14px] text-adm-muted">Only the settings listed change. The Passport reads the same two settings it reads today, and the order of the six steps is not touched.</p>}
      />

      <PersonDrawer person={person?.agent ?? null} existing={!!person?.existing} onClose={() => setPerson(null)} onSave={savePerson} onRemove={(id) => set("agents", draft.agents.filter((a) => a.id !== id))} />
      <RotationDrawer open={drawer === "rotation"} onClose={() => setDrawer(null)} draft={draft} set={set} canEdit={canEdit} rosterCount={named.filter((a) => a.acceptsPassportLeads && a.manualOverride !== "unavailable").length} />
      <EscalationDrawer open={drawer === "escalation"} onClose={() => setDrawer(null)} draft={draft} set={set} canEdit={canEdit} />
      <SimulationDrawer open={drawer === "simulate"} onClose={() => setDrawer(null)} routing={routing} agents={named} rotationState={settings.passport_rotation_state} now={now} timezone={timezone} />
      <AfterHoursDrawer open={drawer === "afterhours"} onClose={() => setDrawer(null)} routing={routing} agents={named} now={now} timezone={timezone} />
    </div>
  );
}
