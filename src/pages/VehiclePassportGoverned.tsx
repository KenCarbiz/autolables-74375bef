import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams, useLocation } from "react-router-dom";
import {
  Bookmark, MoreHorizontal, Upload, Phone, MessageSquare, Clock, DollarSign,
  ChevronDown, ChevronRight, ChevronLeft, Star, Sparkles, ShieldCheck, CheckCircle2, MapPin,
  RefreshCw, Send, BadgeCheck, Play, Package, Award, TrendingUp, X, Info, Lock, Wrench, FileText, Eye,
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
import { resolveStickyButtons, type StickyBottomButtons } from "@/lib/stickyButtons";
import { MOCK_LISTING } from "./VehiclePassportV3";
import type { VehicleListing } from "@/hooks/useVehicleListing";
import { isVehicleSaved, toggleSavedVehicle } from "@/lib/savedVehicles";
import { usePassportEngagement } from "@/lib/passportEngagement";
import { trackPassportOpened, trackWindowStickerScanned, trackCustomerCtaClicked } from "@/lib/engagement/customerEngagement";
import { isPassportPanelKey, type PassportPanelKey } from "@/components/passport/passportPanelKeys";
import { derivePassportVerification } from "@/lib/passport/verificationSummary";
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
        <span className="inline-flex items-center gap-1.5"><span className="w-4 h-0.5" style={{ background: "#2563EB" }} /> This vehicle</span>
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

function Skeleton() {
  return (
    <div className="min-h-screen" style={{ background: BG }}>
      <div className="h-14 border-b bg-white" style={{ borderColor: BORDER }} />
      <div className="max-w-md mx-auto p-4 space-y-4 animate-pulse">
        <div className="aspect-[4/3] rounded-2xl bg-slate-200" />
        <div className="h-6 w-3/4 rounded bg-slate-200" />
        <div className="h-4 w-1/2 rounded bg-slate-200" />
        <div className="h-24 rounded-2xl bg-slate-200" />
        <div className="h-32 rounded-2xl bg-slate-200" />
        <div className="h-24 rounded-2xl bg-slate-200" />
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
  const isPreview = search.get("preview") === "1";
  const { listing, loading, notFound } = usePublicListing(rawSlug, { preview: isPreview, previewData: MOCK_LISTING as unknown as VehicleListing });

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
  // Shared verification source of truth — both mobile and desktop layers read
  // this so they can never diverge on totals / pending / material-pending.
  const vsum = derivePassportVerification(d, listing);
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
  const saveVs = d.saveVsMsrp && d.saveVsMsrp > 0 ? d.saveVsMsrp : null;

  // ── Intelligence chips: derive the 3 strongest vehicle-specific reasons.
  type Chip = { label: string; tone: "green" | "blue" | "amber"; icon: React.ElementType };
  const intelChips: Chip[] = [];
  if (d.belowMarket != null && d.belowMarket > 250) intelChips.push({ label: `${fmt$(d.belowMarket)} Below Market`, tone: "green", icon: TrendingUp });
  if (d.dealerVerified || (d.verifiedBy && d.verifiedBy.length > 0)) intelChips.push({ label: "Dealer Verified", tone: "blue", icon: ShieldCheck });
  if (d.warrantyStr && !d.warrantyExpired) intelChips.push({ label: `Factory Warranty · ${d.warrantyStr}`, tone: "blue", icon: Award });
  if (intelChips.length < 3 && d.ownerCount === 1) intelChips.push({ label: "1-Owner", tone: "blue", icon: BadgeCheck });
  if (intelChips.length < 3 && d.recallClear) intelChips.push({ label: "No Open Recalls", tone: "green", icon: CheckCircle2 });
  if (intelChips.length < 3 && d.cleanTitle) intelChips.push({ label: "Clean Title", tone: "green", icon: CheckCircle2 });
  if (intelChips.length < 3 && d.serviceCount > 0) intelChips.push({ label: `${d.serviceCount} Service Records`, tone: "blue", icon: Award });
  const chips = intelChips.slice(0, 3);

  // ── Verification summary — derived from the shared governed source so the
  // mobile count can never disagree with the desktop module.
  const verified = vsum.completed;
  const totalVerify = vsum.total;
  const verifyPct = vsum.completedPct;

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
              <Logo variant="mark" className="h-6" />
            )}
            {!heroInView && (
              <div className="min-w-0 pl-2 border-l" style={{ borderColor: BORDER }}>
                <div className="text-[12px] font-semibold truncate" style={{ color: NAVY }}>{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</div>
                <div className="text-[11px] tabular-nums" style={{ color: BLUE }}>{price ? fmt$(price) : ""}</div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={handleSave} aria-label="Save" className="h-9 w-9 grid place-items-center rounded-full hover:bg-slate-50" data-module="save">
              <Bookmark className="w-[18px] h-[18px]" style={{ color: isSaved ? BLUE : NAVY, fill: isSaved ? BLUE : "none" }} />
            </button>
            <button onClick={handleShare} aria-label="Share" className="h-9 w-9 grid place-items-center rounded-full hover:bg-slate-50" data-module="share">
              <Upload className="w-[18px] h-[18px]" style={{ color: NAVY }} />
            </button>
            <button aria-label="More" onClick={() => openAction("contact")} className="h-9 w-9 grid place-items-center rounded-full hover:bg-slate-50">
              <MoreHorizontal className="w-[18px] h-[18px]" style={{ color: NAVY }} />
            </button>
          </div>
        </div>
      </header>
      )}

      {/* ── Mobile / tablet column (< xl) — the approved mobile V3, only mounts below xl ── */}
      {!isDesktop && (
      <div className="max-w-lg mx-auto">

        {/* ── Hero gallery ─────────────────────────────────────────── */}
        <div ref={heroRef} className="relative bg-white" data-module="gallery">
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
              <span className="absolute top-3 right-3 h-7 px-2.5 rounded-full bg-black/60 text-white text-[11px] font-semibold inline-flex items-center">
                {idx + 1} / {gallery.length}
              </span>
            )}
            {hasVideo && (
              <span className="absolute top-3 left-3 h-7 px-2.5 rounded-full bg-white/95 text-[11px] font-bold inline-flex items-center gap-1" style={{ color: NAVY }}>
                <Play className="w-3 h-3" /> Video
              </span>
            )}
            {gallery.length > 1 && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1">
                {gallery.slice(0, 8).map((_, i) => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: i === (idx % 8) ? "#fff" : "rgba(255,255,255,0.5)" }} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Identity + one price story ───────────────────────────── */}
        <section className="px-4 pt-5" data-module="identity">
          <div className="inline-flex items-center h-6 px-2.5 rounded-full text-[11px] font-bold uppercase tracking-wide" style={{ background: isNew ? "#EFF6FF" : "#F1F5F9", color: isNew ? BLUE : NAVY }}>
            {isNew ? "New" : (condition === "cpo" ? "Certified" : "Used")}
          </div>
          <h1 className="mt-2 text-[22px] leading-tight font-extrabold" style={{ color: NAVY }}>
            {listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: SUB }}>
            {listing.vin ? <>VIN <span className="font-mono">{listing.vin}</span></> : null}
            {listing.mileage != null ? <> · {listing.mileage.toLocaleString()} mi</> : null}
          </p>

          {/* Trusted price row */}
          <button
            onClick={() => setPriceOpen((v) => !v)}
            className={`${CARD} mt-4 w-full text-left px-4 py-4`}
            data-module="price"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: SUB }}>{d.priceLabel || "Total price"}</div>
                <div className="mt-0.5 text-[28px] font-extrabold tabular-nums" style={{ color: NAVY }}>
                  {price != null ? fmt$(price) : "—"}
                </div>
              </div>
              <div className="text-right">
                {saveVs ? (
                  <>
                    <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: SUB }}>Total savings</div>
                    <div className="mt-0.5 text-[18px] font-extrabold tabular-nums inline-flex items-center gap-1" style={{ color: GREEN }}>
                      {fmt$(saveVs)} <ChevronDown className={`w-4 h-4 transition ${priceOpen ? "rotate-180" : ""}`} />
                    </div>
                  </>
                ) : (
                  <ChevronDown className={`w-5 h-5 transition ${priceOpen ? "rotate-180" : ""}`} style={{ color: SUB }} />
                )}
              </div>
            </div>
            {priceOpen && d.priceBreakdown && (
              <div className="mt-3 rounded-xl border px-3 py-2.5 text-[12px]" style={{ borderColor: BORDER, background: "#F8FAFC", color: SUB }}>
                <div className="flex items-baseline justify-between"><span>MSRP</span><span className="font-semibold tabular-nums" style={{ color: NAVY }}>{fmt$(d.priceBreakdown.msrp)}</span></div>
                {d.priceBreakdown.lines.map((l) => (
                  <div key={l.key} className="flex items-baseline justify-between mt-1"><span>{l.label}</span><span className="font-semibold tabular-nums" style={{ color: GREEN }}>−{fmt$(l.amount)}</span></div>
                ))}
                <div className="mt-2 pt-2 border-t flex items-baseline justify-between" style={{ borderColor: BORDER }}><span className="font-bold" style={{ color: NAVY }}>{d.priceLabel || "Your price"}</span><span className="font-extrabold tabular-nums" style={{ color: NAVY }}>{fmt$(d.priceBreakdown.ourPrice)}</span></div>
                {d.priceBreakdown.docFee ? (
                  <>
                    <div className="mt-1 flex items-baseline justify-between"><span>+ Conveyance / doc fee</span><span className="font-semibold tabular-nums" style={{ color: NAVY }}>{fmt$(d.priceBreakdown.docFee)}</span></div>
                    <div className="mt-2 pt-2 border-t flex items-baseline justify-between" style={{ borderColor: BORDER }}><span className="font-bold" style={{ color: NAVY }}>Sale price</span><span className="font-extrabold tabular-nums" style={{ color: NAVY }}>{fmt$(d.priceBreakdown.salePrice ?? d.priceBreakdown.ourPrice)}</span></div>
                  </>
                ) : null}
              </div>
            )}
            {priceOpen && !d.priceBreakdown && d.belowOriginalMsrp && d.belowOriginalMsrp > 0 && (
              <div className="mt-3 rounded-xl border px-3 py-2.5 text-[12px]" style={{ borderColor: BORDER, background: "#F8FAFC", color: SUB }}>
                <div className="flex items-baseline justify-between"><span>Original MSRP</span><span className="font-semibold tabular-nums" style={{ color: NAVY }}>{fmt$(d.msrp)}</span></div>
                <div className="mt-1 flex items-baseline justify-between"><span>Depreciation since new</span><span className="font-semibold tabular-nums" style={{ color: NAVY }}>−{fmt$(d.belowOriginalMsrp)}</span></div>
                <div className="mt-2 pt-2 border-t flex items-baseline justify-between" style={{ borderColor: BORDER }}><span className="font-bold" style={{ color: NAVY }}>{d.priceLabel || "Your price"}</span><span className="font-extrabold tabular-nums" style={{ color: NAVY }}>{fmt$(price)}</span></div>
              </div>
            )}
          </button>
        </section>

        {/* ── Price & availability alerts (same governed watch_price capture as desktop) ── */}
        {(listing as unknown as { price_drop_watch?: boolean }).price_drop_watch !== false && (
          <section className="px-4 pt-4" data-module="watch-price">
            {watchOpen ? (
              <PriceDropWatch slug={listing.slug || rawSlug} />
            ) : (
              <button onClick={() => { trackCustomerCtaClicked({ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: "passport", surface: "vehicle_passport", metadata: { cta: "watch_price" } }); setWatchOpen(true); }} className={`${CARD} w-full flex items-center justify-between gap-3 px-4 py-3.5`}>
                <span className="inline-flex items-center gap-2 text-[13px] font-bold" style={{ color: NAVY }}><Eye className="w-4 h-4" style={{ color: BLUE }} /> Watch price &amp; availability</span>
                <ChevronRight className="w-4 h-4" style={{ color: SUB }} />
              </button>
            )}
          </section>
        )}

        {/* ── AutoLabels Intelligence ──────────────────────────────── */}
        {chips.length > 0 && (
          <section className="px-4 pt-4" data-module="intelligence">
            <div className={CARD}>
              <button onClick={() => setIntelOpen((v) => !v)} className="w-full flex items-center justify-between gap-3 px-4 py-3">
                <div className="inline-flex items-center gap-2">
                  <span className="h-7 w-7 grid place-items-center rounded-full" style={{ background: "#EFF6FF" }}>
                    <Sparkles className="w-4 h-4" style={{ color: BLUE }} />
                  </span>
                  <span className="text-[13px] font-bold" style={{ color: NAVY }}>AutoLabels Intelligence</span>
                </div>
                <ChevronDown className={`w-4 h-4 transition ${intelOpen ? "rotate-180" : ""}`} style={{ color: SUB }} />
              </button>
              {intelOpen && (
                <div className="px-4 pb-4 flex flex-wrap gap-2">
                  {chips.map((c) => {
                    const bg = c.tone === "green" ? "#ECFDF5" : c.tone === "amber" ? "#FEF3C7" : "#EFF6FF";
                    const fg = c.tone === "green" ? GREEN : c.tone === "amber" ? AMBER : BLUE;
                    const border = c.tone === "green" ? "#A7F3D0" : c.tone === "amber" ? "#FCD34D" : "#BFDBFE";
                    const Icon = c.icon;
                    return (
                      <span key={c.label} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] font-semibold border" style={{ background: bg, color: fg, borderColor: border }}>
                        <Icon className="w-3.5 h-3.5" /> {c.label}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Verified Vehicle Data ────────────────────────────────── */}
        {totalVerify > 0 && (
          <section className="px-4 pt-4" data-module="verification">
            <button onClick={() => openPanel("price-confidence")} className={`${CARD} w-full text-left px-4 py-4`}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-bold" style={{ color: NAVY }}>Verified Vehicle Data</div>
                  <div className="text-[12px] mt-0.5" style={{ color: SUB }}>{verified} of {totalVerify} categories verified</div>
                </div>
                <ChevronRight className="w-4 h-4 shrink-0" style={{ color: SUB }} />
              </div>
              <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: "#F1F5F9" }}>
                <div className="h-full rounded-full" style={{ width: `${verifyPct}%`, background: GREEN }} />
              </div>
              <div className="mt-2 flex items-center gap-3 text-[11px]" style={{ color: SUB }}>
                <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: GREEN }} />Factory / Dealer Verified</span>
                <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: "#CBD5E1" }} />Not yet verified</span>
              </div>
            </button>
          </section>
        )}

        {/* ── Market Intelligence ──────────────────────────────────── */}
        {pv("marketValue") && marketPos && (
          <section className="px-4 pt-4" data-module="market">
            <button onClick={() => openPanel("market-price")} className={`${CARD} w-full text-left px-4 py-4`}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-bold" style={{ color: NAVY }}>Market Intelligence</div>
                  <div className="text-[12px] mt-0.5" style={{ color: SUB }}>
                    {d.marketMeta.similarCount ? `${d.marketMeta.similarCount} similar vehicles nearby` : "Local comparable market"}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 shrink-0" style={{ color: SUB }} />
              </div>
              <div className="mt-3">
                <div className="relative h-2 rounded-full" style={{ background: "linear-gradient(90deg, #DCFCE7 0%, #DBEAFE 50%, #FEE2E2 100%)" }}>
                  <span
                    className="absolute -top-1 w-4 h-4 rounded-full border-2 border-white shadow"
                    style={{ left: `calc(${Math.round(marketPos.t * 100)}% - 8px)`, background: NAVY }}
                  />
                </div>
                <div className="mt-2 flex justify-between text-[11px]" style={{ color: SUB }}>
                  <span>Best Value</span>
                  <span className="font-bold" style={{ color: NAVY }}>{marketPos.label}</span>
                  <span>Above Market</span>
                </div>
              </div>
            </button>
          </section>
        )}

        {/* ── Progressive rows ─────────────────────────────────────── */}
        <section className="px-4 pt-4 space-y-3">
          {pv("warranty") && (d.warrantyStr || d.oemWarranty) && (
            <button onClick={() => openPanel("factory-warranty")} className={`${CARD} w-full flex items-center justify-between gap-3 px-4 py-3.5`} data-module="warranty">
              <div className="min-w-0 flex items-center gap-3">
                <span className="h-9 w-9 grid place-items-center rounded-xl" style={{ background: "#EFF6FF" }}><Award className="w-[18px] h-[18px]" style={{ color: BLUE }} /></span>
                <div className="min-w-0 text-left">
                  <div className="text-[13px] font-bold" style={{ color: NAVY }}>Warranty Intelligence</div>
                  <div className="text-[12px]" style={{ color: SUB }}>{d.warrantyStr || "Factory coverage"}</div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 shrink-0" style={{ color: SUB }} />
            </button>
          )}
          {pv("factoryOptions") && (
            <button onClick={() => openPanel("equipment")} className={`${CARD} w-full flex items-center justify-between gap-3 px-4 py-3.5`} data-module="equipment">
              <div className="min-w-0 flex items-center gap-3">
                <span className="h-9 w-9 grid place-items-center rounded-xl" style={{ background: "#F1F5F9" }}><Star className="w-[18px] h-[18px]" style={{ color: NAVY }} /></span>
                <div className="min-w-0 text-left">
                  <div className="text-[13px] font-bold" style={{ color: NAVY }}>Features &amp; Equipment</div>
                  <div className="text-[12px]" style={{ color: SUB }}>See all highlights</div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 shrink-0" style={{ color: SUB }} />
            </button>
          )}
          {(pv("historyReport") || pv("insights")) && (d.ownerCount != null || d.cleanTitle || d.historyReport) && (
            <button onClick={() => openPanel("ownership-timeline")} className={`${CARD} w-full flex items-center justify-between gap-3 px-4 py-3.5`} data-module="history">
              <div className="min-w-0 flex items-center gap-3">
                <span className="h-9 w-9 grid place-items-center rounded-xl" style={{ background: "#ECFDF5" }}><ShieldCheck className="w-[18px] h-[18px]" style={{ color: GREEN }} /></span>
                <div className="min-w-0 text-left">
                  <div className="text-[13px] font-bold" style={{ color: NAVY }}>History &amp; Ownership</div>
                  <div className="text-[12px]" style={{ color: SUB }}>
                    {d.cleanTitle ? "Clean title" : d.titleStatus === "branded" ? "Branded title" : "Title status"}
                    {d.ownerCount != null ? ` · ${d.ownerCount}-Owner` : ""}
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 shrink-0" style={{ color: SUB }} />
            </button>
          )}
        </section>

        {/* ── Your next best step ──────────────────────────────────── */}
        <section className="px-4 pt-5" data-module="next-step">
          <button onClick={() => openAction("payment")} className="w-full rounded-2xl px-4 py-4 flex items-center gap-3 border" style={{ background: "#EFF6FF", borderColor: "#BFDBFE" }}>
            <span className="h-10 w-10 grid place-items-center rounded-full bg-white" style={{ color: BLUE }}>
              <Star className="w-5 h-5" />
            </span>
            <div className="min-w-0 text-left">
              <div className="text-[13px] font-bold" style={{ color: NAVY }}>Your Next Best Step</div>
              <div className="text-[12px]" style={{ color: SUB }}>Get your personalized price and payment options in 60 seconds</div>
            </div>
            <ChevronRight className="w-5 h-5 ml-auto" style={{ color: BLUE }} />
          </button>
        </section>

        {/* ── Why Buy From {dealer} ────────────────────────────────── */}
        {dealerName && (
          <section className="px-4 pt-6 pb-6" data-module="dealer">
            <h2 className="text-[18px] font-extrabold leading-tight" style={{ color: NAVY }}>Why Buy From {dealerName}</h2>
            <p className="mt-0.5 text-[13px]" style={{ color: SUB }}>What makes buying here different.</p>

            <div className={`${CARD} mt-3 overflow-hidden`}>
              {/* Full-width dealership photo anchor with dark bottom gradient. */}
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

              {/* Verified benefits — two-column, only what the dealer confirms. */}
              {dealerBenefits.length > 0 && (
                <div className="px-4 pt-4 grid grid-cols-2 gap-x-4 gap-y-2.5">
                  {dealerBenefits.map((b) => (
                    <div key={b} className="flex items-start gap-2 text-[13px] font-medium" style={{ color: NAVY }}>
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: GREEN }} /> {b}
                    </div>
                  ))}
                </div>
              )}

              {/* Recognition — the stored certifications are dealer-entered
                  NAMES only (no issuer/year/verification record), so they are
                  labeled "Dealer-reported" and deliberately do NOT get the green
                  verified treatment used for confirmed benefits. When richer,
                  verified award data lands, this can promote to a verified state. */}
              {dt.certifications.length > 0 && (
                <div className="px-4 pt-4 mt-4 border-t" style={{ borderColor: BORDER }}>
                  <div className="pt-3 text-[13px] font-bold" style={{ color: NAVY }}>Recognition</div>
                  <div className="mt-2 space-y-2.5">
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
                </div>
              )}

              {/* One purposeful link to the full dealership page — reuses the
                  existing working /dealer route; no second reserve CTA here. The
                  tap ties dealership-story engagement to profile opens through
                  the existing CTA event pipeline. */}
              <button onClick={() => { trackCustomerCtaClicked({ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: "passport", surface: "vehicle_passport", metadata: { cta: "dealer_profile" } }); go("dealer"); }} className="px-4 py-3.5 inline-flex items-center gap-1.5 text-[13px] font-bold" style={{ color: BLUE }}>
                Meet {dealerName} <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </section>
        )}
      </div>
      )}

      {/* ══ Intelligence-first desktop (≥ xl / 1280px) ═══════════════════════
          Two-column outer shell: a wide intelligence WORKSPACE + a sticky
          customer ACTION CENTER. Gallery + identity split only the top hero.
          Verification and market span the workspace. Detail modules open the
          SAME V3 drawers (openPanel) the mobile passport uses — no V2 routes.
          Reuses the identical governed data (d / listing) — no second fetch,
          no separate desktop data model. Hidden below xl so mobile V3 is
          byte-for-byte unchanged. */}
      {isDesktop && (() => {
        // Governed four-state tone (same machine as the hero verified card): a
        // conflict must read "Review" and an unavailable check must read neutral,
        // never a green "Checked" — a pending/unresolved check is never verified.
        const vcats = vsum.categories.map((c) => {
          const terminalPositive = c.state === "verified" || c.state === "dealer_confirmed" || c.state === "calculated" || c.state === "inferred";
          const tone: "ok" | "review" | "na" | "pending" = terminalPositive ? "ok" : c.state === "conflict_detected" ? "review" : c.state === "unavailable" || c.state === "not_applicable" ? "na" : "pending";
          return { label: c.label, tone, material: c.material };
        });
        const vDone = vsum.completed;
        const vTotal = vsum.total;
        const vMaterialPending = vsum.materialPending > 0;
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

        // ── AutoLabels Verified card — governed per-category state, never a
        // fabricated pass. Verified/terminal → green; pending → amber + "Pending";
        // conflict → amber "Review"; unavailable → neutral "Not available".
        const VERIFIED_LABEL: Record<string, string> = {
          vin: "VIN Verified", title: "Title & Brand", recall: "Recall Verification",
          history: "Vehicle History", market: "Market Data", warranty: "Warranty Checked", service: "Service History",
        };
        const PENDING_LABEL: Record<string, string> = {
          vin: "VIN", title: "Title & Brand", recall: "Recall",
          history: "Vehicle History", market: "Market Data", warranty: "Warranty", service: "Service History",
        };
        const verifiedChecks = vsum.categories.map((c) => {
          const terminalPositive = c.state === "verified" || c.state === "dealer_confirmed" || c.state === "calculated" || c.state === "inferred";
          const tone = terminalPositive ? "ok" : c.state === "conflict_detected" ? "review" : c.state === "unavailable" || c.state === "not_applicable" ? "na" : "pending";
          const label = tone === "ok" ? (VERIFIED_LABEL[c.key] || c.label) : (PENDING_LABEL[c.key] || c.label);
          const note = tone === "pending" ? "Pending" : tone === "review" ? "Review" : tone === "na" ? "Not available" : null;
          const color = tone === "ok" ? GREEN : tone === "na" ? "#94A3B8" : AMBER;
          const Icon = tone === "ok" ? CheckCircle2 : tone === "na" ? Info : Clock;
          return { key: c.key, label, note, color, Icon };
        });

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

                    {/* AutoLabels Verified — governed per-category state; never all-green
                        while a material check is pending. */}
                    {vTotal > 0 && (
                      <div className="mt-4 rounded-xl border p-4" style={{ borderColor: BORDER, background: "#FBFDFF" }}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="h-9 w-9 grid place-items-center rounded-full shrink-0" style={{ background: "#EFF6FF" }}><ShieldCheck className="w-5 h-5" style={{ color: BLUE }} /></span>
                            <div className="min-w-0">
                              <div className="text-[14px] font-extrabold" style={{ color: NAVY }}>AutoLabels Verified</div>
                              <div className="text-[12px] leading-snug" style={{ color: SUB }}>Checked against trusted automotive data sources.</div>
                            </div>
                          </div>
                          {vMaterialPending && <span className="text-[11px] font-bold shrink-0" style={{ color: AMBER }}>Checks pending</span>}
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                          {verifiedChecks.map((c) => (
                            <div key={c.key} className="flex items-center gap-2 text-[12.5px] min-w-0" style={{ color: NAVY }}>
                              <c.Icon className="w-4 h-4 shrink-0" style={{ color: c.color }} />
                              <span className="font-medium truncate">{c.label}</span>
                              {c.note && <span className="text-[11px] font-semibold shrink-0" style={{ color: c.color }}>· {c.note}</span>}
                            </div>
                          ))}
                        </div>
                        <button onClick={() => go("verification")} className="mt-3 text-[13px] font-bold inline-flex items-center gap-1 hover:underline" style={{ color: BLUE }}>View full verification report <ChevronRight className="w-4 h-4" /></button>
                      </div>
                    )}
                  </div>
                </section>

                {/* Verified Vehicle Data — spans the workspace; pending stays visible. */}
                <section className={`${CARD} p-5`} data-module="verification" aria-label="Verified vehicle data">
                  <div className="flex items-center justify-between gap-3">
                    <div className="inline-flex items-center gap-2">
                      <span className="h-8 w-8 grid place-items-center rounded-full" style={{ background: vMaterialPending ? "#FEF3C7" : "#DCFCE7" }}><CheckCircle2 className="w-4 h-4" style={{ color: vMaterialPending ? AMBER : GREEN }} /></span>
                      <div><div className="text-[14px] font-extrabold" style={{ color: NAVY }}>Verified Vehicle Data</div><div className="text-[12px]" style={{ color: SUB }}>{vDone} of {vTotal} checks complete{vMaterialPending ? " · a material check is still pending" : ""}</div></div>
                    </div>
                    <button onClick={() => go("verification")} className="text-[13px] font-bold inline-flex items-center gap-1 hover:underline" style={{ color: BLUE }}>View all categories <ChevronRight className="w-4 h-4" /></button>
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-2.5">
                    {vcats.map((c) => {
                      const ok = c.tone === "ok";
                      const na = c.tone === "na";
                      const color = ok ? GREEN : na ? "#94A3B8" : AMBER;
                      const Icon = ok ? CheckCircle2 : na ? Info : Clock;
                      const status = ok ? "Checked" : c.tone === "review" ? "Review" : na ? "Not available" : "Pending";
                      return (
                        <div key={c.label} className="rounded-xl border px-3 py-2.5 flex items-center gap-2" style={{ borderColor: BORDER, background: ok ? "#fff" : na ? "#F8FAFC" : "#FFFBEB" }}>
                          <Icon className="w-4 h-4 shrink-0" style={{ color }} />
                          <div className="min-w-0"><div className="text-[12px] font-semibold leading-tight truncate" style={{ color: NAVY }}>{c.label}</div><div className="text-[10px]" style={{ color: ok ? SUB : color }}>{status}</div></div>
                        </div>
                      );
                    })}
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
                          d.recallClear ? "No open recalls (NHTSA)" : null,
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
                                <div className="text-[11px] mb-1.5" style={{ color: SUB }}>Historical market-value trend unavailable — showing current market position.</div>
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
                  <div className="mt-3 text-[11px] font-bold uppercase tracking-wider" style={{ color: SUB }}>{d.priceLabel || "Our Price"}</div>
                  {/* The ONE above-the-fold price. For a doc-inclusive tenant this already
                      includes the doc fee — it is never added again (no $31,771). */}
                  <div className="text-[32px] font-extrabold tabular-nums leading-none mt-1" style={{ color: NAVY }}>{price != null ? fmt$(price) : "—"}</div>
                  {d.priceIncludesDoc && d.docFee && price != null && (
                    <div className="mt-1.5 text-[12px] leading-snug tabular-nums" style={{ color: SUB }}>
                      Includes {fmt$(d.docFee)} doc fee · {fmt$(price - d.docFee)} before doc fee
                    </div>
                  )}
                  {/* Example payment — an estimate only, never an offer or approval. */}
                  {d.estMonthly != null && (
                    <div className="mt-1.5 text-[12px]" style={{ color: SUB }}>Est. <span className="font-bold tabular-nums" style={{ color: NAVY }}>{fmt$(d.estMonthly)}/mo</span>{d.paymentAssumptions ? ` · ${d.paymentAssumptions}` : ""}</div>
                  )}
                  {/* MSRP — the real factory sticker only; never market value. */}
                  {d.msrp != null && (
                    <div className="mt-1 text-[12px] tabular-nums" style={{ color: SUB }}>MSRP {fmt$(d.msrp)}{saveVs ? <span className="ml-2 font-bold" style={{ color: GREEN }}>{fmt$(saveVs)} below MSRP</span> : null}</div>
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
