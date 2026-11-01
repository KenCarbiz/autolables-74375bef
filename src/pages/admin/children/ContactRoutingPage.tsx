import { Link } from "react-router-dom";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useViewFixture } from "@/lib/admin/dataSource";
import { adminTabHref } from "@/lib/admin/sections";
import { normalizeContactRouting, type PassportAgent } from "@/lib/passportRouting";
import type { RoutingFixture } from "@/pages/admin/views/customer/useRoutingDraft";
import { Al97Frame, Banner, Card, Flow, Glyph, KeyVals, Savebar, useFixtureCopy, type FlowItem } from "@/components/admin/al97/al97ui";

// Contact & routing, read-only. Routing is stored once per account, so the
// scope is the whole account, never one store. The preview resolves the
// saved settings in the browser and never sends a message; edits happen on
// the Contact & Routing tab through its Review & Apply flow.

const ROUTING_TAB = adminTabHref("routing");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const filled = (v: string | null | undefined): v is string => !!v && v.trim() !== "";

export function hoursLabel(blocks: Array<{ dayOfWeek: number; startTime: string; endTime: string }>): string {
  if (!blocks.length) return "Not configured";
  const days = [...new Set(blocks.map((b) => b.dayOfWeek))].sort((a, b) => a - b);
  const same = blocks.every((b) => b.startTime === blocks[0].startTime && b.endTime === blocks[0].endTime);
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  const span = contiguous && days.length > 1 ? `${DAYS[days[0]]}–${DAYS[days[days.length - 1]]}` : days.map((d) => DAYS[d]).join(", ");
  return same ? `${span} ${blocks[0].startTime}–${blocks[0].endTime}` : `${days.length} days configured`;
}

const Switch = ({ on, label }: { on: boolean; label: string }) => (
  <span role="img" aria-label={`${label}: ${on ? "on" : "off"}`} className={`switch ${on ? "on" : ""}`} />
);

