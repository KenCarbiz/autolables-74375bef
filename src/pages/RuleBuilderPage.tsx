import { useMemo, useState } from "react";
import { AUTO_LABELS_TEMPLATE_REGISTRY, type AutoLabelsTemplateKind } from "@/components/saturday/TemplateRegistry";
import { NEW_VEHICLE_TEMPLATE_CATALOG, type NewVehicleTemplateKind } from "@/components/saturday/NewVehicleCatalog";
import { buildDefaultStickerRules, type DealerStickerRule } from "@/components/saturday/TemplateRuleEngine";

type RuleKind = AutoLabelsTemplateKind | NewVehicleTemplateKind;
type RuleDraft = DealerStickerRule & {
  targetTemplateKind: RuleKind;
};

const TEMPLATE_KIND_OPTIONS: Array<{ label: string; value: RuleKind }> = [
  { label: "Used Window Sticker", value: "used_window_sticker" },
  { label: "Used Addendum", value: "used_addendum" },
  { label: "New Monroney", value: "new_monroney" },
  { label: "New Addendum", value: "new_addendum" },
];

const ruleTemplates = [
  {
    id: "luxury-cpo",
    name: "Luxury CPO Rule",
    description: "If luxury make and CPO, route to premium CPO templates.",
    patch: { conditions: { luxury: true, cpo: true }, action: { forcePricingMode: "passport_live_price_only" } },
  },
  {
    id: "commercial",
    name: "Commercial / Fleet Rule",
    description: "If commercial vehicle, use commercial templates, dealer photo first, and no passport by default.",
    patch: { conditions: { commercial: true }, action: { forcePassportMode: "disabled", forceImagePreference: "dealer_photo_first", forcePlacement: "outside_window" } },
  },
  {
    id: "one-price",
    name: "One Price Store Rule",
    description: "If one-price store, route to one-price template family.",
    patch: { conditions: { onePriceStore: true }, action: { forcePricingMode: "used_live_price_plus_addendum" } },
  },
  {
    id: "high-mileage",
    name: "High Mileage Rule",
    description: "If mileage is over 100,000, route to value/budget-safe presentation.",
    patch: { conditions: { minMileage: 100000 }, action: { forceMarketTransparencyMode: "passport_only" } },
  },
];

const allTemplateOptions = [
  ...AUTO_LABELS_TEMPLATE_REGISTRY.map((template) => ({ id: template.id, kind: template.kind as RuleKind, name: template.name })),
  ...NEW_VEHICLE_TEMPLATE_CATALOG.map((template) => ({ id: `${template.kind}:${template.id}`, kind: template.kind as RuleKind, name: template.name })),
];

const newBlankRule = (): RuleDraft => ({
  id: `dealer-rule-${Date.now()}`,
  name: "New Dealer Rule",
  enabled: true,
  priority: 50,
  targetTemplateKind: "used_window_sticker",
  conditions: { templateKind: "used_window_sticker" },
  action: {},
});

