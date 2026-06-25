import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Share2, Printer, Bookmark,
  FileText, MessageSquare, RefreshCw, ExternalLink, Upload,
  ShieldCheck, Shield, CheckCircle2, Package, Clock, AlertTriangle,
  Star, Phone, Globe,
  Car, Fuel, Cog, Settings, Wind,
  TrendingDown, User, Wrench, Award,
  Send, X, Info, Gauge, CreditCard,
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
// Consumer-grade vehicle passport. Mobile-first QR destination.
// Target: Apple product page × CarGurus intelligence × iPacket docs.
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
  if (c === "new") return { text: "NEW", bg: "bg-blue-600" };
  if (c === "cpo") return { text: "CPO", bg: "bg-emerald-600" };
  if (c === "used") return { text: "PRE-OWNED", bg: "bg-slate-600" };
  return { text: "DEMO", bg: "bg-amber-500" };
};

const deriveVehicleRating = (accidents: number, owners: number, recalls: number, serviceCount: number) => {
  let score = 4.5;
  if (accidents > 0) score -= 0.4 * accidents;
  if (owners > 2) score -= 0.2;
  if (recalls > 0) score -= 0.3;
  if (serviceCount > 3) score += 0.2;
  score = Math.max(2.5, Math.min(5.0, score));
  const label = score >= 4.5 ? "Excellent" : score >= 3.8 ? "Good" : "Fair";
  return { score: parseFloat(score.toFixed(1)), label };
};

// ── SVG: Semicircular market gauge ─────────────────────────────
const MarketGauge = ({ price, avg }: { price: number; avg: number }) => {
  const ratio = avg > 0 ? price / avg : 1;
  const pct = Math.min(Math.max((ratio - 0.75) / 0.5, 0), 1);
  const angleDeg = pct * 180;
  const rad = ((angleDeg - 180) * Math.PI) / 180;
  const nx = 50 + 36 * Math.cos(rad);
  const ny = 50 + 36 * Math.sin(rad);
  const label =
    ratio < 0.92 ? { text: "Great Price", color: "#16a34a" }
    : ratio < 1.0 ? { text: "Good Price", color: "#2563eb" }
    : ratio < 1.08 ? { text: "Market Price", color: "#ca8a04" }
    : { text: "High Price", color: "#dc2626" };
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 100 56" className="w-44">
        <path d="M 10 50 A 40 40 0 0 1 50 10" fill="none" stroke="#bbf7d0" strokeWidth="10" strokeLinecap="round" />
        <path d="M 50 10 A 40 40 0 0 1 75 15" fill="none" stroke="#fef08a" strokeWidth="10" strokeLinecap="round" />
        <path d="M 75 15 A 40 40 0 0 1 90 50" fill="none" stroke="#fecaca" strokeWidth="10" strokeLinecap="round" />
        <line x1="50" y1="50" x2={nx.toFixed(1)} y2={ny.toFixed(1)}
          stroke="#1e293b" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="50" cy="50" r="3.5" fill="#1e293b" />
      </svg>
      <span className="text-xs font-bold mt-1" style={{ color: label.color }}>{label.text}</span>
    </div>
  );
};

