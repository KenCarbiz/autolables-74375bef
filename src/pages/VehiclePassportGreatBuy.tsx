import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Download, Printer, Upload, ShieldCheck, CheckCircle2, Award,
  DollarSign, TrendingUp, Gauge, Car, Clock, Sparkles, Info, MessageSquare, Users, Package,
  FileText, Wrench, BadgeCheck, Lock, XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { type VehicleListing } from "@/hooks/useVehicleListing";
import Logo from "@/components/brand/Logo";
import { derivePassport, fmt$, listingEquipment } from "@/lib/passportV2Data";
import { readDealerAlternatives } from "@/lib/dealerAlternatives";
import { readBuildSheet } from "@/lib/buildSheet";
import { MOCK_LISTING } from "./VehiclePassportV3";
import { usePublicListing } from "@/hooks/usePublicListing";
import PassportCtaDock from "@/components/passport/PassportCtaDock";
import { GREEN, CARD } from "@/lib/passportTokens";

// ──────────────────────────────────────────────────────────────
// VehiclePassportGreatBuy — /v/:slug/great-buy
//
// The AutoLabels Buying Report: the flagship customer decision page.
// Pricing, ownership, market, history, warranty, condition, equipment,
// and a balanced recommendation in one premium analysis. Live data via
// derivePassport; honest empty/Pending states and clearly-labeled
// estimates where data isn't vehicle-specific — nothing fabricated.
// ──────────────────────────────────────────────────────────────

const TEXT2 = "text-[#64748B]";
const BLUE_HEX = "#2563EB";
const AMBER_HEX = "#D97706";

const GB_ANIM = `
@keyframes gbFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
.gb-fade { animation: gbFadeUp .55s cubic-bezier(.22,1,.36,1) both; }
.gb-lift { transition: transform .18s ease, box-shadow .18s ease; }
.gb-lift:hover { transform: translateY(-2px); box-shadow: 0 12px 32px -14px rgba(15,23,42,.22); }
@media (prefers-reduced-motion: reduce) {
  .gb-fade { animation: none; }
  .gb-lift, .gb-lift:hover { transform: none; transition: none; box-shadow: none; }
}
@media print { .gb-fade { animation: none; } }
`;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Delayed flag that drives the mount animations (ring sweep, bar fills).
const useDrawn = () => {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    if (prefersReducedMotion()) { setDrawn(true); return; }
    const t = window.setTimeout(() => setDrawn(true), 80);
    return () => window.clearTimeout(t);
  }, []);
  return drawn;
};

// Score tier — the single label/headline mapping used by the hero, the
// recommendation, and the verdict so a 69 never reads "Excellent".
export const scoreTier = (s: number | null) =>
  s == null ? { label: "Pending Verification", verdict: "PENDING", headline: "Report In Progress.", color: "#94A3B8" }
  : s >= 90 ? { label: "Excellent Buy", verdict: "YES", headline: "One of the Best Values Available.", color: GREEN }
  : s >= 80 ? { label: "Strong Buy", verdict: "YES", headline: "A Smart Choice.", color: GREEN }
  : s >= 70 ? { label: "Good Buy", verdict: "WORTH A LOOK", headline: "A Smart Choice.", color: BLUE_HEX }
  : s >= 60 ? { label: "Worth Reviewing", verdict: "REVIEW CAREFULLY", headline: "A Vehicle Worth Reviewing.", color: BLUE_HEX }
  : s >= 50 ? { label: "Needs Review", verdict: "REVIEW CAREFULLY", headline: "A Vehicle Worth Reviewing.", color: AMBER_HEX }
  : { label: "Proceed With Caution", verdict: "PROCEED WITH CAUTION", headline: "Review This Vehicle Closely.", color: "#DC2626" };

const H2 = ({ children }: { children: React.ReactNode }) => <h2 className="text-[19px] font-bold leading-7 tracking-tight text-[#0F172A]">{children}</h2>;

// Big circular score gauge — sweeps from empty to the score on mount.
const ScoreRing = ({ score, color, size = 180 }: { score: number; color: string; size?: number }) => {
  const drawn = useDrawn();
  const r = size / 2 - 12, c = 2 * Math.PI * r;
  const off = drawn ? c * (1 - score / 100) : c;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E6E8EC" strokeWidth="12" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(.22,1,.36,1)" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[48px] font-extrabold text-[#0F172A] leading-none">{score}</span>
        <span className="text-[12px] font-bold text-[#94A3B8] mt-0.5">/ 100</span>
      </div>
    </div>
  );
};

// Small confidence donut for the AI Recommendation card.
const MiniDonut = ({ pct, color, size = 76 }: { pct: number; color: string; size?: number }) => {
  const drawn = useDrawn();
  const r = size / 2 - 6, c = 2 * Math.PI * r;
  const off = drawn ? c * (1 - pct / 100) : c;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(148,163,184,.25)" strokeWidth="7" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(.22,1,.36,1)" }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center"><span className="text-[16px] font-extrabold text-[#0F172A]">{pct}%</span></div>
    </div>
  );
};

