import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams, useLocation } from "react-router-dom";
import {
  Bookmark, MoreHorizontal, Upload, Phone, MessageSquare, Clock, DollarSign,
  ChevronRight, ChevronLeft, Star, Sparkles, ShieldCheck, CheckCircle2, MapPin,
  RefreshCw, Send, BadgeCheck, Play, Package, Award, TrendingUp, X, Info, Lock, Wrench, FileText, Eye,
  CircleCheck, CircleAlert, TriangleAlert, CircleMinus, Printer, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { usePublicListing } from "@/hooks/usePublicListing";
import { derivePassport, fmt$, historyReportName } from "@/lib/passportV2Data";
import { listingGallery } from "@/lib/photos";
import { packetVisible } from "@/lib/packetModules";
import { buildPassportActionPath } from "@/lib/passportReturn";
import PriceDropWatch from "@/components/listing/PriceDropWatch";
import PassportCtaDock from "@/components/passport/PassportCtaDock";
import VehiclePriceBreakdown from "@/components/passport/VehiclePriceBreakdown";
import AutoLabelsVerifiedCard from "@/components/passport/AutoLabelsVerifiedCard";
import { buildPassportSaleCard } from "@/lib/passport/saleCard";
import { estimateAffordability } from "@/lib/affordability";
import { readPaymentPrefs, clearPaymentPrefs, type PaymentPrefs } from "@/lib/passport/paymentPrefs";
import { resolveStickyButtons, type StickyBottomButtons } from "@/lib/stickyButtons";
import { MOCK_LISTING, MOCK_NEW_2026, MOCK_SPARSE, MOCK_NEW_MSRP, MOCK_USED_FEE } from "./VehiclePassportV3";
import type { VehicleListing } from "@/hooks/useVehicleListing";
import { isVehicleSaved, toggleSavedVehicle } from "@/lib/savedVehicles";
import { usePassportEngagement } from "@/lib/passportEngagement";
import { trackPassportOpened, trackWindowStickerScanned, trackCustomerCtaClicked } from "@/lib/engagement/customerEngagement";
import { isPassportPanelKey, type PassportPanelKey } from "@/components/passport/passportPanelKeys";
import {
  deriveVerificationReport, summarizeVerificationExceptions,
  VERIFICATION_STATUS_LABEL, VERIFICATION_CHECK_SHORT_LABEL,
  type VerificationStatus,
} from "@/lib/passport/verificationSummary";
import { MOCK_REVIEW_LISTING } from "./VehiclePassportVerification";
import PassportActionDrawer, { type PassportActionKey } from "@/components/passport/PassportActionDrawer";
import { resolveMarketComparison, type MarketSeriesPoint } from "@/lib/passport/marketComparison";
import { normalizeComparables } from "@/lib/passport/comparables";
import { resolveFuelEconomy, FUEL_MODULE_HEADING } from "@/lib/passport/fuelEconomy";
import { trackCustomerEngagement } from "@/lib/engagement/customerEngagement";
import Logo from "@/components/brand/Logo";

// One shared sticky offset for the desktop header + action center so they can
// never disagree (header height 64 + 24 gap).
const DESKTOP_STICKY_OFFSET = 88;

// Behaviour — not just appearance — differs between the mobile column and the
// desktop shell, so the active layout gates which one RENDERS (only one mounts,
// preventing duplicate observers/analytics/DOM). matchMedia is read
// synchronously at init (client-only SPA — no SSR/hydration mismatch).
function useIsDesktop(): boolean {
  const query = "(min-width: 1280px)";
  const [is, setIs] = useState<boolean>(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const on = () => setIs(mql.matches);
    on();
    mql.addEventListener?.("change", on);
    return () => mql.removeEventListener?.("change", on);
  }, []);
  return is;
}

// Fires a governed "viewed" event ONCE when ≥40% of the module is on-screen —
// never merely because it rendered offscreen. Desktop-only mount (foundation #1)
// means no cross-layer duplication.
function ModuleView({ onView, children, className, dataModule }: { onView: () => void; children: React.ReactNode; className?: string; dataModule?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const fired = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { if (!fired.current) { fired.current = true; onView(); } return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting && e.intersectionRatio >= 0.4 && !fired.current) { fired.current = true; onView(); io.disconnect(); }
    }, { threshold: [0, 0.4, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, [onView]);
  return <div ref={ref} className={className} data-module={dataModule}>{children}</div>;
}

// Dependency-free two-series line chart with a direct legend and an accessible
// text summary. Color is never the only differentiator (legend + labels).
function MarketTrendChart({ listing, market, currency }: { listing: MarketSeriesPoint[]; market: MarketSeriesPoint[]; currency: (n: number) => string }) {
  const all = [...listing, ...market].map((p) => p.value);
  if (listing.length < 2) return null;
  const w = 560, h = 150, pad = 10;
  const min = Math.min(...all), max = Math.max(...all), span = Math.max(1, max - min);
  const xs = (i: number, len: number) => pad + (len <= 1 ? 0 : (i / (len - 1)) * (w - pad * 2));
  const ys = (v: number) => pad + (1 - (v - min) / span) * (h - pad * 2);
  const path = (pts: MarketSeriesPoint[]) => pts.map((p, i) => `${xs(i, pts.length).toFixed(1)},${ys(p.value).toFixed(1)}`).join(" ");
  const first = listing[0], last = listing[listing.length - 1];
  const summary = `This vehicle's listed price moved from ${currency(first.value)} on ${first.at} to ${currency(last.value)} on ${last.at}${market.length >= 2 ? `; the normalized market value is also shown.` : "."}`;
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 150 }} role="img" aria-label={summary}>
        {market.length >= 2 && <polyline points={path(market)} fill="none" stroke="#94A3B8" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" />}
        <polyline points={path(listing)} fill="none" stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {listing.map((p, i) => <circle key={i} cx={xs(i, listing.length)} cy={ys(p.value)} r="3" fill="#2563EB" />)}
      </svg>
      <div className="mt-1 flex items-center gap-4 text-[11px]" style={{ color: "#64748B" }}>
        <span className="inline-flex items-center gap-1.5"><span className="w-4 h-0.5" style={{ background: "#2563EB" }} /> This vehicle&#39;s advertised price</span>
        {market.length >= 2 && <span className="inline-flex items-center gap-1.5"><span className="w-4 h-0.5" style={{ background: "#94A3B8" }} /> Normalized market value</span>}
      </div>
      <p className="sr-only">{summary}</p>
    </div>
  );
}

// The full slide-out dispatcher is heavy (~3200 lines). Lazy-load so the
// governed passport's first paint stays lean — the sheets only mount when
// the shopper actually opens one.
const PassportPanel = lazy(() => import("@/components/passport/PassportPanel"));

// ──────────────────────────────────────────────────────────────
// VehiclePassportGoverned — /v3/:vehicleSlug
//
// New, mobile-first "governed, intelligence-first" passport experience.
// This is a PARALLEL surface; the existing /v/:slug passport
// (VehiclePassportV3.tsx) is untouched. Data flows through the SAME
// public-listing-view → derivePassport pipeline. Only the layout and
// visual system are new: pure-white cards on a soft neutral surface,
// progressive-disclosure rows, one sticky bottom CTA bar.
// ──────────────────────────────────────────────────────────────

// Design tokens (locked spec — do NOT theme these off Tailwind because the
// governed experience is meant to look identical across every tenant).
const BLUE = "#2563EB";
const NAVY = "#0D1B2A";
const BG = "#F4F6FA";
const SUB = "#64748B";
const GREEN = "#16A34A";
const AMBER = "#F59E0B";
const BORDER = "#E6EAF0";
const CARD = "bg-white border border-[#E6EAF0] rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

// Governed 5-state verification status → presentation (icon + colors). The words
// come from the canonical VERIFICATION_STATUS_LABEL, so the hero "AutoLabels
// Verified" card, the "Verified Vehicle Data" module and the full report can
// never show different wording — or a different colour — for the same status. A
// green icon is used ONLY for "verified"; pending / needs-confirmation /
// needs-attention / unavailable never render green.
const V_STATUS_ICON: Record<VerificationStatus, { color: string; bg: string; Icon: React.ElementType }> = {
  verified: { color: GREEN, bg: "#FFFFFF", Icon: CircleCheck },
  needs_attention: { color: "#DC2626", bg: "#FEF2F2", Icon: CircleAlert },
  needs_confirmation: { color: AMBER, bg: "#FFFBEB", Icon: TriangleAlert },
  pending: { color: SUB, bg: "#F8FAFC", Icon: Clock },
  unavailable: { color: "#94A3B8", bg: "#F8FAFC", Icon: CircleMinus },
};

// Loading placeholder (NOT the locked passport design) — mirrors the served
// layout at each breakpoint so the load-in doesn't flash a narrow mobile strip
// on desktop: single column on mobile, hero + sticky action rail + module row
// on desktop.
function Skeleton() {
  return (
    <div className="min-h-screen" style={{ background: BG }}>
      <div className="h-14 border-b bg-white" style={{ borderColor: BORDER }} />
      {/* Mobile */}
      <div className="lg:hidden max-w-md mx-auto p-4 space-y-4 animate-pulse">
        <div className="aspect-[4/3] rounded-2xl bg-slate-200" />
        <div className="h-6 w-3/4 rounded bg-slate-200" />
        <div className="h-4 w-1/2 rounded bg-slate-200" />
        <div className="h-24 rounded-2xl bg-slate-200" />
        <div className="h-32 rounded-2xl bg-slate-200" />
        <div className="h-24 rounded-2xl bg-slate-200" />
      </div>
      {/* Desktop */}
      <div className="hidden lg:block max-w-6xl mx-auto px-6 py-6 animate-pulse">
        <div className="grid grid-cols-[1fr_360px] gap-6 items-start">
          <div className="space-y-4">
            <div className="aspect-[16/10] rounded-2xl bg-slate-200" />
            <div className="h-7 w-2/3 rounded bg-slate-200" />
            <div className="h-4 w-1/3 rounded bg-slate-200" />
            <div className="grid grid-cols-2 gap-4">
              <div className="h-40 rounded-2xl bg-slate-200" />
              <div className="h-40 rounded-2xl bg-slate-200" />
            </div>
            <div className="h-56 rounded-2xl bg-slate-200" />
          </div>
          <div className="space-y-4">
            <div className="h-72 rounded-2xl bg-slate-200" />
            <div className="h-40 rounded-2xl bg-slate-200" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 mt-6">
          <div className="h-48 rounded-2xl bg-slate-200" />
          <div className="h-48 rounded-2xl bg-slate-200" />
          <div className="h-48 rounded-2xl bg-slate-200" />
        </div>
      </div>
    </div>
  );
}

