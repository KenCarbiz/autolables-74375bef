import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";
import { Card, EmptyNote, Pair, StatRow, btn, btnPrimary, fmtWhen } from "./primitives";
import type { VehicleRow } from "./types";
import { feeExclusiveEquivalent } from "@/components/compliance/complianceData";
import { EVIDENCE_UNAVAILABLE_MESSAGE, signPriceEvidenceUrl } from "@/lib/evidence/priceEvidenceUrl";
import { presentLegacyPosition } from "@/lib/market/presentation";

// Price integrity for one VIN.
//
// Any gap between the lot/sticker price on vehicle_listings and the latest
// price captured for a channel in advertised_prices is a potential "advertised
// one price, charged another" exposure under FTC Act section 5. Read-only, with
// a $1 tolerance so any real drift flags.

const TOLERANCE = 1;

interface AdRow {
  advertised_price: number;
  source_channel: string;
  source_url: string | null;
  captured_at: string;
  screenshot_url: string | null;
  screenshot_bucket: string | null;
}

type EvidenceState = "opening" | "unavailable";

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

const AdvertisedPriceCard = ({ vehicle }: { vehicle: VehicleRow }) => {
  const [rows, setRows] = useState<AdRow[] | null>(null);
  const [evidence, setEvidence] = useState<Record<string, EvidenceState>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!vehicle.tenant_id) { setRows([]); return; }
      // deno-lint-ignore no-explicit-any
      const { data } = await (supabase as unknown as { from: (t: string) => any })
        .from("advertised_prices")
        .select("advertised_price, source_channel, source_url, captured_at, screenshot_url, screenshot_bucket")
        .eq("tenant_id", vehicle.tenant_id)
        .eq("vin", vehicle.vin.toUpperCase())
        .order("captured_at", { ascending: false })
        .limit(100);
      if (!cancelled) setRows((data || []) as AdRow[]);
    })();
    return () => { cancelled = true; };
  }, [vehicle.tenant_id, vehicle.vin]);

  // One row per channel: the newest capture is the price live on that channel.
  const latestByChannel = new Map<string, AdRow>();
  for (const r of rows || []) if (!latestByChannel.has(r.source_channel)) latestByChannel.set(r.source_channel, r);
  const channels = [...latestByChannel.values()];
  const lot = vehicle.price;
  // A website channel may show the fee-inclusive total ($25,876 = $24,981 plus
  // an $895 conveyance fee) while the lot price is fee-exclusive. The crawl
  // stored both halves of that ladder, so the comparable figure is known
  // exactly rather than guessed at with a wider tolerance.
  const comparable = (c: AdRow): number =>
    feeExclusiveEquivalent(c.advertised_price, vehicle) ?? c.advertised_price;
  const mismatches = lot == null
    ? []
    : channels.filter((c) => Math.abs(comparable(c) - lot) > TOLERANCE);

  // Signed under the viewer's own session so storage RLS decides access; a
  // fresh short-lived link is minted per click rather than one per row on load.
  const openEvidence = async (c: AdRow) => {
    setEvidence((m) => ({ ...m, [c.source_channel]: "opening" }));
    const res = await signPriceEvidenceUrl(supabase, c);
    if (!res.url) {
      setEvidence((m) => ({ ...m, [c.source_channel]: "unavailable" }));
      return;
    }
    setEvidence((m) => { const next = { ...m }; delete next[c.source_channel]; return next; });
    window.open(res.url, "_blank", "noopener");
  };

  return (
    <Card title="Advertised price consistency" action={
      channels.length === 0 ? undefined : (
        <span className={`text-al-meta font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
          mismatches.length ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
        }`}>{mismatches.length ? `${mismatches.length} mismatch` : "Consistent"}</span>
      )
    }>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-5">
        <Pair label="Lot / sticker price" value={lot != null ? money(lot) : "Not priced"} />
        <Pair label="Channels captured" value={channels.length.toLocaleString()} />
        <Pair label="Last capture" value={channels.length ? (fmtWhen(channels[0].captured_at) ?? "Unknown") : "Never"} />
      </div>

      {rows === null ? (
        <p className="text-al-body text-muted-foreground">Loading captured prices…</p>
      ) : channels.length === 0 ? (
        <EmptyNote
          title="No advertised price captured for this VIN"
          detail="The nightly crawler records the live price from each channel it has a URL for. Until a capture exists there is nothing to reconcile against the lot price."
        />
      ) : lot == null ? (
        <p className="text-al-body text-amber-700 inline-flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 shrink-0" /> This vehicle has no lot price, so captured advertised prices cannot be reconciled.
        </p>
      ) : (
        <div className="space-y-2">
          {channels.map((c) => {
            const delta = Math.round(c.advertised_price - lot);
            const off = Math.abs(delta) > TOLERANCE;
            return (
              <div key={c.source_channel} className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${off ? "border-amber-200 bg-amber-50" : "border-border bg-card"}`}>
                {off
                  ? <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  : <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="text-al-body font-semibold text-foreground truncate">{c.source_channel.replace(/_/g, " ")}</p>
                  <p className="text-al-meta text-muted-foreground">
                    {money(c.advertised_price)} advertised · captured {fmtWhen(c.captured_at) ?? "unknown"}
                    {off ? ` · ${money(Math.abs(delta))} ${delta > 0 ? "above" : "below"} the lot price` : ""}
                  </p>
                </div>
                {c.source_url && (
                  <a href={c.source_url} target="_blank" rel="noreferrer" className={btn}>
                    Open <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {c.screenshot_url && (
                  evidence[c.source_channel] === "unavailable" ? (
                    <span className="text-al-meta text-muted-foreground shrink-0">{EVIDENCE_UNAVAILABLE_MESSAGE}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { void openEvidence(c); }}
                      disabled={evidence[c.source_channel] === "opening"}
                      className={btn}
                    >
                      {evidence[c.source_channel] === "opening" ? "Opening…" : "Evidence"}
                    </button>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};

// Label and tone come from src/lib/market/presentation.ts — one map for the
// whole app, so this card cannot disagree with the inventory grid about the
// same car.

const MarketPositionCard = ({ vehicle }: { vehicle: VehicleRow }) => {
  const [pos, setPos] = useState<string>(vehicle.market_position || "unknown");
  const [market, setMarket] = useState<number | null>(vehicle.market_value);
  // How the stored value was produced: vehicle-enrich writes source
  // "comps_median" (raw comp prices, mileage-blind); the refresh call below is
  // mileage-adjusted. Label accordingly so the desk knows what it compares to.
  const [valueSource, setValueSource] = useState<string>(
    ((vehicle.market_payload as Record<string, unknown> | null)?.source as string)
    ?? ((vehicle.market_payload as Record<string, unknown> | null)?.rawProvider as string)
    ?? "",
  );
  const [checking, setChecking] = useState(false);

  const run = async () => {
    if (!vehicle.vin) { toast.error("No VIN to check"); return; }
    if (!vehicle.price) { toast.error("Set a price on this vehicle first"); return; }
    if (!vehicle.tenant_id) { toast.error("This vehicle has no tenant assigned — market pricing needs one."); return; }
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("marketcheck-market-pricing", { body: { vin: vehicle.vin, tenant_id: vehicle.tenant_id } });
      // Surface the server's actual message instead of a generic failure —
      // "authentication required" vs "listing_not_found" vs a crashed function
      // need very different fixes.
      if (error) {
        let detail = "";
        try { detail = String(await (error as { context?: Response }).context?.text?.() ?? "").slice(0, 120); } catch { /* ignore */ }
        toast.error(`Market pricing check failed${detail ? ` — ${detail}` : ""}`);
        return;
      }
      const d = (data || {}) as { error?: string; position?: string; marketValue?: number | null };
      if (d.error === "not_configured") toast.error("Market pricing isn't configured yet (MarketCheck key).");
      else if (d.error) toast.error(`Couldn't get a market value (${d.error}). Try again.`);
      else if (!d.marketValue) toast.error("Couldn't get a market value right now. Try again.");
      else {
        setPos(d.position || "unknown");
        setMarket(d.marketValue ?? null);
        setValueSource("marketcheck_predict");
        toast.success("Market price updated");
      }
    } catch {
      toast.error("Market pricing check failed");
    } finally {
      setChecking(false);
    }
  };

  // The delta is derived from the two figures ON the card, never from a stored
  // belowMarket computed against an older price basis.
  const below = market != null && vehicle.price != null ? Math.round(market - vehicle.price) : 0;
  const valueLabel = valueSource === "comps_median"
    ? "Comp median (mileage-blind)"
    : valueSource === "marketcheck_predict" ? "Market average (mileage-adjusted)" : "Market average";
  const comps = (vehicle as unknown as { comparables?: { miles?: number | null }[] }).comparables;
  const compCount = Array.isArray(comps) ? comps.length : 0;
  const compMiles = Array.isArray(comps) ? comps.map((c) => Number(c?.miles)).filter((n) => Number.isFinite(n) && n > 0) : [];
  const avgCompMiles = compMiles.length >= 2 ? Math.round(compMiles.reduce((a, b) => a + b, 0) / compMiles.length) : null;

  return (
    <Card title="Market position" action={
      <button onClick={run} disabled={checking} className={market ? btn : btnPrimary}>
        <RefreshCw className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} />
        {checking ? "Checking…" : market ? "Re-pull market data" : "Check market price"}
      </button>
    }>
      {market == null ? (
        <p className="text-al-body text-muted-foreground">
          No market value on file. Run a check to compare this vehicle's advertised price against the MarketCheck market value.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-5">
            <Pair label="Advertised price" value={vehicle.price != null ? money(vehicle.price) : "Not priced"} />
            <Pair label={valueLabel} value={money(market)} />
            <Pair
              label="Difference"
              value={below === 0 ? "At market" : `${money(Math.abs(below))} ${below > 0 ? "below" : "above"} market`}
            />
          </div>
          <StatRow label="Position" value={presentLegacyPosition(pos).label} />
          <StatRow label="Comparables used" value={compCount ? compCount.toLocaleString() : "Not recorded"} tone={compCount ? undefined : "muted"} />
          {valueSource === "comps_median" && avgCompMiles != null && vehicle.mileage != null && vehicle.mileage < avgCompMiles * 0.7 && (
            <p className="text-al-meta text-muted-foreground">
              Comps average {Math.round((avgCompMiles - vehicle.mileage) / 1000)}k more miles than this vehicle — a raw comp median under-values it. Re-pull for a mileage-adjusted value.
            </p>
          )}
        </>
      )}
    </Card>
  );
};

export const PriceIntegrityCards = ({ vehicle }: { vehicle: VehicleRow }) => (
  <>
    <AdvertisedPriceCard vehicle={vehicle} />
    <MarketPositionCard vehicle={vehicle} />
  </>
);

export default PriceIntegrityCards;