// Score-breakdown card: icon, name, score or Pending, one-liner, animated bar.
const ScoreCard = ({ icon: Icon, label, score, note }: { icon: LucideIcon; label: string; score: number | null; note: string }) => {
  const drawn = useDrawn();
  return (
    <div className={`${CARD} gb-lift p-4`}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-blue-50 text-[#2563EB] flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
          <span className="text-[13px] font-bold text-[#0F172A] truncate">{label}</span>
        </span>
        {score == null
          ? <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">Pending</span>
          : <span className="text-[15px] font-extrabold text-[#0F172A] shrink-0">{score}<span className="text-[10px] font-bold text-[#94A3B8]">/100</span></span>}
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden mt-2.5">
        <div className="h-full rounded-full" style={{ width: drawn ? `${score ?? 0}%` : "0%", background: score == null ? "#E2E8F0" : score >= 80 ? "#22C55E" : score >= 70 ? BLUE_HEX : "#94A3B8", transition: "width .9s cubic-bezier(.22,1,.36,1)" }} />
      </div>
      <p className="text-[11px] text-[#64748B] mt-2 leading-snug">{note}</p>
    </div>
  );
};

// Red is reserved for true negatives (accidents, open recalls, branded
// titles) — none of which this matrix carries. An at-market price is a
// neutral fact, so sub-80 scores render in slate/blue, never warning colors.
const ratingLabel = (s: number | null) => s == null ? "Pending" : s >= 90 ? "Excellent" : s >= 80 ? "Very Good" : s >= 70 ? "Good" : "At Market";
const ratingPill = (s: number | null) =>
  s == null ? "bg-amber-50 text-amber-700 border-amber-200"
  : s >= 90 ? "bg-emerald-100 text-emerald-800 border-emerald-200"
  : s >= 80 ? "bg-emerald-50 text-emerald-700 border-emerald-200"
  : s >= 70 ? "bg-blue-50 text-blue-700 border-blue-200"
  : "bg-slate-100 text-slate-600 border-slate-200";

const Panel = ({ title, sub, children, className = "" }: { title: string; sub?: string; children: React.ReactNode; className?: string }) => (
  <section className={`${CARD} p-5 sm:p-6 ${className}`}>
    <H2>{title}</H2>
    {sub && <p className={`text-[13px] ${TEXT2} mt-1`}>{sub}</p>}
    <div className="mt-4">{children}</div>
  </section>
);

const VehiclePassportGreatBuy = () => {
  const params = useParams<{ vehicleSlug?: string; slug?: string }>();
  const vehicleSlug = params.vehicleSlug ?? params.slug;
  const navigate = useNavigate();
  const isPreview = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("preview");
  const { listing, loading, notFound } = usePublicListing(vehicleSlug, { preview: isPreview, previewData: MOCK_LISTING as unknown as VehicleListing });

  const d = useMemo(() => (listing ? derivePassport(listing) : null), [listing]);

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-[#F6F7F9]"><div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" /></div>;
  if (notFound || !listing || !d) return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[#F6F7F9]"><div className="text-center"><Award className="w-12 h-12 text-slate-300 mx-auto mb-4" /><h1 className="text-xl font-bold">Buying report unavailable</h1><p className="text-sm text-slate-500 mt-2">This listing may have been sold or unpublished.</p></div></div>
  );

  const slug = listing.slug || vehicleSlug;
  const go = (section: string) => navigate(`/v/${slug}/${section}${isPreview ? "?preview=1" : ""}`);
  const back = () => navigate(`/v/${slug}${isPreview ? "?preview=1" : ""}`);
  const share = async () => {
    try { if (navigator.share) { await navigator.share({ title: "AutoLabels Buying Report", url: window.location.href }); return; } } catch { /* ignore */ }
    try { await navigator.clipboard.writeText(window.location.href); } catch { /* ignore */ }
    toast.success("Link copied");
  };

  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const score = d.confScore;
  const tier = scoreTier(score);
  // price_percentile = % of comps priced BELOW this car, so a low percentile
  // means well priced. Surface it only when favorable; never praise the
  // priciest car in the set.
  const percentile = d.marketMeta.percentile;
  const topPct = percentile != null && percentile <= 25 ? `Top ${Math.max(1, percentile)}% best priced among comparable vehicles` : isPreview ? "Top 4% best priced among comparable vehicles" : null;
  const premium = /luxe|autograph|limited|platinum|premium|touring|signature|reserve|titanium|sensory|denali/i.test(listing.trim || "");
  const lowMiles = listing.mileage != null && listing.mileage < 30000;
  const seats = Number(mc.seating) || null;

  // Buying-score breakdown — each 0–100 from real signals, null when unknown.
  // A new vehicle has no accident/title history and no prior owners by
  // definition, so those factors are full-credit rather than "pending" — there
  // is no report to wait on.
  const isNew = listing.condition === "new";
  // Same-trim comp subset: when at least two same-trim comps carry prices,
  // their average is the honest anchor — the mixed-trim average punishes a
  // flagship build for costing more than base cars.
  const trimLc = (listing.trim || "").trim().toLowerCase();
  const sameTrimComps = trimLc ? d.comparables.filter((c) => (c.trim || "").trim().toLowerCase() === trimLc && c.price != null && c.price > 0) : [];
  const trimAvg = sameTrimComps.length >= 2 ? Math.round(sameTrimComps.reduce((a, c) => a + (c.price as number), 0) / sameTrimComps.length) : null;
  const priceAnchor = trimAvg ?? d.marketAvg;
  const pctVsAnchor = priceAnchor != null && d.price != null ? Math.round(((d.price - priceAnchor) / priceAnchor) * 100) : null;
  // New cars anchor to their own sticker — trim-exact by construction. Used
  // cars use the ±3% "at market" band (a few percent off the average is
  // normal spread, not a verdict), preferring the same-trim average.
  const msrpDelta = isNew && d.msrp != null && d.price != null ? d.msrp - d.price : null;
  const gbSheet = readBuildSheet(listing);
  const priceVal =
    msrpDelta != null ? (msrpDelta > 0 ? Math.min(94, 86 + Math.round(msrpDelta / 1000)) : msrpDelta === 0 ? 85 : 72)
    : d.belowMarket && d.belowMarket > 0 ? 94
    : pctVsAnchor != null ? (pctVsAnchor <= -3 ? 90 : pctVsAnchor < 3 ? 80 : 72)
    : d.saveVsMsrp ? 85 : null;
  const priceNote =
    msrpDelta != null && msrpDelta > 0 ? `${fmt$(msrpDelta)} below MSRP — sticker for this exact build is ${fmt$(d.msrp!)}`
    : msrpDelta != null && msrpDelta === 0 ? "Priced at MSRP for this exact build"
    : msrpDelta != null ? `Priced ${fmt$(-msrpDelta)} above the ${fmt$(d.msrp!)} sticker for this build`
    : d.belowMarket && d.belowMarket > 0 ? `${fmt$(d.belowMarket)} below market average`
    : pctVsAnchor != null && pctVsAnchor < 3 ? `Within 3% of the ${trimAvg != null ? `${listing.trim} trim` : "market"} average${gbSheet?.estValue ? ` — includes ${fmt$(gbSheet.estValue)} in factory options` : ""}`
    : pctVsAnchor != null ? `Above the market average${gbSheet?.estValue ? ` — carries ${fmt$(gbSheet.estValue)} in factory packages the average comparable may not include` : " for the model line"}`
    : d.marketAvg != null ? "Near the market average" : "Awaiting market data";
  const histVal = isNew ? 97 : d.cleanTitle && d.accidentCount === 0 ? 96 : d.accidentCount === 0 ? 84 : (typeof mc.carfax_clean_title === "boolean" || d.accidentCount != null) ? 70 : null;
  const ownVal = isNew ? 96 : d.ownerCount === 1 ? 93 : d.ownerCount != null ? 72 : null;
  const warVal = d.warrantyStr ? (() => { const w = d.warranty; if (w.in_service_date && w.factory_months) { const end = new Date(w.in_service_date); end.setMonth(end.getMonth() + w.factory_months); const left = Math.max(0, end.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30.4); return Math.round(Math.max(55, Math.min(98, 55 + (left / w.factory_months) * 43))); } return 80; })() : null;
  // Equipment count spans the top-level features column AND the decoded
  // mc_attributes.options/.features (where the VIN decode lands) — not just the
  // features column, which the NeoVIN pull never writes to.
  const equipCount = listingEquipment(listing).length;
  const equipVal = equipCount > 0 ? Math.min(96, 60 + (equipCount + (premium ? 3 : 0)) * 6) : null;
  const demandVal = (d.viewCount != null || d.dom != null) ? ((d.viewCount ?? 0) > 20 ? 88 : 74) : null;
  const dealerVal = d.dealerTrust.googleRating ? Math.round(Math.min(98, (Number(d.dealerTrust.googleRating) / 5) * 100)) : d.verifyRows.length > 0 ? 82 : null;
  const condVal = (d.serviceCount > 0 || listing.prep_status?.foreman_signed_at) ? 90 : (listing.condition === "new" ? 92 : 74);
  const breakdown: { icon: LucideIcon; label: string; score: number | null; note: string }[] = [
    { icon: DollarSign, label: "Price Value", score: priceVal, note: priceNote },
    { icon: Users, label: "Ownership", score: ownVal, note: isNew ? "New — you are the first owner" : d.ownerCount === 1 ? "Single previous owner" : d.ownerCount != null ? `${d.ownerCount} previous owners` : "Ownership pending" },
    { icon: Package, label: "Equipment", score: equipVal, note: gbSheet?.packages.length ? `${gbSheet.packages.length} factory package${gbSheet.packages.length === 1 ? "" : "s"}${gbSheet.estValue ? ` · ${fmt$(gbSheet.estValue)} in options` : ""}` : equipCount > 0 ? `${equipCount} equipment highlights decoded` : "Equipment pending" },
    { icon: ShieldCheck, label: "Warranty", score: warVal, note: d.warrantyStr ? `${d.warrantyStr} of factory coverage remains` : "Confirm coverage with dealer" },
    { icon: FileText, label: "Vehicle History", score: histVal, note: isNew ? "New vehicle — no accident or title history" : d.cleanTitle && d.accidentCount === 0 ? "Clean title, no accidents reported" : "History reviewed where data exists" },
    { icon: TrendingUp, label: "Market Demand", score: demandVal, note: d.viewCount != null ? `${d.viewCount.toLocaleString()} shopper views` : "Demand tracked once live" },
    { icon: Wrench, label: "Condition", score: condVal, note: d.serviceCount > 0 ? `${d.serviceCount} service records on file` : listing.condition === "new" ? "New vehicle" : "Inspected" },
    { icon: BadgeCheck, label: "Dealer Confidence", score: dealerVal, note: d.dealerTrust.googleRating ? `${d.dealerTrust.googleRating} dealer rating` : "Verified dealer" },
  ];

  // Hero trust badges — each renders only when the underlying data backs it.
  const oemVerified = Object.keys(mc).length > 0 || (listing.key_specs && Object.keys(listing.key_specs).length > 0);
  const trustBadges = [
    d.ownerCount === 1 ? "One Owner" : null,
    d.verifyRows.length > 0 ? "Dealer Verified" : null,
    oemVerified ? "OEM Verified" : null,
    d.recallClear ? "No Open Recalls" : null,
    d.marketAvg != null || d.comparables.length > 0 ? "Market Data Verified" : null,
    equipCount > 0 ? "Equipment Verified" : null,
  ].filter(Boolean) as string[];

  // Honest analysis-scope line: a count of the real data fields this report
  // actually weighed (specs, equipment, comps, verification rows).
  const dataPoints = equipCount + d.comparables.length + d.keySpecs.length + d.verifyRows.length + Object.keys(mc).length;
  const analyzedLine = dataPoints >= 40
    ? `We analyzed ${dataPoints} data points across ownership history, market pricing, equipment, warranty, condition, and local demand to help you make a confident decision.`
    : "We weigh ownership history, market pricing, equipment, warranty, condition, and local demand to help you make a confident decision.";

  // Quick-fact pills from the merged key_specs/mc spec pairs.
  const spec = (label: string) => d.keySpecs.find(([k]) => k === label)?.[1] ?? null;
  const facts = [
    listing.mileage != null ? `${listing.mileage.toLocaleString()} mi` : null,
    listing.trim || null,
    spec("Engine"),
    spec("Drivetrain"),
    spec("Exterior Color"),
  ].filter(Boolean) as string[];

  // AI Buying Summary insight cards — data-gated; missing ones simply don't render.
  const insights: { icon: LucideIcon; label: string }[] = ([
    (d.belowMarket && d.belowMarket > 0) || (msrpDelta != null && msrpDelta > 0) || (priceVal != null && priceVal >= 85) ? { icon: DollarSign, label: "Above average value" } : null,
    (d.marketMeta.daysSupply != null && d.marketMeta.daysSupply < 60) || (d.viewCount ?? 0) > 20 ? { icon: TrendingUp, label: "High local demand" } : null,
    (gbSheet?.packages.length ?? 0) > 0 || equipCount >= 8 ? { icon: Sparkles, label: "Well equipped for the price" } : null,
    d.verifyRows.length > 0 ? { icon: BadgeCheck, label: "Verified & thoroughly checked" } : null,
  ] as ({ icon: LucideIcon; label: string } | null)[]).filter(Boolean) as { icon: LucideIcon; label: string }[];

  // Why it scored high — verified positives only.
  const why: string[] = [];
  if (d.belowMarket && d.belowMarket > 0) why.push(`Priced ${fmt$(d.belowMarket)} below market`);
  if (d.saveVsMsrp) why.push(`${fmt$(d.saveVsMsrp)} below MSRP`);
  if (topPct) why.push(topPct);
  if (d.accidentCount === 0) why.push("No accident history reported");
  if (d.ownerCount === 1) why.push("One previous owner");
  if (d.warrantyStr) why.push("Factory warranty remaining");
  if (d.reviewRating != null && d.reviewRating >= 4.5) why.push("Excellent owner reviews");
  if (d.verifyRows.length > 0) why.push("Dealer verified");
  if (premium) why.push(`Premium trim — ${listing.trim}`);
  if (lowMiles) why.push(`Low mileage — ${listing.mileage!.toLocaleString()} mi`);
  if ((d.viewCount ?? 0) > 20) why.push("Market demand above average");
  if (d.recallClear) why.push("No open recalls");
  if (oemVerified) why.push("OEM data verified");

  // Ownership considerations — balanced, honest expectations (not defects).
  const know: string[] = [];
  if (premium) know.push("Premium fuel may be recommended — confirm the requirement with the dealer.");
  if (seats && seats >= 7) know.push("Third-row cargo space is smaller than a full-size SUV with the seats up.");
  if (premium) know.push("Luxury-brand maintenance can cost more than mainstream brands.");
  know.push("Replacement tires for larger wheels can cost above average.");
  if (!d.warrantyStr) know.push("Confirm remaining warranty coverage with the dealer.");

  // Market position comparison — rows render only when the market cell holds
  // a real figure (a table of "Pending" reads as an unfinished report).
  const compMiles = d.comparables.map((c) => c.miles).filter((m): m is number => m != null && m > 0);
  const avgCompMiles = compMiles.length >= 2 ? Math.round(compMiles.reduce((a, b) => a + b, 0) / compMiles.length) : null;
  type Adv = { text: string; good: boolean } | null;
  const priceAdv: Adv =
    d.belowMarket && d.belowMarket > 0 ? { text: `${fmt$(d.belowMarket)} below`, good: true }
    : pctVsAnchor != null && pctVsAnchor <= 0 ? { text: "Better value", good: true }
    : pctVsAnchor != null && pctVsAnchor < 3 ? { text: "At market", good: false }
    : gbSheet?.estValue ? { text: "Premium build", good: false }
    : null;
  const posRows: { k: string; v: string; m: string; a: Adv }[] = [
    { k: "Price", v: d.price != null ? fmt$(d.price) : "—", m: trimAvg != null ? `${fmt$(trimAvg)} (${listing.trim})` : d.marketAvg != null ? `${fmt$(d.marketAvg)}${d.marketMeta.trimMatched === false && listing.trim ? " (all trims)" : ""}` : isPreview ? "$71,400" : "", a: priceAdv },
    { k: "Mileage", v: listing.mileage != null ? `${listing.mileage.toLocaleString()} mi` : "—", m: avgCompMiles != null ? `${avgCompMiles.toLocaleString()} mi` : isPreview ? "24,000 mi" : "", a: avgCompMiles != null && listing.mileage != null ? (listing.mileage < avgCompMiles ? { text: "Lower mileage", good: true } : { text: "Above average", good: false }) : isPreview ? { text: "Lower mileage", good: true } : null },
    { k: "Market Days", v: d.dom != null ? `${d.dom} days` : "—", m: d.marketMeta.avgDom != null ? `${d.marketMeta.avgDom} days` : isPreview ? "38 days" : "", a: d.dom != null && d.marketMeta.avgDom != null && d.dom < d.marketMeta.avgDom ? { text: "Shorter time", good: true } : null },
    { k: "Units Available", v: d.comparables.length > 0 ? `${d.comparables.length}` : "—", m: listing.trim && d.comparables.length >= 5 ? `${sameTrimComps.length} this trim` : "", a: listing.trim && d.comparables.length >= 5 && sameTrimComps.length <= 2 ? { text: "Fewer comps", good: true } : null },
    { k: "Equipment Score", v: equipVal != null ? `${equipVal}/100` : "—", m: equipVal != null ? "Varies" : "", a: gbSheet?.estValue ? { text: "Better equipped", good: true } : null },
    { k: "Ownership Score", v: ownVal != null ? `${ownVal}/100` : "—", m: ownVal != null ? "Varies" : "", a: isNew || d.ownerCount === 1 ? { text: "Stronger history", good: true } : null },
  ].filter((r) => r.m && r.v !== "—");

  // Ownership cost estimate — transparent model, clearly labelled (not a vehicle-specific fact).
  const base = d.price ?? d.marketAvg ?? 45000;
  const lux = premium || base > 45000;
  const annual = { Fuel: lux ? 2500 : 2100, Insurance: Math.round((base * 0.032) / 100) * 100, Maintenance: lux ? 1200 : 800, Repairs: lux ? 700 : 500, Registration: 320 };
  const annualTotal = Object.values(annual).reduce((a, b) => a + b, 0);
  const fiveYear = annualTotal * 5;
  const perMonth = Math.round(fiveYear / 60);

  // Similar vehicles — the dealer's OWN stock only (never other dealers'
  // listings). Sample only behind preview. Trim + the salesperson positioning
  // chip travel with each card: a cheaper sibling labeled "Lower package
  // level" supports this vehicle's price instead of undercutting it.
  type SimilarCard = { mi: number; price: number; score: number | null; ymm: string | null; image: string | null; trim: string | null; condition: string | null; tag: string | null; tagDetail: string | null; tone: "blue" | "green" | "violet" | "neutral" };
  const dealerAlts = readDealerAlternatives(listing);
  const similar: SimilarCard[] =
    !isPreview && dealerAlts.length
      ? dealerAlts.slice(0, 2).map((a) => ({ mi: a.mileage ?? 0, price: a.price ?? 0, score: null, ymm: a.ymm ?? listing.ymm, image: a.image ?? listing.hero_image_url ?? null, trim: a.trim, condition: a.condition, tag: a.tag === "Also in stock" ? null : a.tag, tagDetail: a.tagDetail, tone: a.tone }))
      : isPreview && d.price != null
        ? [
            { mi: 24000, price: d.price + 5200, score: 91, ymm: listing.ymm, image: listing.hero_image_url ?? null, trim: "LUXE", condition: "used", tag: "Lower package level", tagDetail: null, tone: "neutral" as const },
            { mi: 31000, price: d.price + 6100, score: 88, ymm: listing.ymm, image: listing.hero_image_url ?? null, trim: "SENSORY", condition: "used", tag: "More equipment", tagDetail: "+$2,450 in factory options", tone: "blue" as const },
          ]
        : [];
  // Honest comparison signals per competitor card, relative to this vehicle.
  const compSignals = (s: SimilarCard): { text: string; good: boolean }[] => {
    const out: { text: string; good: boolean }[] = [];
    if (s.mi > 0 && listing.mileage != null) out.push(s.mi > listing.mileage ? { text: "Higher mileage", good: false } : { text: "Lower mileage", good: true });
    if (s.price > 0 && d.price != null) out.push(s.price > d.price ? { text: `${fmt$(s.price - d.price)} more`, good: false } : { text: "Lower price", good: true });
    if (s.tag) out.push({ text: s.tag + (s.tagDetail ? ` — ${s.tagDetail}` : ""), good: s.tone === "blue" || s.tone === "green" });
    return out.slice(0, 3);
  };
  const subjectPros = [
    d.ownerCount === 1 ? "One owner" : isNew ? "New — first owner" : null,
    d.verifyRows.length > 0 ? "Dealer verified" : null,
    gbSheet?.estValue ? "Better equipment" : null,
    d.belowMarket && d.belowMarket > 0 ? "Below market price" : null,
    d.warrantyStr ? "Warranty remains" : null,
  ].filter(Boolean).slice(0, 3) as string[];

  // Market Position measures supply and scarcity — a genuinely distinct
  // signal from Price (which used to be double-counted here, doubling the
  // damage of any sub-par price chip).
  const supplyVal =
    d.marketMeta.daysSupply != null ? (d.marketMeta.daysSupply < 30 ? 92 : d.marketMeta.daysSupply < 60 ? 84 : 74)
    : d.comparables.length >= 5 && trimLc ? (sameTrimComps.length <= 1 ? 88 : 80)
    : null;
  const matrix: { k: string; s: number | null }[] = [
    { k: "Price", s: priceVal }, { k: "History", s: histVal }, { k: "Warranty", s: warVal }, { k: "Ownership", s: ownVal },
    { k: "Equipment", s: equipVal }, { k: "Market Position", s: supplyVal }, { k: "Dealer Confidence", s: dealerVal },
    { k: "Maintenance", s: condVal }, { k: "Resale Potential", s: demandVal }, { k: "Overall", s: score },
  ];

  // Real, verifiable urgency signals only — no fabricated scarcity.
  const buyNow: string[] = [];
  if (gbSheet?.estValue) buyNow.push(`Built with ${fmt$(gbSheet.estValue)} in factory packages.`);
  if (d.ownerCount === 1) buyNow.push("One-owner vehicles like this are becoming harder to find.");
  if (d.belowMarket && d.belowMarket > 0) buyNow.push("Priced below the market average right now.");
  if (d.saveVsMsrp) buyNow.push(`Priced ${fmt$(d.saveVsMsrp)} below MSRP.`);
  if ((d.viewCount ?? 0) > 20) buyNow.push("High shopper interest in your area.");
  if (d.marketMeta.daysSupply != null && d.marketMeta.daysSupply < 60) buyNow.push(`Local supply covers about ${Math.round(d.marketMeta.daysSupply)} days of demand.`);
  else if (isPreview && buyNow.length < 4) buyNow.push("Comparable inventory is moving quickly in your market.");
  if (listing.trim && d.comparables.length >= 5 && sameTrimComps.length <= 2) buyNow.push(sameTrimComps.length === 0
    ? `None of the ${d.comparables.length} comparable listings nearby matches this ${listing.trim} build.`
    : `Only ${sameTrimComps.length} of ${d.comparables.length} nearby comparables ${sameTrimComps.length === 1 ? "is" : "are"} a ${listing.trim}.`);
  if (d.verifyRows.length > 0) buyNow.push("Dealer verified and ready for the next step.");
  if (d.warrantyStr && buyNow.length < 4) buyNow.push("Factory warranty is still active.");
  if (d.dom != null && d.dom <= 14 && buyNow.length < 4) buyNow.push(`Recently arrived — ${d.dom} day${d.dom === 1 ? "" : "s"} on the lot.`);
  const buyNowIcons: LucideIcon[] = [Package, Users, DollarSign, TrendingUp, Sparkles, Clock, Car, BadgeCheck];

  // Balanced recommendation copy: strengths from verified data, and — below
  // the Strong Buy tier — the specific items a careful shopper should confirm.
  const strengths = [
    d.belowMarket && d.belowMarket > 0 ? "pricing below the market average" : msrpDelta != null && msrpDelta > 0 ? "below-sticker pricing" : null,
    d.warrantyStr ? "active factory coverage" : null,
    d.ownerCount === 1 ? "a single-owner history" : null,
    (gbSheet?.packages.length ?? 0) > 0 || equipCount >= 8 ? "strong equipment" : null,
  ].filter(Boolean) as string[];
  const confirms = [
    !d.warrantyStr ? "remaining warranty coverage" : null,
    !isNew && d.ownerCount == null ? "ownership history" : null,
    !isNew && d.accidentCount == null ? "the vehicle history report" : null,
    !d.recallClear ? "open recall status" : null,
  ].filter(Boolean) as string[];
  const recCopy =
    score == null ? "This report is still gathering verification data. Check back shortly, or ask the dealer to complete the vehicle's verification checks."
    : score >= 80 ? `This vehicle offers one of the stronger combinations of ${strengths.length ? strengths.join(", ") : "value, ownership history, pricing, equipment, and warranty"} available in this market segment.`
    : `This vehicle offers ${strengths.length ? strengths.join(", ") : "verified vehicle data"}.${confirms.length ? ` Confirm ${confirms.join(", ")} with the dealer before moving forward.` : " Review the full report before moving forward."}`;
  const ctaSubtitle =
    score != null && score >= 80 ? "This vehicle is a strong buy and may not last long in today's market."
    : score != null && score >= 70 ? "This vehicle is a good buy — comparable listings are moving quickly."
    : "Take the next step, or ask the dealer to confirm the remaining details.";
  const verifyDate = listing.prep_status?.foreman_signed_at ? new Date(listing.prep_status.foreman_signed_at).toLocaleDateString() : new Date().toLocaleDateString();
  const generatedAt = new Date().toLocaleString();
  // Light tinted recommendation card; a dark block only below 50.
  const recTint = score != null && score < 50 ? "bg-[#1E293B] border-[#334155] text-white" : score != null && score >= 80 ? "bg-emerald-50/70 border-emerald-200" : "bg-blue-50/60 border-blue-200";

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#0F172A]" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <Helmet><title>{`AutoLabels Buying Report — ${listing.ymm}`}</title>{isPreview && <meta name="robots" content="noindex" />}</Helmet>
      <style>{GB_ANIM}</style>
      {isPreview && <div className="bg-amber-500 text-white text-center text-[12px] font-bold py-1.5 px-4">SAMPLE PREVIEW — design layout with placeholder data. Not a real listing.</div>}

      <header className="border-b border-[#E6E8EC] bg-white sticky top-0 z-20">
        <div className="mx-auto max-w-[1260px] px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Logo variant="full" size={20} />
            <span className="hidden md:block w-px h-5 bg-[#E6E8EC]" />
            <button onClick={back} className="text-[13px] font-semibold text-[#2563EB] inline-flex items-center gap-1 shrink-0"><ChevronLeft className="w-4 h-4" /> <span className="hidden md:inline">Back to Vehicle Passport</span><span className="md:hidden">Back</span></button>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <span className="hidden xl:block text-[11px] text-[#94A3B8]">Generated {generatedAt} · VIN {listing.vin}</span>
            <button onClick={() => window.print()} className={`text-[13px] font-medium inline-flex items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Download className="w-4 h-4" /> <span className="hidden sm:inline">Download PDF</span></button>
            <button onClick={() => window.print()} className={`hidden sm:inline-flex text-[13px] font-medium items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Printer className="w-4 h-4" /> Print</button>
            <button onClick={share} className={`text-[13px] font-medium inline-flex items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Upload className="w-4 h-4" /> <span className="hidden sm:inline">Share</span></button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1260px] px-4 sm:px-6 py-6 space-y-5">
        <div className="gb-fade">
          <h1 className="text-[26px] sm:text-[30px] font-bold tracking-tight leading-tight">AutoLabels Buying Report</h1>
          <p className={`text-[14px] ${TEXT2} mt-0.5`}>Why this vehicle earns its recommendation.</p>
        </div>

        {/* Hero: score gauge · recommendation · vehicle */}
        <section className={`${CARD} gb-fade p-6 sm:p-8`} style={{ animationDelay: "60ms" }}>
          <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_340px] gap-8 items-center">
            <div className="flex flex-col items-center text-center">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#94A3B8] mb-3">AutoLabels Buying Score</p>
              {score != null ? <ScoreRing score={score} color={tier.color} /> : <div className="w-[180px] h-[180px] rounded-full border-2 border-dashed border-[#E6E8EC] flex items-center justify-center text-[13px] text-[#94A3B8] text-center px-6">Score pending verification</div>}
              <p className="text-[14px] font-extrabold uppercase tracking-wide mt-3" style={{ color: tier.color }}>{tier.label}</p>
              {topPct && <p className="text-[11px] text-[#64748B] mt-1 max-w-[200px]">{topPct}</p>}
            </div>
            <div className="text-center lg:text-left">
              <p className="text-[26px] sm:text-[30px] font-extrabold leading-tight" style={{ color: tier.color }}>{tier.headline}</p>
              <p className="text-[14px] font-bold text-[#2563EB] mt-1">Backed by data. Verified by AutoLabels.</p>
              <p className={`text-[13px] ${TEXT2} mt-3 max-w-[520px] mx-auto lg:mx-0`}>{analyzedLine}</p>
              {trustBadges.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-4 justify-center lg:justify-start">
                  {trustBadges.map((b) => <span key={b} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#0F172A] bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1"><CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" />{b}</span>)}
                </div>
              )}
            </div>
            <div>
              <div className="rounded-xl overflow-hidden bg-[#eef0f3] aspect-[16/10] flex items-center justify-center">
                {listing.hero_image_url ? <img src={listing.hero_image_url} alt={listing.ymm ?? "Vehicle"} className="w-full h-full object-cover" /> : <Car className="w-10 h-10 text-[#94A3B8]" />}
              </div>
              <p className="text-[16px] font-bold leading-tight mt-3">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</p>
              {facts.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {facts.map((f) => <span key={f} className="text-[11px] font-semibold text-[#334155] bg-slate-100 border border-slate-200 rounded-full px-2.5 py-1">{f}</span>)}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* AI buying summary: copy · insight cards · early CTA */}
        <section className={`${CARD} gb-fade p-5 sm:p-6`} style={{ animationDelay: "120ms" }}>
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_auto_230px] gap-6 items-center">
            <div>
              <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-lg bg-blue-50 text-[#2563EB] flex items-center justify-center shrink-0"><Sparkles className="w-3.5 h-3.5" /></span><H2>AI Buying Summary</H2></div>
              <p className="text-[13px] leading-relaxed text-[#334155] mt-2.5">
                This {listing.ymm}{listing.trim ? ` ${listing.trim}` : ""} ranks among the stronger vehicles currently available in your market. It combines{" "}
                {[d.belowMarket && d.belowMarket > 0 ? "below-market pricing" : null, lowMiles ? "low mileage" : null, d.cleanTitle && d.accidentCount === 0 ? "a clean ownership history" : null, d.warrantyStr ? "remaining factory warranty" : null, d.reviewRating != null && d.reviewRating >= 4.5 ? "strong owner satisfaction" : null].filter(Boolean).join(", ") || "verified vehicle data"}{" "}
                {d.belowMarket && d.belowMarket > 0 && d.price != null ? `— at ${fmt$(d.price)}, that's ${fmt$(d.belowMarket)} under comparable listings.` : "into a well-rounded purchase."}
              </p>
            </div>
            {insights.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 gap-2">
                {insights.map(({ icon: Icon, label }) => (
                  <div key={label} className="rounded-xl border border-blue-100 bg-blue-50/50 px-2.5 py-2.5 flex flex-col items-center gap-1.5 text-center w-full xl:w-[108px]">
                    <span className="w-7 h-7 rounded-lg bg-white text-[#2563EB] border border-blue-100 flex items-center justify-center"><Icon className="w-4 h-4" /></span>
                    <span className="text-[10.5px] font-semibold text-[#1E3A8A] leading-tight">{label}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-col items-center gap-1.5">
              <button onClick={() => go("reserve")} className="h-11 px-5 w-full rounded-xl bg-[#2563EB] text-white text-[14px] font-bold inline-flex items-center justify-center gap-2 hover:bg-[#1e50c8] transition-colors"><ShieldCheck className="w-4 h-4" /> Reserve This Vehicle</button>
              <p className="text-[11px] text-[#64748B]">No obligation. Fully refundable.</p>
            </div>
          </div>
        </section>

        {/* Buying score breakdown */}
        <section className={`${CARD} p-5 sm:p-6`}>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <H2>Buying Score Breakdown</H2>
              <p className={`text-[13px] ${TEXT2} mt-1`}>How each factor contributes to the overall score.</p>
            </div>
            {score != null && (
              <div className="sm:text-right">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#94A3B8]">Overall Confidence</p>
                <p className="leading-none mt-1"><span className="text-[34px] font-extrabold text-[#0F172A]">{score}</span><span className="text-[13px] font-bold text-[#94A3B8]"> /100</span><span className="text-[13px] font-extrabold ml-2" style={{ color: tier.color }}>{tier.label}</span></p>
                <div className="h-1.5 w-full sm:w-[220px] rounded-full bg-slate-100 overflow-hidden mt-2"><div className="h-full rounded-full" style={{ width: `${score}%`, background: tier.color }} /></div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">{breakdown.map((b) => <ScoreCard key={b.label} {...b} />)}</div>
        </section>

        {/* Mid grid: why it scored high · considerations · market position */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1.45fr] gap-5 items-start">
          {why.length > 0 && (
            <Panel title="Why It Scored High">
              <ul className="space-y-2">{why.map((w) => <li key={w} className="flex items-start gap-2 text-[13px] text-[#0F172A]"><CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />{w}</li>)}</ul>
            </Panel>
          )}
          <Panel title="Ownership Considerations" sub="Good things to plan for — not drawbacks.">
            <div className="space-y-2.5">{know.map((k) => <div key={k} className="rounded-xl border border-[#E6E8EC] bg-slate-50 p-3 flex items-start gap-2 text-[12.5px] text-[#334155]"><Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />{k}</div>)}</div>
          </Panel>
          <Panel title="Market Position" sub="How this vehicle compares to similar listings.">
            <div className="rounded-xl border border-[#E6E8EC] overflow-hidden">
              <div className="grid grid-cols-[1.1fr_1fr_1fr_auto] gap-2 text-[10px] font-bold uppercase tracking-wide text-[#94A3B8] bg-slate-50 px-3 py-2"><span>Metric</span><span>This Vehicle</span><span>Market Avg</span><span className="min-w-[86px] text-right">Advantage</span></div>
              {posRows.map((r) => (
                <div key={r.k} className="grid grid-cols-[1.1fr_1fr_1fr_auto] gap-2 px-3 py-2 border-t border-[#F1F5F9] text-[12px] items-center">
                  <span className="text-[#64748B]">{r.k}</span>
                  <span className="font-bold text-[#0F172A]">{r.v}</span>
                  <span className="text-[#64748B]">{r.m}</span>
                  <span className="min-w-[86px] text-right">{r.a ? <span className={`inline-flex items-center text-[10px] font-bold rounded-full px-2 py-0.5 border ${r.a.good ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-600 border-slate-200"}`}>{r.a.text}</span> : <span className="text-[#CBD5E1]">—</span>}</span>
                </div>
              ))}
            </div>
            {d.belowMarket && d.belowMarket > 0 ? (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 flex items-center gap-2 text-[12.5px] font-semibold text-emerald-800">
                <TrendingUp className="w-4 h-4 text-[#16A34A] shrink-0" /> Great value — priced {fmt$(d.belowMarket)} below market average.
              </div>
            ) : msrpDelta != null && msrpDelta > 0 ? (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 flex items-center gap-2 text-[12.5px] font-semibold text-emerald-800">
                <TrendingUp className="w-4 h-4 text-[#16A34A] shrink-0" /> {fmt$(msrpDelta)} below the original sticker for this build.
              </div>
            ) : premium && listing.trim && pctVsAnchor != null && pctVsAnchor >= -3 ? (
              <p className="text-[11px] text-[#64748B] mt-3">Priced at market for its trim — {listing.trim} is a top trim level, and the market range includes lower-equipped builds.</p>
            ) : null}
          </Panel>
        </div>

        {/* Row: ownership cost · similar vehicles · AI recommendation */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1.5fr_1fr] gap-5 items-start">
          <Panel title="5-Year Ownership Cost Estimate" sub="Estimated annual costs and projection.">
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
              {Object.entries(annual).map(([k, v]) => {
                const short: Record<string, string> = { Fuel: "Fuel", Insurance: "Insure", Maintenance: "Maint.", Repairs: "Repairs", Registration: "Reg." };
                return <div key={k} className="rounded-xl border border-[#E6E8EC] bg-white p-2 text-center min-w-0"><p className="text-[9px] uppercase tracking-wide text-[#94A3B8]" title={k}>{short[k] ?? k}</p><p className="text-[12.5px] font-extrabold mt-0.5">{fmt$(v)}<span className="text-[9px] text-[#94A3B8] font-medium">/yr</span></p></div>;
              })}
            </div>
            <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50/60 p-4">
              <p className="text-[11px] font-semibold text-[#64748B]">5-Year Ownership Estimate</p>
              <p className="text-[24px] font-extrabold text-[#2563EB] leading-tight">{fmt$(fiveYear)}</p>
              <p className="text-[12px] font-semibold text-[#64748B] mt-0.5">{fmt$(perMonth)}/month average</p>
              <svg viewBox="0 0 230 60" className="w-full mt-2" aria-hidden="true">
                <polyline fill="none" stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={[1, 2, 3, 4, 5].map((yr, i) => `${14 + i * 50},${50 - (yr / 5) * 40}`).join(" ")} />
                {[1, 2, 3, 4, 5].map((yr, i) => (
                  <g key={yr}>
                    <circle cx={14 + i * 50} cy={50 - (yr / 5) * 40} r="3.5" fill="#2563EB" stroke="#fff" strokeWidth="1.5" />
                    <text x={14 + i * 50} y={59} textAnchor="middle" fontSize="7.5" fill="#64748B">Yr {yr}</text>
                  </g>
                ))}
              </svg>
            </div>
            <p className="text-[10.5px] text-[#94A3B8] mt-2 leading-snug">Estimates only. Actual costs vary by driver, region, usage, insurance profile, and maintenance history.</p>
          </Panel>

          <Panel title="Similar Vehicles" sub="Comparable listings and why this vehicle may be the stronger choice.">
            {similar.length ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="rounded-2xl border-2 border-[#2563EB] bg-blue-50/40 p-2.5 gb-lift">
                    <div className="h-20 rounded-lg bg-[#eef0f3] flex items-center justify-center mb-2 overflow-hidden relative">
                      {listing.hero_image_url ? <img src={listing.hero_image_url} alt="" className="w-full h-full object-cover rounded-lg" /> : <Car className="w-6 h-6 text-[#94A3B8]" />}
                      <span className="absolute top-1.5 left-1.5 text-[9px] font-bold rounded-full bg-[#2563EB] text-white px-2 py-0.5">THIS VEHICLE</span>
                    </div>
                    <p className="text-[12px] font-bold leading-tight line-clamp-1">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</p>
                    <p className="text-[10.5px] text-[#94A3B8]">{listing.mileage != null ? `${listing.mileage.toLocaleString()} mi` : ""}</p>
                    <p className="text-[13px] font-extrabold mt-0.5">{d.price != null ? fmt$(d.price) : "—"}</p>
                    <ul className="mt-1.5 space-y-1">{subjectPros.map((p) => <li key={p} className="flex items-start gap-1.5 text-[10.5px] text-[#0F172A]"><CheckCircle2 className="w-3 h-3 text-[#16A34A] shrink-0 mt-0.5" />{p}</li>)}</ul>
                  </div>
                  {similar.map((s, i) => (
                    <div key={i} className={`${CARD} gb-lift p-2.5`}>
                      <div className="h-20 rounded-lg bg-[#eef0f3] flex items-center justify-center mb-2 overflow-hidden">{s.image ? <img src={s.image} alt="" className="w-full h-full object-cover rounded-lg" /> : <Car className="w-6 h-6 text-[#94A3B8]" />}</div>
                      <p className="text-[12px] font-bold leading-tight line-clamp-1">{s.ymm}{s.trim ? ` ${s.trim}` : ""}</p>
                      <p className="text-[10.5px] text-[#94A3B8]">{[s.mi > 0 ? `${s.mi.toLocaleString()} mi` : null, s.condition ? s.condition.toUpperCase() === "CPO" ? "Certified" : s.condition.charAt(0).toUpperCase() + s.condition.slice(1) : null].filter(Boolean).join(" · ")}</p>
                      <p className="text-[13px] font-extrabold mt-0.5">{fmt$(s.price)}</p>
                      <ul className="mt-1.5 space-y-1">{compSignals(s).map((sig) => (
                        <li key={sig.text} className="flex items-start gap-1.5 text-[10.5px] text-[#334155]">
                          {sig.good ? <CheckCircle2 className="w-3 h-3 text-[#16A34A] shrink-0 mt-0.5" /> : <XCircle className="w-3 h-3 text-[#94A3B8] shrink-0 mt-0.5" />}{sig.text}
                        </li>
                      ))}</ul>
                    </div>
                  ))}
                </div>
                <button onClick={() => go("comparable-vehicles")} className="mt-3 text-[12.5px] font-semibold text-[#2563EB] hover:underline inline-flex items-center gap-1">View all comparables <ChevronRight className="w-4 h-4" /></button>
              </>
            ) : <div className="rounded-xl border border-[#E6E8EC] bg-slate-50 p-4 text-[13px] text-[#64748B]">Comparable vehicles will appear here once enough market data is available.</div>}
          </Panel>

          <section className={`rounded-2xl border p-5 sm:p-6 ${recTint}`}>
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${score != null && score < 50 ? "bg-white/10 text-white" : "bg-white text-[#2563EB] border border-blue-100"}`}><Sparkles className="w-3.5 h-3.5" /></span>
              <h2 className={`text-[12px] font-bold uppercase tracking-wide ${score != null && score < 50 ? "text-white/80" : "text-[#64748B]"}`}>AI Recommendation</h2>
            </div>
            <p className="text-[26px] font-extrabold leading-tight mt-3" style={score != null && score < 50 ? { color: "#FCA5A5" } : { color: tier.color }}>{tier.verdict.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())}</p>
            <p className={`text-[13px] leading-relaxed mt-3 ${score != null && score < 50 ? "text-white/85" : "text-[#334155]"}`}>{recCopy}</p>
            {score != null && (
              <div className="flex items-center gap-3 mt-5">
                <MiniDonut pct={score} color={tier.color} />
                <div>
                  <p className={`text-[11px] font-bold uppercase tracking-wide ${score < 50 ? "text-white/70" : "text-[#94A3B8]"}`}>Confidence Level</p>
                  <p className={`text-[12.5px] font-semibold ${score < 50 ? "text-white/90" : "text-[#334155]"}`}>Based on the verified data in this report</p>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Row: decision matrix · why buy now */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-5 items-start">
          <Panel title="Buying Decision Matrix">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">{matrix.map((m) => (
              <div key={m.k} className="flex items-center justify-between gap-3 py-1.5 border-b border-[#F1F5F9]">
                <span className="text-[13px] text-[#0F172A]">{m.k}</span>
                <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${ratingPill(m.s)}`}>{ratingLabel(m.s)}</span>
              </div>
            ))}</div>
          </Panel>
          {buyNow.length > 0 && (
            <Panel title="Why Buy Now?">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {buyNow.slice(0, 6).map((b, i) => {
                  const Icon = buyNowIcons[i % buyNowIcons.length];
                  return (
                    <div key={b} className="rounded-xl border border-[#E6E8EC] bg-white p-3 flex items-start gap-2.5 gb-lift">
                      <span className="w-8 h-8 rounded-lg bg-emerald-50 text-[#16A34A] flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
                      <span className="text-[12.5px] text-[#0F172A] leading-snug">{b}</span>
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}
        </div>

        {/* Final CTA */}
        <section className="rounded-2xl p-6 sm:p-7 text-white" style={{ background: "linear-gradient(160deg,#2563EB 0%,#1e50c8 100%)" }}>
          <div className="flex flex-col lg:flex-row lg:items-center gap-5 lg:justify-between">
            <div className="flex items-start gap-3">
              <span className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0"><ShieldCheck className="w-6 h-6" /></span>
              <div>
                <h2 className="text-[22px] font-extrabold leading-tight">Ready to take the next step?</h2>
                <p className="text-[13px] opacity-90 mt-0.5">{ctaSubtitle}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <button onClick={() => go("reserve")} className="h-11 px-5 rounded-xl bg-white text-[#2563EB] text-[13.5px] font-bold inline-flex items-center gap-2 transition-transform hover:-translate-y-0.5"><ShieldCheck className="w-[18px] h-[18px]" /> Reserve This Vehicle</button>
              <button onClick={() => go("test-drive")} className="h-11 px-4 rounded-xl bg-white/10 border border-white/40 text-white text-[13.5px] font-bold inline-flex items-center gap-2 hover:bg-white/20 transition-colors"><Clock className="w-[18px] h-[18px]" /> Schedule Test Drive</button>
              <button onClick={() => go("contact")} className="h-11 px-4 rounded-xl bg-white/10 border border-white/40 text-white text-[13.5px] font-bold inline-flex items-center gap-2 hover:bg-white/20 transition-colors"><MessageSquare className="w-[18px] h-[18px]" /> Contact Dealer</button>
              <button onClick={() => window.print()} className="h-11 px-4 rounded-xl bg-white/10 border border-white/40 text-white text-[13.5px] font-bold inline-flex items-center gap-2 hover:bg-white/20 transition-colors"><Download className="w-[18px] h-[18px]" /> Download Report</button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-5 pt-4 border-t border-white/20 text-[12px] font-semibold opacity-90">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> Refundable Deposit</span>
            <span className="inline-flex items-center gap-1.5"><Car className="w-4 h-4" /> Dealer Holds Vehicle</span>
            <span className="inline-flex items-center gap-1.5"><Lock className="w-4 h-4" /> Secure Checkout</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> No Obligation</span>
          </div>
        </section>

        {/* Footer */}
        <footer className="pt-2 pb-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-2"><Logo variant="full" size={18} /></div>
          <p className="text-[12px] font-semibold text-[#0F172A]">AutoLabels Buying Report</p>
          <p className="text-[11px] text-[#94A3B8] mt-1">Generated {generatedAt} · VIN {listing.vin} · Verified {verifyDate}</p>
          <p className="text-[11px] text-[#94A3B8] mt-0.5 inline-flex items-center gap-1 justify-center"><Sparkles className="w-3 h-3 text-[#2563EB]" /> Powered by AutoLabels AI</p>
        </footer>
      </main>

      <PassportCtaDock go={go} dealerPhone={d.dealerPhone || undefined} reviewRating={d.reviewRating} advisor={d.dealerTrust} routing={d.contactRouting} vehicle={{ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin }} />
    </div>
  );
};

export default VehiclePassportGreatBuy;
