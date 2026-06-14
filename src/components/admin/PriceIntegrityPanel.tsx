import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck, AlertTriangle, ExternalLink } from "lucide-react";

// PriceIntegrityPanel — reconciles each VIN's lot/sticker price
// (vehicle_listings.price) against the latest advertised price per
// channel (advertised_prices). Any gap is a potential "advertised one
// price, charged another" exposure under FTC Act §5 — surfaced here so
// the dealer catches it before a customer or a regulator does.
// Read-only; tolerance defaults to $1 so any real drift flags.

const TOLERANCE = 1;

interface Listing { vin: string; price: number | null; status: string }
interface AdRow { vin: string; advertised_price: number; source_channel: string; source_url: string | null; captured_at: string }
interface Mismatch { vin: string; lot: number; advertised: number; channel: string; delta: number; url: string | null }

const fmtMoney = (n: number) => "$" + Math.round(n).toLocaleString();

export const PriceIntegrityPanel = () => {
  const [mismatches, setMismatches] = useState<Mismatch[]>([]);
  const [monitored, setMonitored] = useState(0);
  const [matched, setMatched] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const [listingsRes, adsRes] = await Promise.all([
        (supabase as any).from("vehicle_listings").select("vin, price, status").limit(1000),
        (supabase as any).from("advertised_prices").select("vin, advertised_price, source_channel, source_url, captured_at").order("captured_at", { ascending: false }).limit(2000),
      ]);
      if (!active) return;

      const listings = ((listingsRes.data as Listing[]) || []).filter((l) => typeof l.price === "number");
      const lotByVin = new Map<string, number>();
      for (const l of listings) lotByVin.set(l.vin.toUpperCase(), l.price as number);

      // Latest advertised price per (vin, channel) — rows arrive newest-first.
      const latest = new Map<string, AdRow>();
      for (const a of (adsRes.data as AdRow[]) || []) {
        const key = a.vin.toUpperCase() + "|" + a.source_channel;
        if (!latest.has(key)) latest.set(key, a);
      }

      const found: Mismatch[] = [];
      const vinsWithAds = new Set<string>();
      let matchCount = 0;
      for (const a of latest.values()) {
        const vin = a.vin.toUpperCase();
        const lot = lotByVin.get(vin);
        if (lot == null) continue;
        vinsWithAds.add(vin);
        const delta = a.advertised_price - lot;
        if (Math.abs(delta) >= TOLERANCE) {
          found.push({ vin, lot, advertised: a.advertised_price, channel: a.source_channel, delta, url: a.source_url });
        } else {
          matchCount += 1;
        }
      }
      found.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
      setMismatches(found);
      setMonitored(vinsWithAds.size);
      setMatched(matchCount);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Reconciling advertised prices…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-display text-lg font-bold tracking-tight text-foreground">Price Integrity</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Every captured advertised price reconciled against the lot/sticker price for that VIN. Any gap is the exact
          conduct behind the FTC's March 2026 letters — advertise one price, charge another. Catch it here first.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">VINs monitored</p>
          <p className="mt-0.5 font-display text-2xl font-black tracking-tight text-foreground">{monitored}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-700">Matched</p>
          <p className="mt-0.5 font-display text-2xl font-black tracking-tight text-emerald-700">{matched}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${mismatches.length > 0 ? "border-red-200 bg-red-50/50" : "border-border bg-card"}`}>
          <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${mismatches.length > 0 ? "text-red-700" : "text-muted-foreground"}`}>Mismatches</p>
          <p className={`mt-0.5 font-display text-2xl font-black tracking-tight ${mismatches.length > 0 ? "text-red-700" : "text-foreground"}`}>{mismatches.length}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground px-5 pt-4">Flagged price mismatches</p>
        {mismatches.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground inline-flex items-center justify-center gap-2 w-full">
            <ShieldCheck className="w-4 h-4 text-emerald-600" /> Every advertised price matches its sticker. No drift.
          </p>
        ) : (
          <div className="divide-y divide-border mt-2">
            {mismatches.slice(0, 50).map((m, i) => (
              <div key={m.vin + m.channel + i} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-3">
                  <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate font-mono">{m.vin}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      Sticker {fmtMoney(m.lot)} vs {m.channel} {fmtMoney(m.advertised)}
                      {m.url && (
                        <a href={m.url} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-[#2563EB] hover:underline">
                          listing <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </p>
                  </div>
                </div>
                <span className="inline-flex flex-shrink-0 items-center rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 tabular-nums">
                  {m.delta > 0 ? "+" : "−"}{fmtMoney(Math.abs(m.delta))}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PriceIntegrityPanel;
