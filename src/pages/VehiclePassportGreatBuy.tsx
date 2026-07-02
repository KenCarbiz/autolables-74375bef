import { useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ChevronLeft, Download, Printer, Upload, ShieldCheck, CheckCircle2, Award, DollarSign,
  TrendingUp, Gauge, Car, Clock, Sparkles, Info, MessageSquare,
} from "lucide-react";
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
import { BLUE, GREEN, CARD } from "@/lib/passportTokens";

// ──────────────────────────────────────────────────────────────
// VehiclePassportGreatBuy — /passport-v3/:vehicleSlug/great-buy
//
// The flagship AutoLabels buying report: pricing, ownership, market,
// history, warranty, condition, equipment, and an AI recommendation in
// one premium analysis. Live data via derivePassport; honest empty
// states and clearly-labeled estimates where data isn't vehicle-specific.
// No floating CTA on this page (it stands on its own).
// ──────────────────────────────────────────────────────────────

const TEXT2 = "text-[#64748B]";

const H2 = ({ children }: { children: React.ReactNode }) => <h2 className="text-[20px] font-bold leading-7 tracking-tight text-[#0F172A]">{children}</h2>;

// Big circular score gauge.
const ScoreRing = ({ score, size = 168 }: { score: number; size?: number }) => {
  const r = size / 2 - 12, c = 2 * Math.PI * r, off = c * (1 - score / 100);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E6E8EC" strokeWidth="11" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={GREEN} strokeWidth="11" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[46px] font-extrabold text-[#0F172A] leading-none">{score}</span>
        <span className="text-[12px] font-bold text-[#94A3B8] mt-0.5">/ 100</span>
      </div>
    </div>
  );
};

