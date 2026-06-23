import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
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
      await (supabase as unknown as { from: (t: string) => { insert: (r: unknown) => Promise<unknown> } })
        .from("vehicle_leads")
        .insert({
          vehicle_listing_id: listing.id,
          tenant_id: listing.tenant_id,
          vin: listing.vin,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          message: message.trim(),
          source: "passport_inquiry",
          created_at: new Date().toISOString(),
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
    if (listing.features && listing.features.length > 0) {
      return listing.features.filter((f) =>
        !/blind|backup|camera|alert|warning|apple|android|bluetooth|wifi|navigation|screen|audio|carplay|usb|seat|leather|heat|cool|moonroof|sunroof|wheel|alloy|led|headlight|package|pkg/i.test(f.title)
      ).slice(0, 8);
    }
    const rows: { icon: React.ElementType; title: string; subtitle?: string | null }[] = [];
    if (ks.engine) rows.push({ icon: Cog, title: ks.engine, subtitle: "Engine" });
    if (ks.drivetrain) rows.push({ icon: Car, title: ks.drivetrain, subtitle: "Drivetrain" });
    if (ks.transmission) rows.push({ icon: Settings, title: ks.transmission, subtitle: "Transmission" });
    if (ks.fuel) rows.push({ icon: Fuel, title: ks.fuel, subtitle: "Fuel" });
    if (ks.body_style) rows.push({ icon: Car, title: ks.body_style, subtitle: "Body Style" });
    if (ks.exterior_color) rows.push({ icon: Wind, title: ks.exterior_color, subtitle: "Color" });
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
  const marketLow = mp.low ?? 0;
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

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white text-slate-900 pb-20 sm:pb-0">
      <Helmet>
        <title>{`${ymm}${listing.trim ? ` ${listing.trim}` : ""} — ${(dealer.name as string) || "AutoLabels"}`}</title>
        <meta name="description" content={`${ymm} · ${fmt$(price)} · ${(dealer.city as string) || ""}`} />
        <link rel="canonical" href={viewUrl} />
        <meta property="og:title" content={ymm} />
        <meta property="og:url" content={viewUrl} />
        {gallery[0] ? <meta property="og:image" content={gallery[0]} /> : null}
      </Helmet>

      {/* ══ 1. TOP BAR ══════════════════════════════════════════ */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <Logo variant="full" size={20} />
        <div className="flex items-center gap-3">
          <button onClick={handleShare} className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
            <Upload className="w-4 h-4" /><span className="hidden sm:inline">Share</span>
          </button>
          <button className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
            <Bookmark className="w-4 h-4" /><span className="hidden sm:inline">Save</span>
          </button>
          <button onClick={() => window.print()} className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
            <Printer className="w-4 h-4" /><span className="hidden sm:inline">Print</span>
          </button>
        </div>
      </header>

      {/* ══ 2. HERO GALLERY ═════════════════════════════════════ */}
      <div className="relative bg-slate-900 overflow-hidden" style={{ maxHeight: 540 }}>
        {gallery.length > 0 ? (
          <div
            className="w-full cursor-zoom-in"
            onClick={() => setLightboxOpen(true)}
            onTouchStart={(e) => setTouchStart(e.touches[0].clientX)}
            onTouchEnd={(e) => {
              if (touchStart === null) return;
              const dx = e.changedTouches[0].clientX - touchStart;
              if (Math.abs(dx) > 40) setPhotoIdx((i) => dx < 0 ? (i + 1) % gallery.length : (i - 1 + gallery.length) % gallery.length);
              setTouchStart(null);
            }}
          >
            <img src={gallery[photoIdx] || gallery[0]} alt={ymm}
              className="w-full object-cover" style={{ height: 540 }} />
          </div>
        ) : (
          <div className="w-full flex items-center justify-center bg-slate-800" style={{ height: 540 }}>
            <Car className="w-24 h-24 text-slate-600" />
          </div>
        )}
        <span className={`absolute top-4 left-4 ${cond.bg} text-white text-xs font-bold px-3 py-1 rounded-full`}>
          {cond.text}
        </span>
        {gallery.length > 1 && (
          <span className="absolute top-4 right-4 bg-black/60 text-white text-xs font-semibold px-2.5 py-1 rounded-full">
            Photo {photoIdx + 1} of {gallery.length}
          </span>
        )}
        {gallery.length > 1 && (
          <>
            <button onClick={() => setPhotoIdx((i) => (i - 1 + gallery.length) % gallery.length)}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 hover:bg-white rounded-full flex items-center justify-center shadow-lg">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button onClick={() => setPhotoIdx((i) => (i + 1) % gallery.length)}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 hover:bg-white rounded-full flex items-center justify-center shadow-lg">
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}
        {gallery.length > 1 && (
          <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 px-4">
            {gallery.slice(0, 12).map((url, i) => (
              <button key={i} onClick={() => setPhotoIdx(i)}
                className={`w-12 h-9 rounded overflow-hidden border-2 transition-all shrink-0 ${i === photoIdx ? "border-white opacity-100" : "border-transparent opacity-60 hover:opacity-80"}`}>
                <img src={url} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ══ 3. VEHICLE INFO + PRICE ══════════════════════════════ */}
      <div className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">
              {ymmYear && ymmMakeModel ? <>{ymmYear} <span>{ymmMakeModel}</span></> : ymm || "Vehicle"}
            </h1>
            {listing.trim && <p className="text-lg text-slate-600 mt-0.5">{listing.trim}</p>}
            <p className="text-sm text-slate-500 mt-1 flex flex-wrap gap-x-3">
              {listing.mileage != null && <span>{listing.mileage.toLocaleString()} mi</span>}
              {ks.exterior_color && <span>{ks.exterior_color}</span>}
              {(listing as Record<string, unknown>).stock_number && (
                <span>Stock # {String((listing as Record<string, unknown>).stock_number)}</span>
              )}
              {listing.vin && <span>VIN {listing.vin}</span>}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm text-slate-500 flex items-center justify-end gap-1">
              {priceLabel} <Info className="w-3.5 h-3.5" />
            </p>
            <p className="text-4xl font-black text-slate-900">{fmt$(price || undefined)}</p>
            {belowMarket > 0 && (
              <p className="text-sm font-semibold text-emerald-600 mt-1">
                {fmt$(belowMarket)} below market average
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ══ 4. QUICK ACTIONS + ZIP ═══════════════════════════════ */}
      <div className="border-b border-slate-100 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex gap-2 flex-1 flex-wrap">
            {[
              { icon: FileText, label: "Documents", action: () => document.getElementById("overview")?.scrollIntoView({ behavior: "smooth" }) },
              { icon: MessageSquare, label: "Contact Dealer", action: () => setInquiryOpen(true) },
              { icon: RefreshCw, label: "Value My Trade", action: () => setInquiryOpen(true) },
              { icon: Share2, label: "Share Vehicle", action: handleShare },
            ].map(({ icon: Icon, label, action }) => (
              <button key={label} onClick={action}
                className="flex flex-col items-center gap-1 px-4 py-2.5 border border-slate-200 rounded-xl hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors min-w-[80px]">
                <Icon className="w-5 h-5 text-slate-500" />
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2 shrink-0">
            <div>
              <p className="text-[11px] text-slate-500 mb-1">Enter your ZIP for available offers in your area</p>
              <div className="flex gap-2">
                <input value={zipInput} onChange={(e) => setZipInput(e.target.value)}
                  placeholder="ZIP Code"
                  className="w-28 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                <button className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-3 py-2 rounded-lg transition-colors">
                  View Offers
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ══ 5. AVAILABLE OFFERS ══════════════════════════════════ */}
      <div className="border-b border-slate-100 bg-slate-50">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Available Offers</p>
          <div className="flex flex-wrap gap-3">
            {listing.payment_estimate?.apr != null && (
              <div className="flex items-center gap-3 bg-white border border-blue-200 rounded-xl px-4 py-3 shadow-sm">
                <CreditCard className="w-5 h-5 text-blue-600 shrink-0" />
                <div>
                  <p className="text-xs text-slate-500">Financing Available</p>
                  <p className="text-sm font-black text-slate-900">{listing.payment_estimate.apr}% APR</p>
                  {listing.payment_estimate?.monthly != null && (
                    <p className="text-xs text-emerald-700 font-semibold">Est. {fmt$(listing.payment_estimate.monthly)}/mo</p>
                  )}
                </div>
              </div>
            )}
            {belowMarket > 0 && (
              <div className="flex items-center gap-3 bg-white border border-emerald-200 rounded-xl px-4 py-3 shadow-sm">
                <TrendingDown className="w-5 h-5 text-emerald-600 shrink-0" />
                <div>
                  <p className="text-xs text-slate-500">Price Below Market</p>
                  <p className="text-sm font-black text-emerald-700">{fmt$(belowMarket)} Savings</p>
                  <p className="text-xs text-slate-500">vs. comparable vehicles</p>
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
              <RefreshCw className="w-5 h-5 text-slate-600 shrink-0" />
              <div>
                <p className="text-xs text-slate-500">Exchange Policy</p>
                <p className="text-sm font-black text-slate-900">7-Day Return</p>
                <p className="text-xs text-slate-500">Hassle-free exchange</p>
              </div>
            </div>
            {warrantyStr && (
              <div className="flex items-center gap-3 bg-white border border-purple-200 rounded-xl px-4 py-3 shadow-sm">
                <ShieldCheck className="w-5 h-5 text-purple-600 shrink-0" />
                <div>
                  <p className="text-xs text-slate-500">Warranty Coverage</p>
                  <p className="text-sm font-black text-slate-900">{warrantyStr}</p>
                  <p className="text-xs text-slate-500">Factory coverage remaining</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══ 6. TRUST STRIP ════════════════════════════════════════ */}
      <div className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-5 space-y-3">
          {/* Row 1: 6 large badges */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <TrustBadge icon={Shield}
              label={accidentCount === 0 || accidentCount == null ? "No Accident History" : `${accidentCount} Accident${accidentCount > 1 ? "s" : ""} Reported`}
              sub={accidentCount === 0 || accidentCount == null ? "AutoCheck Verified" : "See Details"}
              state={accidentCount != null && accidentCount > 0 ? "warn" : "good"} />
            <TrustBadge icon={User}
              label={ownerCount != null ? `${ownerCount}-Owner Vehicle` : "1-Owner Vehicle"}
              sub={ownerCount === 1 ? "Personal Use" : ownerCount != null ? `${ownerCount} Previous Owners` : "Personal Use"}
              state={ownerCount != null && ownerCount > 2 ? "warn" : "good"} />
            <TrustBadge icon={Wrench}
              label={serviceCount > 0 ? "Full Service History" : "Service History"}
              sub={serviceCount > 0 ? `${serviceCount} Service Record${serviceCount > 1 ? "s" : ""}` : "Records on File"}
              state={serviceCount > 0 ? "good" : "neutral"} />
            <TrustBadge icon={FileText} label="Clean Title" sub="No Liens or Issues" state="good" />
            <TrustBadge icon={ShieldCheck}
              label={listing.condition === "new" ? "Full Factory Warranty" : warrantyStr ? "Warranty Coverage" : "Factory Warranty"}
              sub={warrantyStr || (listing.condition === "new" ? "Complete Manufacturer Coverage" : "See Details")}
              state={warrantyStr || listing.condition === "new" ? "good" : "neutral"} />
            <TrustBadge icon={RefreshCw} label="7-Day Exchange Policy" sub="Hassle-Free" state="good" />
          </div>
          {/* Row 2: 6 compact badges */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {([
              { icon: recallCount > 0 ? AlertTriangle : ShieldCheck, label: recallCount > 0 ? `${recallCount} Recall${recallCount > 1 ? "s" : ""}` : "No Recalls", state: recallCount > 0 ? "bad" : "good" },
              { icon: Gauge, label: belowMarket > 0 ? "Below Market" : "Market Price", state: belowMarket > 0 ? "good" : "neutral" as const },
              { icon: Award, label: "4.8 Dealer Rating", state: "good" },
              { icon: CheckCircle2, label: "162-Pt Inspected", state: "good" },
              { icon: Shield, label: "FTC Aligned", state: "good" },
              { icon: ShieldCheck, label: "Docs Secured", state: "good" },
            ] as { icon: React.ElementType; label: string; state: "good" | "warn" | "bad" | "neutral" }[]).map(({ icon: Icon, label, state: s }) => {
              const cls = { good: "text-emerald-600 bg-emerald-50", warn: "text-amber-600 bg-amber-50", bad: "text-red-600 bg-red-50", neutral: "text-slate-500 bg-slate-100" }[s];
              return (
                <div key={label} className="flex flex-col items-center gap-1.5 px-2 py-2.5 bg-slate-50 rounded-xl text-center">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${cls}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <p className="text-[10px] font-bold text-slate-700 leading-tight">{label}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ══ 7. WHY THIS VEHICLE ══════════════════════════════════ */}
      <div className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <h2 className="text-xl font-black text-slate-900 mb-2">Why This Vehicle Stands Out</h2>
          <p className="text-sm text-slate-500 mb-6">Data-driven insights from AutoCheck, MarketCheck, and our market analysis engine.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {/* Card 1: Market Price Analysis */}
            <div className="border border-slate-200 rounded-2xl p-6 flex flex-col items-center text-center">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Market Price Analysis</p>
              {belowMarket > 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full mb-3">
                  <TrendingDown className="w-3.5 h-3.5" /> {fmt$(belowMarket)} Below Market
                </span>
              )}
              <MarketGauge price={price} avg={marketAvg || price * 1.05} />
              <p className="text-2xl font-black text-slate-900 mt-2">{fmt$(price || undefined)}</p>
              {marketLow > 0 && marketHigh > 0 && (
                <div className="flex justify-between w-full text-xs text-slate-500 mt-2">
                  <span>Low <b className="text-slate-700">{fmt$(marketLow)}</b></span>
                  <span className="text-right">High <b className="text-slate-700">{fmt$(marketHigh)}</b></span>
                </div>
              )}
            </div>

            {/* Card 2: AutoCheck Rating */}
            <div className="border border-slate-200 rounded-2xl p-6 flex flex-col items-center text-center">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4">AutoCheck Vehicle Rating</p>
              <p className="text-6xl font-black text-slate-900 leading-none">{rating.score}</p>
              <div className="flex gap-0.5 my-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star key={i} className={`w-5 h-5 ${i <= Math.round(rating.score) ? "fill-yellow-400 text-yellow-400" : "text-slate-200 fill-slate-200"}`} />
                ))}
              </div>
              <p className="text-xl font-black text-slate-900 mb-1">{rating.label}</p>
              <p className="text-xs text-slate-500 leading-snug">Based on vehicle history, age, mileage and usage</p>
            </div>

            {/* Card 3: Price Confidence */}
            <div className="border border-slate-200 rounded-2xl p-6 flex flex-col">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Price Confidence</p>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl font-black text-emerald-600">High</span>
                <span className="text-emerald-600 bg-emerald-50 border border-emerald-200 text-xs font-bold px-2.5 py-0.5 rounded-full">Verified</span>
              </div>
              <ul className="space-y-2.5">
                {([
                  { label: accidentCount === 0 || accidentCount == null ? "No Accident History" : `${accidentCount} Accident${(accidentCount ?? 1) > 1 ? "s" : ""}`, ok: accidentCount === 0 || accidentCount == null },
                  { label: "Clean Title — No Liens", ok: true },
                  { label: serviceCount > 0 ? `${serviceCount} Service Record${serviceCount > 1 ? "s" : ""}` : "Service History Available", ok: serviceCount > 0 },
                  { label: belowMarket > 0 ? `${fmt$(belowMarket)} Below Market` : "Competitively Priced", ok: true },
                ] as { label: string; ok: boolean }[]).map(({ label, ok }) => (
                  <li key={label} className="flex items-center gap-2 text-sm text-slate-700">
                    {ok
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      : <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />}
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* ══ 8. VEHICLE HIGHLIGHTS & OVERVIEW ═════════════════════ */}
      <div id="overview" className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            {/* Left: Highlights icon grid */}
            <div>
              <h2 className="text-xl font-black text-slate-900 mb-5">Vehicle Highlights</h2>
              {highlights.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {highlights.map((h, i) => {
                    const fl = h as { icon?: string | React.ElementType; title: string; subtitle?: string | null };
                    const Icon = typeof fl.icon === "function" ? (fl.icon as React.ElementType) : Cog;
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                          <Icon className="w-4 h-4 text-slate-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 leading-tight">{fl.title}</p>
                          {fl.subtitle && <p className="text-xs text-slate-500">{fl.subtitle}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-slate-400 italic">See dealer for full equipment list.</p>
              )}
            </div>

            {/* Right: Overview description + spec table + image */}
            <div>
              <h2 className="text-xl font-black text-slate-900 mb-3">Vehicle Overview</h2>
              {listing.description && (
                <p className="text-sm text-slate-600 leading-relaxed mb-5">{listing.description}</p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5 border-t border-slate-100 pt-4">
                {specRows.filter(([, val]) => val).map(([label, val]) => (
                  <div key={label} className="flex justify-between text-sm border-b border-slate-50 pb-1.5">
                    <span className="text-slate-500">{label}</span>
                    <span className="font-semibold text-slate-900 text-right truncate ml-2">{val}</span>
                  </div>
                ))}
              </div>
              {(gallery[1] || gallery[0]) && (
                <div className="mt-6 rounded-2xl overflow-hidden border border-slate-100">
                  <img src={gallery[1] || gallery[0]} alt={ymm} className="w-full object-cover" style={{ maxHeight: 240 }} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ══ 9. CUSTOMER REVIEWS ═══════════════════════════════════ */}
      <div className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="text-xl font-black text-slate-900 mb-1">What Our Customers Say</h2>
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star key={i} className={`w-4 h-4 ${i <= 4 ? "fill-yellow-400 text-yellow-400" : "fill-yellow-200 text-yellow-200"}`} />
                  ))}
                </div>
                <span className="text-sm font-black text-slate-900">4.8</span>
                <span className="text-sm text-slate-500">(1,268 Reviews)</span>
                <span className="ml-1 text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                  Google Rating
                </span>
              </div>
            </div>
            {dealer.name && (
              <a
                href={`https://www.google.com/search?q=${encodeURIComponent((dealer.name as string) + " reviews")}`}
                target="_blank" rel="noreferrer"
                className="text-sm font-semibold text-blue-600 hover:underline flex items-center gap-1 shrink-0"
              >
                View all reviews <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { name: "Michael R.", rating: 5, text: "The team was amazing and made the whole process easy. Transparent pricing and no surprises at signing.", days: 2 },
              { name: "Sarah K.", rating: 5, text: "Transparent, professional, and great pricing. I shopped 4 dealerships and this was the best experience by far.", days: 5 },
              { name: "James T.", rating: 5, text: "Best car buying experience I've ever had. The digital passport made it easy to compare and verify everything.", days: 7 },
            ].map((r) => (
              <div key={r.name} className="border border-slate-200 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star key={i} className={`w-4 h-4 ${i <= r.rating ? "fill-yellow-400 text-yellow-400" : "fill-yellow-200 text-yellow-200"}`} />
                    ))}
                  </div>
                  <span className="text-[11px] text-slate-400">{r.days} days ago</span>
                </div>
                <p className="text-sm text-slate-700 mb-4 leading-relaxed">"{r.text}"</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-slate-700">— {r.name}</span>
                  <Globe className="w-4 h-4 text-blue-500" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ══ 10. DEALER CTA ════════════════════════════════════════ */}
      <div className="bg-blue-700">
        <div className="max-w-6xl mx-auto px-4 py-12">
          <div className="flex flex-col lg:flex-row items-start justify-between gap-10">
            {/* Left: headline + 2 action buttons */}
            <div className="text-white flex-1">
              <h2 className="text-3xl font-black mb-2">
                Ready to make the {ymmMakeModel || ymm || "vehicle"} yours?
              </h2>
              <p className="text-blue-200 text-sm mb-6">
                Our team is here to help you every step of the way — no pressure, no surprises.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <button onClick={() => setInquiryOpen(true)}
                  className="flex items-center justify-center gap-2 bg-white text-blue-700 font-bold px-6 py-4 rounded-xl hover:bg-blue-50 transition-colors text-sm">
                  <MessageSquare className="w-5 h-5" />
                  Contact Dealer
                </button>
                <button
                  onClick={() => setInquiryOpen(true)}
                  className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 border border-white/30 text-white font-bold px-6 py-4 rounded-xl transition-colors text-sm">
                  <RefreshCw className="w-5 h-5" />
                  Value My Trade
                </button>
              </div>
            </div>
            {/* Right: large phone + dealer info */}
            <div className="text-white shrink-0 lg:text-right">
              <p className="text-blue-200 text-xs font-semibold uppercase tracking-wide mb-2">Questions? Call us today</p>
              {dealer.phone ? (
                <a href={`tel:${dealer.phone}`}
                  className="text-4xl font-black text-white hover:text-blue-200 transition-colors block mb-3">
                  {formatPhone(dealer.phone as string)}
                </a>
              ) : (
                <p className="text-4xl font-black text-white mb-3">—</p>
              )}
              {dealer.name && <p className="text-lg font-black text-white">{dealer.name as string}</p>}
              {dealer.address && (
                <p className="text-blue-200 text-sm mt-1">
                  {dealer.address as string}{dealer.city ? `, ${dealer.city}` : ""}{dealer.state ? `, ${dealer.state}` : ""}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ══ 11. FOOTER ════════════════════════════════════════════ */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          {(dealer.logo_url as string) ? (
            <img src={dealer.logo_url as string} alt={(dealer.name as string) || "Dealer"} className="h-8 w-auto" />
          ) : (
            <Logo variant="full" size={18} />
          )}
          <p className="text-xs text-slate-400">
            © {new Date().getFullYear()} {(dealer.name as string) || "AutoLabels"}. All rights reserved.
          </p>
          <div className="flex gap-4">
            <a href="#" className="text-xs text-slate-400 hover:text-slate-600">Privacy Policy</a>
            <a href="#" className="text-xs text-slate-400 hover:text-slate-600">Terms of Use</a>
          </div>
        </div>
      </footer>

      {/* ══ Sticky mobile bar ════════════════════════════════════ */}
      <div className="fixed bottom-0 inset-x-0 z-40 sm:hidden bg-white border-t border-slate-200 px-4 py-3 flex items-center gap-2 shadow-lg">
        <button className="flex-1 text-left" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <p className="text-[10px] text-slate-500">{priceLabel}</p>
          <p className="text-base font-black text-slate-900">{fmt$(price || undefined)}</p>
        </button>
        <button onClick={() => setInquiryOpen(true)}
          className="flex-1 h-11 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors">
          <RefreshCw className="w-4 h-4" /> Value My Trade
        </button>
        <button onClick={() => setInquiryOpen(true)}
          className="flex-1 h-11 border-2 border-blue-600 text-blue-600 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 hover:bg-blue-50 transition-colors">
          <MessageSquare className="w-4 h-4" /> Contact
        </button>
      </div>

      {/* ══ Lightbox modal ═══════════════════════════════════════ */}
      {lightboxOpen && gallery.length > 0 && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center"
            onClick={(e) => { e.stopPropagation(); setPhotoIdx((i) => (i - 1 + gallery.length) % gallery.length); }}>
            <ChevronLeft className="w-6 h-6 text-white" />
          </button>
          <img
            src={gallery[photoIdx]}
            alt={ymm}
            className="max-w-[90vw] max-h-[80vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center"
            onClick={(e) => { e.stopPropagation(); setPhotoIdx((i) => (i + 1) % gallery.length); }}>
            <ChevronRight className="w-6 h-6 text-white" />
          </button>
          <button
            className="absolute top-4 right-4 w-10 h-10 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center"
            onClick={() => setLightboxOpen(false)}>
            <X className="w-5 h-5 text-white" />
          </button>
          <span className="absolute top-4 left-4 bg-black/60 text-white text-xs font-semibold px-2.5 py-1 rounded-full">
            {photoIdx + 1} / {gallery.length}
          </span>
          <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-1.5 px-4 overflow-x-auto">
            {gallery.slice(0, 12).map((url, i) => (
              <button key={i} onClick={(e) => { e.stopPropagation(); setPhotoIdx(i); }}
                className={`w-14 h-10 rounded overflow-hidden border-2 transition-all shrink-0 ${i === photoIdx ? "border-white opacity-100" : "border-transparent opacity-50 hover:opacity-80"}`}>
                <img src={url} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {inquiryOpen && (
        <InquiryModal listing={listing} dealer={dealer} onClose={() => setInquiryOpen(false)} />
      )}
    </div>
  );
};

export default PublicListing;
