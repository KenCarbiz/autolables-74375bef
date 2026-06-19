import type { VehicleListing } from "@/hooks/useVehicleListing";
import { TrendingDown } from "lucide-react";

// Shopper-facing market-value report — the transparency module that turns
// "below market" into a picture. Shows the local market range with the
// dealer's price marked against it. Self-hides without enough data.
export default function MarketValueReport({ listing }: { listing: VehicleListing }) {
  const price = listing.price != null ? Number(listing.price) : null;
  const mv = listing.market_value != null ? Number(listing.market_value) : null;
  const pay = listing.market_payload || {};
  const low = pay.low != null ? Number(pay.low) : null;
  const high = pay.high != null ? Number(pay.high) : null;

  if (price == null || (mv == null && (low == null || high == null))) return null;

  const below = mv != null ? Math.round(mv - price) : null;
  const isDeal = below != null && below >= 250;

  // Build a range bar when we have a band; otherwise a simple avg comparison.
  const lo = low != null ? low : mv != null ? Math.round(mv * 0.94) : price;
  const hi = high != null ? high : mv != null ? Math.round(mv * 1.06) : price;
  const span = Math.max(1, hi - lo);
  const clamp = (n: number) => Math.max(0, Math.min(100, ((n - lo) / span) * 100));
  const pricePct = clamp(price);
  const avgPct = mv != null ? clamp(mv) : null;

  const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

  return (
    <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-foreground">Market value</h2>
        {isDeal && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[12px] font-semibold text-emerald-700">
            <TrendingDown className="w-3.5 h-3.5" />
            {usd(below as number)} below market
          </span>
        )}
      </div>

      {/* Range bar */}
      <div className="pt-5 pb-1">
        <div className="relative h-2 rounded-full bg-gradient-to-r from-emerald-200 via-amber-200 to-rose-200">
          {avgPct != null && (
            <div className="absolute -top-1 -bottom-1 w-px bg-slate-400/70" style={{ left: `${avgPct}%` }} aria-hidden />
          )}
          {/* This price marker */}
          <div className="absolute -top-1.5" style={{ left: `${pricePct}%`, transform: "translateX(-50%)" }}>
            <div className="w-3.5 h-3.5 rounded-full bg-emerald-600 ring-2 ring-white shadow" />
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between text-[10.5px] text-slate-500">
          <span>{usd(lo)}</span>
          {mv != null && <span className="font-medium text-slate-600">Market avg {usd(mv)}</span>}
          <span>{usd(hi)}</span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">This vehicle</p>
          <p className="text-lg font-bold text-emerald-600 tabular-nums leading-tight">{usd(price)}</p>
        </div>
        <p className="text-[11px] text-slate-500 max-w-[60%] text-right">
          {isDeal
            ? `Priced ${usd(below as number)} under the typical market value for similar vehicles.`
            : "Priced in line with comparable vehicles in this market."}
        </p>
      </div>
    </section>
  );
}
