import { useState } from "react";
import { useDealerSettings, type DealerSettings } from "@/contexts/DealerSettingsContext";
import { toast } from "sonner";
import { Save, Plus, Trash2 } from "lucide-react";
import type { IihsAward } from "@/lib/iihsAwards";

// Dealer admin: the trust content shown on the Vehicle Passport's
// "Why Buy From This Dealership" badges and "What Owners Say" reviews.
// Everything here is optional — each badge/review renders on the passport
// only when the dealer fills it in, so nothing is fabricated.
type TrustKey =
  | "dealer_years_in_business" | "dealer_satisfaction" | "dealer_bbb_rating"
  | "dealer_google_rating" | "dealer_google_count" | "dealer_certifications"
  | "dealer_storefront_url" | "dealer_review_sources"
  | "dealer_advisor_name" | "dealer_advisor_title" | "dealer_advisor_photo" | "dealer_advisor_response"
  | "dealer_family_owned" | "dealer_service_location" | "dealer_service_address" | "dealer_delivery"
  | "dealer_financing" | "dealer_amenities" | "dealer_services" | "dealer_hours"
  | "mobile_slideout_cta_variant";

const FIELDS: { key: TrustKey; label: string; placeholder: string; hint?: string; wide?: boolean }[] = [
  { key: "dealer_years_in_business", label: "Years in business", placeholder: "45" },
  { key: "dealer_satisfaction", label: "Customer satisfaction", placeholder: "98%" },
  { key: "dealer_google_rating", label: "Google rating", placeholder: "4.9" },
  { key: "dealer_google_count", label: "Google review count", placeholder: "1248" },
  { key: "dealer_bbb_rating", label: "BBB rating", placeholder: "A+" },
  { key: "dealer_storefront_url", label: "Dealership photo URL", placeholder: "https://…/storefront.jpg", wide: true },
  { key: "dealer_certifications", label: "Awards & certifications", placeholder: "INFINITI Award of Excellence, 2024 Consumer Satisfaction", hint: "Comma-separated.", wide: true },
];

const ADVISOR_FIELDS: { key: TrustKey; label: string; placeholder: string }[] = [
  { key: "dealer_advisor_name", label: "Advisor name", placeholder: "John Smith" },
  { key: "dealer_advisor_title", label: "Advisor title", placeholder: "Senior Vehicle Specialist" },
  { key: "dealer_advisor_photo", label: "Advisor photo URL", placeholder: "https://…/advisor.jpg" },
  { key: "dealer_advisor_response", label: "Typical response time", placeholder: "Usually replies within 5 minutes" },
];

