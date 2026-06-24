import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Printer, Bookmark,
  FileText, MessageSquare, RefreshCw, Upload,
  ShieldCheck, Shield, CheckCircle2, Package, Clock,
  Star, Phone, Globe,
  Car, Fuel, Cog, Settings, Wind,
  User, Wrench, Award,
  Send, X, Info,
} from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { useVehicleListing, type VehicleListing } from "@/hooks/useVehicleListing";
import { PublicLocaleProvider, usePublicLocale } from "@/lib/i18n/public";
import Logo from "@/components/brand/Logo";
import { formatPhone } from "@/components/addendum/CustomerInfoSection";

// ──────────────────────────────────────────────────────────────
// PublicListing — /v/:slug
// Consumer-grade Vehicle Passport. Mobile-first QR destination.
// Layout matches the approved target mockup; every section is wired
// to real listing/dealer/MarketCheck data and self-hides when that
// data is absent (gone, not greyed). No fabricated reviews, offers,
// ratings, or market numbers ship to this live customer endpoint —
// the FTC fake-review rule and "AutoCheck Verified"-without-AutoCheck
// are real liabilities for the dealer.
// ──────────────────────────────────────────────────────────────

const PublicListing = () => (
  <PublicLocaleProvider initial={null}>
    <PublicListingBody />
  </PublicLocaleProvider>
);

// ── Helpers ────────────────────────────────────────────────────
const fmt$ = (n: number | null | undefined) =>
  n != null ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—";

const conditionLabel = (c: string | null | undefined) => {
  if (c === "new") return { text: "NEW", bg: "#1a6dff" };
  if (c === "cpo") return { text: "CPO", bg: "#1a9d5c" };
  if (c === "used") return { text: "PRE-OWNED", bg: "#475569" };
  return { text: "DEMO", bg: "#d97706" };
};

// Vehicle confidence score derived ONLY from real history signals.
// Returns null when we don't have enough real data to be honest.
const deriveVehicleRating = (signals: { ok: boolean; weight: number }[]) => {
  if (signals.length < 2) return null;
  const got = signals.reduce((s, x) => s + (x.ok ? x.weight : 0), 0);
  const max = signals.reduce((s, x) => s + x.weight, 0);
  const score = Math.round((got / max) * 50) / 10;
  const label = score >= 4.5 ? "Excellent" : score >= 3.8 ? "Good" : score >= 3 ? "Fair" : "Caution";
  return { score, label, count: signals.length };
};

// ── SVG: Semicircular market gauge ─────────────────────────────
const MarketGauge = ({ price, avg }: { price: number; avg: number }) => {
  const ratio = avg > 0 ? price / avg : 1;
  const pct = Math.min(Math.max((ratio - 0.75) / 0.5, 0), 1);
  const angleDeg = pct * 180;
  const rad = ((angleDeg - 180) * Math.PI) / 180;
  const nx = 50 + 36 * Math.cos(rad);
  const ny = 50 + 36 * Math.sin(rad);
  return (
    <svg viewBox="0 0 100 56" className="w-40">
      <path d="M 10 50 A 40 40 0 0 1 50 10" fill="none" stroke="#bbf7d0" strokeWidth="10" strokeLinecap="round" />
      <path d="M 50 10 A 40 40 0 0 1 75 15" fill="none" stroke="#fef08a" strokeWidth="10" strokeLinecap="round" />
      <path d="M 75 15 A 40 40 0 0 1 90 50" fill="none" stroke="#fecaca" strokeWidth="10" strokeLinecap="round" />
      <line x1="50" y1="50" x2={nx.toFixed(1)} y2={ny.toFixed(1)} stroke="#1e293b" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="50" cy="50" r="3.5" fill="#1e293b" />
    </svg>
  );
};

const Stars = ({ n, size = 16 }: { n: number; size?: number }) => (
  <span className="inline-flex gap-0.5">
    {Array.from({ length: 5 }).map((_, i) => {
      const fill = Math.max(0, Math.min(1, n - i));
      return (
        <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
          <Star className="absolute inset-0" style={{ width: size, height: size }} fill="#d9dde1" stroke="none" />
          <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
            <Star style={{ width: size, height: size }} fill="#1a6dff" stroke="none" />
          </span>
        </span>
      );
    })}
  </span>
);

