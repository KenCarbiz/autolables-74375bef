import { ExternalLink } from "lucide-react";
import { historyFactBadges } from "@/components/listing/TrustStrip";

// history_report_url is on the vehicle_listings row the Vehicle File selects
// whole, so it is present at runtime even where the shared row type does not
// name it yet.
interface HistoryFactSources {
  mc_attributes: Record<string, unknown> | null;
  certification?: Record<string, unknown> | null;
  condition?: string | null;
  history_report_url?: string | null;
}

// The two vehicle-history facts on the employee Vehicle File, read through the
// same strict helper the shopper-facing trust strip uses so the two surfaces
// can never disagree. A fact that is false, null or absent renders nothing at
// all -- never a pending or greyed-out badge. When the vehicle carries a stored
// history report the group links to it so the claim can be checked; when it
// does not, the badge still shows and no link is invented.
export const VehicleHistoryFacts = ({ vehicle }: { vehicle: HistoryFactSources }) => {
  const facts = historyFactBadges(vehicle);
  if (facts.length === 0) return null;

  const href = String(vehicle.history_report_url || "").trim();
  const linked = /^https?:\/\//i.test(href);

  const badges = facts.map((f) => (
    <span
      key={f.key}
      className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5"
    >
      <f.icon className="w-4 h-4 text-emerald-600 shrink-0" />
      <span className="min-w-0">
        <span className="block text-al-body font-semibold text-emerald-800 leading-tight">{f.title}</span>
        <span className="block text-al-meta text-emerald-700 leading-tight">{f.sub}</span>
      </span>
    </span>
  ));

  if (!linked) return <div className="flex flex-wrap items-center gap-2">{badges}</div>;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title="Open the vehicle history report behind these facts"
      className="flex flex-wrap items-center gap-2 rounded-xl hover:opacity-90 transition-opacity"
    >
      {badges}
      <span className="text-al-meta font-semibold text-primary inline-flex items-center gap-1.5">
        View history report <ExternalLink className="w-3.5 h-3.5" />
      </span>
    </a>
  );
};

export default VehicleHistoryFacts;
