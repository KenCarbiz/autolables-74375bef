import { useMemo, useState } from "react";
import { AUTO_LABELS_TEMPLATE_REGISTRY, AUTO_LABELS_TEMPLATE_COUNTS, type AutoLabelsTemplateKind, type AutoLabelsTemplateRegistryItem } from "@/components/saturday/TemplateRegistry";
import { NEW_VEHICLE_TEMPLATE_CATALOG, NEW_VEHICLE_TEMPLATE_COUNTS, type NewVehicleTemplateDefinition, type NewVehicleTemplateKind } from "@/components/saturday/NewVehicleCatalog";
import { DEFAULT_DEALER_STICKER_ADMIN_STATE, createDealerStickerAdminState } from "@/components/saturday/DealerStickerAdminConfig";

type AnyTemplate = AutoLabelsTemplateRegistryItem | NewVehicleTemplateDefinition;
type TemplateKindFilter = "all" | AutoLabelsTemplateKind | NewVehicleTemplateKind;

type DraftSelectionState = {
  enabledTemplateIds: string[];
  disabledTemplateIds: string[];
  defaultUsedWindowTemplateId?: string;
  defaultUsedAddendumTemplateId?: string;
  defaultNewMonroneyTemplateId?: string;
  defaultNewAddendumTemplateId?: string;
};

const kindLabel = (kind: string) => {
  switch (kind) {
    case "used_window_sticker": return "Used Window";
    case "used_addendum": return "Used Addendum";
    case "new_monroney": return "New Monroney";
    case "new_addendum": return "New Addendum";
    default: return kind;
  }
};

const getTemplateKind = (template: AnyTemplate): TemplateKindFilter => {
  if ("kind" in template) return template.kind as TemplateKindFilter;
  return "all";
};

const getTemplateRegistryId = (template: AnyTemplate) => {
  const kind = getTemplateKind(template);
  if (kind === "new_monroney" || kind === "new_addendum") return `${kind}:${template.id}`;
  return (template as AutoLabelsTemplateRegistryItem).id;
};

const allTemplates: AnyTemplate[] = [
  ...AUTO_LABELS_TEMPLATE_REGISTRY,
  ...NEW_VEHICLE_TEMPLATE_CATALOG,
];

const categories = Array.from(new Set(allTemplates.map((template) => template.category))).sort();
const oems = Array.from(new Set(allTemplates.flatMap((template) => template.suggestedOEMs || []))).sort();

const capabilityPills = (template: AnyTemplate) => {
  const caps = [
    template.supportsPassport ? "Passport" : "No Passport",
    template.supportsMarketTransparency ? "Market" : undefined,
    template.supportsCPO ? "CPO" : undefined,
    template.supportsFactoryCleanImage ? "Factory Image" : undefined,
    "supportsFactoryOptions" in template && template.supportsFactoryOptions ? "Factory Options" : undefined,
    "supportsDealerAccessories" in template && template.supportsDealerAccessories ? "Dealer Accessories" : undefined,
    "supportsMarketAdjustment" in template && template.supportsMarketAdjustment ? "Market Adjustment" : undefined,
    "supportsEVData" in template && template.supportsEVData ? "EV" : undefined,
    "supportsCommercialData" in template && template.supportsCommercialData ? "Commercial" : undefined,
  ].filter(Boolean) as string[];
  return caps;
};

