import { CheckCircle2, TrendingDown, Sparkles, ShieldCheck, Gauge, Clock, BadgeCheck } from "lucide-react";
import type { VehicleListing } from "@/hooks/useVehicleListing";
import { vehicleInsights, type VehicleInsight, type InsightTone } from "@/lib/vehicleInsights";

const TONE: Record<InsightTone, { chip: string; dot: string; text: string }> = {
  emerald: { chip: "border-emerald-200 bg-emerald-50", dot: "bg-emerald-500", text: "text-emerald-700" },
  blue: { chip: "border-blue-200 bg-blue-50", dot: "bg-blue-500", text: "text-blue-700" },
  slate: { chip: "border-slate-200 bg-slate-50", dot: "bg-slate-400", text: "text-slate-700" },
  amber: { chip: "border-amber-200 bg-amber-50", dot: "bg-amber-500", text: "text-amber-700" },
};

const iconFor = (id: string) => {
  if (id === "below-market" || id === "good-deal") return TrendingDown;
  if (id === "cpo") return BadgeCheck;
  if (id === "no-recalls") return ShieldCheck;
  if (id === "mpg") return Gauge;
  if (id === "fresh") return Clock;
  if (id === "fair-price") return Sparkles;
  return CheckCircle2;
};

// Shopper-facing "Why this is a good buy" block. Leads with a ribbon of
// confidence badges (below-market, one-owner, clean title, no recalls) and
// expands into plain-language reasons. Renders nothing when there's no signal.
export default function VehicleInsights({ listing }: { listing: VehicleListing }) {
  const insights: VehicleInsight[] = vehicleInsights(listing);
  if (insights.length === 0) return null;

  const top = insights.slice(0, 6);

  return (
    <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
          <Sparkles className="w-4 h-4" />
        </span>
        <h2 className="text-sm font-semibold text-foreground">Why this is a great buy</h2>
      </div>

      {/* Confidence ribbon */}
      <div className="flex flex-wrap gap-1.5">
        {top.map((i) => {
          const t = TONE[i.tone];
          const Icon = iconFor(i.id);
          return (
            <span key={i.id} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold ${t.chip} ${t.text}`}>
              <Icon className="w-3.5 h-3.5" />
              {i.label}
            </span>
          );
        })}
      </div>

      {/* Reasons */}
      <ul className="mt-3 space-y-2 border-t border-border pt-3">
        {top.filter((i) => i.detail).map((i) => {
          const t = TONE[i.tone];
          return (
            <li key={i.id} className="flex items-start gap-2.5">
              <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${t.dot}`} />
              <p className="text-[12px] leading-relaxed text-slate-700">
                <span className="font-semibold text-foreground">{i.label}.</span> {i.detail}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
