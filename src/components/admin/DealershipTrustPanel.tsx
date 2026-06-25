import { useState } from "react";
import { useDealerSettings, type DealerSettings } from "@/contexts/DealerSettingsContext";
import { toast } from "sonner";
import { Save } from "lucide-react";

// Dealer admin: the trust content shown on the Vehicle Passport's
// "Why Buy From This Dealership" badges and "What Owners Say" reviews.
// Everything here is optional — each badge/review renders on the passport
// only when the dealer fills it in, so nothing is fabricated.
type TrustKey =
  | "dealer_years_in_business" | "dealer_satisfaction" | "dealer_bbb_rating"
  | "dealer_google_rating" | "dealer_google_count" | "dealer_certifications"
  | "dealer_storefront_url" | "dealer_review_sources";

const FIELDS: { key: TrustKey; label: string; placeholder: string; hint?: string; wide?: boolean }[] = [
  { key: "dealer_years_in_business", label: "Years in business", placeholder: "45" },
  { key: "dealer_satisfaction", label: "Customer satisfaction", placeholder: "98%" },
  { key: "dealer_google_rating", label: "Google rating", placeholder: "4.9" },
  { key: "dealer_google_count", label: "Google review count", placeholder: "1248" },
  { key: "dealer_bbb_rating", label: "BBB rating", placeholder: "A+" },
  { key: "dealer_storefront_url", label: "Dealership photo URL", placeholder: "https://…/storefront.jpg", wide: true },
  { key: "dealer_certifications", label: "Awards & certifications", placeholder: "INFINITI Award of Excellence, 2024 Consumer Satisfaction", hint: "Comma-separated.", wide: true },
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
  }));
  const [saving, setSaving] = useState(false);

  const set = (k: TrustKey, v: string) => setCfg((c) => ({ ...c, [k]: v }));
  const save = async () => {
    setSaving(true);
    const ok = await updateSettings(cfg as Partial<DealerSettings>);
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
    </div>
  );
};

export default DealershipTrustPanel;