const describeRule = (rule: RuleDraft) => {
  const conditions = Object.entries(rule.conditions)
    .filter(([, value]) => value !== undefined && value !== false && !(Array.isArray(value) && value.length === 0))
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
    .join(" • ");

  const actions = Object.entries(rule.action)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}: ${typeof value === "object" ? "custom theme" : value}`)
    .join(" • ");

  return `IF ${conditions || "always"} THEN ${actions || "recommend best matching template"}`;
};

export default function RuleBuilderPage() {
  const [rules, setRules] = useState<RuleDraft[]>(() => buildDefaultStickerRules({}).slice(0, 8).map((rule) => ({ ...rule, targetTemplateKind: rule.conditions.templateKind || "used_window_sticker" })) as RuleDraft[]);
  const [selectedRuleId, setSelectedRuleId] = useState(rules[0]?.id || "");
  const selectedRule = rules.find((rule) => rule.id === selectedRuleId) || rules[0];

  const templateOptionsForKind = useMemo(() => {
    if (!selectedRule) return [];
    return allTemplateOptions.filter((template) => template.kind === selectedRule.targetTemplateKind);
  }, [selectedRule]);

  const updateRule = (patch: Partial<RuleDraft>) => {
    setRules((current) => current.map((rule) => rule.id === selectedRule.id ? { ...rule, ...patch } : rule));
  };

  const updateConditions = (patch: Partial<DealerStickerRule["conditions"]>) => {
    setRules((current) => current.map((rule) => rule.id === selectedRule.id ? { ...rule, conditions: { ...rule.conditions, ...patch } } : rule));
  };

  const updateAction = (patch: Partial<DealerStickerRule["action"]>) => {
    setRules((current) => current.map((rule) => rule.id === selectedRule.id ? { ...rule, action: { ...rule.action, ...patch } } : rule));
  };

  const addRule = () => {
    const rule = newBlankRule();
    setRules((current) => [rule, ...current]);
    setSelectedRuleId(rule.id);
  };

  const applyTemplate = (template: typeof ruleTemplates[number]) => {
    if (!selectedRule) return;
    updateConditions(template.patch.conditions as Partial<DealerStickerRule["conditions"]>);
    updateAction(template.patch.action as Partial<DealerStickerRule["action"]>);
  };

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-6 text-slate-100">
      <section className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[360px_1fr]">
        <aside className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.25em] text-cyan-300">Dealer Admin</p>
              <h1 className="mt-2 text-2xl font-black tracking-[-0.04em]">Rule Builder</h1>
            </div>
            <button onClick={addRule} className="rounded-xl bg-cyan-400 px-3 py-2 text-xs font-black text-slate-950 hover:bg-cyan-300">New</button>
          </div>
          <p className="mt-3 text-sm text-slate-300">Build IF/THEN rules so each vehicle automatically selects the right sticker, addendum, passport behavior, image strategy, and pricing mode.</p>

          <div className="mt-5 space-y-2">
            {rules.map((rule) => (
              <button key={rule.id} onClick={() => setSelectedRuleId(rule.id)} className={`w-full rounded-2xl border p-3 text-left transition ${selectedRule?.id === rule.id ? "border-cyan-300 bg-cyan-400/15" : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08]"}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-black text-white">{rule.name}</div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${rule.enabled ? "bg-emerald-400 text-slate-950" : "bg-slate-700 text-slate-300"}`}>{rule.enabled ? "On" : "Off"}</span>
                </div>
                <div className="mt-1 line-clamp-2 text-[11px] text-slate-400">{describeRule(rule)}</div>
              </button>
            ))}
          </div>
        </aside>

        {selectedRule ? (
          <section className="space-y-6">
            <header className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl">
              <div className="grid gap-4 lg:grid-cols-[1fr_120px_120px]">
                <label className="space-y-1 text-xs font-bold uppercase tracking-wide text-slate-400">Rule Name<input className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none" value={selectedRule.name} onChange={(event) => updateRule({ name: event.target.value })} /></label>
                <label className="space-y-1 text-xs font-bold uppercase tracking-wide text-slate-400">Priority<input className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none" type="number" value={selectedRule.priority} onChange={(event) => updateRule({ priority: Number(event.target.value) })} /></label>
                <button onClick={() => updateRule({ enabled: !selectedRule.enabled })} className={`mt-5 rounded-xl px-4 py-2 text-xs font-black uppercase ${selectedRule.enabled ? "bg-emerald-400 text-slate-950" : "bg-white/10 text-white"}`}>{selectedRule.enabled ? "Enabled" : "Disabled"}</button>
              </div>
              <div className="mt-4 rounded-2xl bg-slate-900 p-4 text-sm text-slate-300"><b className="text-white">Preview:</b> {describeRule(selectedRule)}</div>
            </header>

            <section className="grid gap-6 lg:grid-cols-2">
              <Panel title="IF Vehicle Matches">
                <Select label="Template Type" value={selectedRule.targetTemplateKind} onChange={(value) => {
                  const kind = value as RuleKind;
                  updateRule({ targetTemplateKind: kind, conditions: { ...selectedRule.conditions, templateKind: kind === "used_window_sticker" || kind === "used_addendum" ? kind : undefined }, action: { ...selectedRule.action, templateKind: kind === "used_window_sticker" || kind === "used_addendum" ? kind : undefined } });
                }} options={TEMPLATE_KIND_OPTIONS.map((option) => option.value)} labels={Object.fromEntries(TEMPLATE_KIND_OPTIONS.map((option) => [option.value, option.label]))} />
                <TextInput label="Makes" placeholder="INFINITI, Lexus" value={(selectedRule.conditions.makes || []).join(", ")} onChange={(value) => updateConditions({ makes: value.split(",").map((item) => item.trim()).filter(Boolean) })} />
                <TextInput label="Models" placeholder="QX60, RX, F-150" value={(selectedRule.conditions.models || []).join(", ")} onChange={(value) => updateConditions({ models: value.split(",").map((item) => item.trim()).filter(Boolean) })} />
                <div className="grid grid-cols-2 gap-3">
                  <NumberInput label="Min Year" value={selectedRule.conditions.minYear} onChange={(value) => updateConditions({ minYear: value })} />
                  <NumberInput label="Max Year" value={selectedRule.conditions.maxYear} onChange={(value) => updateConditions({ maxYear: value })} />
                  <NumberInput label="Min Mileage" value={selectedRule.conditions.minMileage} onChange={(value) => updateConditions({ minMileage: value })} />
                  <NumberInput label="Max Mileage" value={selectedRule.conditions.maxMileage} onChange={(value) => updateConditions({ maxMileage: value })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <BooleanToggle label="CPO" value={selectedRule.conditions.cpo} onChange={(value) => updateConditions({ cpo: value })} />
                  <BooleanToggle label="Luxury" value={selectedRule.conditions.luxury} onChange={(value) => updateConditions({ luxury: value })} />
                  <BooleanToggle label="Commercial" value={selectedRule.conditions.commercial} onChange={(value) => updateConditions({ commercial: value })} />
                  <BooleanToggle label="EV / Hybrid" value={selectedRule.conditions.evOrHybrid} onChange={(value) => updateConditions({ evOrHybrid: value })} />
                  <BooleanToggle label="Demo" value={selectedRule.conditions.demo} onChange={(value) => updateConditions({ demo: value })} />
                  <BooleanToggle label="Service Loaner" value={selectedRule.conditions.serviceLoaner} onChange={(value) => updateConditions({ serviceLoaner: value })} />
                </div>
              </Panel>

              <Panel title="THEN Apply">
                <Select label="Force Template" value={selectedRule.action.templateId || ""} onChange={(value) => updateAction({ templateId: value || undefined })} options={["", ...templateOptionsForKind.map((template) => template.id)]} labels={Object.fromEntries([["", "Recommend Best Match"], ...templateOptionsForKind.map((template) => [template.id, template.name])])} />
                <Select label="Passport Mode" value={selectedRule.action.forcePassportMode || ""} onChange={(value) => updateAction({ forcePassportMode: value as DealerStickerRule["action"]["forcePassportMode"] || undefined })} options={["", "enabled", "disabled", "selected_templates_only"]} labels={{ "": "Use Dealer Default", enabled: "Enabled", disabled: "Disabled", selected_templates_only: "Selected Templates Only" }} />
                <Select label="Market Transparency" value={selectedRule.action.forceMarketTransparencyMode || ""} onChange={(value) => updateAction({ forceMarketTransparencyMode: value as DealerStickerRule["action"]["forceMarketTransparencyMode"] || undefined })} options={["", "off", "passport_only", "print_and_passport", "selected_templates_only"]} labels={{ "": "Use Dealer Default", off: "Off", passport_only: "Passport Only", print_and_passport: "Print + Passport", selected_templates_only: "Selected Templates Only" }} />
                <Select label="Pricing Mode" value={selectedRule.action.forcePricingMode || ""} onChange={(value) => updateAction({ forcePricingMode: value as DealerStickerRule["action"]["forcePricingMode"] || undefined })} options={["", "new_msrp_plus_addendum", "used_addendum_only", "used_market_value_plus_addendum", "used_live_price_plus_addendum", "passport_live_price_only"]} labels={{ "": "Use Dealer Default" }} />
                <Select label="Placement" value={selectedRule.action.forcePlacement || ""} onChange={(value) => updateAction({ forcePlacement: value as DealerStickerRule["action"]["forcePlacement"] || undefined })} options={["", "inside_window", "outside_window", "either"]} labels={{ "": "Use Dealer Default", inside_window: "Inside Window", outside_window: "Outside Window", either: "Either" }} />
                <Select label="Image Preference" value={selectedRule.action.forceImagePreference || ""} onChange={(value) => updateAction({ forceImagePreference: value as DealerStickerRule["action"]["forceImagePreference"] || undefined })} options={["", "factory_clean_first", "transparent_first", "dealer_photo_first", "api_fallback_only"]} labels={{ "": "Use Dealer Default" }} />
              </Panel>
            </section>

            <Panel title="Quick Rule Templates">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {ruleTemplates.map((template) => <button key={template.id} onClick={() => applyTemplate(template)} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left hover:bg-white/[0.08]"><div className="font-black text-white">{template.name}</div><p className="mt-1 text-xs text-slate-400">{template.description}</p></button>)}
              </div>
            </Panel>

            <Panel title="Rule JSON Preview">
              <pre className="max-h-[360px] overflow-auto rounded-2xl bg-slate-900 p-4 text-xs text-slate-300">{JSON.stringify(rules, null, 2)}</pre>
            </Panel>
          </section>
        ) : null}
      </section>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl"><h2 className="text-lg font-black tracking-[-0.02em] text-white">{title}</h2><div className="mt-4 space-y-4">{children}</div></section>;
}

function Select({ label, value, onChange, options, labels = {} }: { label: string; value: string; onChange: (value: string) => void; options: string[]; labels?: Record<string, string> }) {
  return <label className="block space-y-1 text-xs font-bold uppercase tracking-wide text-slate-400">{label}<select className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{labels[option] || option}</option>)}</select></label>;
}

function TextInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="block space-y-1 text-xs font-bold uppercase tracking-wide text-slate-400">{label}<input className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function NumberInput({ label, value, onChange }: { label: string; value?: number; onChange: (value?: number) => void }) {
  return <label className="block space-y-1 text-xs font-bold uppercase tracking-wide text-slate-400">{label}<input className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none" type="number" value={value ?? ""} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : undefined)} /></label>;
}

function BooleanToggle({ label, value, onChange }: { label: string; value?: boolean; onChange: (value?: boolean) => void }) {
  const text = value === true ? "Yes" : value === false ? "No" : "Any";
  return <button onClick={() => onChange(value === undefined ? true : value === true ? false : undefined)} className={`rounded-xl px-3 py-2 text-xs font-black ${value === true ? "bg-emerald-400 text-slate-950" : value === false ? "bg-red-400 text-slate-950" : "bg-white/10 text-white"}`}>{label}: {text}</button>;
}
