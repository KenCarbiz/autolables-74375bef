import { useMemo, useState } from "react";
import { useDealerSettings, type DealerSettings } from "@/contexts/DealerSettingsContext";
import { toast } from "sonner";
import { Save, Plus, Trash2, Phone, MessageSquare, ShieldCheck, RefreshCw, Users, Clock, Headset } from "lucide-react";
import {
  resolveCustomerPassportRouting, closedPillCopy, normalizeContactRouting,
  type CustomerPassportContactSettings, type PassportAgent, type ContactMode, type RoutingPriorityItem,
} from "@/lib/passportRouting";

// Dealer admin: Customer Passport Contact Routing. Controls who shoppers
// reach when they reserve, value a trade, or ask for help on the passport.
// The shopper-facing UI never exposes this machinery — the live preview
// shows exactly what they'll see for the current configuration.

const inputCls = "mt-1 w-full h-10 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary";
const selectCls = inputCls;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const Toggle = ({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) => (
  <label className="flex items-start gap-2.5 cursor-pointer select-none">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 w-4 h-4 accent-blue-600" />
    <span><span className="text-[13px] font-semibold text-foreground block leading-tight">{label}</span>{hint && <span className="text-[11px] text-slate-400">{hint}</span>}</span>
  </label>
);

const newAgent = (): PassportAgent => ({
  id: `agent_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  name: "", title: "Vehicle Specialist", phone: "", smsNumber: "", email: "",
  status: "available", acceptsPassportLeads: true, workingHours: [],
});

const PRIORITY_LABEL: Record<RoutingPriorityItem, string> = {
  crm_owner: "Existing CRM lead owner",
  vehicle_assigned_agent: "Vehicle-assigned salesperson",
  available_sales_rotation: "Available salesperson rotation",
  bdc: "BDC queue",
  sales_manager: "Sales manager",
  dealership_default: "Dealership default",
};

const PassportContactRoutingPanel = () => {
  const { settings, updateSettings } = useDealerSettings();
  const [cfg, setCfg] = useState<CustomerPassportContactSettings>(() => normalizeContactRouting(settings.passport_contact_routing));
  const [agents, setAgents] = useState<PassportAgent[]>(() => settings.passport_agents || []);
  const [saving, setSaving] = useState(false);
  const [previewMode, setPreviewMode] = useState<"current" | ContactMode>("current");
  const [previewOpen, setPreviewOpen] = useState(true);

  const patch = (p: Partial<CustomerPassportContactSettings>) => setCfg((c) => ({ ...c, ...p }));
  const patchAgent = (i: number, p: Partial<PassportAgent>) => setAgents((a) => a.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const save = async () => {
    setSaving(true);
    const ok = await updateSettings({
      passport_contact_routing: cfg,
      passport_agents: agents.filter((a) => a.name.trim()),
    } as Partial<DealerSettings>);
    setSaving(false);
    if (ok !== false) toast.success("Contact routing saved");
  };

  // Live preview: run the real resolver against the draft.
  const preview = useMemo(() => {
    const draft = previewMode === "current" ? cfg : { ...cfg, contactMode: previewMode };
    const pool = agents.filter((a) => a.name.trim());
    return resolveCustomerPassportRouting(draft, {
      agents: pool,
      assignedAgentId: pool[0]?.id ?? null,
      now: new Date(),
    });
  }, [cfg, agents, previewMode]);
  const pill = closedPillCopy(preview);
  const PreviewHelpIcon = preview.afterHours ? Clock : preview.displayMode === "team" ? Headset : Users;

  const setHours = (day: number, field: "startTime" | "endTime" | "enabled", value: string | boolean) => {
    setCfg((c) => {
      const rest = c.businessHours.filter((b) => b.dayOfWeek !== day);
      const existing = c.businessHours.find((b) => b.dayOfWeek === day);
      if (field === "enabled") {
        return { ...c, businessHours: value ? [...rest, existing ?? { dayOfWeek: day, startTime: "09:00", endTime: "19:00" }] : rest };
      }
      if (!existing) return c;
      return { ...c, businessHours: [...rest, { ...existing, [field]: value }] };
    });
  };

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[22px] font-bold tracking-tight text-foreground">Customer Passport Contact Routing</h2>
          <p className="text-sm text-slate-500 mt-1">Control who shoppers reach when they reserve, value a trade, or ask for help. Shoppers only ever see Reserve · Trade · Talk to us — you decide who gets the lead.</p>
        </div>
        <button onClick={save} disabled={saving} className="shrink-0 inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          {/* Mode + profile */}
          <div className="rounded-2xl border border-border bg-card p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[13px] font-semibold text-foreground">Contact mode</label>
              <select value={cfg.contactMode} onChange={(e) => patch({ contactMode: e.target.value as ContactMode })} className={selectCls}>
                <option value="smart_routing">Smart Routing — recommended</option>
                <option value="assigned_agent">Assigned Agent</option>
                <option value="bdc">BDC Team</option>
                <option value="dealership_default">Dealership Default</option>
              </select>
              <p className="text-[11px] text-slate-400 mt-1">Smart Routing tries: CRM owner → assigned agent → rotation → BDC → manager → store.</p>
            </div>
            <div className="space-y-3 pt-1">
              <Toggle checked={cfg.showAgentProfile} onChange={(v) => patch({ showAgentProfile: v })} label="Show agent profile to shoppers" hint="Off: leads still route to the person, but shoppers see neutral dealership language." />
            </div>
            {cfg.showAgentProfile && (
              <>
                <div>
                  <label className="text-[13px] font-semibold text-foreground">Agent name display</label>
                  <select value={cfg.agentDisplayRules.nameDisplay} onChange={(e) => patch({ agentDisplayRules: { ...cfg.agentDisplayRules, nameDisplay: e.target.value as "first_name" | "full_name" | "team_only" } })} className={selectCls}>
                    <option value="first_name">First name only</option>
                    <option value="full_name">Full name</option>
                    <option value="team_only">Team only (hide the person)</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Toggle checked={cfg.agentDisplayRules.showPhoto} onChange={(v) => patch({ agentDisplayRules: { ...cfg.agentDisplayRules, showPhoto: v } })} label="Show photo" />
                  <Toggle checked={cfg.agentDisplayRules.showTitle} onChange={(v) => patch({ agentDisplayRules: { ...cfg.agentDisplayRules, showTitle: v } })} label="Show title" />
                  <Toggle checked={cfg.agentDisplayRules.showAvailability} onChange={(v) => patch({ agentDisplayRules: { ...cfg.agentDisplayRules, showAvailability: v } })} label="Show availability" />
                  <Toggle checked={cfg.agentDisplayRules.showWorkingHours} onChange={(v) => patch({ agentDisplayRules: { ...cfg.agentDisplayRules, showWorkingHours: v } })} label="Show working hours" />
                </div>
              </>
            )}
          </div>

          {/* Dealership default contact */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <h3 className="text-[14px] font-bold text-foreground">Dealership default contact</h3>
            <p className="text-[12px] text-slate-500 mt-0.5 mb-3">The guaranteed fallback — every routing path ends here if nothing else is available.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[13px] font-semibold text-foreground">Main sales phone</label>
                <input value={cfg.dealershipDefaultContact.salesPhone} onChange={(e) => patch({ dealershipDefaultContact: { ...cfg.dealershipDefaultContact, salesPhone: e.target.value } })} placeholder="(860) 555-1212" className={inputCls} />
              </div>
              <div>
                <label className="text-[13px] font-semibold text-foreground">Sales lead inbox</label>
                <input value={cfg.dealershipDefaultContact.salesEmail} onChange={(e) => patch({ dealershipDefaultContact: { ...cfg.dealershipDefaultContact, salesEmail: e.target.value } })} placeholder="sales@yourdealership.com" className={inputCls} />
              </div>
            </div>
          </div>

          {/* Agents roster */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[14px] font-bold text-foreground">Sales team roster</h3>
                <p className="text-[12px] text-slate-500 mt-0.5">Who can receive passport leads. Unavailable people are never shown or assigned.</p>
              </div>
              <button onClick={() => setAgents((a) => [...a, newAgent()])} className="inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-border text-[13px] font-semibold hover:border-blue-500"><Plus className="w-4 h-4" /> Add</button>
            </div>
            <div className="mt-3 space-y-3">
              {agents.length === 0 && <p className="text-[13px] text-slate-400">No agents yet — Smart Routing will use BDC / dealership fallbacks.</p>}
              {agents.map((a, i) => (
                <div key={a.id} className="rounded-xl border border-border p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                  <div className="col-span-2"><label className="text-[11px] font-semibold text-slate-500">Name</label><input value={a.name} onChange={(e) => patchAgent(i, { name: e.target.value })} placeholder="Sarah Miller" className={inputCls} /></div>
                  <div className="col-span-2"><label className="text-[11px] font-semibold text-slate-500">Title</label><input value={a.title || ""} onChange={(e) => patchAgent(i, { title: e.target.value })} className={inputCls} /></div>
                  <div><label className="text-[11px] font-semibold text-slate-500">Phone</label><input value={a.phone || ""} onChange={(e) => patchAgent(i, { phone: e.target.value })} className={inputCls} /></div>
                  <div><label className="text-[11px] font-semibold text-slate-500">Text number</label><input value={a.smsNumber || ""} onChange={(e) => patchAgent(i, { smsNumber: e.target.value })} className={inputCls} /></div>
                  <div className="col-span-2"><label className="text-[11px] font-semibold text-slate-500">Email</label><input value={a.email || ""} onChange={(e) => patchAgent(i, { email: e.target.value })} className={inputCls} /></div>
                  <div><label className="text-[11px] font-semibold text-slate-500">Status</label>
                    <select value={a.manualOverride === "unavailable" ? "unavailable" : a.status} onChange={(e) => {
                      const v = e.target.value;
                      if (v === "unavailable") patchAgent(i, { manualOverride: "unavailable" });
                      else patchAgent(i, { manualOverride: null, status: v as PassportAgent["status"] });
                    }} className={selectCls}>
                      <option value="available">Available</option><option value="busy">Busy</option><option value="away">Away</option><option value="offline">Offline</option><option value="unavailable">Paused (manual)</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Toggle checked={a.acceptsPassportLeads} onChange={(v) => patchAgent(i, { acceptsPassportLeads: v })} label="Passport leads" />
                    <button onClick={() => setAgents((arr) => arr.filter((_, j) => j !== i))} aria-label="Remove agent" className="w-9 h-9 rounded-lg border border-border text-slate-400 hover:text-red-500 hover:border-red-300 inline-flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Rotation */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <h3 className="text-[14px] font-bold text-foreground">Salesperson rotation</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
              <div className="space-y-3">
                <Toggle checked={cfg.salesRotationSettings.enabled} onChange={(v) => patch({ salesRotationSettings: { ...cfg.salesRotationSettings, enabled: v } })} label="Enable rotation" />
                <Toggle checked={cfg.salesRotationSettings.onlyAvailableUsers} onChange={(v) => patch({ salesRotationSettings: { ...cfg.salesRotationSettings, onlyAvailableUsers: v } })} label="Only available users" hint="Never assign a lead to someone who is off, paused, or outside working hours." />
                <Toggle checked={cfg.salesRotationSettings.respectCrmOwnership} onChange={(v) => patch({ salesRotationSettings: { ...cfg.salesRotationSettings, respectCrmOwnership: v } })} label="Respect CRM ownership" hint="A returning shopper stays with the person already working their lead." />
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[13px] font-semibold text-foreground">Method</label>
                  <select value={cfg.salesRotationSettings.method} onChange={(e) => patch({ salesRotationSettings: { ...cfg.salesRotationSettings, method: e.target.value as "round_robin" | "weighted" | "least_recent" } })} className={selectCls}>
                    <option value="round_robin">Round robin</option>
                    <option value="least_recent">Least recent</option>
                    <option value="weighted">Weighted (uses least-recent until weights exist)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[13px] font-semibold text-foreground">Max open leads per person</label>
                  <input type="number" min={0} value={cfg.salesRotationSettings.maxOpenLeadsPerUser ?? ""} onChange={(e) => patch({ salesRotationSettings: { ...cfg.salesRotationSettings, maxOpenLeadsPerUser: e.target.value ? Number(e.target.value) : undefined } })} placeholder="No cap" className={inputCls} />
                </div>
              </div>
            </div>
          </div>

          {/* BDC + Manager fallback */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <h3 className="text-[14px] font-bold text-foreground">BDC fallback</h3>
              <Toggle checked={!!cfg.bdcSettings?.enabled} onChange={(v) => patch({ bdcSettings: { showBdcAsTeam: true, ...(cfg.bdcSettings || {}), enabled: v } })} label="Enable BDC" />
              <div><label className="text-[11px] font-semibold text-slate-500">BDC phone</label><input value={cfg.bdcSettings?.bdcPhone || ""} onChange={(e) => patch({ bdcSettings: { enabled: false, showBdcAsTeam: true, ...(cfg.bdcSettings || {}), bdcPhone: e.target.value } })} className={inputCls} /></div>
              <div><label className="text-[11px] font-semibold text-slate-500">BDC email</label><input value={cfg.bdcSettings?.bdcEmail || ""} onChange={(e) => patch({ bdcSettings: { enabled: false, showBdcAsTeam: true, ...(cfg.bdcSettings || {}), bdcEmail: e.target.value } })} className={inputCls} /></div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <h3 className="text-[14px] font-bold text-foreground">Manager fallback</h3>
              <Toggle checked={!!cfg.managerFallback?.enabled} onChange={(v) => patch({ managerFallback: { ...(cfg.managerFallback || {}), enabled: v } })} label="Enable manager fallback" />
              <div><label className="text-[11px] font-semibold text-slate-500">Manager phone</label><input value={cfg.managerFallback?.managerPhone || ""} onChange={(e) => patch({ managerFallback: { enabled: false, ...(cfg.managerFallback || {}), managerPhone: e.target.value } })} className={inputCls} /></div>
              <div><label className="text-[11px] font-semibold text-slate-500">Manager email</label><input value={cfg.managerFallback?.managerEmail || ""} onChange={(e) => patch({ managerFallback: { enabled: false, ...(cfg.managerFallback || {}), managerEmail: e.target.value } })} className={inputCls} /></div>
            </div>
          </div>

          {/* Business hours + after hours */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <h3 className="text-[14px] font-bold text-foreground">Business hours & after-hours behavior</h3>
            <p className="text-[12px] text-slate-500 mt-0.5 mb-3">Outside these hours no one is shown as "Available now" — shoppers get the capture flow instead. Leave every day off if you don't want after-hours behavior.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
              {DAY_NAMES.map((dName, day) => {
                const block = cfg.businessHours.find((b) => b.dayOfWeek === day);
                return (
                  <div key={day} className="flex items-center gap-2">
                    <label className="w-16 flex items-center gap-1.5 text-[13px] font-semibold cursor-pointer"><input type="checkbox" checked={!!block} onChange={(e) => setHours(day, "enabled", e.target.checked)} className="w-4 h-4 accent-blue-600" /> {dName}</label>
                    <input type="time" value={block?.startTime || "09:00"} disabled={!block} onChange={(e) => setHours(day, "startTime", e.target.value)} className="h-9 px-2 rounded-lg border border-border bg-background text-sm disabled:opacity-40" />
                    <span className="text-slate-400 text-sm">–</span>
                    <input type="time" value={block?.endTime || "19:00"} disabled={!block} onChange={(e) => setHours(day, "endTime", e.target.value)} className="h-9 px-2 rounded-lg border border-border bg-background text-sm disabled:opacity-40" />
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="text-[13px] font-semibold text-foreground">After-hours mode</label>
                <select value={cfg.afterHoursBehavior.mode} onChange={(e) => patch({ afterHoursBehavior: { ...cfg.afterHoursBehavior, mode: e.target.value as CustomerPassportContactSettings["afterHoursBehavior"]["mode"] } })} className={selectCls}>
                  <option value="dealership_capture">Capture lead for next business day</option>
                  <option value="bdc_capture">Route to BDC</option>
                  <option value="schedule_only">Schedule only</option>
                  <option value="ai_assistant">AI assistant</option>
                  <option value="hide_agent_show_store">Hide agent, show store contact</option>
                </select>
              </div>
              <div>
                <label className="text-[13px] font-semibold text-foreground">After-hours message</label>
                <input value={cfg.afterHoursBehavior.message} onChange={(e) => patch({ afterHoursBehavior: { ...cfg.afterHoursBehavior, message: e.target.value } })} className={inputCls} />
              </div>
            </div>
          </div>

          {/* Escalation */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <h3 className="text-[14px] font-bold text-foreground">Response SLA & escalation</h3>
            <p className="text-[12px] text-slate-500 mt-0.5 mb-3">Unanswered passport leads escalate automatically. Requires the passport-lead-escalation function on a schedule.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-3"><Toggle checked={cfg.escalationRules.enabled} onChange={(v) => patch({ escalationRules: { ...cfg.escalationRules, enabled: v } })} label="Enable escalation" /></div>
              <div><label className="text-[11px] font-semibold text-slate-500">First response SLA (min)</label><input type="number" min={1} value={cfg.escalationRules.firstResponseSlaMinutes} onChange={(e) => patch({ escalationRules: { ...cfg.escalationRules, firstResponseSlaMinutes: Number(e.target.value) || 5 } })} className={inputCls} /></div>
              <div><label className="text-[11px] font-semibold text-slate-500">Escalate to BDC after (min)</label><input type="number" min={0} value={cfg.escalationRules.escalateToBdcAfterMinutes ?? ""} onChange={(e) => patch({ escalationRules: { ...cfg.escalationRules, escalateToBdcAfterMinutes: e.target.value ? Number(e.target.value) : undefined } })} className={inputCls} /></div>
              <div><label className="text-[11px] font-semibold text-slate-500">Escalate to manager after (min)</label><input type="number" min={0} value={cfg.escalationRules.escalateToManagerAfterMinutes ?? ""} onChange={(e) => patch({ escalationRules: { ...cfg.escalationRules, escalateToManagerAfterMinutes: e.target.value ? Number(e.target.value) : undefined } })} className={inputCls} /></div>
            </div>
          </div>

          {/* Priority order (read-only list for now) */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <h3 className="text-[14px] font-bold text-foreground">Smart Routing priority</h3>
            <ol className="mt-2 space-y-1.5">
              {cfg.routingPriority.map((p, i) => (
                <li key={p} className="flex items-center gap-2 text-[13px]"><span className="w-5 h-5 rounded-md bg-blue-50 text-[#2563EB] text-[11px] font-bold flex items-center justify-center">{i + 1}</span>{PRIORITY_LABEL[p]}</li>
              ))}
            </ol>
          </div>
        </div>

        {/* Live preview */}
        <div className="lg:sticky lg:top-4 space-y-3">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[14px] font-bold text-foreground">Live preview</h3>
              <select value={previewMode} onChange={(e) => setPreviewMode(e.target.value as typeof previewMode)} className="h-9 px-2 rounded-lg border border-border bg-background text-[12px]">
                <option value="current">Current settings</option>
                <option value="smart_routing">Smart Routing</option>
                <option value="assigned_agent">Assigned Agent</option>
                <option value="bdc">BDC Team</option>
                <option value="dealership_default">Dealership Default</option>
              </select>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Exactly what the shopper sees. Routed to: {preview.routingTargetType.replace(/_/g, " ")}{preview.afterHours ? " · after hours" : ""}</p>

            {/* Closed pill */}
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mt-4 mb-1.5">Closed state</p>
            <div className="h-14 pl-4 pr-5 rounded-full text-white inline-flex items-center gap-2.5 shadow-lg" style={{ background: "linear-gradient(160deg,#2563EB 0%,#1e50c8 100%)" }}>
              {preview.displayMode === "agent" && preview.agentPhotoUrl && !preview.afterHours ? <img src={preview.agentPhotoUrl} alt="" className="w-8 h-8 rounded-full object-cover ring-2 ring-white/40" /> : <ShieldCheck className="w-5 h-5 shrink-0" />}
              <span className="text-left leading-tight"><span className="block text-[13px] font-extrabold">{pill.title}</span><span className="block text-[11px] opacity-85">{pill.sub}</span></span>
            </div>

            {/* Opened modal */}
            <div className="flex items-center justify-between mt-4 mb-1.5">
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Opened state</p>
              <button onClick={() => setPreviewOpen((o) => !o)} className="text-[11px] font-semibold text-[#2563EB]">{previewOpen ? "Hide" : "Show"}</button>
            </div>
            {previewOpen && (
              <div className="rounded-2xl p-4 text-white" style={{ background: preview.afterHours ? "linear-gradient(160deg,#1e3a8a 0%,#172d6e 100%)" : "linear-gradient(160deg,#2563EB 0%,#1e50c8 100%)" }}>
                <p className="text-[15px] font-extrabold leading-tight text-center">{preview.afterHours ? "We're closed right now." : "Ready to take the next step?"}</p>
                <p className="text-[10px] opacity-90 text-center mt-0.5">{preview.afterHours ? "Send us a message and our team will follow up as soon as we open." : "Choose the option that works best for you."}</p>
                <div className="mt-3 w-full rounded-xl bg-white text-[#2563EB] px-3 py-2.5 flex items-center gap-2"><ShieldCheck className="w-4 h-4" /><span className="text-[12px] font-extrabold">Reserve This Vehicle</span></div>
                <div className="mt-2 w-full rounded-xl bg-white/10 border border-white/40 px-3 py-2.5 flex items-center gap-2"><RefreshCw className="w-4 h-4" /><span className="text-[12px] font-extrabold">Get a Trade Appraisal</span></div>
                <div className="mt-3 pt-3 border-t border-white/20">
                  <div className="flex items-center gap-2.5">
                    {preview.displayMode === "agent" && preview.agentPhotoUrl && !preview.afterHours
                      ? <img src={preview.agentPhotoUrl} alt="" className="w-9 h-9 rounded-full object-cover ring-2 ring-white/40" />
                      : <span className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center"><PreviewHelpIcon className="w-4 h-4" /></span>}
                    <div className="min-w-0">
                      <p className="text-[12px] font-bold leading-tight">{preview.afterHours ? "We'll follow up as soon as we open." : preview.displayName}</p>
                      <p className="text-[10px] opacity-80 leading-tight">{preview.afterHours ? preview.afterHoursMessage : preview.displaySubtitle}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2.5">
                    <span className="h-8 rounded-lg bg-white/15 border border-white/40 text-[11px] font-bold inline-flex items-center justify-center gap-1"><Phone className="w-3 h-3" /> {preview.callLabel}</span>
                    <span className="h-8 rounded-lg bg-white/15 border border-white/40 text-[11px] font-bold inline-flex items-center justify-center gap-1"><MessageSquare className="w-3 h-3" /> {preview.contactLabel}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PassportContactRoutingPanel;
