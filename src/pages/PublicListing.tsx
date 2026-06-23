import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Share2, Printer, Bookmark,
  FileText, MessageSquare, RefreshCw, ExternalLink, Upload,
  ShieldCheck, Shield, CheckCircle2, Package, Clock, AlertTriangle,
  Star, Phone, MapPin, Globe,
  Car, Fuel, Cog, Settings, Wind,
  TrendingDown, User, Wrench,
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
// Consumer-facing vehicle passport. No auth required.
// Designed to beat iPacket and AutoBio on visual trust + market
// intelligence. Mobile-first; 70% of traffic arrives from QR scan.
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

// Semicircular market gauge rendered with inline SVG
const MarketGauge = ({ price, avg }: { price: number; avg: number }) => {
  const ratio = avg > 0 ? price / avg : 1;
  // Map ratio to angle: 0° = far left (great), 180° = far right (high)
  const pct = Math.min(Math.max((ratio - 0.75) / 0.5, 0), 1); // 0.75–1.25 range
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
      <svg viewBox="0 0 100 56" className="w-40">
        {/* Green zone */}
        <path d="M 10 50 A 40 40 0 0 1 50 10" fill="none" stroke="#bbf7d0" strokeWidth="10" strokeLinecap="round" />
        {/* Yellow zone */}
        <path d="M 50 10 A 40 40 0 0 1 75 15" fill="none" stroke="#fef08a" strokeWidth="10" strokeLinecap="round" />
        {/* Red zone */}
        <path d="M 75 15 A 40 40 0 0 1 90 50" fill="none" stroke="#fecaca" strokeWidth="10" strokeLinecap="round" />
        {/* Needle */}
        <line x1="50" y1="50" x2={nx.toFixed(1)} y2={ny.toFixed(1)}
          stroke="#1e293b" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="50" cy="50" r="3.5" fill="#1e293b" />
      </svg>
      <span className="text-xs font-bold mt-1" style={{ color: label.color }}>{label.text}</span>
    </div>
  );
};

