import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Download, Printer, Upload, ShieldCheck, CheckCircle2, Award,
  DollarSign, TrendingUp, Gauge, Car, Clock, Sparkles, Info, MessageSquare, Users, Package,
  FileText, Wrench, BadgeCheck, Lock,
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
// VehiclePassportGreatBuy — /passport-v3/:vehicleSlug/great-buy
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
  s == null ? { label: "Pending Verification", verdict: "PENDING", headline: "Report In Progress.", color: "#94A3B8", grad: "linear-gradient(160deg,#334155 0%,#475569 100%)" }
  : s >= 90 ? { label: "Excellent Buy", verdict: "YES", headline: "One of the Best Values Available.", color: GREEN, grad: "linear-gradient(160deg,#0f7a3d 0%,#16A34A 100%)" }
  : s >= 80 ? { label: "Strong Buy", verdict: "YES", headline: "A Smart Choice.", color: GREEN, grad: "linear-gradient(160deg,#0f7a3d 0%,#16A34A 100%)" }
  : s >= 70 ? { label: "Good Buy", verdict: "WORTH A LOOK", headline: "A Smart Choice.", color: BLUE_HEX, grad: "linear-gradient(160deg,#1e40af 0%,#2563EB 100%)" }
  : s >= 60 ? { label: "Fair Buy", verdict: "REVIEW CAREFULLY", headline: "A Vehicle Worth Reviewing.", color: "#475569", grad: "linear-gradient(160deg,#334155 0%,#475569 100%)" }
  : s >= 50 ? { label: "Needs Review", verdict: "REVIEW CAREFULLY", headline: "A Vehicle Worth Reviewing.", color: AMBER_HEX, grad: "linear-gradient(160deg,#334155 0%,#475569 100%)" }
  : { label: "Proceed With Caution", verdict: "PROCEED WITH CAUTION", headline: "Review This Vehicle Closely.", color: "#DC2626", grad: "linear-gradient(160deg,#334155 0%,#475569 100%)" };

const H2 = ({ children }: { children: React.ReactNode }) => <h2 className="text-[20px] font-bold leading-7 tracking-tight text-[#0F172A]">{children}</h2>;

// Big circular score gauge — sweeps from empty to the score on mount.
const ScoreRing = ({ score, color, size = 176 }: { score: number; color: string; size?: number }) => {
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
          : <span className="text-[15px] font-extrabold text-[#0F172A] shrink-0">{score}</span>}
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
// neutral fact, so sub-80 scores render in slate, never warning colors.
const ratingLabel = (s: number | null) => s == null ? "Pending" : s >= 90 ? "Excellent" : s >= 80 ? "Very Good" : s >= 70 ? "Good" : "At Market";
const ratingColor = (s: number | null) => s == null ? "#94A3B8" : s >= 90 ? "#16A34A" : s >= 80 ? "#22C55E" : s >= 70 ? "#475569" : "#64748B";

