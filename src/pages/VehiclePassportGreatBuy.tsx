import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Download, Printer, Upload, ShieldCheck, CheckCircle2, Award,
  DollarSign, TrendingUp, Car, Clock, Sparkles, Info, MessageSquare, Users, Package,
  FileText, BadgeCheck, Lock, XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { type VehicleListing } from "@/hooks/useVehicleListing";
import Logo from "@/components/brand/Logo";
import { derivePassport, deriveRating, ratingTier, fmt$, listingEquipment, deriveSoldClaims } from "@/lib/passportV2Data";
import { readDealerAlternatives } from "@/lib/dealerAlternatives";
import { readBuildSheet } from "@/lib/buildSheet";
import { MOCK_LISTING } from "./VehiclePassportV3";
import { usePublicListing } from "@/hooks/usePublicListing";
import PassportCtaDock from "@/components/passport/PassportCtaDock";
import { GREEN, CARD } from "@/lib/passportTokens";
import { QRCodeSVG } from "qrcode.react";

// ──────────────────────────────────────────────────────────────
// VehiclePassportGreatBuy — /v/:slug/great-buy
//
// The AutoLabels Vehicle Intelligence Report: the flagship customer
// decision page. A guided story — is it worth considering, why, what
// to verify, how it compares, what to do next — over live data via
// derivePassport. Honest empty/Pending states and clearly-labeled
// estimates where data isn't vehicle-specific; pending items read as
// "confirm with the dealer", never as warnings.
// ──────────────────────────────────────────────────────────────

const TEXT2 = "text-[#64748B]";
const BLUE_HEX = "#2563EB";

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

// Print is a purpose-built 8.5x11 report, never the responsive web layout:
// the screen DOM is hidden wholesale and a dedicated .gb-print document
// renders instead. The footer uses grid + nowrap so it can never collapse
// into the vertical letter stack the flex footer produced in print.
const GB_PRINT = `
@page { size: Letter portrait; margin: 0.5in; }
.gb-print { display: none; }
@media print {
  html, body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .gb-screen { display: none !important; }
  /* zoom scales the report up to a readable print size; page min-height is
     divided by the same factor so each sheet still maps to one page. */
  .gb-print { display: block !important; width: 100%; max-width: none; color: #0F172A; font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; zoom: 1.25; }
  /* Each page is a full-height flex column so content owns the sheet and
     the footer pins to the bottom edge — never floating mid-page above a
     half-empty sheet. 9.9in leaves rounding headroom inside the 10in
     printable area so no phantom blank pages appear. */
  .print-page { display: flex; flex-direction: column; min-height: calc(9.9in / 1.25); break-after: page; page-break-after: always; }
  .print-page:last-child { break-after: auto; page-break-after: auto; }
  .print-page > * { flex: 0 0 auto; }
  .print-body { flex: 1 1 auto; display: flex; flex-direction: column; }
  .print-avoid { break-inside: avoid; page-break-inside: avoid; }
  .print-footer { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; width: 100%; font-size: 9px; color: #64748B; border-top: 1px solid #E5E7EB; padding-top: 8px; margin-top: auto; break-inside: avoid; page-break-inside: avoid; }
  .print-footer * { min-width: 0; writing-mode: horizontal-tb !important; text-orientation: mixed !important; }
  .print-footer .print-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
`;

// Static (non-animated) confidence ring for the printed report.
const PrintRing = ({ score, color, size = 110 }: { score: number; color: string; size?: number }) => {
  const r = size / 2 - 9, c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E6E8EC" strokeWidth="9" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`${size >= 100 ? "text-[24px]" : "text-[18px]"} font-extrabold leading-none`}>{score}<span className={size >= 100 ? "text-[13px]" : "text-[10px]"}>%</span></span>
        {size >= 100 && <span className="text-[6.5px] font-bold tracking-[0.12em] text-[#94A3B8] mt-0.5">VEHICLE SCORE</span>}
      </div>
    </div>
  );
};

const PrintCard = ({ children, className = "", tone = "default" }: { children: React.ReactNode; className?: string; tone?: "default" | "amber" | "emerald" | "blue" }) => (
  <div className={`print-avoid rounded-xl border p-3.5 ${tone === "amber" ? "border-amber-200 bg-amber-50/50" : tone === "emerald" ? "border-emerald-200 bg-emerald-50/50" : tone === "blue" ? "border-blue-200 bg-blue-50/40" : "border-[#E5E7EB] bg-white"} ${className}`}>{children}</div>
);

const PrintH = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-[15px] font-extrabold tracking-tight text-[#0F172A]">{children}</h2>
);

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

// Buy-framed projection of the single ratingTier table — the bands are
// identical everywhere; only the framing differs. Confident without
// overclaiming: a 69 reads as a candidate with details to confirm, never
// "Excellent" and never a warning label.
export const scoreTier = (s: number | null): { label: string; headline: string; verdict: string; color: string } => {
  const t = ratingTier(s);
  switch (t.id) {
    case "pending": return { label: t.buyLabel, headline: "Report In Progress", verdict: "Pending Verification", color: "#94A3B8" };
    case "exceptional": return { label: t.buyLabel, headline: "Exceptional Buy Candidate", verdict: "Exceptional Candidate — Move Forward with Confidence", color: GREEN };
    case "strong": return { label: t.buyLabel, headline: "Strong Buy Candidate", verdict: "Strong Candidate — Move Forward with Confidence", color: GREEN };
    case "solid": return { label: t.buyLabel, headline: "Solid Buy Candidate", verdict: "Solid Candidate — Confirm Final Details", color: BLUE_HEX };
    case "fair": return { label: t.buyLabel, headline: "Worth Reviewing", verdict: "Fair — Confirm Key Details", color: BLUE_HEX };
    default: return { label: t.buyLabel, headline: "Talk to the Dealer About This Vehicle", verdict: "Worth a Closer Look — Talk to the Dealer About This Vehicle", color: BLUE_HEX };
  }
};

const H2 = ({ children }: { children: React.ReactNode }) => <h2 className="text-[19px] font-bold leading-7 tracking-tight text-[#0F172A]">{children}</h2>;

// Premium confidence meter — percent + caption inside the ring.
const ScoreRing = ({ score, color, size = 156 }: { score: number; color: string; size?: number }) => {
  const drawn = useDrawn();
  const r = size / 2 - 11, c = 2 * Math.PI * r;
  const off = drawn ? c * (1 - score / 100) : c;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E6E8EC" strokeWidth="11" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(.22,1,.36,1)" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[36px] font-extrabold text-[#0F172A] leading-none">{score}<span className="text-[20px]">%</span></span>
        <span className="text-[8.5px] font-bold tracking-[0.12em] text-[#94A3B8] mt-1">VEHICLE SCORE</span>
      </div>
    </div>
  );
};

// Small confidence donut for the recommendation card.
const MiniDonut = ({ pct, color, size = 84 }: { pct: number; color: string; size?: number }) => {
  const drawn = useDrawn();
  const r = size / 2 - 6, c = 2 * Math.PI * r;
  const off = drawn ? c * (1 - pct / 100) : c;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(148,163,184,.25)" strokeWidth="7" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(.22,1,.36,1)" }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center"><span className="text-[18px] font-extrabold text-[#0F172A]">{pct}%</span></div>
    </div>
  );
};