export default function TemplatePickerPage() {
  const [kind, setKind] = useState<TemplateKindFilter>("all");
  const [category, setCategory] = useState("all");
  const [oem, setOem] = useState("all");
  const [query, setQuery] = useState("");
  const [passportOnly, setPassportOnly] = useState(false);
  const [marketOnly, setMarketOnly] = useState(false);
  const [state, setState] = useState<DraftSelectionState>({
    enabledTemplateIds: DEFAULT_DEALER_STICKER_ADMIN_STATE.templates.enabledTemplateIds,
    disabledTemplateIds: DEFAULT_DEALER_STICKER_ADMIN_STATE.templates.disabledTemplateIds,
  });

  const filteredTemplates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allTemplates.filter((template) => {
      const registryId = getTemplateRegistryId(template);
      const templateKind = getTemplateKind(template);
      const haystack = [template.name, template.description, template.category, template.family, ...(template.tags || []), ...(template.suggestedOEMs || [])].join(" ").toLowerCase();
      if (kind !== "all" && templateKind !== kind) return false;
      if (category !== "all" && template.category !== category) return false;
      if (oem !== "all" && !(template.suggestedOEMs || []).includes(oem)) return false;
      if (passportOnly && !template.supportsPassport) return false;
      if (marketOnly && !template.supportsMarketTransparency) return false;
      if (q && !haystack.includes(q) && !registryId.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [kind, category, oem, query, passportOnly, marketOnly]);

  const toggleEnabled = (id: string) => {
    setState((current) => {
      const alreadyEnabled = current.enabledTemplateIds.includes(id);
      return {
        ...current,
        enabledTemplateIds: alreadyEnabled ? current.enabledTemplateIds.filter((item) => item !== id) : [...current.enabledTemplateIds, id],
        disabledTemplateIds: current.disabledTemplateIds.filter((item) => item !== id),
      };
    });
  };

  const toggleDisabled = (id: string) => {
    setState((current) => {
      const alreadyDisabled = current.disabledTemplateIds.includes(id);
      return {
        ...current,
        disabledTemplateIds: alreadyDisabled ? current.disabledTemplateIds.filter((item) => item !== id) : [...current.disabledTemplateIds, id],
        enabledTemplateIds: current.enabledTemplateIds.filter((item) => item !== id),
      };
    });
  };

  const setDefault = (template: AnyTemplate) => {
    const id = getTemplateRegistryId(template);
    const templateKind = getTemplateKind(template);
    setState((current) => ({
      ...current,
      defaultUsedWindowTemplateId: templateKind === "used_window_sticker" ? id : current.defaultUsedWindowTemplateId,
      defaultUsedAddendumTemplateId: templateKind === "used_addendum" ? id : current.defaultUsedAddendumTemplateId,
      defaultNewMonroneyTemplateId: templateKind === "new_monroney" ? id : current.defaultNewMonroneyTemplateId,
      defaultNewAddendumTemplateId: templateKind === "new_addendum" ? id : current.defaultNewAddendumTemplateId,
      enabledTemplateIds: current.enabledTemplateIds.includes(id) ? current.enabledTemplateIds : [...current.enabledTemplateIds, id],
    }));
  };

  const configPreview = createDealerStickerAdminState({
    templates: {
      enabledKinds: ["used_window_sticker", "used_addendum"],
      enabledTemplateIds: state.enabledTemplateIds,
      disabledTemplateIds: state.disabledTemplateIds,
      defaultUsedWindowTemplateId: state.defaultUsedWindowTemplateId,
      defaultUsedAddendumTemplateId: state.defaultUsedAddendumTemplateId,
    },
  });

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-6 text-slate-100">
      <section className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">Dealer Admin</p>
              <h1 className="mt-2 text-4xl font-black tracking-[-0.04em]">Template Picker</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-300">Enable, disable, favorite, and set defaults across used window stickers, used addendums, new Monroney companions, and new addendums. This is the control surface dealers need before rules take over.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-right md:grid-cols-4">
              <Stat label="Used Templates" value={AUTO_LABELS_TEMPLATE_COUNTS.total} />
              <Stat label="New Templates" value={NEW_VEHICLE_TEMPLATE_COUNTS.total} />
              <Stat label="Enabled" value={state.enabledTemplateIds.length} />
              <Stat label="Disabled" value={state.disabledTemplateIds.length} />
            </div>
          </div>
        </header>

        <section className="grid gap-4 rounded-3xl border border-white/10 bg-white/[0.04] p-4 lg:grid-cols-[1.2fr_.8fr_.8fr_.8fr_auto_auto]">
          <label className="space-y-1 text-xs font-bold uppercase tracking-wide text-slate-400">Search<input className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none ring-cyan-400/0 focus:ring-2" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="OEM, CPO, passport, market..." /></label>
          <Select label="Type" value={kind} onChange={(value) => setKind(value as TemplateKindFilter)} options={["all", "used_window_sticker", "used_addendum", "new_monroney", "new_addendum"]} />
          <Select label="Category" value={category} onChange={setCategory} options={["all", ...categories]} />
          <Select label="OEM" value={oem} onChange={setOem} options={["all", ...oems]} />
          <Toggle label="Passport" checked={passportOnly} onChange={setPassportOnly} />
          <Toggle label="Market" checked={marketOnly} onChange={setMarketOnly} />
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredTemplates.map((template) => {
              const id = getTemplateRegistryId(template);
              const templateKind = getTemplateKind(template);
              const enabled = state.enabledTemplateIds.includes(id);
              const disabled = state.disabledTemplateIds.includes(id);
              const isDefault = state.defaultUsedWindowTemplateId === id || state.defaultUsedAddendumTemplateId === id || state.defaultNewMonroneyTemplateId === id || state.defaultNewAddendumTemplateId === id;
              return (
                <article key={id} className={`rounded-3xl border p-4 shadow-xl transition ${disabled ? "border-red-400/40 bg-red-950/20" : enabled ? "border-emerald-400/40 bg-emerald-950/20" : "border-white/10 bg-white/[0.04]"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300">{kindLabel(templateKind)} • {template.category}</div>
                      <h2 className="mt-2 text-lg font-black leading-tight tracking-[-0.02em]">{template.name}</h2>
                    </div>
                    {isDefault ? <span className="rounded-full bg-amber-400 px-2 py-1 text-[10px] font-black uppercase text-slate-950">Default</span> : null}
                  </div>
                  <p className="mt-3 line-clamp-3 text-sm text-slate-300">{template.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {capabilityPills(template).slice(0, 6).map((cap) => <span key={cap} className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] font-bold text-slate-200">{cap}</span>)}
                  </div>
                  <div className="mt-3 text-[11px] text-slate-400">Family: <b className="text-slate-200">{template.family}</b></div>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <button onClick={() => toggleEnabled(id)} className={`rounded-xl px-3 py-2 text-xs font-black ${enabled ? "bg-emerald-400 text-slate-950" : "bg-white/10 text-white hover:bg-white/15"}`}>{enabled ? "Enabled" : "Enable"}</button>
                    <button onClick={() => toggleDisabled(id)} className={`rounded-xl px-3 py-2 text-xs font-black ${disabled ? "bg-red-400 text-slate-950" : "bg-white/10 text-white hover:bg-white/15"}`}>{disabled ? "Blocked" : "Block"}</button>
                    <button onClick={() => setDefault(template)} className="rounded-xl bg-cyan-400 px-3 py-2 text-xs font-black text-slate-950 hover:bg-cyan-300">Default</button>
                  </div>
                </article>
              );
            })}
          </div>

          <aside className="sticky top-6 h-fit rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl">
            <p className="text-xs font-black uppercase tracking-[0.25em] text-cyan-300">Selection Draft</p>
            <div className="mt-4 space-y-3 text-sm">
              <SummaryRow label="Enabled" value={state.enabledTemplateIds.length} />
              <SummaryRow label="Blocked" value={state.disabledTemplateIds.length} />
              <SummaryRow label="Used Window Default" value={state.defaultUsedWindowTemplateId || "Not set"} />
              <SummaryRow label="Used Addendum Default" value={state.defaultUsedAddendumTemplateId || "Not set"} />
              <SummaryRow label="New Monroney Default" value={state.defaultNewMonroneyTemplateId || "Not set"} />
              <SummaryRow label="New Addendum Default" value={state.defaultNewAddendumTemplateId || "Not set"} />
            </div>
            <div className="mt-5 rounded-2xl bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-300">
              <b className="text-white">Smoke-test payload:</b>
              <pre className="mt-2 max-h-[280px] overflow-auto whitespace-pre-wrap text-[10px]">{JSON.stringify(configPreview.templates, null, 2)}</pre>
            </div>
          </aside>
        </section>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3"><div className="text-2xl font-black text-white">{value}</div><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div></div>;
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label className="space-y-1 text-xs font-bold uppercase tracking-wide text-slate-400">{label}<select className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option === "all" ? "All" : kindLabel(option)}</option>)}</select></label>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <button onClick={() => onChange(!checked)} className={`mt-5 rounded-xl px-4 py-2 text-xs font-black uppercase ${checked ? "bg-cyan-400 text-slate-950" : "bg-white/10 text-white"}`}>{label}</button>;
}

function SummaryRow({ label, value }: { label: string; value: string | number }) {
  return <div className="border-b border-white/10 pb-2"><div className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 break-words text-xs font-bold text-slate-200">{value}</div></div>;
}
