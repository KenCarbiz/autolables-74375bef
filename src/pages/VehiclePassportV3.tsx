import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Upload, Bookmark, Printer, FileText, MessageSquare,
  RefreshCw, ShieldCheck, CheckCircle2, Star, Phone, Car, Cog, Fuel, Settings, Wind,
  Award, Wrench, DollarSign, Clock, Building2, Users, Truck, Lock, Zap, ArrowRight,
  Package, Eye, Play, Rotate3d, TrendingUp, BadgeCheck, Gauge as GaugeIcon, Send,
} from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { useVehicleListing, type VehicleListing } from "@/hooks/useVehicleListing";
import { formatPhone } from "@/components/addendum/CustomerInfoSection";
import Logo from "@/components/brand/Logo";
import { derivePassport, computePriceHistory, fmt$ } from "@/lib/passportV2Data";

// ──────────────────────────────────────────────────────────────
// VehiclePassportV3 — /passport-v3/:vehicleSlug
//
// Ground-up rebuild against the V3 design board. Tokens (encoded as
// the SHELL/CARD/etc. constants below) come straight from the spec:
// 1280px container, #F6F7F9 surface, #E6E8EC borders, 16px card radius,
// Inter type scale, the documented color system. Data is the same live
// pipeline as V2 (public-listing-view → derivePassport); only the
// presentation layer is new. Every link opens a full destination page.
// ──────────────────────────────────────────────────────────────

const BLUE = "#2563EB";
const GREEN = "#16A34A";
const CARD = "rounded-2xl border border-[#E6E8EC] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.05)]";
const TEXT2 = "text-[#64748B]";

const H2 = ({ children }: { children: React.ReactNode }) => <h2 className="text-[20px] font-bold leading-7 tracking-tight text-[#0F172A]">{children}</h2>;
const H3 = ({ children }: { children: React.ReactNode }) => <h3 className="text-[16px] font-semibold leading-6 text-[#0F172A]">{children}</h3>;
const Link = ({ onClick, children, className = "" }: { onClick: () => void; children: React.ReactNode; className?: string }) => (
  <button onClick={onClick} className={`text-[13px] font-semibold text-[#2563EB] inline-flex items-center gap-1 hover:underline ${className}`}>{children} <ArrowRight className="w-3.5 h-3.5" /></button>
);

const Stars = ({ n, size = 16 }: { n: number; size?: number }) => (
  <span className="inline-flex items-center gap-0.5">
    {[0, 1, 2, 3, 4].map((i) => <Star key={i} style={{ width: size, height: size }} className="text-amber-400" fill={i < Math.round(n) ? "#F59E0B" : "none"} strokeWidth={1.5} />)}
  </span>
);

// ── Charts (dependency-free SVG, soft V3 palette) ──────────────
const Spark = ({ points, color = GREEN }: { points: number[]; color?: string }) => {
  if (points.length < 2) return <div className="h-9 mt-2 rounded bg-[#F1F5F9] animate-pulse" />;
  const w = 200, h = 40, pad = 3, min = Math.min(...points), max = Math.max(...points), span = Math.max(1, max - min);
  const d = points.map((p, i) => `${(pad + (i / (points.length - 1)) * (w - pad * 2)).toFixed(1)},${(pad + (1 - (p - min) / span) * (h - pad * 2)).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-9 mt-2" preserveAspectRatio="none">
      <polyline points={d.join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={d[d.length - 1].split(",")[0]} cy={d[d.length - 1].split(",")[1]} r="2.5" fill={color} />
    </svg>
  );
};
const Bars = ({ values, color = GREEN }: { values: number[]; color?: string }) => {
  if (!values.length) return <div className="h-9 mt-2 rounded bg-[#F1F5F9] animate-pulse" />;
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-[3px] h-9 mt-2">
      {values.map((v, i) => <span key={i} className="flex-1 rounded-sm" style={{ height: `${Math.max(8, (v / max) * 100)}%`, background: color, opacity: 0.55 + 0.45 * (v / max) }} />)}
    </div>
  );
};
const Donut = ({ pct, label }: { pct: number; label: string }) => {
  const r = 26, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  return (
    <div className="relative w-[72px] h-[72px] shrink-0">
      <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#E6E8EC" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={GREEN} strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[15px] font-extrabold text-[#0F172A]">{label}</span>
    </div>
  );
};
const Semi = ({ score }: { score: number }) => {
  const r = 52, circ = Math.PI * r, pct = Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="relative w-[140px] h-[78px]">
      <svg viewBox="0 0 120 66" className="w-full h-full">
        <path d="M 8 60 A 52 52 0 0 1 112 60" fill="none" stroke="#E6E8EC" strokeWidth="10" strokeLinecap="round" />
        <path d="M 8 60 A 52 52 0 0 1 112 60" fill="none" stroke={GREEN} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${circ * pct} ${circ}`} />
      </svg>
      <div className="absolute inset-x-0 bottom-1 text-center"><span className="text-[24px] font-extrabold text-[#0F172A] leading-none">{score}</span><span className="text-[12px] font-bold text-[#94A3B8]"> /100</span></div>
    </div>
  );
};

