import { useEffect, useRef, useState } from "react";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { DealerProgram, emptyProgram, presetProgram, programMode, termLabel, PROGRAM_PRESETS, type ProgramAppliesTo, type ProgramRequirement, type ProgramMode } from "@/lib/dealerPrograms";
import { useInstantSave } from "@/hooks/useInstantSave";
import { Plus, Trash2, ShieldCheck, GripVertical, Check } from "lucide-react";

// Dealer value-proposition programs editor. FTC structure per program:
// value (title) -> offer -> customer benefit -> disclosure, plus an optional
// requirement (e.g. must finance) and placement toggles (sticker / packet).
export default function DealerProgramsPanel() {
  const { settings, updateSettings, loading: settingsLoading } = useDealerSettings();
  // Hydrate once from async settings before instant-save arms (branding-form
  // pattern) — initializing from a cold cache and saving would clobber the
  // programs already in the database.
  const [programs, setPrograms] = useState<DealerProgram[]>([]);
  const hydratedRef = useRef(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (settingsLoading || hydratedRef.current) return;
    hydratedRef.current = true;
    setPrograms(settings.dealer_programs || []);
    setReady(true);
  }, [settingsLoading, settings]);

  const set = (id: string, patch: Partial<DealerProgram>) =>
    setPrograms((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const add = () => setPrograms((prev) => [...prev, emptyProgram()]);
  const remove = (id: string) => setPrograms((prev) => prev.filter((p) => p.id !== id));

  useInstantSave(programs, (v) => updateSettings({ dealer_programs: v }), { ready, toastId: "dealer-programs" });

  const inputCls = "w-full h-9 px-2.5 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:border-primary";
  const areaCls = "w-full px-2.5 py-2 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:border-primary resize-y";
  const labelCls = "text-[10px] font-bold uppercase tracking-wider text-muted-foreground";

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-base font-bold text-foreground">Included with the sale &amp; dealer warranties</h2>
        <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
          The value your store adds to a deal — dealer warranties, loaner vehicles, maintenance,
          car washes — offered either included with the sale or as an optional upgrade. Each item
          follows the FTC shape: state the value, the offer, the customer benefit, and the
          disclosure. An item only appears once it has a title, a placement toggle, and a matching
          vehicle condition. Included items feed the addendum's Included Benefits; upgrades feed
          Available Upgrades. Changes save automatically.
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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>How it's offered</label>
                <select value={programMode(p)} onChange={(e) => set(p.id, { mode: e.target.value as ProgramMode })} className={inputCls}>
                  <option value="included">Included with the sale</option>
                  <option value="available">Available as an upgrade</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>{programMode(p) === "available" ? "Upgrade price (optional)" : "—"}</label>
                <input
                  type="number" min={0}
                  value={p.price ?? ""}
                  onChange={(e) => set(p.id, { price: e.target.value === "" ? null : Number(e.target.value) })}
                  disabled={programMode(p) !== "available"}
                  placeholder="1495"
                  className={`${inputCls} disabled:opacity-40`}
                />
              </div>
              <div className="flex items-end pb-1.5">
                <label className="inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground cursor-pointer">
                  <input type="checkbox" checked={p.isWarranty === true} onChange={(e) => set(p.id, { isWarranty: e.target.checked })} />
                  This is a dealer warranty
                </label>
              </div>
            </div>

            {p.isWarranty && (
              <div className="rounded-xl border border-border bg-muted/30 p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className={labelCls}>Coverage</label>
                  <input value={p.coverage || ""} onChange={(e) => set(p.id, { coverage: e.target.value })} placeholder="Powertrain" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Term (years)</label>
                  <input type="number" min={0} value={p.termYears ?? ""} disabled={p.lifetime === true}
                    onChange={(e) => set(p.id, { termYears: e.target.value === "" ? null : Number(e.target.value) })}
                    placeholder="10" className={`${inputCls} disabled:opacity-40`} />
                </div>
                <div>
                  <label className={labelCls}>Term (miles)</label>
                  <input type="number" min={0} value={p.termMiles ?? ""} disabled={p.lifetime === true}
                    onChange={(e) => set(p.id, { termMiles: e.target.value === "" ? null : Number(e.target.value) })}
                    placeholder="100000" className={`${inputCls} disabled:opacity-40`} />
                </div>
                <div className="flex items-end pb-1.5">
                  <label className="inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground cursor-pointer">
                    <input type="checkbox" checked={p.lifetime === true} onChange={(e) => set(p.id, { lifetime: e.target.checked, ...(e.target.checked ? { termYears: null, termMiles: null } : {}) })} />
                    Lifetime
                  </label>
                </div>
                {termLabel(p) && (
                  <p className="col-span-2 sm:col-span-4 text-[11px] text-muted-foreground">
                    Shows as: <span className="font-semibold text-foreground">{p.title.trim() || "Warranty"} — {termLabel(p)}</span>
                  </p>
                )}
              </div>
            )}

            {/certified/i.test(`${p.title} ${p.offer}`) && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Several states (including California) restrict advertising a used vehicle as
                "certified" unless it meets a defined inspection program and the buyer receives a
                completed inspection report before sale. Confirm eligibility before using this wording.
              </p>
            )}
            {p.isWarranty && p.requirement === "finance" && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Conditioning a warranty on dealer financing draws add-on scrutiny under FTC Act
                Section 5 and state UDAP laws. Confirm this structure with counsel.
              </p>
            )}

            <div className="pt-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Where it appears</p>
              <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground cursor-pointer">
                <input type="checkbox" checked={p.showOnSticker} onChange={(e) => set(p.id, { showOnSticker: e.target.checked })} />
                Show on window sticker &amp; addendum
              </label>
              <label className="inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground cursor-pointer">
                <input type="checkbox" checked={p.showOnPacket} onChange={(e) => set(p.id, { showOnPacket: e.target.checked })} />
                Show on customer packet
              </label>
              {p.isWarranty && (
                <label className="inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground cursor-pointer">
                  <input type="checkbox" checked={p.showOnWarrantyPanel === true} onChange={(e) => set(p.id, { showOnWarrantyPanel: e.target.checked })} />
                  Show in passport warranty section
                </label>
              )}
              </div>
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
