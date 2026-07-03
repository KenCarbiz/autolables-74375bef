import { useState } from "react";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { DealerProgram, emptyProgram, presetProgram, PROGRAM_PRESETS, type ProgramAppliesTo, type ProgramRequirement } from "@/lib/dealerPrograms";
import { useInstantSave } from "@/hooks/useInstantSave";
import { Plus, Trash2, ShieldCheck, GripVertical, Check } from "lucide-react";

// Dealer value-proposition programs editor. FTC structure per program:
// value (title) -> offer -> customer benefit -> disclosure, plus an optional
// requirement (e.g. must finance) and placement toggles (sticker / packet).
export default function DealerProgramsPanel() {
  const { settings, updateSettings, loading: settingsLoading } = useDealerSettings();
  const [programs, setPrograms] = useState<DealerProgram[]>(settings.dealer_programs || []);

  const set = (id: string, patch: Partial<DealerProgram>) =>
    setPrograms((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const add = () => setPrograms((prev) => [...prev, emptyProgram()]);
  const remove = (id: string) => setPrograms((prev) => prev.filter((p) => p.id !== id));

  useInstantSave(programs, (v) => updateSettings({ dealer_programs: v }), { ready: !settingsLoading, toastId: "dealer-programs" });

  const inputCls = "w-full h-9 px-2.5 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:border-primary";
  const areaCls = "w-full px-2.5 py-2 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:border-primary resize-y";
  const labelCls = "text-[10px] font-bold uppercase tracking-wider text-muted-foreground";

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-base font-bold text-foreground">Included with the sale</h2>
        <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
          Everything your store includes with a purchase — dealer warranty, loaner vehicles,
          maintenance, car washes, and any other value you provide. Each item follows the FTC
          shape: state the value, the offer, the customer benefit, and the disclosure. Choose
          where each appears (window sticker, customer packet) and any requirement such as
          financing. These feed the sticker programs block, the addendum's Included Benefits,
          and the customer passport. Changes save automatically.
        </p>
      </div>

      {/* One-click starters for the items dealers most commonly include. */}
      <div className="rounded-2xl border border-border bg-card p-3.5">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Quick add — common items</p>
        <div className="flex flex-wrap gap-1.5">
          {PROGRAM_PRESETS.map((preset) => {
            const added = programs.some((p) => p.title.trim().toLowerCase() === preset.fields.title.toLowerCase());
            return (
              <button
                key={preset.key}
                type="button"
                disabled={added}
                onClick={() => { const prog = presetProgram(preset.key); if (prog) setPrograms((prev) => [...prev, prog]); }}
                className={`inline-flex items-center gap-1 h-8 px-3 rounded-full border text-xs font-semibold transition-colors ${added ? "border-emerald-200 bg-emerald-50 text-emerald-700 cursor-default" : "border-border bg-background text-foreground hover:border-primary"}`}
              >
                {added ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />} {preset.label}
              </button>
            );
          })}
        </div>
        <p className="text-[10.5px] text-muted-foreground mt-2">Presets are starting points — edit the wording and disclosure to match your store's actual policy.</p>
      </div>

      {programs.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center">
          <ShieldCheck className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Nothing configured yet. Quick-add a common item above, or add your own.</p>
        </div>
      )}

      {programs.map((p) => {
        const reqDetail = p.requirement !== "none";
        return (
          <section key={p.id} className={`rounded-2xl border bg-card p-4 space-y-3 ${p.enabled ? "border-border" : "border-border opacity-70"}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <GripVertical className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />
                <input
                  value={p.title}
                  onChange={(e) => set(p.id, { title: e.target.value })}
                  placeholder="10-Year / 100,000-Mile Powertrain Coverage"
                  className="flex-1 min-w-0 h-9 px-2.5 rounded-lg border border-border bg-background text-sm font-semibold text-foreground outline-none focus:border-primary"
                />
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={p.enabled} onChange={(e) => set(p.id, { enabled: e.target.checked })} />
                  Enabled
                </label>
                <button onClick={() => remove(p.id)} className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-border text-rose-600 hover:bg-rose-50" aria-label="Remove program">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Offer — what's included</label>
                <textarea value={p.offer} onChange={(e) => set(p.id, { offer: e.target.value })} rows={2} placeholder="Covers all internally lubricated powertrain components for 10 years or 100,000 miles from the in-service date." className={areaCls} />
              </div>
              <div>
                <label className={labelCls}>Benefit — why it matters</label>
                <textarea value={p.benefit} onChange={(e) => set(p.id, { benefit: e.target.value })} rows={2} placeholder="Drive with confidence — major repairs are covered, protecting you from unexpected costs." className={areaCls} />
              </div>
            </div>

            <div>
              <label className={labelCls}>Disclosure — stipulations / disclaimer</label>
              <textarea value={p.disclosure} onChange={(e) => set(p.id, { disclosure: e.target.value })} rows={2} placeholder="Requires adherence to the manufacturer's maintenance schedule with documented service. See dealer for full terms, exclusions, and deductible. Not transferable." className={areaCls} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Applies to</label>
                <select value={p.appliesTo} onChange={(e) => set(p.id, { appliesTo: e.target.value as ProgramAppliesTo })} className={inputCls}>
                  <option value="all">All vehicles</option>
                  <option value="new">New only</option>
                  <option value="used">Used only</option>
                  <option value="cpo">CPO only</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Requirement</label>
                <select value={p.requirement} onChange={(e) => set(p.id, { requirement: e.target.value as ProgramRequirement })} className={inputCls}>
                  <option value="none">No requirement</option>
                  <option value="finance">Requires financing</option>
                  <option value="custom">Custom requirement</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>{reqDetail ? "Requirement detail" : "—"}</label>
                <input
                  value={p.requirementText}
                  onChange={(e) => set(p.id, { requirementText: e.target.value })}
                  disabled={!reqDetail}
                  placeholder={p.requirement === "finance" ? "With dealer-arranged financing" : "e.g. with the purchase of a service contract"}
                  className={`${inputCls} disabled:opacity-40`}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 pt-1">
              <label className="inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground cursor-pointer">
                <input type="checkbox" checked={p.showOnSticker} onChange={(e) => set(p.id, { showOnSticker: e.target.checked })} />
                Show on window sticker
              </label>
              <label className="inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground cursor-pointer">
                <input type="checkbox" checked={p.showOnPacket} onChange={(e) => set(p.id, { showOnPacket: e.target.checked })} />
                Show on customer packet
              </label>
            </div>
          </section>
        );
      })}

      <button onClick={add} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl border border-border bg-card hover:bg-muted text-sm font-semibold text-foreground">
        <Plus className="w-4 h-4" /> Add custom item
      </button>
    </div>
  );
}