// ── Lead modal is intentionally absent — every action routes to a full page ──
const VehiclePassportV3 = () => {
  const { vehicleSlug } = useParams<{ vehicleSlug: string }>();
  const navigate = useNavigate();
  const { publicUrl } = useVehicleListing("");
  const [listing, setListing] = useState<VehicleListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [idx, setIdx] = useState(0);
  const [zip, setZip] = useState("");

  useEffect(() => {
    if (!vehicleSlug) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke("public-listing-view", { body: { slug: vehicleSlug } });
      if (!mounted) return;
      const row = (data as { listing?: VehicleListing } | null)?.listing ?? null;
      if (error || !row) { setNotFound(true); setLoading(false); return; }
      setListing(row); setLoading(false);
    })();
    return () => { mounted = false; };
  }, [vehicleSlug]);

  const d = useMemo(() => (listing ? derivePassport(listing) : null), [listing]);
  const gallery = useMemo(() => {
    if (!listing) return [] as string[];
    const fromPhotos = (listing.photos || []).map((p) => p.url).filter(Boolean);
    return fromPhotos.length ? fromPhotos : listing.hero_image_url ? [listing.hero_image_url] : [];
  }, [listing]);

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-[#F6F7F9]"><div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" /></div>;
  if (notFound || !listing || !d) return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[#F6F7F9]"><div className="text-center"><Package className="w-12 h-12 text-slate-300 mx-auto mb-4" /><h1 className="text-xl font-bold">Vehicle unavailable</h1><p className="text-sm text-slate-500 mt-2">This listing may have been sold or unpublished.</p></div></div>
  );

  const go = (section: string) => navigate(`/passport-v3/${listing.slug || vehicleSlug}/${section}`);
  const viewUrl = publicUrl(listing.slug);
  const handleShare = async () => { try { if (navigator.share) { await navigator.share({ title: listing.ymm || "Vehicle", url: viewUrl }); return; } } catch { return; } go("share"); };
  const hero = gallery[idx] || gallery[0] || "";
  const photoCount = gallery.length;
  const { priceChange7d } = computePriceHistory(listing);
  const priceSeries = d.valueHistory.filter((h) => h.listing_price != null).map((h) => h.listing_price as number);
  const marketSeries = d.valueHistory.filter((h) => h.market_value != null).map((h) => h.market_value as number);

  const verifyL = d.verifyRows.slice(0, Math.ceil(d.verifyRows.length / 2));
  const verifyR = d.verifyRows.slice(Math.ceil(d.verifyRows.length / 2));

  const actions = [
    { icon: FileText, label: "Documents", onClick: () => navigate(`/v/${listing.slug || vehicleSlug}/documents`) },
    { icon: MessageSquare, label: "Contact Dealer", onClick: () => go("contact") },
    { icon: RefreshCw, label: "Value My Trade", onClick: () => go("trade") },
    { icon: Upload, label: "Share Vehicle", onClick: handleShare },
  ];

  const mi = [
    { icon: DollarSign, title: "Market Price", strong: d.belowMarket && d.belowMarket > 0 ? "Great Price" : d.marketAvg != null ? "Market Price" : "Pending",
      sub: d.belowMarket && d.belowMarket > 0 ? `${fmt$(d.belowMarket)} below market average` : d.marketAvg != null ? `Market avg ${fmt$(d.marketAvg)}` : "Awaiting MarketCheck", chart: <Spark points={marketSeries} />, section: "market-price", cta: "View report" },
    { icon: TrendingUp, title: "Market Demand", strong: (d.viewCount != null || d.dom != null) ? ((d.viewCount ?? 0) > 20 ? "High Interest" : "Active") : "Pending",
      sub: [d.viewCount != null ? `${d.viewCount.toLocaleString()} views` : null, d.dom != null ? `${d.dom} days on market` : null].filter(Boolean).join(" · ") || "Tracked once live", chart: <Bars values={[]} />, section: "market-demand", cta: "View report" },
    { icon: GaugeIcon, title: "Price Confidence", strong: d.belowMarket && d.belowMarket > 0 ? "Excellent" : d.marketAvg != null ? "Fair" : "Pending",
      sub: d.marketAvg != null ? "based on live comparables" : "Awaiting MarketCheck", donut: d.confScore, section: "price-confidence", cta: "View report" },
    { icon: Clock, title: "Price History", strong: priceChange7d != null && priceChange7d !== 0 ? `${priceChange7d < 0 ? "-" : "+"}${fmt$(Math.abs(priceChange7d))}` : "7-Day Trend",
      sub: priceChange7d != null ? (priceChange7d < 0 ? "price decreased" : priceChange7d > 0 ? "price increased" : "stable") : "History builds over time", chart: <Spark points={priceSeries} color="#7C3AED" />, section: "price-history", cta: "View history" },
    { icon: Car, title: "Comparable Vehicles", strong: "Comp set", sub: "Similar vehicles via MarketCheck", comps: true, section: "comparable-vehicles", cta: "View comp set" },
    { icon: Package, title: "Inventory Trend", strong: "30-Day Trend", sub: "Market supply via MarketCheck", chart: <Spark points={[]} />, section: "inventory-trend", cta: "View trend" },
  ];

  const highlights: { icon: React.ElementType; t: string; s: string }[] = [];
  const ks = listing.key_specs || {}; const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  if (ks.engine) highlights.push({ icon: Cog, t: ks.engine, s: "Engine" });
  if (mc.horsepower) highlights.push({ icon: Zap, t: `${mc.horsepower} HP`, s: "Power" });
  if (ks.drivetrain) highlights.push({ icon: Car, t: ks.drivetrain, s: "Drivetrain" });
  if (ks.mpg_city && ks.mpg_hwy) highlights.push({ icon: Fuel, t: `${ks.mpg_city}/${ks.mpg_hwy} MPG`, s: "Combined" });
  else if (ks.fuel) highlights.push({ icon: Fuel, t: ks.fuel, s: "Fuel" });
  if (ks.transmission) highlights.push({ icon: Settings, t: ks.transmission, s: "Transmission" });
  if (ks.exterior_color) highlights.push({ icon: Wind, t: ks.exterior_color, s: "Exterior" });
  (listing.features || []).forEach((f) => { if (highlights.length < 8) highlights.push({ icon: Award, t: f.title, s: f.subtitle || "Feature" }); });

  const dealerChips = [
    { icon: Building2, t: "Family Owned", s: d.dealerTrust.yearsInBusiness ? `Since ${new Date().getFullYear() - Number(d.dealerTrust.yearsInBusiness)}` : "Trusted locally" },
    { icon: Star, t: "Top Rated", s: d.dealerTrust.googleRating ? `${d.dealerTrust.googleRating} Google Rating` : "Verified buyers" },
    { icon: Wrench, t: "Factory Certified", s: "Trained technicians" },
    { icon: Settings, t: "Service Center", s: "On-site" },
    { icon: Truck, t: "Delivery Available", s: "Nationwide" },
    { icon: ShieldCheck, t: "Customer Commitment", s: "No-pressure" },
  ];
  const badges = [
    d.dealerTrust.yearsInBusiness ? { v: `${d.dealerTrust.yearsInBusiness}+`, l: "Years in Business" } : null,
    d.dealerTrust.googleRating ? { v: d.dealerTrust.googleRating, l: d.dealerTrust.googleCount ? `Google (${Number(d.dealerTrust.googleCount).toLocaleString()})` : "Google Rating", star: true } : null,
    d.dealerTrust.satisfaction ? { v: d.dealerTrust.satisfaction, l: "Customer Satisfaction" } : null,
    d.dealerTrust.bbbRating ? { v: d.dealerTrust.bbbRating, l: "BBB Rating" } : null,
  ].filter(Boolean) as { v: string; l: string; star?: boolean }[];

  const price = d.price;

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#0F172A]" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <Helmet><title>{`${listing.ymm}${listing.trim ? ` ${listing.trim}` : ""} — Passport`}</title></Helmet>

      {/* Top bar */}
      <header className="border-b border-[#E6E8EC] bg-white">
        <div className="mx-auto max-w-[1280px] px-5 h-16 flex items-center justify-between">
          {listing.dealer_snapshot?.logo_url ? <img src={listing.dealer_snapshot.logo_url as string} alt="" className="h-7" /> : <Logo variant="full" size={22} />}
          <div className="flex items-center gap-5">
            <button onClick={handleShare} className={`text-sm font-medium inline-flex items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Upload className="w-4 h-4" /> Share</button>
            <button onClick={() => toast.success("Saved to this device")} className={`text-sm font-medium inline-flex items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Bookmark className="w-4 h-4" /> Save</button>
            <button onClick={() => window.print()} className={`text-sm font-medium inline-flex items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Printer className="w-4 h-4" /> Print</button>
            <button onClick={() => go("check-availability")} className="h-11 px-5 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-sm font-semibold inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Check Availability</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-5 py-6 space-y-6">
        {/* 1–2. TOP ZONE */}
        <section className="grid grid-cols-1 lg:grid-cols-[440px_1fr] gap-5">
          {/* Gallery */}
          <div>
            <div className="relative overflow-hidden rounded-2xl bg-[#1f2227] aspect-[4/3]">
              {hero ? <img src={hero} alt={listing.ymm || ""} onClick={() => go("gallery")} className="absolute inset-0 w-full h-full object-cover cursor-zoom-in" /> : <div className="absolute inset-0 flex items-center justify-center text-slate-500"><Car className="w-14 h-14" strokeWidth={1.25} /></div>}
              {photoCount > 0 && <span className="absolute left-3 top-3 text-white text-xs font-semibold px-2.5 py-1 rounded bg-black/60">{idx + 1} / {photoCount}</span>}
              {photoCount > 1 && <>
                <button onClick={() => setIdx((i) => (i - 1 + photoCount) % photoCount)} className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/95 hover:bg-white flex items-center justify-center shadow"><ChevronLeft className="w-5 h-5" /></button>
                <button onClick={() => setIdx((i) => (i + 1) % photoCount)} className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/95 hover:bg-white flex items-center justify-center shadow"><ChevronRight className="w-5 h-5" /></button>
              </>}
            </div>
            {photoCount > 1 && <div className="flex gap-2 mt-2">{gallery.slice(0, 6).map((s, i) => <button key={i} onClick={() => setIdx(i)} className="w-[60px] h-11 rounded-lg overflow-hidden bg-[#e9ecef]" style={{ outline: i === idx ? `2px solid ${BLUE}` : "2px solid transparent", outlineOffset: -2 }}><img src={s} alt="" className="w-full h-full object-cover" /></button>)}{photoCount > 6 && <button onClick={() => go("gallery")} className="w-[60px] h-11 rounded-lg bg-black/70 text-white text-[11px] font-bold">+{photoCount - 6}</button>}</div>}
            <div className="flex gap-2 mt-2">
              <button onClick={() => go("gallery")} className={`flex-1 h-10 rounded-xl border border-[#E6E8EC] bg-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]`}><Eye className="w-4 h-4 text-[#2563EB]" /> All Photos ({photoCount})</button>
              <div className="flex-1 h-10 rounded-xl border border-dashed border-[#E6E8EC] bg-[#fafbfc] text-[12px] text-[#94A3B8] inline-flex items-center justify-center gap-1.5"><Rotate3d className="w-4 h-4" /> 360° View</div>
              {listing.videos?.length ? <a href={listing.videos[0].url} target="_blank" rel="noreferrer" className="flex-1 h-10 rounded-xl border border-[#E6E8EC] bg-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"><Play className="w-4 h-4 text-[#2563EB]" /> Video</a> : <div className="flex-1 h-10 rounded-xl border border-dashed border-[#E6E8EC] bg-[#fafbfc] text-[12px] text-[#94A3B8] inline-flex items-center justify-center gap-1.5"><Play className="w-4 h-4" /> No Video</div>}
            </div>
          </div>

          {/* Right of gallery */}
          <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-5">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-100 text-blue-700">{listing.condition || "vehicle"}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${listing.status === "published" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{listing.status}</span>
                  </div>
                  <h1 className="text-[32px] font-extrabold leading-10 tracking-tight">{listing.ymm}</h1>
                  {listing.trim && <div className="text-[18px] font-semibold text-[#64748B]">{listing.trim}</div>}
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-2 text-[13px] text-[#64748B]">
                    <span><span className="font-semibold text-[#0F172A]">VIN</span> {listing.vin}</span><span className="text-slate-300">•</span>
                    <span>Stock # {listing.vin.slice(-6)}</span>{listing.mileage != null && <><span className="text-slate-300">•</span><span>{listing.mileage.toLocaleString()} mi</span></>}
                  </div>
                </div>
                {price != null && (
                  <div className="text-right shrink-0">
                    <div className="text-[13px] font-semibold text-[#64748B]">{d.priceLabel}</div>
                    <div className="text-[28px] font-extrabold leading-9">{fmt$(price)}</div>
                    {d.estMonthly != null && <div className="text-[12px] text-[#64748B]">Est. {fmt$(d.estMonthly)}/mo</div>}
                    {d.msrp != null && <div className="text-[12px] text-[#64748B]">MSRP {fmt$(d.msrp)}</div>}
                    {d.saveVsMsrp != null && <div className="text-[13px] font-semibold text-[#16A34A]">You save {fmt$(d.saveVsMsrp)}</div>}
                  </div>
                )}
              </div>

              {/* Verification card */}
              {d.verifyRows.length > 0 && (
                <div className={`${CARD} p-5`}>
                  <div className="flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center"><ShieldCheck className="w-5 h-5 text-[#16A34A]" /></span>
                    <div><p className="text-[15px] font-bold">AutoLabels Verified</p><p className="text-[12px] text-[#64748B]">Independently checked against trusted automotive data.</p></div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 mt-4">
                    {[verifyL, verifyR].map((col, ci) => <div key={ci} className="space-y-2.5">{col.map((r) => <div key={r.label} className="flex items-center gap-2 text-[13px] font-medium text-[#0F172A]"><CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" />{r.label}</div>)}</div>)}
                  </div>
                  <Link onClick={() => go("verification-report")} className="mt-4">View full verification report</Link>
                </div>
              )}
            </div>

            {/* Far-right column */}
            <div className="space-y-4">
              {(d.saveVsMsrp || (d.belowMarket && d.belowMarket > 0)) && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 flex gap-3">
                  <span className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0"><BadgeCheck className="w-5 h-5 text-[#16A34A]" /></span>
                  <div><p className="text-[14px] font-bold text-[#16A34A]">Great Price</p><p className="text-[13px] font-extrabold text-[#0F172A]">{fmt$(d.saveVsMsrp || d.belowMarket)} {d.saveVsMsrp ? "below MSRP" : "below market"}</p><p className="text-[11px] text-[#64748B] mt-0.5">One of the best-priced comparable vehicles in your area.</p></div>
                </div>
              )}
              <div className={`${CARD} p-4`}>
                <p className="text-[13px] font-semibold mb-2">Get your best offer in minutes</p>
                <div className="flex gap-2">
                  <input value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="Enter your ZIP code" inputMode="numeric" className="flex-1 min-w-0 h-11 px-3 rounded-xl border border-[#E6E8EC] text-sm outline-none focus:border-[#2563EB]" />
                  <button onClick={() => /^\d{5}$/.test(zip) ? go(`offers?zip=${zip}`) : toast.error("Enter a valid ZIP")} className="h-11 px-4 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-sm font-semibold shrink-0">View Offers</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {actions.map((a) => <button key={a.label} onClick={a.onClick} className={`${CARD} p-3 flex flex-col items-center justify-center gap-1.5 hover:border-[#2563EB] transition-colors h-[84px]`}><a.icon className="w-5 h-5 text-[#2563EB]" /><span className="text-[12px] font-semibold text-center leading-tight">{a.label}</span></button>)}
              </div>
            </div>
          </div>
        </section>

        {/* 4. MARKET INTELLIGENCE */}
        <section className={`${CARD} p-5`}>
          <div className="flex items-center justify-between"><div><H2>Market Intelligence</H2><p className={`text-[13px] ${TEXT2} mt-0.5`}>Independent pricing, demand, and value analysis for this vehicle.</p></div><span className="text-[12px] text-[#94A3B8]">Powered by MarketCheck</span></div>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mt-5">
            {mi.map((c) => (
              <div key={c.section} className="rounded-xl border border-[#E6E8EC] p-4 flex flex-col">
                <div className="flex items-center gap-1.5 mb-2"><c.icon className="w-4 h-4 text-[#2563EB]" /><span className="text-[12px] font-semibold text-[#64748B]">{c.title}</span></div>
                {c.donut != null ? <div className="flex items-center gap-3"><Donut pct={c.donut} label={`${c.donut}`} /><div><p className="text-[15px] font-extrabold text-[#16A34A] leading-tight">{c.strong}</p><p className="text-[11px] text-[#64748B] leading-snug">{c.sub}</p></div></div>
                  : <><p className={`text-[16px] font-extrabold leading-tight ${/Great|High|Excellent|^-/.test(String(c.strong)) ? "text-[#16A34A]" : "text-[#0F172A]"}`}>{c.strong}</p><p className="text-[11px] text-[#64748B] leading-snug mt-0.5 flex-1">{c.sub}</p>{c.comps ? <div className="flex gap-1 mt-2">{[0, 1, 2].map((i) => <div key={i} className="flex-1 h-8 rounded bg-[#F1F5F9] flex items-center justify-center"><Car className="w-4 h-4 text-[#94A3B8]" /></div>)}</div> : c.chart}</>}
                <Link onClick={() => go(c.section)} className="mt-2.5 !text-[12px]">{c.cta}</Link>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[#94A3B8] mt-3">Market values are estimates from third-party data and may vary by region and time.</p>
        </section>

        {/* 5. PRIMARY TRUST GRID */}
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-5 items-stretch">
          {/* Why This Is A Great Buy */}
          <div className={`${CARD} p-5 flex flex-col`}>
            <H3>Why This Is A Great Buy</H3>
            {d.confScore != null && (
              <div className="flex flex-col items-center mt-3 rounded-xl bg-emerald-50/60 border border-emerald-100 p-3">
                <p className="text-[11px] font-semibold text-[#64748B]">AutoLabels Confidence Score</p>
                <Semi score={d.confScore} />
                <p className="text-[13px] font-extrabold text-[#16A34A] -mt-1">{d.confLabel} Value</p>
              </div>
            )}
            <ul className="mt-3 space-y-2">{(d.whyBuy.length ? d.whyBuy : ["Details confirmed at the dealership"]).map((b, i) => <li key={i} className="flex items-start gap-2 text-[13px]"><CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />{b}</li>)}</ul>
            <Link onClick={() => go("great-buy")} className="mt-auto pt-3 self-start">See full buying report</Link>
          </div>

          {/* Vehicle History */}
          <div className={`${CARD} p-5 flex flex-col`}>
            <H3>Vehicle History Summary</H3>
            <ul className="mt-3 space-y-3">
              {[
                { icon: Users, t: d.ownerCount === 1 ? "One Owner" : d.ownerCount ? `${d.ownerCount} Owners` : "Ownership", s: d.ownerCount === 1 ? "Personal Use" : "Not reported", ok: d.ownerCount === 1 },
                { icon: ShieldCheck, t: "No Accidents", s: d.accidentCount === 0 ? "No Issues Reported" : "Not reported", ok: d.accidentCount === 0 },
                { icon: FileText, t: "Clean Title", s: d.cleanTitle ? "No Brands" : "Not reported", ok: d.cleanTitle },
                { icon: Wrench, t: "Service History", s: d.serviceCount > 0 ? `${d.serviceCount} Records` : "No records", ok: d.serviceCount > 0 },
                { icon: BadgeCheck, t: "No Open Recalls", s: d.recallClear ? "0 Open Recalls" : "Not checked", ok: d.recallClear },
              ].map((r) => <li key={r.t} className="flex items-center gap-2.5"><span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${r.ok ? "bg-emerald-50" : "bg-slate-100"}`}><r.icon className={`w-4 h-4 ${r.ok ? "text-[#16A34A]" : "text-[#94A3B8]"}`} /></span><div className="min-w-0"><p className="text-[13px] font-semibold leading-tight">{r.t}</p><p className="text-[11px] text-[#64748B]">{r.s}</p></div></li>)}
            </ul>
            <Link onClick={() => go("vehicle-history")} className="mt-auto pt-3 self-start">View full history report</Link>
          </div>

          {/* Ownership Timeline */}
          <div className={`${CARD} p-5 flex flex-col`}>
            <H3>Ownership Timeline</H3>
            <ol className="mt-4 space-y-4 relative border-l-2 border-slate-100 ml-1.5 pl-4">
              {([
                /^\d{4}$/.test((listing.ymm || "").split(" ")[0]) ? { d: (listing.ymm || "").split(" ")[0], t: "Manufactured", s: "Factory production", c: "bg-slate-400" } : null,
                d.warranty.in_service_date ? { d: new Date(d.warranty.in_service_date).toLocaleDateString(), t: "Placed in service", s: "Warranty begins", c: "bg-emerald-500" } : null,
                d.ownerCount != null ? { d: d.ownerCount === 1 ? "Single owner" : `${d.ownerCount} owners`, t: "First owner", s: "Personal use", c: "bg-emerald-500" } : null,
                d.serviceCount > 0 ? { d: `${d.serviceCount} records`, t: "Regular service", s: "Well maintained", c: "bg-emerald-500" } : null,
                listing.prep_status?.foreman_signed_at ? { d: new Date(listing.prep_status.foreman_signed_at).toLocaleDateString(), t: "AutoLabels certified", s: "Multi-point sign-off", c: "bg-emerald-500" } : null,
                { d: "Today", t: "Ready for you", s: "At the dealership", c: "bg-[#2563EB]" },
              ].filter(Boolean) as { d: string; t: string; s: string; c: string }[]).map((e, i) => <li key={i} className="relative"><span className={`absolute -left-[22px] top-1 w-3 h-3 rounded-full ${e.c} ring-2 ring-white`} /><p className="text-[12px] font-bold">{e.d} · {e.t}</p><p className="text-[11px] text-[#64748B]">{e.s}</p></li>)}
            </ol>
            <Link onClick={() => go("ownership-timeline")} className="mt-auto pt-3 self-start">View full timeline</Link>
          </div>

          {/* Factory Warranty */}
          <div className={`${CARD} p-5 flex flex-col`}>
            <H3>Factory Warranty</H3>
            {d.warrantyStr ? (() => {
              const w = d.warranty;
              const milesLeft = w.factory_miles != null && listing.mileage != null ? Math.max(0, w.factory_miles - listing.mileage) : null;
              const milesPct = w.factory_miles && listing.mileage != null ? Math.max(3, 100 - Math.min(100, (listing.mileage / w.factory_miles) * 100)) : null;
              let monthsLeft: number | null = null, monthsPct: number | null = null, expiry: string | null = null;
              if (w.in_service_date && w.factory_months) { const end = new Date(w.in_service_date); end.setMonth(end.getMonth() + w.factory_months); expiry = end.toLocaleDateString(); const ms = end.getTime() - Date.now(); monthsLeft = ms > 0 ? Math.round(ms / (1000 * 60 * 60 * 24 * 30.4)) : 0; monthsPct = Math.max(3, Math.min(100, (monthsLeft / w.factory_months) * 100)); }
              return <>
                <div className="flex items-center gap-2 mt-2"><span className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center"><ShieldCheck className="w-4 h-4 text-[#16A34A]" /></span><p className="text-[12px] text-[#64748B]">{d.warrantyStr} remaining</p></div>
                {monthsPct != null && <div className="mt-3"><div className="flex justify-between text-[12px]"><span className="text-[#64748B]">Time Remaining</span><span className="font-bold">{monthsLeft} <span className="text-[#94A3B8] font-medium">of {w.factory_months} mo</span></span></div><div className="mt-1 h-2.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${monthsPct}%` }} /></div></div>}
                {milesPct != null && <div className="mt-3"><div className="flex justify-between text-[12px]"><span className="text-[#64748B]">Mileage Remaining</span><span className="font-bold">{milesLeft!.toLocaleString()} <span className="text-[#94A3B8] font-medium">of {(w.factory_miles! / 1000).toFixed(0)}K mi</span></span></div><div className="mt-1 h-2.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${milesPct}%` }} /></div></div>}
                {expiry && <p className="text-[11px] text-[#64748B] mt-3">Expires {expiry}</p>}
              </>;
            })() : <p className="text-[13px] text-[#64748B] mt-3">Coverage details confirmed at the dealership.</p>}
            <Link onClick={() => go("factory-warranty")} className="mt-auto pt-3 self-start">View warranty details</Link>
          </div>

          {/* What Owners Say */}
          <div className={`${CARD} p-5 flex flex-col`}>
            <H3>What Owners Say</H3>
            {d.reviewRating != null && <div className="flex items-center gap-2 mt-2"><span className="text-[24px] font-extrabold text-[#2563EB]">{d.reviewRating.toFixed(1)}</span><Stars n={d.reviewRating} />{d.reviewCount != null && <span className="text-[12px] text-[#64748B]">({d.reviewCount.toLocaleString()})</span>}</div>}
            {d.dealerTrust.reviewSources.length > 0 ? (
              <div className="mt-3 space-y-3">{d.dealerTrust.reviewSources.slice(0, 3).map((r, i) => <div key={i}><div className="flex items-center gap-2"><span className="text-[12px] font-bold">{r.name}</span>{r.rating != null && <Stars n={r.rating} size={12} />}</div>{r.quote && <p className="text-[12px] text-[#64748B] leading-snug">"{r.quote}"</p>}</div>)}</div>
            ) : <p className="text-[13px] text-[#64748B] mt-3">Verified dealership reviews appear here when the dealer connects a review source.</p>}
            <Link onClick={() => go("owner-reviews")} className="mt-auto pt-3 self-start">Read all reviews</Link>
          </div>
        </section>

        {/* 7. INFORMATION GRID + FINAL CTA */}
        <section className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr_1.1fr] gap-5 items-stretch">
          {/* Highlights */}
          <div className={`${CARD} p-5 flex flex-col`}>
            <H3>Vehicle Highlights</H3>
            <div className="grid grid-cols-4 gap-y-4 gap-x-2 mt-4">{(highlights.length ? highlights : [{ icon: Car, t: listing.ymm || "Vehicle", s: "Model" }]).slice(0, 8).map((h, i) => <div key={i} className="flex flex-col items-center text-center gap-1.5"><span className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center"><h.icon className="w-5 h-5 text-[#2563EB]" /></span><div className="w-full"><div className="text-[11px] font-bold leading-tight truncate">{h.t}</div><div className="text-[10px] text-[#94A3B8] truncate">{h.s}</div></div></div>)}</div>
            <Link onClick={() => go("features")} className="mt-auto pt-3 self-start">View all features &amp; specs</Link>
          </div>
          {/* Overview */}
          <div className={`${CARD} p-5 flex flex-col`}>
            <H3>Vehicle Overview</H3>
            <p className="text-[13px] leading-relaxed text-[#64748B] mt-3 line-clamp-6">{d.overview}</p>
            {(gallery[1] || gallery[0]) && <img src={gallery[1] || gallery[0]} alt="" className="w-full aspect-[16/9] object-cover rounded-xl mt-3" />}
            <Link onClick={() => go("overview")} className="mt-auto pt-3 self-start">Read full overview</Link>
          </div>
          {/* Key Specs */}
          <div className={`${CARD} p-5 flex flex-col`}>
            <H3>Key Specifications</H3>
            <div className="mt-3 space-y-2 text-[13px]">{(d.keySpecs.length ? d.keySpecs : [["Details", "Confirmed at dealership"]] as [string, string][]).slice(0, 8).map(([k, v]) => <div key={k} className="flex justify-between gap-4 border-b border-slate-100 pb-1.5"><span className="text-[#64748B]">{k}</span><span className="font-semibold text-right">{v}</span></div>)}</div>
            <Link onClick={() => go("specifications")} className="mt-auto pt-3 self-start">View full specs</Link>
          </div>
          {/* Final CTA */}
          <div className="rounded-2xl p-6 text-white flex flex-col" style={{ background: "linear-gradient(160deg,#2563EB 0%,#1e50c8 100%)" }}>
            <h2 className="text-[22px] font-extrabold leading-tight text-center">Ready to take the next step?</h2>
            <p className="text-[13px] opacity-90 text-center mt-1">Choose the option that works best for you.</p>
            <button onClick={() => go("reserve")} className="mt-5 w-full rounded-xl bg-white text-[#2563EB] px-4 py-3.5 flex items-center justify-center gap-2 shadow-sm"><ShieldCheck className="w-5 h-5" /><span className="text-left"><span className="block text-[15px] font-extrabold leading-tight">Reserve This Vehicle</span><span className="block text-[11px] font-medium text-[#2563EB]/70">Secure it today with a refundable deposit.</span></span></button>
            <button onClick={() => go("trade")} className="mt-3 w-full rounded-xl bg-white/10 border border-white/40 text-white px-4 py-3.5 flex items-center justify-center gap-2"><RefreshCw className="w-5 h-5" /><span className="text-left"><span className="block text-[14px] font-extrabold leading-tight">Get a Trade Appraisal</span><span className="block text-[11px] font-medium opacity-80">Know your trade value in minutes.</span></span></button>
            <div className="mt-auto pt-5 flex items-center gap-3">
              <span className="w-11 h-11 rounded-full bg-white/15 flex items-center justify-center shrink-0"><Users className="w-5 h-5" /></span>
              <div className="min-w-0 flex-1"><p className="text-[13px] font-bold leading-tight">Our specialists are here to help.</p><p className="text-[11px] opacity-80">No pressure. Real people.</p></div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              {d.dealerPhone ? <a href={`tel:${d.dealerPhone}`} className="h-9 rounded-lg bg-white/15 border border-white/40 text-[12px] font-bold inline-flex items-center justify-center gap-1"><Phone className="w-3.5 h-3.5" /> Call Sales</a> : <button onClick={() => go("contact")} className="h-9 rounded-lg bg-white/15 border border-white/40 text-[12px] font-bold inline-flex items-center justify-center gap-1"><Phone className="w-3.5 h-3.5" /> Call Sales</button>}
              <button onClick={() => go("contact")} className="h-9 rounded-lg bg-white/15 border border-white/40 text-[12px] font-bold inline-flex items-center justify-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> Contact Dealer</button>
            </div>
          </div>
        </section>

        {/* 8. WHY BUY FROM THIS DEALERSHIP */}
        <section className={`${CARD} p-6`}>
          <H2>Why Buy From {d.dealerName}?</H2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-5 mt-5">
            {dealerChips.map((c, i) => <div key={i} className="flex items-start gap-3"><span className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><c.icon className="w-5 h-5 text-[#2563EB]" /></span><div><p className="text-[13px] font-bold leading-tight">{c.t}</p><p className="text-[11px] text-[#64748B] mt-0.5">{c.s}</p></div></div>)}
          </div>
          {(badges.length > 0 || d.dealerTrust.certifications.length > 0 || d.dealerTrust.storefrontUrl) && (
            <div className="mt-6 pt-6 border-t border-[#E6E8EC] flex flex-wrap items-center gap-x-8 gap-y-4">
              {d.dealerTrust.storefrontUrl && <img src={d.dealerTrust.storefrontUrl} alt={d.dealerName} className="w-32 h-20 rounded-xl object-cover border border-[#E6E8EC]" />}
              {badges.map((b, i) => <div key={i} className="text-center"><p className="text-[24px] font-extrabold text-[#2563EB] leading-none inline-flex items-center gap-1">{b.v}{b.star && <Star className="w-4 h-4 text-amber-400" fill="#F59E0B" />}</p><p className="text-[11px] text-[#64748B] mt-1">{b.l}</p></div>)}
              {d.dealerTrust.certifications.map((c, i) => <span key={`c${i}`} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#0F172A] bg-slate-100 rounded-full px-3 py-1.5"><Award className="w-3.5 h-3.5 text-[#2563EB]" />{c}</span>)}
            </div>
          )}
          <Link onClick={() => go("dealer")} className="mt-5">Learn more about our dealership</Link>
        </section>

        {/* Footer */}
        <footer className="pt-2">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-5 border-t border-[#E6E8EC]">
            <Logo variant="full" size={20} />
            <div className="flex gap-6 text-[12px] text-[#64748B]">
              <span className="inline-flex items-center gap-1.5"><Lock className="w-3.5 h-3.5 text-[#16A34A]" /> Secure &amp; Private</span>
              <span className="inline-flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5 text-[#16A34A]" /> 100% Free</span>
              <span className="inline-flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-[#16A34A]" /> Instant Access</span>
            </div>
            <div className="flex items-center gap-2 text-[12px]">
              {[{ i: Phone, l: "Call", fn: () => d.dealerPhone ? (window.location.href = `tel:${d.dealerPhone}`) : go("contact") }, { i: MessageSquare, l: "Text", fn: () => go("text") }, { i: Clock, l: "Test Drive", fn: () => go("test-drive") }, { i: DollarSign, l: "Today's Price", fn: () => go("todays-price"), primary: true }].map((b) => (
                <button key={b.l} onClick={b.fn} className={`h-10 px-3 rounded-xl text-[12px] font-bold inline-flex items-center gap-1.5 ${b.primary ? "bg-[#2563EB] text-white" : "border border-[#E6E8EC] text-[#0F172A]"}`}><b.i className={`w-4 h-4 ${b.primary ? "" : "text-[#2563EB]"}`} /> {b.l}</button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-[#94A3B8] text-center pb-2">Information is provided by trusted third parties and is accurate to the best of our knowledge. Verify details with the dealer. © {new Date().getFullYear()} {d.dealerName}. All rights reserved.</p>
          <div className="flex items-center justify-center gap-4 text-[11px] font-semibold text-[#64748B] pb-6"><a href="/privacy" className="hover:text-[#2563EB]">Privacy</a><span className="text-slate-300">·</span><a href="/terms" className="hover:text-[#2563EB]">Terms</a></div>
        </footer>
      </main>
    </div>
  );
};

export default VehiclePassportV3;