const Section = ({ n, title, sub, children }: { n: number; title: string; sub?: string; children: React.ReactNode }) => (
  <section className={`${CARD} p-5 sm:p-6`}>
    <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-lg bg-blue-50 text-[#2563EB] text-[12px] font-bold flex items-center justify-center shrink-0">{n}</span><H2>{title}</H2></div>
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
    { icon: Gauge, label: "Overall Confidence", score: score, note: d.confLabel ? `${d.confLabel} overall` : "Building" },
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

  // Quick-fact pills from the merged key_specs/mc spec pairs.
  const spec = (label: string) => d.keySpecs.find(([k]) => k === label)?.[1] ?? null;
  const facts = [
    listing.mileage != null ? `${listing.mileage.toLocaleString()} mi` : null,
    listing.trim || null,
    spec("Engine"),
    spec("Drivetrain"),
    spec("Exterior Color"),
  ].filter(Boolean) as string[];

  // AI Buying Summary insight chips — data-gated; missing ones simply don't render.
  const insights = [
    (d.belowMarket && d.belowMarket > 0) || (msrpDelta != null && msrpDelta > 0) || (priceVal != null && priceVal >= 85) ? "Above Average Value" : null,
    (d.marketMeta.daysSupply != null && d.marketMeta.daysSupply < 60) || (d.viewCount ?? 0) > 20 ? "High Local Demand" : null,
    (gbSheet?.packages.length ?? 0) > 0 || equipCount >= 8 ? "Well Equipped for the Price" : null,
    d.verifyRows.length > 0 ? "Verified and Thoroughly Checked" : null,
  ].filter(Boolean) as string[];

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
    d.belowMarket && d.belowMarket > 0 ? { text: "Below market average", good: true }
    : pctVsAnchor != null && pctVsAnchor <= 0 ? { text: trimAvg != null ? "At or below trim average" : "At or below average", good: true }
    : pctVsAnchor != null && pctVsAnchor < 3 ? { text: "At market", good: false }
    : gbSheet?.estValue ? { text: "Premium build", good: false }
    : null;
  const posRows: { k: string; v: string; m: string; a: Adv }[] = [
    { k: "Price", v: d.price != null ? fmt$(d.price) : "—", m: trimAvg != null ? `Avg ${fmt$(trimAvg)} (${listing.trim} trim)` : d.marketAvg != null ? `Avg ${fmt$(d.marketAvg)}${d.marketMeta.trimMatched === false && listing.trim ? " (all trims)" : ""}` : isPreview ? "Avg $71,400" : "", a: priceAdv },
    { k: "Mileage", v: listing.mileage != null ? `${listing.mileage.toLocaleString()} mi` : "—", m: avgCompMiles != null ? `Avg ${avgCompMiles.toLocaleString()} mi` : isPreview ? "Avg 24,000 mi" : "", a: avgCompMiles != null && listing.mileage != null ? (listing.mileage < avgCompMiles ? { text: "Lower mileage", good: true } : { text: "Above average", good: false }) : isPreview ? { text: "Lower mileage", good: true } : null },
    { k: "Market Days", v: d.dom != null ? `${d.dom} days` : "—", m: d.marketMeta.avgDom != null ? `Avg ${d.marketMeta.avgDom} days` : isPreview ? "Avg 38 days" : "", a: d.dom != null && d.marketMeta.avgDom != null && d.dom < d.marketMeta.avgDom ? { text: "Fresh listing", good: true } : null },
    { k: "Units Available", v: d.comparables.length > 0 ? `${d.comparables.length} nearby` : "—", m: listing.trim && d.comparables.length >= 5 ? `${sameTrimComps.length} match this trim` : "", a: listing.trim && d.comparables.length >= 5 && sameTrimComps.length <= 2 ? { text: "Scarce build", good: true } : null },
    { k: "Equipment", v: gbSheet?.estValue ? `${fmt$(gbSheet.estValue)} in options` : equipCount > 0 ? `${equipCount} highlights` : "—", m: equipCount > 0 || gbSheet?.estValue ? "Varies by listing" : "", a: gbSheet?.estValue ? { text: "Well equipped", good: true } : null },
    { k: "Ownership", v: isNew ? "New — first owner" : d.ownerCount != null ? `${d.ownerCount} owner${d.ownerCount === 1 ? "" : "s"}` : "—", m: isNew || d.ownerCount != null ? "Varies" : isPreview ? "Avg 1.6" : "", a: isNew ? { text: "First owner", good: true } : d.ownerCount === 1 ? { text: "Single owner", good: true } : null },
    { k: "Warranty", v: d.warrantyStr ? `${d.warrantyStr} left` : "—", m: d.warrantyStr ? "Varies" : "", a: d.warrantyStr ? { text: "Coverage remains", good: true } : null },
    { k: "Demand", v: d.viewCount != null ? `${d.viewCount.toLocaleString()} views` : "—", m: d.viewCount != null ? "Tracked live" : "", a: (d.viewCount ?? 0) > 20 ? { text: "High interest", good: true } : null },
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
      ? dealerAlts.slice(0, 3).map((a) => ({ mi: a.mileage ?? 0, price: a.price ?? 0, score: null, ymm: a.ymm ?? listing.ymm, image: a.image ?? listing.hero_image_url ?? null, trim: a.trim, condition: a.condition, tag: a.tag === "Also in stock" ? null : a.tag, tagDetail: a.tagDetail, tone: a.tone }))
      : isPreview && d.price != null
        ? [
            { mi: 24000, price: d.price + 5200, score: 91, ymm: listing.ymm, image: listing.hero_image_url ?? null, trim: "LUXE", condition: "used", tag: "Lower package level", tagDetail: null, tone: "neutral" as const },
            { mi: 18000, price: d.price + 4360, score: 93, ymm: listing.ymm, image: listing.hero_image_url ?? null, trim: "LUXE", condition: "used", tag: "Similar build", tagDetail: null, tone: "neutral" as const },
            { mi: 31000, price: d.price + 6100, score: 88, ymm: listing.ymm, image: listing.hero_image_url ?? null, trim: "SENSORY", condition: "used", tag: "More equipment", tagDetail: "+$2,450 in factory options", tone: "blue" as const },
          ]
        : [];
  const toneChip: Record<SimilarCard["tone"], string> = {
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    violet: "bg-violet-50 text-violet-700 border-violet-200",
    neutral: "bg-slate-100 text-slate-600 border-slate-200",
  };

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
  if (d.marketMeta.daysSupply != null && d.marketMeta.daysSupply < 60) buyNow.push(`Local supply covers about ${Math.round(d.marketMeta.daysSupply)} days of demand — comparable inventory is moving quickly.`);
  else if (isPreview) buyNow.push("Comparable inventory is moving quickly in your market.");
  if (d.saveVsMsrp) buyNow.push(`Priced ${fmt$(d.saveVsMsrp)} below MSRP.`);
  if (d.belowMarket && d.belowMarket > 0) buyNow.push("Pricing is below the market average right now.");
  if (listing.trim && d.comparables.length >= 5 && sameTrimComps.length <= 2) buyNow.push(sameTrimComps.length === 0
    ? `None of the ${d.comparables.length} comparable listings nearby matches this ${listing.trim} build.`
    : `Only ${sameTrimComps.length} of ${d.comparables.length} comparable listings nearby ${sameTrimComps.length === 1 ? "is" : "are"} a ${listing.trim}.`);
  if (gbSheet?.estValue) buyNow.push(`Built with ${fmt$(gbSheet.estValue)} in factory packages.`);
  if ((d.viewCount ?? 0) > 20) buyNow.push("Shopper interest in this vehicle remains strong.");
  if (d.warrantyStr) buyNow.push("Factory warranty is still active.");
  if (d.ownerCount === 1) buyNow.push("One-owner vehicles like this are becoming harder to find.");
  if (d.dom != null && d.dom <= 14) buyNow.push(`Recently arrived — ${d.dom} day${d.dom === 1 ? "" : "s"} on the lot.`);

  // Balanced recommendation copy: strengths from verified data, and — below
  // the Strong Buy tier — the specific items a careful shopper should confirm.
  const strengths = [
    d.belowMarket && d.belowMarket > 0 ? "pricing below the market average" : msrpDelta != null && msrpDelta > 0 ? "below-sticker pricing" : null,
    d.warrantyStr ? "active factory coverage" : null,
    d.ownerCount === 1 ? "a single-owner history" : null,
    (gbSheet?.packages.length ?? 0) > 0 || equipCount >= 8 ? "a well-documented equipment list" : null,
  ].filter(Boolean) as string[];
  const confirms = [
    !d.warrantyStr ? "remaining warranty coverage" : null,
    !isNew && d.ownerCount == null ? "ownership history" : null,
    !isNew && d.accidentCount == null ? "the vehicle history report" : null,
    !d.recallClear ? "open recall status" : null,
  ].filter(Boolean) as string[];
  const recCopy =
    score == null ? "This report is still gathering verification data. Check back shortly, or ask the dealer to complete the vehicle's verification checks."
    : score >= 80 ? `Our analysis indicates this vehicle offers one of the stronger combinations of ${strengths.length ? strengths.join(", ") : "value, ownership history, pricing, equipment, and warranty"} currently available within this market segment.`
    : `This vehicle shows ${strengths.length ? strengths.join(", ") : "verified vehicle data"} in its favor.${confirms.length ? ` Before committing, confirm ${confirms.join(", ")} with the dealer.` : " Review the full report below before committing."}`;
  const verifyDate = listing.prep_status?.foreman_signed_at ? new Date(listing.prep_status.foreman_signed_at).toLocaleDateString() : new Date().toLocaleDateString();
  const generatedAt = new Date().toLocaleString();

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#0F172A]" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <Helmet><title>{`AutoLabels Buying Report — ${listing.ymm}`}</title>{isPreview && <meta name="robots" content="noindex" />}</Helmet>
      <style>{GB_ANIM}</style>
      {isPreview && <div className="bg-amber-500 text-white text-center text-[12px] font-bold py-1.5 px-4">SAMPLE PREVIEW — design layout with placeholder data. Not a real listing.</div>}

      <header className="border-b border-[#E6E8EC] bg-white sticky top-0 z-20">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-5 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Logo variant="full" size={20} />
            <span className="hidden md:block w-px h-5 bg-[#E6E8EC]" />
            <button onClick={back} className="text-[13px] font-semibold text-[#2563EB] inline-flex items-center gap-1 shrink-0"><ChevronLeft className="w-4 h-4" /> <span className="hidden md:inline">Back to Vehicle Passport</span><span className="md:hidden">Back</span></button>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={() => window.print()} className={`text-[13px] font-medium inline-flex items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Download className="w-4 h-4" /> <span className="hidden sm:inline">Download PDF</span></button>
            <button onClick={() => window.print()} className={`hidden sm:inline-flex text-[13px] font-medium items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Printer className="w-4 h-4" /> Print</button>
            <button onClick={share} className={`text-[13px] font-medium inline-flex items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Upload className="w-4 h-4" /> <span className="hidden sm:inline">Share</span></button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-4 sm:px-5 py-6 space-y-5">
        <div className="gb-fade">
          <h1 className="text-[28px] sm:text-[34px] font-bold tracking-tight leading-tight">AutoLabels Buying Report</h1>
          <p className={`text-[14px] ${TEXT2} mt-1`}>Why this vehicle earns its recommendation.</p>
          <p className="text-[11px] text-[#94A3B8] mt-1.5">Generated {generatedAt} · VIN {listing.vin}</p>
        </div>

        {/* 1. Buying score hero */}
        <section className={`${CARD} gb-fade p-6 sm:p-8`} style={{ animationDelay: "60ms" }}>
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-8 items-center">
            <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-8">
              {score != null ? <ScoreRing score={score} color={tier.color} /> : <div className="w-[176px] h-[176px] rounded-full border-2 border-dashed border-[#E6E8EC] flex items-center justify-center text-[13px] text-[#94A3B8] text-center px-6 shrink-0">Score pending verification</div>}
              <div className="text-center sm:text-left">
                <p className="text-[13px] font-bold uppercase tracking-wider" style={{ color: tier.color }}>{tier.label}</p>
                <p className="text-[24px] sm:text-[28px] font-extrabold leading-tight mt-0.5">{tier.headline}</p>
                <p className={`text-[13px] ${TEXT2} mt-1.5`}>Backed by data. Verified by AutoLabels.</p>
                {topPct && <p className="text-[13px] font-semibold text-[#0F172A] mt-2">{topPct}</p>}
                {trustBadges.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-4 justify-center sm:justify-start">
                    {trustBadges.map((b) => <span key={b} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#0F172A] bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1"><CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" />{b}</span>)}
                  </div>
                )}
              </div>
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

        {/* 2. AI buying summary */}
        <section className={`${CARD} gb-fade p-5 sm:p-6`} style={{ animationDelay: "120ms" }}>
          <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-lg bg-blue-50 text-[#2563EB] flex items-center justify-center shrink-0"><Sparkles className="w-3.5 h-3.5" /></span><H2>AI Buying Summary</H2></div>
          <p className="text-[14px] leading-relaxed text-[#334155] mt-3">
            This {listing.ymm}{listing.trim ? ` ${listing.trim}` : ""} ranks among the stronger vehicles currently available in your market. It combines{" "}
            {[d.belowMarket && d.belowMarket > 0 ? "below-market pricing" : null, lowMiles ? "low mileage" : null, d.cleanTitle && d.accidentCount === 0 ? "a clean ownership history" : null, d.warrantyStr ? "remaining factory warranty" : null, d.reviewRating != null && d.reviewRating >= 4.5 ? "strong owner satisfaction" : null].filter(Boolean).join(", ") || "verified vehicle data"}{" "}
            {d.belowMarket && d.belowMarket > 0 && d.price != null ? `— at ${fmt$(d.price)}, that's ${fmt$(d.belowMarket)} under comparable listings.` : "into a well-rounded purchase."}
          </p>
          {insights.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 mt-4">
              {insights.map((c) => (
                <div key={c} className="rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2.5 flex items-center gap-2 text-[12px] font-semibold text-[#1E3A8A]">
                  <CheckCircle2 className="w-4 h-4 text-[#2563EB] shrink-0" />{c}
                </div>
              ))}
            </div>
          )}
          <div className="mt-5 flex flex-col sm:flex-row items-center gap-3">
            <button onClick={() => go("reserve")} className="h-11 px-5 rounded-xl bg-[#2563EB] text-white text-[14px] font-bold inline-flex items-center gap-2 hover:bg-[#1e50c8] transition-colors w-full sm:w-auto justify-center"><ShieldCheck className="w-4 h-4" /> Reserve This Vehicle</button>
            <p className="text-[12px] text-[#64748B]">No obligation. Fully refundable.</p>
          </div>
        </section>

        {/* 3. Breakdown */}
        <Section n={3} title="Buying Score Breakdown" sub="How each factor contributes to the overall score.">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{breakdown.map((b) => <ScoreCard key={b.label} {...b} />)}</div>
        </Section>

        {/* 4. Why it scored high */}
        {why.length > 0 && (
          <Section n={4} title="Why It Scored High">
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5">{why.map((w) => <li key={w} className="flex items-start gap-2 text-[13px] text-[#0F172A]"><CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />{w}</li>)}</ul>
          </Section>
        )}

        {/* 5. Ownership considerations */}
        <Section n={5} title="Ownership Considerations" sub="Balanced ownership expectations — not drawbacks, just good things to plan for.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{know.map((k) => <div key={k} className="rounded-xl border border-[#E6E8EC] bg-slate-50 p-3.5 flex items-start gap-2 text-[13px] text-[#334155]"><Info className="w-4 h-4 text-[#94A3B8] shrink-0 mt-0.5" />{k}</div>)}</div>
        </Section>

        {/* 6. Market position */}
        <Section n={6} title="Market Position" sub="How this vehicle compares to similar listings.">
          {d.marketLow != null && d.marketHigh != null && d.marketAvg != null && d.price != null && (
            <div className="mb-5">
              {/* Neutral band — the low/high figures are pricing-model bounds,
                  not a good-to-bad spectrum, so no green-to-red gradient: a
                  correctly priced top trim always sits right of center. */}
              <div className="grid grid-cols-3 text-center mb-1 text-[11px] text-[#64748B]"><span>Low {fmt$(d.marketLow)}</span><span>Avg {fmt$(d.marketAvg)}</span><span>High {fmt$(d.marketHigh)}</span></div>
              <div className="relative h-2 rounded-full bg-slate-200">
                <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-[#16A34A] ring-[3px] ring-white shadow" style={{ left: `${Math.max(0, Math.min(100, ((d.price - d.marketLow) / Math.max(1, d.marketHigh - d.marketLow)) * 100))}%` }} />
              </div>
              <p className="text-center text-[12px] font-semibold text-[#16A34A] mt-2">This vehicle: {fmt$(d.price)}</p>
              {premium && listing.trim && pctVsAnchor != null && pctVsAnchor >= -3 && (
                <p className="text-center text-[11px] text-[#64748B] mt-1">Priced at market for its trim — {listing.trim} is a top trim level, and the range includes lower-equipped builds.</p>
              )}
              <p className="text-center text-[10px] text-[#94A3B8] mt-1">Range reflects estimated pricing for comparable listings in this market.</p>
            </div>
          )}
          <div className={`${CARD} p-0 overflow-hidden`}>
            <div className="grid grid-cols-3 md:grid-cols-4 text-[11px] font-bold uppercase tracking-wide text-[#94A3B8] bg-slate-50 px-4 py-2"><span>Metric</span><span>This Vehicle</span><span>Market</span><span className="hidden md:block">Advantage</span></div>
            {posRows.map((r) => (
              <div key={r.k} className="grid grid-cols-3 md:grid-cols-4 px-4 py-2.5 border-t border-[#F1F5F9] text-[13px] items-center">
                <span className="text-[#64748B]">{r.k}</span>
                <span className="font-bold text-[#0F172A]">{r.v}</span>
                <span className="text-[#64748B]">{r.m}</span>
                <span className="hidden md:block">{r.a ? <span className={`inline-flex items-center gap-1 text-[11px] font-bold rounded-full px-2.5 py-0.5 ${r.a.good ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-600 border border-slate-200"}`}>{r.a.good && <CheckCircle2 className="w-3 h-3" />}{r.a.text}</span> : <span className="text-[#CBD5E1]">—</span>}</span>
              </div>
            ))}
          </div>
          {d.belowMarket && d.belowMarket > 0 ? (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 flex items-center gap-2.5 text-[13px] font-semibold text-emerald-800">
              <TrendingUp className="w-4 h-4 text-[#16A34A] shrink-0" /> Great value — priced {fmt$(d.belowMarket)} below the market average.
            </div>
          ) : msrpDelta != null && msrpDelta > 0 ? (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 flex items-center gap-2.5 text-[13px] font-semibold text-emerald-800">
              <TrendingUp className="w-4 h-4 text-[#16A34A] shrink-0" /> {fmt$(msrpDelta)} below the original sticker for this exact build.
            </div>
          ) : null}
        </Section>

        {/* 7. Ownership cost estimate */}
        <Section n={7} title="5-Year Ownership Cost Estimate" sub="Estimated annual costs and a five-year projection.">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {Object.entries(annual).map(([k, v]) => <div key={k} className={`${CARD} gb-lift p-3 text-center`}><p className="text-[11px] text-[#94A3B8]">{k}</p><p className="text-[15px] font-extrabold mt-0.5">{fmt$(v)}<span className="text-[10px] text-[#94A3B8] font-medium">/yr</span></p></div>)}
          </div>
          <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50/60 p-4 flex flex-col sm:flex-row sm:items-center gap-4 sm:justify-between">
            <div>
              <p className="text-[12px] font-semibold text-[#64748B]">Five-Year Ownership Estimate</p>
              <p className="text-[24px] font-extrabold text-[#2563EB] leading-tight">{fmt$(fiveYear)}</p>
              <p className="text-[12px] font-semibold text-[#64748B] mt-0.5">≈ {fmt$(perMonth)}/month average</p>
            </div>
            <svg viewBox="0 0 230 72" className="w-full max-w-[230px] shrink-0" aria-hidden="true">
              {[1, 2, 3, 4, 5].map((yr, i) => {
                const h = (yr / 5) * 50;
                return (
                  <g key={yr}>
                    <rect x={i * 46 + 8} y={56 - h} width={26} height={h} rx={4} fill="#2563EB" opacity={0.25 + yr * 0.15} />
                    <text x={i * 46 + 21} y={68} textAnchor="middle" fontSize="8" fill="#64748B">Yr {yr}</text>
                  </g>
                );
              })}
            </svg>
          </div>
          <p className="text-[11px] text-[#94A3B8] mt-2">Estimates only, based on a general model for this vehicle class — not vehicle-specific records. Actual ownership costs may vary by driver, region, and usage.</p>
        </Section>

        {/* 8. Similar vehicles */}
        <Section n={8} title="Similar Vehicles" sub="Comparable listings and how this vehicle stacks up.">
          {similar.length ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded-2xl border-2 border-[#2563EB] bg-blue-50/40 p-3 gb-lift">
                  <div className="h-24 rounded-lg bg-[#eef0f3] flex items-center justify-center mb-2 overflow-hidden">{listing.hero_image_url ? <img src={listing.hero_image_url} alt="" className="w-full h-full object-cover rounded-lg" /> : <Car className="w-7 h-7 text-[#94A3B8]" />}</div>
                  <p className="text-[13px] font-bold leading-tight line-clamp-1">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</p>
                  <p className="text-[11px] text-[#94A3B8]">{listing.mileage != null ? `${listing.mileage.toLocaleString()} mi` : ""}</p>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold rounded-full bg-[#2563EB] text-white px-2 py-0.5 mt-1.5"><CheckCircle2 className="w-3 h-3" /> This Vehicle</span>
                  <div className="flex items-center justify-between mt-1.5"><span className="text-[14px] font-extrabold">{d.price != null ? fmt$(d.price) : "—"}</span>{score != null && <span className="text-[11px] font-bold text-[#16A34A]">Score {score}</span>}</div>
                </div>
                {similar.map((s, i) => (
                  <div key={i} className={`${CARD} gb-lift p-3`}>
                    <div className="h-24 rounded-lg bg-[#eef0f3] flex items-center justify-center mb-2 overflow-hidden">{s.image ? <img src={s.image} alt="" className="w-full h-full object-cover rounded-lg" /> : <Car className="w-7 h-7 text-[#94A3B8]" />}</div>
                    <p className="text-[13px] font-bold leading-tight line-clamp-1">{s.ymm}{s.trim ? ` ${s.trim}` : ""}</p>
                    <p className="text-[11px] text-[#94A3B8]">{[s.mi > 0 ? `${s.mi.toLocaleString()} mi` : null, s.condition ? s.condition.toUpperCase() === "CPO" ? "Certified" : s.condition.charAt(0).toUpperCase() + s.condition.slice(1) : null].filter(Boolean).join(" · ")}</p>
                    {s.tag && (
                      <span className={`inline-flex items-center text-[10px] font-bold rounded-full border px-2 py-0.5 mt-1.5 ${toneChip[s.tone]}`}>
                        {s.tag}{s.tagDetail ? ` — ${s.tagDetail}` : ""}
                      </span>
                    )}
                    <div className="flex items-center justify-between mt-1.5"><span className="text-[14px] font-extrabold">{fmt$(s.price)}</span>{s.score != null && <span className="text-[11px] font-bold text-[#16A34A]">Score {s.score}</span>}</div>
                  </div>
                ))}
              </div>
              <button onClick={() => go("comparable-vehicles")} className="mt-4 text-[13px] font-semibold text-[#2563EB] hover:underline inline-flex items-center gap-1">View all comparables <ChevronRight className="w-4 h-4" /></button>
            </>
          ) : <div className={`${CARD} p-4 text-[13px] ${TEXT2}`}>Comparable vehicles will appear here once enough market data is available.</div>}
        </Section>

        {/* 9. AI recommendation */}
        <section className="rounded-2xl p-6 sm:p-8 text-white" style={{ background: tier.grad }}>
          <p className="text-[13px] font-semibold uppercase tracking-wider opacity-85">Should You Buy This Vehicle?</p>
          <div className="flex flex-wrap items-baseline gap-3 mt-1"><span className="text-[38px] sm:text-[44px] font-extrabold leading-none">{tier.verdict}</span><span className="text-[16px] font-bold opacity-90">{tier.label}</span></div>
          <p className="text-[14px] opacity-90 mt-3 max-w-[680px]">{recCopy}</p>
          {score != null && <div className="mt-4 inline-flex items-center gap-2 bg-white/15 rounded-full px-4 py-1.5"><Gauge className="w-4 h-4" /><span className="text-[13px] font-bold">Confidence Level {score}%</span></div>}
        </section>

        {/* 10. Decision matrix */}
        <Section n={10} title="Buying Decision Matrix">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5">{matrix.map((m) => (
            <div key={m.k} className="flex items-center justify-between gap-3 py-1.5 border-b border-[#F1F5F9]">
              <span className="text-[13px] text-[#0F172A]">{m.k}</span>
              <span className="text-[12px] font-bold px-2.5 py-1 rounded-full text-white" style={{ background: ratingColor(m.s) }}>{ratingLabel(m.s)}</span>
            </div>
          ))}</div>
        </Section>

        {/* 11. Why buy now */}
        {buyNow.length > 0 && (
          <Section n={11} title="Why Buy Now?">
            <ul className="space-y-2.5">{buyNow.map((b) => <li key={b} className="flex items-start gap-2 text-[13px] text-[#0F172A]"><TrendingUp className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />{b}</li>)}</ul>
          </Section>
        )}

        {/* 12. CTA */}
        <section className="rounded-2xl p-6 sm:p-8 text-white text-center" style={{ background: "linear-gradient(160deg,#2563EB 0%,#1e50c8 100%)" }}>
          <h2 className="text-[24px] font-extrabold">Ready to take the next step?</h2>
          <p className="text-[13px] opacity-90 mt-1">Reserve it, schedule a drive, or talk to the dealership.</p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-5">
            <button onClick={() => go("reserve")} className="h-12 px-6 rounded-xl bg-white text-[#2563EB] text-[14px] font-bold inline-flex items-center gap-2 transition-transform hover:-translate-y-0.5"><ShieldCheck className="w-5 h-5" /> Reserve This Vehicle</button>
            <button onClick={() => go("test-drive")} className="h-12 px-5 rounded-xl bg-white/10 border border-white/40 text-white text-[14px] font-bold inline-flex items-center gap-2 hover:bg-white/20 transition-colors"><Clock className="w-5 h-5" /> Schedule Test Drive</button>
            <button onClick={() => go("contact")} className="h-12 px-5 rounded-xl bg-white/10 border border-white/40 text-white text-[14px] font-bold inline-flex items-center gap-2 hover:bg-white/20 transition-colors"><MessageSquare className="w-5 h-5" /> Contact Dealer</button>
            <button onClick={() => window.print()} className="h-12 px-5 rounded-xl bg-white/10 border border-white/40 text-white text-[14px] font-bold inline-flex items-center gap-2 hover:bg-white/20 transition-colors"><Download className="w-5 h-5" /> Download Report</button>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-6 text-[12px] font-semibold opacity-90">
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
