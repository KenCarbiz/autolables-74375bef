import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Gift, Loader2 } from "lucide-react";

// Customer-facing OEM incentives section on the Vehicle Passport. Entirely
// dealer-controlled: it renders NOTHING unless the dealer turned incentives on
// in Admin > Incentives. Offers come from marketcheck_vehicle_cache (nightly
// dealer-ZIP pull); customer-ZIP mode looks up offers on demand via the
// marketcheck-incentives edge function (degrades to "see dealer" if absent).

interface Incentive {
  type?: string;
  amount?: number;
  rate?: string;
  description?: string;
  expiration?: string;
  eligibility?: string;
  scope?: string;
  [k: string]: unknown;
}
interface Settings {
  incentives_enabled: boolean;
  incentive_zip_mode: "dealer" | "customer" | "both";
  incentives_disclaimer?: string | null;
}

const DEFAULT_DISCLAIMER =
  "Incentive offers are subject to change. See dealer for complete details and eligibility requirements.";
const asArray = (v: unknown): Incentive[] => (Array.isArray(v) ? (v as Incentive[]) : []);

const IncentiveCard = ({ inc }: { inc: Incentive }) => {
  const headline =
    inc.rate ||
    (typeof inc.amount === "number" ? `$${inc.amount.toLocaleString()} ${inc.type || "Customer Cash"}` : inc.type || "Offer");
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-foreground">{headline}</p>
        {inc.type && (
          <span className="text-[10px] font-bold uppercase tracking-wide text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded shrink-0">
            {inc.type}
          </span>
        )}
      </div>
      {inc.description && <p className="text-xs text-muted-foreground mt-0.5">{inc.description}</p>}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {inc.expiration && <span>Offer expires {inc.expiration}</span>}
        <span>{inc.eligibility || "Well-qualified buyers. See dealer for details."}</span>
      </div>
    </div>
  );
};

const ZipForm = ({ zip, setZip, onSubmit, busy, cta }: { zip: string; setZip: (v: string) => void; onSubmit: () => void; busy: boolean; cta: string }) => (
  <div className="flex gap-2">
    <input
      value={zip}
      onChange={(e) => setZip(e.target.value.replace(/[^\d]/g, ""))}
      inputMode="numeric"
      maxLength={5}
      placeholder="ZIP code"
      className="h-10 w-32 rounded-lg border border-border bg-background px-3 text-sm"
    />
    <button
      type="button"
      onClick={onSubmit}
      disabled={busy || !/^\d{5}$/.test(zip.trim())}
      className="h-10 px-4 rounded-lg bg-blue-600 text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
    >
      {busy && <Loader2 className="w-4 h-4 animate-spin" />} {cta}
    </button>
  </div>
);

export default function IncentivesSection({
  tenantId,
  vin,
  dealerCity,
  dealerState,
}: {
  tenantId?: string | null;
  vin?: string | null;
  dealerCity?: string | null;
  dealerState?: string | null;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [dealerOffers, setDealerOffers] = useState<Incentive[]>([]);
  const [loading, setLoading] = useState(true);
  const [zip, setZip] = useState("");
  const [zipOffers, setZipOffers] = useState<Incentive[] | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!tenantId) { setLoading(false); return; }
      try {
        const { data: s } = await (supabase as any)
          .from("tenant_incentive_settings")
          .select("incentives_enabled, incentive_zip_mode, incentives_disclaimer")
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (!active) return;
        setSettings(s || null);
        if (s?.incentives_enabled && vin) {
          const { data: c } = await (supabase as any)
            .from("marketcheck_vehicle_cache")
            .select("incentives_dealer_zip")
            .eq("tenant_id", tenantId)
            .eq("vin", vin)
            .maybeSingle();
          if (active) setDealerOffers(asArray(c?.incentives_dealer_zip));
        }
      } catch { /* table may not be migrated yet — stay hidden */ }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [tenantId, vin]);

  // Dealer turned it off (or no row) → render nothing at all.
  if (loading || !settings || !settings.incentives_enabled) return null;

  const mode = settings.incentive_zip_mode || "dealer";
  const disclaimer = settings.incentives_disclaimer || DEFAULT_DISCLAIMER;
  const dealerLoc = [dealerCity, dealerState].filter(Boolean).join(", ");

  const lookupZip = async () => {
    const z = zip.trim();
    if (!/^\d{5}$/.test(z)) return;
    setLookingUp(true);
    try {
      const { data } = await supabase.functions.invoke("marketcheck-incentives", {
        body: { tenant_id: tenantId, vin, zip: z },
      });
      setZipOffers(asArray((data as Record<string, unknown> | null)?.incentives));
    } catch {
      setZipOffers([]);
    }
    setLookingUp(false);
  };

  const OfferList = ({ offers }: { offers: Incentive[] }) =>
    offers.length > 0 ? (
      <div className="space-y-2">{offers.map((inc, i) => <IncentiveCard key={i} inc={inc} />)}</div>
    ) : (
      <p className="text-sm text-muted-foreground">See dealer for current financing offers.</p>
    );

  // customer mode: prompt for ZIP before showing anything
  if (mode === "customer") {
    return (
      <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
        <div className="flex items-center gap-2 mb-1">
          <Gift className="w-4 h-4 text-blue-600" />
          <h2 className="text-base font-bold text-foreground">
            {zipOffers != null ? `Available Offers in Your Area (${zip})` : "Available Offers in Your Area"}
          </h2>
        </div>
        {zipOffers == null ? (
          <div className="mt-2 space-y-2">
            <p className="text-sm text-muted-foreground">Enter your ZIP code to see incentives available in your area.</p>
            <ZipForm zip={zip} setZip={setZip} onSubmit={lookupZip} busy={lookingUp} cta="See offers" />
          </div>
        ) : (
          <div className="mt-3"><OfferList offers={zipOffers} /></div>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">{disclaimer}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">Based on {zip || "your ZIP"} as of {new Date().toLocaleDateString()}.</p>
      </section>
    );
  }

  // dealer or both mode: show dealer-location offers, optionally let the
  // customer enter a ZIP to compare.
  return (
    <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
      <div className="flex items-center gap-2 mb-1">
        <Gift className="w-4 h-4 text-blue-600" />
        <h2 className="text-base font-bold text-foreground">Available Offers{dealerLoc ? ` in ${dealerLoc}` : ""}</h2>
      </div>
      <div className="mt-3"><OfferList offers={dealerOffers} /></div>

      {mode === "both" && (
        <div className="mt-3 pt-3 border-t border-border space-y-2">
          <p className="text-xs font-semibold text-foreground">See offers for your ZIP code</p>
          <ZipForm zip={zip} setZip={setZip} onSubmit={lookupZip} busy={lookingUp} cta="Compare" />
          {zipOffers != null && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Offers in your area ({zip})</p>
              <OfferList offers={zipOffers} />
            </div>
          )}
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">{disclaimer}</p>
      <p className="mt-1 text-[10px] text-muted-foreground">Based on {dealerLoc || "dealer location"} as of {new Date().toLocaleDateString()}.</p>
    </section>
  );
}
