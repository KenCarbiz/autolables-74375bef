import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Bookmark, MoreHorizontal, Upload, Phone, MessageSquare, Clock, DollarSign,
  ChevronDown, ChevronRight, Star, Sparkles, ShieldCheck, CheckCircle2, MapPin,
  RefreshCw, Send, BadgeCheck, Play, Package, Award, TrendingUp, X,
} from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { usePublicListing } from "@/hooks/usePublicListing";
import { derivePassport, fmt$ } from "@/lib/passportV2Data";
import { listingGallery } from "@/lib/photos";
import { packetVisible } from "@/lib/packetModules";
import { resolveStickyButtons, type StickyBottomButtons } from "@/lib/stickyButtons";
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
  const key = ((vehicleSlug || slug || "").trim()).toUpperCase();
  const navigate = useNavigate();
  const { listing, loading, notFound } = usePublicListing(key);

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

  usePassportEngagement(listing?.slug || key, activePanel, true);

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
  const go = (section: string) => navigate(`/v/${listing.slug || key}/${section}`);
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
    <div className="min-h-screen pb-28" style={{ background: BG, color: NAVY }}>
      <Helmet>
        <title>{listing.ymm ? `${listing.ymm} — Vehicle Passport` : "Vehicle Passport"}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Helmet>

      {/* ── Compact header ─────────────────────────────────────────── */}
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
            <button aria-label="More" onClick={() => go("contact")} className="h-9 w-9 grid place-items-center rounded-full hover:bg-slate-50">
              <MoreHorizontal className="w-[18px] h-[18px]" style={{ color: NAVY }} />
            </button>
          </div>
        </div>
      </header>

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

        {/* ── Dealer footer summary ────────────────────────────────── */}
        {dealerName && (
          <section className="px-4 pt-5 pb-6" data-module="dealer">
            <button onClick={() => openPanel("visit-dealer")} className={`${CARD} w-full text-left px-4 py-4`}>
              <div className="flex items-center gap-3">
                {dealerLogo ? (
                  <img src={dealerLogo} alt="" className="h-9 max-w-[120px] object-contain" loading="lazy" decoding="async" />
                ) : (
                  <span className="h-9 w-9 grid place-items-center rounded-lg" style={{ background: "#F1F5F9" }}><MapPin className="w-4 h-4" style={{ color: SUB }} /></span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold truncate" style={{ color: NAVY }}>{dealerName}</div>
                  <div className="text-[12px] truncate" style={{ color: SUB }}>{d.dealerAddress || d.dealerPhone || "Visit dealer"}</div>
                </div>
                <ChevronRight className="w-4 h-4 shrink-0" style={{ color: SUB }} />
              </div>
            </button>
          </section>
        )}
      </div>

      {/* ── Sticky bottom CTA ──────────────────────────────────────── */}
      {stickyCfg.enabled && (
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
            isPreview={false}
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
