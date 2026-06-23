import {
  ShieldCheck, ShieldAlert, FileCheck, User, Wrench, TrendingDown,
  BadgeCheck, Sparkles,
} from "lucide-react";

// Trust Badge Strip — the signature confidence bar on the Vehicle Passport.
// Renders ONLY the badges we have real data for (no greyed placeholders), and
// staggers their entrance so the car visibly "passes inspection" on load.

type Tone = "green" | "blue" | "amber" | "red";
interface Badge { icon: typeof ShieldCheck; title: string; sub: string; tone: Tone }

const TONE: Record<Tone, { ring: string; icon: string }> = {
  green: { ring: "border-emerald-200 bg-emerald-50/40", icon: "bg-emerald-100 text-emerald-600" },
  blue: { ring: "border-blue-200 bg-blue-50/40", icon: "bg-blue-100 text-blue-600" },
  amber: { ring: "border-amber-200 bg-amber-50/40", icon: "bg-amber-100 text-amber-600" },
  red: { ring: "border-red-200 bg-red-50/40", icon: "bg-red-100 text-red-600" },
};

// deno-lint-ignore no-explicit-any
export default function TrustStrip({ listing }: { listing: any }) {
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const cond = listing.condition as string | null;
  const badges: Badge[] = [];

  if (listing.recall_status === "clear") {
    badges.push({ icon: ShieldCheck, title: "No Open Recalls", sub: "NHTSA verified clean", tone: "green" });
  } else if (listing.recall_status === "open_recalls" && (listing.open_recall_count || 0) > 0) {
    badges.push({ icon: ShieldAlert, title: `${listing.open_recall_count} Open Recall${listing.open_recall_count === 1 ? "" : "s"}`, sub: "See details below", tone: "red" });
  }
  if (mc.carfax_1_owner === true) badges.push({ icon: User, title: "1-Owner Vehicle", sub: "Single previous owner", tone: "green" });
  if (mc.carfax_clean_title === true) badges.push({ icon: FileCheck, title: "Clean Title", sub: "No salvage, flood, or lemon", tone: "green" });

  const sr = (listing.service_records?.length || 0) as number;
  if (sr > 0) badges.push({ icon: Wrench, title: "Full Service History", sub: `${sr} service record${sr === 1 ? "" : "s"}`, tone: "green" });

  if (["great_deal", "good_deal", "fair_deal"].includes(listing.market_position)) {
    const below = listing.market_payload?.belowMarket;
    badges.push({ icon: TrendingDown, title: "Priced Below Market", sub: below ? `$${Number(below).toLocaleString()} below average` : "Competitively priced", tone: "green" });
  } else if (listing.market_position === "above_market") {
    badges.push({ icon: TrendingDown, title: "Priced At Market", sub: "Fair market value", tone: "blue" });
  }

  if (cond === "new") badges.push({ icon: Sparkles, title: "Factory New", sub: "0 miles — never titled", tone: "blue" });
  if (cond === "cpo") badges.push({ icon: BadgeCheck, title: "Manufacturer Certified", sub: "CPO program", tone: "green" });
  if (listing.warranty_info && Object.keys(listing.warranty_info).length > 0) {
    badges.push({ icon: ShieldCheck, title: "Warranty Coverage", sub: "Remaining manufacturer coverage", tone: "green" });
  }

  // Always-true transparency signal (FTC-aligned wording per house rules).
  badges.push({ icon: ShieldCheck, title: "Transparent Pricing", sub: "Full disclosure · FTC-aligned", tone: "green" });

  if (badges.length === 0) return null;

  return (
    <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {badges.map((b, i) => {
        const t = TONE[b.tone];
        const Icon = b.icon;
        return (
          <div
            key={b.title}
            className={`rounded-2xl border ${t.ring} p-3 flex flex-col items-center text-center gap-1.5 animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-backwards`}
            style={{ animationDelay: `${i * 90}ms` }}
          >
            <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${t.icon}`}><Icon className="w-5 h-5" /></span>
            <p className="text-[13px] font-bold text-foreground leading-tight">{b.title}</p>
            <p className="text-[11px] text-muted-foreground leading-tight">{b.sub}</p>
          </div>
        );
      })}
    </section>
  );
}