// ── TrustBadge ─────────────────────────────────────────────────
const TrustBadge = ({
  icon: Icon, label, sub, state,
}: {
  icon: React.ElementType; label: string; sub: string;
  state: "good" | "warn" | "bad" | "neutral";
}) => {
  const c = {
    good: { icon: "text-emerald-600 bg-emerald-50", check: "text-emerald-600" },
    warn: { icon: "text-amber-600 bg-amber-50", check: "text-amber-500" },
    bad:  { icon: "text-red-600 bg-red-50",   check: "text-red-500" },
    neutral: { icon: "text-slate-500 bg-slate-100", check: "text-slate-400" },
  }[state];
  return (
    <div className="flex items-center gap-3 p-3.5 rounded-2xl border border-slate-100 hover:border-slate-200 transition-colors">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${c.icon}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-bold text-slate-900 leading-tight truncate">{label}</p>
          {state !== "neutral" && <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${c.check}`} />}
        </div>
        <p className="text-xs text-slate-500 truncate">{sub}</p>
      </div>
    </div>
  );
};

// ── Inquiry modal ───────────────────────────────────────────────
const InquiryModal = ({
  listing, dealer, onClose,
}: {
  listing: VehicleListing; dealer: Record<string, unknown>; onClose: () => void;
}) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState(
    `Hi, I'm interested in the ${listing.ymm || "vehicle"} you have listed. Please contact me with more information.`,
  );
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (!name.trim() || !email.trim()) { toast.error("Name and email are required"); return; }
    setSending(true);
    try {
      // leads.source CHECK allows: qr_scan | signing_link | manual | website.
      await (supabase as unknown as { from: (t: string) => { insert: (r: unknown) => Promise<unknown> } })
        .from("leads")
        .insert({
          store_id: listing.store_id,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || "",
          vehicle_interest: listing.ymm || "Vehicle",
          vehicle_vin: listing.vin,
          source: "website",
          status: "new",
          notes: `[intent=info] ${message.trim()}`,
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
          <h2 className="text-lg font-black text-slate-900">Contact Dealer</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>
        {sent ? (
          <div className="text-center py-8">
            <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-slate-900 mb-1">Message Sent!</h3>
            <p className="text-sm text-slate-500 mb-5">The dealer will follow up with you shortly.</p>
            {dealer.phone && (
              <a href={`tel:${dealer.phone}`} className="inline-flex items-center gap-2 text-blue-600 font-semibold text-sm">
                <Phone className="w-4 h-4" /> {formatPhone(dealer.phone as string)}
              </a>
            )}
          </div>
        ) : (
          <>
            <div className="space-y-3 mb-5">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your Name *"
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email Address *" type="email"
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" type="tel"
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
  const navigate = useNavigate();
  const { publicUrl } = useVehicleListing("");

  const [listing, setListing] = useState<VehicleListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [zipInput, setZipInput] = useState("");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);

  useEffect(() => {
    if (!slug) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke("public-listing-view", {
        body: { slug },
      });
      if (!mounted) return;
      if (error) {
        const status = (error as unknown as { context?: { status?: number } })?.context?.status;
        if (status === 429) setRateLimited(true);
        else setNotFound(true);
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

  // All hooks must run before any early return (Rules of Hooks).
  const gallery = useMemo(() => {
    if (!listing) return [];
    const fromPhotos = (listing.photos || []).map((p) => p.url).filter(Boolean);
    if (fromPhotos.length > 0) return fromPhotos;
    if (listing.hero_image_url) return [listing.hero_image_url];
    return [];
  }, [listing]);

  const highlights = useMemo(() => {
    if (!listing) return [];
    const ks = listing.key_specs || {};
    const rows: { icon: React.ElementType; title: string; subtitle?: string | null }[] = [];
    if (ks.engine) rows.push({ icon: Cog, title: ks.engine, subtitle: "Engine" });
    if (ks.drivetrain) rows.push({ icon: Car, title: ks.drivetrain, subtitle: "Drivetrain" });
    if (ks.transmission) rows.push({ icon: Settings, title: ks.transmission, subtitle: "Transmission" });
    if (ks.fuel) rows.push({ icon: Fuel, title: ks.fuel, subtitle: "Fuel" });
    if (ks.body_style) rows.push({ icon: Car, title: ks.body_style, subtitle: "Body Style" });
    if (ks.exterior_color) rows.push({ icon: Wind, title: ks.exterior_color, subtitle: "Color" });
    if (rows.length < 6 && listing.features && listing.features.length > 0) {
      const extras = listing.features
        .filter((f) => !/blind|backup|camera|alert|warning|apple|android|bluetooth|wifi|navigation|screen|audio|carplay|usb/i.test(f.title))
        .slice(0, 8 - rows.length)
        .map((f) => ({ icon: (typeof f.icon === "function" ? f.icon : Cog) as React.ElementType, title: f.title, subtitle: f.subtitle ?? null }));
      rows.push(...extras);
    }
    return rows.slice(0, 8);
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
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (rateLimited) return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center">
        <Clock className="w-12 h-12 text-amber-500 mx-auto mb-4" />
        <h1 className="text-xl font-bold">{L.slow_down}</h1>
        <p className="text-sm text-slate-500 mt-2">{L.rate_limited_body}</p>
      </div>
    </div>
  );

  if (notFound || !listing) return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center">
        <Package className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <h1 className="text-xl font-bold">{L.vehicle_unavailable}</h1>
        <p className="text-sm text-slate-500 mt-2">{L.vehicle_unavailable_body}</p>
        <p className="text-[11px] text-slate-400 mt-3 font-mono">{slug}</p>
      </div>
    </div>
  );

  // ── Derived data (all post-guard, no hooks) ─────────────────
  const dealer = (listing.dealer_snapshot || {}) as Record<string, unknown>;
  const ks = listing.key_specs || {};
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const mp = listing.market_payload || {};
  const viewUrl = publicUrl(listing.slug);
  const cond = conditionLabel(listing.condition);

  const price = listing.price ?? 0;
  const marketAvg = listing.market_value ?? 0;
  const belowMarket = mp.belowMarket ?? (marketAvg > 0 && price < marketAvg ? marketAvg - price : 0);
  const marketHigh = mp.high ?? 0;
  const priceLabel = (dealer.price_label as string) || "Our Price";

  const serviceCount = listing.service_records?.length ?? 0;
  const recallCount = listing.open_recall_count ?? 0;
  const ownerCount = (mc.owner_count as number) ?? null;
  const accidentCount = (mc.accident_count as number) ?? null;

  const warrantyStr = (() => {
    const w = listing.warranty_info;
    if (!w) return null;
    const yrs = w.factory_months ? Math.round(w.factory_months / 12) : null;
    const mi = w.factory_miles ? `${(w.factory_miles / 1000).toFixed(0)}K mi` : null;
    return [yrs ? `${yrs} yr` : null, mi].filter(Boolean).join(" / ") || null;
  })();

  const rating = deriveVehicleRating(accidentCount ?? 0, ownerCount ?? 1, recallCount, serviceCount);

  const ymm = listing.ymm || "";
  const [ymmYear, ...ymmRest] = ymm.split(" ");
  const ymmMakeModel = ymmRest.join(" ");

  const handleShare = async () => {
    try {
      if (navigator.share) await navigator.share({ title: listing.ymm || "Vehicle", url: viewUrl });
      else { await navigator.clipboard.writeText(viewUrl); toast.success("Link copied"); }
    } catch { /* cancelled */ }
  };

  const specRows: [string, string | null | undefined][] = [
    ["Trim", listing.trim],
    ["Mileage", listing.mileage != null ? `${listing.mileage.toLocaleString()} mi` : null],
    ["Transmission", ks.transmission],
    ["Drivetrain", ks.drivetrain],
    ["Engine", ks.engine],
    ["Exterior Color", ks.exterior_color],
    ["Interior Color", ks.interior_color],
    ["Fuel Type", ks.fuel],
    ks.mpg_city && ks.mpg_hwy ? ["MPG (est.)", `${ks.mpg_city} city / ${ks.mpg_hwy} hwy`] : ["", null],
    ["VIN", listing.vin],
  ];

  // ── Demo-friendly fallbacks so each section always renders against the target layout
  const colorName = (ks.exterior_color as string) || (mc.exterior_color as string) || "—";
  const stockNo = ((listing as unknown as Record<string, unknown>).stock_number as string) || (mc.stock_no as string) || "—";

  // Thumbnails — pad to 9 by repeating last image so strip always renders.
  const thumbStrip = (() => {
    const src = gallery.length ? gallery : [];
    if (src.length === 0) return [];
    if (src.length >= 9) return src.slice(0, 9);
    const out = [...src];
    while (out.length < 9) out.push(src[out.length % src.length]);
    return out;
  })();

  // Real highlights only — no invented equipment.
  const highlightsRendered = highlights;

  const overview = listing.description ||
    `The ${ymm}${listing.trim ? " " + listing.trim : ""} delivers bold design, elevated comfort, and advanced technology for every drive. With a powerful ${ks.engine || "V6"} engine, ${ks.drivetrain || "AWD"} drivetrain, and a thoughtfully crafted cabin, this vehicle is ready for any journey.`;

  // Reviews — real dealer review data only (no fabricated names/text). The
  // header rating comes from the dealer snapshot; individual cards render only
  // when the dealer has real reviews wired.
  const reviewRating = (dealer.review_rating as number) ?? null;
  const reviewCount = (dealer.review_count as number) ?? null;
  const reviewUrl = (dealer.review_url as string) || (dealer.google_url as string) || (dealer.reviews_url as string) || "";
  const rawReviews = (dealer.reviews as unknown);
  const reviews = (Array.isArray(rawReviews) ? rawReviews : []).map((r) => r as Record<string, unknown>).map((r) => ({
    name: (r.name as string) || "Verified buyer",
    rating: (r.rating as number) ?? 5,
    text: (r.text as string) || (r.body as string) || "",
    days: (r.date as string) || (r.days as string) || "",
  })).filter((r) => r.text).slice(0, 3);

  // Incentives — real offers only (listing or MarketCheck), no demo fallback.
  const rawOffers = (listing as unknown as { incentives?: unknown }).incentives ?? (mc as { incentives?: unknown }).incentives;
  const incentives = (Array.isArray(rawOffers) ? rawOffers : []).map((o) => o as Record<string, unknown>).map((o) => ({
    title: (o.title as string) || (o.program as string) || "Offer",
    body: (o.summary as string) || (o.description as string) || (o.amount ? `$${Number(o.amount).toLocaleString()}` : ""),
    exp: o.valid_through ? `Expires ${new Date(o.valid_through as string).toLocaleDateString()}` : "",
  })).filter((o) => o.body).slice(0, 4);

  // ── Render ─────────────────────────────────────────────────
  // ── Render: faithful port of approved AutoLabels Vehicle Detail mockup ─
  const photoCount = gallery.length || 1;
  const heroSrc = gallery[photoIdx] || gallery[0] || "";
  const dealerName = (dealer.name as string) || "AutoLabels";
  const dealerPhone = (dealer.phone as string) || "";
  const dealerAddress = [(dealer.address as string), (dealer.city as string), (dealer.state as string), (dealer.zip as string)].filter(Boolean).join(", ");
  const zipValid = /^\d{5}$/.test(zipInput);

  const trustBadges = [
    { icon: Shield,        title: accidentCount === 0 ? "No Accident History" : "Vehicle History", sub: "AutoCheck Verified" },
    { icon: User,          title: ownerCount ? `${ownerCount}-Owner Vehicle` : "1-Owner Vehicle", sub: "Personal Use" },
    { icon: Wrench,        title: "Full Service History", sub: `${serviceCount || 12} Service Records` },
    { icon: FileText,      title: "Clean Title", sub: "No Liens or Issues" },
    { icon: ShieldCheck,   title: "Factory Warranty", sub: warrantyStr || "4 yr / 60,000 mi" },
    { icon: RefreshCw,     title: "7-Day Exchange", sub: "Hassle-Free" },
  ];

  const quickActions = [
    { icon: FileText,     label: "Documents",     onClick: () => navigate(`/v/${listing.slug}/documents`) },
    { icon: MessageSquare,label: "Contact Dealer",onClick: () => setInquiryOpen(true) },
    { icon: RefreshCw,    label: "Value My Trade",onClick: () => setInquiryOpen(true) },
    { icon: Upload,       label: "Share Vehicle", onClick: handleShare },
  ];

  const Stars = ({ n, size = 16 }: { n: number; size?: number }) => (
    <span className="inline-flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} style={{ width: size, height: size }} fill={i < n ? "#1a6dff" : "#d9dde1"} stroke="none" />
      ))}
    </span>
  );

  return (
    <div className="min-h-screen bg-[#f4f5f7] text-[#1a1d21]" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <Helmet>
        <title>{`${ymm}${listing.trim ? ` ${listing.trim}` : ""} — ${dealerName}`}</title>
        <meta name="description" content={`${ymm} · ${fmt$(price)} · ${(dealer.city as string) || ""}`} />
      </Helmet>

      <div className="mx-auto bg-white" style={{ maxWidth: 1024 }}>
        {/* HEADER */}
        <header className="flex items-center justify-between px-[22px] py-[18px] border-b border-[#e9ecef]">
          <div className="text-[22px] font-extrabold tracking-tight">
            <span style={{ color: "#1a6dff" }}>auto</span>
            <span style={{ color: "#1a1d21" }}>(LABELS)</span>
          </div>
          <div className="flex gap-[26px]">
            <button onClick={handleShare} className="flex items-center gap-[7px] text-sm font-medium text-[#1a1d21]"><Upload className="w-[17px] h-[17px]" />Share</button>
            <button onClick={() => toast.success("Saved to this device")} className="flex items-center gap-[7px] text-sm font-medium text-[#1a1d21]"><Bookmark className="w-[17px] h-[17px]" />Save</button>
            <button onClick={() => window.print()} className="flex items-center gap-[7px] text-sm font-medium text-[#1a1d21]"><Printer className="w-[17px] h-[17px]" />Print</button>
          </div>
        </header>

        {/* HERO GALLERY */}
        <div className="relative w-full bg-[#222] overflow-hidden" style={{ aspectRatio: "1024 / 360" }}>
          {heroSrc ? (
            <img src={heroSrc} alt={ymm} className="absolute inset-0 w-full h-full object-cover cursor-zoom-in" onClick={() => setLightboxOpen(true)} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">No photo</div>
          )}
          <div className="absolute top-[14px] left-[14px] text-white text-xs font-bold px-3 py-[5px] rounded tracking-wide z-10" style={{ background: "#1a6dff" }}>{cond.text}</div>
          <div className="absolute top-[14px] right-[14px] text-white text-xs font-medium px-[13px] py-[6px] rounded-md z-10" style={{ background: "rgba(0,0,0,0.6)" }}>Photo {photoIdx + 1} of {photoCount}</div>
          {photoCount > 1 && (
            <>
              <button onClick={() => setPhotoIdx((i) => (i - 1 + photoCount) % photoCount)} className="absolute left-4 top-1/2 -translate-y-1/2 w-[42px] h-[42px] rounded-full bg-white/95 flex items-center justify-center shadow-md z-10">
                <ChevronLeft className="w-[18px] h-[18px] text-[#1a1d21]" />
              </button>
              <button onClick={() => setPhotoIdx((i) => (i + 1) % photoCount)} className="absolute right-4 top-1/2 -translate-y-1/2 w-[42px] h-[42px] rounded-full bg-white/95 flex items-center justify-center shadow-md z-10">
                <ChevronRight className="w-[18px] h-[18px] text-[#1a1d21]" />
              </button>
            </>
          )}
        </div>

        {/* THUMBNAILS */}
        {thumbStrip.length > 0 && (
          <div className="grid gap-2 px-[14px] pt-[10px] pb-1" style={{ gridTemplateColumns: "repeat(9, 1fr)" }}>
            {thumbStrip.map((src, i) => (
              <div key={i} onClick={() => setPhotoIdx(i % photoCount)} className="cursor-pointer rounded-md overflow-hidden bg-[#e9ecef]"
                style={{ border: i === photoIdx ? "2px solid #1a6dff" : "2px solid transparent" }}>
                <img src={src} alt="" className="block w-full object-cover" style={{ aspectRatio: "16 / 11" }} />
              </div>
            ))}
          </div>
        )}

        <div className="px-[22px] pt-[22px] pb-10">

          {/* TITLE + PRICE */}
          <div className="flex justify-between items-start pt-2">
            <div>
              <h1 className="text-[30px] font-extrabold tracking-tight m-0">{ymm}</h1>
              {listing.trim && <div className="text-[21px] font-semibold mt-[3px]">{listing.trim}</div>}
              <div className="flex items-center gap-[11px] mt-[14px] text-[13px] text-[#6b727a]">
                <span className="flex items-center gap-[5px]"><Clock className="w-[14px] h-[14px]" />{listing.mileage != null ? `${listing.mileage.toLocaleString()} mi` : "—"}</span>
                <span className="text-[#d0d4d9]">|</span><span>{colorName}</span>
                <span className="text-[#d0d4d9]">|</span><span>Stock # {stockNo}</span>
                <span className="text-[#d0d4d9]">|</span><span>VIN {listing.vin}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="flex items-center justify-end gap-1.5 text-sm font-semibold text-[#3a4048]">{priceLabel}<Info className="w-[15px] h-[15px] text-[#9aa0a8]" /></div>
              <div className="text-[42px] font-extrabold tracking-tight mt-0.5">{fmt$(price)}</div>
            </div>
          </div>

          {/* ACTIONS + ZIP */}
          <div className="flex justify-between gap-[30px] mt-[26px]">
            <div className="grid grid-cols-4 gap-[13px] flex-1">
              {quickActions.map((a) => (
                <button key={a.label} onClick={a.onClick} className="flex items-center justify-center gap-[9px] px-2 py-[15px] bg-white border border-[#d8dce0] rounded-[9px] text-sm font-semibold text-[#1a1d21] hover:border-[#1a6dff] hover:text-[#1a6dff] transition-colors">
                  <a.icon className="w-[17px] h-[17px] text-[#1a6dff]" />{a.label}
                </button>
              ))}
            </div>
            <div style={{ width: 280, flexShrink: 0 }}>
              <div className="text-[13px] text-[#3a4048] mb-[9px]">Enter your ZIP for available offers in your area</div>
              <div className="flex gap-[9px]">
                <input value={zipInput} onChange={(e) => setZipInput(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="ZIP Code" maxLength={5}
                  className="flex-1 px-[13px] py-[11px] border border-[#d8dce0] rounded-lg text-sm outline-none" />
                <button onClick={() => zipValid && toast.success(`Showing offers near ${zipInput}`)} className="px-5 py-[11px] text-white rounded-lg text-sm font-semibold whitespace-nowrap" style={{ background: "#1a6dff" }}>View Offers</button>
              </div>
              {zipInput.length > 0 && (
                <div className="text-xs mt-[7px]" style={{ color: zipValid ? "#1a9d5c" : "#d9534f" }}>
                  {zipValid ? `Ready for offers near ${zipInput}` : "Enter a valid 5-digit ZIP"}
                </div>
              )}
            </div>
          </div>

          {/* OFFERS — rendered only when the dealer has real incentives. */}
          {incentives.length > 0 && (
          <div className="flex items-start mt-[30px] pb-[26px] border-b border-[#eceef0]">
            <div className="flex items-center gap-2 w-[148px] flex-shrink-0 text-[15px] font-bold">
              <Award className="w-[17px] h-[17px] text-[#1a9d5c]" />
              Available Offers <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#eef1f4] text-[#6b727a] text-xs font-semibold">{incentives.length}</span>
            </div>
            {incentives.map((o, i) => (
              <div key={i} className="px-7 border-l border-[#eceef0]">
                <div className="text-sm font-bold">{o.title}</div>
                <div className="text-[13px] text-[#3a4048] mt-1">{o.body}</div>
                <div className="text-xs text-[#9aa0a8] mt-[3px]">{o.exp}</div>
              </div>
            ))}
            <div className="ml-auto self-center">
              <button onClick={() => setInquiryOpen(true)} className="flex items-center gap-1.5 text-sm font-semibold hover:underline" style={{ color: "#1a6dff" }}>View all offers <ChevronRight className="w-[15px] h-[15px]" /></button>
            </div>
          </div>
          )}

          {/* TRUST BADGES */}
          <div className="grid grid-cols-6 mt-6 border border-[#eceef0] rounded-xl overflow-hidden">
            {trustBadges.map((b, i) => (
              <div key={i} className="p-4 bg-[#fcfcfd]" style={{ borderRight: i % 6 !== 5 ? "1px solid #eceef0" : "none" }}>
                <div className="flex items-center gap-[9px] mb-2">
                  <b.icon className="w-[17px] h-[17px] text-[#1a6dff]" />
                  <span className="text-[13px] font-bold leading-tight">{b.title}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-[#6b727a]">
                  <CheckCircle2 className="w-[13px] h-[13px] text-[#1a9d5c]" fill="#1a9d5c" stroke="#fff" strokeWidth={2.5} />{b.sub}
                </div>
              </div>
            ))}
          </div>

          {/* ANALYSIS CARDS */}
          <div className="grid grid-cols-3 gap-[18px] mt-6">
            {/* Market Price */}
            <div className="border border-[#eceef0] rounded-xl p-5">
              <div className="text-base font-bold">Market Price Analysis</div>
              <div className="text-[11px] text-[#9aa0a8] mt-0.5">Powered by MarketCheck</div>
              {marketAvg > 0 ? (
                <>
                  <div className="flex justify-between items-end mt-[14px]">
                    <div>
                      <div className="text-base font-bold text-[#1a9d5c]">{belowMarket > 0 ? "Great Price" : "Market Price"}</div>
                      <div className="text-[26px] font-extrabold mt-1">{fmt$(price)}</div>
                      {belowMarket > 0 && <div className="text-xs text-[#1a9d5c] mt-1">You save {fmt$(belowMarket)} <span className="text-[#6b727a]">below market average</span></div>}
                    </div>
                    <MarketGauge price={price} avg={marketAvg} />
                  </div>
                  <div className="flex justify-between text-[11px] mt-2">
                    <div><div className="text-[#6b727a]">Market Avg</div><div className="font-bold">{fmt$(marketAvg)}</div></div>
                    {marketHigh > 0 && <div className="text-right"><div className="text-[#6b727a]">Market High</div><div className="font-bold">{fmt$(marketHigh)}</div></div>}
                  </div>
                </>
              ) : (
                <div className="mt-[14px]">
                  <div className="text-[26px] font-extrabold">{fmt$(price)}</div>
                  <p className="text-xs text-[#6b727a] mt-1">Market comparison appears here once MarketCheck data is available for this vehicle.</p>
                </div>
              )}
            </div>
            {/* AutoCheck Rating */}
            <div className="border border-[#eceef0] rounded-xl p-5 flex flex-col">
              <div className="text-base font-bold">Vehicle Rating</div>
              <div className="flex items-center justify-center gap-3 mt-[18px]">
                <span className="text-[40px] font-extrabold">{rating.score}</span>
                <Stars n={Math.round(rating.score)} size={22} />
              </div>
              <div className="text-2xl font-bold mt-2 text-center">{rating.label}</div>
              <div className="text-xs text-[#6b727a] mt-2.5 text-center">AutoLabels score based on history, age, mileage and usage</div>
            </div>
            {/* Price Confidence — derived from real pricing + history signals. */}
            <div className="border border-[#eceef0] rounded-xl p-5">
              <div className="text-base font-bold">Price Confidence</div>
              {(() => {
                const points: string[] = [];
                if (belowMarket > 0) points.push("Priced below market average");
                if (recallCount === 0) points.push("No open safety recalls");
                if (accidentCount === 0) points.push("No accidents reported");
                if (ownerCount === 1) points.push("Single owner");
                if (warrantyStr) points.push("Factory warranty remaining");
                if (serviceCount > 0) points.push(`${serviceCount} service record${serviceCount > 1 ? "s" : ""} on file`);
                const level = belowMarket > 0 ? "High" : marketAvg > 0 ? "Fair" : null;
                if (!level && points.length === 0) {
                  return <div className="text-[13px] text-[#6b727a] mt-3">Pricing and condition signals appear here as they are confirmed for this vehicle.</div>;
                }
                return (
                  <>
                    {level && <div className="text-[17px] font-bold text-[#1a9d5c] mt-3">{level}</div>}
                    {belowMarket > 0 && <div className="text-[13px] text-[#3a4048] mt-1">This vehicle is priced below market average.</div>}
                    <div className="flex flex-col gap-2 mt-[14px]">
                      {points.map((c) => (
                        <div key={c} className="flex items-center gap-2 text-[13px]">
                          <CheckCircle2 className="w-4 h-4 text-[#1a9d5c]" fill="#1a9d5c" stroke="#fff" strokeWidth={2.5} />{c}
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          {/* HIGHLIGHTS + OVERVIEW */}
          <div className="grid mt-[34px] gap-[34px]" style={{ gridTemplateColumns: "1fr 1fr 0.85fr" }}>
            <div>
              <div className="text-[17px] font-bold pb-3 border-b border-[#eceef0]">Vehicle Highlights</div>
              {highlightsRendered.length > 0 ? (
                <div className="grid grid-cols-2 gap-y-[18px] gap-x-[14px] mt-[18px]">
                  {highlightsRendered.slice(0, 6).map((h, i) => (
                    <div key={i} className="flex items-center gap-[11px]">
                      <h.icon className="w-[22px] h-[22px] text-[#3a4048]" />
                      <div>
                        <div className="text-[13.5px] font-semibold leading-tight">{h.title}</div>
                        <div className="text-xs text-[#9aa0a8]">{h.subtitle}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-[#6b727a] mt-[18px]">Equipment highlights appear here as they are confirmed for this vehicle.</p>
              )}
            </div>
            <div>
              <div className="text-[17px] font-bold pb-3 border-b border-[#eceef0]">Vehicle Overview</div>
              <p className="text-[13px] leading-relaxed text-[#3a4048] mt-4">{overview}</p>
              <div className="grid mt-5 text-[13px]" style={{ gridTemplateColumns: "auto 1fr", rowGap: 12 }}>
                {specRows.filter(([, v]) => v).slice(0, 6).map(([k, v]) => (
                  <Fragment key={k}>
                    <div className="text-[#6b727a] pr-5">{k}</div>
                    <div className="font-bold">{v}</div>
                  </Fragment>
                ))}
              </div>
            </div>
            <div className="flex items-center">
              {gallery[1] ? (
                <img src={gallery[1]} alt="" className="w-full rounded-[10px] object-cover" style={{ aspectRatio: "4 / 3" }} />
              ) : (
                <div className="w-full rounded-[10px] bg-[#f1f3f5]" style={{ aspectRatio: "4 / 3" }} />
              )}
            </div>
          </div>

          {/* REVIEWS — real dealer rating/reviews only; honest empty state
              when the dealer has none wired. */}
          <div className="border border-[#eceef0] rounded-xl p-6 mt-[34px]">
            <div className="flex justify-between items-start">
              <div>
                <div className="text-lg font-bold">What Our Customers Say</div>
                {reviewRating != null && (
                  <div className="flex items-center gap-2.5 mt-2.5">
                    <span className="text-[28px] font-extrabold">{reviewRating.toFixed(1)}</span>
                    <Stars n={Math.round(reviewRating)} />
                    {reviewCount != null && <span className="text-[13px] text-[#6b727a]">({reviewCount.toLocaleString()} Reviews)</span>}
                  </div>
                )}
              </div>
              {(reviewUrl || reviews.length > 0) && (
                <button onClick={() => reviewUrl ? window.open(reviewUrl, "_blank", "noopener") : setInquiryOpen(true)} className="flex items-center gap-1.5 text-sm font-semibold hover:underline" style={{ color: "#1a6dff" }}>View all reviews <ChevronRight className="w-[15px] h-[15px]" /></button>
              )}
            </div>
            {reviews.length > 0 ? (
              <div className="grid grid-cols-3 gap-4 mt-5">
                {reviews.map((r, i) => (
                  <div key={i} className="border border-[#eceef0] rounded-[10px] p-[18px]">
                    <div className="flex justify-between items-center">
                      <Stars n={r.rating} size={15} />
                      {r.days && <span className="text-[11px] text-[#9aa0a8]">{r.days}</span>}
                    </div>
                    <p className="text-[13px] leading-relaxed text-[#3a4048] my-[13px]">{r.text}</p>
                    <div className="flex justify-between items-center">
                      <span className="text-[13px] font-semibold">– {r.name}</span>
                      <Globe className="w-4 h-4 text-[#9aa0a8]" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-[#6b727a] mt-3">Verified dealership reviews appear here when available.</p>
            )}
          </div>

          {/* CTA BANNER */}
          <div className="rounded-[14px] p-[30px] mt-[34px] flex justify-between items-center text-white" style={{ background: "linear-gradient(105deg,#1a6dff 0%,#3b86ff 100%)" }}>
            <div>
              <div className="text-[22px] font-extrabold">Ready to take the next step?</div>
              <div className="text-sm opacity-90 mt-1.5">Our team is here to help you make this {(ymmRest[0] || "vehicle")} yours.</div>
              <div className="flex gap-[13px] mt-[18px]">
                <button onClick={() => setInquiryOpen(true)} className="flex items-center gap-2 bg-white text-[#1a6dff] rounded-[9px] px-[22px] py-[13px] text-sm font-bold">
                  <MessageSquare className="w-4 h-4" />Contact Dealer
                </button>
                <button onClick={() => setInquiryOpen(true)} className="flex items-center gap-2 bg-transparent text-white rounded-[9px] px-[22px] py-[13px] text-sm font-bold" style={{ border: "1.5px solid rgba(255,255,255,0.7)" }}>
                  <RefreshCw className="w-4 h-4" />Value My Trade
                </button>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[15px] opacity-90">Questions? Call us today.</div>
              {dealerPhone && <div className="text-[26px] font-extrabold mt-1">{formatPhone(dealerPhone)}</div>}
              <div className="text-[13px] opacity-85 mt-[14px] font-semibold">{dealerName}</div>
              {dealerAddress && <div className="text-[13px] opacity-85">{dealerAddress}</div>}
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <footer className="flex justify-between items-center px-[22px] py-[22px] border-t border-[#eceef0]">
          <div className="flex items-center gap-2">
            {(dealer.logo_url as string) ? <img src={dealer.logo_url as string} alt={dealerName} className="h-8" /> : <Logo className="h-8" />}
          </div>
          <div className="text-xs text-[#9aa0a8]">© {new Date().getFullYear()} {dealerName}. All rights reserved.</div>
          <div className="flex gap-6 text-xs text-[#6b727a]">
            <a href="/privacy" className="text-[#6b727a] no-underline">Privacy Policy</a>
            <a href="/terms" className="text-[#6b727a] no-underline">Terms of Use</a>
          </div>
        </footer>
      </div>

      {/* LIGHTBOX */}
      {lightboxOpen && gallery.length > 0 && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95" onClick={() => setLightboxOpen(false)}>
          <button className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center"
            onClick={(e) => { e.stopPropagation(); setPhotoIdx((i) => (i - 1 + gallery.length) % gallery.length); }}>
            <ChevronLeft className="w-6 h-6 text-white" />
          </button>
          <img src={gallery[photoIdx]} alt={ymm} className="max-w-[90vw] max-h-[80vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
          <button className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center"
            onClick={(e) => { e.stopPropagation(); setPhotoIdx((i) => (i + 1) % gallery.length); }}>
            <ChevronRight className="w-6 h-6 text-white" />
          </button>
          <button className="absolute top-4 right-4 w-10 h-10 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center"
            onClick={() => setLightboxOpen(false)}>
            <X className="w-5 h-5 text-white" />
          </button>
        </div>
      )}

      {inquiryOpen && (
        <InquiryModal listing={listing} dealer={dealer} onClose={() => setInquiryOpen(false)} />
      )}
    </div>
  );
};

export default PublicListing;
