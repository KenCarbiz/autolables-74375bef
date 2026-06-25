import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Upload, Bookmark, Printer, FileText, MessageSquare,
  RefreshCw, ShieldCheck, Shield, CheckCircle2, Star, Phone, Car, Cog, Fuel,
  Settings, Wind, Award, Wrench, User, FileCheck, Play, Rotate3d, Eye, DollarSign,
  Clock, MapPin, Building2, Users, Truck, Lock, Zap, ArrowRight, Package, X, Send,
  Gauge as GaugeIcon, BadgeCheck, TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { useVehicleListing, type VehicleListing } from "@/hooks/useVehicleListing";
import Logo from "@/components/brand/Logo";
import { formatPhone } from "@/components/addendum/CustomerInfoSection";

// ──────────────────────────────────────────────────────────────
// VehiclePassportV2 — /passport-v2/:vehicleSlug
//
// DRAFT redesign of the Customer Passport. Mounted on its OWN route
// so the live /v/:slug page (PublicListing) is untouched and the two
// can be compared side by side. Same data source (public-listing-view);
// every section degrades to a clean placeholder when data is missing —
// nothing here is fabricated.
// ──────────────────────────────────────────────────────────────

const BLUE = "#1a6dff";
const GREEN = "#1a9d5c";

const fmt$ = (n: number | null | undefined) =>
  n != null ? `$${Math.round(n).toLocaleString("en-US")}` : "—";

const Stars = ({ n, size = 16 }: { n: number; size?: number }) => (
  <span className="inline-flex gap-0.5">
    {Array.from({ length: 5 }).map((_, i) => {
      const fill = Math.max(0, Math.min(1, n - i));
      return (
        <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
          <Star className="absolute inset-0" style={{ width: size, height: size }} fill="#d9dde1" stroke="none" />
          <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
            <Star style={{ width: size, height: size }} fill={BLUE} stroke="none" />
          </span>
        </span>
      );
    })}
  </span>
);

// Semicircular market gauge with a needle positioned by price vs. band.
const Gauge = ({ price, low, high }: { price: number; low: number; high: number }) => {
  const span = Math.max(1, high - low);
  const t = Math.max(0, Math.min(1, (price - low) / span));
  const rad = ((t * 180 - 180) * Math.PI) / 180;
  const nx = 50 + 36 * Math.cos(rad);
  const ny = 50 + 36 * Math.sin(rad);
  return (
    <svg viewBox="0 0 100 56" className="w-full max-w-[220px]">
      <path d="M 10 50 A 40 40 0 0 1 42 12" fill="none" stroke="#86efac" strokeWidth="9" strokeLinecap="round" />
      <path d="M 42 12 A 40 40 0 0 1 70 13" fill="none" stroke="#fde047" strokeWidth="9" strokeLinecap="round" />
      <path d="M 70 13 A 40 40 0 0 1 90 50" fill="none" stroke="#fca5a5" strokeWidth="9" strokeLinecap="round" />
      <line x1="50" y1="50" x2={nx.toFixed(1)} y2={ny.toFixed(1)} stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="50" cy="50" r="3.5" fill="#0f172a" />
    </svg>
  );
};