const Bar = ({ label, score, note }: { label: string; score: number | null; note: string }) => (
  <div>
    <div className="flex items-center justify-between gap-3 mb-1">
      <span className="text-[13px] font-semibold text-[#0F172A]">{label}</span>
      <span className={`text-[12px] font-bold ${score == null ? "text-[#94A3B8]" : "text-[#16A34A]"}`}>{score == null ? "Pending" : score}</span>
    </div>
    <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${score ?? 0}%` }} /></div>
    <p className="text-[11px] text-[#94A3B8] mt-1">{note}</p>
  </div>
);

// Red is reserved for true negatives (accidents, open recalls, branded
// titles) — none of which this matrix carries. An at-market price is a
// neutral fact, so sub-80 scores render in slate, never warning colors.
const ratingLabel = (s: number | null) => s == null ? "Pending" : s >= 90 ? "Excellent" : s >= 80 ? "Very Good" : s >= 70 ? "Good" : "At Market";
const ratingColor = (s: number | null) => s == null ? "#94A3B8" : s >= 90 ? "#16A34A" : s >= 80 ? "#22C55E" : s >= 70 ? "#475569" : "#64748B";

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

  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const score = d.confScore;
  const purchaseLabel = score == null ? "Pending Verification" : score >= 90 ? "Excellent Purchase" : score >= 80 ? "Strong Purchase" : score >= 70 ? "Good Purchase" : "Fair Purchase";
  // price_percentile = % of comps priced BELOW this car, so a low percentile
  // means well priced. Surface it only when favorable; never praise the
  // priciest car in the set.
  const percentile = d.marketMeta.percentile;
  const topPct = percentile != null && percentile <= 25 ? `Top ${Math.max(1, percentile)}% best priced among comparable vehicles` : isPreview ? "Top 4% best priced among comparable vehicles" : null;
  const premium = /luxe|autograph|limited|platinum|premium|touring|signature|reserve|titanium|sensory|denali/i.test(listing.trim || "");
  const lowMiles = listing.mileage != null && listing.mileage < 30000;
  const seats = Number(mc.seating) || null;

  const badges = [
    (d.belowMarket && d.belowMarket > 0) || d.saveVsMsrp ? "Excellent Value" : null,
    d.belowMarket && d.belowMarket > 0 ? "Below Market Price" : null,
    d.ownerCount === 1 ? "One Owner" : null,
    d.warrantyStr ? "Factory Warranty" : null,
    d.accidentCount === 0 ? "No Accident History" : null,
    d.verifyRows.length > 0 ? "Dealer Verified" : null,
  ].filter(Boolean) as string[];

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
  const breakdown: { label: string; score: number | null; note: string }[] = [
    { label: "Price Value", score: priceVal, note: priceNote },
    { label: "Vehicle History", score: histVal, note: isNew ? "New vehicle — no accident or title history" : d.cleanTitle && d.accidentCount === 0 ? "Clean title, no accidents reported" : "History reviewed where data exists" },
    { label: "Ownership", score: ownVal, note: isNew ? "New — you are the first owner" : d.ownerCount === 1 ? "Single previous owner" : d.ownerCount != null ? `${d.ownerCount} previous owners` : "Ownership pending" },
    { label: "Warranty", score: warVal, note: d.warrantyStr ? `${d.warrantyStr} of factory coverage remains` : "Confirm coverage with dealer" },
    { label: "Equipment", score: equipVal, note: gbSheet?.packages.length ? `${gbSheet.packages.length} factory package${gbSheet.packages.length === 1 ? "" : "s"}${gbSheet.estValue ? ` · ${fmt$(gbSheet.estValue)} in options` : ""}` : equipCount > 0 ? `${equipCount} equipment highlights decoded` : "Equipment pending" },
    { label: "Market Demand", score: demandVal, note: d.viewCount != null ? `${d.viewCount.toLocaleString()} shopper views` : "Demand tracked once live" },
    { label: "Dealer Confidence", score: dealerVal, note: d.dealerTrust.googleRating ? `${d.dealerTrust.googleRating} dealer rating` : "Verified dealer" },
    { label: "Condition", score: condVal, note: d.serviceCount > 0 ? `${d.serviceCount} service records on file` : listing.condition === "new" ? "New vehicle" : "Inspected" },
    { label: "Overall Confidence", score: score, note: d.confLabel ? `${d.confLabel} overall` : "Building" },
  ];

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
  if (Object.keys(mc).length > 0 || (listing.key_specs && Object.keys(listing.key_specs).length > 0)) why.push("OEM data verified");

  // Things to know — balanced, honest ownership considerations (not defects).
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
  const posRows: { k: string; v: string; m: string }[] = [
    { k: "Price", v: d.price != null ? fmt$(d.price) : "—", m: trimAvg != null ? `Avg ${fmt$(trimAvg)} (${listing.trim} trim)` : d.marketAvg != null ? `Avg ${fmt$(d.marketAvg)}${d.marketMeta.trimMatched === false && listing.trim ? " (all trims)" : ""}` : isPreview ? "Avg $71,400" : "" },
    { k: "Mileage", v: listing.mileage != null ? `${listing.mileage.toLocaleString()} mi` : "—", m: avgCompMiles != null ? `Avg ${avgCompMiles.toLocaleString()} mi` : isPreview ? "Avg 24,000 mi" : "" },
    { k: "Owner Count", v: d.ownerCount != null ? `${d.ownerCount}` : "—", m: isPreview ? "Avg 1.6" : "" },
    { k: "Warranty", v: d.warrantyStr ? `${d.warrantyStr} left` : "—", m: d.warrantyStr ? "Varies" : "" },
    { k: "Market Days", v: d.dom != null ? `${d.dom} days` : "—", m: d.marketMeta.avgDom != null ? `Avg ${d.marketMeta.avgDom} days` : isPreview ? "Avg 38 days" : "" },
  ].filter((r) => r.m && r.v !== "—");

  // Ownership cost estimate — transparent model, clearly labelled (not a vehicle-specific fact).
  const base = d.price ?? d.marketAvg ?? 45000;
  const lux = premium || base > 45000;
  const annual = { Fuel: lux ? 2500 : 2100, Insurance: Math.round((base * 0.032) / 100) * 100, Maintenance: lux ? 1200 : 800, Repairs: lux ? 700 : 500, Registration: 320 };
  const annualTotal = Object.values(annual).reduce((a, b) => a + b, 0);
  const fiveYear = annualTotal * 5;

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

  const recommend = score == null ? "Pending" : score >= 80 ? "YES" : score >= 70 ? "WORTH A LOOK" : "REVIEW CAREFULLY";
  const recLabel = score == null ? "More data needed" : score >= 90 ? "Highly Recommended" : score >= 80 ? "Recommended" : score >= 70 ? "Consider" : "Review";
  const verifyDate = listing.prep_status?.foreman_signed_at ? new Date(listing.prep_status.foreman_signed_at).toLocaleDateString() : new Date().toLocaleDateString();

  const Section = ({ n, title, sub, children }: { n: number; title: string; sub?: string; children: React.ReactNode }) => (
    <section className={`${CARD} p-5 sm:p-6`}>
      <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-lg bg-blue-50 text-[#2563EB] text-[12px] font-bold flex items-center justify-center shrink-0">{n}</span><H2>{title}</H2></div>
      {sub && <p className={`text-[13px] ${TEXT2} mt-1`}>{sub}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#0F172A]" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <Helmet><title>{`Why This Is A Great Buy — ${listing.ymm}`}</title>{isPreview && <meta name="robots" content="noindex" />}</Helmet>
      {isPreview && <div className="bg-amber-500 text-white text-center text-[12px] font-bold py-1.5 px-4">SAMPLE PREVIEW — design layout with placeholder data. Not a real listing.</div>}

      <header className="border-b border-[#E6E8EC] bg-white sticky top-0 z-20">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-5 h-16 flex items-center justify-between gap-3">
          <button onClick={back} className="text-[13px] font-semibold text-[#2563EB] inline-flex items-center gap-1.5"><ChevronLeft className="w-4 h-4" /> <span className="hidden sm:inline">Back to Vehicle Passport</span><span className="sm:hidden">Back</span></button>
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={() => window.print()} className={`text-[13px] font-medium inline-flex items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Download className="w-4 h-4" /> <span className="hidden sm:inline">Download</span></button>
            <button onClick={() => window.print()} className={`hidden sm:inline-flex text-[13px] font-medium items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Printer className="w-4 h-4" /> Print</button>
            <button onClick={async () => { try { if (navigator.share) { await navigator.share({ title: "AutoLabels Buying Report", url: window.location.href }); return; } } catch { /* ignore */ } toast.success("Link copied"); }} className={`text-[13px] font-medium inline-flex items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Upload className="w-4 h-4" /> <span className="hidden sm:inline">Share</span></button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-4 sm:px-5 py-6 space-y-5">
        <div>
          <h1 className="text-[28px] sm:text-[34px] font-bold tracking-tight leading-tight">Why This Is A Great Buy</h1>
          <p className={`text-[14px] ${TEXT2} mt-1 max-w-[760px]`}>Our analysis weighs the verification checks and comparable listings on this report to show why the {listing.ymm}{listing.trim ? ` ${listing.trim}` : ""} stands out.</p>
        </div>

        {/* 1. Buying score hero */}
        <section className={`${CARD} p-6 sm:p-8`}>
          <div className="flex flex-col md:flex-row items-center gap-6 md:gap-8">
            {score != null ? <ScoreRing score={score} /> : <div className="w-[168px] h-[168px] rounded-full border-2 border-dashed border-[#E6E8EC] flex items-center justify-center text-[13px] text-[#94A3B8] text-center px-6">Score pending verification</div>}
            <div className="text-center md:text-left">
              <p className="text-[22px] font-extrabold text-[#16A34A] leading-tight">{purchaseLabel}</p>
              {topPct && <p className="text-[13px] font-semibold text-[#0F172A] mt-0.5">{topPct}</p>}
              <p className={`text-[13px] ${TEXT2} mt-2 max-w-[440px]`}>Our proprietary AutoLabels Buying Score evaluates market pricing, ownership history, warranty coverage, condition, equipment, and local market demand.</p>
              {badges.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-4 justify-center md:justify-start">
                  {badges.map((b) => <span key={b} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#0F172A] bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1"><CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" />{b}</span>)}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 2. Executive summary */}
        <Section n={2} title="Executive Summary">
          <p className="text-[14px] leading-relaxed text-[#334155]">
            This {listing.ymm}{listing.trim ? ` ${listing.trim}` : ""} ranks among the stronger vehicles currently available in your market. It combines{" "}
            {[d.belowMarket && d.belowMarket > 0 ? "below-market pricing" : null, lowMiles ? "low mileage" : null, d.cleanTitle && d.accidentCount === 0 ? "a clean ownership history" : null, d.warrantyStr ? "remaining factory warranty" : null, d.reviewRating != null && d.reviewRating >= 4.5 ? "strong owner satisfaction" : null].filter(Boolean).join(", ") || "verified vehicle data"}{" "}
            {d.belowMarket && d.belowMarket > 0 && d.price != null ? `— at ${fmt$(d.price)}, that's ${fmt$(d.belowMarket)} under comparable listings.` : "into a well-rounded purchase."}
          </p>
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-[#16A34A] shrink-0" />
            <div><p className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">AutoLabels Recommendation</p><p className="text-[16px] font-extrabold text-[#16A34A] leading-tight">{recLabel}</p></div>
          </div>
        </Section>

        {/* 3. Breakdown */}
        <Section n={3} title="Buying Score Breakdown" sub="How each factor contributes to the overall score.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">{breakdown.map((b) => <Bar key={b.label} {...b} />)}</div>
        </Section>

        {/* 4. Why it scored so high */}
        <Section n={4} title="Why It Scored So High">
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5">{why.map((w) => <li key={w} className="flex items-start gap-2 text-[13px] text-[#0F172A]"><CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />{w}</li>)}</ul>
        </Section>

        {/* 5. Things to know */}
        <Section n={5} title="Things To Know" sub="Balanced ownership expectations — not drawbacks, just good things to plan for.">
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
            <div className="grid grid-cols-3 text-[11px] font-bold uppercase tracking-wide text-[#94A3B8] bg-slate-50 px-4 py-2"><span>Metric</span><span>This Vehicle</span><span>Market</span></div>
            {posRows.map((r) => <div key={r.k} className="grid grid-cols-3 px-4 py-2.5 border-t border-[#F1F5F9] text-[13px]"><span className="text-[#64748B]">{r.k}</span><span className="font-bold text-[#0F172A]">{r.v}</span><span className="text-[#64748B]">{r.m}</span></div>)}
          </div>
        </Section>

        {/* 7. Ownership cost estimate */}
        <Section n={7} title="Ownership Cost Estimate" sub="Estimated annual costs and a five-year projection.">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {Object.entries(annual).map(([k, v]) => <div key={k} className={`${CARD} p-3 text-center`}><p className="text-[11px] text-[#94A3B8]">{k}</p><p className="text-[15px] font-extrabold mt-0.5">{fmt$(v)}<span className="text-[10px] text-[#94A3B8] font-medium">/yr</span></p></div>)}
          </div>
          <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50/60 p-4 flex items-center justify-between">
            <div><p className="text-[12px] font-semibold text-[#64748B]">Five-Year Ownership Estimate</p><p className="text-[22px] font-extrabold text-[#2563EB] leading-tight">{fmt$(fiveYear)}</p></div>
            <DollarSign className="w-7 h-7 text-[#2563EB]/40" />
          </div>
          <p className="text-[11px] text-[#94A3B8] mt-2">Estimates only, based on a general model for this vehicle class. Actual ownership costs may vary by driver, region, and usage.</p>
        </Section>

        {/* 8. Similar vehicles */}
        <Section n={8} title="Similar Vehicles" sub="Comparable listings and why this vehicle scores higher.">
          {similar.length ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{similar.map((s, i) => (
              <div key={i} className={`${CARD} p-3`}>
                <div className="h-24 rounded-lg bg-[#eef0f3] flex items-center justify-center mb-2">{s.image ? <img src={s.image} alt="" className="w-full h-full object-cover rounded-lg" /> : <Car className="w-7 h-7 text-[#94A3B8]" />}</div>
                <p className="text-[13px] font-bold leading-tight line-clamp-1">{s.ymm}{s.trim ? ` ${s.trim}` : ""}</p>
                <p className="text-[11px] text-[#94A3B8]">{[s.mi > 0 ? `${s.mi.toLocaleString()} mi` : null, s.condition ? s.condition.toUpperCase() === "CPO" ? "Certified" : s.condition.charAt(0).toUpperCase() + s.condition.slice(1) : null].filter(Boolean).join(" · ")}</p>
                {s.tag && (
                  <span className={`inline-flex items-center text-[10px] font-bold rounded-full border px-2 py-0.5 mt-1.5 ${toneChip[s.tone]}`}>
                    {s.tag}{s.tagDetail ? ` — ${s.tagDetail}` : ""}
                  </span>
                )}
                <div className="flex items-center justify-between mt-1.5"><span className="text-[14px] font-extrabold">{fmt$(s.price)}</span>{s.score != null && <span className="text-[11px] font-bold text-[#16A34A]">Score {s.score}</span>}</div>
                <button onClick={() => go("comparable-vehicles")} className="mt-2 text-[12px] font-semibold text-[#2563EB] hover:underline">View comparison</button>
              </div>
            ))}</div>
          ) : <div className={`${CARD} p-4 text-[13px] ${TEXT2}`}>Comparable vehicles will appear here once enough market data is available.</div>}
        </Section>

        {/* 9. AI recommendation */}
        <section className="rounded-2xl p-6 sm:p-8 text-white" style={{ background: "linear-gradient(160deg,#0f7a3d 0%,#16A34A 100%)" }}>
          <p className="text-[13px] font-semibold uppercase tracking-wider opacity-85">Should You Buy This Vehicle?</p>
          <div className="flex items-baseline gap-3 mt-1"><span className="text-[44px] font-extrabold leading-none">{recommend}</span><span className="text-[16px] font-bold opacity-90">{recLabel}</span></div>
          <p className="text-[14px] opacity-90 mt-3 max-w-[680px]">Our analysis indicates this vehicle offers one of the stronger combinations of value, ownership history, pricing, equipment, and warranty currently available within this market segment.</p>
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
        </section>

        {/* Footer */}
        <footer className="pt-2 pb-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-2"><Logo variant="full" size={18} /></div>
          <p className="text-[12px] font-semibold text-[#0F172A]">AutoLabels Buying Report</p>
          <p className="text-[11px] text-[#94A3B8] mt-1">Generated {new Date().toLocaleString()} · VIN {listing.vin} · Verified {verifyDate}</p>
          <p className="text-[11px] text-[#94A3B8] mt-0.5 inline-flex items-center gap-1 justify-center"><Sparkles className="w-3 h-3 text-[#2563EB]" /> Powered by AutoLabels AI</p>
        </footer>
      </main>

      <PassportCtaDock go={go} dealerPhone={d.dealerPhone || undefined} reviewRating={d.reviewRating} advisor={d.dealerTrust} routing={d.contactRouting} vehicle={{ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin }} />
    </div>
  );
};

export default VehiclePassportGreatBuy;
