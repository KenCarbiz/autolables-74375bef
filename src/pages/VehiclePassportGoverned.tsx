import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Bookmark, MoreHorizontal, Upload, Phone, MessageSquare, Clock, DollarSign,
  ChevronDown, ChevronRight, ChevronLeft, Star, Sparkles, ShieldCheck, CheckCircle2, MapPin,
  RefreshCw, Send, BadgeCheck, Play, Package, Award, TrendingUp, X, Info, Lock, Wrench, FileText,
} from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { usePublicListing } from "@/hooks/usePublicListing";
import { derivePassport, fmt$ } from "@/lib/passportV2Data";
import { listingGallery } from "@/lib/photos";
import { packetVisible } from "@/lib/packetModules";
import { resolveStickyButtons, type StickyBottomButtons } from "@/lib/stickyButtons";
import { MOCK_LISTING } from "./VehiclePassportV3";
import type { VehicleListing } from "@/hooks/useVehicleListing";
import { isVehicleSaved, toggleSavedVehicle } from "@/lib/savedVehicles";
import { usePassportEngagement } from "@/lib/passportEngagement";
import { trackPassportOpened, trackWindowStickerScanned, trackCustomerCtaClicked } from "@/lib/engagement/customerEngagement";
import { isPassportPanelKey, type PassportPanelKey } from "@/components/passport/passportPanelKeys";
import Logo from "@/components/brand/Logo";

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
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [heroInView, setHeroInView] = useState(true);
  const heroRef = useRef<HTMLDivElement | null>(null);

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
  const go = (section: string) => navigate(`/v/${listing.slug || rawSlug}/${section}`);
  const openPanel = (k: PassportPanelKey) => { setActivePanel(k); };
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

  // ── Verification summary
  const verified = d.verifyRows.filter((v) => v.done).length;
  const totalVerify = d.verifyRows.length;
  const verifyPct = totalVerify > 0 ? Math.round((verified / totalVerify) * 100) : 0;

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
    const call = () => { tap("call"); if (d.dealerPhone) window.location.href = `tel:${d.dealerPhone}`; else go("contact"); };
    const text = () => {
      tap("text");
      if (d.dealerPhone) {
        const body = encodeURIComponent(`Hi, I'm interested in the ${listing.ymm || "vehicle"}${listing.vin ? ` (VIN ...${listing.vin.slice(-8)})` : ""} — is it available?`);
        window.location.href = `sms:${d.dealerPhone.replace(/[^\d+]/g, "")}?&body=${body}`;
      } else go("text");
    };
    const map: Record<string, { icon: React.ElementType; onClick: () => void }> = {
      call: { icon: Phone, onClick: call },
      text: { icon: MessageSquare, onClick: text },
      test_drive: { icon: Clock, onClick: () => go("test-drive") },
      todays_price: { icon: DollarSign, onClick: () => go("todays-price") },
      contact_dealer: { icon: MessageSquare, onClick: () => go("contact") },
      trade_appraisal: { icon: RefreshCw, onClick: () => go("trade") },
      value_trade: { icon: RefreshCw, onClick: () => go("trade") },
      reserve: { icon: BadgeCheck, onClick: () => go("reserve") },
      pre_qualified: { icon: DollarSign, onClick: () => go("todays-price") },
      apply_financing: { icon: DollarSign, onClick: () => go("todays-price") },
      check_availability: { icon: CheckCircle2, onClick: () => go("check-availability") },
      send_to_phone: { icon: Send, onClick: handleShare },
      save_vehicle: { icon: Bookmark, onClick: handleSave },
      share_vehicle: { icon: Upload, onClick: handleShare },
      directions: { icon: MapPin, onClick: () => openPanel("visit-dealer") },
      email_dealer: { icon: Send, onClick: () => go("contact") },
      chat: { icon: MessageSquare, onClick: () => go("contact") },
      schedule_service: { icon: Clock, onClick: () => go("contact") },
      payment_options: { icon: DollarSign, onClick: () => go("todays-price") },
      calculate_payment: { icon: DollarSign, onClick: () => go("todays-price") },
    };
    return map[k] || { icon: CheckCircle2, onClick: () => go("check-availability") };
  };

  const hasVideo = Array.isArray(listing.videos) && listing.videos.length > 0;
  const heroImg = gallery[idx] || gallery[0] || listing.hero_image_url || "";

  const swipeHero = (dir: number) => {
    if (!gallery.length) return;
    setIdx((i) => (i + dir + gallery.length) % gallery.length);
  };

  return (
    <div className="min-h-screen pb-28 xl:pb-0" style={{ background: BG, color: NAVY }}>
      <Helmet>
        <title>{listing.ymm ? `${listing.ymm} — Vehicle Passport` : "Vehicle Passport"}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Helmet>

      {/* ── Compact header (mobile / tablet < xl) ──────────────────── */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b xl:hidden" style={{ borderColor: BORDER }}>
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
            <button aria-label="More" onClick={() => go("contact")} className="h-9 w-9 grid place-items-center rounded-full hover:bg-slate-50">
              <MoreHorizontal className="w-[18px] h-[18px]" style={{ color: NAVY }} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile / tablet column (< xl) — the approved mobile V3, unchanged ── */}
      <div className="max-w-lg mx-auto xl:hidden">

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
          <button onClick={() => go("todays-price")} className="w-full rounded-2xl px-4 py-4 flex items-center gap-3 border" style={{ background: "#EFF6FF", borderColor: "#BFDBFE" }}>
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

      {/* ══ Intelligence-first desktop (≥ xl / 1280px) ═══════════════════════
          Two-column outer shell: a wide intelligence WORKSPACE + a sticky
          customer ACTION CENTER. Gallery + identity split only the top hero.
          Verification and market span the workspace. Detail modules open the
          SAME V3 drawers (openPanel) the mobile passport uses — no V2 routes.
          Reuses the identical governed data (d / listing) — no second fetch,
          no separate desktop data model. Hidden below xl so mobile V3 is
          byte-for-byte unchanged. */}
      {(() => {
        const vcats = [
          { label: "VIN", done: !!listing.vin, material: true },
          { label: "Title & Brand", done: d.cleanTitle, material: true },
          { label: "Recall", done: !!listing.recall_status || d.recallClear, material: true },
          { label: "Vehicle History", done: d.ownerCount != null || d.accidentCount != null || d.cleanTitle, material: false },
          { label: "Market Data", done: d.marketAvg != null, material: false },
          { label: "Warranty", done: !!d.warrantyStr, material: false },
          { label: "Service History", done: d.serviceCount > 0, material: false },
        ];
        const vDone = vcats.filter((c) => c.done).length;
        const vTotal = vcats.length;
        const vMaterialPending = vcats.some((c) => c.material && !c.done);
        const specChips = [
          listing.mileage != null ? `${listing.mileage.toLocaleString()} mi` : null,
          ...d.highlights.slice(0, 3).map((h) => h.label),
        ].filter(Boolean) as string[];
        // Primary CTA is governed by vehicle state — a material check pending
        // downgrades "Reserve" to a confirmation request, never a hard sell.
        const primary = vMaterialPending
          ? { label: "Ask Dealer to Confirm", onClick: () => go("contact") }
          : { label: "Reserve This Vehicle", onClick: () => go("reserve") };
        const secondary = [
          { label: "Value My Trade", icon: RefreshCw, onClick: () => go("trade") },
          { label: "Schedule Test Drive", icon: Clock, onClick: () => go("test-drive") },
        ];
        const compact = [
          { label: "Call", icon: Phone, onClick: stickyAction("call").onClick },
          { label: "Text", icon: MessageSquare, onClick: stickyAction("text").onClick },
          { label: "Watch Price", icon: Bookmark, onClick: handleSave },
          { label: "Share", icon: Upload, onClick: handleShare },
        ];
        const label3 = "text-[11px] font-semibold uppercase tracking-wider";
        return (
          <div className="hidden xl:block" style={{ background: BG }}>
            {/* Desktop header */}
            <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b" style={{ borderColor: BORDER }}>
              <div className="max-w-[1520px] mx-auto h-16 px-6 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  {dealerLogo ? <img src={dealerLogo} alt={dealerName} className="h-8 max-w-[150px] object-contain" /> : <Logo variant="full" className="h-7" />}
                  {dealerName && <div className="pl-4 border-l min-w-0" style={{ borderColor: BORDER }}><div className="text-[13px] font-bold truncate" style={{ color: NAVY }}>{dealerName}</div>{d.dealerAddress && <div className="text-[11px] truncate" style={{ color: SUB }}>{d.dealerAddress}</div>}</div>}
                  <div className="pl-4 border-l min-w-0 hidden 2xl:block" style={{ borderColor: BORDER }}><div className="text-[13px] font-extrabold truncate" style={{ color: NAVY }}>{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</div>{listing.vin && <div className="text-[11px] font-mono" style={{ color: SUB }}>VIN {listing.vin}</div>}</div>
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
                    <div className="inline-flex items-center h-6 px-2.5 rounded-full text-[11px] font-bold uppercase tracking-wide" style={{ background: isNew ? "#EFF6FF" : "#F1F5F9", color: isNew ? BLUE : NAVY }}>{isNew ? "New" : condition === "cpo" ? "Certified" : "Used"}</div>
                    <h1 className="mt-2 text-[26px] leading-tight font-extrabold" style={{ color: NAVY }}>{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</h1>
                    {specChips.length > 0 && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]" style={{ color: SUB }}>{specChips.map((c, i) => <span key={i} className="inline-flex items-center gap-1.5">{i > 0 && <span className="w-1 h-1 rounded-full" style={{ background: "#CBD5E1" }} />}{c}</span>)}</div>}

                    <div className="mt-4 flex items-end justify-between gap-4">
                      <div><div className={label3} style={{ color: SUB }}>{d.priceLabel || "Our price"}</div><div className="text-[30px] font-extrabold tabular-nums leading-none mt-1" style={{ color: NAVY }}>{price != null ? fmt$(price) : "—"}</div></div>
                      <div className="text-right space-y-0.5">
                        {saveVs ? <div className="text-[13px] font-bold tabular-nums" style={{ color: GREEN }}>{fmt$(saveVs)} <span className="font-semibold" style={{ color: SUB }}>below MSRP</span></div> : null}
                        {d.belowMarket != null && d.belowMarket > 0 ? <div className="text-[13px] font-bold tabular-nums" style={{ color: GREEN }}>{fmt$(d.belowMarket)} <span className="font-semibold" style={{ color: SUB }}>below market value</span></div> : null}
                      </div>
                    </div>

                    {/* Buying-candidate strip — governed: pending material check is surfaced, never hidden. */}
                    <div className="mt-4 rounded-xl border p-3 flex items-center justify-between gap-3" style={{ borderColor: BORDER, background: "#F8FAFC" }}>
                      <div className="inline-flex items-center gap-2"><ShieldCheck className="w-4 h-4" style={{ color: GREEN }} /><span className="text-[13px] font-bold" style={{ color: NAVY }}>Strong Buying Candidate</span></div>
                      {vMaterialPending && <span className="inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: AMBER }}><Info className="w-3.5 h-3.5" /> 1 material check pending</span>}
                    </div>
                    {chips.length > 0 && (
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {chips.map((c, i) => (
                          <div key={i} className="rounded-xl border p-2.5" style={{ borderColor: BORDER }}>
                            <c.icon className="w-4 h-4" style={{ color: c.tone === "green" ? GREEN : BLUE }} />
                            <div className="mt-1 text-[11px] font-semibold leading-tight" style={{ color: NAVY }}>{c.label}</div>
                          </div>
                        ))}
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
                    {vcats.map((c) => (
                      <div key={c.label} className="rounded-xl border px-3 py-2.5 flex items-center gap-2" style={{ borderColor: BORDER, background: c.done ? "#fff" : "#FFFBEB" }}>
                        {c.done ? <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: GREEN }} /> : <Clock className="w-4 h-4 shrink-0" style={{ color: AMBER }} />}
                        <div className="min-w-0"><div className="text-[12px] font-semibold leading-tight truncate" style={{ color: NAVY }}>{c.label}</div><div className="text-[10px]" style={{ color: c.done ? SUB : AMBER }}>{c.done ? "Checked" : "Pending"}</div></div>
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
                      <div><div className={label3} style={{ color: SUB }}>Comparables</div><div className="mt-1 text-[22px] font-extrabold tabular-nums" style={{ color: NAVY }}>{d.marketMeta.similarCount ?? "—"}</div><div className="text-[11px]" style={{ color: SUB }}>{d.marketMeta.radius ? `within ${d.marketMeta.radius} mi` : "in the region"}</div></div>
                      <div><div className={label3} style={{ color: SUB }}>Below market</div><div className="mt-1 text-[22px] font-extrabold tabular-nums" style={{ color: d.belowMarket && d.belowMarket > 0 ? GREEN : NAVY }}>{d.belowMarket && d.belowMarket > 0 ? fmt$(d.belowMarket) : "—"}</div><div className="text-[11px]" style={{ color: SUB }}>vs normalized value</div></div>
                      <div><div className={label3} style={{ color: SUB }}>Market avg</div><div className="mt-1 text-[22px] font-extrabold tabular-nums" style={{ color: NAVY }}>{d.marketAvg != null ? fmt$(d.marketAvg) : "—"}</div><div className="text-[11px]" style={{ color: SUB }}>{d.marketCheckedAt ? "Live market data" : "—"}</div></div>
                    </div>
                  ) : (
                    <p className="mt-3 text-[13px]" style={{ color: SUB }}>Market comparison temporarily unavailable. Vehicle information and dealer pricing remain available.</p>
                  )}
                </section>

                {/* Progressive detail row — each opens a V3 drawer (not a V2 page). */}
                <section className="grid grid-cols-4 gap-4" aria-label="Vehicle details">
                  {[
                    { key: "factory-warranty" as const, icon: ShieldCheck, title: "Warranty", head: d.warrantyStr ? (d.warrantyExpired ? "Coverage ended" : "Factory warranty") : "Confirm with dealer", sub: d.warrantyStr || "Terms confirmed at delivery" },
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

                {/* Lower page — Why this vehicle checks out + dealer story. */}
                <section className="grid grid-cols-2 gap-5 items-start">
                  <div className={`${CARD} p-5`}>
                    <div className="text-[14px] font-extrabold" style={{ color: NAVY }}>Why This Vehicle Checks Out</div>
                    <ul className="mt-3 space-y-2">
                      {(d.whyBuy.length ? d.whyBuy.slice(0, 5) : ["Details confirmed at the dealership"]).map((b, i) => (
                        <li key={i} className="flex items-start gap-2 text-[13px]" style={{ color: NAVY }}><CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: GREEN }} /> {b}</li>
                      ))}
                    </ul>
                    <button onClick={() => go("great-buy")} className="mt-3 text-[13px] font-bold inline-flex items-center gap-1 hover:underline" style={{ color: BLUE }}>See full buying report <ChevronRight className="w-4 h-4" /></button>
                  </div>
                  {dealerName && (
                    <div className={`${CARD} overflow-hidden`} data-module="dealer">
                      {dt.storefrontUrl ? (
                        <div className="relative aspect-[2/1] w-full bg-slate-100">
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
              <aside className="sticky top-[88px] self-start" data-module="action-center">
                <div className={`${CARD} p-5`}>
                  <div className="text-[10px] font-black uppercase tracking-wider" style={{ color: SUB }}>Customer Action Center</div>
                  <div className="mt-3 text-[11px] font-bold uppercase tracking-wider" style={{ color: SUB }}>One price truth</div>
                  <div className="text-[30px] font-extrabold tabular-nums leading-none mt-1" style={{ color: NAVY }}>{price != null ? fmt$(price) : "—"}</div>
                  {d.priceBreakdown && (
                    <div className="mt-3 space-y-1 text-[12px]">
                      <div className="flex items-baseline justify-between"><span style={{ color: SUB }}>MSRP</span><span className="font-semibold tabular-nums" style={{ color: NAVY }}>{fmt$(d.priceBreakdown.msrp)}</span></div>
                      {d.priceBreakdown.lines.map((l) => <div key={l.key} className="flex items-baseline justify-between"><span style={{ color: SUB }}>{l.label}</span><span className="font-semibold tabular-nums" style={{ color: GREEN }}>−{fmt$(l.amount)}</span></div>)}
                      {d.priceBreakdown.docFee ? <div className="flex items-baseline justify-between"><span style={{ color: SUB }}>Conveyance / doc fee</span><span className="font-semibold tabular-nums" style={{ color: NAVY }}>{fmt$(d.priceBreakdown.docFee)}</span></div> : null}
                    </div>
                  )}
                  <p className="mt-3 text-[11px] leading-snug" style={{ color: SUB }}>Sales tax, title, registration and dealer-installed options are not included.</p>

                  <button onClick={primary.onClick} className="mt-4 w-full h-11 rounded-xl text-[14px] font-bold text-white" style={{ background: BLUE }}>{primary.label}</button>
                  {vMaterialPending && <div className="mt-2 rounded-lg border px-3 py-2 text-[11px] font-semibold inline-flex items-center gap-1.5 w-full" style={{ borderColor: "#FDE68A", background: "#FFFBEB", color: AMBER }}><Info className="w-3.5 h-3.5" /> 1 material check pending</div>}

                  <div className="mt-3 grid grid-cols-1 gap-2">
                    {secondary.map((s) => <button key={s.label} onClick={s.onClick} className="h-10 rounded-xl border inline-flex items-center justify-center gap-1.5 text-[13px] font-bold hover:bg-slate-50" style={{ borderColor: BORDER, color: BLUE }}><s.icon className="w-4 h-4" /> {s.label}</button>)}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {compact.map((c) => <button key={c.label} onClick={c.onClick} className="h-10 rounded-xl border inline-flex items-center justify-center gap-1.5 text-[12px] font-bold hover:bg-slate-50" style={{ borderColor: BORDER, color: NAVY }}><c.icon className="w-4 h-4" style={{ color: BLUE }} /> {c.label}</button>)}
                  </div>

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
                    <Lock className="w-3 h-3" /> Dealer intent intelligence is private to authorized dealer users.
                  </div>
                </div>
              </aside>
            </div>
          </div>
        );
      })()}

      {/* ── Sticky bottom CTA (mobile / tablet only — desktop uses the action center) ── */}
      {stickyCfg.enabled && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-white/95 backdrop-blur xl:hidden" style={{ borderColor: BORDER, paddingBottom: "env(safe-area-inset-bottom)" }}>
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