export default function ContactRoutingPage() {
  const fx = useViewFixture<RoutingFixture & { account?: string; store?: string | null }>("routing");
  const copy = useFixtureCopy();
  const { settings } = useDealerSettings();
  const { tenant, currentStore, stores } = useTenant();
  const cfg = normalizeContactRouting(fx ? fx.routing : settings.passport_contact_routing);
  const agents: PassportAgent[] = (fx ? fx.agents : settings.passport_agents) ?? [];
  const rooftops = fx ? fx.stores.length : stores?.length ?? 0;
  const account = fx?.account ?? tenant?.name ?? "This account";
  const scopeLabel = { account, store: fx ? fx.store ?? null : currentStore?.name ?? null };

  const dc = cfg.dealershipDefaultContact;
  const hasDefault = filled(dc.salesPhone) || filled(dc.salesEmail);
  const available = agents.filter((a) => filled(a.name) && a.acceptsPassportLeads !== false && a.manualOverride !== "unavailable");
  const mgr = cfg.managerFallback;
  const mgrRecipient = filled(mgr?.managerEmail) || filled(mgr?.managerPhone);
  const whole = rooftops > 1 ? `Whole account (${rooftops} rooftops)` : "Whole account";
  const scope = scopeLabel.store ? `${whole}, not ${scopeLabel.store} only` : whole;

  const steps: FlowItem[] = [
    available.length
      ? { no: 1, title: "Assigned agent", chip: { label: `${available.length} available`, tone: "green" }, note: cfg.salesRotationSettings.enabled ? "Rotation picks among them" : "Rotation off" }
      : { no: 1, title: "Assigned agent", chip: { label: "None on file", tone: "amber" }, note: copy("routing.noAgent", "No salesperson can receive leads") },
    hasDefault
      ? { no: 2, title: "Store fallback", chip: { label: "Set", tone: "green" }, note: "Account contact receives it" }
      : { no: 2, title: "Store fallback", chip: { label: "Missing", tone: "red" }, note: "Delivery blocked" },
    !mgr?.enabled
      ? { no: 3, title: "Manager escalation", chip: { label: "Off", tone: "neutral" }, note: mgrRecipient ? "Not enabled" : "Needs recipient" }
      : mgrRecipient
        ? { no: 3, title: "Manager escalation", chip: { label: "On", tone: "green" }, note: "Recipient set" }
        : { no: 3, title: "Manager escalation", chip: { label: "Missing", tone: "red" }, note: "Needs recipient" },
  ];
  const deliverable = hasDefault || available.length > 0;
  const timezone = cfg.timezone || settings.dealer_timezone || "Not configured";
  const afterHours = cfg.afterHoursBehavior.mode === "dealership_capture" || cfg.afterHoursBehavior.mode === "hide_agent_show_store"
    ? (hasDefault ? "Account contact" : "Not configured")
    : cfg.afterHoursBehavior.mode === "bdc_capture" ? (filled(cfg.bdcSettings?.bdcEmail) || filled(cfg.bdcSettings?.bdcPhone) ? "BDC team" : "Not configured")
      : cfg.afterHoursBehavior.mode.replace(/_/g, " ");

  const main = (
    <div className="work">
      {hasDefault
        ? <Banner tone="blue" icon="info" title="Unassigned enquiries have a destination" detail="The account contact receives enquiries no salesperson can take. Delivery is still unverified until a captured test." />
        : <Banner tone="amber" icon="warning" title="Unassigned enquiries have no configured destination" detail="Add a store sales phone or email before enabling this route." />}
      <div className="split">
        <div><div>
          <Card id="cr-destinations" title="Store destinations">
            <div className="fields">
              <div className="field"><span>Sales phone</span><div className="input" aria-readonly="true">{filled(dc.salesPhone) ? dc.salesPhone : "Not configured"}</div><small>Validated number; no guessed store phone.</small></div>
              <div className="field"><span>Sales email</span><div className="input" aria-readonly="true">{filled(dc.salesEmail) ? dc.salesEmail : "Not configured"}</div><small>Required fallback recipient.</small></div>
            </div>
            <div className="toggle-row"><div><strong>Smart routing</strong><p>Use an assigned salesperson, then this store’s fallback.</p></div><Switch on={cfg.contactMode === "smart_routing"} label="Smart routing" /></div>
            <div className="toggle-row"><div><strong>Respect CRM owner</strong><p>Only when the CRM owner has a verified usable destination.</p></div><Switch on={!!cfg.salesRotationSettings.respectCrmOwnership} label="Respect CRM owner" /></div>
          </Card>
        </div></div>
        <div><div>
          <Card id="cr-preview" title="Routing preview">
            <Flow steps={steps} />
            <KeyVals rows={[
              ["Outcome", deliverable ? <span className="chip blue">Configured, not tested</span> : <span className="chip red">Not deliverable</span>],
              ["Scope", scope],
              ["Test message", "Not sent"],
            ]} />
          </Card>
        </div></div>
      </div>
      <Card id="cr-hours" title="Hours & escalation">
        <div className="fields">
          <div className="field"><span>Timezone</span><div className="input" aria-readonly="true">{timezone} ▾<Glyph name="chevron" /></div></div>
          <div className="field"><span>Business hours</span><div className="input" aria-readonly="true">{hoursLabel(cfg.businessHours)}</div></div>
          <div className="field"><span>After-hours destination</span><div className="input" aria-readonly="true">{afterHours}</div></div>
          <div className="field"><span>Response target</span><div className="input" aria-readonly="true">{cfg.escalationRules.enabled ? `${cfg.escalationRules.firstResponseSlaMinutes} minutes` : "Off"}</div></div>
        </div>
        <p className="fine">Display hours and routing hours are distinct; show their sources and differences explicitly.</p>
      </Card>
      <Savebar title="No changes pending" detail="Phone/email delivery needs a synthetic end-to-end test with captured messages."
        action={<button type="button" className="btn primary" disabled title="This page is read-only. Edit routing on Contact & Routing, which reviews every change before applying it.">Review changes</button>} />
    </div>
  );
  return (
    <Al97Frame section="customer-experience" trail={[{ label: "Customer Experience", to: ROUTING_TAB }]} crumb="Contact & routing" title="Contact & routing" subtitle={`${scopeLabel.store ?? account} · destinations for the whole account`} scopeLabel={scopeLabel} main={main}>
      <p className="mt-4 text-[13px] text-adm-muted">Edit destinations, rotation and escalation on <Link to={ROUTING_TAB} className="font-semibold text-adm-primary hover:underline">Contact & Routing</Link>.</p>
    </Al97Frame>
  );
}
