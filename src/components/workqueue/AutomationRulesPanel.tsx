import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { CheckCircle2, Settings2, Sparkles, ToggleLeft, Wrench } from "lucide-react";
import { toast } from "sonner";

type AutomationSettings = {
  auto_create_work_from_scraper: boolean;
  auto_create_print_tasks: boolean;
  auto_send_used_to_get_ready: boolean;
  auto_send_new_to_get_ready: boolean;
  auto_check_standard_prep: boolean;
  require_manager_approval_before_print: boolean;
  require_manager_approval_before_passport_publish: boolean;
  enable_cpo_detection: boolean;
  enable_demo_detection: boolean;
  enable_ev_detection: boolean;
};

const defaults: AutomationSettings = {
  auto_create_work_from_scraper: true,
  auto_create_print_tasks: true,
  auto_send_used_to_get_ready: false,
  auto_send_new_to_get_ready: false,
  auto_check_standard_prep: true,
  require_manager_approval_before_print: false,
  require_manager_approval_before_passport_publish: true,
  enable_cpo_detection: true,
  enable_demo_detection: true,
  enable_ev_detection: true,
};

const ruleGroups: Array<{ title: string; description: string; rules: Array<{ key: keyof AutomationSettings; label: string; help: string }> }> = [
  {
    title: "Inventory automation",
    description: "Controls what happens when the scraper, DMS feed, or manual entry adds/updates a vehicle.",
    rules: [
      { key: "auto_create_work_from_scraper", label: "Create work from inventory changes", help: "When a vehicle appears, automatically create required work instead of waiting for staff." },
      { key: "auto_create_print_tasks", label: "Create sticker and document print tasks", help: "New/used/CPO/demo/EV status creates the right print and compliance queue items." },
    ],
  },
  {
    title: "Get-ready automation",
    description: "Controls whether inventory automatically enters service/detail/third-party prep.",
    rules: [
      { key: "auto_send_used_to_get_ready", label: "Auto-send used vehicles to get-ready", help: "Used/CPO/demo vehicles create service/detail prep work automatically." },
      { key: "auto_send_new_to_get_ready", label: "Auto-send new vehicles to get-ready", help: "New vehicles can also create prep work when the store wants full automation." },
      { key: "auto_check_standard_prep", label: "Auto-check standard prep items", help: "Apply the dealer's standard service/detail/third-party prep items, then let staff add or subtract before send/print." },
    ],
  },
  {
    title: "Manager protection",
    description: "Controls where the system pauses for approval before customer-facing or printed output.",
    rules: [
      { key: "require_manager_approval_before_print", label: "Manager approval before print", help: "Generated stickers/docs land in approval first; staff can approve-and-print or modify-and-print." },
      { key: "require_manager_approval_before_passport_publish", label: "Manager approval before Passport proof", help: "Service/recon/proof language must be approved before appearing customer-side." },
    ],
  },
  {
    title: "Self-aware detection",
    description: "Controls special vehicle detection that changes the required work automatically.",
    rules: [
      { key: "enable_cpo_detection", label: "Detect CPO / factory CPO", help: "Creates CPO packet, warranty verification, and Passport proof review tasks." },
      { key: "enable_demo_detection", label: "Detect demo / loaner / program vehicles", help: "Creates demo disclosure and mileage/prior-use review tasks." },
      { key: "enable_ev_detection", label: "Detect EV / electric vehicles", help: "Creates EV disclosure, charging info, and battery/health review tasks." },
    ],
  },
];

export function AutomationRulesPanel() {
  const { tenant } = useTenant();
  const [settings, setSettings] = useState<AutomationSettings>(defaults);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("dealer_automation_settings")
      .select("*")
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (!error && data) setSettings({ ...defaults, ...data });
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenant?.id]);

  const save = async (next: AutomationSettings) => {
    if (!tenant?.id) return toast.error("No active dealership");
    setSettings(next);
    setSaving(true);
    const { error } = await (supabase as any)
      .from("dealer_automation_settings")
      .upsert({ tenant_id: tenant.id, ...next, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
    setSaving(false);
    if (error) toast.error("Could not save automation settings");
    else toast.success("Automation rule updated");
  };

  const toggle = (key: keyof AutomationSettings) => {
    save({ ...settings, [key]: !settings[key] });
  };

  const enabledCount = Object.values(settings).filter(Boolean).length;

  return (
    <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
      <div className="grid gap-0 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="relative bg-slate-950 p-5 text-white sm:p-6">
          <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-blue-500/25 blur-3xl" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-blue-100">
              <Settings2 className="h-3.5 w-3.5" /> Automation Rules Center
            </div>
            <h2 className="mt-4 text-3xl font-black tracking-tight">Decide how autonomous the dealership becomes.</h2>
            <p className="mt-3 text-sm leading-relaxed text-white/70">
              Full automation is the goal, but every store can choose where AutoLabels creates work automatically and where managers approve first.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <div className="text-[10px] font-black uppercase tracking-wider text-white/45">Enabled rules</div>
                <div className="mt-1 text-3xl font-black">{enabledCount}/10</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <div className="text-[10px] font-black uppercase tracking-wider text-white/45">Status</div>
                <div className="mt-1 flex items-center gap-2 text-sm font-black"><CheckCircle2 className="h-5 w-5 text-emerald-300" /> {loading ? "Loading" : saving ? "Saving" : "Ready"}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          {ruleGroups.map((group) => (
            <div key={group.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-start gap-3">
                <div className="rounded-xl bg-white p-2 text-slate-700 shadow-sm"><Wrench className="h-5 w-5" /></div>
                <div>
                  <h3 className="font-black text-slate-950">{group.title}</h3>
                  <p className="mt-0.5 text-sm leading-relaxed text-slate-500">{group.description}</p>
                </div>
              </div>
              <div className="grid gap-2">
                {group.rules.map((rule) => (
                  <button key={rule.key} onClick={() => toggle(rule.key)} className="rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-blue-200 hover:shadow-md">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-slate-950">{rule.label}</span>
                          {settings[rule.key] && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-700"><Sparkles className="h-3 w-3" /> ON</span>}
                        </div>
                        <p className="mt-1 text-sm leading-relaxed text-slate-500">{rule.help}</p>
                      </div>
                      <span className={`relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${settings[rule.key] ? "bg-blue-600" : "bg-slate-300"}`}>
                        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${settings[rule.key] ? "translate-x-5" : "translate-x-1"}`} />
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-950">
            <div className="flex items-start gap-3">
              <ToggleLeft className="mt-0.5 h-5 w-5 shrink-0" />
              <p className="text-sm font-semibold leading-relaxed">
                Staff still gets control: automatically-created prep, sticker, Passport, and compliance tasks can be altered before printing, sending, or publishing.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default AutomationRulesPanel;