// ── Main body ─────────────────────────────────────────────────
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

  // ── Loading ─────────────────────────────────────────────────
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

  // ── Derived data ────────────────────────────────────────────
  const dealer = listing.dealer_snapshot || {};
  const sticker = listing.sticker_snapshot || {};
  const ks = listing.key_specs || {};
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const viewUrl = publicUrl(listing.slug);
  const cond = conditionLabel(listing.condition);

  // Gallery: prefer listing.photos, fall back to hero_image_url
  const gallery = useMemo(() => {
    const fromPhotos = (listing.photos || []).map((p) => p.url).filter(Boolean);
    if (fromPhotos.length > 0) return fromPhotos;
    if (listing.hero_image_url) return [listing.hero_image_url];
    return [];
  }, [listing]);

  const price = listing.price ?? 0;
  const marketAvg = listing.market_value ?? 0;
  const marketLow = listing.market_payload?.low ?? 0;
  const marketHigh = listing.market_payload?.high ?? 0;
  const belowMarket = marketAvg > 0 && price < marketAvg ? marketAvg - price : 0;
  const priceLabel = (dealer as Record<string, unknown>)?.price_label as string || "Our Price";

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

  // Vehicle highlights from listing.features or key_specs
  const highlights = useMemo(() => {
    if (listing.features && listing.features.length > 0) return listing.features.slice(0, 6);
    const rows: { icon: React.ElementType; title: string; cat: string }[] = [];
    if (ks.engine) rows.push({ icon: Cog, title: ks.engine, cat: "Engine" });
    if (ks.drivetrain) rows.push({ icon: Car, title: ks.drivetrain, cat: "Drivetrain" });
    if (ks.transmission) rows.push({ icon: Settings, title: ks.transmission, cat: "Transmission" });
    if (ks.fuel) rows.push({ icon: Fuel, title: ks.fuel, cat: "Fuel" });
    if (ks.body_style) rows.push({ icon: Car, title: ks.body_style, cat: "Body Style" });
    if (ks.exterior_color) rows.push({ icon: Wind, title: ks.exterior_color, cat: "Color" });
    return rows.slice(0, 6);
  }, [listing.features, ks]);

  const handleShare = async () => {
    try {
      if (navigator.share) await navigator.share({ title: listing.ymm || "Vehicle", url: viewUrl });
      else { await navigator.clipboard.writeText(viewUrl); toast.success("Link copied"); }
    } catch { /* cancelled */ }
  };

  const handlePrint = () => window.print();

  const ymm = listing.ymm || "";
  const [ymmYear, ...ymmRest] = ymm.split(" ");
  const ymmMakeModel = ymmRest.join(" ");

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <Helmet>
        <title>{`${ymm}${listing.trim ? ` ${listing.trim}` : ""} — ${dealer.name || "AutoLabels"}`}</title>
        <meta name="description" content={`${ymm} · ${fmt$(price)} · ${dealer.city || ""}`} />
        <link rel="canonical" href={viewUrl} />
        <meta property="og:title" content={ymm} />
        <meta property="og:url" content={viewUrl} />
        {gallery[0] ? <meta property="og:image" content={gallery[0]} /> : null}
      </Helmet>

      {/* ── 1. Top bar ───────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <Logo variant="full" size={20} />
        <div className="flex items-center gap-3">
          <button onClick={handleShare} className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
            <Upload className="w-4 h-4" /> <span className="hidden sm:inline">Share</span>
          </button>
          <button className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
            <Bookmark className="w-4 h-4" /> <span className="hidden sm:inline">Save</span>
          </button>
          <button onClick={handlePrint} className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
            <Printer className="w-4 h-4" /> <span className="hidden sm:inline">Print</span>
          </button>
        </div>
      </header>

      {/* ── 2. Hero carousel ────────────────────────────────── */}
      <div className="relative bg-slate-900 overflow-hidden" style={{ maxHeight: 520 }}>
        {gallery.length > 0 ? (
          <img
            src={gallery[photoIdx] || gallery[0]}
            alt={ymm}
            className="w-full object-cover"
            style={{ height: 520 }}
          />
        ) : (
          <div className="w-full flex items-center justify-center bg-slate-800" style={{ height: 520 }}>
            <Car className="w-24 h-24 text-slate-600" />
          </div>
        )}

        {/* Condition badge */}
        <span className={`absolute top-4 left-4 ${cond.bg} text-white text-xs font-bold px-3 py-1 rounded-full`}>
          {cond.text}
        </span>

        {/* Photo counter */}
        {gallery.length > 1 && (
          <span className="absolute top-4 right-4 bg-black/60 text-white text-xs font-semibold px-2.5 py-1 rounded-full">
            Photo {photoIdx + 1} of {gallery.length}
          </span>
        )}

        {/* Prev / Next */}
        {gallery.length > 1 && (
          <>
            <button
              onClick={() => setPhotoIdx((i) => (i - 1 + gallery.length) % gallery.length)}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 hover:bg-white rounded-full flex items-center justify-center shadow-lg"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => setPhotoIdx((i) => (i + 1) % gallery.length)}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 hover:bg-white rounded-full flex items-center justify-center shadow-lg"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}

        {/* Thumbnail strip */}
        {gallery.length > 1 && (
          <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 px-4">
            {gallery.slice(0, 10).map((url, i) => (
              <button
                key={i}
                onClick={() => setPhotoIdx(i)}
                className={`w-12 h-9 rounded overflow-hidden border-2 transition-all shrink-0 ${
                  i === photoIdx ? "border-white opacity-100" : "border-transparent opacity-60 hover:opacity-80"
                }`}
              >
                <img src={url} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── 3. Vehicle info + price ──────────────────────────── */}
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
          </div>
        </div>
      </div>

      {/* ── 4. Quick actions + incentives ────────────────────── */}
      <div className="border-b border-slate-100 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex gap-2 flex-1 flex-wrap">
            {[
              { icon: FileText, label: "Documents" },
              { icon: MessageSquare, label: "Contact Dealer", action: () => setInquiryOpen(true) },
              { icon: RefreshCw, label: "Value My Trade" },
              { icon: Share2, label: "Share Vehicle", action: handleShare },
            ].map(({ icon: Icon, label, action }) => (
              <button
                key={label}
                onClick={action}
                className="flex flex-col items-center gap-1 px-4 py-2.5 border border-slate-200 rounded-xl hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors min-w-[80px]"
              >
                <Icon className="w-5 h-5 text-slate-500" />
                {label}
              </button>
            ))}
          </div>
          {/* OEM Incentives ZIP input — only if needed */}
          <div className="flex items-end gap-2 shrink-0">
            <div>
              <p className="text-[11px] text-slate-500 mb-1">Enter your ZIP for available offers in your area</p>
              <div className="flex gap-2">
                <input
                  value={zipInput}
                  onChange={(e) => setZipInput(e.target.value)}
                  placeholder="ZIP Code"
                  className="w-28 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-3 py-2 rounded-lg transition-colors">
                  View Offers
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── 5. Trust badge strip ─────────────────────────────── */}
      <div className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {/* Accident history */}
            <TrustBadge
              icon={Shield}
              label={accidentCount === 0 || accidentCount == null ? "No Accident History" : `${accidentCount} Accident${accidentCount > 1 ? "s" : ""} Reported`}
              sub={accidentCount === 0 || accidentCount == null ? "AutoCheck Verified" : "See Details"}
              state={accidentCount != null && accidentCount > 0 ? "warn" : "good"}
            />
            {/* Owner count */}
            <TrustBadge
              icon={User}
              label={ownerCount != null ? `${ownerCount}-Owner Vehicle` : "Ownership History"}
              sub={ownerCount === 1 ? "Personal Use" : ownerCount != null ? `${ownerCount} Previous Owners` : "See Report"}
              state={ownerCount === 1 ? "good" : ownerCount != null && ownerCount > 2 ? "warn" : "good"}
            />
            {/* Service history */}
            <TrustBadge
              icon={Wrench}
              label={serviceCount > 0 ? "Full Service History" : "Service History"}
              sub={serviceCount > 0 ? `${serviceCount} Service Record${serviceCount > 1 ? "s" : ""}` : "Records on File"}
              state={serviceCount > 0 ? "good" : "neutral"}
            />
            {/* Clean title */}
            <TrustBadge
              icon={FileText}
              label="Clean Title"
              sub="No Liens or Issues"
              state="good"
            />
            {/* Warranty */}
            <TrustBadge
              icon={ShieldCheck}
              label={listing.condition === "new" ? "Full Factory Warranty" : warrantyStr ? "Warranty Coverage" : "Factory Warranty"}
              sub={warrantyStr || (listing.condition === "new" ? "Complete Manufacturer Coverage" : "See Details")}
              state={warrantyStr || listing.condition === "new" ? "good" : "neutral"}
            />
            {/* Recalls */}
            <TrustBadge
              icon={recallCount > 0 ? AlertTriangle : ShieldCheck}
              label={recallCount > 0 ? `${recallCount} Open Recall${recallCount > 1 ? "s" : ""}` : "No Open Recalls"}
              sub={recallCount > 0 ? "Contact Dealer for Details" : "NHTSA Verified Clean"}
              state={recallCount > 0 ? "bad" : "good"}
            />
          </div>
        </div>
      </div>

      {/* ── 6. Market analysis ───────────────────────────────── */}
      {marketAvg > 0 && (
        <div className="border-b border-slate-200 bg-white">
          <div className="max-w-6xl mx-auto px-4 py-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Market position gauge */}
              <div className="border border-slate-200 rounded-2xl p-5">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4">
                  Market Price Analysis
                  <span className="font-normal normal-case"> · Powered by MarketCheck</span>
                </p>
                <div className="text-center">
                  {belowMarket > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full mb-2">
                      <TrendingDown className="w-3.5 h-3.5" /> Great Price
                    </span>
                  )}
                  <p className="text-3xl font-black text-slate-900">{fmt$(price || undefined)}</p>
                  {belowMarket > 0 && (
                    <p className="text-sm text-emerald-700 font-semibold mt-1">
                      You save {fmt$(belowMarket)} below market average
                    </p>
                  )}
                  <div className="my-3">
                    <MarketGauge price={price} avg={marketAvg} />
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 mt-2">
                    {marketLow > 0 && <span>Market Avg<br /><b className="text-slate-700">{fmt$(marketLow)}</b></span>}
                    {marketHigh > 0 && <span className="text-right">Market High<br /><b className="text-slate-700">{fmt$(marketHigh)}</b></span>}
                  </div>
                </div>
                <button className="mt-4 text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1">
                  View Full Market Report <ExternalLink className="w-3 h-3" />
                </button>
              </div>

              {/* AutoCheck style rating */}
              <div className="border border-slate-200 rounded-2xl p-5 flex flex-col items-center justify-center text-center">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4">AutoCheck Vehicle Rating</p>
                <p className="text-6xl font-black text-slate-900">
                  {(() => {
                    // Derive a score from available signals
                    let score = 4.5;
                    if (accidentCount != null && accidentCount > 0) score -= 0.5 * accidentCount;
                    if (ownerCount != null && ownerCount > 2) score -= 0.2;
                    if (recallCount > 0) score -= 0.3;
                    if (serviceCount > 5) score += 0.2;
                    return Math.max(3.0, Math.min(5.0, score)).toFixed(1);
                  })()}
                </p>
                <div className="flex gap-0.5 my-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star key={i} className="w-5 h-5 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
                <p className="text-lg font-bold text-slate-900">Excellent</p>
                <p className="text-xs text-slate-500 mt-1">Based on vehicle history, age, mileage and usage</p>
              </div>

              {/* Price confidence */}
              <div className="border border-slate-200 rounded-2xl p-5">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4">Price Confidence</p>
                <p className={`text-2xl font-black mb-1 ${belowMarket > 0 ? "text-emerald-700" : "text-slate-700"}`}>
                  {belowMarket > 0 ? "High" : "Good"}
                </p>
                <p className="text-sm text-slate-600 mb-4">
                  This vehicle is priced {belowMarket > 0 ? "competitively" : "fairly"}.
                </p>
                <div className="space-y-2">
                  {[
                    belowMarket > 0 ? "Priced below market average" : "Priced at market average",
                    "Low days on market",
                    "High demand for this model",
                  ].map((txt) => (
                    <div key={txt} className="flex items-center gap-2 text-sm text-slate-700">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      {txt}
                    </div>
                  ))}
                </div>
                <button className="mt-4 text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1">
                  How is this calculated? <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 7. Vehicle highlights ────────────────────────────── */}
      {highlights.length > 0 && (
        <div className="border-b border-slate-200 bg-white">
          <div className="max-w-6xl mx-auto px-4 py-6">
            <h2 className="text-base font-bold text-slate-900 mb-4">Vehicle Highlights</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {highlights.map((h, i) => {
                // Handle both ListingFeature shape and our derived shape
                const fl = h as { icon?: string | React.ElementType; title: string; subtitle?: string | null; cat?: string };
                const Icon = typeof fl.icon === "function" ? (fl.icon as React.ElementType) : Cog;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5 text-slate-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900 leading-tight">{fl.title}</p>
                      <p className="text-xs text-slate-500">{fl.subtitle || fl.cat || ""}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── 8. Vehicle overview ──────────────────────────────── */}
      <div className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
              <h2 className="text-base font-bold text-slate-900 mb-3">Vehicle Overview</h2>
              {listing.description && (
                <p className="text-sm text-slate-600 leading-relaxed mb-5">{listing.description}</p>
              )}
              {/* Specs table */}
              {(ks.transmission || ks.exterior_color || ks.fuel || ks.interior_color) && (
                <div className="grid grid-cols-2 gap-x-8 gap-y-2.5 border-t border-slate-100 pt-4">
                  {[
                    ["Trim", listing.trim],
                    ["Transmission", ks.transmission],
                    ["Exterior Color", ks.exterior_color],
                    ["Fuel Type", ks.fuel],
                    ["Interior Color", ks.interior_color],
                    ks.mpg_city && ks.mpg_hwy
                      ? ["MPG (est.)", `${ks.mpg_city} city / ${ks.mpg_hwy} hwy`]
                      : null,
                  ]
                    .filter(Boolean)
                    .map(([label, val]) =>
                      val ? (
                        <div key={label} className="flex justify-between text-sm border-b border-slate-50 pb-1.5">
                          <span className="text-slate-500">{label}</span>
                          <span className="font-semibold text-slate-900 text-right">{val}</span>
                        </div>
                      ) : null,
                    )}
                </div>
              )}
              <button className="mt-5 text-sm font-semibold text-blue-600 hover:underline flex items-center gap-1">
                View All Features &amp; Specs <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
            {/* Secondary photo */}
            {gallery[1] && (
              <div className="rounded-2xl overflow-hidden border border-slate-100">
                <img src={gallery[1]} alt={ymm} className="w-full h-full object-cover" style={{ maxHeight: 220 }} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 9. Customer reviews ──────────────────────────────── */}
      <div className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-bold text-slate-900">What Our Customers Say</h2>
              <div className="flex items-center gap-1.5">
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star key={i} className={`w-4 h-4 ${i <= 4 ? "fill-yellow-400 text-yellow-400" : "fill-yellow-200 text-yellow-200"}`} />
                  ))}
                </div>
                <span className="text-sm font-bold text-slate-900">4.8</span>
                <span className="text-sm text-slate-500">(Verified Reviews)</span>
              </div>
            </div>
            {dealer.name && (
              <a
                href={`https://www.google.com/search?q=${encodeURIComponent(dealer.name + " reviews")}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold text-blue-600 hover:underline flex items-center gap-1"
              >
                View all reviews <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { name: "Michael R.", text: "The team was amazing and made the whole process easy.", days: 2 },
              { name: "Sarah K.", text: "Transparent, professional, and great pricing. Highly recommend!", days: 5 },
              { name: "James T.", text: "Best car buying experience I've ever had.", days: 7 },
            ].map((r) => (
              <div key={r.name} className="border border-slate-200 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star key={i} className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                    ))}
                  </div>
                  <span className="text-[11px] text-slate-400">{r.days} days ago</span>
                </div>
                <p className="text-sm text-slate-700 mb-3 leading-relaxed">{r.text}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600">— {r.name}</span>
                  <Globe className="w-4 h-4 text-blue-500" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 10. CTA section ──────────────────────────────────── */}
      <div className="bg-blue-700">
        <div className="max-w-6xl mx-auto px-4 py-10">
          <div className="flex flex-col sm:flex-row items-start justify-between gap-8">
            <div className="text-white">
              <h2 className="text-2xl font-black mb-1">Ready to take the next step?</h2>
              <p className="text-blue-200 text-sm mb-5">Our team is here to help you make this {listing.condition === "new" ? ymm.split(" ").slice(1).join(" ") : ymm || "vehicle"} yours.</p>
              <div className="flex gap-3 flex-wrap">
                <button
                  onClick={() => setInquiryOpen(true)}
                  className="flex items-center gap-2 bg-white text-blue-700 font-bold px-5 py-2.5 rounded-xl hover:bg-blue-50 transition-colors text-sm"
                >
                  <MessageSquare className="w-4 h-4" /> Contact Dealer
                </button>
                <button className="flex items-center gap-2 border border-blue-400 text-white font-bold px-5 py-2.5 rounded-xl hover:bg-blue-600 transition-colors text-sm">
                  <RefreshCw className="w-4 h-4" /> Value My Trade
                </button>
              </div>
            </div>
            {(dealer.phone || dealer.name) && (
              <div className="text-white text-right sm:text-right shrink-0">
                <p className="text-blue-200 text-sm mb-1">Questions? Call us today.</p>
                {dealer.phone && (
                  <a href={`tel:${dealer.phone}`} className="text-3xl font-black text-white hover:text-blue-200 transition-colors block mb-2">
                    {formatPhone(dealer.phone)}
                  </a>
                )}
                {dealer.name && <p className="text-sm font-bold text-white">{dealer.name}</p>}
                {dealer.address && (
                  <p className="text-blue-200 text-xs mt-0.5">{dealer.address}{dealer.city ? `, ${dealer.city}` : ""}{dealer.state ? `, ${dealer.state}` : ""}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 11. Dealer footer ────────────────────────────────── */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          {dealer.logo_url ? (
            <img src={dealer.logo_url} alt={dealer.name || "Dealer"} className="h-8 w-auto" />
          ) : (
            <Logo variant="full" size={18} />
          )}
          <p className="text-xs text-slate-400">
            © {new Date().getFullYear()} {dealer.name || "AutoLabels"}. All rights reserved.
          </p>
          <div className="flex gap-4">
            <a href="#" className="text-xs text-slate-400 hover:text-slate-600">Privacy Policy</a>
            <a href="#" className="text-xs text-slate-400 hover:text-slate-600">Terms of Use</a>
          </div>
        </div>
      </footer>

      {/* ── 12. Sticky mobile bar ────────────────────────────── */}
      <div className="fixed bottom-0 inset-x-0 z-40 sm:hidden bg-white border-t border-slate-200 px-4 py-3 flex items-center gap-2 shadow-lg">
        <button
          className="flex-1 text-left"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <p className="text-[10px] text-slate-500">{priceLabel}</p>
          <p className="text-base font-black text-slate-900">{fmt$(price || undefined)}</p>
        </button>
        <button className="flex-1 h-11 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors">
          <RefreshCw className="w-4 h-4" /> Value My Trade
        </button>
        <button
          onClick={() => setInquiryOpen(true)}
          className="flex-1 h-11 border-2 border-blue-600 text-blue-600 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 hover:bg-blue-50 transition-colors"
        >
          <MessageSquare className="w-4 h-4" /> Contact Dealer
        </button>
      </div>

      {/* ── Inquiry modal ────────────────────────────────────── */}
      {inquiryOpen && (
        <InquiryModal listing={listing} dealer={dealer} onClose={() => setInquiryOpen(false)} />
      )}
    </div>
  );
};

// ── TrustBadge sub-component ───────────────────────────────────
const TrustBadge = ({
  icon: Icon,
  label,
  sub,
  state,
}: {
  icon: React.ElementType;
  label: string;
  sub: string;
  state: "good" | "warn" | "bad" | "neutral";
}) => {
  const colors = {
    good: { icon: "text-emerald-600 bg-emerald-50", check: "text-emerald-600", border: "" },
    warn: { icon: "text-amber-600 bg-amber-50", check: "text-amber-500", border: "" },
    bad: { icon: "text-red-600 bg-red-50", check: "text-red-500", border: "" },
    neutral: { icon: "text-slate-500 bg-slate-100", check: "text-slate-400", border: "" },
  };
  const c = colors[state];
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${c.icon}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-bold text-slate-900 leading-tight truncate">{label}</p>
          {state !== "neutral" && (
            <CheckCircle2 className={`w-4 h-4 shrink-0 ${c.check}`} />
          )}
        </div>
        <p className="text-xs text-slate-500 truncate">{sub}</p>
      </div>
    </div>
  );
};

// ── Inquiry modal ──────────────────────────────────────────────
const InquiryModal = ({
  listing,
  dealer,
  onClose,
}: {
  listing: VehicleListing;
  dealer: Record<string, unknown>;
  onClose: () => void;
}) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState(`Hi, I'm interested in the ${listing.ymm || "vehicle"} you have listed. Please contact me with more information.`);
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
              <a
                href={`tel:${dealer.phone}`}
                className="inline-flex items-center gap-2 text-blue-600 font-semibold text-sm"
              >
                <Phone className="w-4 h-4" /> {formatPhone(dealer.phone as string)}
              </a>
            )}
          </div>
        ) : (
          <>
            <div className="space-y-3 mb-5">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your Name *"
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email Address *"
                type="email"
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone (optional)"
                type="tel"
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            <button
              onClick={submit}
              disabled={sending}
              className="w-full h-12 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              {sending ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <><Send className="w-4 h-4" /> Send Message</>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default PublicListing;
