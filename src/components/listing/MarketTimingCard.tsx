import { TrendingDown, CalendarClock, Tag } from "lucide-react";

// Market timing card — surfaces the two real MarketCheck signals that help a
// shopper decide to act: how long this exact car has been listed (dom) and
// whether its price has been reduced (price_change_percent / ref_price).
// Renders nothing unless at least one signal is present.

// deno-lint-ignore no-explicit-any
export default function MarketTimingCard({ listing }: { listing: any }) {
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const dom = typeof mc.dom === "number" ? (mc.dom as number) : null;
  const pct = typeof mc.price_change_percent === "number" ? (mc.price_change_percent as number) : null;
  const refPrice = typeof mc.ref_price === "number" ? (mc.ref_price as number) : null;
  const price = listing.price != null ? Number(listing.price) : null;

  const reduced = pct != null && pct < -0.5;
  const dropDollars = reduced && refPrice != null && price != null && refPrice > price ? Math.round(refPrice - price) : null;

  if (dom == null && !reduced) return null;

  return (
    <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
      <div className="flex items-center gap-2 mb-3">
        <CalendarClock className="w-4 h-4 text-blue-600" />
        <h2 className="text-sm font-bold text-foreground">Market timing</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {reduced && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-emerald-600" />
              <p className="text-[12px] font-bold text-emerald-800">Price reduced</p>
            </div>
            <p className="text-2xl font-black font-display text-emerald-700 mt-1 tabular-nums">
              {dropDollars != null ? `$${dropDollars.toLocaleString()}` : `${Math.abs(Math.round(pct as number))}%`}
            </p>
            <p className="text-[11px] text-emerald-800/80 mt-0.5">
              {dropDollars != null
                ? `Marked down ${Math.abs(Math.round(pct as number))}% from the original ask`
                : "Lowered from the original listing price"}
            </p>
          </div>
        )}
        {dom != null && (
          <div className="rounded-xl border border-border p-4">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-slate-500" />
              <p className="text-[12px] font-bold text-foreground">On the market</p>
            </div>
            <p className="text-2xl font-black font-display text-foreground mt-1 tabular-nums">
              {dom} day{dom === 1 ? "" : "s"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {dom <= 7 ? "Freshly listed" : dom <= 30 ? "Recently listed" : "Available now"}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