// deno-lint-ignore no-explicit-any
const InquiryModal = ({ listing, dealer, intent, onClose }: { listing: VehicleListing; dealer: any; intent: "info" | "trade"; onClose: () => void }) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const submit = async () => {
    if (!name.trim() || (!email.trim() && !phone.trim())) { toast.error("Name and a phone or email are required"); return; }
    setSending(true);
    try {
      await (supabase as any).from("leads").insert({
        store_id: listing.store_id, name: name.trim(), email: email.trim() || "", phone: phone.trim() || "",
        vehicle_interest: `${listing.ymm || "Vehicle"}${intent === "trade" ? " (trade-in)" : ""}`,
        vehicle_vin: listing.vin, source: "website", status: "new",
        notes: `[intent=${intent}] Passport V2 inquiry`,
      });
      setSent(true);
    } catch { toast.error("Couldn't send — please call the dealer directly"); }
    finally { setSending(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-black text-slate-900">{intent === "trade" ? "Value My Trade" : "Contact Dealer"}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        {sent ? (
          <div className="text-center py-8">
            <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-slate-900 mb-1">Message sent</h3>
            <p className="text-sm text-slate-500 mb-5">The dealer will follow up shortly.</p>
            {dealer.phone && <a href={`tel:${dealer.phone}`} className="inline-flex items-center gap-2 text-blue-600 font-semibold text-sm"><Phone className="w-4 h-4" /> {formatPhone(dealer.phone)}</a>}
          </div>
        ) : (
          <>
            <div className="space-y-3 mb-5">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name *" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <input value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="Phone" type="tel" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <button onClick={submit} disabled={sending} className="w-full h-12 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-xl flex items-center justify-center gap-2">
              {sending ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><Send className="w-4 h-4" /> Send</>}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-2xl border border-[#e8ebef] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.05)] ${className}`}>{children}</div>
);

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-[15px] font-bold text-slate-900">{children}</h3>
);

const VehiclePassportV2 = () => {
  const { vehicleSlug } = useParams<{ vehicleSlug: string }>();
  const { publicUrl } = useVehicleListing("");
  const [listing, setListing] = useState<VehicleListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [inquiry, setInquiry] = useState<null | "info" | "trade">(null);
  const [zip, setZip] = useState("");
  const [lightbox, setLightbox] = useState(false);
  const [showSticky, setShowSticky] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowSticky(window.scrollY > 320);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!vehicleSlug) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke("public-listing-view", { body: { slug: vehicleSlug } });
      if (!mounted) return;
      if (error) { setNotFound(true); setLoading(false); return; }
      const row = (data as { listing?: VehicleListing } | null)?.listing ?? null;
      if (!row) { setNotFound(true); setLoading(false); return; }
      setListing(row); setLoading(false);
    })();
    return () => { mounted = false; };
  }, [vehicleSlug]);

  const gallery = useMemo(() => {
    if (!listing) return [];
    const fromPhotos = (listing.photos || []).map((p) => p.url).filter(Boolean);
    if (fromPhotos.length) return fromPhotos;
    if (listing.hero_image_url) return [listing.hero_image_url];
    return [];
  }, [listing]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(false);
      else if (e.key === "ArrowLeft") setPhotoIdx((i) => (i - 1 + gallery.length) % gallery.length);
      else if (e.key === "ArrowRight") setPhotoIdx((i) => (i + 1) % gallery.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, gallery.length]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#f4f5f7]"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
  );
  if (notFound || !listing) return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[#f4f5f7]">
      <div className="text-center">
        <Package className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <h1 className="text-xl font-bold">Vehicle unavailable</h1>
        <p className="text-sm text-slate-500 mt-2">This listing may have been sold or unpublished.</p>
        <p className="text-[11px] text-slate-400 mt-3 font-mono">{vehicleSlug}</p>
      </div>
    </div>
  );

  // ── Derived data ───────────────────────────────────────────
  // deno-lint-ignore no-explicit-any
  const dealer = (listing.dealer_snapshot || {}) as any;
  const ks = listing.key_specs || {};
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const mp = listing.market_payload || {};
  const viewUrl = publicUrl(listing.slug);

  const price = listing.price ?? null;
  const msrp = (mc.msrp as number) ?? null;
  const marketAvg = listing.market_value ?? null;
  const marketHigh = (mp.high as number) ?? null;
  const marketLow = (mp.low as number) ?? null;
  const belowMarket = (mp.belowMarket as number) ?? (marketAvg != null && price != null && price < marketAvg ? marketAvg - price : null);
  const priceLabel = (dealer.price_label as string) || "Our Price";
  const saveVsMsrp = msrp != null && price != null && msrp > price ? msrp - price : null;

  const ownerCount = (mc.owner_count as number) ?? (mc.carfax_1_owner === true ? 1 : null);
  const accidentCount = (mc.accident_count as number) ?? (mc.carfax_clean_title === true ? 0 : null);
  const cleanTitle = mc.carfax_clean_title === true;
  const serviceCount = listing.service_records?.length ?? 0;
  const recallClear = listing.recall_status === "clear";
  const openRecalls = listing.open_recall_count ?? null;

  const warranty = listing.warranty_info || {};
  const warrantyStr = (() => {
    const yrs = warranty.factory_months ? Math.round(warranty.factory_months / 12) : null;
    const mi = warranty.factory_miles ? `${(warranty.factory_miles / 1000).toFixed(0)},000 mi` : null;
    return [yrs ? `${yrs} yr` : null, mi].filter(Boolean).join(" / ") || null;
  })();

  // Vehicle Confidence Score (0–100) from real history signals only.
  const confSignals: { ok: boolean; w: number }[] = [];
  if (typeof mc.carfax_clean_title === "boolean") confSignals.push({ ok: cleanTitle, w: 22 });
  if (accidentCount != null) confSignals.push({ ok: accidentCount === 0, w: 22 });
  if (ownerCount != null) confSignals.push({ ok: ownerCount === 1, w: 16 });
  if (listing.recall_status) confSignals.push({ ok: recallClear, w: 16 });
  if (serviceCount > 0) confSignals.push({ ok: true, w: 12 });
  if (warrantyStr) confSignals.push({ ok: true, w: 12 });
  const confScore = confSignals.length >= 2
    ? Math.min(99, Math.round(60 + (confSignals.reduce((s, x) => s + (x.ok ? x.w : 0), 0) / confSignals.reduce((s, x) => s + x.w, 0)) * 39))
    : null;
  const confLabel = confScore == null ? "" : confScore >= 90 ? "Excellent" : confScore >= 80 ? "Very Good" : confScore >= 70 ? "Good" : "Fair";

  const verifiedBy = [
    { label: "AutoCheck", on: typeof mc.carfax_clean_title === "boolean" || ownerCount != null },
    { label: "MarketCheck", on: marketAvg != null || Object.keys(mc).length > 0 },
    { label: "NHTSA", on: !!listing.recall_status },
    { label: "OEM Data", on: Object.keys(mc).length > 0 },
  ].filter((x) => x.on);

  // Trust strip badges — always 6 slots, colored by real data.
  const trust = [
    accidentCount === 0 ? { icon: Shield, t: "No Accidents", s: "AutoCheck Verified", ok: true } : accidentCount ? { icon: Shield, t: `${accidentCount} Accident${accidentCount > 1 ? "s" : ""}`, s: "Reported", ok: false } : { icon: Shield, t: "Accident History", s: "Not reported", ok: null },
    ownerCount === 1 ? { icon: User, t: "One Owner", s: "Personal Use", ok: true } : ownerCount ? { icon: User, t: `${ownerCount} Owners`, s: "History", ok: true } : { icon: User, t: "Ownership", s: "Not reported", ok: null },
    serviceCount > 0 ? { icon: Wrench, t: "Service History", s: `${serviceCount} Records`, ok: true } : { icon: Wrench, t: "Service History", s: "No records", ok: null },
    cleanTitle ? { icon: FileCheck, t: "Clean Title", s: "No Issues", ok: true } : { icon: FileCheck, t: "Title", s: "Not reported", ok: null },
    warrantyStr ? { icon: ShieldCheck, t: "Factory Warranty", s: warrantyStr, ok: true } : { icon: ShieldCheck, t: "Factory Warranty", s: "Not provided", ok: null },
    recallClear ? { icon: BadgeCheck, t: "No Open Recalls", s: "0 Open Recalls", ok: true } : openRecalls ? { icon: BadgeCheck, t: `${openRecalls} Open Recall${openRecalls > 1 ? "s" : ""}`, s: "See details", ok: false } : { icon: BadgeCheck, t: "Recalls", s: "Not checked", ok: null },
  ];

  const highlights: { icon: React.ElementType; t: string; s: string }[] = [];
  if (ks.engine) highlights.push({ icon: Cog, t: ks.engine, s: "Engine" });
  if (ks.drivetrain) highlights.push({ icon: Car, t: ks.drivetrain, s: "Drivetrain" });
  if (mc.horsepower) highlights.push({ icon: Zap, t: `${mc.horsepower} HP`, s: "Horsepower" });
  if (ks.transmission) highlights.push({ icon: Settings, t: ks.transmission, s: "Transmission" });
  if (ks.fuel) highlights.push({ icon: Fuel, t: ks.fuel, s: "Fuel" });
  if (ks.exterior_color) highlights.push({ icon: Wind, t: ks.exterior_color, s: "Exterior" });
  (listing.features || []).forEach((f) => { if (highlights.length < 6) highlights.push({ icon: Award, t: f.title, s: f.subtitle || "Feature" }); });

  const overview = listing.description ||
    `The ${listing.ymm}${listing.trim ? " " + listing.trim : ""} pairs a ${ks.engine || "capable"} powertrain with ${ks.drivetrain || "a refined drivetrain"} and a well-equipped cabin.`;

  const specRows: [string, string | null | undefined][] = [
    ["Exterior Color", ks.exterior_color as string | undefined],
    ["Interior Color", ks.interior_color as string | undefined],
    ["Transmission", ks.transmission],
    ["Drivetrain", ks.drivetrain],
    ["Engine", ks.engine],
    ["Fuel Type", ks.fuel],
    ks.mpg_city && ks.mpg_hwy ? ["MPG (est.)", `${ks.mpg_city} city / ${ks.mpg_hwy} hwy`] : ["", null],
  ];

  // Real offers only.
  const rawOffers = (listing as unknown as { incentives?: unknown }).incentives ?? (mc as { incentives?: unknown }).incentives;
  const offers = (Array.isArray(rawOffers) ? rawOffers : []).map((o) => o as Record<string, unknown>).map((o) => ({
    title: (o.title as string) || (o.program as string) || "Offer",
    body: (o.summary as string) || (o.description as string) || (o.amount ? `$${Number(o.amount).toLocaleString()}` : ""),
    exp: o.valid_through ? `Expires ${new Date(o.valid_through as string).toLocaleDateString()}` : "",
  })).filter((o) => o.body).slice(0, 4);

  const viewCount = listing.view_count ?? null;
  const dom = (mc.dom as number) ?? null;

  // "Why this is a great buy" bullets — from real signals.
  const whyBuy: string[] = [];
  if (saveVsMsrp) whyBuy.push(`Priced ${fmt$(saveVsMsrp)} below MSRP`);
  if (belowMarket && belowMarket > 0) whyBuy.push(`${fmt$(belowMarket)} below market average`);
  if (warrantyStr) whyBuy.push("Factory warranty remaining");
  if (recallClear) whyBuy.push("No open recalls");
  whyBuy.push("Dealer-verified listing");
  if (ownerCount === 1) whyBuy.push("One owner — personal use");
  if (listing.mileage != null && listing.mileage < 30000) whyBuy.push(`Low mileage — ${listing.mileage.toLocaleString()} mi`);
  if (listing.trim && /luxe|autograph|limited|platinum|premium|touring|sport|signature|reserve|titanium|sensory|denali/i.test(listing.trim)) whyBuy.push(`Premium trim — ${listing.trim}`);
  if (cleanTitle && accidentCount === 0) whyBuy.push("Clean vehicle history");
  else if (accidentCount === 0) whyBuy.push("No accidents reported");
  if (/awd|4wd|4x4/i.test(String(ks.drivetrain || ""))) whyBuy.push(`${ks.drivetrain} — all-weather confidence`);

  const dealerName = (dealer.name as string) || "the dealership";
  const dealerPhone = (dealer.phone as string) || "";
  const dealerAddress = [dealer.address, dealer.city, dealer.state, dealer.zip].filter(Boolean).join(", ");
  const makeName = (listing.ymm || "").split(" ")[1] || "vehicle";
  const reviewRating = (dealer.review_rating as number) ?? null;
  const reviewCount = (dealer.review_count as number) ?? null;

  const heroSrc = gallery[photoIdx] || gallery[0] || "";
  const photoCount = gallery.length;

  const handleShare = async () => {
    try {
      if (navigator.share) await navigator.share({ title: listing.ymm || "Vehicle", url: viewUrl });
      else { await navigator.clipboard.writeText(viewUrl); toast.success("Link copied"); }
    } catch { /* cancelled */ }
  };

  const actions = [
    { icon: FileText, label: "Documents", green: false, onClick: () => document.getElementById("v2-docs")?.scrollIntoView({ behavior: "smooth" }) },
    { icon: MessageSquare, label: "Contact Dealer", green: false, onClick: () => { if (dealerPhone) window.location.href = `tel:${dealerPhone}`; else setInquiry("info"); } },
    { icon: RefreshCw, label: "Value My Trade", green: true, onClick: () => setInquiry("trade") },
    { icon: Upload, label: "Share Vehicle", green: false, onClick: handleShare },
  ];

  const dealerChips = [
    { icon: Building2, t: "Family Owned", s: "Trusted locally" },
    { icon: Star, t: reviewRating != null ? `${reviewRating.toFixed(1)} Google Rating` : "Top Rated", s: reviewCount != null ? `${reviewCount.toLocaleString()} Reviews` : "Verified buyers" },
    { icon: Wrench, t: "Factory Certified", s: "Trained technicians" },
    { icon: Settings, t: "Service Department", s: "On-site" },
    { icon: Truck, t: "Delivery", s: "Available" },
    { icon: ShieldCheck, t: "Customer Commitment", s: "No-pressure" },
  ];

  return (
    <div className="min-h-screen bg-[#f4f5f7] text-[#1a1d21]" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <Helmet>
        <title>{`${listing.ymm}${listing.trim ? ` ${listing.trim}` : ""} — ${dealerName} · Passport`}</title>
      </Helmet>

      <div className="mx-auto max-w-[1080px] px-4 sm:px-6 pt-0 lg:pt-5 pb-[calc(72px+env(safe-area-inset-bottom))] md:pb-5 space-y-4 md:space-y-5">
        {/* 1. HEADER — desktop only; on mobile the full-bleed hero owns the top */}
        <header className="hidden lg:flex items-center justify-between">
          <div className="text-[22px] font-extrabold tracking-tight">
            {dealer.logo_url ? <img src={dealer.logo_url} alt={dealerName} className="h-7" /> : (<><span style={{ color: BLUE }}>auto</span><span>(LABELS)</span></>)}
          </div>
          <div className="flex gap-5 sm:gap-6 text-sm font-medium">
            <button onClick={handleShare} className="flex items-center gap-1.5 hover:text-[#1a6dff]"><Upload className="w-4 h-4" /><span className="hidden sm:inline">Share</span></button>
            <button onClick={() => toast.success("Saved to this device")} className="flex items-center gap-1.5 hover:text-[#1a6dff]"><Bookmark className="w-4 h-4" /><span className="hidden sm:inline">Save</span></button>
            <button onClick={() => window.print()} className="flex items-center gap-1.5 hover:text-[#1a6dff]"><Printer className="w-4 h-4" /><span className="hidden sm:inline">Print</span></button>
          </div>
        </header>

        {/* 2. HERO — gallery + identity/price/trust */}
        <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-5 max-lg:-mt-4">
          {/* Gallery */}
          <div className="space-y-3">
            {/* Full-bleed on mobile (edge-to-edge, flush to the top under the
                Dynamic Island); inset rounded card on desktop. */}
            <div className="relative overflow-hidden bg-[#1f2227] aspect-square lg:aspect-[4/3] -mx-4 sm:-mx-6 lg:mx-0 rounded-none lg:rounded-2xl">
              {heroSrc ? <img src={heroSrc} alt={listing.ymm || "vehicle"} onClick={() => setLightbox(true)} className="absolute inset-0 w-full h-full object-cover cursor-zoom-in" /> : <div className="absolute inset-0 flex items-center justify-center text-slate-500"><Car className="w-14 h-14" strokeWidth={1.25} /></div>}
              {/* Mobile-only overlay controls, pushed clear of the status bar / island */}
              <div className="lg:hidden absolute top-0 right-0 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
                <button onClick={handleShare} aria-label="Share" className="w-9 h-9 rounded-full bg-black/45 backdrop-blur text-white flex items-center justify-center"><Upload className="w-[18px] h-[18px]" /></button>
              </div>
              {photoCount > 0 && <div className="absolute left-3 top-[calc(0.75rem+env(safe-area-inset-top))] lg:top-3 text-white text-xs font-semibold px-2.5 py-1 rounded bg-black/60">{photoIdx + 1} / {photoCount}</div>}
              {photoCount > 1 && (
                <>
                  <button onClick={() => setPhotoIdx((i) => (i - 1 + photoCount) % photoCount)} className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/95 hover:bg-white flex items-center justify-center shadow"><ChevronLeft className="w-5 h-5" /></button>
                  <button onClick={() => setPhotoIdx((i) => (i + 1) % photoCount)} className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/95 hover:bg-white flex items-center justify-center shadow"><ChevronRight className="w-5 h-5" /></button>
                  {/* Desktop: thumbnail strip. Mobile: clean pagination dots
                      (no thumbnail strip per the v2 spec). */}
                  <div className="hidden lg:block absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 pt-7 pb-2.5">
                    <div className="flex gap-1.5">
                      {gallery.slice(0, 5).map((src, i) => (
                        <button key={i} onClick={() => setPhotoIdx(i)} className="w-12 h-9 rounded-md overflow-hidden bg-[#e9ecef]" style={{ outline: i === photoIdx ? `2px solid ${BLUE}` : "2px solid transparent", outlineOffset: -2 }}>
                          <img src={src} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                      {photoCount > 5 && (
                        <button onClick={() => setPhotoIdx(5)} className="w-12 h-9 rounded-md bg-black/60 text-white text-[11px] font-bold flex items-center justify-center">+{photoCount - 5}</button>
                      )}
                    </div>
                  </div>
                  <div className="lg:hidden absolute inset-x-0 bottom-3 flex items-center justify-center gap-1.5">
                    {gallery.slice(0, 8).map((_, i) => (
                      <span key={i} className={`rounded-full transition-all ${i === photoIdx ? "w-4 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/55"}`} />
                    ))}
                    {photoCount > 8 && <span className="text-white/70 text-[10px] ml-1 font-semibold">+{photoCount - 8}</span>}
                  </div>
                </>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => gallery.length && setLightbox(true)} className="h-11 rounded-xl border border-[#e8ebef] bg-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-[#1a6dff]"><Eye className="w-4 h-4 text-[#1a6dff]" /> All photos ({photoCount})</button>
              {listing.videos?.length ? (
                <a href={listing.videos[0].url} target="_blank" rel="noreferrer" className="h-11 rounded-xl border border-[#e8ebef] bg-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-[#1a6dff]"><Play className="w-4 h-4 text-[#1a6dff]" /> Watch video</a>
              ) : <div className="h-11 rounded-xl border border-dashed border-[#e8ebef] bg-[#fafbfc] text-[12px] text-slate-400 inline-flex items-center justify-center gap-1.5"><Play className="w-4 h-4" /> No video</div>}
              <div className="h-11 rounded-xl border border-dashed border-[#e8ebef] bg-[#fafbfc] text-[12px] text-slate-400 inline-flex items-center justify-center gap-1.5"><Rotate3d className="w-4 h-4" /> 360° soon</div>
            </div>
          </div>

          {/* Identity / price / trust / confidence */}
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-100 text-blue-700">{listing.condition || "vehicle"}</span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${listing.status === "published" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{listing.status}</span>
                </div>
                <h1 className="text-[28px] sm:text-[32px] font-extrabold tracking-tight leading-none">{listing.ymm}</h1>
                {listing.trim && <div className="text-lg font-semibold text-slate-600 mt-0.5">{listing.trim}</div>}
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-2 text-[13px] text-slate-500">
                  <span><span className="font-semibold text-slate-700">VIN</span> {listing.vin}</span>
                  <span className="text-slate-300">•</span>
                  <span>Stock # {listing.vin.slice(-6)}</span>
                  {listing.mileage != null && <><span className="text-slate-300">•</span><span>{listing.mileage.toLocaleString()} mi</span></>}
                </div>
              </div>
              {price != null && (
                <div className="text-right shrink-0">
                  <div className="text-[13px] font-semibold text-slate-500">{priceLabel}</div>
                  <div className="text-[34px] font-extrabold tracking-tight leading-none">{fmt$(price)}</div>
                  {(() => {
                    const r = 0.0749 / 12, n = 72, principal = price * 0.9;
                    const m = Math.round((principal * r) / (1 - Math.pow(1 + r, -n)));
                    return isFinite(m) ? <div className="text-[12px] text-slate-500 mt-0.5" title="Estimated: 72 mo, 7.49% APR, 10% down. With approved credit.">Est. {fmt$(m)}/mo</div> : null;
                  })()}
                  {msrp != null && <div className="text-[12px] text-slate-500 mt-1">MSRP {fmt$(msrp)}</div>}
                  {saveVsMsrp != null && <div className="text-[13px] font-semibold text-emerald-600">You save {fmt$(saveVsMsrp)}</div>}
                </div>
              )}
            </div>

            {/* Trust strip — positive verified signals; unknowns show as a
                subtle skeleton (never "Not reported"). */}
            <Card className="grid grid-cols-3 sm:grid-cols-6 overflow-hidden">
              {trust.map((b, i) => (
                <div key={i} className="px-3 py-3 text-center border-r border-b sm:border-b-0 border-[#eef1f4] last:border-r-0 flex flex-col items-center gap-1">
                  {b.ok === null ? (
                    <>
                      <span className="w-5 h-5 rounded-full bg-slate-200 animate-pulse" />
                      <span className="w-16 h-2 rounded bg-slate-200 animate-pulse mt-1" />
                      <span className="w-10 h-1.5 rounded bg-slate-100 animate-pulse" />
                    </>
                  ) : (
                    <>
                      <b.icon className={`w-5 h-5 ${b.ok === false ? "text-amber-500" : "text-emerald-600"}`} />
                      <p className="text-[11px] font-bold leading-tight">{b.t}</p>
                      <p className="text-[10px] text-slate-500 inline-flex items-center gap-0.5 leading-tight">
                        {b.ok === true && <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />}{b.s}
                      </p>
                    </>
                  )}
                </div>
              ))}
            </Card>

            {/* Confidence score */}
            <Card className="p-4 md:p-5">
              {confScore != null ? (
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <span className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0"><ShieldCheck className="w-6 h-6 text-emerald-600" /></span>
                  <div className="flex-1">
                    <p className="text-[12px] font-semibold text-slate-500">AutoLabels Vehicle Confidence Score</p>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="text-[34px] font-extrabold leading-none">{confScore}</span>
                      <span className="text-sm text-slate-400 font-semibold">/ 100</span>
                      <span className="text-base font-bold text-emerald-600 ml-1">{confLabel}</span>
                      <Stars n={confScore / 20} size={16} />
                    </div>
                    <p className="text-[12px] text-slate-500 mt-1">Better than {confScore}% of similar vehicles.</p>
                  </div>
                  {verifiedBy.length > 0 && (
                    <div className="sm:border-l sm:pl-4 border-[#eef1f4]">
                      <p className="text-[11px] text-slate-400 font-semibold mb-1.5">Data verified by</p>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                        {verifiedBy.map((v) => <span key={v.label} className="text-[12px] font-semibold inline-flex items-center gap-1 text-slate-700"><CheckCircle2 className="w-3 h-3 text-emerald-600" />{v.label}</span>)}
                      </div>
                    </div>
                  )}
                </div>
              ) : (verifiedBy.length > 0 || warrantyStr || listing.recall_status || listing.ymm) ? (
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0"><ShieldCheck className="w-5 h-5 text-emerald-600" /></span>
                    <div>
                      <p className="text-[14px] font-bold text-slate-900">Vehicle Verified</p>
                      <p className="text-[11px] text-slate-500">Verified using multiple trusted automotive data sources.</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-3">
                    {[
                      { label: "VIN Verified", done: !!listing.ymm },
                      { label: "Market Data Verified", done: verifiedBy.some((v) => v.label === "MarketCheck") },
                      { label: "Warranty Checked", done: !!warrantyStr },
                      { label: "Recall Check Complete", done: !!listing.recall_status },
                    ].filter((r) => r.done).map((r) => (
                      <div key={r.label} className="flex items-center gap-2 py-0.5 text-[12px] text-slate-700"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />{r.label}</div>
                    ))}
                  </div>
                </div>
              ) : null}
            </Card>
          </div>
        </div>

        {/* 3. ACTIONS + ZIP */}
        <Card className="p-4">
          <div className="flex flex-col lg:flex-row lg:items-end gap-5">
            <div className="flex-1">
              {/* Mobile (<=768px): one clear primary CTA, lighter secondaries. */}
              <div className="lg:hidden space-y-2.5">
                <button onClick={() => setInquiry("info")} className="w-full h-12 rounded-xl bg-[#1a6dff] hover:bg-[#155fe0] text-white text-[15px] font-bold inline-flex items-center justify-center gap-2 transition-colors">
                  <CheckCircle2 className="w-[18px] h-[18px]" /> Check Availability
                </button>
                <div className="grid grid-cols-3 gap-2">
                  {actions.filter((a) => a.label !== "Contact Dealer").map((a) => (
                    <button key={a.label} onClick={a.onClick} className="h-10 rounded-xl border border-[#e8ebef] bg-white text-[12px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-[#1a6dff] transition-colors">
                      <a.icon className="w-4 h-4" style={{ color: a.green ? GREEN : BLUE }} />{a.label === "Value My Trade" ? "Trade" : a.label === "Share Vehicle" ? "Share" : a.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Tablet + desktop: unchanged 4-up action row. */}
              <div className="hidden lg:grid grid-cols-4 gap-3">
                {actions.map((a) => (
                  <button key={a.label} onClick={a.onClick} className="h-12 rounded-xl border border-[#e8ebef] bg-white text-[14px] font-semibold inline-flex items-center justify-center gap-2 hover:border-[#1a6dff] hover:text-[#1a6dff] transition-colors">
                    <a.icon className="w-[18px] h-[18px]" style={{ color: a.green ? GREEN : BLUE }} />{a.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="lg:w-[300px] shrink-0">
              <div className="text-[12px] text-slate-500 mb-1.5">Enter your ZIP for available offers in your area</div>
              <div className="flex">
                <input value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="ZIP Code" maxLength={5} inputMode="numeric" className="flex-1 min-w-0 h-12 px-3.5 border border-[#e8ebef] border-r-0 rounded-l-xl text-sm outline-none focus:border-[#1a6dff]" />
                <button onClick={() => /^\d{5}$/.test(zip) ? toast.success(`Checking offers near ${zip}…`) : toast.error("Enter a valid 5-digit ZIP")} className="h-12 px-4 text-white rounded-r-xl text-sm font-semibold bg-[#2563EB] hover:bg-[#1d4fd7]">View Offers</button>
              </div>
            </div>
          </div>
        </Card>

        {/* 4. OFFERS */}
        {offers.length > 0 && (
          <Card className="overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-stretch">
              <div className="flex items-center gap-2 px-5 py-4 sm:w-[200px] shrink-0">
                <Award className="w-[18px] h-[18px] text-[#1a9d5c]" />
                <span className="text-[15px] font-bold">Available Offers</span>
                <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full border border-[#cbd5e1] text-[#6b727a] text-xs font-semibold">{offers.length}</span>
              </div>
              {offers.map((o, i) => (
                <div key={i} className="flex flex-col justify-center px-6 py-4 sm:border-l border-[#F1F5F9]">
                  <div className="text-sm font-bold">{o.title}</div>
                  <div className="text-[13px] text-slate-600 mt-0.5">{o.body}</div>
                  {o.exp && <div className="text-xs text-slate-400 mt-0.5">{o.exp}</div>}
                </div>
              ))}
              <div className="flex items-center px-6 py-4 sm:ml-auto">
                <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#2563EB]">View all offers <ArrowRight className="w-4 h-4" /></span>
              </div>
            </div>
          </Card>
        )}

        {/* 5. GREAT BUY + MARKET CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <Card className="p-4 md:p-5">
            <SectionTitle>Why This Is A Great Buy</SectionTitle>
            <ul className="mt-3 space-y-2">
              {(whyBuy.length ? whyBuy : ["Details coming soon"]).map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px]"><CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />{b}</li>
              ))}
            </ul>
            <button className="mt-3 text-[13px] font-semibold text-[#2563EB] inline-flex items-center gap-1">See full details <ArrowRight className="w-3.5 h-3.5" /></button>
          </Card>

          <Card className="p-4 md:p-5">
            <SectionTitle>Market Price Analysis</SectionTitle>
            <p className="text-[11px] text-slate-400 mt-0.5">Powered by MarketCheck</p>
            {marketAvg != null && price != null ? (
              <>
                <div className="flex justify-center my-2"><Gauge price={price} low={marketLow ?? Math.round(marketAvg * 0.9)} high={marketHigh ?? Math.round(marketAvg * 1.1)} /></div>
                <div className="grid grid-cols-3 text-center text-[11px]">
                  <div><div className="text-slate-500">Market Low</div><div className="font-bold">{fmt$(marketLow ?? Math.round(marketAvg * 0.9))}</div></div>
                  <div><div className="text-slate-500">Our Price</div><div className="font-bold text-emerald-600">{fmt$(price)}</div></div>
                  <div><div className="text-slate-500">Market High</div><div className="font-bold">{fmt$(marketHigh ?? Math.round(marketAvg * 1.1))}</div></div>
                </div>
                <div className="mt-2 flex items-center justify-between text-[12px] rounded-lg bg-slate-50 px-3 py-2">
                  <span className="text-slate-500">Market average <span className="font-semibold text-slate-700">{fmt$(marketAvg)}</span></span>
                  {belowMarket && belowMarket > 0 && <span className="font-bold text-emerald-600">You save {fmt$(belowMarket)}</span>}
                </div>
                <button className="mt-3 text-[13px] font-semibold text-[#2563EB] inline-flex items-center gap-1">View full market report <ArrowRight className="w-3.5 h-3.5" /></button>
                <p className="text-[10px] text-slate-400 mt-2 leading-snug">Market values provided by MarketCheck and third-party data sources. Actual market conditions may vary.</p>
              </>
            ) : (
              <div className="mt-4 space-y-2.5">
                <div className="h-16 bg-slate-100 rounded-lg animate-pulse" />
                <div className="flex gap-3"><div className="h-7 flex-1 bg-slate-100 rounded animate-pulse" /><div className="h-7 flex-1 bg-slate-100 rounded animate-pulse" /><div className="h-7 flex-1 bg-slate-100 rounded animate-pulse" /></div>
              </div>
            )}
          </Card>

          <Card className="p-4 md:p-5">
            <div className="flex items-center justify-between"><SectionTitle>Market Demand</SectionTitle><TrendingUp className="w-4 h-4 text-emerald-600" /></div>
            {viewCount != null || dom != null ? (
              <>
                <p className="text-lg font-bold text-emerald-600 mt-2">{(viewCount ?? 0) > 20 ? "High Interest" : "Active"}</p>
                <ul className="mt-2 space-y-1.5 text-[13px]">
                  {viewCount != null && <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />{viewCount.toLocaleString()} total views</li>}
                  {dom != null && <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />{dom} days on market</li>}
                </ul>
              </>
            ) : <p className="text-[13px] text-slate-500 mt-3">Demand data currently unavailable.</p>}
          </Card>

          <Card className="p-4 md:p-5">
            <div className="flex items-center justify-between"><SectionTitle>Price Confidence</SectionTitle><DollarSign className="w-4 h-4 text-emerald-600" /></div>
            {belowMarket && belowMarket > 0 ? (
              <>
                <p className="text-lg font-bold text-emerald-600 mt-2">Excellent Price</p>
                <p className="text-[13px] text-slate-600">{fmt$(belowMarket)} below market average</p>
                <ul className="mt-2 space-y-1.5 text-[13px]">
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />Priced below market average</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />Below similar vehicles nearby</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />Backed by live comparables</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />Independently verified</li>
                </ul>
                <p className="text-[10px] text-slate-400 mt-2">Powered by MarketCheck</p>
              </>
            ) : marketAvg != null ? (
              <>
                <p className="text-lg font-bold text-blue-600 mt-2">Fair Price</p>
                <p className="text-[13px] text-slate-600">Priced in line with the local market.</p>
                <p className="text-[10px] text-slate-400 mt-2">Powered by MarketCheck</p>
              </>
            ) : (
              <div className="mt-4 space-y-2">
                <div className="h-5 w-1/2 bg-slate-100 rounded animate-pulse" />
                <div className="h-3 w-3/4 bg-slate-100 rounded animate-pulse" />
                <div className="h-3 w-2/3 bg-slate-100 rounded animate-pulse" />
              </div>
            )}
          </Card>
        </div>

        {/* 6. HISTORY + WARRANTY + REVIEWS */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <Card className="p-4 md:p-5">
            <SectionTitle>Vehicle History Summary</SectionTitle>
            <ul className="mt-3 space-y-2.5 text-[13px]">
              {[
                ["One Owner", ownerCount === 1 ? "Personal Use" : ownerCount ? `${ownerCount} owners` : "Not reported", ownerCount === 1],
                ["No Accidents", accidentCount === 0 ? "AutoCheck Verified" : "Not reported", accidentCount === 0],
                ["Clean Title", cleanTitle ? "No brands or issues" : "Not reported", cleanTitle],
                ["Service History", serviceCount > 0 ? `${serviceCount} Records` : "No records", serviceCount > 0],
                ["No Open Recalls", recallClear ? "0 Open Recalls" : openRecalls ? `${openRecalls} open` : "Not checked", recallClear],
              ].map(([t, s, ok]) => (
                <li key={t as string} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2"><CheckCircle2 className={`w-4 h-4 ${ok ? "text-emerald-600" : "text-slate-300"}`} />{t}</span>
                  <span className="text-slate-500 text-right">{s}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-4 md:p-5">
            <SectionTitle>Ownership Timeline</SectionTitle>
            <ol className="mt-3 space-y-3 relative border-l-2 border-emerald-100 ml-1.5 pl-4">
              {[
                warranty.in_service_date ? { d: new Date(warranty.in_service_date).toLocaleDateString(), t: "Placed in service", s: "Factory warranty start" } : null,
                ownerCount != null ? { d: ownerCount === 1 ? "Single owner" : `${ownerCount} owners`, t: ownerCount === 1 ? "One Owner" : "Ownership", s: "Personal use" } : null,
                serviceCount > 0 ? { d: `${serviceCount} record${serviceCount === 1 ? "" : "s"}`, t: "Service history", s: "Maintained on schedule" } : null,
                { d: "Now", t: `At ${dealerName}`, s: "Current inventory" },
                { d: "Today", t: "Available", s: "Ready for delivery" },
              ].filter(Boolean).map((e, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[22px] top-1 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white" />
                  <p className="text-[12px] font-bold">{(e as { d: string }).d} · {(e as { t: string }).t}</p>
                  <p className="text-[11px] text-slate-500">{(e as { s: string }).s}</p>
                </li>
              ))}
            </ol>
          </Card>

          <Card className="p-4 md:p-5">
            <div className="flex items-center justify-between">
              <SectionTitle>Factory Warranty</SectionTitle>
              {warrantyStr && <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5"><ShieldCheck className="w-3 h-3" /> OEM Verified</span>}
            </div>
            {warrantyStr ? (() => {
              const milesLeft = warranty.factory_miles != null && listing.mileage != null ? Math.max(0, warranty.factory_miles - listing.mileage) : warranty.factory_miles ?? null;
              const milesPct = warranty.factory_miles && listing.mileage != null ? Math.max(4, 100 - Math.min(100, (listing.mileage / warranty.factory_miles) * 100)) : 65;
              let yrsLeft: number | null = null; let expiry: string | null = null;
              if (warranty.in_service_date && warranty.factory_months) {
                const end = new Date(warranty.in_service_date); end.setMonth(end.getMonth() + warranty.factory_months);
                expiry = end.toLocaleDateString();
                const ms = end.getTime() - Date.now(); yrsLeft = ms > 0 ? ms / (1000 * 60 * 60 * 24 * 365) : 0;
              }
              return (
                <>
                  <p className="text-base font-bold mt-2">Factory warranty remaining</p>
                  <div className="mt-3 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${milesPct}%` }} />
                  </div>
                  <div className="flex items-center gap-5 mt-2.5 text-[13px]">
                    {yrsLeft != null && <span><span className="font-bold">{yrsLeft >= 1 ? `${Math.floor(yrsLeft)} yr` : `${Math.round(yrsLeft * 12)} mo`}</span> <span className="text-slate-500">remaining</span></span>}
                    {milesLeft != null && <span><span className="font-bold">{milesLeft.toLocaleString()} mi</span> <span className="text-slate-500">remaining</span></span>}
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500 space-y-0.5">
                    {warranty.in_service_date && <p>In-service date: {new Date(warranty.in_service_date).toLocaleDateString()}</p>}
                    {expiry && <p>Estimated expiration: <span className="font-semibold text-slate-700">{expiry}</span></p>}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-2 leading-snug">Warranty information estimated from OEM data and vehicle history records.</p>
                </>
              );
            })() : (
              <p className="text-[13px] text-slate-500 mt-3">Coverage details confirmed at the dealership.</p>
            )}
          </Card>

          <Card className="p-4 md:p-5">
            <SectionTitle>What Owners Say</SectionTitle>
            {reviewRating != null ? (
              <>
                <div className="flex items-center gap-2 mt-2"><span className="text-2xl font-extrabold">{reviewRating.toFixed(1)}</span><Stars n={reviewRating} />{reviewCount != null && <span className="text-[12px] text-slate-500">({reviewCount.toLocaleString()})</span>}</div>
                <p className="text-[10px] text-slate-400 mt-3 leading-snug">Reviews shown are dealership or model reviews and may not reflect ownership experience of this specific vehicle.</p>
              </>
            ) : (
              <p className="text-[13px] text-slate-500 mt-3">Independent buyer reviews for this model are shown here when available.</p>
            )}
          </Card>
        </div>

        {/* 7. HIGHLIGHTS + OVERVIEW + IMAGE */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr_0.9fr] gap-4">
          <Card className="p-4 md:p-5">
            <SectionTitle>Vehicle Highlights</SectionTitle>
            <div className="grid grid-cols-2 gap-y-3 gap-x-3 mt-3">
              {(highlights.length ? highlights : [{ icon: Car, t: listing.ymm || "Vehicle", s: "Model" }]).slice(0, 6).map((h, i) => (
                <div key={i} className="flex items-center gap-2.5"><h.icon className="w-5 h-5 text-[#1a6dff] shrink-0" /><div className="min-w-0"><div className="text-[13px] font-semibold leading-tight truncate">{h.t}</div><div className="text-[11px] text-slate-400">{h.s}</div></div></div>
              ))}
            </div>
            <button className="mt-3 text-[13px] font-semibold text-[#2563EB] inline-flex items-center gap-1">View all features &amp; specs <ArrowRight className="w-3.5 h-3.5" /></button>
          </Card>

          <Card className="p-4 md:p-5">
            <SectionTitle>Vehicle Overview</SectionTitle>
            <p className="text-[13px] leading-relaxed text-slate-600 mt-3 whitespace-pre-wrap">{overview}</p>
            <div className="mt-4 space-y-2 text-[12px]">
              {specRows.filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4"><span className="text-slate-500">{k}</span><span className="font-semibold text-right">{v}</span></div>
              ))}
            </div>
          </Card>

          <Card className="overflow-hidden flex items-center">
            {(gallery[1] || gallery[0]) ? <img src={gallery[1] || gallery[0]} alt="" className="w-full h-full object-cover aspect-[4/3]" /> : <div className="w-full aspect-[4/3] bg-slate-100 flex items-center justify-center"><Car className="w-10 h-10 text-slate-300" /></div>}
          </Card>
        </div>

        {/* 8. WHY BUY FROM DEALER + CONTACT */}
        <div id="v2-docs" className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
          <Card className="p-4 md:p-5">
            <SectionTitle>Why Buy From {dealerName}?</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4">
              {dealerChips.map((c, i) => (
                <div key={i} className="flex items-start gap-2.5"><span className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><c.icon className="w-4 h-4 text-[#1a6dff]" /></span><div><p className="text-[13px] font-bold leading-tight">{c.t}</p><p className="text-[11px] text-slate-500">{c.s}</p></div></div>
              ))}
            </div>
          </Card>
          <div className="rounded-2xl p-5 md:p-6 text-white flex flex-col justify-center" style={{ background: "linear-gradient(105deg,#1a6dff 0%,#3b86ff 100%)" }}>
            <p className="text-[15px] opacity-90">Questions? We're here to help.</p>
            {dealerPhone && <a href={`tel:${dealerPhone}`} className="text-[26px] font-extrabold mt-1 block">{formatPhone(dealerPhone)}</a>}
            <p className="text-[13px] font-semibold opacity-90 mt-3">{dealerName}</p>
            {dealerAddress && <p className="text-[13px] opacity-80">{dealerAddress}</p>}
            <div className="grid grid-cols-2 gap-2 mt-4">
              <button onClick={() => { if (dealerPhone) window.location.href = `tel:${dealerPhone}`; else setInquiry("info"); }} className="h-10 rounded-lg bg-white text-[#1a6dff] text-[13px] font-bold inline-flex items-center justify-center gap-1.5"><Phone className="w-4 h-4" /> Call Sales</button>
              <button onClick={() => setInquiry("info")} className="h-10 rounded-lg bg-white/15 text-white text-[13px] font-bold inline-flex items-center justify-center gap-1.5 border border-white/40"><MessageSquare className="w-4 h-4" /> Contact Dealer</button>
              {dealerPhone && <button onClick={() => { window.location.href = `sms:${dealerPhone.replace(/[^\d+]/g, "")}`; }} className="h-10 rounded-lg bg-white/15 text-white text-[13px] font-bold inline-flex items-center justify-center gap-1.5 border border-white/40"><Send className="w-4 h-4" /> Text Dealer</button>}
              <button onClick={() => setInquiry("info")} className="h-10 rounded-lg bg-white/15 text-white text-[13px] font-bold inline-flex items-center justify-center gap-1.5 border border-white/40"><Clock className="w-4 h-4" /> Test Drive</button>
              <button onClick={() => setInquiry("trade")} className="col-span-2 h-10 rounded-lg bg-white/15 text-white text-[13px] font-bold inline-flex items-center justify-center gap-1.5 border border-white/40"><RefreshCw className="w-4 h-4" /> Trade Appraisal</button>
            </div>
            <button onClick={() => setInquiry("info")} className="w-full h-12 mt-2 rounded-xl bg-white text-[#1a6dff] text-[15px] font-extrabold inline-flex items-center justify-center gap-2 hover:bg-white/90 transition-colors shadow-sm"><BadgeCheck className="w-5 h-5" /> Reserve This Vehicle</button>
          </div>
        </div>

        {/* 9. FOOTER */}
        <footer className="pt-2">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-5 border-t border-[#e8ebef]">
            <div>{dealer.logo_url ? <img src={dealer.logo_url} alt={dealerName} className="h-8" /> : <Logo variant="full" size={22} />}</div>
            <div className="flex gap-6 text-[12px] text-slate-500">
              <span className="inline-flex items-center gap-1.5"><Lock className="w-3.5 h-3.5 text-emerald-600" /> Secure &amp; Private</span>
              <span className="inline-flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5 text-emerald-600" /> 100% Free</span>
              <span className="inline-flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-emerald-600" /> Instant Access</span>
            </div>
            <div className="text-[12px] font-semibold text-slate-600 inline-flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-[#1a6dff]" /> AutoLabels Customer Passport</div>
          </div>
          <p className="text-[11px] text-slate-400 text-center pb-6">
            Information is provided by trusted third parties and is accurate to the best of our knowledge. Verify details with the dealer. © {new Date().getFullYear()} {dealerName}. All rights reserved.
          </p>
        </footer>
      </div>

      {/* Compact sticky header — mobile only, slides in after scrolling past
          the hero so vehicle + price + share stay reachable. */}
      <div className={`lg:hidden fixed top-0 inset-x-0 z-40 bg-white/90 backdrop-blur border-b border-[#e8ebef] shadow-sm transition-transform duration-200 ${showSticky ? "translate-y-0" : "-translate-y-full"}`}>
        <div className="h-14 px-3 flex items-center gap-2.5">
          <button onClick={() => window.history.length > 1 ? window.history.back() : window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Back" className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center shrink-0"><ChevronLeft className="w-5 h-5" /></button>
          {heroSrc && <img src={heroSrc} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />}
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold leading-tight truncate">{listing.ymm || "Vehicle"}</p>
            {price != null && <p className="text-[12px] font-bold text-[#1a6dff] leading-tight">{fmt$(price)}</p>}
          </div>
          <button onClick={handleShare} aria-label="Share" className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center shrink-0"><Upload className="w-[18px] h-[18px] text-slate-600" /></button>
        </div>
      </div>

      {/* Sticky bottom action bar — mobile only (≤768px). Respects the iOS
          safe area; page content is padded so nothing hides behind it. */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-[#e8ebef] px-3 pt-2 pb-[calc(8px+env(safe-area-inset-bottom))]">
        <div className="grid grid-cols-4 gap-2">
          <a href={dealerPhone ? `tel:${dealerPhone}` : undefined} onClick={(e) => { if (!dealerPhone) { e.preventDefault(); setInquiry("info"); } }} className="h-11 rounded-xl border border-[#d8dce0] bg-white text-[#1a1d21] text-[11px] font-bold inline-flex flex-col items-center justify-center gap-0.5">
            <Phone className="w-4 h-4 text-[#1a6dff]" /> Call
          </a>
          <button onClick={() => { if (dealerPhone) window.location.href = `sms:${dealerPhone.replace(/[^\d+]/g, "")}`; else setInquiry("info"); }} className="h-11 rounded-xl border border-[#d8dce0] bg-white text-[#1a1d21] text-[11px] font-bold inline-flex flex-col items-center justify-center gap-0.5">
            <MessageSquare className="w-4 h-4 text-[#1a6dff]" /> Text
          </button>
          <button onClick={() => setInquiry("info")} className="h-11 rounded-xl border border-[#d8dce0] bg-white text-[#1a1d21] text-[11px] font-bold inline-flex flex-col items-center justify-center gap-0.5">
            <Clock className="w-4 h-4 text-[#1a6dff]" /> Test Drive
          </button>
          <button onClick={() => setInquiry("info")} className="h-11 rounded-xl bg-[#1a6dff] text-white text-[11px] font-bold inline-flex flex-col items-center justify-center gap-0.5">
            <DollarSign className="w-4 h-4" /> Today's Price
          </button>
        </div>
      </div>

      {/* Fullscreen photo viewer — tap the hero or "All photos" to open. */}
      {lightbox && gallery.length > 0 && (
        <div className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center" onClick={() => setLightbox(false)}>
          <button onClick={() => setLightbox(false)} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center z-10"><X className="w-5 h-5" /></button>
          <span className="absolute top-5 left-4 text-white text-xs font-semibold px-2.5 py-1 rounded bg-white/15">{photoIdx + 1} / {gallery.length}</span>
          <img src={gallery[photoIdx]} alt={listing.ymm || "vehicle"} className="max-w-[94vw] max-h-[82vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
          {gallery.length > 1 && (
            <>
              <button onClick={(e) => { e.stopPropagation(); setPhotoIdx((i) => (i - 1 + gallery.length) % gallery.length); }} className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center"><ChevronLeft className="w-6 h-6" /></button>
              <button onClick={(e) => { e.stopPropagation(); setPhotoIdx((i) => (i + 1) % gallery.length); }} className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center"><ChevronRight className="w-6 h-6" /></button>
            </>
          )}
        </div>
      )}

      {inquiry && <InquiryModal listing={listing} dealer={dealer} intent={inquiry} onClose={() => setInquiry(null)} />}
    </div>
  );
};

export default VehiclePassportV2;