// Factor card: icon, name, score or a calm Pending state, animated bar, and
// the factor's evidence lines. Pending renders in soft amber — "confirm",
// not "warning".
const ScoreCard = ({ icon: Icon, label, score, evidence, pendingLabel = "Pending" }: { icon: LucideIcon; label: string; score: number | null; evidence: string[]; pendingLabel?: string }) => {
  const drawn = useDrawn();
  const pending = score == null;
  return (
    <div className={`rounded-2xl border p-4 gb-lift ${pending ? "border-amber-200 bg-amber-50/40" : "border-[#E6E8EC] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.05)]"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 min-w-0">
          <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${pending ? "bg-amber-100 text-amber-700" : "bg-blue-50 text-[#2563EB]"}`}><Icon className="w-4 h-4" /></span>
          <span className="text-[13px] font-bold text-[#0F172A] truncate">{label}</span>
        </span>
        {pending
          ? <span className="text-[11px] font-bold text-amber-700 bg-amber-100/80 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">{pendingLabel}</span>
          : <span className="text-[15px] font-extrabold text-[#0F172A] shrink-0">{score}<span className="text-[10px] font-bold text-[#94A3B8]">/100</span></span>}
      </div>
      <div className={`h-2 rounded-full overflow-hidden mt-2.5 ${pending ? "bg-amber-100/70" : "bg-slate-100"}`}>
        <div className="h-full rounded-full" style={{ width: drawn ? `${score ?? 0}%` : "0%", background: pending ? "transparent" : score! >= 80 ? "#22C55E" : score! >= 70 ? BLUE_HEX : "#94A3B8", transition: "width .9s cubic-bezier(.22,1,.36,1)" }} />
      </div>
      {evidence.length > 0
        ? <ul className="mt-2 space-y-1">{evidence.map((e) => <li key={e} className="text-[11px] text-[#64748B] leading-snug">{e}</li>)}</ul>
        : <p className="text-[11px] text-[#64748B] mt-2 leading-snug">Confirm details with the dealer.</p>}
    </div>
  );
};

