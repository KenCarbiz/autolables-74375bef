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
      className="inline-flex items-center gap-1.5 rounded-[2px] bg-adm-success-bg px-2 py-[3px] text-[12px] leading-[18px] font-semibold text-adm-success"
    >
      <f.icon className="w-5 h-5 shrink-0" />
      {f.title}
      <span className="font-normal">{f.sub}</span>
    </span>
  ));

  if (!linked) return <div className="flex flex-wrap items-center gap-2">{badges}</div>;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title="Open the vehicle history report behind these facts"
      className="flex flex-wrap items-center gap-2 hover:opacity-90 transition-opacity"
    >
      {badges}
      <span className="text-[12px] leading-[18px] font-semibold text-adm-primary inline-flex items-center gap-1.5">
        View history report <ExternalLink className="w-5 h-5" />
      </span>
    </a>
  );
};

export default VehicleHistoryFacts;