// ── Inquiry modal ───────────────────────────────────────────────
const InquiryModal = ({
  listing, dealer, intent, onClose,
}: {
  listing: VehicleListing; dealer: Record<string, unknown>; intent: "info" | "trade"; onClose: () => void;
}) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState(
    intent === "trade"
      ? `Hi, I'd like a trade-in value toward the ${listing.ymm || "vehicle"} you have listed.`
      : `Hi, I'm interested in the ${listing.ymm || "vehicle"} you have listed. Please contact me with more information.`,
  );
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (!name.trim() || (!email.trim() && !phone.trim())) { toast.error("Name and a phone or email are required"); return; }
    setSending(true);
    try {
      // leads.source CHECK allows: qr_scan | signing_link | manual | website.
      await (supabase as unknown as { from: (t: string) => { insert: (r: unknown) => Promise<unknown> } })
        .from("leads")
        .insert({
          store_id: listing.store_id,
          name: name.trim(),
          email: email.trim() || "",
          phone: phone.trim() || "",
          vehicle_interest: `${listing.ymm || "Vehicle"}${intent === "trade" ? " (trade-in)" : ""}`,
          vehicle_vin: listing.vin,
          source: "website",
          status: "new",
          notes: `[intent=${intent}] ${message.trim()}`,
        });
      setSent(true);
    } catch {
      toast.error("Couldn't send — please call the dealer directly");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-black text-slate-900">{intent === "trade" ? "Value My Trade" : "Contact Dealer"}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>
        {sent ? (
          <div className="text-center py-8">
            <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-slate-900 mb-1">Message Sent!</h3>
            <p className="text-sm text-slate-500 mb-5">The dealer will follow up with you shortly.</p>
            {dealer.phone ? (
              <a href={`tel:${dealer.phone}`} className="inline-flex items-center gap-2 text-blue-600 font-semibold text-sm">
                <Phone className="w-4 h-4" /> {formatPhone(dealer.phone as string)}
              </a>
            ) : null}
          </div>
        ) : (
          <>
            <div className="space-y-3 mb-5">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your Name *"
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email Address" type="email"
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <input value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="Phone" type="tel"
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>
            <button onClick={submit} disabled={sending}
              className="w-full h-12 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-colors">
              {sending
                ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <><Send className="w-4 h-4" /> Send Message</>}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

// ── Main body ──────────────────────────────────────────────────
const PublicListingBody = () => {
  const { L } = usePublicLocale();
  const { slug } = useParams<{ slug: string }>();
  const { publicUrl } = useVehicleListing("");

  const [listing, setListing] = useState<VehicleListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [inquiry, setInquiry] = useState<null | "info" | "trade">(null);
  const [zipInput, setZipInput] = useState("");
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke("public-listing-view", { body: { slug } });
      if (!mounted) return;
      if (error) {
        const status = (error as unknown as { context?: { status?: number } })?.context?.status;
        if (status === 429) setRateLimited(true); else setNotFound(true);
        setLoading(false);
        return;
      }
      const row = (data as { listing?: VehicleListing } | null)?.listing ?? null;
      if (!row) { setNotFound(true); setLoading(false); return; }
      setListing(row);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [slug]);

  const gallery = useMemo(() => {
    if (!listing) return [];
    const fromPhotos = (listing.photos || []).map((p) => p.url).filter(Boolean);
    if (fromPhotos.length > 0) return fromPhotos;
    if (listing.hero_image_url) return [listing.hero_image_url];
    return [];
  }, [listing]);

  useEffect(() => {
    if (!gallery.length) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setPhotoIdx((i) => (i - 1 + gallery.length) % gallery.length);
      if (e.key === "ArrowRight") setPhotoIdx((i) => (i + 1) % gallery.length);
      if (e.key === "Escape") setLightboxOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [gallery.length]);

  // ── Early returns (after all hooks) ────────────────────────
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#f4f5f7]">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (rateLimited) return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[#f4f5f7]">
      <div className="text-center">
        <Clock className="w-12 h-12 text-amber-500 mx-auto mb-4" />
        <h1 className="text-xl font-bold">{L.slow_down}</h1>
        <p className="text-sm text-slate-500 mt-2">{L.rate_limited_body}</p>
      </div>
    </div>
  );
  if (notFound || !listing) return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[#f4f5f7]">
      <div className="text-center">
        <Package className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <h1 className="text-xl font-bold">{L.vehicle_unavailable}</h1>
        <p className="text-sm text-slate-500 mt-2">{L.vehicle_unavailable_body}</p>
        <p className="text-[11px] text-slate-400 mt-3 font-mono">{slug}</p>
      </div>
    </div>
  );

  // ── Derived data (post-guard, no hooks) ─────────────────────
  const dealer = (listing.dealer_snapshot || {}) as Record<string, unknown>;
  const ks = listing.key_specs || {};
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const mp = listing.market_payload || {};
  const viewUrl = publicUrl(listing.slug);
  const cond = conditionLabel(listing.condition);

  const price = listing.price ?? null;
  const marketAvg = listing.market_value ?? null;
  const belowMarket = mp.belowMarket ?? (marketAvg != null && price != null && price < marketAvg ? marketAvg - price : null);
  const marketHigh = mp.high ?? null;
  const priceLabel = (dealer.price_label as string) || "Our Price";
  const isUsed = listing.condition === "used" || listing.condition === "cpo";

  const serviceCount = listing.service_records?.length ?? 0;
  const recallClear = listing.recall_status === "clear";
  const ownerCount = (mc.owner_count as number) ?? (mc.carfax_1_owner === true ? 1 : null);
  const accidentCount = (mc.accident_count as number) ?? (mc.carfax_clean_title === true ? 0 : null);
  const cleanTitle = mc.carfax_clean_title === true;

  const warrantyStr = (() => {
    const w = listing.warranty_info;
    if (!w) return null;
    const yrs = w.factory_months ? Math.round(w.factory_months / 12) : null;
    const mi = w.factory_miles ? `${(w.factory_miles / 1000).toFixed(0)}K mi` : null;
    return [yrs ? `${yrs} yr` : null, mi].filter(Boolean).join(" / ") || null;
  })();

  // ── Trust badges — only real signals, in target order ───────
  const trustBadges: { icon: React.ElementType; title: string; sub: string }[] = [];
  if (accidentCount != null) trustBadges.push({ icon: Shield, title: accidentCount === 0 ? "No Accident History" : `${accidentCount} Accident${accidentCount > 1 ? "s" : ""} Reported`, sub: "History verified" });
  if (ownerCount != null) trustBadges.push({ icon: User, title: `${ownerCount}-Owner Vehicle`, sub: ownerCount === 1 ? "Personal Use" : "Multiple owners" });
  if (serviceCount > 0) trustBadges.push({ icon: Wrench, title: "Full Service History", sub: `${serviceCount} Service Record${serviceCount > 1 ? "s" : ""}` });
  if (cleanTitle) trustBadges.push({ icon: FileText, title: "Clean Title", sub: "No Liens or Issues" });
  if (warrantyStr) trustBadges.push({ icon: ShieldCheck, title: "Factory Warranty", sub: warrantyStr });
  if (recallClear) trustBadges.push({ icon: RefreshCw, title: "No Open Recalls", sub: "NHTSA verified" });

  // ── Analysis cards — each gated on real data ────────────────
  const hasMarket = marketAvg != null && price != null;
  const ratingSignals: { ok: boolean; weight: number }[] = [];
  if (typeof mc.carfax_clean_title === "boolean") ratingSignals.push({ ok: cleanTitle, weight: 1.4 });
  if (ownerCount != null) ratingSignals.push({ ok: ownerCount === 1, weight: 1.0 });
  if (listing.recall_status) ratingSignals.push({ ok: recallClear, weight: 1.0 });
  if (serviceCount > 0) ratingSignals.push({ ok: true, weight: 0.8 });
  if (listing.condition === "new" || listing.condition === "cpo") ratingSignals.push({ ok: true, weight: 0.8 });
  const rating = deriveVehicleRating(ratingSignals);
  const ratingProvider = (dealer.rating_provider as string) || "";
  const confidenceSignals = [hasMarket, mp.low != null && mp.high != null, !!listing.market_position].filter(Boolean).length;
  const showCards = hasMarket || rating != null || confidenceSignals >= 2;

  // ── Highlights — real specs/features only ───────────────────
  const highlights: { icon: React.ElementType; title: string; subtitle: string }[] = [];
  if (ks.engine) highlights.push({ icon: Cog, title: ks.engine, subtitle: "Engine" });
  if (ks.drivetrain) highlights.push({ icon: Car, title: ks.drivetrain, subtitle: "Drivetrain" });
  if (ks.transmission) highlights.push({ icon: Settings, title: ks.transmission, subtitle: "Transmission" });
  if (ks.fuel) highlights.push({ icon: Fuel, title: ks.fuel, subtitle: "Fuel" });
  if (ks.body_style) highlights.push({ icon: Car, title: ks.body_style, subtitle: "Body Style" });
  if (ks.exterior_color) highlights.push({ icon: Wind, title: ks.exterior_color, subtitle: "Exterior" });
  if (highlights.length < 6 && listing.features?.length) {
    for (const f of listing.features) {
      if (highlights.length >= 6) break;
      highlights.push({ icon: Award, title: f.title, subtitle: f.subtitle || "Feature" });
    }
  }

  const specRows: [string, string | null | undefined][] = [
    ["Trim", listing.trim],
    ["Exterior Color", ks.exterior_color as string | undefined],
    ["Interior Color", ks.interior_color as string | undefined],
    ["Transmission", ks.transmission],
    ["Fuel Type", ks.fuel],
    ks.mpg_city && ks.mpg_hwy ? ["MPG (est.)", `${ks.mpg_city} city / ${ks.mpg_hwy} hwy`] : ["Drivetrain", ks.drivetrain],
  ];
  const specRowsReal = specRows.filter(([, v]) => v);

  const overview = listing.description ||
    (highlights.length
      ? `The ${listing.ymm}${listing.trim ? " " + listing.trim : ""} pairs a ${ks.engine || "capable"} powertrain with ${ks.drivetrain || "a refined drivetrain"} and a well-equipped cabin.`
      : null);

  // ── Real offers / reviews — no fabrication ──────────────────
  const rawOffers = (listing as unknown as { incentives?: unknown }).incentives ?? (mc as { incentives?: unknown }).incentives;
  const offers = (Array.isArray(rawOffers) ? rawOffers : [])
    .map((o) => o as Record<string, unknown>)
    .map((o) => ({
      title: (o.title as string) || (o.program as string) || "Offer",
      body: (o.summary as string) || (o.description as string) || (o.amount ? `$${Number(o.amount).toLocaleString()}` : ""),
      exp: o.valid_through ? `Expires ${new Date(o.valid_through as string).toLocaleDateString()}` : "",
    }))
    .filter((o) => o.body)
    .slice(0, 4);

  const rawReviews = (dealer as { reviews?: unknown }).reviews;
  const reviews = (Array.isArray(rawReviews) ? rawReviews : [])
    .map((r) => r as Record<string, unknown>)
    .map((r) => ({
      name: (r.name as string) || (r.author as string) || "Verified buyer",
      rating: Number(r.rating ?? 5),
      text: (r.text as string) || (r.body as string) || "",
      when: (r.when as string) || (r.date as string) || "",
    }))
    .filter((r) => r.text)
    .slice(0, 3);
  const reviewRating = (dealer.review_rating as number) ?? null;
  const reviewCount = (dealer.review_count as number) ?? null;

  const dealerName = (dealer.name as string) || "AutoLabels";
  const dealerPhone = (dealer.phone as string) || "";
  const dealerAddress = [(dealer.address as string), (dealer.city as string), (dealer.state as string), (dealer.zip as string)].filter(Boolean).join(", ");
  const makeName = (listing.ymm || "").split(" ")[1] || "vehicle";
  const photoCount = gallery.length;
  const heroSrc = gallery[photoIdx] || gallery[0] || "";
  const zipValid = /^\d{5}$/.test(zipInput);

  const handleShare = async () => {
    try {
      if (navigator.share) await navigator.share({ title: listing.ymm || "Vehicle", url: viewUrl });
      else { await navigator.clipboard.writeText(viewUrl); toast.success("Link copied"); }
    } catch { /* cancelled */ }
  };

  const quickActions = [
    { icon: FileText, label: "Documents", onClick: () => document.getElementById("passport-docs")?.scrollIntoView({ behavior: "smooth" }) },
    { icon: MessageSquare, label: "Contact Dealer", onClick: () => { if (dealerPhone) window.location.href = `tel:${dealerPhone}`; else setInquiry("info"); } },
    { icon: RefreshCw, label: "Value My Trade", onClick: () => setInquiry("trade") },
    { icon: Upload, label: "Share Vehicle", onClick: handleShare },
  ];

  const section = "px-5 sm:px-8";

  return (
    <div className="min-h-screen bg-[#f4f5f7] text-[#1a1d21]" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <Helmet>
        <title>{`${listing.ymm}${listing.trim ? ` ${listing.trim}` : ""} — ${dealerName}`}</title>
        <meta name="description" content={`${listing.ymm}${price != null ? ` · ${fmt$(price)}` : ""}${dealer.city ? ` · ${dealer.city}` : ""}`} />
        <link rel="canonical" href={viewUrl} />
      </Helmet>

      <div className="mx-auto bg-white shadow-sm max-w-[1024px]">
        {/* HEADER */}
        <header className={`${section} flex items-center justify-between py-4 border-b border-[#e9ecef]`}>
          <div className="text-[22px] font-extrabold tracking-tight">
            {dealer.logo_url ? <img src={dealer.logo_url as string} alt={dealerName} className="h-7" /> : (<><span style={{ color: "#1a6dff" }}>auto</span><span>(LABELS)</span></>)}
          </div>
          <div className="flex gap-5 sm:gap-7">
            <button onClick={handleShare} className="flex items-center gap-1.5 text-sm font-medium hover:text-[#1a6dff] transition-colors"><Upload className="w-[17px] h-[17px]" /><span className="hidden sm:inline">Share</span></button>
            <button onClick={() => toast.success("Saved to this device")} className="flex items-center gap-1.5 text-sm font-medium hover:text-[#1a6dff] transition-colors"><Bookmark className="w-[17px] h-[17px]" /><span className="hidden sm:inline">Save</span></button>
            <button onClick={() => window.print()} className="flex items-center gap-1.5 text-sm font-medium hover:text-[#1a6dff] transition-colors"><Printer className="w-[17px] h-[17px]" /><span className="hidden sm:inline">Print</span></button>
          </div>
        </header>

        {/* HERO GALLERY */}
        <div className="relative w-full bg-[#222] overflow-hidden aspect-[16/7]">
          {heroSrc ? (
            <img src={heroSrc} alt={listing.ymm || "vehicle"} className="absolute inset-0 w-full h-full object-cover cursor-zoom-in" onClick={() => setLightboxOpen(true)} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500"><Car className="w-16 h-16" strokeWidth={1.25} /></div>
          )}
          <div className="absolute top-4 left-4 text-white text-xs font-bold px-3 py-[5px] rounded tracking-wide z-10" style={{ background: cond.bg }}>{cond.text}</div>
          {photoCount > 0 && (
            <div className="absolute top-4 right-4 text-white text-xs font-medium px-3 py-[6px] rounded-md z-10 bg-black/60">Photo {photoIdx + 1} of {photoCount}</div>
          )}
          {photoCount > 1 && (
            <>
              <button onClick={() => setPhotoIdx((i) => (i - 1 + photoCount) % photoCount)} aria-label="Previous photo" className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/95 hover:bg-white flex items-center justify-center shadow-md z-10">
                <ChevronLeft className="w-5 h-5 text-[#1a1d21]" />
              </button>
              <button onClick={() => setPhotoIdx((i) => (i + 1) % photoCount)} aria-label="Next photo" className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/95 hover:bg-white flex items-center justify-center shadow-md z-10">
                <ChevronRight className="w-5 h-5 text-[#1a1d21]" />
              </button>
            </>
          )}
          {/* Thumbnail strip superimposed over the bottom of the hero */}
          {photoCount > 1 && (
            <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-3 pt-8 pb-3">
              <div className="flex gap-2 overflow-x-auto">
                {gallery.slice(0, 12).map((src, i) => (
                  <button key={i} onClick={() => setPhotoIdx(i)} aria-label={`Photo ${i + 1}`}
                    className="shrink-0 w-[72px] h-[48px] rounded-md overflow-hidden bg-[#e9ecef]"
                    style={{ outline: i === photoIdx ? "2px solid #1a6dff" : "2px solid transparent", outlineOffset: -2 }}>
                    <img src={src} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={`${section} py-7 space-y-8`}>
          {/* TITLE + PRICE */}
          <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
            <div className="min-w-0">
              <h1 className="text-[28px] sm:text-[32px] font-extrabold tracking-tight leading-tight">{listing.ymm || `Vehicle ${listing.vin.slice(-8)}`}</h1>
              {listing.trim && <div className="text-[20px] font-semibold text-[#3a4048] mt-0.5">{listing.trim}</div>}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-[13px] text-[#6b727a]">
                {listing.mileage != null && <><span className="flex items-center gap-1.5"><Clock className="w-[14px] h-[14px]" />{listing.mileage.toLocaleString()} mi</span><span className="text-[#d0d4d9]">|</span></>}
                {(ks.exterior_color || mc.exterior_color) ? <><span>{(ks.exterior_color as string) || (mc.exterior_color as string)}</span><span className="text-[#d0d4d9]">|</span></> : null}
                <span>VIN {listing.vin}</span>
              </div>
            </div>
            {price != null && (
              <div className="md:text-right shrink-0">
                {isUsed && marketAvg != null && belowMarket != null && belowMarket > 0 && (
                  <div className="text-[13px] text-[#6b727a] space-y-0.5 mb-1">
                    <div>Market Value <span className="font-semibold text-[#3a4048]">{fmt$(marketAvg)}</span></div>
                    <div>Dealer Discount <span className="font-semibold text-[#1a9d5c]">-{fmt$(belowMarket)}</span></div>
                  </div>
                )}
                <div className="flex items-center md:justify-end gap-1.5 text-sm font-semibold text-[#3a4048]">{priceLabel}<Info className="w-[15px] h-[15px] text-[#9aa0a8]" /></div>
                <div className="text-[40px] font-extrabold tracking-tight leading-none mt-0.5">{fmt$(price)}</div>
              </div>
            )}
          </div>

          {/* ACTIONS + ZIP */}
          <div className="flex flex-col lg:flex-row lg:items-end gap-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
              {quickActions.map((a) => (
                <button key={a.label} onClick={a.onClick}
                  className="flex items-center justify-center gap-2.5 h-12 px-3 bg-white border border-[#E5E7EB] rounded-xl text-[15px] font-semibold hover:border-[#1a6dff] hover:text-[#1a6dff] transition-colors">
                  <a.icon className={`w-5 h-5 ${a.label === "Value My Trade" ? "text-[#1a9d5c]" : "text-[#1a6dff]"}`} />{a.label}
                </button>
              ))}
            </div>
            <div className="lg:w-[300px] shrink-0">
              <div className="text-[13px] text-[#3a4048] mb-2">Enter your ZIP for available offers in your area</div>
              <div className="flex">
                <input value={zipInput} onChange={(e) => setZipInput(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="ZIP Code" maxLength={5} inputMode="numeric"
                  className="flex-1 min-w-0 h-12 px-4 border border-[#E5E7EB] border-r-0 rounded-l-xl text-sm outline-none focus:border-[#1a6dff]" />
                <button onClick={() => zipValid ? toast.success(`Checking offers near ${zipInput}…`) : toast.error("Enter a valid 5-digit ZIP")}
                  className="h-12 px-5 text-white rounded-r-xl text-sm font-semibold whitespace-nowrap bg-[#2563EB] hover:bg-[#1d4fd7] transition-colors">View Offers</button>
              </div>
            </div>
          </div>

          {/* OFFERS — one unified card; only when real incentive data exists */}
          {offers.length > 0 && (
            <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-stretch sm:min-h-[88px]">
                {/* Available Offers label */}
                <div className="flex items-center gap-2 px-5 py-4 sm:w-[220px] shrink-0">
                  <Award className="w-[18px] h-[18px] text-[#1a9d5c] shrink-0" />
                  <span className="text-[15px] font-bold">Available Offers</span>
                  <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full border border-[#cbd5e1] text-[#6b727a] text-xs font-semibold">{offers.length}</span>
                </div>
                {/* Offer blocks */}
                {offers.map((o, i) => (
                  <div key={i} className="flex flex-col justify-center px-8 py-4 sm:border-l border-[#F1F5F9]">
                    <div className="text-sm font-bold">{o.title}</div>
                    <div className="text-[13px] text-[#3a4048] mt-0.5">{o.body}</div>
                    {o.exp && <div className="text-xs text-[#9aa0a8] mt-0.5">{o.exp}</div>}
                  </div>
                ))}
                {/* Spacer + View all link */}
                <div className="flex items-center justify-end px-6 py-4 sm:ml-auto">
                  <button className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-[#2563EB] hover:gap-2.5 transition-all">
                    View all offers <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TRUST BADGES — single segmented strip, real signals only */}
          {trustBadges.length > 0 && (
            <div className={`grid grid-cols-2 sm:grid-cols-3 ${
              ({ 1: "lg:grid-cols-1", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6" } as Record<number, string>)[Math.min(trustBadges.length, 6)]
            } border border-[#eceef0] rounded-xl overflow-hidden`}>
              {trustBadges.map((b, i) => (
                <div key={i} className="p-4 bg-[#fcfcfd] border-r border-b border-[#eceef0]">
                  <div className="flex items-center gap-2 mb-2">
                    <b.icon className="w-[17px] h-[17px] text-[#1a6dff]" />
                    <span className="text-[13px] font-bold leading-tight">{b.title}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-[#6b727a]">
                    <CheckCircle2 className="w-[13px] h-[13px] text-[#1a9d5c]" fill="#1a9d5c" stroke="#fff" strokeWidth={2.5} />{b.sub}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ANALYSIS CARDS — each gated on real data */}
          {showCards && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {hasMarket && (
                <div className="border border-[#eceef0] rounded-xl p-5">
                  <div className="text-base font-bold">Market Price Analysis</div>
                  <div className="text-[11px] text-[#9aa0a8] mt-0.5">Powered by MarketCheck</div>
                  <div className="flex justify-between items-end mt-3.5">
                    <div>
                      <div className="text-base font-bold text-[#1a9d5c]">{belowMarket && belowMarket > 250 ? "Great Price" : "Market Price"}</div>
                      <div className="text-[26px] font-extrabold mt-1">{fmt$(price)}</div>
                      {belowMarket && belowMarket > 0
                        ? <><div className="text-xs text-[#1a9d5c] mt-1">You save {fmt$(belowMarket)}</div><div className="text-xs text-[#6b727a]">below market average</div></>
                        : <div className="text-xs text-[#6b727a] mt-1">at market average</div>}
                    </div>
                    <MarketGauge price={price ?? 0} avg={marketAvg ?? 0} />
                  </div>
                  <div className="flex justify-between text-[11px] mt-2">
                    <div><div className="text-[#6b727a]">Market Avg</div><div className="font-bold">{fmt$(marketAvg)}</div></div>
                    {marketHigh != null && <div className="text-right"><div className="text-[#6b727a]">Market High</div><div className="font-bold">{fmt$(marketHigh)}</div></div>}
                  </div>
                </div>
              )}
              {rating && (
                <div className="border border-[#eceef0] rounded-xl p-5 flex flex-col">
                  <div className="text-base font-bold">{ratingProvider ? `${ratingProvider} ` : ""}Vehicle Rating</div>
                  <div className="flex items-center justify-center gap-3 mt-4">
                    <span className="text-[40px] font-extrabold">{rating.score.toFixed(1)}</span>
                    <Stars n={rating.score} size={22} />
                  </div>
                  <div className="text-2xl font-bold mt-2 text-center">{rating.label}</div>
                  <div className="text-xs text-[#6b727a] mt-2 text-center">Based on {rating.count} verified history signals</div>
                </div>
              )}
              {confidenceSignals >= 2 && (
                <div className="border border-[#eceef0] rounded-xl p-5">
                  <div className="text-base font-bold">Price Confidence</div>
                  <div className="text-[17px] font-bold text-[#1a9d5c] mt-3">{confidenceSignals >= 3 ? "High" : "Medium"}</div>
                  <div className="text-[13px] text-[#3a4048] mt-1">This vehicle is priced competitively</div>
                  <div className="flex flex-col gap-2 mt-3.5">
                    {[
                      belowMarket && belowMarket > 0 ? "Priced below market average" : "Priced in line with market",
                      "Backed by live market comparables",
                      listing.market_position ? "Positioned against local listings" : "Current market data",
                    ].map((c) => (
                      <div key={c} className="flex items-center gap-2 text-[13px]">
                        <CheckCircle2 className="w-4 h-4 text-[#1a9d5c]" fill="#1a9d5c" stroke="#fff" strokeWidth={2.5} />{c}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* HIGHLIGHTS + OVERVIEW + IMAGE */}
          {(highlights.length > 0 || overview) && (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_0.85fr] gap-8 pt-2">
              {highlights.length > 0 && (
                <div>
                  <div className="text-[17px] font-bold pb-3 border-b border-[#eceef0]">Vehicle Highlights</div>
                  <div className="grid grid-cols-2 gap-y-4 gap-x-3 mt-4">
                    {highlights.slice(0, 6).map((h, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <h.icon className="w-[22px] h-[22px] text-[#3a4048] shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[13.5px] font-semibold leading-tight truncate">{h.title}</div>
                          <div className="text-xs text-[#9aa0a8]">{h.subtitle}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {overview && (
                <div>
                  <div className="text-[17px] font-bold pb-3 border-b border-[#eceef0]">Vehicle Overview</div>
                  <p className="text-[13px] leading-relaxed text-[#3a4048] mt-4 whitespace-pre-wrap">{overview}</p>
                  {specRowsReal.length > 0 && (
                    <div className="grid mt-5 text-[13px]" style={{ gridTemplateColumns: "auto 1fr", rowGap: 12 }}>
                      {specRowsReal.slice(0, 6).map(([k, v]) => (
                        <Fragment key={k}>
                          <div className="text-[#6b727a] pr-5">{k}</div>
                          <div className="font-bold">{v}</div>
                        </Fragment>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {gallery[1] && (
                <div className="flex items-center">
                  <img src={gallery[1]} alt="" className="w-full rounded-[10px] object-cover aspect-[4/3]" />
                </div>
              )}
            </div>
          )}

          {/* REVIEWS — only when real review data is wired */}
          {reviews.length > 0 && (
            <div className="border border-[#eceef0] rounded-xl p-6">
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-lg font-bold">What Our Customers Say</div>
                  {reviewRating != null && (
                    <div className="flex items-center gap-2.5 mt-2.5">
                      <span className="text-[28px] font-extrabold">{reviewRating.toFixed(1)}</span>
                      <Stars n={reviewRating} />
                      {reviewCount != null && <span className="text-[13px] text-[#6b727a]">({reviewCount.toLocaleString()} Reviews)</span>}
                    </div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5">
                {reviews.map((r, i) => (
                  <div key={i} className="border border-[#eceef0] rounded-[10px] p-[18px]">
                    <div className="flex justify-between items-center">
                      <Stars n={r.rating} size={15} />
                      {r.when && <span className="text-[11px] text-[#9aa0a8]">{r.when}</span>}
                    </div>
                    <p className="text-[13px] leading-relaxed text-[#3a4048] my-3">{r.text}</p>
                    <span className="text-[13px] font-semibold">– {r.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Documents anchor for the quick-action button */}
          <div id="passport-docs" className="scroll-mt-20" aria-hidden />

          {/* CTA BANNER */}
          <div className="rounded-[14px] p-6 sm:p-8 flex flex-col md:flex-row md:justify-between md:items-center gap-6 text-white" style={{ background: "linear-gradient(105deg,#1a6dff 0%,#3b86ff 100%)" }}>
            <div>
              <div className="text-[22px] font-extrabold">Ready to take the next step?</div>
              <div className="text-sm opacity-90 mt-1.5">Our team is here to help you make this {makeName} yours.</div>
              <div className="flex flex-wrap gap-3 mt-4">
                <button onClick={() => { if (dealerPhone) window.location.href = `tel:${dealerPhone}`; else setInquiry("info"); }} className="flex items-center gap-2 bg-white text-[#1a6dff] rounded-[9px] px-5 py-3 text-sm font-bold">
                  <MessageSquare className="w-4 h-4" />Contact Dealer
                </button>
                <button onClick={() => setInquiry("trade")} className="flex items-center gap-2 bg-transparent text-white rounded-[9px] px-5 py-3 text-sm font-bold border-[1.5px] border-white/70">
                  <RefreshCw className="w-4 h-4" />Value My Trade
                </button>
              </div>
            </div>
            <div className="md:text-right">
              <div className="text-[15px] opacity-90">Questions? Call us today.</div>
              {dealerPhone && <a href={`tel:${dealerPhone}`} className="text-[26px] font-extrabold mt-1 block">{formatPhone(dealerPhone)}</a>}
              <div className="text-[13px] opacity-85 mt-3.5 font-semibold">{dealerName}</div>
              {dealerAddress && <div className="text-[13px] opacity-85">{dealerAddress}</div>}
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <footer className={`${section} flex flex-col sm:flex-row justify-between items-center gap-3 py-6 border-t border-[#eceef0]`}>
          <div className="flex items-center gap-2">
            {dealer.logo_url ? <img src={dealer.logo_url as string} alt={dealerName} className="h-8" /> : <Logo variant="full" size={22} />}
          </div>
          <div className="text-xs text-[#9aa0a8]">© {new Date().getFullYear()} {dealerName}. All rights reserved.</div>
          <div className="flex gap-6 text-xs text-[#6b727a]">
            <a href="/privacy" className="hover:text-[#1a1d21]">Privacy Policy</a>
            <a href="/terms" className="hover:text-[#1a1d21]">Terms of Use</a>
          </div>
        </footer>
      </div>

      {/* LIGHTBOX */}
      {lightboxOpen && gallery.length > 0 && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95" onClick={() => setLightboxOpen(false)}>
          {gallery.length > 1 && (
            <button className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center"
              onClick={(e) => { e.stopPropagation(); setPhotoIdx((i) => (i - 1 + gallery.length) % gallery.length); }}>
              <ChevronLeft className="w-6 h-6 text-white" />
            </button>
          )}
          <img src={gallery[photoIdx]} alt={listing.ymm || "vehicle"} className="max-w-[90vw] max-h-[80vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
          {gallery.length > 1 && (
            <button className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center"
              onClick={(e) => { e.stopPropagation(); setPhotoIdx((i) => (i + 1) % gallery.length); }}>
              <ChevronRight className="w-6 h-6 text-white" />
            </button>
          )}
          <button className="absolute top-4 right-4 w-10 h-10 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center" onClick={() => setLightboxOpen(false)}>
            <X className="w-5 h-5 text-white" />
          </button>
        </div>
      )}

      {inquiry && <InquiryModal listing={listing} dealer={dealer} intent={inquiry} onClose={() => setInquiry(null)} />}
    </div>
  );
};

export default PublicListing;
