import { useMemo, useState } from "react";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  type OemFactoryWarranty, type CpoProgram,
  emptyOemWarranty, emptyCpoProgram, warrantyHeadline,
  UNLIMITED_MILES, isUnlimitedMiles,
} from "@/lib/oemWarranty";
import { lookupOemReference } from "@/data/oemWarrantyReference";
import { useInstantSave } from "@/hooks/useInstantSave";
import { Plus, Trash2, ShieldCheck, BadgeCheck, CheckCircle2, Infinity as InfinityIcon, X, Wand2 } from "lucide-react";

// Month/mile number pair. Defined at module scope (NOT inside the panel) so its
// component identity is stable across re-renders — a nested definition would be
// a new function every keystroke, remounting the input and dropping focus after
// one character.
const PAIR_INPUT = "w-full h-9 px-2.5 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:border-primary tabular-nums";
const Pair = ({ mo, mi, onMo, onMi }: { mo?: number; mi?: number; onMo: (n: number) => void; onMi: (n: number) => void }) => {
  const unlimited = isUnlimitedMiles(mi);
  return (
    <div className="grid grid-cols-2 gap-2">
      <input type="number" min={0} value={mo ?? ""} onChange={(e) => onMo(Number(e.target.value) || 0)} placeholder="months" className={PAIR_INPUT} />
      <div className="relative">
        {unlimited ? (
          <button
            type="button"
            onClick={() => onMi(0)}
            title="Unlimited miles — click to set a mileage cap"
            className="w-full h-9 px-2.5 rounded-lg border border-emerald-300 bg-emerald-50 text-sm font-semibold text-emerald-700 inline-flex items-center justify-between"
          >
            <span className="inline-flex items-center gap-1"><InfinityIcon className="w-4 h-4" /> Unlimited</span>
            <X className="w-3.5 h-3.5 text-emerald-600/70" />
          </button>
        ) : (
          <>
            <input type="number" min={0} value={mi ?? ""} onChange={(e) => onMi(Number(e.target.value) || 0)} placeholder="miles" className={`${PAIR_INPUT} pr-8`} />
            <button
              type="button"
              onClick={() => onMi(UNLIMITED_MILES)}
              title="Mark as unlimited miles"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 inline-flex items-center justify-center"
            >
              <InfinityIcon className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};

// Factory & CPO warranty config. The dealer verifies each franchised brand's
// OEM factory-warranty terms (only verified terms feed the passport) and lists
// their CPO programs. New cars surface the matching brand's factory warranty on
// the passport; CPO cars surface the matching program.
export default function OemWarrantyPanel() {
  const { settings, updateSettings, loading: settingsLoading } = useDealerSettings();
  const { user } = useAuth();
  const [warranties, setWarranties] = useState<OemFactoryWarranty[]>(settings.oem_factory_warranties || []);
  const [programs, setPrograms] = useState<CpoProgram[]>(settings.cpo_programs || []);

  const draft = useMemo(
    () => ({ oem_factory_warranties: warranties, cpo_programs: programs }),
    [warranties, programs],
  );
  useInstantSave(draft, (v) => updateSettings(v), { ready: !settingsLoading, toastId: "oem-warranty" });

  // Brands the dealer franchises but hasn't entered terms for yet — one click to add.
  const missingBrands = useMemo(() => {
    const have = new Set(warranties.map((w) => w.brand.trim().toUpperCase()).filter(Boolean));
    return (settings.dealer_oem_brands || "")
      .split(/[,\n]/).map((b) => b.trim()).filter(Boolean)
      .filter((b) => !have.has(b.toUpperCase()));
  }, [settings.dealer_oem_brands, warranties]);

  const setW = (i: number, patch: Partial<OemFactoryWarranty>) =>
    setWarranties((prev) => prev.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  // Adding a franchised brand seeds the standard manufacturer terms from our
  // reference (when known) so the dealer reviews instead of retypes — Verified
  // stays OFF until they confirm.
  const addW = (brand = "") => {
    const ref = brand ? lookupOemReference(brand) : null;
    setWarranties((prev) => [...prev, ref ? { ...emptyOemWarranty(brand), ...ref, brand, verified: false } : emptyOemWarranty(brand)]);
  };
  // Re-pull the reference into an existing row (keeps the brand, drops verified).
  const fillFromReference = (i: number, brand: string) => {
    const ref = lookupOemReference(brand);
    if (ref) setW(i, { ...ref, verified: false, verified_at: undefined });
  };
  const removeW = (i: number) => setWarranties((prev) => prev.filter((_, j) => j !== i));
  const verifyW = (i: number, on: boolean) =>
    setW(i, on
      ? { verified: true, verified_at: new Date().toISOString(), verified_by: user?.email || undefined }
      : { verified: false, verified_at: undefined });

  const setP = (id: string, patch: Partial<CpoProgram>) =>
    setPrograms((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const addP = (kind: "oem" | "dealer") => setPrograms((prev) => [...prev, emptyCpoProgram(kind)]);
  const removeP = (id: string) => setPrograms((prev) => prev.filter((p) => p.id !== id));

  const input = "w-full h-9 px-2.5 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:border-primary";
  const num = `${input} tabular-nums`;
  const label = "text-[10px] font-bold uppercase tracking-wider text-muted-foreground";
  const area = "w-full px-2.5 py-2 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:border-primary resize-y";

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-base font-bold text-foreground">Factory Warranty &amp; CPO</h2>
        <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
          Verify each franchised brand's OEM factory-warranty terms — new cars show the matching
          brand's coverage on the customer passport. Only <span className="font-semibold">verified</span> terms
          are published. Below, list your CPO programs (manufacturer-certified and dealer-certified).
          Changes save automatically.
        </p>
        <p className="text-xs text-muted-foreground mt-1.5 max-w-xl">
          Adding your store's own warranty (lifetime powertrain, dealer pre-owned coverage)?
          That lives in <a href="/admin?tab=programs" className="font-semibold text-primary hover:underline">Included with Sale &amp; Warranties</a>.
        </p>
      </div>

      {/* ── OEM factory warranty by brand ── */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-emerald-600" /> OEM factory warranty</h3>

        {missingBrands.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border p-3">
            <span className="text-xs text-muted-foreground">Franchised brands without terms yet:</span>
            {missingBrands.map((b) => (
              <button key={b} onClick={() => addW(b)} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-border bg-card hover:bg-muted text-xs font-semibold">
                <Plus className="w-3 h-3" /> {b}
              </button>
            ))}
          </div>
        )}

        {warranties.length === 0 && missingBrands.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-6 text-center">
            <ShieldCheck className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No factory terms yet. Add a brand to get started.</p>
          </div>
        )}

        {warranties.map((w, i) => (
          <section key={i} className={`rounded-2xl border bg-card p-4 space-y-3 ${w.verified ? "border-emerald-200" : "border-border"}`}>
            <div className="flex items-center justify-between gap-3">
              <input value={w.brand} onChange={(e) => setW(i, { brand: e.target.value })} placeholder="Brand (e.g. INFINITI)" className="flex-1 min-w-0 h-9 px-2.5 rounded-lg border border-border bg-background text-sm font-semibold text-foreground outline-none focus:border-primary" />
              <span className="text-[11px] text-muted-foreground hidden sm:inline">{warrantyHeadline(w)}</span>
              {lookupOemReference(w.brand) && (
                <button onClick={() => fillFromReference(i, w.brand)} title="Fill standard manufacturer terms from the reference (you still verify)" className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-semibold shrink-0">
                  <Wand2 className="w-3.5 h-3.5" /> Auto-fill
                </button>
              )}
              <button onClick={() => removeW(i)} className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-border text-rose-600 hover:bg-rose-50 shrink-0" aria-label="Remove brand">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className={label}>Bumper-to-bumper (mo / mi)</label><Pair mo={w.basic_months} mi={w.basic_miles} onMo={(n) => setW(i, { basic_months: n })} onMi={(n) => setW(i, { basic_miles: n })} /></div>
              <div><label className={label}>Powertrain — original owner (mo / mi)</label><Pair mo={w.powertrain_months} mi={w.powertrain_miles} onMo={(n) => setW(i, { powertrain_months: n })} onMi={(n) => setW(i, { powertrain_miles: n })} /></div>
              <div>
                <label className={label}>Powertrain — second owner (mo / mi)</label>
                <Pair mo={w.powertrain_transfer_months} mi={w.powertrain_transfer_miles} onMo={(n) => setW(i, { powertrain_transfer_months: n })} onMi={(n) => setW(i, { powertrain_transfer_miles: n })} />
                <p className="text-[10px] text-muted-foreground mt-0.5">Leave blank if fully transferable. Used &amp; CPO cars show this.</p>
              </div>
              <div><label className={label}>Corrosion / rust-through (mo / mi)</label><Pair mo={w.corrosion_months} mi={w.corrosion_miles} onMo={(n) => setW(i, { corrosion_months: n })} onMi={(n) => setW(i, { corrosion_miles: n })} /></div>
              <div><label className={label}>Roadside assistance (mo / mi)</label><Pair mo={w.roadside_months} mi={w.roadside_miles} onMo={(n) => setW(i, { roadside_months: n })} onMi={(n) => setW(i, { roadside_miles: n })} /></div>
              <div><label className={label}>Hybrid / EV battery (mo / mi)</label><Pair mo={w.ev_battery_months} mi={w.ev_battery_miles} onMo={(n) => setW(i, { ev_battery_months: n })} onMi={(n) => setW(i, { ev_battery_miles: n })} /></div>
              <div><label className={label}>Complimentary maintenance (mo / mi)</label><Pair mo={w.maintenance_months} mi={w.maintenance_miles} onMo={(n) => setW(i, { maintenance_months: n })} onMi={(n) => setW(i, { maintenance_miles: n })} /></div>
            </div>

            <div>
              <label className={label}>Notes (optional)</label>
              <input value={w.notes || ""} onChange={(e) => setW(i, { notes: e.target.value })} placeholder="e.g. coverage runs from original in-service date" className={input} />
            </div>

            <label className="inline-flex items-center gap-2 cursor-pointer pt-1">
              <input type="checkbox" checked={w.verified} onChange={(e) => verifyW(i, e.target.checked)} />
              <span className="text-[13px] font-semibold text-foreground inline-flex items-center gap-1.5">
                <CheckCircle2 className={`w-4 h-4 ${w.verified ? "text-emerald-600" : "text-muted-foreground/40"}`} />
                I verified these match {w.brand || "the brand"}'s published warranty
              </span>
              {w.verified && w.verified_at && (
                <span className="text-[11px] text-muted-foreground">· {new Date(w.verified_at).toLocaleDateString()}{w.verified_by ? ` by ${w.verified_by}` : ""}</span>
              )}
            </label>
            {!w.verified && <p className="text-[11px] text-amber-700">Unverified — will not appear on the customer passport until you confirm.</p>}
          </section>
        ))}

        <button onClick={() => addW()} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl border border-border bg-card hover:bg-muted text-sm font-semibold text-foreground">
          <Plus className="w-4 h-4" /> Add brand
        </button>
      </section>

      {/* ── CPO programs ── */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5"><BadgeCheck className="w-4 h-4 text-blue-600" /> Certified Pre-Owned programs</h3>
        <p className="text-xs text-muted-foreground -mt-1">
          Manufacturer CPO programs are matched to a CPO listing by brand; dealer-certified programs apply to any make.
        </p>

        {programs.map((p) => (
          <section key={p.id} className={`rounded-2xl border bg-card p-4 space-y-3 ${p.enabled ? "border-border" : "border-border opacity-70"}`}>
            <div className="flex items-center justify-between gap-3">
              <input value={p.name} onChange={(e) => setP(p.id, { name: e.target.value })} placeholder="Program name" className="flex-1 min-w-0 h-9 px-2.5 rounded-lg border border-border bg-background text-sm font-semibold text-foreground outline-none focus:border-primary" />
              <div className="flex items-center gap-2 flex-shrink-0">
                <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={p.enabled} onChange={(e) => setP(p.id, { enabled: e.target.checked })} /> Enabled
                </label>
                <button onClick={() => removeP(p.id)} className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-border text-rose-600 hover:bg-rose-50" aria-label="Remove program">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={label}>Type</label>
                <select value={p.kind} onChange={(e) => setP(p.id, { kind: e.target.value as CpoProgram["kind"] })} className={input}>
                  <option value="oem">Manufacturer CPO</option>
                  <option value="dealer">Dealer Certified</option>
                </select>
              </div>
              <div>
                <label className={label}>{p.kind === "oem" ? "Brand" : "Brand (any)"}</label>
                <input value={p.brand || ""} onChange={(e) => setP(p.id, { brand: e.target.value })} disabled={p.kind === "dealer"} placeholder={p.kind === "oem" ? "e.g. INFINITI" : "All makes"} className={`${input} disabled:opacity-40`} />
              </div>
              <div>
                <label className={label}>Coverage runs from</label>
                <select value={p.coverage_from} onChange={(e) => setP(p.id, { coverage_from: e.target.value as CpoProgram["coverage_from"] })} className={input}>
                  <option value="in_service">Original in-service date</option>
                  <option value="purchase">CPO purchase date</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className={label}>CPO limited warranty (mo / mi)</label><Pair mo={p.basic_months} mi={p.basic_miles} onMo={(n) => setP(p.id, { basic_months: n })} onMi={(n) => setP(p.id, { basic_miles: n })} /></div>
              <div><label className={label}>CPO powertrain (mo / mi)</label><Pair mo={p.powertrain_months} mi={p.powertrain_miles} onMo={(n) => setP(p.id, { powertrain_months: n })} onMi={(n) => setP(p.id, { powertrain_miles: n })} /></div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div><label className={label}>Deductible ($)</label><input type="number" min={0} value={p.deductible ?? ""} onChange={(e) => setP(p.id, { deductible: Number(e.target.value) || 0 })} className={num} /></div>
              <div><label className={label}>Max age (yrs)</label><input type="number" min={0} value={p.max_age_years ?? ""} onChange={(e) => setP(p.id, { max_age_years: Number(e.target.value) || 0 })} className={num} /></div>
              <div><label className={label}>Max mileage</label><input type="number" min={0} value={p.max_mileage ?? ""} onChange={(e) => setP(p.id, { max_mileage: Number(e.target.value) || 0 })} className={num} /></div>
              <div><label className={label}>Inspection</label><input value={p.inspection_points || ""} onChange={(e) => setP(p.id, { inspection_points: e.target.value })} placeholder="172-point" className={input} /></div>
            </div>

            <div>
              <label className={label}>Benefits — roadside, loaner, trial subscriptions…</label>
              <input value={p.benefits || ""} onChange={(e) => setP(p.id, { benefits: e.target.value })} placeholder="24/7 roadside, rental reimbursement, SiriusXM trial" className={input} />
            </div>
            <div>
              <label className={label}>Disclosure</label>
              <textarea value={p.disclosure || ""} onChange={(e) => setP(p.id, { disclosure: e.target.value })} rows={2} placeholder="See dealer for full program terms, exclusions, and deductible." className={area} />
            </div>

            <div className="flex flex-wrap items-center gap-4 pt-1">
              <label className="inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground cursor-pointer">
                <input type="checkbox" checked={p.transferable ?? false} onChange={(e) => setP(p.id, { transferable: e.target.checked })} /> Transferable
              </label>
              <label className="inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground cursor-pointer">
                <input type="checkbox" checked={p.show_on_passport} onChange={(e) => setP(p.id, { show_on_passport: e.target.checked })} /> Show on customer passport
              </label>
            </div>
          </section>
        ))}

        <div className="flex flex-wrap gap-2">
          <button onClick={() => addP("oem")} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl border border-border bg-card hover:bg-muted text-sm font-semibold text-foreground">
            <Plus className="w-4 h-4" /> Add manufacturer CPO
          </button>
          <button onClick={() => addP("dealer")} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl border border-border bg-card hover:bg-muted text-sm font-semibold text-foreground">
            <Plus className="w-4 h-4" /> Add dealer CPO
          </button>
        </div>
      </section>
    </div>
  );
}