const DealershipTrustPanel = () => {
  const { settings, updateSettings } = useDealerSettings();
  const [cfg, setCfg] = useState<Record<TrustKey, string>>(() => ({
    dealer_years_in_business: settings.dealer_years_in_business || "",
    dealer_satisfaction: settings.dealer_satisfaction || "",
    dealer_bbb_rating: settings.dealer_bbb_rating || "",
    dealer_google_rating: settings.dealer_google_rating || "",
    dealer_google_count: settings.dealer_google_count || "",
    dealer_certifications: settings.dealer_certifications || "",
    dealer_storefront_url: settings.dealer_storefront_url || "",
    dealer_review_sources: settings.dealer_review_sources || "",
    dealer_advisor_name: settings.dealer_advisor_name || "",
    dealer_advisor_title: settings.dealer_advisor_title || "",
    dealer_advisor_photo: settings.dealer_advisor_photo || "",
    dealer_advisor_response: settings.dealer_advisor_response || "",
    dealer_family_owned: settings.dealer_family_owned || "",
    dealer_service_location: settings.dealer_service_location || "",
    dealer_service_address: settings.dealer_service_address || "",
    dealer_delivery: settings.dealer_delivery || "",
    dealer_financing: settings.dealer_financing || "",
    dealer_amenities: settings.dealer_amenities || "",
    dealer_services: settings.dealer_services || "",
    dealer_hours: settings.dealer_hours || "",
    mobile_slideout_cta_variant: settings.mobile_slideout_cta_variant || "dealer_availability",
  }));
  const [saving, setSaving] = useState(false);
  const [iihsEnabled, setIihsEnabled] = useState<boolean>(settings.iihs_awards_enabled || false);
  const [iihsAwards, setIihsAwards] = useState<IihsAward[]>(settings.iihs_awards || []);

  const set = (k: TrustKey, v: string) => setCfg((c) => ({ ...c, [k]: v }));
  const patchAward = (i: number, p: Partial<IihsAward>) => setIihsAwards((a) => a.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const save = async () => {
    setSaving(true);
    const ok = await updateSettings({
      ...cfg,
      iihs_awards_enabled: iihsEnabled,
      iihs_awards: iihsAwards.filter((a) => a.year.trim() && a.make.trim() && a.model.trim()),
    } as Partial<DealerSettings>);
    setSaving(false);
    if (ok !== false) toast.success("Dealership trust content saved");
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[22px] font-bold tracking-tight text-foreground">Passport Dealership Trust</h2>
          <p className="text-sm text-slate-500 mt-1">Credibility badges and reviews shown to shoppers on the Vehicle Passport. Every field is optional — only what you fill in appears, so nothing is fabricated.</p>
        </div>
        <button onClick={save} disabled={saving} className="shrink-0 inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {FIELDS.map((f) => (
          <div key={f.key} className={f.wide ? "sm:col-span-2" : ""}>
            <label className="text-[13px] font-semibold text-foreground">{f.label}</label>
            <input value={cfg[f.key]} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder}
              className="mt-1 w-full h-10 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary" />
            {f.hint && <p className="text-[11px] text-slate-400 mt-1">{f.hint}</p>}
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <label className="text-[13px] font-semibold text-foreground">Review sources</label>
        <p className="text-[12px] text-slate-500 mt-0.5">One per line, formatted <code className="text-[11px] bg-muted px-1 rounded">Source | rating | quote</code>. Example: <span className="text-slate-600">Google | 4.9 | Spacious, comfortable, and packed with technology.</span></p>
        <textarea value={cfg.dealer_review_sources} onChange={(e) => set("dealer_review_sources", e.target.value)} rows={5}
          placeholder={"Google | 4.9 | Excellent family SUV. Very smooth ride.\nEdmunds | 4.7 | Quiet, comfortable, and packed with tech.\nCars.com | 4.8 | Luxury feel without the luxury price."}
          className="mt-2 w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary resize-none font-mono text-[12px]" />
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-[14px] font-bold text-foreground">Amenities & services</h3>
        <p className="text-[12px] text-slate-500 mt-0.5 mb-3">Drives the "Why Buy From Us" section. Only what you set appears — nothing is assumed.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-[13px] font-semibold text-foreground">Family owned</label>
            <select value={cfg.dealer_family_owned} onChange={(e) => set("dealer_family_owned", e.target.value)} className="mt-1 w-full h-10 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary">
              <option value="">Not specified</option><option value="yes">Yes</option>
            </select>
          </div>
          <div>
            <label className="text-[13px] font-semibold text-foreground">Service department</label>
            <select value={cfg.dealer_service_location} onChange={(e) => set("dealer_service_location", e.target.value)} className="mt-1 w-full h-10 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary">
              <option value="">Not specified</option><option value="onsite">On-site (same location as sales)</option><option value="offsite">Off-site (separate location)</option><option value="none">No service department</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-[13px] font-semibold text-foreground">Off-site service address</label>
            <input value={cfg.dealer_service_address} onChange={(e) => set("dealer_service_address", e.target.value)} placeholder="123 Service Rd, City, ST (only if off-site)" className="mt-1 w-full h-10 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label className="text-[13px] font-semibold text-foreground">Vehicle delivery</label>
            <select value={cfg.dealer_delivery} onChange={(e) => set("dealer_delivery", e.target.value)} className="mt-1 w-full h-10 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary">
              <option value="">Not specified</option><option value="none">Not offered</option><option value="local">Local</option><option value="regional">Regional</option><option value="nationwide">Nationwide</option>
            </select>
          </div>
          <div>
            <label className="text-[13px] font-semibold text-foreground">Financing on-site</label>
            <select value={cfg.dealer_financing} onChange={(e) => set("dealer_financing", e.target.value)} className="mt-1 w-full h-10 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary">
              <option value="">Not specified</option><option value="yes">Yes</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-[13px] font-semibold text-foreground">Services offered</label>
            <input value={cfg.dealer_services} onChange={(e) => set("dealer_services", e.target.value)} placeholder="OEM parts, Warranty repairs, Online scheduling, State inspection, Express service" className="mt-1 w-full h-10 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary" />
            <p className="text-[11px] text-slate-400 mt-1">Comma-separated. Only listed services appear on the Passport.</p>
          </div>
          <div className="sm:col-span-2">
            <label className="text-[13px] font-semibold text-foreground">Amenities</label>
            <input value={cfg.dealer_amenities} onChange={(e) => set("dealer_amenities", e.target.value)} placeholder="Customer lounge, Café, Kids area, EV charging, Loaner vehicles" className="mt-1 w-full h-10 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary" />
            <p className="text-[11px] text-slate-400 mt-1">Comma-separated.</p>
          </div>
          <div className="sm:col-span-2">
            <label className="text-[13px] font-semibold text-foreground">Hours</label>
            <input value={cfg.dealer_hours} onChange={(e) => set("dealer_hours", e.target.value)} placeholder="Mon–Sat 9–7, Sun closed" className="mt-1 w-full h-10 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-[13px] font-semibold text-foreground">Mobile Slide-Out CTA Style</label>
            <select value={cfg.mobile_slideout_cta_variant} onChange={(e) => set("mobile_slideout_cta_variant", e.target.value)} className="mt-1 w-full h-10 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary">
              <option value="dealer_availability">Dealer Availability CTA — Default</option>
              <option value="context_aware">Context-Aware CTA</option>
              <option value="two_button">Two Button Layout</option>
              <option value="progressive">Progressive CTA</option>
            </select>
            <p className="text-[11px] text-slate-400 mt-1">How the bottom action area appears inside mobile Passport slide-outs.</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-bold text-foreground">IIHS Top Safety Pick awards</h3>
            <p className="text-[12px] text-slate-500 mt-0.5">IIHS ratings are copyrighted — display requires IIHS's written permission. Keep this OFF until permission is granted, then verify each model against iihs.org/ratings/top-safety-picks before adding it. Text statements only; no IIHS logos.</p>
          </div>
          <label className="flex items-center gap-2 shrink-0 cursor-pointer select-none">
            <input type="checkbox" checked={iihsEnabled} onChange={(e) => setIihsEnabled(e.target.checked)} className="w-4 h-4 accent-blue-600" />
            <span className="text-[13px] font-semibold">{iihsEnabled ? "Enabled" : "Off"}</span>
          </label>
        </div>
        <div className="mt-3 space-y-2">
          {iihsAwards.map((a, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-[80px_1fr_1fr_150px_auto] gap-2 items-center">
              <input value={a.year} onChange={(e) => patchAward(i, { year: e.target.value })} placeholder="2026" className="h-10 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary" />
              <input value={a.make} onChange={(e) => patchAward(i, { make: e.target.value })} placeholder="INFINITI" className="h-10 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary" />
              <input value={a.model} onChange={(e) => patchAward(i, { model: e.target.value })} placeholder="QX60" className="h-10 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary" />
              <select value={a.award} onChange={(e) => patchAward(i, { award: e.target.value as IihsAward["award"] })} className="h-10 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary">
                <option value="tsp">Top Safety Pick</option>
                <option value="tsp_plus">Top Safety Pick+</option>
              </select>
              <button onClick={() => setIihsAwards((arr) => arr.filter((_, j) => j !== i))} aria-label="Remove award" className="w-10 h-10 rounded-lg border border-border text-slate-400 hover:text-red-500 hover:border-red-300 inline-flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <button onClick={() => setIihsAwards((a) => [...a, { year: "", make: "", model: "", award: "tsp_plus" }])} className="inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-border text-[13px] font-semibold hover:border-blue-500"><Plus className="w-4 h-4" /> Add award</button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-[14px] font-bold text-foreground">Sales advisor</h3>
        <p className="text-[12px] text-slate-500 mt-0.5 mb-3">Shown in the passport's conversion panel. Leave blank to show a generic specialist card instead.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {ADVISOR_FIELDS.map((f) => (
            <div key={f.key} className={f.key === "dealer_advisor_photo" || f.key === "dealer_advisor_response" ? "sm:col-span-2" : ""}>
              <label className="text-[13px] font-semibold text-foreground">{f.label}</label>
              <input value={cfg[f.key]} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder}
                className="mt-1 w-full h-10 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DealershipTrustPanel;
