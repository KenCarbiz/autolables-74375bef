import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { toast } from "sonner";
import { Gift, Loader2 } from "lucide-react";

// Dealer-controlled OEM incentive display settings. Backs the customer-facing
// incentives section on the window sticker + Vehicle Passport. Reads/writes
// tenant_incentive_settings (one row per tenant). Defensive: if the table
// hasn't been migrated yet the panel still renders with defaults.

type ZipMode = "dealer" | "customer" | "both";
const DEFAULT_DISCLAIMER =
  "Incentive offers are subject to change. See dealer for complete details and eligibility requirements.";

const ZIP_MODES: { v: ZipMode; label: string; hint: string }[] = [
  { v: "dealer", label: "Use dealer location", hint: "Show offers for the dealership ZIP. No customer input needed." },
  { v: "customer", label: "Ask customer for ZIP", hint: "Customer enters their ZIP on the passport for offers in their area." },
  { v: "both", label: "Show both", hint: "Show dealer offers by default; let the customer optionally enter their ZIP." },
];

export const IncentivesSettingsPanel = () => {
  const { tenant } = useTenant();
  const { user } = useAuth();
  const { settings } = useDealerSettings();
  const s = settings as unknown as Record<string, unknown>;
  const dealerZip = String(s.dealer_zip || s.dealer_postal_code || "");

  const [enabled, setEnabled] = useState(false);
  const [zipMode, setZipMode] = useState<ZipMode>("dealer");
  const [zipOverride, setZipOverride] = useState("");
  const [disclaimer, setDisclaimer] = useState(DEFAULT_DISCLAIMER);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!tenant?.id) { setLoading(false); return; }
      const { data, error } = await (supabase as any)
        .from("tenant_incentive_settings")
        .select("incentives_enabled, incentive_zip_mode, dealer_zip_override, incentives_disclaimer")
        .eq("tenant_id", tenant.id)
        .maybeSingle();
      if (!active) return;
      if (error && /does not exist|schema cache|could not find/i.test(error.message || "")) {
        setTableMissing(true);
      } else if (data) {
        setEnabled(!!data.incentives_enabled);
        setZipMode((data.incentive_zip_mode as ZipMode) || "dealer");
        setZipOverride(data.dealer_zip_override || "");
        setDisclaimer(data.incentives_disclaimer || DEFAULT_DISCLAIMER);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [tenant?.id]);

  // Prefill the dealer ZIP from the profile the first time, if none is set.
  useEffect(() => {
    setZipOverride((cur) => (cur ? cur : dealerZip));
  }, [dealerZip]);

  const save = async () => {
    if (!tenant?.id) { toast.error("No active dealership"); return; }
    setSaving(true);
    const { error } = await (supabase as any)
      .from("tenant_incentive_settings")
      .upsert({
        tenant_id: tenant.id,
        incentives_enabled: enabled,
        incentive_zip_mode: zipMode,
        dealer_zip_override: zipOverride.trim() || null,
        incentives_disclaimer: disclaimer.trim() || DEFAULT_DISCLAIMER,
        updated_by: user?.id || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "tenant_id" });
    setSaving(false);
    if (error) { toast.error("Could not save: " + error.message); return; }
    toast.success("Incentive settings saved");
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading incentive settings…</p>;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm p-5 space-y-4 max-w-2xl">
      <div className="flex items-center gap-2">
        <Gift className="w-4 h-4 text-blue-600" />
        <h3 className="text-sm font-bold text-foreground">OEM Incentives</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Control whether manufacturer rebates and financing offers appear on your window stickers and customer Vehicle
        Passport pages.
      </p>

      {tableMissing && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          The incentive settings table isn't in the database yet. Apply the incentives migration, then reload this page.
        </div>
      )}

      <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Show incentives to customers</p>
          <p className="text-[11px] text-muted-foreground">When off, the incentives section is hidden on stickers and passports.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled((v) => !v)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? "bg-blue-600" : "bg-slate-300"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>

      {enabled && (
        <>
          <div className="rounded-xl border border-border p-3 space-y-2.5">
            <p className="text-sm font-semibold text-foreground">Which area's offers to show</p>
            {ZIP_MODES.map((o) => (
              <label key={o.v} className="flex items-start gap-2.5 cursor-pointer">
                <input type="radio" name="incentive-zip-mode" checked={zipMode === o.v} onChange={() => setZipMode(o.v)} className="mt-1" />
                <span>
                  <span className="text-sm font-medium text-foreground">{o.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>

          {(zipMode === "dealer" || zipMode === "both") && (
            <div>
              <label className="text-xs font-semibold text-foreground">Dealer ZIP for incentive lookups</label>
              <input
                value={zipOverride}
                onChange={(e) => setZipOverride(e.target.value)}
                placeholder={dealerZip || "ZIP code"}
                className="mt-1 h-9 w-40 rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-foreground">Incentives disclaimer</label>
            <textarea
              value={disclaimer}
              onChange={(e) => setDisclaimer(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <p className="text-[11px] text-muted-foreground mt-1">Shown beneath the offers on the customer passport.</p>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
      >
        {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save settings
      </button>
    </div>
  );
};

export default IncentivesSettingsPanel;
