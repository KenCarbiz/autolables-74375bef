import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useTenant } from "@/contexts/TenantContext";
import { useStickerPrefs } from "@/lib/stickerStudio/useStickerPrefs";
import { useDealerPrintSettings } from "@/lib/stickerStudio/useDealerPrintSettings";

// ──────────────────────────────────────────────────────────────────────
// Dealer setup status. Computes a go-live checklist by READING the existing
// settings surfaces (DealerSettings, sticker prefs, print settings) plus a
// light inventory probe. It does not store its own state — each step links to
// the screen that owns that config, so there is no duplicate setup data.
// ──────────────────────────────────────────────────────────────────────

export interface SetupStep {
  id: string;
  label: string;
  done: boolean;
  optional?: boolean;
  to: string;          // route the step opens
  hint: string;
}

export interface SetupStatus {
  steps: SetupStep[];
  completed: number;
  total: number;
  score: number;       // 0–100, required steps only
  ready: boolean;      // all required steps done
  loading: boolean;
}

export function useSetupStatus(): SetupStatus {
  const { settings, loading: sLoading } = useDealerSettings();
  const { tenant } = useTenant();
  const { defaults } = useStickerPrefs();
  const { calibration, loading: pLoading } = useDealerPrintSettings();
  const [inv, setInv] = useState({ vehicles: 0, published: 0, loading: true });

  useEffect(() => {
    if (!tenant?.id) { setInv((s) => ({ ...s, loading: false })); return; }
    let cancelled = false;
    (async () => {
      try {
        // deno-lint-ignore no-explicit-any
        const sb = supabase as any;
        const [{ count: vehicles }, { count: published }] = await Promise.all([
          sb.from("vehicle_listings").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
          sb.from("vehicle_listings").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).eq("status", "published"),
        ]);
        if (!cancelled) setInv({ vehicles: vehicles || 0, published: published || 0, loading: false });
      } catch { if (!cancelled) setInv((s) => ({ ...s, loading: false })); }
    })();
    return () => { cancelled = true; };
  }, [tenant?.id]);

  const profileDone = !!(settings.dealer_name && settings.dealer_name !== "Your Dealership" && settings.dealer_phone && (settings.dealer_city || settings.dealer_address) && settings.dealer_state);
  const brandingDone = !!settings.dealer_logo_url;
  const templatesDone = !!(defaults.window || defaults.addendum);
  const printDone = !!(calibration.printerName || calibration.xOffsetIn !== 0 || calibration.yOffsetIn !== 0 || calibration.scalePct !== 100);
  const rulesDone = !!settings.document_rules;
  const inventoryDone = inv.vehicles > 0;
  const passportDone = inv.published > 0;

  const steps: SetupStep[] = [
    { id: "profile", label: "Dealership profile", done: profileDone, to: "/admin?tab=branding", hint: "Name, address, phone, and operating state." },
    { id: "branding", label: "Branding & logo", done: brandingDone, to: "/admin?tab=branding", hint: "Upload your logo and set brand colors." },
    { id: "templates", label: "Default sticker templates", done: templatesDone, to: "/sticker-studio", hint: "Pick a default window and addendum template." },
    { id: "print", label: "Print settings & calibration", done: printDone, optional: true, to: "/admin?tab=print-settings", hint: "Calibrate how stickers land on your label stock." },
    { id: "rules", label: "Document workflow rules", done: rulesDone, optional: true, to: "/admin?tab=document-rules", hint: "Approval, stale, and packet rules for your store." },
    { id: "inventory", label: "Inventory connected", done: inventoryDone, to: "/inventory", hint: "Vehicles from your website/feed appear here." },
    { id: "passport", label: "Vehicle Passport live", done: passportDone, to: "/inventory", hint: "Publish a vehicle to activate its scan page." },
  ];

  const required = steps.filter((s) => !s.optional);
  const completedRequired = required.filter((s) => s.done).length;

  return {
    steps,
    completed: steps.filter((s) => s.done).length,
    total: steps.length,
    score: Math.round((completedRequired / required.length) * 100),
    ready: completedRequired === required.length,
    loading: sLoading || pLoading || inv.loading,
  };
}