export default function VehiclePassportGoverned() {
  const { vehicleSlug, slug } = useParams<{ vehicleSlug?: string; slug?: string }>();
  const rawSlug = (vehicleSlug || slug || "").trim();
  const navigate = useNavigate();
  const location = useLocation();
  // Preview parity with the other passport pages (?preview=1 renders the shared
  // MOCK_LISTING) so the governed experience can be visually reviewed without a
  // live backend. No effect on real shopper traffic.
  const [search] = useSearchParams();
  // ?preview=1 and ?showcase=1 both render the shared MOCK fixtures (showcase is
  // the marketing "open the live sample" entry point). No effect on real traffic.
  const isPreview = search.get("preview") === "1" || search.has("showcase");
  // Preview parity with the verification report: ?preview=1&scenario=review renders
  // the shared review fixture (a real recall cross-source conflict + pending title)
  // so the governed passport's exception states can be reviewed against the report.
  const previewScenario = search.get("scenario");
  const previewData = (previewScenario === "review" ? MOCK_REVIEW_LISTING
    : previewScenario === "new2026" ? MOCK_NEW_2026
    : previewScenario === "sparse" ? MOCK_SPARSE
    : previewScenario === "newmsrp" ? MOCK_NEW_MSRP
    : previewScenario === "usedfee" ? MOCK_USED_FEE
    : MOCK_LISTING) as unknown as VehicleListing;
  const { listing, loading, notFound } = usePublicListing(rawSlug, { preview: isPreview, previewData });

  const d = useMemo(() => (listing ? derivePassport(listing) : null), [listing]);
  const gallery = useMemo(() => (listing ? listingGallery(listing) : []), [listing]);

  const [idx, setIdx] = useState(0);
  const [saved, setSaved] = useState<boolean | null>(null);
  const [priceOpen, setPriceOpen] = useState(false);
  const [intelOpen, setIntelOpen] = useState(true);
  const [activePanel, setActivePanel] = useState<PassportPanelKey | null>(null);
  const [actionDrawer, setActionDrawer] = useState<PassportActionKey | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const [heroInView, setHeroInView] = useState(true);
  const heroRef = useRef<HTMLDivElement | null>(null);
  const isDesktop = useIsDesktop();

  // Customer's own payment scenario (set on the Today's Price ladder). Read on
  // mount so returning to the passport reflects what they just entered; a Reset
  // clears it back to the dealer default.
  const [payPrefs, setPayPrefs] = useState<PaymentPrefs | null>(null);
  useEffect(() => { setPayPrefs(readPaymentPrefs(listing)); }, [listing]);

  // Engagement tracking mirrors the current passport exactly.
  useEffect(() => {
    if (!listing) return;
    let viaQr = false;
    try { viaQr = sessionStorage.getItem("al_visit_src") === "qr"; } catch { /* ignore */ }
    const base = { storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin };
    (viaQr ? trackWindowStickerScanned(base) : trackPassportOpened(base));
  }, [listing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  usePassportEngagement(listing?.slug || rawSlug, activePanel, true);

  // Sticky header context: reveal once the hero scrolls out of view.
  useEffect(() => {
    const el = heroRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const ob = new IntersectionObserver(([e]) => setHeroInView(e.isIntersecting), { threshold: 0.05 });
    ob.observe(el);
    return () => ob.disconnect();
  }, [loading]);

  if (loading) return <Skeleton />;
  if (notFound || !listing || !d) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: BG }}>
        <div className="text-center">
          <Package className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h1 className="text-xl font-bold" style={{ color: NAVY }}>Vehicle unavailable</h1>
          <p className="text-sm mt-2" style={{ color: SUB }}>This listing may have been sold or unpublished.</p>
        </div>
      </div>
    );
  }

  const pv = (id: string) => packetVisible(listing, id);
  // Open an existing V2 destination page (/v/:slug/:section) carrying the current
  // passport URL as a validated returnTo, so the destination's "Back to Vehicle
  // Passport" returns to THIS V3 experience. The full V2 pages/forms are reused
  // unchanged — V3 CTAs never re-implement them as drawers.
  const go = (section: string) =>
    navigate(buildPassportActionPath(listing.slug || rawSlug, section, location.pathname, isPreview));
  const openPanel = (k: PassportPanelKey) => { setActivePanel(k); };
  // Governed V3 action surfaces — reserve / test-drive / trade / contact /
  // payment / availability open a V3 drawer and NEVER navigate into the V2
  // detail pages. (Deep detail modules still use openPanel; call/text stay
  // native. verification / great-buy / dealer are governed V3-in-flow pages.)
  const openAction = (k: PassportActionKey) => { setActionDrawer(k); };
  // Canonical customer verification model — the SAME object the full Data-Verified
  // Report renders. Every verification status/count the shopper sees on this
  // passport (hero "AutoLabels Verified" card, "Verified Vehicle Data" module,
  // mobile + desktop) is derived from this one report so they can never diverge.
  const report = deriveVerificationReport(d, listing);
  const vShow = report.valid && report.totalChecks > 0;
  const vTotal = report.totalChecks;
  const vVerified = report.verifiedChecks;
  const vAllVerified = vTotal > 0 && vVerified === vTotal;
  const vSummary = summarizeVerificationExceptions(report);
  // One presentation projection of the canonical checks, reused byte-for-byte by
  // the hero card AND the Verified Vehicle Data module (both desktop + mobile).
  const vChecksUi = report.checks.map((c) => {
    const ui = V_STATUS_ICON[c.status];
    return {
      key: c.key,
      name: VERIFICATION_CHECK_SHORT_LABEL[c.key] || c.name,
      statusLabel: VERIFICATION_STATUS_LABEL[c.status],
      color: ui.color,
      bg: ui.bg,
      Icon: ui.Icon,
    };
  });
  // Recall is only a positive claim ("no open recalls") when the CANONICAL report
  // says it's verified — never on the lenient d.recallClear, which stays true even
  // under a cross-source conflict and would contradict the verified card.
  const recallVerified = report.checks.find((c) => c.key === "recall")?.status === "verified";
  // Phase E analytics — the specific event name rides in metadata.event on the
  // existing engagement pipeline (no new enum); ModuleView dedupes views. No PII.
  const firePhaseE = (event: string, extra: Record<string, unknown> = {}) =>
    trackCustomerEngagement({
      tenantId: listing.tenant_id, storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin,
      source: "passport", surface: "vehicle_passport", eventType: "engagement_ping",
      metadata: { event, passport_version: "v3", viewport_category: "desktop", layout_variant: "intelligence_first", analytics_schema_version: 1, ...extra },
    });
  const isSaved = saved ?? isVehicleSaved(listing.slug);
  const handleSave = () => {
    const now = toggleSavedVehicle({ slug: listing.slug, ymm: listing.ymm, trim: listing.trim, price: listing.price, image: gallery[0] || listing.hero_image_url || null });
    setSaved(now);
    toast.success(now ? "Saved to your list on this device" : "Removed from your saved list");
  };
  const handleShare = async () => {
    try {
      if (navigator.share) { await navigator.share({ title: listing.ymm || "Vehicle", url: window.location.href }); return; }
    } catch { /* ignore */ }
    try { await navigator.clipboard.writeText(window.location.href); toast.success("Link copied"); } catch { /* ignore */ }
  };

  const dealer = (listing.dealer_snapshot || {}) as Record<string, unknown>;
  const dealerLogo = (dealer.logo_url as string) || (dealer.logo as string) || "";
  const dealerName = d.dealerName || "";

  // ── Dealer trust (rich "Why Buy From" section) ──────────────────────────
  const dt = d.dealerTrust;
  const dealerYears = (() => {
    const n = parseInt(String(dt.yearsInBusiness || "").replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  // Founded year is derived from the years count; without a founding month we
  // show "Since <year>" rather than an exact-day claim (still concrete).
  const dealerFoundedYear = dealerYears != null ? new Date().getFullYear() - dealerYears : null;
  const makeName = (listing.ymm || "").replace(/^\d{4}\s+/, "").split(/\s+/)[0] || "";
  const authorizedByMake = !!makeName && (
    dt.certifications.some((c) => c.toLowerCase().includes(makeName.toLowerCase())) ||
    dealerName.toLowerCase().includes(makeName.toLowerCase())
  );
  const dealerBenefits = ([
    dt.familyOwned ? "Family owned" : null,
    authorizedByMake ? `Authorized ${makeName} retailer` : null,
    dt.serviceLocation === "onsite" ? "On-site service center" : null,
    dt.financing ? "Financing available" : null,
    dt.delivery && dt.delivery !== "none" ? `${dt.delivery.charAt(0).toUpperCase()}${dt.delivery.slice(1)} delivery available` : null,
  ].filter(Boolean)) as string[];
  const condition = String((listing.condition as string) || "").toLowerCase();
  const isNew = condition === "new";

  const price = d.price;

  // Itemized sale-price card — one shared mapper (buildPassportSaleCard) so the
  // live V3 passport and this governed passport build identical numbers, labels
  // and net savings from the same PassportData. New → MSRP anchor; used/CPO →
  // Market Value anchor; the total is fee-inclusive and reconciles or the card
  // degrades to the headline alone — no invented discount, no doubled fee.
  const saleCard = buildPassportSaleCard(d, condition);

  // Reflect the shopper's own payment scenario when they set one on the Today's
  // Price ladder — recomputed with the SAME estimator so the number matches the
  // ladder exactly. Only when the dealer enables payment display (d.estMonthly).
  // Still an illustration, never an offer; Reset returns to the dealer default.
  const customPayment = (payPrefs && price != null && d.estMonthly != null)
    ? (() => {
        const dp = Math.min(Math.max(0, payPrefs.down), price);
        const m = estimateAffordability({ price, downPayment: dp, aprPercent: Math.max(0, payPrefs.apr) }, [payPrefs.term])[0]?.monthly_payment;
        return m != null && Number.isFinite(m) ? { monthly: Math.round(m), down: dp, term: payPrefs.term, apr: payPrefs.apr } : null;
      })()
    : null;
  const payMonthly = customPayment ? customPayment.monthly : d.estMonthly;
  const payAssumptions = customPayment
    ? `${customPayment.term} mo · ${fmt$(customPayment.down)} down · ${customPayment.apr.toFixed(2)}% APR (example)`
    : d.paymentAssumptions;
  const resetPayment = () => { clearPaymentPrefs(listing); setPayPrefs(null); };

  // ── Intelligence chips: derive the 3 strongest vehicle-specific reasons.
  type Chip = { label: string; tone: "green" | "blue" | "amber"; icon: React.ElementType };
  const intelChips: Chip[] = [];
  if (d.belowMarket != null && d.belowMarket > 250) intelChips.push({ label: `${fmt$(d.belowMarket)} Below Market`, tone: "green", icon: TrendingUp });
  if (d.dealerVerified || (d.verifiedBy && d.verifiedBy.length > 0)) intelChips.push({ label: "Dealer Verified", tone: "blue", icon: ShieldCheck });
  if (d.warrantyStr && !d.warrantyExpired) intelChips.push({ label: `Factory Warranty · ${d.warrantyStr}`, tone: "blue", icon: Award });
  if (intelChips.length < 3 && d.ownerCount === 1) intelChips.push({ label: "1-Owner", tone: "blue", icon: BadgeCheck });
  if (intelChips.length < 3 && recallVerified) intelChips.push({ label: "No Open Recalls", tone: "green", icon: CheckCircle2 });
  if (intelChips.length < 3 && d.cleanTitle) intelChips.push({ label: "Clean Title", tone: "green", icon: CheckCircle2 });
  if (intelChips.length < 3 && d.serviceCount > 0) intelChips.push({ label: `${d.serviceCount} Service Records`, tone: "blue", icon: Award });
  const chips = intelChips.slice(0, 3);

  // ── Market position
  const marketPos = (() => {
    if (d.price == null || d.marketAvg == null) return null;
    // -1..+1 where 0 = market avg. Clamp using low/high range.
    const low = d.marketLow ?? d.marketAvg * 0.85;
    const high = d.marketHigh ?? d.marketAvg * 1.15;
    const span = Math.max(1, high - low);
    const t = Math.max(0, Math.min(1, (d.price - low) / span));
    return { t, label: d.belowMarket != null && d.belowMarket > 250 ? "Best Value" : d.belowMarket != null && d.belowMarket < -250 ? "Above Market" : "Fair Market" };
  })();

  // ── Sticky CTA (existing dealer-configurable button set)
  const stickyCfg = resolveStickyButtons((listing as unknown as { sticky_bottom_buttons?: StickyBottomButtons }).sticky_bottom_buttons);
  const stickyAction = (k: string): { icon: React.ElementType; onClick: () => void } => {
    const tap = (cta: string) => trackCustomerCtaClicked({ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: "passport", surface: "vehicle_passport", metadata: { cta } });
    // Call / Text stay native; the no-phone fallback opens the governed V3
    // Contact drawer (never the V2 contact page).
    const call = () => { tap("call"); if (d.dealerPhone) window.location.href = `tel:${d.dealerPhone}`; else openAction("contact"); };
    const text = () => {
      tap("text");
      if (d.dealerPhone) {
        const body = encodeURIComponent(`Hi, I'm interested in the ${listing.ymm || "vehicle"}${listing.vin ? ` (VIN ...${listing.vin.slice(-8)})` : ""} — is it available?`);
        window.location.href = `sms:${d.dealerPhone.replace(/[^\d+]/g, "")}?&body=${body}`;
      } else openAction("contact");
    };
    // Every primary/secondary action opens a governed V3 surface — no go() into
    // the V2 detail pages.
    const map: Record<string, { icon: React.ElementType; onClick: () => void }> = {
      call: { icon: Phone, onClick: call },
      text: { icon: MessageSquare, onClick: text },
      test_drive: { icon: Clock, onClick: () => openAction("test-drive") },
      todays_price: { icon: DollarSign, onClick: () => openAction("payment") },
      contact_dealer: { icon: MessageSquare, onClick: () => openAction("contact") },
      trade_appraisal: { icon: RefreshCw, onClick: () => openAction("trade") },
      value_trade: { icon: RefreshCw, onClick: () => openAction("trade") },
      reserve: { icon: BadgeCheck, onClick: () => openAction("reserve") },
      pre_qualified: { icon: DollarSign, onClick: () => openAction("payment") },
      apply_financing: { icon: DollarSign, onClick: () => openAction("payment") },
      check_availability: { icon: CheckCircle2, onClick: () => openAction("availability") },
      send_to_phone: { icon: Send, onClick: handleShare },
      save_vehicle: { icon: Bookmark, onClick: handleSave },
      share_vehicle: { icon: Upload, onClick: handleShare },
      directions: { icon: MapPin, onClick: () => openPanel("visit-dealer") },
      email_dealer: { icon: Send, onClick: () => openAction("contact") },
      chat: { icon: MessageSquare, onClick: () => openAction("contact") },
      schedule_service: { icon: Clock, onClick: () => openAction("contact") },
      payment_options: { icon: DollarSign, onClick: () => openAction("payment") },
      calculate_payment: { icon: DollarSign, onClick: () => openAction("payment") },
    };
    return map[k] || { icon: CheckCircle2, onClick: () => openAction("availability") };
  };

  const hasVideo = Array.isArray(listing.videos) && listing.videos.length > 0;
  const heroImg = gallery[idx] || gallery[0] || listing.hero_image_url || "";

  const swipeHero = (dir: number) => {
    if (!gallery.length) return;
    setIdx((i) => (i + dir + gallery.length) % gallery.length);
  };

  return (
    <div className={`min-h-screen ${isDesktop ? "" : "pb-28"}`} style={{ background: BG, color: NAVY }}>
      <Helmet>
        <title>{listing.ymm ? `${listing.ymm} — Vehicle Passport` : "Vehicle Passport"}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Helmet>

      {/* ── Compact header (mobile / tablet < xl) — only mounts below xl ── */}
      {!isDesktop && (
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b" style={{ borderColor: BORDER }}>
        <div className="max-w-lg mx-auto h-14 px-4 flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2">
            {dealerLogo ? (
              <img src={dealerLogo} alt={dealerName} className="h-7 max-w-[140px] object-contain" loading="eager" decoding="async" />
            ) : (
              <Logo variant="full" className="h-7" />
            )}
            {!heroInView && (
              <div className="min-w-0 pl-2 border-l" style={{ borderColor: BORDER }}>
                <div className="text-[12px] font-semibold truncate" style={{ color: NAVY }}>{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</div>
                <div className="text-[11px] tabular-nums" style={{ color: BLUE }}>{price ? fmt$(price) : ""}</div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <button onClick={handleSave} aria-label={isSaved ? "Saved" : "Save this vehicle"} aria-pressed={isSaved} className="h-11 w-11 grid place-items-center rounded-full hover:bg-slate-50" data-module="save">
              <Bookmark className="w-[21px] h-[21px]" style={{ color: isSaved ? BLUE : NAVY, fill: isSaved ? BLUE : "none" }} />
            </button>
            <button onClick={handleShare} aria-label="Share this vehicle" className="h-11 w-11 grid place-items-center rounded-full hover:bg-slate-50" data-module="share">
              <Upload className="w-[21px] h-[21px]" style={{ color: NAVY }} />
            </button>
            <button aria-label="Contact dealer" onClick={() => openAction("contact")} className="h-11 w-11 grid place-items-center rounded-full hover:bg-slate-50">
              <MoreHorizontal className="w-[21px] h-[21px]" style={{ color: NAVY }} />
            </button>
          </div>
        </div>
      </header>
      )}

      {/* ── Mobile / tablet column (< xl) — the approved mobile V3, only mounts below xl ── */}
      {!isDesktop && (() => {
        const conditionLabel = isNew ? "New" : condition === "cpo" ? "Certified Pre-Owned" : "Used";
        const trustBadges = [
          d.ownerCount === 1 ? "One Owner" : null,
          (d.dealerVerified || (d.verifiedBy && d.verifiedBy.length > 0)) ? "Dealer Verified" : null,
          d.marketAvg != null ? "Market Data Verified" : null,
        ].filter(Boolean) as string[];

        // Recall stays governed — amber "Needs confirmation" when sources conflict,
        // never a green "no open recalls", by reading the canonical report.
        const recallStatus = report.checks.find((c) => c.key === "recall")?.status;
        const recallNeedsReview = recallStatus === "needs_confirmation" || recallStatus === "needs_attention";
        const confirmRows = [
          recallNeedsReview ? {
            t: recallStatus === "needs_confirmation" ? "Recall status needs confirmation" : "Open safety recall reported",
            s: recallStatus === "needs_confirmation" ? "Sources disagree on this vehicle — confirm the recall status with the dealer before purchase." : "Ask the dealer about the recall remedy before purchase.",
          } : null,
          d.accidentCount != null && d.accidentCount > 0 ? { t: `${d.accidentCount} reported accident${d.accidentCount === 1 ? "" : "s"}`, s: "Review the full history report and reconditioning work with the dealer." } : null,
          d.titleStatus === "branded" ? { t: "Title brand reported", s: "Review the title history with the dealer before purchase." } : null,
        ].filter(Boolean) as { t: string; s: string }[];

        const strengths = ([
          (d.dealerVerified || d.verifiedBy.length > 0) ? "Dealer-verified listing" : null,
          d.ownerCount === 1 ? `One owner reported${d.historyReport ? ` (${historyReportName(d.historyReport.provider)})` : ""}` : d.ownerCount != null && d.ownerCount > 1 ? `${d.ownerCount} owners reported` : null,
          listing.mileage != null ? `${listing.mileage.toLocaleString()} reported miles` : null,
          listing.trim ? `${listing.trim} trim` : null,
          recallVerified ? "No open recalls (NHTSA)" : null,
          d.warrantyStr ? "Factory warranty terms found — remaining coverage requires confirmation" : null,
        ].filter(Boolean) as string[]);

        const timeline = ([
          /^\d{4}$/.test((listing.ymm || "").split(" ")[0]) ? { d: (listing.ymm || "").split(" ")[0], t: "Manufactured", s: "Factory production" } : null,
          d.warranty.in_service_date ? { d: new Date(d.warranty.in_service_date).toLocaleDateString(), t: "Placed in service", s: "Factory warranty begins" } : null,
          d.ownerCount != null ? { d: d.ownerCount === 0 ? "New" : d.ownerCount === 1 ? "Single owner" : `${d.ownerCount} owners`, t: d.ownerCount === 0 ? "You'd be the first owner" : "Ownership", s: d.ownerCount === 0 ? "No prior owners" : "Reported ownership on record" } : null,
          d.serviceCount > 0 ? { d: `${d.serviceCount} records`, t: "Regular service", s: "Maintenance on record" } : null,
          { d: "Today", t: "Ready for you", s: "Available at the dealership" },
        ].filter(Boolean) as { d: string; t: string; s: string }[]);

        // Warranty coverage bars — reuse the exact remaining-coverage math the V3
        // passport uses; new cars show the full forward term, used cars remaining.
        const w = d.warranty;
        const showWarranty = pv("warranty") && !!d.warrantyStr && (!d.warrantyExpired || d.dealerCoverage.length > 0);
        const wCalc = (months?: number | null, miles?: number | null) => {
          let timePct: number | null = null, monthsLeft: number | null = null;
          if (w.in_service_date && months) {
            const end = new Date(w.in_service_date); end.setMonth(end.getMonth() + months);
            const msLeft = end.getTime() - Date.now();
            monthsLeft = msLeft > 0 ? Math.round(msLeft / (1000 * 60 * 60 * 24 * 30.4)) : 0;
            timePct = Math.max(3, Math.min(100, (monthsLeft / months) * 100));
          }
          const milesLeft = miles != null && miles > 0 && listing.mileage != null ? Math.max(0, miles - listing.mileage) : null;
          const milesPct = miles != null && miles > 0 && listing.mileage != null ? Math.max(3, 100 - Math.min(100, (listing.mileage / miles) * 100)) : null;
          const vals = [timePct, milesPct].filter((x): x is number => x != null);
          const remainPct = vals.length ? Math.round(Math.min(...vals)) : null;
          const yrs = monthsLeft == null ? null : monthsLeft >= 12 ? `${Math.round(monthsLeft / 12)} yr` : `${monthsLeft} mo`;
          const milesLbl = milesLeft == null ? null : `${(milesLeft / 1000).toFixed(0)}K mi`;
          const fullTerm = [months ? `${Math.round(months / 12)} yr` : null, miles === -1 ? "Unlimited" : miles ? `${(miles / 1000).toFixed(0)}K mi` : null].filter(Boolean).join(" / ");
          const remainLbl = [yrs, milesLbl].filter(Boolean).join(" / ");
          return { pct: isNew ? 100 : remainPct, label: isNew ? (fullTerm || null) : (remainLbl ? `${remainLbl} left` : null) };
        };
        const b2b = showWarranty ? wCalc(w.factory_months, w.factory_miles) : null;
        const ptw = showWarranty && (w.powertrain_months != null || w.powertrain_miles != null) ? wCalc(w.powertrain_months, w.powertrain_miles) : null;

        const watchEnabled = (listing as unknown as { price_drop_watch?: boolean }).price_drop_watch !== false;
        const actionTiles: { label: string; icon: React.ElementType; onClick: () => void; active?: boolean }[] = [
          { label: "Value My Trade", icon: RefreshCw, onClick: () => go("trade") },
          { label: "Test Drive", icon: Clock, onClick: () => go("test-drive") },
          { label: "Contact Dealer", icon: MessageSquare, onClick: () => go("contact") },
          { label: "Documents", icon: FileText, onClick: () => go("documents") },
          { label: "Save", icon: Bookmark, onClick: handleSave, active: isSaved },
          { label: "Share", icon: Upload, onClick: handleShare },
        ];
        if (watchEnabled) actionTiles.push({ label: "Watch Price", icon: Eye, active: watchOpen, onClick: () => { if (!watchOpen) trackCustomerCtaClicked({ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: "passport", surface: "vehicle_passport", metadata: { cta: "watch_price" } }); setWatchOpen(true); } });

        const overviewText = d.overview && d.overview.length > 320 ? `${d.overview.slice(0, 320).trimEnd()}…` : d.overview;
        const H = ({ children }: { children: React.ReactNode }) => <h2 className="text-[19px] font-extrabold leading-tight" style={{ color: NAVY }}>{children}</h2>;

        return (
        <div className="max-w-lg mx-auto pb-2">

          {/* 2 — Hero gallery (heroRef drives the sticky-header reveal) */}
          <div ref={heroRef} className="px-4 pt-3" data-module="gallery">
            <div className="relative rounded-2xl overflow-hidden bg-white border" style={{ borderColor: BORDER }}>
              <div
                className="relative aspect-[4/3] w-full overflow-hidden"
                onClick={() => setGalleryOpen(true)}
                onTouchStart={(e) => { (e.currentTarget as HTMLDivElement).dataset.tsx = String(e.touches[0].clientX); }}
                onTouchEnd={(e) => {
                  const start = Number((e.currentTarget as HTMLDivElement).dataset.tsx || 0);
                  const dx = (e.changedTouches[0].clientX - start);
                  if (Math.abs(dx) > 40) { e.stopPropagation(); swipeHero(dx < 0 ? 1 : -1); }
                }}
              >
                {heroImg ? (
                  <img src={heroImg} alt={listing.ymm || "Vehicle"} className="w-full h-full object-cover" decoding="async" fetchPriority="high" />
                ) : (
                  <div className="w-full h-full grid place-items-center text-slate-400 bg-slate-100"><Package className="w-10 h-10" /></div>
                )}
                {gallery.length > 1 && (
                  <span className="absolute top-3 right-3 h-7 px-2.5 rounded-full bg-black/60 text-white text-[11px] font-semibold inline-flex items-center">{idx + 1} / {gallery.length}</span>
                )}
                {hasVideo && (
                  <span className="absolute top-3 left-3 h-7 px-2.5 rounded-full bg-white/95 text-[11px] font-bold inline-flex items-center gap-1" style={{ color: NAVY }}><Play className="w-3.5 h-3.5" /> Video</span>
                )}
                {gallery.length > 1 && <>
                  <button aria-label="Previous photo" onClick={(e) => { e.stopPropagation(); swipeHero(-1); }} className="absolute left-2.5 top-1/2 -translate-y-1/2 h-11 w-11 grid place-items-center rounded-full bg-white/90 shadow"><ChevronLeft className="w-[23px] h-[23px]" style={{ color: NAVY }} /></button>
                  <button aria-label="Next photo" onClick={(e) => { e.stopPropagation(); swipeHero(1); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 h-11 w-11 grid place-items-center rounded-full bg-white/90 shadow"><ChevronRight className="w-[23px] h-[23px]" style={{ color: NAVY }} /></button>
                </>}
                <button aria-label={isSaved ? "Saved" : "Save this vehicle"} aria-pressed={isSaved} onClick={(e) => { e.stopPropagation(); handleSave(); }} className="absolute bottom-3 right-3 h-11 w-11 grid place-items-center rounded-full bg-white/90 shadow">
                  <Bookmark className="w-[22px] h-[22px]" style={{ color: isSaved ? BLUE : NAVY, fill: isSaved ? BLUE : "none" }} />
                </button>
                <button aria-label={`View all ${gallery.length} photos`} onClick={(e) => { e.stopPropagation(); setGalleryOpen(true); }} className="absolute bottom-3 left-3 h-9 px-3 rounded-full bg-black/60 text-white text-[12px] font-bold inline-flex items-center gap-1.5"><Eye className="w-4 h-4" /> All Photos</button>
              </div>
            </div>
            {/* 3 — thumbnail strip */}
            {gallery.length > 1 && (
              <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                {gallery.slice(0, 12).map((src, i) => (
                  <button key={i} onClick={() => setIdx(i)} aria-label={`View photo ${i + 1}`} className="h-16 w-16 rounded-xl overflow-hidden shrink-0" style={{ border: `2px solid ${i === idx ? BLUE : "transparent"}` }}>
                    <img src={src} alt={`${listing.ymm || "Vehicle"} photo ${i + 1}`} loading="lazy" className={`w-full h-full object-cover ${i === idx ? "" : "opacity-70"}`} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 4 — Vehicle identity */}
          <section className="px-4 pt-5" data-module="identity">
            <div className="inline-flex items-center h-6 px-2.5 rounded-full text-[11px] font-bold uppercase tracking-wide" style={{ background: isNew ? "#EFF6FF" : condition === "cpo" ? "#ECFDF5" : "#F1F5F9", color: isNew ? BLUE : condition === "cpo" ? GREEN : NAVY }}>{conditionLabel}</div>
            <h1 className="mt-2 text-[26px] leading-tight font-extrabold" style={{ color: NAVY }}>{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</h1>
            {(listing.vin || listing.mileage != null) && (
              <p className="mt-1 text-[13px]" style={{ color: SUB }}>
                {listing.vin ? <>VIN <span className="font-mono">{listing.vin}</span></> : null}
                {listing.vin && listing.mileage != null ? " · " : null}
                {listing.mileage != null ? <span className="tabular-nums">{listing.mileage.toLocaleString()} mi</span> : null}
              </p>
            )}
            {trustBadges.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {trustBadges.map((b) => (
                  <span key={b} className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] font-semibold border" style={{ background: "#F0FDF4", color: GREEN, borderColor: "#BBF7D0" }}><CheckCircle2 className="w-3.5 h-3.5" /> {b}</span>
                ))}
              </div>
            )}
            {d.viewCount != null && d.viewCount > 0 && (
              <div className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: SUB }}><Eye className="w-4 h-4" style={{ color: BLUE }} /> {d.viewCount.toLocaleString()} recent shopper views</div>
            )}
          </section>

          {/* 5 — Today's Sale Price + itemized breakdown (new → MSRP, used/CPO → Market Value) */}
          <section className="px-4 pt-4" data-module="price">
            {saleCard
              ? <VehiclePriceBreakdown card={saleCard} />
              : <>
                  <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: SUB }}>Today's Sale Price</div>
                  <div className="mt-0.5 text-[32px] font-extrabold tabular-nums leading-none" style={{ color: NAVY }}>{price != null ? fmt$(price) : "—"}</div>
                </>}

            {/* 6 — Payment module: ONLY when d.estMonthly is present. This is the same
                dealer setting (passport_payment_display.payment → getPaymentDisplay)
                that gates the desktop estimate; when off, estMonthly is null and this
                renders nothing (no empty card, no gap). Never an offer or approval. */}
            {payMonthly != null && (
              <div className={`${CARD} mt-3 px-4 py-3.5`} data-module="payment">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: SUB }}>
                    {customPayment ? "Your estimate" : "Estimated payment (Example)"}
                    {customPayment && <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9.5px] font-bold" style={{ background: "#EFF6FF", color: BLUE }}>EDITED</span>}
                  </span>
                  <button onClick={() => openAction("payment")} aria-label="How this payment is estimated" className="h-8 w-8 -mr-1.5 grid place-items-center rounded-full hover:bg-slate-50"><Info className="w-[18px] h-[18px]" style={{ color: SUB }} /></button>
                </div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-[30px] font-extrabold tabular-nums leading-none" style={{ color: NAVY }}>{fmt$(payMonthly)}</span>
                  <span className="text-[15px] font-bold" style={{ color: SUB }}>/mo</span>
                </div>
                {payAssumptions && <div className="mt-1 text-[12px]" style={{ color: SUB }}>{payAssumptions}</div>}
                <div className="mt-2.5 flex items-center gap-4">
                  <button onClick={() => go("todays-price")} className="inline-flex items-center gap-1 text-[13px] font-bold" style={{ color: BLUE }}>Customize Payment <ChevronRight className="w-4 h-4" /></button>
                  {customPayment && <button onClick={resetPayment} className="text-[13px] font-semibold" style={{ color: SUB }}>Reset to default</button>}
                </div>
                <p className="mt-2.5 pt-2.5 border-t text-[11px] leading-snug" style={{ borderColor: BORDER, color: SUB }}>Estimated payment for illustration only. Terms, rates, taxes, fees and approval may vary. This is not a financing offer.</p>
              </div>
            )}
          </section>

          {/* 7 — Primary + secondary actions (open the complete V2 destination pages) */}
          <section className="px-4 pt-4" data-module="primary-actions">
            <button onClick={() => go("todays-price")} className="w-full h-14 rounded-2xl inline-flex items-center justify-center gap-2 text-[15px] font-bold text-white" style={{ background: BLUE }}><DollarSign className="w-[22px] h-[22px]" /> See My Price</button>
            <button onClick={() => go("reserve")} className="mt-2.5 w-full h-14 rounded-2xl border inline-flex items-center justify-center gap-2 text-[15px] font-bold" style={{ borderColor: BLUE, color: BLUE }}><BadgeCheck className="w-[22px] h-[22px]" /> Reserve This Vehicle</button>
          </section>

          {/* 8 — Supporting action tiles */}
          <section className="px-4 pt-3" data-module="action-tiles">
            <div className="grid grid-cols-4 gap-2.5">
              {actionTiles.map((t) => (
                <button key={t.label} onClick={t.onClick} aria-pressed={t.active} className={`${CARD} h-[74px] flex flex-col items-center justify-center gap-1.5`}>
                  <t.icon className="w-[24px] h-[24px]" style={{ color: BLUE, fill: t.label === "Save" && t.active ? BLUE : "none" }} />
                  <span className="text-[10.5px] font-bold leading-none text-center px-0.5" style={{ color: t.active ? BLUE : NAVY }}>{t.label}</span>
                </button>
              ))}
            </div>
            {watchOpen && watchEnabled && (
              <div className="mt-3" data-module="watch-price"><PriceDropWatch slug={listing.slug || rawSlug} /></div>
            )}
          </section>

          {/* 9 — AutoLabels Verified (Option B: Balanced Status Dashboard) */}
          {vShow && (
            <section className="px-4 pt-6" data-module="verification">
              <AutoLabelsVerifiedCard report={report} onOpenReport={() => go("verification")} onReview={() => go("verification")} />
            </section>
          )}

          {/* 10 — Market Intelligence */}
          {pv("marketValue") && marketPos && (
            <section className="px-4 pt-6" data-module="market">
              <H>Market Intelligence</H>
              <div className={`${CARD} mt-3 p-4`}>
                <div className="grid grid-cols-3 gap-3">
                  <div><div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: SUB }}>Analyzed</div><div className="mt-1 text-[20px] font-extrabold tabular-nums" style={{ color: NAVY }}>{d.marketMeta.similarCount ?? "—"}</div><div className="text-[11px]" style={{ color: SUB }}>{d.marketMeta.radius ? `within ${d.marketMeta.radius} mi` : "nearby"}</div></div>
                  <div><div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: SUB }}>vs market</div><div className="mt-1 text-[20px] font-extrabold tabular-nums" style={{ color: d.belowMarket && d.belowMarket > 0 ? GREEN : NAVY }}>{d.belowMarket && d.belowMarket > 0 ? fmt$(d.belowMarket) : d.marketAvg != null && price != null && price - d.marketAvg > 250 ? fmt$(price - d.marketAvg) : "—"}</div><div className="text-[11px]" style={{ color: SUB }}>{d.belowMarket && d.belowMarket > 0 ? "below value" : "vs value"}</div></div>
                  <div><div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: SUB }}>Days listed</div><div className="mt-1 text-[20px] font-extrabold tabular-nums" style={{ color: NAVY }}>{d.dom != null ? d.dom : d.marketMeta.avgDom != null ? d.marketMeta.avgDom : "—"}</div><div className="text-[11px]" style={{ color: SUB }}>{d.dom != null ? "this car" : "market avg"}</div></div>
                </div>
                <div className="mt-4">
                  <div className="relative h-2.5 rounded-full" style={{ background: "linear-gradient(90deg, #DCFCE7 0%, #DBEAFE 50%, #FEE2E2 100%)" }}>
                    <span className="absolute -top-1 w-4 h-4 rounded-full border-2 border-white shadow" style={{ left: `calc(${Math.round(marketPos.t * 100)}% - 8px)`, background: NAVY }} />
                  </div>
                  <div className="mt-2 flex justify-between text-[11px]" style={{ color: SUB }}><span>Best Value</span><span className="font-bold" style={{ color: NAVY }}>{marketPos.label}</span><span>Above Market</span></div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <button onClick={() => openPanel("market-price")} className="text-[13px] font-bold inline-flex items-center gap-1" style={{ color: BLUE }}>View market details <ChevronRight className="w-4 h-4" /></button>
                  <button onClick={() => openPanel("comparable-vehicles")} className="text-[12px] font-semibold" style={{ color: SUB }}>Comparable vehicles</button>
                </div>
              </div>
            </section>
          )}

          {/* 11 — Why This Vehicle Checks Out */}
          <section className="px-4 pt-6" data-module="great-buy">
            <H>Why This Vehicle Checks Out</H>
            <div className={`${CARD} mt-3 p-4`}>
              <ul className="space-y-2.5">
                {(strengths.length ? strengths : ["Details confirmed at the dealership"]).map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px]" style={{ color: NAVY }}><CheckCircle2 className="w-[18px] h-[18px] shrink-0 mt-0.5" style={{ color: GREEN }} /> {b}</li>
                ))}
              </ul>
              <button onClick={() => go("great-buy")} className="mt-3 text-[13px] font-bold inline-flex items-center gap-1" style={{ color: BLUE }}>View full buying report <ChevronRight className="w-4 h-4" /></button>
            </div>
          </section>

          {/* 12 — Confirm Before Purchase (recall stays neutral amber; never green) */}
          {(confirmRows.length > 0 || (d.historyReport && pv("historyReport"))) && (
            <section className="px-4 pt-6" data-module="confirm">
              <H>Confirm Before Purchase</H>
              <div className={`${CARD} mt-3 p-4`}>
                {confirmRows.length > 0 && (
                  <div className="space-y-2.5">
                    {confirmRows.map((r) => (
                      <div key={r.t} className="rounded-xl border p-3 flex items-start gap-2" style={{ borderColor: "#FDE68A", background: "#FFFBEB" }}>
                        <TriangleAlert className="w-[18px] h-[18px] shrink-0 mt-0.5" style={{ color: AMBER }} />
                        <div className="min-w-0"><p className="text-[12.5px] font-semibold leading-tight" style={{ color: NAVY }}>{r.t}</p><p className="text-[11px] mt-0.5" style={{ color: SUB }}>{r.s}</p></div>
                      </div>
                    ))}
                  </div>
                )}
                {d.historyReport && pv("historyReport") && (
                  <div className={confirmRows.length > 0 ? "mt-3 pt-3 border-t" : ""} style={confirmRows.length > 0 ? { borderColor: BORDER } : undefined}>
                    <a href={d.historyReport.url} target="_blank" rel="noopener noreferrer" onClick={() => trackCustomerCtaClicked({ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: "passport", surface: "vehicle_passport", metadata: { cta: "history_report" } })} className="text-[13px] font-bold inline-flex items-center gap-1.5" style={{ color: BLUE }}>
                      {d.historyReport.source === "vin" ? `View the ${historyReportName(d.historyReport.provider)} record` : `View the free ${historyReportName(d.historyReport.provider)} Report`} <ExternalLink className="w-4 h-4" />
                    </a>
                    {d.historyReport.source !== "vin" && dealerName && <p className="text-[11px] mt-0.5" style={{ color: SUB }}>Provided at no cost by {dealerName}</p>}
                  </div>
                )}
                <button onClick={() => go("verification")} className="mt-3 text-[13px] font-bold inline-flex items-center gap-1" style={{ color: BLUE }}>View full verification report <ChevronRight className="w-4 h-4" /></button>
              </div>
            </section>
          )}

          {/* 13 — Ownership Timeline */}
          {(pv("historyReport") || pv("insights")) && timeline.length > 1 && (
            <section className="px-4 pt-6" data-module="history">
              <H>Ownership Timeline</H>
              <div className={`${CARD} mt-3 p-4`}>
                <ol className="space-y-4 relative border-l-2 ml-1.5 pl-4" style={{ borderColor: "#E2E8F0" }}>
                  {timeline.map((e, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[22px] top-1 w-3 h-3 rounded-full ring-2 ring-white" style={{ background: i === timeline.length - 1 ? BLUE : GREEN }} />
                      <p className="text-[12.5px] font-bold" style={{ color: NAVY }}>{e.d} · {e.t}</p>
                      <p className="text-[11px]" style={{ color: SUB }}>{e.s}</p>
                    </li>
                  ))}
                </ol>
                <button onClick={() => openPanel("ownership-timeline")} className="mt-3 text-[13px] font-bold inline-flex items-center gap-1" style={{ color: BLUE }}>View full timeline <ChevronRight className="w-4 h-4" /></button>
              </div>
            </section>
          )}

          {/* 14 — Factory Warranty */}
          {showWarranty && (
            <section className="px-4 pt-6" data-module="warranty">
              <H>{!d.warrantyExpired ? "Factory Warranty" : "Warranty Coverage"}</H>
              <div className={`${CARD} mt-3 p-4`}>
                {!d.warrantyExpired ? (
                  <div className="space-y-3.5">
                    {b2b && b2b.pct != null && (
                      <div>
                        <div className="flex items-center gap-1.5"><ShieldCheck className="w-[18px] h-[18px]" style={{ color: BLUE }} /><span className="text-[13px] font-semibold" style={{ color: NAVY }}>Bumper-to-Bumper</span></div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[15px] font-extrabold tabular-nums w-10" style={{ color: BLUE }}>{b2b.pct}%</span>
                          <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "#F1F5F9" }}><div className="h-full rounded-full" style={{ width: `${b2b.pct}%`, background: BLUE }} /></div>
                        </div>
                        {b2b.label && <p className="text-[11px] mt-1" style={{ color: SUB }}>{b2b.label}</p>}
                      </div>
                    )}
                    {ptw && ptw.pct != null && (
                      <div>
                        <div className="flex items-center gap-1.5"><ShieldCheck className="w-[18px] h-[18px]" style={{ color: GREEN }} /><span className="text-[13px] font-semibold" style={{ color: NAVY }}>Powertrain</span></div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[15px] font-extrabold tabular-nums w-10" style={{ color: GREEN }}>{ptw.pct}%</span>
                          <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "#F1F5F9" }}><div className="h-full rounded-full" style={{ width: `${ptw.pct}%`, background: GREEN }} /></div>
                        </div>
                        {ptw.label && <p className="text-[11px] mt-1" style={{ color: SUB }}>{ptw.label}</p>}
                      </div>
                    )}
                    {!b2b?.pct && !ptw?.pct && <p className="text-[13px]" style={{ color: SUB }}>{d.warrantyStr}</p>}
                  </div>
                ) : (
                  <p className="text-[13px]" style={{ color: SUB }}>{d.warrantyStr || "Factory coverage on record."}</p>
                )}
                <button onClick={() => openPanel("factory-warranty")} className="mt-3 text-[13px] font-bold inline-flex items-center gap-1" style={{ color: BLUE }}>View warranty coverage <ChevronRight className="w-4 h-4" /></button>
              </div>
            </section>
          )}

          {/* 15 — About This Vehicle: highlights + features + specs */}
          <section className="px-4 pt-6" data-module="about">
            <H>About This Vehicle</H>
            {d.highlights.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                {d.highlights.slice(0, 6).map((h) => (
                  <div key={h.key} className={`${CARD} p-3`}>
                    <div className="text-[13px] font-bold leading-tight" style={{ color: NAVY }}>{h.label}</div>
                    {h.sub && <div className="text-[11px] mt-0.5 leading-snug" style={{ color: SUB }}>{h.sub}</div>}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 space-y-3">
              <button onClick={() => openPanel("equipment")} className={`${CARD} w-full flex items-center justify-between gap-3 px-4 py-3.5`} data-module="equipment">
                <div className="min-w-0 flex items-center gap-3">
                  <span className="h-10 w-10 grid place-items-center rounded-xl" style={{ background: "#F1F5F9" }}><Star className="w-[22px] h-[22px]" style={{ color: NAVY }} /></span>
                  <div className="min-w-0 text-left"><div className="text-[13px] font-bold" style={{ color: NAVY }}>All features &amp; equipment</div><div className="text-[12px]" style={{ color: SUB }}>Premium, safety, tech &amp; more</div></div>
                </div>
                <ChevronRight className="w-[18px] h-[18px] shrink-0" style={{ color: SUB }} />
              </button>
              <button onClick={() => openPanel("key-specs")} className={`${CARD} w-full flex items-center justify-between gap-3 px-4 py-3.5`} data-module="specs">
                <div className="min-w-0 flex items-center gap-3">
                  <span className="h-10 w-10 grid place-items-center rounded-xl" style={{ background: "#EFF6FF" }}><Wrench className="w-[22px] h-[22px]" style={{ color: BLUE }} /></span>
                  <div className="min-w-0 text-left"><div className="text-[13px] font-bold" style={{ color: NAVY }}>Full specifications</div><div className="text-[12px]" style={{ color: SUB }}>Engine, dimensions, capacity</div></div>
                </div>
                <ChevronRight className="w-[18px] h-[18px] shrink-0" style={{ color: SUB }} />
              </button>
            </div>
          </section>

          {/* 16 — Vehicle Overview */}
          {overviewText && (
            <section className="px-4 pt-6" data-module="overview">
              <H>Vehicle Overview</H>
              <div className={`${CARD} mt-3 p-4`}>
                <p className="text-[13px] leading-relaxed" style={{ color: NAVY }}>{overviewText}</p>
                <button onClick={() => openPanel("overview")} className="mt-3 text-[13px] font-bold inline-flex items-center gap-1" style={{ color: BLUE }}>Read full overview <ChevronRight className="w-4 h-4" /></button>
              </div>
            </section>
          )}

          {/* 17 — Vehicle photo story */}
          {gallery.length > 1 && (
            <section className="px-4 pt-6" data-module="photo-story">
              <H>Photos</H>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {gallery.slice(0, 6).map((src, i) => (
                  <button key={i} onClick={() => { setIdx(i); setGalleryOpen(true); }} aria-label={`View photo ${i + 1}`} className="aspect-square rounded-xl overflow-hidden bg-slate-100">
                    <img src={src} alt={`${listing.ymm || "Vehicle"} photo ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
              <button onClick={() => setGalleryOpen(true)} className="mt-3 text-[13px] font-bold inline-flex items-center gap-1" style={{ color: BLUE }}>View all {gallery.length} photos <ChevronRight className="w-4 h-4" /></button>
            </section>
          )}

          {/* 18 — Why Buy From {dealer} */}
          {dealerName && (
            <section className="px-4 pt-6" data-module="dealer">
              <H>Why Buy From {dealerName}</H>
              <p className="mt-0.5 text-[13px]" style={{ color: SUB }}>What makes buying here different.</p>
              <div className={`${CARD} mt-3 overflow-hidden`}>
                {dt.storefrontUrl ? (
                  <div className="relative aspect-[2/1] w-full bg-slate-100">
                    <img src={dt.storefrontUrl} alt={dealerName} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                    <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(13,27,42,0.85) 0%, rgba(13,27,42,0.15) 45%, transparent 70%)" }} />
                    {dealerFoundedYear != null && (
                      <div className="absolute bottom-3 left-4 text-white">
                        <div className="text-[16px] font-extrabold leading-tight">Serving drivers since {dealerFoundedYear}</div>
                        {dealerYears != null && <div className="text-[12px] opacity-90">{dealerYears} years in business</div>}
                      </div>
                    )}
                  </div>
                ) : dealerFoundedYear != null ? (
                  <div className="px-4 pt-4">
                    <div className="text-[15px] font-extrabold leading-tight" style={{ color: NAVY }}>Serving drivers since {dealerFoundedYear}</div>
                    {dealerYears != null && <div className="text-[12px]" style={{ color: SUB }}>{dealerYears} years in business</div>}
                  </div>
                ) : null}
                {dealerBenefits.length > 0 && (
                  <div className="px-4 pt-4 grid grid-cols-2 gap-x-4 gap-y-2.5">
                    {dealerBenefits.map((b) => (
                      <div key={b} className="flex items-start gap-2 text-[13px] font-medium" style={{ color: NAVY }}>
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: GREEN }} /> {b}
                      </div>
                    ))}
                  </div>
                )}
                {(d.reviewRating != null || dt.certifications.length > 0) && (
                  <div className="px-4 pt-4 mt-4 border-t" style={{ borderColor: BORDER }}>
                    {d.reviewRating != null && (
                      <div className="pt-3 flex items-center gap-2">
                        <div className="inline-flex items-center gap-1">
                          {[0, 1, 2, 3, 4].map((s) => <Star key={s} className="w-4 h-4" style={{ color: AMBER, fill: s < Math.round(d.reviewRating as number) ? AMBER : "none" }} />)}
                        </div>
                        <span className="text-[13px] font-bold" style={{ color: NAVY }}>{(d.reviewRating as number).toFixed(1)}</span>
                        {d.reviewCount != null && <span className="text-[12px]" style={{ color: SUB }}>({d.reviewCount.toLocaleString()} reviews)</span>}
                      </div>
                    )}
                    {dt.certifications.length > 0 && (
                      <div className="mt-3 space-y-2.5 pb-1">
                        {dt.certifications.slice(0, 4).map((c) => (
                          <div key={c} className="flex items-start gap-2.5">
                            <span className="h-7 w-7 grid place-items-center rounded-full shrink-0" style={{ background: "#EFF6FF" }}><Award className="w-4 h-4" style={{ color: BLUE }} /></span>
                            <div className="min-w-0">
                              <div className="text-[13px] font-semibold leading-tight" style={{ color: NAVY }}>{c}</div>
                              <div className="text-[11px]" style={{ color: SUB }}>Dealer-reported recognition</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <button onClick={() => { trackCustomerCtaClicked({ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: "passport", surface: "vehicle_passport", metadata: { cta: "dealer_profile" } }); go("dealer"); }} className="px-4 py-3.5 inline-flex items-center gap-1.5 text-[13px] font-bold" style={{ color: BLUE }}>
                  Learn more about {dealerName} <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </section>
          )}

          {/* 19 — Next Steps */}
          <section className="px-4 pt-6" data-module="next-steps">
            <H>Next Steps</H>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <button onClick={() => go("reserve")} className="h-12 rounded-2xl inline-flex items-center justify-center gap-2 text-[13px] font-bold text-white" style={{ background: BLUE }}><BadgeCheck className="w-[20px] h-[20px]" /> Reserve</button>
              <button onClick={() => go("test-drive")} className={`${CARD} h-12 inline-flex items-center justify-center gap-2 text-[13px] font-bold`} style={{ color: NAVY }}><Clock className="w-[20px] h-[20px]" style={{ color: BLUE }} /> Schedule Test Drive</button>
              <button onClick={() => go("contact")} className={`${CARD} h-12 inline-flex items-center justify-center gap-2 text-[13px] font-bold`} style={{ color: NAVY }}><MessageSquare className="w-[20px] h-[20px]" style={{ color: BLUE }} /> Contact Dealer</button>
              <button onClick={() => window.print()} className={`${CARD} h-12 inline-flex items-center justify-center gap-2 text-[13px] font-bold`} style={{ color: NAVY }}><Printer className="w-[20px] h-[20px]" style={{ color: BLUE }} /> Print Passport</button>
            </div>
          </section>

          {/* 20 — Footer */}
          <footer className="px-4 pt-8 pb-4 text-center">
            {d.dealerPhone && (
              <a href={`tel:${d.dealerPhone}`} className="inline-flex items-center gap-1.5 text-[13px] font-bold" style={{ color: BLUE }}><Phone className="w-4 h-4" /> Need help? Call {d.dealerPhone}</a>
            )}
            <div className="mt-3 flex items-center justify-center gap-4 text-[12px] font-semibold" style={{ color: SUB }}>
              <a href="/privacy" className="hover:underline">Privacy</a>
              <span style={{ color: "#CBD5E1" }}>·</span>
              <a href="/terms" className="hover:underline">Terms</a>
            </div>
            {dealerName && <p className="mt-3 text-[11px]" style={{ color: SUB }}>Vehicle offered by {dealerName}. Confirm current availability, price and details with the dealership.</p>}
          </footer>

        </div>
        );
      })()}

      {/* ══ Intelligence-first desktop (≥ xl / 1280px) ═══════════════════════
          Two-column outer shell: a wide intelligence WORKSPACE + a sticky
          customer ACTION CENTER. Gallery + identity split only the top hero.
          Verification and market span the workspace. Detail modules open the
          SAME V3 drawers (openPanel) the mobile passport uses — no V2 routes.
          Reuses the identical governed data (d / listing) — no second fetch,
          no separate desktop data model. Hidden below xl so mobile V3 is
          byte-for-byte unchanged. */}
      {isDesktop && (() => {
        // CPO: without a per-VIN manufacturer-enrollment signal we label the
        // neutral "Certified Pre-Owned", never a manufacturer-branded claim.
        const conditionLabel = isNew ? "New" : condition === "cpo" ? "Certified Pre-Owned" : "Used";
        // Warranty: mileage alone can't prove remaining coverage — that needs the
        // in-service date. State the terms as "found" and require confirmation.
        const hasInService = !!(d.warranty && (d.warranty as { in_service_date?: string }).in_service_date);
        const warrantyHead = d.warrantyStr ? "Factory warranty terms found" : "Confirm warranty with dealer";
        const warrantySub = hasInService ? (d.warrantyStr || "Coverage on record") : "Remaining eligibility requires confirmation of the in-service date";

        // ── Hero trust badges — each shown only when its governed signal is real.
        const trustBadges = [
          d.ownerCount === 1 ? "One Owner" : null,
          (d.dealerVerified || (d.verifiedBy && d.verifiedBy.length > 0)) ? "Dealer Verified" : null,
          d.marketAvg != null ? "Market Data Verified" : null,
        ].filter(Boolean) as string[];

        // ── Fixed conversion action hierarchy (goal-locked). Each opens the
        // existing, complete V2 destination page via go() — never a drawer — and
        // carries returnTo so its "Back to Vehicle Passport" returns here.
        const actPrimary = { label: "See My Price", onClick: () => go("todays-price") };
        const actReserve = { label: "Reserve This Vehicle", onClick: () => go("reserve") };
        const actGrid1 = [
          { label: "Value My Trade", icon: RefreshCw, onClick: () => go("trade") },
          { label: "Test Drive", icon: Clock, onClick: () => go("test-drive") },
        ];
        const actGrid2 = [
          { label: "Contact Dealer", icon: MessageSquare, onClick: () => go("contact") },
          { label: "Documents", icon: FileText, onClick: () => go("documents") },
        ];
        const actUtility = [
          { label: "Save", icon: Bookmark, onClick: handleSave },
          { label: "Share", icon: Upload, onClick: handleShare },
          // Watch Price opens an inline email capture so the shopper gets price &
          // availability alerts — it does not just save to this device. Track the
          // open once (not the close), never a conversion until the RPC succeeds.
          { label: "Watch Price", icon: Eye, onClick: () => { if (!watchOpen) trackCustomerCtaClicked({ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: "passport", surface: "vehicle_passport", metadata: { cta: "watch_price" } }); setWatchOpen((v) => !v); } },
        ];
        const label3 = "text-[11px] font-semibold uppercase tracking-wider";
        // Dollar amount the price sits ABOVE normalized market value (past a $250
        // rounding tolerance), used by the Market Comparison module. Null when at
        // or below market.
        const aboveMarket = price != null && d.marketAvg != null && price - d.marketAvg > 250 ? price - d.marketAvg : null;
        // ── Phase E view models (governed, presentation-only) ──
        const mc = resolveMarketComparison({
          valueHistory: d.valueHistory, advertisedPrice: price, normalizedMarketValue: d.marketAvg,
          sampleSize: d.marketMeta.similarCount, radiusMiles: d.marketMeta.radius, checkedAt: d.marketCheckedAt,
        });
        const subjectYear = Number((listing.ymm || "").match(/\b(19|20)\d{2}\b/)?.[0]) || null;
        const sims = normalizeComparables(
          { vin: listing.vin, year: subjectYear, trim: listing.trim ?? null, advertisedPrice: price },
          d.comparables,
        );
        const fuel = resolveFuelEconomy(d.epa);
        return (
          <div style={{ background: BG }}>
            {/* Desktop header */}
            <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b" style={{ borderColor: BORDER }}>
              <div className="max-w-[1520px] mx-auto h-16 px-6 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  {dealerLogo ? <img src={dealerLogo} alt={dealerName} className="h-8 max-w-[150px] object-contain" /> : <Logo variant="full" className="h-7" />}
                  {dealerName && <div className="pl-4 border-l min-w-0" style={{ borderColor: BORDER }}><div className="text-[13px] font-bold truncate" style={{ color: NAVY }}>{dealerName}</div>{d.dealerAddress && <div className="text-[11px] truncate" style={{ color: SUB }}>{d.dealerAddress}</div>}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={handleSave} className="h-9 px-3 rounded-lg border inline-flex items-center gap-1.5 text-[13px] font-bold hover:bg-slate-50" style={{ borderColor: BORDER, color: isSaved ? BLUE : NAVY }}><Bookmark className="w-4 h-4" style={{ fill: isSaved ? BLUE : "none" }} /> Save</button>
                  <button onClick={handleShare} className="h-9 px-3 rounded-lg inline-flex items-center gap-1.5 text-[13px] font-bold text-white" style={{ background: BLUE }}><Upload className="w-4 h-4" /> Share</button>
                </div>
              </div>
            </header>

            <div className="max-w-[1520px] mx-auto px-6 py-6 grid grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
              {/* ── MAIN INTELLIGENCE WORKSPACE ── */}
              <main className="min-w-0 space-y-5">
                {/* Hero: gallery | identity */}
                <section className={`${CARD} p-5 grid grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)] gap-5`} aria-label="Vehicle overview">
                  <div className="min-w-0">
                    <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-slate-100 group cursor-pointer" onClick={() => setGalleryOpen(true)}>
                      {heroImg ? <img src={heroImg} alt={listing.ymm || "Vehicle"} className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center text-slate-400"><Package className="w-10 h-10" /></div>}
                      {gallery.length > 1 && <span className="absolute top-3 right-3 h-7 px-2.5 rounded-full bg-black/60 text-white text-[11px] font-semibold inline-flex items-center">{idx + 1} / {gallery.length}</span>}
                      {gallery.length > 1 && <>
                        <button aria-label="Previous photo" onClick={(e) => { e.stopPropagation(); swipeHero(-1); }} className="absolute left-2 top-1/2 -translate-y-1/2 h-9 w-9 grid place-items-center rounded-full bg-white/90 shadow opacity-0 group-hover:opacity-100 transition"><ChevronLeft className="w-5 h-5" style={{ color: NAVY }} /></button>
                        <button aria-label="Next photo" onClick={(e) => { e.stopPropagation(); swipeHero(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 grid place-items-center rounded-full bg-white/90 shadow opacity-0 group-hover:opacity-100 transition"><ChevronRight className="w-5 h-5" style={{ color: NAVY }} /></button>
                      </>}
                    </div>
                    {gallery.length > 1 && (
                      <div className="mt-2.5 flex gap-2">
                        {gallery.slice(0, 6).map((src, i) => (
                          <button key={i} onClick={() => setIdx(i)} className={`h-14 w-16 rounded-lg overflow-hidden border-2 shrink-0 ${i === idx ? "" : "opacity-70"}`} style={{ borderColor: i === idx ? BLUE : "transparent" }}>
                            <img src={src} alt={`${listing.ymm || "Vehicle"} photo ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
                          </button>
                        ))}
                        {gallery.length > 6 && <button onClick={() => setGalleryOpen(true)} className="h-14 w-16 rounded-lg grid place-items-center text-[12px] font-bold shrink-0" style={{ background: "#EEF2F7", color: NAVY }}>+{gallery.length - 6}</button>}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="inline-flex items-center h-6 px-2.5 rounded-full text-[11px] font-bold uppercase tracking-wide" style={{ background: isNew ? "#EFF6FF" : "#F1F5F9", color: isNew ? BLUE : NAVY }}>{conditionLabel}</div>
                    <h1 className="mt-2 text-[26px] leading-tight font-extrabold" style={{ color: NAVY }}>{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</h1>
                    {/* VIN + mileage on one secondary line — the price lives ONLY in the
                        action center, never here. */}
                    {(listing.vin || listing.mileage != null) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]" style={{ color: SUB }}>
                        {listing.vin && <span className="font-mono">VIN {listing.vin}</span>}
                        {listing.vin && listing.mileage != null && <span className="w-1 h-1 rounded-full" style={{ background: "#CBD5E1" }} />}
                        {listing.mileage != null && <span className="tabular-nums">{listing.mileage.toLocaleString()} mi</span>}
                      </div>
                    )}

                    {/* Vehicle trust badges — each shown only when its governed signal is real. */}
                    {trustBadges.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {trustBadges.map((b) => (
                          <span key={b} className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] font-semibold border" style={{ background: "#F0FDF4", color: GREEN, borderColor: "#BBF7D0" }}>
                            <CheckCircle2 className="w-3.5 h-3.5" /> {b}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* AutoLabels Verified (Option B: Balanced Status Dashboard) */}
                    {vShow && (
                      <AutoLabelsVerifiedCard className="mt-4" report={report} onOpenReport={() => go("verification")} onReview={() => go("verification")} />
                    )}
                  </div>
                </section>

                {/* Verified Vehicle Data — spans the workspace; pending stays visible. */}
                <section className={`${CARD} p-5`} data-module="verification" aria-label="Verified vehicle data">
                  <div className="flex items-center justify-between gap-3">
                    <div className="inline-flex items-center gap-2">
                      <span className="h-8 w-8 grid place-items-center rounded-full" style={{ background: vAllVerified ? "#DCFCE7" : "#FEF3C7" }}><CheckCircle2 className="w-4 h-4" style={{ color: vAllVerified ? GREEN : AMBER }} /></span>
                      <div><div className="text-[14px] font-extrabold" style={{ color: NAVY }}>Verified Vehicle Data</div><div className="text-[12px]" style={{ color: SUB }}>{vAllVerified ? `All ${vTotal} checks verified` : `${vVerified} of ${vTotal} checks verified · ${vSummary}`}</div></div>
                    </div>
                    <button onClick={() => go("verification")} className="text-[13px] font-bold inline-flex items-center gap-1 hover:underline" style={{ color: BLUE }}>View all categories <ChevronRight className="w-4 h-4" /></button>
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-2.5">
                    {vChecksUi.map((c) => (
                      <div key={c.key} className="rounded-xl border px-3 py-2.5 flex items-center gap-2" style={{ borderColor: BORDER, background: c.bg }}>
                        <c.Icon className="w-4 h-4 shrink-0" style={{ color: c.color }} />
                        <div className="min-w-0"><div className="text-[12px] font-semibold leading-tight truncate" style={{ color: NAVY }}>{c.name}</div><div className="text-[10px]" style={{ color: c.color }}>{c.statusLabel}</div></div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px]" style={{ color: SUB }}>AutoLabels Data-Verified Report — records aggregated across data sources. A pending check is never shown as verified.</p>
                </section>

                {/* Market Intelligence — one unified full-width module. */}
                <section className={`${CARD} p-5`} data-module="market" aria-label="Market intelligence">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[14px] font-extrabold" style={{ color: NAVY }}>Market Intelligence</div>
                    <button onClick={() => openPanel("comparable-vehicles")} className="text-[13px] font-bold inline-flex items-center gap-1 hover:underline" style={{ color: BLUE }}>Comparable vehicles <ChevronRight className="w-4 h-4" /></button>
                  </div>
                  {marketPos ? (
                    <div className="mt-4 grid grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] gap-5 items-center">
                      <div>
                        <div className={label3} style={{ color: SUB }}>Price position</div>
                        <div className="mt-2 relative h-2.5 rounded-full" style={{ background: "linear-gradient(90deg,#16A34A,#F59E0B,#EF4444)" }}>
                          <span className="absolute -top-1 h-4.5 w-1.5 rounded-full ring-2 ring-white" style={{ left: `calc(${Math.round(marketPos.t * 100)}% - 3px)`, height: 18, background: NAVY }} />
                        </div>
                        <div className="mt-1.5 flex justify-between text-[10px]" style={{ color: SUB }}><span>Best value</span><span className="font-bold" style={{ color: NAVY }}>{marketPos.label}</span><span>Above market</span></div>
                      </div>
                      <div><div className={label3} style={{ color: SUB }}>Listings analyzed</div><div className="mt-1 text-[22px] font-extrabold tabular-nums" style={{ color: NAVY }}>{d.marketMeta.similarCount ?? "—"}</div><div className="text-[11px]" style={{ color: SUB }}>{d.marketMeta.radius ? `within ${d.marketMeta.radius} mi` : "in the region"}</div></div>
                      <div><div className={label3} style={{ color: SUB }}>vs market</div><div className="mt-1 text-[22px] font-extrabold tabular-nums" style={{ color: d.belowMarket && d.belowMarket > 0 ? GREEN : aboveMarket != null ? AMBER : NAVY }}>{d.belowMarket && d.belowMarket > 0 ? fmt$(d.belowMarket) : aboveMarket != null ? fmt$(aboveMarket) : "—"}</div><div className="text-[11px]" style={{ color: SUB }}>{d.belowMarket && d.belowMarket > 0 ? "below normalized value" : aboveMarket != null ? "above normalized value" : "vs normalized value"}</div></div>
                      <div><div className={label3} style={{ color: SUB }}>Normalized market value</div><div className="mt-1 text-[22px] font-extrabold tabular-nums" style={{ color: NAVY }}>{d.marketAvg != null ? fmt$(d.marketAvg) : "—"}</div><div className="text-[11px]" style={{ color: SUB }}>{d.marketCheckedAt ? "VIN-level predicted value" : "—"}</div></div>
                    </div>
                  ) : (
                    <p className="mt-3 text-[13px]" style={{ color: SUB }}>Market comparison temporarily unavailable. Vehicle information and dealer pricing remain available.</p>
                  )}
                </section>

                {/* Progressive detail row — each opens a V3 drawer (not a V2 page). */}
                <section className="grid grid-cols-4 gap-4" aria-label="Vehicle details">
                  {[
                    { key: "factory-warranty" as const, icon: ShieldCheck, title: "Warranty", head: d.warrantyExpired ? "Coverage ended" : warrantyHead, sub: warrantySub },
                    { key: "equipment" as const, icon: Sparkles, title: "Features & Equipment", head: "Equipment analyzed", sub: "Premium, safety, tech & more" },
                    { key: "ownership-timeline" as const, icon: FileText, title: "History & Ownership", head: d.cleanTitle ? "Clean title on record" : "History checked", sub: d.ownerCount != null ? `${d.ownerCount === 1 ? "One owner" : `${d.ownerCount} owners`} on record` : "View reported results" },
                    { key: "key-specs" as const, icon: Wrench, title: "Specifications", head: "Detailed specs", sub: "Engine, dimensions, capacity" },
                  ].map((m) => (
                    <button key={m.key} onClick={() => openPanel(m.key)} className={`${CARD} p-4 text-left hover:border-[#2563EB] transition-colors`} data-module={m.key === "factory-warranty" ? "warranty" : m.key === "equipment" ? "equipment" : m.key === "ownership-timeline" ? "history" : "specs"}>
                      <div className="flex items-center justify-between"><m.icon className="w-5 h-5" style={{ color: BLUE }} /><ChevronRight className="w-4 h-4" style={{ color: "#CBD5E1" }} /></div>
                      <div className="mt-2 text-[13px] font-bold" style={{ color: NAVY }}>{m.title}</div>
                      <div className="text-[12px] font-semibold mt-0.5" style={{ color: NAVY }}>{m.head}</div>
                      <div className="text-[11px] mt-0.5 leading-snug" style={{ color: SUB }}>{m.sub}</div>
                    </button>
                  ))}
                </section>

                {/* Lower page — Phase E intelligence band (governed, presentation-only). */}
                {/* Row: Why this vehicle checks out | Market Comparison */}
                <section className="grid grid-cols-2 gap-5 items-start">
                  <div className={`${CARD} p-5`}>
                    <div className="text-[14px] font-extrabold" style={{ color: NAVY }}>Vehicle Strengths</div>
                    <ul className="mt-3 space-y-2">
                      {(() => {
                        // Governed, exact-outcome strengths — sourced where the record
                        // names a provider; warranty/coverage stays "requires confirmation".
                        const strengths = [
                          (d.dealerVerified || d.verifiedBy.length > 0) ? "Dealer-verified listing" : null,
                          d.ownerCount === 1 ? `One owner reported${d.historyReport ? ` (${historyReportName(d.historyReport.provider)})` : ""}` : d.ownerCount != null && d.ownerCount > 1 ? `${d.ownerCount} owners reported` : null,
                          listing.mileage != null ? `${listing.mileage.toLocaleString()} reported miles` : null,
                          listing.trim ? `${listing.trim} trim` : null,
                          recallVerified ? "No open recalls (NHTSA)" : null,
                          d.warrantyStr ? "Factory warranty terms found — remaining coverage requires confirmation" : null,
                        ].filter(Boolean) as string[];
                        return (strengths.length ? strengths : ["Details confirmed at the dealership"]).map((b, i) => (
                          <li key={i} className="flex items-start gap-2 text-[13px]" style={{ color: NAVY }}><CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: GREEN }} /> {b}</li>
                        ));
                      })()}
                    </ul>
                    <button onClick={() => go("great-buy")} className="mt-3 text-[13px] font-bold inline-flex items-center gap-1 hover:underline" style={{ color: BLUE }}>See full buying report <ChevronRight className="w-4 h-4" /></button>
                  </div>

                  <ModuleView onView={() => firePhaseE("market_comparison_viewed", { module_id: "market-comparison", module_position: 2, mode: mc.mode })} dataModule="market-comparison" className={`${CARD} p-5`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[14px] font-extrabold" style={{ color: NAVY }}>Market Comparison</div>
                      {mc.mode !== "unavailable" && <button onClick={() => { firePhaseE("market_methodology_opened"); openPanel("price-history"); }} className="text-[13px] font-bold inline-flex items-center gap-1 hover:underline" style={{ color: BLUE }}>View Market Details <ChevronRight className="w-4 h-4" /></button>}
                    </div>
                    {mc.mode === "unavailable" ? (
                      <p className="mt-3 text-[13px]" style={{ color: SUB }}>Market comparison temporarily unavailable. Vehicle information and dealer pricing remain available.</p>
                    ) : (
                      <>
                        <div className="mt-3 flex items-end justify-between gap-4">
                          <div><div className={label3} style={{ color: SUB }}>This vehicle</div><div className="text-[20px] font-extrabold tabular-nums" style={{ color: NAVY }}>{mc.advertisedPrice != null ? fmt$(mc.advertisedPrice) : "—"}</div></div>
                          <div className="text-right"><div className={label3} style={{ color: SUB }}>{mc.marketValueLabel}</div><div className="text-[20px] font-extrabold tabular-nums" style={{ color: NAVY }}>{mc.normalizedMarketValue != null ? fmt$(mc.normalizedMarketValue) : "—"}</div></div>
                        </div>
                        {mc.diff != null && (
                          <div className="mt-2 text-[13px] font-bold" style={{ color: mc.diff < 0 ? GREEN : NAVY }}>
                            {mc.diff < 0 ? `${fmt$(-mc.diff)} below ${mc.marketValueLabel.toLowerCase()}` : mc.diff > 0 ? `${fmt$(mc.diff)} above ${mc.marketValueLabel.toLowerCase()}` : `At ${mc.marketValueLabel.toLowerCase()}`}
                            {mc.diffPct != null ? ` (${Math.abs(mc.diffPct)}%)` : ""}
                          </div>
                        )}
                        {mc.mode === "trend" ? (
                          <div className="mt-3">
                            {mc.periodLabel && <div className="text-[11px] mb-1" style={{ color: SUB }}>{mc.periodLabel}</div>}
                            <MarketTrendChart listing={mc.listingSeries} market={mc.marketSeries} currency={(n) => fmt$(n) || `$${n}`} />
                            {/* Limited market history: pair the price line with the current static position bar. */}
                            {!mc.hasMarketSeries && marketPos && (
                              <div className="mt-2">
                                <div className="text-[11px] mb-1.5" style={{ color: SUB }}>The line above is this vehicle&#39;s advertised-price history. A normalized market-value trend line is not yet available, so the bar below shows its current market position.</div>
                                <div className="relative h-2 rounded-full" style={{ background: "linear-gradient(90deg,#16A34A,#F59E0B,#EF4444)" }}>
                                  <span className="absolute -top-1 w-1.5 rounded-full ring-2 ring-white" style={{ left: `calc(${Math.round(marketPos.t * 100)}% - 3px)`, height: 16, background: NAVY }} />
                                </div>
                                <div className="mt-1 flex justify-between text-[10px]" style={{ color: SUB }}><span>Best value</span><span className="font-bold" style={{ color: NAVY }}>{marketPos.label}</span><span>Above market</span></div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="mt-3">
                            {marketPos && (
                              <>
                                <div className="relative h-2.5 rounded-full" style={{ background: "linear-gradient(90deg,#16A34A,#F59E0B,#EF4444)" }}>
                                  <span className="absolute -top-1 w-1.5 rounded-full ring-2 ring-white" style={{ left: `calc(${Math.round(marketPos.t * 100)}% - 3px)`, height: 18, background: NAVY }} />
                                </div>
                                <div className="mt-1.5 flex justify-between text-[10px]" style={{ color: SUB }}><span>Best value</span><span className="font-bold" style={{ color: NAVY }}>{marketPos.label}</span><span>Above market</span></div>
                              </>
                            )}
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]" style={{ color: SUB }}>
                          {mc.sampleSize != null && <span>{mc.sampleSize} comparables{mc.radiusMiles ? ` · ${mc.radiusMiles} mi` : ""}</span>}
                          {mc.checkedAt && <span>Checked {mc.checkedAt.slice(0, 10)}</span>}
                        </div>
                        {mc.limitations.length > 0 && <p className="mt-1.5 text-[11px]" style={{ color: SUB }}>{mc.limitations[0]}</p>}
                      </>
                    )}
                  </ModuleView>
                </section>

                {/* Similar Vehicles — full width, horizontally scrollable, closest first. */}
                <ModuleView onView={() => firePhaseE("similar_vehicles_viewed", { module_id: "similar-vehicles", module_position: 3, count: sims.length })} dataModule="similar-vehicles" className={`${CARD} ${sims.length === 0 ? "p-4" : "p-5"}`}>
                  {sims.length === 0 ? (
                    // Compact empty state that also reconciles "N analyzed" vs "0 shown".
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[13px] font-bold" style={{ color: NAVY }}>No close matches found</div>
                        <p className="text-[12px] mt-0.5" style={{ color: SUB }}>{d.marketMeta.similarCount != null ? `We analyzed ${d.marketMeta.similarCount} listings, but none met the current year, trim, condition and mileage requirements.` : "None met the current year, trim, condition and mileage requirements."}</p>
                      </div>
                      <button onClick={() => { firePhaseE("all_similar_vehicles_opened"); openPanel("comparable-vehicles"); }} className="text-[13px] font-bold inline-flex items-center gap-1 hover:underline shrink-0" style={{ color: BLUE }}>View broader alternatives <ChevronRight className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <>
                  <div className="flex items-center justify-between gap-3">
                    <div><div className="text-[14px] font-extrabold" style={{ color: NAVY }}>Similar Vehicles</div><p className="text-[12px]" style={{ color: SUB }}>Closest comparable listings. Price shown is the raw advertised difference.</p></div>
                    <button onClick={() => { firePhaseE("all_similar_vehicles_opened"); openPanel("comparable-vehicles"); }} className="text-[13px] font-bold inline-flex items-center gap-1 hover:underline shrink-0" style={{ color: BLUE }}>View All Similar Vehicles <ChevronRight className="w-4 h-4" /></button>
                  </div>
                  {(
                    <div className="mt-4 overflow-x-auto -mx-1 px-1 pb-1"><div className="flex gap-4" style={{ width: "max-content" }}>
                      {sims.map((c) => (
                        <button key={c.id} onClick={() => { firePhaseE("similar_vehicle_opened", { comparable_id: c.id, match_label: c.matchLabel }); openPanel("comparable-vehicles"); }} className="text-left rounded-xl border overflow-hidden hover:border-[#2563EB] transition-colors" style={{ borderColor: BORDER, width: 220 }}>
                          <div className="aspect-[16/10] bg-slate-100">{c.image ? <img src={c.image} alt={c.ymm || "Comparable vehicle"} loading="lazy" className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center"><Package className="w-6 h-6 text-slate-300" /></div>}</div>
                          <div className="p-3">
                            <div className="text-[12.5px] font-bold leading-tight truncate" style={{ color: NAVY }}>{c.ymm || "Comparable listing"}</div>
                            <div className="text-[11px] mt-0.5" style={{ color: SUB }}>{[c.trim, c.miles != null ? `${c.miles.toLocaleString()} mi` : null, c.dist != null ? `${Math.round(c.dist)} mi away` : null].filter(Boolean).join(" · ")}</div>
                            <div className="text-[15px] font-extrabold tabular-nums mt-1.5" style={{ color: NAVY }}>{fmt$(c.price)}</div>
                            <div className="text-[11px] font-semibold mt-0.5" style={{ color: c.priceDelta < 0 ? GREEN : c.priceDelta > 0 ? NAVY : SUB }}>{c.priceDeltaLabel}</div>
                            <div className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5" style={{ background: "#F1F5F9", color: SUB }}>{c.matchLabel}</div>
                          </div>
                        </button>
                      ))}
                    </div></div>
                  )}
                    </>
                  )}
                </ModuleView>

                {/* Fuel Economy & Running Cost — governed EPA fuel data only. */}
                <ModuleView onView={() => firePhaseE("fuel_economy_viewed", { module_id: "fuel-economy", module_position: 4, available: fuel.available })} dataModule="fuel-economy" className={`${CARD} p-5`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[14px] font-extrabold" style={{ color: NAVY }}>{FUEL_MODULE_HEADING}</div>
                    {fuel.available && fuel.source && (() => {
                      const epaChecked = (listing as unknown as { epa_checked_at?: string }).epa_checked_at;
                      return <button onClick={() => firePhaseE("epa_methodology_opened")} className="text-[11px] font-semibold inline-flex items-center gap-1" style={{ color: SUB }}><Info className="w-3.5 h-3.5" /> {fuel.source}{epaChecked ? ` · checked ${epaChecked.slice(0, 10)}` : ""}</button>;
                    })()}
                  </div>
                  {!fuel.available ? (
                    <p className="mt-3 text-[13px]" style={{ color: SUB }}>{fuel.note}</p>
                  ) : (
                    <>
                      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4">
                        {fuel.annualFuelCost != null && (
                          <div><div className={label3} style={{ color: SUB }}>{fuel.annualFuelCostLabel}</div><div className="mt-1 text-[20px] font-extrabold tabular-nums" style={{ color: NAVY }}>{fmt$(fuel.annualFuelCost)}<span className="text-[12px] font-semibold" style={{ color: SUB }}>/yr</span></div></div>
                        )}
                        {fuel.combinedMpg != null && <div><div className={label3} style={{ color: SUB }}>Combined</div><div className="mt-1 text-[20px] font-extrabold tabular-nums" style={{ color: NAVY }}>{fuel.combinedMpg}<span className="text-[12px] font-semibold" style={{ color: SUB }}> MPG</span></div></div>}
                        {(fuel.cityMpg != null || fuel.highwayMpg != null) && <div><div className={label3} style={{ color: SUB }}>City / Hwy</div><div className="mt-1 text-[20px] font-extrabold tabular-nums" style={{ color: NAVY }}>{fuel.cityMpg ?? "—"}/{fuel.highwayMpg ?? "—"}</div></div>}
                        {fuel.rangeMiles != null && <div><div className={label3} style={{ color: SUB }}>EPA range</div><div className="mt-1 text-[20px] font-extrabold tabular-nums" style={{ color: NAVY }}>{fuel.rangeMiles}<span className="text-[12px] font-semibold" style={{ color: SUB }}> mi</span></div></div>}
                        {fuel.fuelType && <div><div className={label3} style={{ color: SUB }}>Fuel</div><div className="mt-1 text-[15px] font-bold" style={{ color: NAVY }}>{fuel.fuelType}</div></div>}
                      </div>
                      <p className="mt-3 text-[11px]" style={{ color: SUB }}>{fuel.note}</p>
                    </>
                  )}
                </ModuleView>

                {/* Dealer story — full width. */}
                <section className="grid grid-cols-1 gap-5 items-start">
                  {dealerName && (
                    <div className={`${CARD} overflow-hidden`} data-module="dealer">
                      {dt.storefrontUrl ? (
                        // Cinematic crop — full-width story without dominating the page (~2.3:1, max 360px).
                        <div className="relative w-full bg-slate-100 overflow-hidden" style={{ aspectRatio: "2.3 / 1", maxHeight: 360 }}>
                          <img src={dt.storefrontUrl} alt={dealerName} className="w-full h-full object-cover" loading="lazy" />
                          <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(13,27,42,0.85) 0%, rgba(13,27,42,0.1) 55%, transparent 75%)" }} />
                          <div className="absolute bottom-3 left-4 text-white"><div className="text-[15px] font-extrabold">Why Buy From {dealerName}</div>{dealerFoundedYear != null && <div className="text-[12px] opacity-90">Serving drivers since {dealerFoundedYear}{dealerYears != null ? ` · ${dealerYears} years` : ""}</div>}</div>
                        </div>
                      ) : <div className="px-4 pt-4 text-[15px] font-extrabold" style={{ color: NAVY }}>Why Buy From {dealerName}</div>}
                      {dealerBenefits.length > 0 && (
                        <div className="px-4 pt-4 grid grid-cols-2 gap-x-4 gap-y-2">
                          {dealerBenefits.slice(0, 4).map((b) => <div key={b} className="flex items-start gap-2 text-[12.5px] font-medium" style={{ color: NAVY }}><CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: GREEN }} /> {b}</div>)}
                        </div>
                      )}
                      <button onClick={() => { trackCustomerCtaClicked({ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: "passport", surface: "vehicle_passport", metadata: { cta: "dealer_profile" } }); go("dealer"); }} className="px-4 py-3.5 inline-flex items-center gap-1.5 text-[13px] font-bold" style={{ color: BLUE }}>Meet {dealerName} <ChevronRight className="w-4 h-4" /></button>
                    </div>
                  )}
                </section>
              </main>

              {/* ── STICKY CUSTOMER ACTION CENTER ── */}
              <aside className="self-start" style={{ position: "sticky", top: DESKTOP_STICKY_OFFSET }} data-module="action-center">
                <div className={`${CARD} p-5`}>
                  <div className="text-[10px] font-black uppercase tracking-wider" style={{ color: SUB }}>Customer Action Center</div>
                  {/* Today's Sale Price + itemized breakdown. The ONE above-the-fold
                      price; the model reconciles vehiclePrice + fee to it exactly, so
                      the fee is never double-added (no $31,771). */}
                  <div className="mt-3">
                    {saleCard
                      ? <VehiclePriceBreakdown card={saleCard} />
                      : <>
                          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: SUB }}>Today's Sale Price</div>
                          <div className="text-[32px] font-extrabold tabular-nums leading-none mt-1" style={{ color: NAVY }}>{price != null ? fmt$(price) : "—"}</div>
                        </>}
                  </div>
                  {/* Example payment — an estimate only, never an offer or approval.
                      Reflects the shopper's own scenario when they set one on the ladder. */}
                  {payMonthly != null && (
                    <div className="mt-1.5 text-[12px]" style={{ color: SUB }}>
                      {customPayment ? "Your est. " : "Est. "}<span className="font-bold tabular-nums" style={{ color: NAVY }}>{fmt$(payMonthly)}/mo</span>{payAssumptions ? ` · ${payAssumptions}` : ""}
                      {customPayment && <button onClick={resetPayment} className="ml-2 font-semibold underline" style={{ color: BLUE }}>Reset</button>}
                    </div>
                  )}
                  <p className="mt-3 text-[11px] leading-snug" style={{ color: SUB }}>Sales tax, title, registration and dealer-installed options are not included.</p>

                  {/* Fixed conversion hierarchy — each opens the complete existing V2 page. */}
                  <button onClick={actPrimary.onClick} className="mt-4 w-full h-11 rounded-xl inline-flex items-center justify-center gap-2 text-[14px] font-bold text-white" style={{ background: BLUE }}><DollarSign className="w-4 h-4" /> {actPrimary.label}</button>
                  <button onClick={actReserve.onClick} className="mt-2 w-full h-11 rounded-xl border inline-flex items-center justify-center gap-2 text-[14px] font-bold hover:bg-slate-50" style={{ borderColor: BLUE, color: BLUE }}><BadgeCheck className="w-4 h-4" /> {actReserve.label}</button>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {actGrid1.map((s) => <button key={s.label} onClick={s.onClick} className="h-10 rounded-xl border inline-flex items-center justify-center gap-1.5 text-[13px] font-bold hover:bg-slate-50" style={{ borderColor: BORDER, color: NAVY }}><s.icon className="w-4 h-4" style={{ color: BLUE }} /> {s.label}</button>)}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {actGrid2.map((s) => <button key={s.label} onClick={s.onClick} className="h-10 rounded-xl border inline-flex items-center justify-center gap-1.5 text-[13px] font-bold hover:bg-slate-50" style={{ borderColor: BORDER, color: NAVY }}><s.icon className="w-4 h-4" style={{ color: BLUE }} /> {s.label}</button>)}
                  </div>
                  <div className="mt-3 pt-3 border-t grid grid-cols-3 gap-2" style={{ borderColor: BORDER }}>
                    {actUtility.map((c) => {
                      const on = (c.label === "Save" && isSaved) || (c.label === "Watch Price" && watchOpen);
                      return <button key={c.label} onClick={c.onClick} aria-expanded={c.label === "Watch Price" ? watchOpen : undefined} className="h-9 rounded-lg inline-flex items-center justify-center gap-1.5 text-[12px] font-bold hover:bg-slate-50" style={{ color: on ? BLUE : NAVY }}><c.icon className="w-4 h-4" style={{ color: on ? BLUE : SUB, fill: c.label === "Save" && isSaved ? BLUE : "none" }} /> {c.label}</button>;
                    })}
                  </div>
                  {/* Inline price & availability alert capture (reuses the governed
                      watch_price RPC). Honors the dealer's price_drop_watch toggle. */}
                  {watchOpen && (listing as unknown as { price_drop_watch?: boolean }).price_drop_watch !== false && (
                    <div className="mt-3">
                      <PriceDropWatch slug={listing.slug || rawSlug} />
                    </div>
                  )}

                  {dealerName && (
                    <div className="mt-4 pt-4 border-t" style={{ borderColor: BORDER }}>
                      <div className="text-[13px] font-extrabold" style={{ color: NAVY }}>{dealerName}</div>
                      {d.dealerAddress && <div className="text-[12px] mt-0.5" style={{ color: SUB }}>{d.dealerAddress}</div>}
                      {d.dealerPhone && <a href={`tel:${d.dealerPhone}`} className="text-[12px] font-semibold" style={{ color: BLUE }}>{d.dealerPhone}</a>}
                      <div className="mt-1 text-[11px]" style={{ color: SUB }}>Confirm current availability with the dealership.</div>
                      <button onClick={() => go("dealer")} className="mt-2 text-[12px] font-bold inline-flex items-center gap-1 hover:underline" style={{ color: BLUE }}>Meet {dealerName} <ChevronRight className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                  <div className="mt-3 pt-3 border-t inline-flex items-center gap-1.5 text-[10px]" style={{ borderColor: BORDER, color: SUB }}>
                    <Lock className="w-3 h-3" /> Your information is only shared when you choose to contact the dealership.
                  </div>
                </div>
              </aside>
            </div>

            {/* Floating "Ready to take the next step?" launcher — a persistent,
                low-friction next-step dock distinct from the sticky action rail.
                Desktop-only (hidden lg:block); routes Reserve/Trade/Contact into
                the complete V2 pages via go() and dials the dealer's real number. */}
            <PassportCtaDock
              go={go}
              dealerPhone={d.dealerPhone || undefined}
              reviewRating={d.reviewRating}
              advisor={d.dealerTrust}
              routing={d.contactRouting}
              vehicle={{ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin }}
            />
          </div>
        );
      })()}

      {/* ── Sticky bottom CTA (mobile / tablet only — desktop uses the action center) ── */}
      {!isDesktop && stickyCfg.enabled && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-white/95 backdrop-blur" style={{ borderColor: BORDER, paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="max-w-lg mx-auto px-3 py-2.5 grid gap-2" style={{ gridTemplateColumns: `repeat(${stickyCfg.items.length}, minmax(0,1fr))` }}>
            {stickyCfg.items.map((b) => {
              const { icon: Icon, onClick } = stickyAction(b.key);
              const primary = b.primary;
              return (
                <button
                  key={b.key}
                  onClick={onClick}
                  className={`h-11 rounded-xl inline-flex items-center justify-center gap-1.5 text-[12px] font-bold px-2 ${primary ? "text-white" : ""}`}
                  style={primary
                    ? { background: BLUE }
                    : { background: "#F1F5F9", color: NAVY, border: `1px solid ${BORDER}` }}
                >
                  <Icon className="w-4 h-4" />
                  <span className="truncate">{b.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Detail sheets (existing dispatcher) ─────────────────────── */}
      {activePanel && isPassportPanelKey(activePanel) && (
        <Suspense fallback={null}>
          <PassportPanel
            panel={activePanel}
            onClose={() => setActivePanel(null)}
            listing={listing}
            d={d}
            isPreview={isPreview}
            go={go}
            openPanel={(k) => setActivePanel(k)}
          />
        </Suspense>
      )}

      {/* ── Governed V3 action drawer (shared by mobile + desktop) — keeps
          reserve / test-drive / trade / contact / payment / availability inside
          the V3 experience instead of navigating into the V2 detail pages. ── */}
      <PassportActionDrawer action={actionDrawer} listing={listing} d={d} onClose={() => setActionDrawer(null)} />

      {/* ── Full-screen gallery sheet ──────────────────────────────── */}
      {galleryOpen && gallery.length > 0 && (
        <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col" onClick={() => setGalleryOpen(false)}>
          <div className="h-14 flex items-center justify-between px-4 text-white/90">
            <div className="text-[13px] font-semibold">{idx + 1} / {gallery.length}</div>
            <button aria-label="Close" className="h-10 w-10 grid place-items-center rounded-full hover:bg-white/10"><X className="w-5 h-5" /></button>
          </div>
          <div className="flex-1 grid place-items-center" onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => { (e.currentTarget as HTMLDivElement).dataset.tsx = String(e.touches[0].clientX); }}
            onTouchEnd={(e) => {
              const start = Number((e.currentTarget as HTMLDivElement).dataset.tsx || 0);
              const dx = (e.changedTouches[0].clientX - start);
              if (Math.abs(dx) > 40) swipeHero(dx < 0 ? 1 : -1);
            }}
          >
            <img src={gallery[idx]} alt="" className="max-w-full max-h-full object-contain" />
          </div>
        </div>
      )}
    </div>
  );
}