// Red is reserved for true negatives (accidents, open recalls, branded
// titles) — none of which this matrix carries. An at-market price is a
// neutral fact, so sub-80 scores render in slate/blue, never warning colors.
const ratingLabel = (s: number | null) => s == null ? "Confirm" : ratingTier(s).label;
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

  // The floating dock duplicates the final CTA block; hide it once the
  // final CTA scrolls into view so the two never compete.
  const ctaRef = useRef<HTMLElement | null>(null);
  const [ctaInView, setCtaInView] = useState(false);
  useEffect(() => {
    const el = ctaRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const ob = new IntersectionObserver(([e]) => setCtaInView(e.isIntersecting), { threshold: 0.15 });
    ob.observe(el);
    return () => ob.disconnect();
  }, [loading, notFound]);

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
  const sold = deriveSoldClaims(d, listing.mileage ?? null, listing.condition);
  const rating = deriveRating(listing, d);
  const score = rating.overall;
  const tier = scoreTier(score);
  const priceFactor = rating.factors.find((f) => f.key === "price") ?? null;
  // price_percentile = % of comps priced BELOW this car, so a low percentile
  // means well priced. Surface it only when favorable; never praise the
  // priciest car in the set.
  const percentile = d.marketMeta.percentile;
  const topPct = percentile != null && percentile <= 25 ? `Top ${Math.max(1, percentile)}% best priced among comparable vehicles` : isPreview ? "Top 4% best priced among comparable vehicles" : null;
  const premium = /luxe|autograph|limited|platinum|premium|touring|signature|reserve|titanium|sensory|denali/i.test(listing.trim || "");
  const lowMiles = listing.mileage != null && listing.mileage < 30000;

  const isNew = listing.condition === "new";
  // The stored comparables are value-floored server-side (every row prices at
  // or above ours), so any average over them is biased upward by construction
  // and can never anchor a price claim. Same-trim rows still serve as counts.
  // The honest anchor is the full-market median/mean from the enrich pass.
  const trimLc = (listing.trim || "").trim().toLowerCase();
  const sameTrimComps = trimLc ? d.comparables.filter((c) => (c.trim || "").trim().toLowerCase() === trimLc && c.price != null && c.price > 0) : [];
  const priceAnchor = d.marketMeta.priceMedian ?? d.marketMeta.priceMean ?? d.marketAvg;
  const pctVsAnchor = priceAnchor != null && d.price != null ? Math.round(((d.price - priceAnchor) / priceAnchor) * 100) : null;
  // New cars anchor to their own sticker — trim-exact by construction. Used
  // cars use the ±3% "at market" band (a few percent off the average is
  // normal spread, not a verdict), preferring the same-trim average.
  const msrpDelta = isNew && d.msrp != null && d.price != null ? d.msrp - d.price : null;
  const gbSheet = readBuildSheet(listing);
  const dealerCov = d.dealerCoverage.find((c) => c.mode === "included") || null;
  const dealerCovLabel = dealerCov
    ? (dealerCov.lifetime
        ? `Lifetime ${dealerCov.coverage || "powertrain"} coverage included by the dealer for as long as you own the vehicle`
        : `${[dealerCov.termYears ? `${dealerCov.termYears}-year` : null, dealerCov.termMiles ? `${dealerCov.termMiles.toLocaleString()}-mile` : null].filter(Boolean).join(" / ")} dealer ${dealerCov.coverage || "warranty"} included`)
    : null;
  // Equipment count spans the top-level features column AND the decoded
  // mc_attributes.options/.features (where the VIN decode lands) — not just the
  // features column, which the NeoVIN pull never writes to.
  const equipCount = listingEquipment(listing).length;
  // The breakdown cards are the five rating factors — projections of the one
  // deriveRating object, each with its own evidence lines. Dealer trust is
  // rendered separately below and is never part of the vehicle score.
  const FACTOR_ICONS: Record<string, LucideIcon> = { price: DollarSign, history: FileText, demand: TrendingUp, equipment: Package, coverage: ShieldCheck };
  const breakdown: { icon: LucideIcon; label: string; score: number | null; evidence: string[] }[] =
    rating.factors.map((f) => ({ icon: FACTOR_ICONS[f.key] ?? FileText, label: f.label, score: f.score, evidence: f.evidence }));
  const verified = breakdown.filter((b) => b.score != null);
  const pendingCards = breakdown.filter((b) => b.score == null);

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
  const facts = [listing.trim || null, spec("Engine"), spec("Drivetrain"), spec("Exterior Color")].filter(Boolean) as string[];

  // AI summary confidence tiles — data-gated; the three strongest render.
  const insights: { icon: LucideIcon; label: string }[] = ([
    (gbSheet?.packages.length ?? 0) > 0 || equipCount >= 8 ? { icon: Sparkles, label: "Well equipped for the price" } : null,
    d.verifyRows.length > 0 ? { icon: ShieldCheck, label: "Verified and thoroughly checked" } : null,
    isNew || d.ownerCount === 1 ? { icon: Users, label: "One-owner advantage" } : null,
    (d.belowMarket && d.belowMarket > 0) || (msrpDelta != null && msrpDelta > 0) || (priceFactor?.score ?? 0) >= 85 ? { icon: DollarSign, label: "Above average value" } : null,
    (d.marketMeta.daysSupply != null && d.marketMeta.daysSupply < 60) || (d.viewCount ?? 0) > 20 ? { icon: TrendingUp, label: "High local demand" } : null,
  ] as ({ icon: LucideIcon; label: string } | null)[]).filter(Boolean).slice(0, 3) as { icon: LucideIcon; label: string }[];

  // Verified strengths — verified positives only.
  const why: string[] = [];
  if (d.ownerCount === 1) why.push("One previous owner");
  if (isNew) why.push("New — you are the first owner");
  if (d.verifyRows.length > 0) why.push("Dealer verified");
  if (premium) why.push(`Premium trim — ${listing.trim}`);
  if (oemVerified) why.push("OEM data verified");
  if (d.belowMarket && d.belowMarket > 0) why.push(`Priced ${fmt$(d.belowMarket)} below market`);
  if (d.saveVsMsrp) why.push(`${fmt$(d.saveVsMsrp)} below MSRP`);
  else if (d.belowOriginalMsrp) why.push(`${fmt$(d.belowOriginalMsrp)} below original MSRP`);
  if (topPct) why.push(topPct);
  if (d.cleanTitle && d.accidentCount === 0) why.push("Clean title and history");
  if (dealerCovLabel) why.push(dealerCovLabel);
  if (d.warrantyStr && !d.warrantyExpired) why.push("Factory warranty remaining");
  if (d.reviewRating != null && d.reviewRating >= 4.5) why.push("Excellent owner reviews");
  if (lowMiles) why.push(`Low mileage — ${listing.mileage!.toLocaleString()} mi`);
  if (d.recallClear) why.push("No open recalls");

  // Confirm before purchase — dealer-confirmation items, framed as steps
  // rather than warnings. Data-gated: verified items don't appear.
  const confirmRows: string[] = [
    !d.warrantyStr ? "Confirm remaining warranty coverage with the dealer." : null,
    !d.recallClear && !isNew ? "Review open recall status." : null,
    !isNew && (d.accidentCount == null || d.ownerCount == null) ? "Confirm final vehicle history details." : null,
  ].filter(Boolean) as string[];

  // Market comparison — rows render only when the market cell holds a real
  // figure (a table of "Pending" reads as an unfinished report). Miles come
  // from the full-market mean, never the value-floored comparables sample.
  const avgCompMiles = d.marketMeta.milesMean != null ? Math.round(d.marketMeta.milesMean) : null;
  type Adv = { text: string; good: boolean } | null;
  const priceAboveAnchor = pctVsAnchor != null && pctVsAnchor > 0 && !(d.belowMarket && d.belowMarket > 0);
  const priceAdv: Adv =
    d.belowMarket && d.belowMarket > 0 ? { text: `${fmt$(d.belowMarket)} below`, good: true }
    : pctVsAnchor != null && pctVsAnchor <= 0 ? { text: "Better value", good: true }
    : null;
  const mmRaw = ((listing as unknown as { market_meta?: Record<string, unknown> }).market_meta || {}) as Record<string, unknown>;
  const trimCount = mmRaw.trim_count != null && Number.isFinite(Number(mmRaw.trim_count)) ? Number(mmRaw.trim_count) : null;
  type PosRow = { k: string; v: string; m: string; a: Adv };
  // A dollar anchor renders only when it sits at or above our price — the
  // sold-price median row is additionally gated by the strict sold-price claim.
  const anchorPrintable = priceAnchor != null && d.price != null && priceAnchor >= d.price;
  const posRows: PosRow[] = ([
    { k: "Price", v: d.price != null ? fmt$(d.price) : "—", m: priceAboveAnchor ? (gbSheet?.estValue ? `Carries ${fmt$(gbSheet.estValue)} in factory packages the average comparable may not include` : "Priced to today's market for its trim") : anchorPrintable ? `${fmt$(priceAnchor)}${d.marketMeta.trimMatched === false && listing.trim ? " (all trims)" : ""}` : d.marketAvg != null && d.price != null && d.marketAvg >= d.price ? fmt$(d.marketAvg) : isPreview ? "$71,400" : "", a: priceAboveAnchor ? null : priceAdv },
    sold.soldPrice && d.marketMeta.soldPriceMedian != null
      ? { k: "Typical Sold Price", v: d.price != null ? fmt$(d.price) : "—", m: `${fmt$(d.marketMeta.soldPriceMedian)} (sold median, 90 days)`, a: { text: `${fmt$(sold.soldPrice.amount)} below`, good: true } }
      : null,
    { k: "Mileage", v: listing.mileage != null ? `${listing.mileage.toLocaleString()} mi` : "—", m: avgCompMiles != null ? `${avgCompMiles.toLocaleString()} mi` : isPreview ? "24,000 mi" : "", a: avgCompMiles != null && listing.mileage != null ? (listing.mileage < avgCompMiles ? { text: "Lower mileage", good: true } : null) : isPreview ? { text: "Lower mileage", good: true } : null },
    sold.milesAdv && listing.mileage != null && d.marketMeta.soldMilesMedian != null
      ? { k: "Miles vs Sold", v: `${listing.mileage.toLocaleString()} mi`, m: `${Math.round(d.marketMeta.soldMilesMedian).toLocaleString()} mi (sold median)`, a: { text: "Under sold median", good: true } }
      : null,
    d.dom != null && d.marketMeta.avgDom != null && d.dom <= d.marketMeta.avgDom
      ? { k: "Market Days", v: `${d.dom} days`, m: `${d.marketMeta.avgDom} days`, a: d.dom < d.marketMeta.avgDom ? { text: "Shorter time", good: true } : null }
      : null,
    sold.velocity && d.dom != null && d.marketMeta.soldDomMedian != null && d.dom < d.marketMeta.soldDomMedian
      ? { k: "Days to Sell", v: `${d.dom} days listed`, m: `~${Math.round(d.marketMeta.soldDomMedian)} days (sold median)`, a: { text: "Moving faster", good: true } }
      : null,
    trimCount != null && trimCount <= 5
      ? { k: "Availability", v: `1 of ${trimCount}`, m: "Builds like this nearby", a: trimCount <= 3 || sameTrimComps.length <= 2 ? { text: "Rare build", good: true } : null }
      : null,
  ] as (PosRow | null)[]).filter((r): r is PosRow => r != null && !!r.m && r.v !== "—");

  // Ownership cost estimate — transparent model, clearly labelled (not a
  // vehicle-specific fact). Fuel uses the official EPA annual fuel cost for
  // this vehicle when fueleconomy.gov has matched it; the rest are averages.
  const base = d.price ?? d.marketAvg ?? 45000;
  const lux = premium || base > 45000;
  const epaFuel = d.epa?.annualFuelCost ?? null;
  const annual = { Fuel: epaFuel ?? (lux ? 2500 : 2100), Insurance: Math.round((base * 0.032) / 100) * 100, Maintenance: lux ? 1200 : 800, Repairs: lux ? 700 : 500, Registration: 320 };
  const annualTotal = Object.values(annual).reduce((a, b) => a + b, 0);
  const fiveYear = annualTotal * 5;
  const perMonth = Math.round(fiveYear / 60);
  const fmtK = (n: number) => n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n}`;

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
    if (s.price > 0 && d.price != null && s.price > d.price) out.push({ text: `${fmt$(s.price - d.price)} more`, good: false });
    if (s.tag) out.push({ text: s.tag + (s.tagDetail ? ` — ${s.tagDetail}` : ""), good: s.tone === "blue" || s.tone === "green" });
    return out.slice(0, 3);
  };
  const subjectPros = [
    d.ownerCount === 1 ? "One owner" : isNew ? "New — first owner" : null,
    d.verifyRows.length > 0 ? "Dealer verified" : null,
    gbSheet?.estValue ? "Better equipment" : null,
    d.belowMarket && d.belowMarket > 0 ? "Below market price" : null,
    d.warrantyStr && !d.warrantyExpired ? "Warranty remains" : null,
    avgCompMiles != null && listing.mileage != null && listing.mileage < avgCompMiles ? "Lower mileage" : null,
  ].filter(Boolean).slice(0, 3) as string[];

  // The decision matrix is a straight projection of the five rating factors —
  // no renamed re-displays of the same score, and dealer trust stays out.
  const matrix: { k: string; s: number | null }[] = [
    ...rating.factors.map((f) => ({ k: f.label, s: f.score })),
    { k: "Overall", s: score },
  ];

  // Real, verifiable urgency signals only — no fabricated scarcity.
  const buyNow: string[] = [];
  if (gbSheet?.estValue) buyNow.push(`Built with ${fmt$(gbSheet.estValue)} in valuable factory packages.`);
  if (d.ownerCount === 1) buyNow.push("One-owner vehicles like this are becoming harder to find.");
  if (d.belowMarket && d.belowMarket > 0) buyNow.push("Priced below the market average right now.");
  if (sold.velocity) buyNow.push(`${sold.velocity}.`);
  if (d.saveVsMsrp) buyNow.push(`Priced ${fmt$(d.saveVsMsrp)} below MSRP.`);
  if (d.verifyRows.length > 0) buyNow.push("Dealer verified and ready for the next step.");
  if (d.dom != null && d.marketMeta.avgDom != null && d.dom < d.marketMeta.avgDom) buyNow.push("Market days are favorable compared with similar listings.");
  else if (isPreview && buyNow.length < 4) buyNow.push("Market days are favorable compared with similar listings.");
  if ((d.viewCount ?? 0) > 20 && buyNow.length < 5) buyNow.push("High shopper interest in your area.");
  if (listing.trim && d.comparables.length >= 5 && sameTrimComps.length <= 2 && buyNow.length < 5) buyNow.push(sameTrimComps.length === 0
    ? `None of the comparable listings shown matches this ${listing.trim} build.`
    : `Only ${sameTrimComps.length} of the comparable listings shown ${sameTrimComps.length === 1 ? "is" : "are"} a ${listing.trim}.`);
  if (dealerCovLabel && buyNow.length < 4) buyNow.push(`${dealerCovLabel}.`);
  if (d.warrantyStr && !d.warrantyExpired && buyNow.length < 4) buyNow.push("Factory warranty is still active.");

  // Recommendation copy: strengths from verified data plus the specific
  // items a careful shopper should confirm — an insight, not a warning.
  const strengthWords = [
    isNew || d.ownerCount === 1 ? "strong ownership" : null,
    (gbSheet?.packages.length ?? 0) > 0 || equipCount >= 8 ? "equipment" : null,
    (priceFactor?.score ?? 0) >= 80 ? "market-position" : null,
    d.warrantyStr && !d.warrantyExpired ? "warranty" : null,
  ].filter(Boolean) as string[];
  const confirmWords = [
    !d.warrantyStr ? "remaining warranty coverage" : null,
    !d.recallClear && !isNew ? "open recall status" : null,
    !isNew && (d.accidentCount == null || d.ownerCount == null) ? "vehicle history" : null,
  ].filter(Boolean) as string[];
  const recCopy =
    score == null ? "This report is still gathering verification data. Check back shortly, or ask the dealer to complete the vehicle's verification checks."
    : `This vehicle shows ${strengthWords.length ? strengthWords.join(", ") : "verified"} signals.${confirmWords.length ? ` Confirm ${confirmWords.join(", ")} with the dealer before moving forward.` : " The verified data in this report supports moving forward."}`;
  const shortModel = (listing.ymm || "").split(/\s+/).slice(2).join(" ").trim() || "vehicle";
  const verifyDate = listing.prep_status?.foreman_signed_at ? new Date(listing.prep_status.foreman_signed_at).toLocaleDateString() : new Date().toLocaleDateString();
  const generatedAt = new Date().toLocaleString();
  const recTint = score != null && score >= 80 ? "bg-emerald-50/70 border-emerald-200" : "bg-white border-[#E6E8EC]";
  const strongTier = score != null && score >= 70;
  const heroEndorsement =
    score == null ? null
    : strongTier ? "Measured price, history, demand, equipment, and coverage data indicate this vehicle is worth serious consideration."
    : "Here's what we measured on this vehicle — price, history, demand, equipment, and coverage.";
  const vehLabel = `${listing.ymm}${listing.trim ? ` ${listing.trim}` : ""}`;
  const aiStrengths = [d.belowMarket && d.belowMarket > 0 ? "below-market pricing" : null, lowMiles ? "low mileage" : null, d.cleanTitle && d.accidentCount === 0 ? "a clean ownership history" : null, d.warrantyStr && !d.warrantyExpired ? "remaining factory warranty" : null, d.reviewRating != null && d.reviewRating >= 4.5 ? "strong owner satisfaction" : null].filter(Boolean).join(", ") || "verified vehicle data";
  const aiSummary = strongTier
    ? `This ${vehLabel} ranks among the stronger vehicles currently available in your market. It combines ${aiStrengths} ${d.belowMarket && d.belowMarket > 0 && d.price != null ? `— at ${fmt$(d.price)}, that's ${fmt$(d.belowMarket)} under comparable listings.` : "into a well-rounded purchase."}`
    : `Here's what we verified on this ${vehLabel}: ${aiStrengths}. We'll confirm the final details with you.`;

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#0F172A]" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <Helmet><title>{`AutoLabels Buying Report — ${listing.ymm}`}</title>{isPreview && <meta name="robots" content="noindex" />}</Helmet>
      <style>{GB_ANIM}</style>
      <style>{GB_PRINT}</style>
      <div className="gb-screen">
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
        {/* Hero: confidence meter + verdict · vehicle snapshot */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-5 items-stretch">
          <section className={`${CARD} gb-fade p-6 sm:p-8`}>
            <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 items-center sm:items-start">
              <div className="flex flex-col items-center text-center shrink-0 max-w-[190px]">
                {score != null ? <ScoreRing score={score} color={tier.color} /> : <div className="w-[156px] h-[156px] rounded-full border-2 border-dashed border-[#E6E8EC] flex items-center justify-center text-[13px] text-[#94A3B8] text-center px-6">Score pending verification</div>}
                <p className="text-[14px] font-extrabold mt-2.5 inline-flex items-center gap-1" style={{ color: tier.color }}>{tier.label} <Info className="w-3.5 h-3.5 opacity-60" /></p>
                <p className="text-[11px] text-[#94A3B8] mt-1 leading-snug">Built only from measured factors — price vs market, history & title, demand, equipment, and coverage.</p>
              </div>
              <div className="text-center sm:text-left min-w-0">
                <h1 className="text-[28px] sm:text-[32px] font-extrabold tracking-tight leading-tight">{tier.headline}</h1>
                {heroEndorsement && <p className={`text-[14px] ${TEXT2} mt-2 max-w-[480px] mx-auto sm:mx-0`}>{heroEndorsement}</p>}
                {trustBadges.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-4 justify-center sm:justify-start">
                    {trustBadges.map((b) => <span key={b} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#0F172A] bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" />{b}</span>)}
                  </div>
                )}
                <div className="flex flex-col sm:flex-row gap-2.5 mt-5 justify-center sm:justify-start">
                  <button onClick={() => go("reserve")} className="h-11 px-5 rounded-xl bg-[#2563EB] text-white text-[13.5px] font-bold inline-flex items-center justify-center gap-2 hover:bg-[#1e50c8] transition-colors"><ShieldCheck className="w-4 h-4" /> Reserve This Vehicle</button>
                  <button onClick={() => go("test-drive")} className="h-11 px-5 rounded-xl border border-[#2563EB] text-[#2563EB] text-[13.5px] font-bold inline-flex items-center justify-center gap-2 hover:bg-blue-50 transition-colors"><Clock className="w-4 h-4" /> Schedule Test Drive</button>
                </div>
              </div>
            </div>
          </section>
          <section className={`${CARD} gb-fade p-5`} style={{ animationDelay: "60ms" }}>
            <div className="rounded-xl overflow-hidden bg-[#eef0f3] aspect-[16/9] flex items-center justify-center">
              {listing.hero_image_url ? <img src={listing.hero_image_url} alt={listing.ymm ?? "Vehicle"} className="w-full h-full object-cover" /> : <Car className="w-10 h-10 text-[#94A3B8]" />}
            </div>
            <p className="text-[17px] font-extrabold leading-tight mt-3">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</p>
            <p className="mt-1"><span className="text-[20px] font-extrabold text-[#0F172A]">{d.price != null ? fmt$(d.price) : ""}</span>{listing.mileage != null && <span className={`text-[13px] font-semibold ${TEXT2} ml-2.5`}>{listing.mileage.toLocaleString()} mi</span>}</p>
            {facts.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {facts.map((f) => <span key={f} className="text-[11px] font-semibold text-[#334155] bg-slate-100 border border-slate-200 rounded-full px-2.5 py-1">{f}</span>)}
              </div>
            )}
            {d.dealerName && <p className="text-[12.5px] font-semibold text-[#334155] mt-3 inline-flex items-center gap-1.5"><BadgeCheck className="w-4 h-4 text-[#16A34A]" /> {d.dealerName}</p>}
          </section>
        </div>

        {/* AI buying summary: copy · confidence tiles · early CTA */}
        <section className={`${CARD} gb-fade p-5 sm:p-6`} style={{ animationDelay: "120ms" }}>
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_auto_230px] gap-6 items-center">
            <div>
              <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-lg bg-blue-50 text-[#2563EB] flex items-center justify-center shrink-0"><Sparkles className="w-3.5 h-3.5" /></span><H2>Buying Summary</H2></div>
              <p className="text-[13px] leading-relaxed text-[#334155] mt-2.5">{aiSummary}</p>
            </div>
            {insights.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {insights.map(({ icon: Icon, label }) => (
                  <div key={label} className="rounded-xl border border-blue-100 bg-blue-50/50 px-2.5 py-3 flex flex-col items-center gap-1.5 text-center w-full lg:w-[118px]">
                    <span className="w-8 h-8 rounded-lg bg-white text-[#2563EB] border border-blue-100 flex items-center justify-center"><Icon className="w-4 h-4" /></span>
                    <span className="text-[10.5px] font-semibold text-[#1E3A8A] leading-tight">{label}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-col items-center gap-1.5">
              <button onClick={() => go("reserve")} className="h-11 px-5 w-full rounded-xl bg-[#2563EB] text-white text-[14px] font-bold inline-flex items-center justify-center gap-2 hover:bg-[#1e50c8] transition-colors"><ShieldCheck className="w-4 h-4" /> Reserve This Vehicle</button>
              <p className="text-[11px] text-[#64748B]">No obligation. No payment required.</p>
            </div>
          </div>
        </section>

        {/* Buying score breakdown: verified vs confirm-before-purchase */}
        <section className={`${CARD} p-5 sm:p-6`}>
          <H2>Buying Score Breakdown</H2>
          <p className={`text-[13px] ${TEXT2} mt-1`}>We'll confirm the final details with you.</p>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700 mt-4">Verified Strengths</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-2">{verified.map((b) => <ScoreCard key={b.label} {...b} />)}</div>
          {pendingCards.length > 0 && (
            <>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700 mt-5">Confirm Before Purchase</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-2">{pendingCards.map((b) => <ScoreCard key={b.label} {...b} pendingLabel="Pending" />)}</div>
            </>
          )}
          {d.dealerTrust.googleRating && (
            <p className="text-[12px] text-[#64748B] mt-4 inline-flex items-start gap-1.5">
              <BadgeCheck className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />
              {d.dealerName} holds a {d.dealerTrust.googleRating}-star Google rating{d.dealerTrust.googleCount ? ` across ${d.dealerTrust.googleCount} reviews` : ""} — dealer reputation is shown separately and is never part of the vehicle score.
            </p>
          )}
        </section>

        {/* Market & ownership intelligence */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr_1.5fr] gap-5 items-start">
          <Panel title="Verified Strengths">
            <ul className="space-y-2.5">{why.slice(0, 8).map((w) => <li key={w} className="flex items-start gap-2 text-[13px] text-[#0F172A]"><CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />{w}</li>)}</ul>
          </Panel>
          <Panel title="Confirm Before Purchase">
            {confirmRows.length ? (
              <div className="space-y-2.5">{confirmRows.map((k) => <div key={k} className="rounded-xl border border-amber-100 bg-amber-50/50 p-3 flex items-start gap-2 text-[12.5px] text-[#334155]"><Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />{k}</div>)}</div>
            ) : (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 flex items-start gap-2 text-[12.5px] text-[#334155]"><CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />Nothing outstanding — the key records in this report are verified.</div>
            )}
          </Panel>
          <Panel title="Market Comparison" sub="How this vehicle compares to similar listings.">
            <div className="rounded-xl border border-[#E6E8EC] overflow-hidden">
              <div className="grid grid-cols-[1.1fr_1fr_1fr_auto] gap-2 text-[10px] font-bold uppercase tracking-wide text-[#94A3B8] bg-slate-50 px-3 py-2"><span>Metric</span><span>This Vehicle</span><span>Market Average</span><span className="min-w-[86px] text-right">Advantage</span></div>
              {posRows.map((r) => (
                <div key={r.k} className="grid grid-cols-[1.1fr_1fr_1fr_auto] gap-2 px-3 py-2 border-t border-[#F1F5F9] text-[12px] items-center">
                  <span className="text-[#64748B]">{r.k}</span>
                  <span className="font-extrabold text-[#0F172A]">{r.v}</span>
                  <span className="text-[#64748B]">{r.m}</span>
                  <span className="min-w-[86px] text-right">{r.a ? <span className={`inline-flex items-center text-[10px] font-bold rounded-full px-2 py-0.5 border ${r.a.good ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-600 border-slate-200"}`}>{r.a.text}</span> : <span className="text-[#CBD5E1]">—</span>}</span>
                </div>
              ))}
            </div>
            {premium && listing.trim && pctVsAnchor != null && pctVsAnchor >= -3 && !(d.belowMarket && d.belowMarket > 0) && (
              <p className="text-[11px] text-[#64748B] mt-3">Priced to today's market for its trim — {listing.trim} is a top trim level, and the market range includes lower-equipped builds.</p>
            )}
          </Panel>
        </div>

        {/* Cost & comparables */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-5 items-start">
          <Panel title="5-Year Ownership Cost Estimate" sub={`Estimate based on ${epaFuel ? "the official EPA annual fuel cost for this vehicle plus" : "fuel,"} insurance, maintenance, repairs, and registration averages. Your costs will vary.`}>
            <div className="grid grid-cols-3 gap-2.5">
              {[[fmt$(perMonth), "Monthly Average"], [fmt$(annualTotal), "Annual Average"], [fmt$(fiveYear), "5-Year Total"]].map(([v, k]) => (
                <div key={k} className="rounded-xl border border-[#E6E8EC] bg-slate-50/60 p-3 text-center"><p className="text-[16px] font-extrabold text-[#0F172A]">{v}</p><p className="text-[10.5px] text-[#64748B] mt-0.5">{k}</p></div>
              ))}
            </div>
            <div className="mt-4 rounded-xl border border-[#E6E8EC] bg-white p-3">
              <svg viewBox="0 0 300 110" className="w-full" aria-hidden="true">
                {[0, 0.5, 1].map((f) => (
                  <g key={f}>
                    <line x1="34" x2="292" y1={92 - f * 76} y2={92 - f * 76} stroke="#F1F5F9" strokeWidth="1" />
                    <text x="28" y={95 - f * 76} textAnchor="end" fontSize="8" fill="#94A3B8">{fmtK(fiveYear * f)}</text>
                  </g>
                ))}
                <polyline fill="none" stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={[1, 2, 3, 4, 5].map((yr, i) => `${48 + i * 58},${92 - (yr / 5) * 76}`).join(" ")} />
                {[1, 2, 3, 4, 5].map((yr, i) => (
                  <g key={yr}>
                    <circle cx={48 + i * 58} cy={92 - (yr / 5) * 76} r="3.5" fill="#2563EB" stroke="#fff" strokeWidth="1.5" />
                    <text x={48 + i * 58} y={104} textAnchor="middle" fontSize="8" fill="#64748B">Year {yr}</text>
                  </g>
                ))}
              </svg>
            </div>
          </Panel>

          <Panel title="Similar Vehicles in Your Market" sub="Comparable listings and why this vehicle may be the stronger choice.">
            {similar.length ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-2xl border-2 border-[#2563EB] bg-blue-50/40 p-3 gb-lift">
                    <div className="h-24 rounded-lg bg-[#eef0f3] flex items-center justify-center mb-2 overflow-hidden relative">
                      {listing.hero_image_url ? <img src={listing.hero_image_url} alt="" className="w-full h-full object-cover rounded-lg" /> : <Car className="w-6 h-6 text-[#94A3B8]" />}
                      <span className="absolute top-1.5 left-1.5 text-[9px] font-bold rounded-md bg-[#2563EB] text-white px-2 py-0.5">THIS VEHICLE</span>
                    </div>
                    <p className="text-[12.5px] font-bold leading-tight line-clamp-1">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</p>
                    <p className="text-[11px] text-[#94A3B8]">{listing.mileage != null ? `${listing.mileage.toLocaleString()} mi` : ""}</p>
                    <p className="text-[14px] font-extrabold mt-0.5">{d.price != null ? fmt$(d.price) : "—"}</p>
                    <ul className="mt-1.5 space-y-1">{subjectPros.map((p) => <li key={p} className="flex items-start gap-1.5 text-[11px] text-[#0F172A]"><CheckCircle2 className="w-3 h-3 text-[#16A34A] shrink-0 mt-0.5" />{p}</li>)}</ul>
                  </div>
                  {similar.map((s, i) => (
                    <div key={i} className={`${CARD} gb-lift p-3`}>
                      <div className="h-24 rounded-lg bg-[#eef0f3] flex items-center justify-center mb-2 overflow-hidden">{s.image ? <img src={s.image} alt="" className="w-full h-full object-cover rounded-lg" /> : <Car className="w-6 h-6 text-[#94A3B8]" />}</div>
                      <p className="text-[12.5px] font-bold leading-tight line-clamp-1">{s.ymm}{s.trim ? ` ${s.trim}` : ""}</p>
                      <p className="text-[11px] text-[#94A3B8]">{[s.mi > 0 ? `${s.mi.toLocaleString()} mi` : null, s.condition ? s.condition.toUpperCase() === "CPO" ? "Certified" : s.condition.charAt(0).toUpperCase() + s.condition.slice(1) : null].filter(Boolean).join(" · ")}</p>
                      <p className="text-[14px] font-extrabold mt-0.5">{fmt$(s.price)}</p>
                      <ul className="mt-1.5 space-y-1">{compSignals(s).map((sig) => (
                        <li key={sig.text} className="flex items-start gap-1.5 text-[11px] text-[#334155]">
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
        </div>

        {/* AutoLabels recommendation — a full-width premium insight */}
        <section className={`rounded-2xl border p-5 sm:p-6 ${recTint}`}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-emerald-50 text-[#16A34A] border border-emerald-100"><Sparkles className="w-4 h-4" /></span>
                <p className="text-[12px] font-bold uppercase tracking-wide text-[#64748B]">AutoLabels Recommendation</p>
              </div>
              <p className="text-[22px] sm:text-[24px] font-extrabold leading-tight mt-2.5 text-[#0F172A]">{tier.verdict}</p>
              <p className="text-[13.5px] leading-relaxed mt-2 max-w-[640px] text-[#334155]">{recCopy}</p>
            </div>
            {score != null && (
              <div className="flex items-center gap-4 shrink-0">
                <MiniDonut pct={score} color={score >= 60 ? GREEN : tier.color} />
                <div>
                  <p className="text-[12px] font-bold text-[#0F172A]">Vehicle Score</p>
                  <p className="text-[12px] text-[#64748B]">Based on the measured<br />factors in this report.</p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Decision matrix · why buy now */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-5 items-start">
          <Panel title="Buying Decision Matrix">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">{matrix.map((m) => (
              <div key={m.k} className="flex items-center justify-between gap-3 py-1.5 border-b border-[#F1F5F9]">
                <span className="text-[13px] text-[#0F172A]">{m.k}</span>
                <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${ratingPill(m.s)}`}>{m.k === "Overall" && m.s == null ? "Pending" : ratingLabel(m.s)}</span>
              </div>
            ))}</div>
          </Panel>
          {buyNow.length > 0 && (
            <Panel title="Why Buy Now?">
              <div className="space-y-2.5">
                {buyNow.slice(0, 5).map((b) => (
                  <div key={b} className="flex items-start gap-2.5">
                    <span className="w-7 h-7 rounded-lg bg-emerald-50 text-[#16A34A] flex items-center justify-center shrink-0"><TrendingUp className="w-3.5 h-3.5" /></span>
                    <span className="text-[13px] text-[#0F172A] leading-snug pt-1">{b}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>

        {/* Final CTA */}
        <section ref={ctaRef} className="rounded-2xl p-6 sm:p-7 text-white" style={{ background: "linear-gradient(160deg,#2563EB 0%,#1e50c8 100%)" }}>
          <div className="flex flex-col lg:flex-row lg:items-center gap-5 lg:justify-between">
            <div className="flex items-start gap-3">
              <span className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0"><ShieldCheck className="w-6 h-6" /></span>
              <div>
                <h2 className="text-[22px] font-extrabold leading-tight">Ready to move forward on this {shortModel}?</h2>
                <p className="text-[13px] opacity-90 mt-0.5">Reserve the vehicle, schedule a test drive, or contact the dealer to confirm final details.</p>
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
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> No Payment Required</span>
            <span className="inline-flex items-center gap-1.5"><Car className="w-4 h-4" /> Dealer-Confirmed Hold</span>
            <span className="inline-flex items-center gap-1.5"><Lock className="w-4 h-4" /> Secure Request</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> No Obligation</span>
          </div>
        </section>

        {/* Official report footer */}
        <footer className={`${CARD} p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between`}>
          <div className="flex items-center gap-4">
            <Logo variant="full" size={20} />
            <div>
              <p className="text-[13px] font-bold text-[#0F172A]">Vehicle Intelligence Report</p>
              <p className="text-[11.5px] text-[#94A3B8]">Generated {generatedAt} · VIN {listing.vin}{d.dealerName ? ` · ${d.dealerName}` : ""} · Verified {verifyDate}</p>
            </div>
          </div>
          <p className="text-[11.5px] text-[#94A3B8] inline-flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-[#2563EB]" /> Powered by verified dealer records and live market data.</p>
        </footer>
      </main>

      {!ctaInView && <PassportCtaDock go={go} dealerPhone={d.dealerPhone || undefined} reviewRating={d.reviewRating} advisor={d.dealerTrust} routing={d.contactRouting} vehicle={{ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin }} />}
      </div>

      {/* ── Print-only Vehicle Intelligence Report (8.5x11) ─────────────
          A purpose-built five-page document; the screen layout above is
          hidden entirely in print. */}
      <div className="gb-print">
        {(() => {
          const passportUrl = `${window.location.origin}/v/${slug}`;
          const pageHeader = (
            <div className="flex items-end justify-between border-b border-[#E5E7EB] pb-2 mb-4">
              <div className="flex items-center gap-3">
                <Logo variant="full" size={16} />
                <span className="text-[13px] font-extrabold tracking-tight">Vehicle Intelligence Report</span>
              </div>
              <span className="text-[8.5px] text-[#64748B]">Generated {generatedAt} &nbsp;|&nbsp; VIN {listing.vin}{d.dealerName ? ` | ${d.dealerName}` : ""}</span>
            </div>
          );
          const pageFooter = (page: number) => (
            <div className="print-footer">
              <Logo variant="full" size={12} />
              <span className="print-meta">Vehicle Intelligence Report &nbsp;|&nbsp; Generated {generatedAt} &nbsp;|&nbsp; VIN {listing.vin}{d.dealerName ? ` | ${d.dealerName}` : ""}</span>
              <span style={{ whiteSpace: "nowrap" }}>Page {page} of 5</span>
            </div>
          );
          const scoreBar = (b: { icon: LucideIcon; label: string; score: number | null; evidence: string[] }) => (
            <PrintCard key={b.label} tone={b.score == null ? "amber" : "default"} className="!p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 min-w-0"><b.icon className="w-3.5 h-3.5 text-[#2563EB] shrink-0" /><span className="text-[10px] font-bold truncate">{b.label}</span></span>
                {b.score == null
                  ? <span className="text-[8.5px] font-bold text-amber-700 whitespace-nowrap">Confirm</span>
                  : <span className="text-[11px] font-extrabold whitespace-nowrap">{b.score}<span className="text-[8px] text-[#94A3B8]">/100</span></span>}
              </div>
              <div className="h-[5px] rounded-full bg-slate-100 overflow-hidden mt-1.5">
                {b.score != null && <div className="h-full rounded-full" style={{ width: `${b.score}%`, background: b.score >= 80 ? "#22C55E" : b.score >= 70 ? BLUE_HEX : "#94A3B8" }} />}
              </div>
              <p className="text-[8.5px] text-[#64748B] mt-1.5 leading-snug">{b.evidence.length ? b.evidence.join(" · ") : "Confirm details with the dealer."}</p>
            </PrintCard>
          );
          const strengthsList = (
            <PrintCard>
              <PrintH>Verified Strengths</PrintH>
              <ul className="mt-2 space-y-1.5">{why.slice(0, 8).map((w) => <li key={w} className="flex items-start gap-1.5 text-[9.5px]"><CheckCircle2 className="w-3 h-3 text-[#16A34A] shrink-0 mt-px" />{w}</li>)}</ul>
            </PrintCard>
          );
          const confirmList = (
            <PrintCard tone="amber">
              <PrintH>Confirm Before Purchase</PrintH>
              {confirmRows.length ? (
                <ul className="mt-2 space-y-1.5">{confirmRows.map((k) => <li key={k} className="flex items-start gap-1.5 text-[9.5px] text-[#334155]"><Info className="w-3 h-3 text-amber-500 shrink-0 mt-px" />{k}</li>)}</ul>
              ) : <p className="mt-2 text-[9.5px] text-[#334155]">Nothing outstanding — the key records in this report are verified.</p>}
            </PrintCard>
          );
          return (
            <>
              {/* Page 1 — Executive summary */}
              <section className="print-page">
                {pageHeader}
                <div className="flex gap-5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-4">
                      {score != null ? <PrintRing score={score} color={tier.color} /> : <div className="w-[110px] h-[110px] rounded-full border-2 border-dashed border-[#E6E8EC] flex items-center justify-center text-[8.5px] text-[#94A3B8] text-center px-3 shrink-0">Score pending verification</div>}
                      <div className="min-w-0">
                        <h1 className="text-[24px] font-extrabold tracking-tight leading-tight">{tier.headline}</h1>
                        {heroEndorsement && <p className="text-[10px] text-[#64748B] mt-1 leading-relaxed">{heroEndorsement}</p>}
                      </div>
                    </div>
                    {trustBadges.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {trustBadges.map((b) => <span key={b} className="inline-flex items-center gap-1 text-[8.5px] font-semibold bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5"><CheckCircle2 className="w-2.5 h-2.5 text-[#16A34A]" />{b}</span>)}
                      </div>
                    )}
                    <PrintCard tone="blue" className="mt-3">
                      <p className="text-[9.5px] leading-relaxed text-[#334155]">
                        This {listing.ymm}{listing.trim ? ` ${listing.trim}` : ""} shows {strengthWords.length ? strengthWords.join(", ") : "verified"} signals.{confirmWords.length ? ` Confirm ${confirmWords.join(", ")} with the dealer before moving forward.` : " The verified data in this report supports moving forward."}
                      </p>
                    </PrintCard>
                  </div>
                  <div className="shrink-0" style={{ width: "38%" }}>
                    {listing.hero_image_url && <img src={listing.hero_image_url} alt={listing.ymm ?? "Vehicle"} className="w-full rounded-lg border border-[#E5E7EB] object-cover" style={{ aspectRatio: "16/10" }} />}
                    <p className="text-[13px] font-extrabold leading-tight mt-2">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</p>
                    <p className="mt-0.5"><span className="text-[15px] font-extrabold">{d.price != null ? fmt$(d.price) : ""}</span>{listing.mileage != null && <span className="text-[9.5px] font-semibold text-[#64748B] ml-2">{listing.mileage.toLocaleString()} mi</span>}</p>
                    {facts.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {facts.map((f) => <span key={f} className="text-[8px] font-semibold text-[#334155] bg-slate-100 border border-slate-200 rounded-full px-1.5 py-0.5">{f}</span>)}
                      </div>
                    )}
                    {d.dealerName && <p className="text-[9px] font-semibold text-[#334155] mt-2 inline-flex items-center gap-1"><BadgeCheck className="w-3 h-3 text-[#16A34A]" /> {d.dealerName}</p>}
                  </div>
                </div>
                {pageFooter(1)}
              </section>

              {/* Page 2 — AI summary + score breakdown */}
              <section className="print-page">
                {pageHeader}
                <PrintCard>
                  <PrintH>Buying Summary</PrintH>
                  <p className="text-[9.5px] leading-relaxed text-[#334155] mt-1.5">{aiSummary}</p>
                  {insights.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 mt-2.5">
                      {insights.map(({ icon: Icon, label }) => (
                        <div key={label} className="rounded-lg border border-blue-100 bg-blue-50/50 px-2 py-2 flex items-center gap-1.5">
                          <Icon className="w-3 h-3 text-[#2563EB] shrink-0" /><span className="text-[8.5px] font-semibold text-[#1E3A8A] leading-tight">{label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </PrintCard>
                <div className="mt-4">
                  <PrintH>Buying Score Breakdown</PrintH>
                  <p className="text-[8.5px] text-[#64748B] mt-0.5">We'll confirm the final details with you.</p>
                  {verified.length > 0 && <p className="text-[7.5px] font-bold uppercase tracking-[0.12em] text-emerald-700 mt-2.5">Verified Strengths</p>}
                  <div className="grid grid-cols-2 gap-2 mt-1.5">{verified.map(scoreBar)}</div>
                  {pendingCards.length > 0 && (
                    <>
                      <p className="text-[7.5px] font-bold uppercase tracking-[0.12em] text-amber-700 mt-3">Confirm Before Purchase</p>
                      <div className="grid grid-cols-2 gap-2 mt-1.5">{pendingCards.map(scoreBar)}</div>
                    </>
                  )}
                </div>
                {pageFooter(2)}
              </section>

              {/* Page 3 — Strengths, confirmations, market comparison */}
              <section className="print-page">
                {pageHeader}
                <div className="grid grid-cols-2 gap-3">
                  {strengthsList}
                  {confirmList}
                </div>
                <div className="mt-4 print-avoid">
                  <PrintH>Market Comparison</PrintH>
                  <p className="text-[8.5px] text-[#64748B] mt-0.5">How this vehicle compares to similar listings.</p>
                  <table className="w-full mt-2 border border-[#E5E7EB] rounded-lg" style={{ borderCollapse: "collapse" }}>
                    <thead>
                      <tr className="bg-slate-50 text-left">
                        {["Metric", "This Vehicle", "Market Average", "Advantage"].map((h) => <th key={h} className="text-[7.5px] font-bold uppercase tracking-wide text-[#64748B] px-2.5 py-1.5 border-b border-[#E5E7EB]">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {posRows.map((r) => (
                        <tr key={r.k} className="border-b border-[#F1F5F9]">
                          <td className="text-[9px] text-[#64748B] px-2.5 py-1.5">{r.k}</td>
                          <td className="text-[9px] font-extrabold px-2.5 py-1.5">{r.v}</td>
                          <td className="text-[9px] text-[#64748B] px-2.5 py-1.5">{r.m}</td>
                          <td className="px-2.5 py-1.5">{r.a ? <span className={`text-[8px] font-bold rounded-full px-1.5 py-0.5 border ${r.a.good ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-600 border-slate-200"}`}>{r.a.text}</span> : <span className="text-[#CBD5E1] text-[9px]">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {pageFooter(3)}
              </section>

              {/* Page 4 — Ownership cost + comparables */}
              <section className="print-page">
                {pageHeader}
                <PrintCard>
                  <PrintH>5-Year Ownership Cost Estimate</PrintH>
                  <p className="text-[8.5px] text-[#64748B] mt-0.5">Estimate based on {epaFuel ? "the official EPA annual fuel cost for this vehicle plus" : "fuel,"} insurance, maintenance, repairs, and registration averages. Your costs will vary.</p>
                  <div className="grid grid-cols-3 gap-2 mt-2.5">
                    {[[fmt$(perMonth), "Monthly Average"], [fmt$(annualTotal), "Annual Average"], [fmt$(fiveYear), "5-Year Total"]].map(([v, k]) => (
                      <div key={k} className="rounded-lg border border-[#E5E7EB] bg-slate-50/60 p-2 text-center"><p className="text-[12px] font-extrabold">{v}</p><p className="text-[8px] text-[#64748B] mt-0.5">{k}</p></div>
                    ))}
                  </div>
                  <svg viewBox="0 0 300 80" className="w-full mt-2.5" style={{ maxHeight: "1.1in" }} aria-hidden="true">
                    {[0, 0.5, 1].map((f) => (
                      <g key={f}>
                        <line x1="34" x2="292" y1={62 - f * 48} y2={62 - f * 48} stroke="#F1F5F9" strokeWidth="1" />
                        <text x="28" y={65 - f * 48} textAnchor="end" fontSize="7" fill="#94A3B8">{fmtK(fiveYear * f)}</text>
                      </g>
                    ))}
                    <polyline fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={[1, 2, 3, 4, 5].map((yr, i) => `${48 + i * 58},${62 - (yr / 5) * 48}`).join(" ")} />
                    {[1, 2, 3, 4, 5].map((yr, i) => (
                      <g key={yr}>
                        <circle cx={48 + i * 58} cy={62 - (yr / 5) * 48} r="2.5" fill="#2563EB" stroke="#fff" strokeWidth="1" />
                        <text x={48 + i * 58} y={74} textAnchor="middle" fontSize="7" fill="#64748B">Year {yr}</text>
                      </g>
                    ))}
                  </svg>
                </PrintCard>
                {similar.length > 0 && (
                  <div className="mt-4 print-avoid">
                    <PrintH>Similar Vehicles in Your Market</PrintH>
                    <p className="text-[8.5px] text-[#64748B] mt-0.5">Comparable listings and why this vehicle may be the stronger choice.</p>
                    <div className="space-y-2 mt-2">
                      <PrintCard tone="blue" className="!p-2.5 flex items-center gap-3">
                        {listing.hero_image_url && <img src={listing.hero_image_url} alt="" className="rounded-md object-cover shrink-0" style={{ width: "1.1in", aspectRatio: "16/10" }} />}
                        <div className="min-w-0 flex-1">
                          <p className="text-[9.5px] font-extrabold leading-tight">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""} <span className="text-[7px] font-bold text-white bg-[#2563EB] rounded px-1 py-0.5 ml-1 align-middle">THIS VEHICLE</span></p>
                          <p className="text-[8px] text-[#94A3B8]">{listing.mileage != null ? `${listing.mileage.toLocaleString()} mi` : ""}</p>
                          <p className="text-[8.5px] text-[#334155] mt-0.5">{subjectPros.join(" · ")}</p>
                        </div>
                        <span className="text-[11px] font-extrabold shrink-0">{d.price != null ? fmt$(d.price) : "—"}</span>
                      </PrintCard>
                      {similar.map((sv, i) => (
                        <PrintCard key={i} className="!p-2.5 flex items-center gap-3">
                          {sv.image && <img src={sv.image} alt="" className="rounded-md object-cover shrink-0" style={{ width: "1.1in", aspectRatio: "16/10" }} />}
                          <div className="min-w-0 flex-1">
                            <p className="text-[9.5px] font-extrabold leading-tight">{sv.ymm}{sv.trim ? ` ${sv.trim}` : ""}</p>
                            <p className="text-[8px] text-[#94A3B8]">{sv.mi > 0 ? `${sv.mi.toLocaleString()} mi` : ""}</p>
                            <p className="text-[8.5px] text-[#334155] mt-0.5">{compSignals(sv).map((sig) => sig.text).join(" · ")}</p>
                          </div>
                          <span className="text-[11px] font-extrabold shrink-0">{fmt$(sv.price)}</span>
                        </PrintCard>
                      ))}
                    </div>
                  </div>
                )}
                {pageFooter(4)}
              </section>

              {/* Page 5 — Recommendation + decision + printed action block */}
              <section className="print-page">
                {pageHeader}
                <PrintCard tone={score != null && score >= 80 ? "emerald" : "default"}>
                  <p className="text-[7.5px] font-bold uppercase tracking-wide text-[#64748B]">AutoLabels Recommendation</p>
                  <div className="flex items-center justify-between gap-4 mt-1">
                    <div className="min-w-0">
                      <p className="text-[16px] font-extrabold leading-tight">{tier.verdict}</p>
                      <p className="text-[9.5px] text-[#334155] leading-relaxed mt-1">{recCopy}</p>
                    </div>
                    {score != null && <PrintRing score={score} color={score >= 60 ? GREEN : tier.color} size={72} />}
                  </div>
                </PrintCard>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <PrintCard>
                    <PrintH>Buying Decision Matrix</PrintH>
                    <div className="mt-1.5">
                      {matrix.map((m) => (
                        <div key={m.k} className="flex items-center justify-between gap-3 py-[3px] border-b border-[#F1F5F9]">
                          <span className="text-[9px]">{m.k}</span>
                          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border ${ratingPill(m.s)}`}>{m.k === "Overall" && m.s == null ? "Pending" : ratingLabel(m.s)}</span>
                        </div>
                      ))}
                    </div>
                  </PrintCard>
                  <PrintCard>
                    <PrintH>Why Buy Now?</PrintH>
                    <ul className="mt-1.5 space-y-1.5">{buyNow.slice(0, 5).map((b) => <li key={b} className="flex items-start gap-1.5 text-[9px] leading-snug"><TrendingUp className="w-3 h-3 text-[#16A34A] shrink-0 mt-px" />{b}</li>)}</ul>
                  </PrintCard>
                </div>
                <PrintCard tone="blue" className="mt-3 flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-extrabold">Ready to move forward on this {shortModel}?</p>
                    <p className="text-[9.5px] font-semibold text-[#1E3A8A] mt-1">Reserve this vehicle &nbsp;·&nbsp; Schedule a test drive &nbsp;·&nbsp; Contact dealer</p>
                    <p className="text-[8.5px] text-[#334155] mt-1">{[d.dealerName, d.dealerPhone].filter(Boolean).join(" · ")}</p>
                  </div>
                  {!isPreview && (
                    <div className="shrink-0 text-center">
                      <QRCodeSVG value={passportUrl} size={62} />
                      <p className="text-[6.5px] font-bold text-[#64748B] mt-1">SCAN TO VIEW FULL<br />VEHICLE PASSPORT</p>
                    </div>
                  )}
                </PrintCard>
                <p className="text-[7.5px] text-[#94A3B8] leading-relaxed mt-3">
                  Powered by verified dealer records and live market data. Market values and cost estimates are provided by third-party data sources, are estimates only, and may vary by region and time. Confirm all details, pricing, and availability directly with the dealership before purchase. Generated {generatedAt} · VIN {listing.vin} · Verified {verifyDate}.
                </p>
                {pageFooter(5)}
              </section>
            </>
          );
        })()}
      </div>
    </div>
  );
};

export default VehiclePassportGreatBuy;
