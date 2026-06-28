import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Upload, Bookmark, Printer, FileText, MessageSquare,
  RefreshCw, ShieldCheck, CheckCircle2, Star, Phone, Car, Cog, Fuel, Settings, Wind,
  Award, Wrench, DollarSign, Clock, Building2, Users, Truck, Lock, Zap, ArrowRight,
  Package, Eye, Play, TrendingUp, BadgeCheck, Gauge as GaugeIcon, Send, MapPin,
} from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { useVehicleListing, type VehicleListing } from "@/hooks/useVehicleListing";
import { usePublicListing } from "@/hooks/usePublicListing";
import { formatPhone } from "@/components/addendum/CustomerInfoSection";
import Logo from "@/components/brand/Logo";
import { derivePassport, computePriceHistory, fmt$, listingEquipment } from "@/lib/passportV2Data";
import { resolveStickyButtons, type StickyBottomButtons } from "@/lib/stickyButtons";
import PriceDropWatch from "@/components/listing/PriceDropWatch";
import { listingGallery } from "@/lib/photos";
import { usePassportEngagement } from "@/lib/passportEngagement";
import { packetVisible } from "@/lib/packetModules";
import PassportPanel, { type PassportPanelKey } from "@/components/passport/PassportPanel";
import PassportCtaDock from "@/components/passport/PassportCtaDock";
import PassportInfoModal, { type InfoModalKey } from "@/components/passport/PassportInfoModal";
import { Info } from "lucide-react";
import { BLUE, GREEN, CARD } from "@/lib/passportTokens";

// ──────────────────────────────────────────────────────────────
// VehiclePassportV3 — /passport-v3/:vehicleSlug
//
// Ground-up rebuild against the V3 design board. Tokens (encoded as
// the SHELL/CARD/etc. constants below) come straight from the spec:
// 1320px container, #F6F7F9 surface, #E6E8EC borders, 16px card radius,
// Inter type scale, the documented color system. Data is the same live
// pipeline as V2 (public-listing-view → derivePassport); only the
// presentation layer is new. Every link opens a full destination page.
// ──────────────────────────────────────────────────────────────

const TEXT2 = "text-[#64748B]";

const abbrevDrive = (s: string) => s.replace(/all[- ]?wheel drive/i, "AWD").replace(/front[- ]?wheel drive/i, "FWD").replace(/rear[- ]?wheel drive/i, "RWD").replace(/(four|4)[- ]?wheel drive/i, "4WD");

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
const FlatBaseline = () => <div className="h-9 mt-2 flex items-center"><div className="w-full border-t border-dashed border-[#E6E8EC]" /></div>;
const Spark = ({ points, color = GREEN }: { points: number[]; color?: string }) => {
  if (points.length < 2) return <FlatBaseline />;
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
  if (!values.length) return <FlatBaseline />;
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
      <div className="absolute inset-x-0 bottom-1 text-center"><span className="text-[24px] font-bold text-[#0F172A] leading-none">{score}</span><span className="text-[12px] font-bold text-[#94A3B8]"> /100</span></div>
    </div>
  );
};

// Sample data for the labeled design-preview mode (/passport-v3/:slug?preview=1).
// Never used for real shoppers — only renders when the query flag is present and
// the page shows a prominent "Sample preview" banner. Lets the layout be judged
// against the design goal before live data/back-end deploys land.
export const MOCK_LISTING = {
  id: "mock", slug: "sample", vin: "5N1AL1F83VC332076", ymm: "2027 INFINITI QX60", trim: "LUXE AWD",
  condition: "new", status: "published", mileage: 17, price: 58140, market_value: 61300,
  hero_image_url: "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=900",
  photos: Array.from({ length: 8 }, () => ({ url: "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=900" })),
  videos: [], description: "The 2027 INFINITI QX60 LUXE AWD combines refined luxury, advanced technology, and confident performance in a spacious 3-row SUV. With premium materials, intuitive tech, and family-focused comfort, it is designed for drivers who expect more.",
  key_specs: { engine: "V6 3.5L", drivetrain: "All-Wheel Drive", transmission: "9-Speed Automatic", fuel: "Gasoline", mpg_city: 20, mpg_hwy: 25, exterior_color: "Graphite Shadow", interior_color: "Graphite" },
  mc_attributes: { msrp: 61640, horsepower: 295, owner_count: 1, accident_count: 0, carfax_clean_title: true, dom: 45, seating: 7 },
  market_payload: { high: 64200, low: 56800, belowMarket: 3160 },
  warranty_info: { factory_months: 48, factory_miles: 60000, in_service_date: "2024-10-01" },
  recon: {
    inspection: { type: "Multi-point inspection", passed: true, date: "2025-04-12" },
    detailed: true, detailDate: "2025-04-13",
    workItems: ["Oil & filter service", "Four new tires", "Brake inspection", "Full interior & exterior detail", "Cabin air filter"],
    thirdParty: [{ product: "Ceramic coating", company: "ProShield" }],
    photos: [],
  },
  recall_status: "clear", open_recall_count: 0, view_count: 89, service_records: [{}, {}, {}],
  prep_status: { foreman_signed_at: "2025-04-12" },
  dealer_snapshot: { name: "Harte INFINITI", phone: "8605551234", address: "1 Auto Way", city: "Hartford", state: "CT", zip: "06103", review_rating: 4.8, review_count: 1248 },
  dealer_trust: { years_in_business: "45", satisfaction: "98%", bbb_rating: "A+", google_rating: "4.9", google_count: "1248", certifications: "INFINITI Award of Excellence, 2024 Consumer Satisfaction", storefront_url: "https://images.unsplash.com/photo-1560179707-f14e90ef3623?w=400", review_sources: "Google | 4.9 | Excellent family SUV. Very smooth ride.\nEdmunds | 4.7 | Quiet, comfortable, and packed with technology.\nCars.com | 4.8 | Luxury feel without the luxury price.", advisor_name: "John Smith", advisor_title: "Senior Vehicle Specialist", advisor_photo: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200", advisor_response: "Usually replies within 5 minutes", family_owned: "yes", service_location: "offsite", service_address: "120 Service Drive, Hartford, CT 06120", delivery: "regional", financing: "yes", amenities: "Customer lounge, Café, Kids area, EV charging, Loaner vehicles", services: "OEM parts, Warranty repairs, Online scheduling, State inspection, Express service", hours: "Mon–Sat 9–7, Sun 11–4" },
  features: [{ title: "3rd Row", subtitle: "Seating" }, { title: "Panoramic", subtitle: "Moonroof" }, { title: "Heated", subtitle: "Seats" }, { title: "Premium", subtitle: "Audio" }],
  documents: [
    { type: "purchase_agreement", name: "Purchase Agreement", url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", uploaded_at: "2025-05-18" },
    { type: "buyers_order", name: "Buyer's Order", url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", uploaded_at: "2025-05-18" },
    { type: "retail_installment", name: "Retail Installment Contract", url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", uploaded_at: "2025-05-18" },
    { type: "carfax", name: "CARFAX Vehicle History Report", url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", uploaded_at: "2025-05-17" },
    { type: "maintenance_records", name: "Maintenance Records", url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", uploaded_at: "2025-04-28" },
    { type: "manufacturer_warranty", name: "Manufacturer Warranty", url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", uploaded_at: "2025-05-17" },
    { type: "extended_warranty", name: "Extended Warranty", url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", uploaded_at: "2025-05-17" },
    { type: "inspection_checklist", name: "Multi-Point Inspection Checklist", url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", uploaded_at: "2025-05-12" },
    { type: "window_sticker", name: "Window Sticker (Monroney)", url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", uploaded_at: "2025-05-10" },
  ],
  value_history: [
    { captured_at: "2025-05-01", market_value: 61800, listing_price: 59500, below_market: 2300, position: "good_deal" },
    { captured_at: "2025-05-15", market_value: 61500, listing_price: 59000, below_market: 2500, position: "good_deal" },
    { captured_at: "2025-06-01", market_value: 61300, listing_price: 58360, below_market: 2940, position: "great_deal" },
    { captured_at: "2025-06-20", market_value: 61300, listing_price: 58140, below_market: 3160, position: "great_deal" },
  ],
};

// ── Lead modal is intentionally absent — every action routes to a full page ──
const VehiclePassportV3 = () => {
  // Canonical route is /v/:slug (param `slug`); legacy /passport-v3/:vehicleSlug
  // still resolves here too, so accept either param name.
  const params = useParams<{ vehicleSlug?: string; slug?: string }>();
  const vehicleSlug = params.vehicleSlug ?? params.slug;
  const navigate = useNavigate();
  const { publicUrl } = useVehicleListing("");
  const [idx, setIdx] = useState(0);
  const [zip, setZip] = useState("");
  const [showSticky, setShowSticky] = useState(false);
  const [activePanel, setActivePanel] = useState<PassportPanelKey | null>(null);
  const panelTriggerRef = useRef<HTMLElement | null>(null);
  const openPanel = (key: PassportPanelKey, e?: React.MouseEvent) => { if (e) panelTriggerRef.current = e.currentTarget as HTMLElement; setActivePanel(key); };
  const closePanel = () => { setActivePanel(null); panelTriggerRef.current?.focus(); };
  const [activeInfo, setActiveInfo] = useState<InfoModalKey | null>(null);
  const infoTriggerRef = useRef<HTMLElement | null>(null);
  const openInfo = (key: InfoModalKey, e: React.MouseEvent) => { e.stopPropagation(); infoTriggerRef.current = e.currentTarget as HTMLElement; setActiveInfo(key); };
  const closeInfo = () => { setActiveInfo(null); infoTriggerRef.current?.focus(); };

  useEffect(() => {
    const onScroll = () => setShowSticky(window.scrollY > 360);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const isPreview = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("preview");
  const { listing, loading, notFound } = usePublicListing(vehicleSlug, { preview: isPreview, previewData: MOCK_LISTING as unknown as VehicleListing });

  const d = useMemo(() => (listing ? derivePassport(listing) : null), [listing]);
  const gallery = useMemo(() => (listing ? listingGallery(listing) : ([] as string[])), [listing]);
  // Shopper Focus Breakdown — time per module + open panel (skipped in preview).
  usePassportEngagement(listing?.slug || vehicleSlug, activePanel, !isPreview);

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-[#F6F7F9]"><div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" /></div>;
  if (notFound || !listing || !d) return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[#F6F7F9]"><div className="text-center"><Package className="w-12 h-12 text-slate-300 mx-auto mb-4" /><h1 className="text-xl font-bold">Vehicle unavailable</h1><p className="text-sm text-slate-500 mt-2">This listing may have been sold or unpublished.</p></div></div>
  );

  const go = (section: string) => navigate(`/v/${listing.slug || vehicleSlug}/${section}${isPreview ? "?preview=1" : ""}`);
  const viewUrl = publicUrl(listing.slug);
  const handleShare = async () => { try { if (navigator.share) { await navigator.share({ title: listing.ymm || "Vehicle", url: viewUrl }); return; } } catch { return; } go("share"); };
  const hero = gallery[idx] || gallery[0] || "";
  const photoCount = gallery.length;
  const { priceChange7d } = computePriceHistory(listing);
  const priceSeries = d.valueHistory.filter((h) => h.listing_price != null).map((h) => h.listing_price as number);
  const marketSeries = d.valueHistory.filter((h) => h.market_value != null).map((h) => h.market_value as number);

  const verifyL = d.verifyRows.slice(0, Math.ceil(d.verifyRows.length / 2));
  const verifyR = d.verifyRows.slice(Math.ceil(d.verifyRows.length / 2));

  // Packet curation: a module renders unless the dealer switched it off
  // (Vehicle File → Scan Info). Required disclosures are never curatable.
  const pv = (id: string) => packetVisible(listing, id);

  const actions = [
    ...(pv("documents") ? [{ icon: FileText, label: "Documents", onClick: () => go("documents") }] : []),
    { icon: MessageSquare, label: "Contact Dealer", onClick: () => go("contact") },
    { icon: RefreshCw, label: "Value My Trade", onClick: () => go("trade") },
    { icon: Upload, label: "Share Vehicle", onClick: handleShare },
  ];

  // Dealer-configurable sticky bar (admin → Passport CTAs). Resolves the chosen
  // buttons/order/primary/labels; falls back to Call/Text/Test Drive/Today's
  // Price when unconfigured. Drives both the desktop footer row and mobile bar.
  const sticky = resolveStickyButtons((listing as unknown as { sticky_bottom_buttons?: StickyBottomButtons }).sticky_bottom_buttons);
  const stickyAction = (key: string): { icon: React.ElementType; onClick: () => void } => {
    const call = () => { if (d.dealerPhone) window.location.href = `tel:${d.dealerPhone}`; else go("contact"); };
    const text = () => { if (d.dealerPhone) window.location.href = `sms:${d.dealerPhone.replace(/[^\d+]/g, "")}`; else go("text"); };
    const directions = () => window.open(`https://maps.google.com/?q=${encodeURIComponent(d.dealerAddress || d.dealerName)}`, "_blank", "noopener");
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
      schedule_service: { icon: Clock, onClick: () => go("contact") },
      payment_options: { icon: DollarSign, onClick: () => go("todays-price") },
      calculate_payment: { icon: DollarSign, onClick: () => go("todays-price") },
      send_to_phone: { icon: Send, onClick: handleShare },
      save_vehicle: { icon: Bookmark, onClick: () => toast.success("Saved to this device") },
      share_vehicle: { icon: Upload, onClick: handleShare },
      directions: { icon: MapPin, onClick: directions },
      chat: { icon: MessageSquare, onClick: () => go("contact") },
      email_dealer: { icon: Send, onClick: () => go("contact") },
    };
    return map[key] || { icon: CheckCircle2, onClick: () => go("check-availability") };
  };

  const compPrices = d.comparables.map((c) => (c as { price?: number }).price).filter((p): p is number => typeof p === "number" && p > 0);
  const compFrom = compPrices.length ? Math.min(...compPrices) : null;
  const compCount = d.comparables.length || d.marketMeta.similarCount || 0;
  const mi = [
    { icon: DollarSign, title: "Market Price", strong: d.belowMarket && d.belowMarket > 0 ? "Great Price" : d.marketAvg != null ? "Market Price" : "Pending",
      sub: d.belowMarket && d.belowMarket > 0 ? `${fmt$(d.belowMarket)} below market average` : d.marketAvg != null ? `Market avg ${fmt$(d.marketAvg)}` : "Awaiting MarketCheck", chart: <Spark points={marketSeries} />, section: "market-price", cta: "View report" },
    { icon: TrendingUp, title: "Market Demand", strong: (d.viewCount != null || d.dom != null) ? ((d.viewCount ?? 0) > 20 ? "High Interest" : "Active") : "Pending",
      sub: [d.viewCount != null ? `${d.viewCount.toLocaleString()} views` : null, d.dom != null ? `${d.dom} days on market` : null].filter(Boolean).join(" · ") || "Tracked once live", chart: null, section: "market-demand", cta: "View report" },
    { icon: GaugeIcon, title: "Price Confidence", strong: d.belowMarket && d.belowMarket > 0 ? "Excellent" : d.marketAvg != null ? "Fair" : "Pending",
      sub: d.marketAvg != null ? "based on live comparables" : "Awaiting MarketCheck", donut: d.confScore, section: "price-confidence", cta: "View report" },
    { icon: Clock, title: "Price History", strong: priceChange7d != null && priceChange7d !== 0 ? `${priceChange7d < 0 ? "-" : "+"}${fmt$(Math.abs(priceChange7d))}` : "7-Day Trend",
      sub: priceChange7d != null ? (priceChange7d < 0 ? "price decreased" : priceChange7d > 0 ? "price increased" : "stable") : "History builds over time", chart: <Spark points={priceSeries} color="#7C3AED" />, section: "price-history", cta: "View history" },
    { icon: Car, title: "Comparable Vehicles", strong: compCount ? `${compCount} Nearby` : "Comp set",
      sub: compFrom != null ? `Similar vehicles from ${fmt$(compFrom)}` : "Similar vehicles via MarketCheck", comps: false, section: "comparable-vehicles", cta: "View comp set" },
    { icon: Package, title: "Inventory Trend", strong: d.marketMeta.daysSupply != null ? `${Math.round(d.marketMeta.daysSupply)}-Day Supply` : "Market Supply",
      sub: d.marketMeta.daysSupply != null ? (d.marketMeta.inventoryCount != null ? `${d.marketMeta.inventoryCount} similar listed` : "Regional days-supply") : "Market supply via MarketCheck", chart: null, section: "inventory-trend", cta: "View trend" },
  ];

  const highlights: { icon: React.ElementType; t: string; s: string }[] = [];
  // Specs are written into mc_attributes by the pull; key_specs is usually
  // empty, so merge mc_attributes in (mapping its field names) before reading.
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const ksRaw = (listing.key_specs || {}) as Record<string, unknown>;
  const ks = {
    engine: (ksRaw.engine ?? mc.engine ?? undefined) as string | undefined,
    drivetrain: (ksRaw.drivetrain ?? mc.drivetrain ?? undefined) as string | undefined,
    transmission: (ksRaw.transmission ?? mc.transmission ?? undefined) as string | undefined,
    fuel: (ksRaw.fuel ?? mc.fuel_type ?? undefined) as string | undefined,
    mpg_city: (ksRaw.mpg_city ?? mc.city_mpg ?? undefined) as number | undefined,
    mpg_hwy: (ksRaw.mpg_hwy ?? mc.highway_mpg ?? undefined) as number | undefined,
    exterior_color: (ksRaw.exterior_color ?? mc.exterior_color ?? undefined) as string | undefined,
  };
  if (ks.engine) highlights.push({ icon: Cog, t: ks.engine, s: "Engine" });
  if (mc.horsepower) highlights.push({ icon: Zap, t: `${mc.horsepower} HP`, s: "Power" });
  if (ks.drivetrain) highlights.push({ icon: Car, t: abbrevDrive(ks.drivetrain), s: "Drivetrain" });
  if (ks.mpg_city && ks.mpg_hwy) highlights.push({ icon: Fuel, t: `${ks.mpg_city}/${ks.mpg_hwy}`, s: "MPG" });
  else if (ks.mpg_city) highlights.push({ icon: Fuel, t: `${ks.mpg_city}`, s: "City MPG" });
  else if (ks.fuel) highlights.push({ icon: Fuel, t: ks.fuel, s: "Fuel" });
  if (ks.transmission) highlights.push({ icon: Settings, t: ks.transmission.replace(/\s*automatic/i, "").trim(), s: "Transmission" });
  if (ks.exterior_color) highlights.push({ icon: Wind, t: ks.exterior_color, s: "Exterior" });
  listingEquipment(listing).forEach((label) => { if (highlights.length < 8) highlights.push({ icon: Award, t: label, s: "Feature" }); });

  // Dealer trust chips — only render what the dealer actually configured
  // (onboarding / admin), so we never assert an unverified capability.
  const dt = d.dealerTrust;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const dealerChips: { icon: React.ElementType; t: string; s: string }[] = [];
  if (dt.familyOwned) dealerChips.push({ icon: Building2, t: "Family Owned", s: dt.yearsInBusiness ? `Since ${new Date().getFullYear() - Number(dt.yearsInBusiness)}` : "Locally owned" });
  else if (dt.yearsInBusiness) dealerChips.push({ icon: Building2, t: "Established", s: `Since ${new Date().getFullYear() - Number(dt.yearsInBusiness)}` });
  if (dt.googleRating) dealerChips.push({ icon: Star, t: "Top Rated", s: `${dt.googleRating} Google Rating` });
  if (dt.certifications.length) dealerChips.push({ icon: Wrench, t: "Factory Certified", s: dt.certifications[0] });
  if (dt.serviceLocation === "onsite") dealerChips.push({ icon: Settings, t: "Service Center", s: "On-site" });
  else if (dt.serviceLocation === "offsite") dealerChips.push({ icon: Settings, t: "Service Center", s: "Off-site" });
  if (dt.delivery && dt.delivery !== "none") dealerChips.push({ icon: Truck, t: "Delivery Available", s: cap(dt.delivery) });
  if (dt.financing) dealerChips.push({ icon: DollarSign, t: "Financing", s: "On-site" });
  const badges = [
    d.dealerTrust.yearsInBusiness ? { v: `${d.dealerTrust.yearsInBusiness}+`, l: "Years in Business" } : null,
    d.dealerTrust.googleRating ? { v: d.dealerTrust.googleRating, l: d.dealerTrust.googleCount ? `Google (${Number(d.dealerTrust.googleCount).toLocaleString()})` : "Google Rating", star: true } : null,
    d.dealerTrust.satisfaction ? { v: d.dealerTrust.satisfaction, l: "Customer Satisfaction" } : null,
    d.dealerTrust.bbbRating ? { v: d.dealerTrust.bbbRating, l: "BBB Rating" } : null,
  ].filter(Boolean) as { v: string; l: string; star?: boolean }[];

  const price = d.price;
  const adv = d.dealerTrust;

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#0F172A]" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <Helmet><title>{`${listing.ymm}${listing.trim ? ` ${listing.trim}` : ""} — ${d.dealerName}`}</title><meta name="description" content={`${listing.ymm}${price != null ? ` · ${fmt$(price)}` : ""} · ${d.dealerName}`} />{isPreview && <meta name="robots" content="noindex" />}</Helmet>

      {isPreview && (
        <div className="bg-amber-500 text-white text-center text-[12px] font-bold py-1.5 px-4">SAMPLE PREVIEW — design layout with placeholder data. Not a real listing.</div>
      )}

      {/* Top bar */}
      <header className="border-b border-[#E6E8EC] bg-white">
        <div className="mx-auto max-w-[1320px] px-4 sm:px-5 h-16 flex items-center justify-between">
          {listing.dealer_snapshot?.logo_url ? <img src={listing.dealer_snapshot.logo_url as string} alt="" className="h-7" /> : <Logo variant="full" size={22} />}
          <div className="flex items-center gap-3 sm:gap-5">
            <button onClick={handleShare} className={`text-sm font-medium inline-flex items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Upload className="w-4 h-4" /> <span className="hidden sm:inline">Share</span></button>
            <button onClick={() => toast.success("Saved to this device")} className={`hidden sm:inline-flex text-sm font-medium items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Bookmark className="w-4 h-4" /> Save</button>
            <button onClick={() => window.print()} className={`hidden sm:inline-flex text-sm font-medium items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Printer className="w-4 h-4" /> Print</button>
            <button onClick={() => go("check-availability")} className="h-11 px-3.5 sm:px-5 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-sm font-semibold inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> <span className="hidden sm:inline">Check Availability</span><span className="sm:hidden">Check</span></button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1320px] px-4 sm:px-5 py-5 sm:py-6 pb-[calc(92px+env(safe-area-inset-bottom))] lg:pb-6 space-y-6 max-[767px]:space-y-8 lg:space-y-7">
        {/* 1–2. TOP ZONE */}
        <section data-module="vehicle-details" className="grid grid-cols-1 lg:grid-cols-[minmax(0,380px)_1fr] gap-5">
          {/* Gallery */}
          <div>
            <div className="relative overflow-hidden rounded-2xl bg-[#1f2227] aspect-[4/3] max-[767px]:aspect-[5/4]">
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
              {pv("videos") && listing.videos?.length ? <a href={listing.videos[0].url} target="_blank" rel="noreferrer" className="flex-1 h-10 rounded-xl border border-[#E6E8EC] bg-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"><Play className="w-4 h-4 text-[#2563EB]" /> Walkaround Video</a> : null}
            </div>
          </div>

          {/* Right of gallery */}
          <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-5">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg bg-blue-100 text-blue-700">{listing.condition || "vehicle"}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg ${listing.status === "published" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{listing.status}</span>
                  </div>
                  <h1 className="text-[32px] font-bold leading-10 tracking-tight">{listing.ymm}</h1>
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
                    {d.docFee ? (
                      <div className="text-[12px] text-[#64748B]">
                        {d.priceIncludesDoc
                          ? `Incl. ${fmt$(d.docFee)} doc fee`
                          : `+ ${fmt$(d.docFee)} doc fee · Sale ${fmt$(d.websiteSalePrice ?? price + d.docFee)}`}
                      </div>
                    ) : null}
                    {pv("payment") && d.estMonthly != null && <div className="text-[12px] text-[#64748B]">Est. {fmt$(d.estMonthly)}/mo</div>}
                    {d.msrp != null && <div className="text-[12px] text-[#64748B]">MSRP {fmt$(d.msrp)}</div>}
                    {d.saveVsMsrp != null && <div className="text-[13px] font-semibold text-[#16A34A]">You save {fmt$(d.saveVsMsrp)}</div>}
                  </div>
                )}
              </div>

              {/* Verification card */}
              {d.verifyRows.length > 0 && (
                <div className={`${CARD} p-5`}>
                  <div className="flex items-start gap-2">
                    <button onClick={() => go("verification")} className="flex items-center gap-2.5 text-left flex-1 min-w-0">
                      <span className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0"><ShieldCheck className="w-5 h-5 text-[#16A34A]" /></span>
                      <div><p className="text-[15px] font-bold">AutoLabels Verified</p><p className="text-[12px] text-[#64748B]">Independently checked against trusted automotive data.</p></div>
                    </button>
                    <button onClick={(e) => openInfo("verification-process", e)} aria-label="How verification works" className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center shrink-0"><Info className="w-4 h-4 text-[#94A3B8]" /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 mt-4">
                    {[verifyL, verifyR].map((col, ci) => <div key={ci} className="space-y-2.5">{col.map((r) => <div key={r.label} className="flex items-center gap-2 text-[13px] font-medium text-[#0F172A]"><CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" />{r.label}</div>)}</div>)}
                  </div>
                  <Link onClick={() => go("verification")} className="mt-4">View full verification report</Link>
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
              {price != null && <PriceDropWatch slug={listing.slug || vehicleSlug || listing.vin} enabled={(listing as unknown as { price_drop_watch?: boolean }).price_drop_watch !== false} />}
            </div>
          </div>
        </section>

        {/* 3.5 RECONDITIONING PROOF — value-building, above the fold.
            Customers see everything the dealership did to prep the vehicle;
            one dominant CTA moves them to request a price. Only declined work
            is ever hidden — every fact here is cost-free and PII-free. */}
        {pv("recon") && d.recon && (() => {
          const r = d.recon;
          const stepCount = r.workItems.length + (r.inspection ? 1 : 0) + r.thirdParty.length;
          return (
            <section data-module="recon" className={`${CARD} p-0 overflow-hidden`}>
              <div className="bg-[#0F172A] px-6 py-6 sm:px-8 sm:py-7">
                <div className="flex flex-wrap items-center justify-between gap-5">
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold uppercase tracking-wider text-emerald-400 inline-flex items-center gap-1.5"><BadgeCheck className="w-4 h-4" /> Dealer-Certified Reconditioning</p>
                    <h2 className="text-[22px] sm:text-[26px] font-bold text-white leading-tight mt-1.5">Everything we did to get this vehicle ready for you</h2>
                    <p className="text-[13px] text-slate-300 mt-1.5 max-w-xl">Before this {listing.ymm || "vehicle"} was listed, our team completed and documented {stepCount} reconditioning, safety, and detailing step{stepCount === 1 ? "" : "s"} — so you can buy with total confidence.</p>
                  </div>
                  <div className="flex items-center gap-6 shrink-0">
                    <div className="text-center"><p className="text-[34px] font-extrabold text-emerald-400 leading-none">{stepCount}</p><p className="text-[11px] text-slate-400 mt-1 leading-tight">Steps<br />completed</p></div>
                    {r.inspection && <div className="text-center"><ShieldCheck className="w-8 h-8 text-emerald-400 mx-auto" /><p className="text-[11px] text-slate-300 mt-1 leading-tight font-semibold">{r.inspection.passed ? "Passed" : "Done"}<br />inspection</p></div>}
                  </div>
                </div>
              </div>
              <div className="p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-7">
                <div>
                  {r.inspection && (
                    <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 mb-4">
                      <span className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0"><ShieldCheck className="w-5 h-5 text-[#16A34A]" /></span>
                      <div className="min-w-0"><p className="text-[14px] font-bold text-[#0F172A]">{r.inspection.passed ? "Passed" : "Completed"} — {r.inspection.type}</p>{r.inspection.date && <p className="text-[12px] text-[#64748B]">Documented {new Date(r.inspection.date).toLocaleDateString()}</p>}</div>
                    </div>
                  )}
                  {r.detailed && <p className="text-[14px] font-semibold text-[#16A34A] inline-flex items-center gap-1.5 mb-3"><Wrench className="w-4 h-4" /> Professionally reconditioned &amp; detailed{r.detailDate ? ` · ${new Date(r.detailDate).toLocaleDateString()}` : ""}</p>}
                  {r.workItems.length > 0 && (
                    <>
                      <p className="text-[13px] font-semibold text-[#0F172A] mb-2.5">Completed work</p>
                      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2">{r.workItems.slice(0, 16).map((w, i) => <li key={i} className="flex items-start gap-2 text-[13px]"><CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />{w}</li>)}</ul>
                      {r.workItems.length > 16 && <p className="text-[12px] text-[#94A3B8] mt-2">+{r.workItems.length - 16} more completed</p>}
                    </>
                  )}
                  {r.thirdParty.length > 0 && (
                    <div className="mt-5">
                      <p className="text-[13px] font-semibold text-[#0F172A] mb-2.5">Premium add-ons installed</p>
                      <div className="flex flex-wrap gap-1.5">{r.thirdParty.map((t, i) => <span key={i} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#334155] bg-blue-50 border border-blue-100 rounded-full px-3 py-1.5"><Award className="w-3.5 h-3.5 text-[#2563EB]" />{t.product} · {t.company}</span>)}</div>
                    </div>
                  )}
                </div>
                <div className="flex flex-col">
                  {r.photos.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">{r.photos.slice(0, 9).map((p, i) => <a key={i} href={p} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden aspect-square bg-slate-100 hover:opacity-90 transition-opacity"><img src={p} alt="" loading="lazy" className="w-full h-full object-cover" /></a>)}</div>
                  )}
                  <div className="mt-auto pt-5">
                    <div className="rounded-2xl border border-[#E6E8EC] bg-[#F8FAFC] p-5">
                      <p className="text-[15px] font-bold text-[#0F172A]">This work is already done — and included.</p>
                      <p className="text-[13px] text-[#64748B] mt-1">See your personalized out-the-door price on a vehicle that's been fully prepped and ready to drive home.</p>
                      <button onClick={() => go("todays-price")} className="mt-3.5 w-full h-12 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-[15px] font-bold inline-flex items-center justify-center gap-2"><DollarSign className="w-5 h-5" /> Get my out-the-door price</button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          );
        })()}

        {/* 4. MARKET INTELLIGENCE */}
        {pv("marketValue") && (
        <section data-module="market" className={`${CARD} p-5`}>
          <div className="flex items-center justify-between"><div><H2>Market Intelligence</H2><p className={`text-[13px] ${TEXT2} mt-0.5`}>Independent pricing, demand, and value analysis for this vehicle.</p></div><span className="text-[12px] text-[#94A3B8] inline-flex items-center gap-1">Powered by MarketCheck<button onClick={(e) => openInfo("data-sources", e)} aria-label="Data sources explained" className="w-4 h-4 inline-flex items-center justify-center"><Info className="w-3.5 h-3.5 text-[#94A3B8]" /></button></span></div>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mt-5">
            {mi.map((c) => (
              <div key={c.section} onClick={(e) => openPanel(c.section as PassportPanelKey, e)} className="rounded-xl border border-[#E6E8EC] p-4 flex flex-col cursor-pointer hover:border-[#2563EB] transition-colors">
                <div className="flex items-center gap-1.5 mb-2"><c.icon className="w-4 h-4 text-[#2563EB]" /><span className="text-[12px] font-semibold text-[#64748B]">{c.title}</span></div>
                {c.donut != null ? <div className="flex flex-col items-center text-center"><Donut pct={c.donut} label={`${c.donut}`} /><p className="text-[14px] font-extrabold text-[#16A34A] leading-tight mt-2">{c.strong}</p><p className="text-[11px] text-[#64748B] leading-snug">{c.sub}</p></div>
                  : <><p className={`text-[16px] font-extrabold leading-tight ${/Great|High|Excellent|^-/.test(String(c.strong)) ? "text-[#16A34A]" : "text-[#0F172A]"}`}>{c.strong}</p><p className="text-[11px] text-[#64748B] leading-snug mt-0.5 flex-1">{c.sub}</p>{c.comps ? <div className="flex gap-1 mt-2">{[0, 1, 2].map((i) => <div key={i} className="flex-1 h-8 rounded bg-[#F1F5F9] flex items-center justify-center"><Car className="w-4 h-4 text-[#94A3B8]" /></div>)}</div> : c.chart}</>}
                <button onClick={(e) => { e.stopPropagation(); openPanel(c.section as PassportPanelKey, e); }} className="mt-2.5 text-[12px] font-semibold text-[#2563EB] inline-flex items-center gap-1 hover:underline">{c.cta} <ArrowRight className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[#94A3B8] mt-3">Market values are estimates from third-party data and may vary by region and time.</p>
        </section>
        )}

        {/* 5. PRIMARY TRUST GRID */}
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-5 items-stretch">
          {/* Why This Is A Great Buy */}
          {pv("insights") && (
          <div className={`${CARD} p-5 flex flex-col max-[767px]:p-6 max-[767px]:ring-1 max-[767px]:ring-blue-200 max-[767px]:shadow-[0_10px_30px_rgba(37,99,235,0.10)]`}>
            <H3>Why This Is A Great Buy</H3>
            {d.confScore != null && (
              <div className="flex flex-col items-center mt-3 rounded-xl bg-emerald-50/60 border border-emerald-100 p-3">
                <p className="text-[11px] font-semibold text-[#64748B] inline-flex items-center gap-1">AutoLabels Confidence Score<button onClick={(e) => openInfo("score-meaning", e)} aria-label="What does this score mean?" className="w-4 h-4 inline-flex items-center justify-center"><Info className="w-3.5 h-3.5 text-[#94A3B8]" /></button></p>
                <Semi score={d.confScore} />
                <p className="text-[13px] font-extrabold text-[#16A34A] -mt-1">{d.confLabel} Value</p>
              </div>
            )}
            <ul className="mt-3 space-y-2">{(d.whyBuy.length ? d.whyBuy.slice(0, 6) : ["Details confirmed at the dealership"]).map((b, i) => <li key={i} className="flex items-start gap-2 text-[13px]"><CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />{b}</li>)}</ul>
            <Link onClick={() => go("great-buy")} className="mt-auto pt-3 self-start">See full buying report</Link>
          </div>
          )}

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
          <div onClick={(e) => openPanel("ownership-timeline", e)} className={`${CARD} p-5 flex flex-col cursor-pointer hover:border-[#2563EB] transition-colors`}>
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
            <Link onClick={() => openPanel("ownership-timeline")} className="mt-auto pt-3 self-start">View full timeline</Link>
          </div>

          {/* Factory Warranty */}
          {pv("warranty") && (
          <div data-module="warranty" className={`${CARD} p-5 flex flex-col`}>
            <div className="flex items-center gap-1.5"><H3>Factory Warranty</H3><button onClick={(e) => openInfo("warranty-terms", e)} aria-label="Warranty terminology" className="w-6 h-6 rounded-full hover:bg-slate-100 flex items-center justify-center"><Info className="w-3.5 h-3.5 text-[#94A3B8]" /></button></div>
            {d.warrantyStr ? (() => {
              const w = d.warranty;
              const milesLeft = w.factory_miles != null && listing.mileage != null ? Math.max(0, w.factory_miles - listing.mileage) : null;
              const milesPct = w.factory_miles && listing.mileage != null ? Math.max(3, 100 - Math.min(100, (listing.mileage / w.factory_miles) * 100)) : null;
              let monthsLeft: number | null = null, monthsPct: number | null = null, expiry: string | null = null;
              if (w.in_service_date && w.factory_months) { const end = new Date(w.in_service_date); end.setMonth(end.getMonth() + w.factory_months); expiry = end.toLocaleDateString(); const ms = end.getTime() - Date.now(); monthsLeft = ms > 0 ? Math.round(ms / (1000 * 60 * 60 * 24 * 30.4)) : 0; monthsPct = Math.max(3, Math.min(100, (monthsLeft / w.factory_months) * 100)); }
              return <>
                <div className="flex items-center gap-2 mt-2"><span className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center"><ShieldCheck className="w-4 h-4 text-[#16A34A]" /></span><p className="text-[12px] text-[#64748B]">{d.warrantyStr} remaining</p></div>
                {monthsPct != null && <div className="mt-3"><div className="flex justify-between text-[12px]"><span className="text-[#64748B]">Time Remaining</span><span className="font-bold">{monthsLeft} <span className="text-[#94A3B8] font-medium">of {w.factory_months} mo</span></span></div><div className="mt-1.5 h-3.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${monthsPct}%` }} /></div></div>}
                {milesPct != null && <div className="mt-3"><div className="flex justify-between text-[12px]"><span className="text-[#64748B]">Mileage Remaining</span><span className="font-bold">{milesLeft!.toLocaleString()} <span className="text-[#94A3B8] font-medium">of {(w.factory_miles! / 1000).toFixed(0)}K mi</span></span></div><div className="mt-1.5 h-3.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${milesPct}%` }} /></div></div>}
                {expiry && <p className="text-[11px] text-[#64748B] mt-3">Expires {expiry}</p>}
              </>;
            })() : <p className="text-[13px] text-[#64748B] mt-3">Coverage details confirmed at the dealership.</p>}
            <Link onClick={() => openPanel("factory-warranty")} className="mt-auto pt-3 self-start">View warranty details</Link>
          </div>
          )}

          {/* What Owners Say */}
          <div className={`${CARD} p-5 flex flex-col`}>
            <H3>What Owners Say</H3>
            {d.reviewRating != null && <div className="flex items-center gap-2 mt-2"><span className="text-[24px] font-bold text-[#2563EB]">{d.reviewRating.toFixed(1)}</span><Stars n={d.reviewRating} />{d.reviewCount != null && <span className="text-[12px] text-[#64748B]">({d.reviewCount.toLocaleString()})</span>}</div>}
            {d.dealerTrust.reviewSources.length > 0 ? (
              <div className="mt-3 space-y-3">{d.dealerTrust.reviewSources.slice(0, 3).map((r, i) => <div key={i}><div className="flex items-center gap-2"><span className="text-[12px] font-bold">{r.name}</span>{r.rating != null && <Stars n={r.rating} size={12} />}</div>{r.quote && <p className="text-[12px] text-[#64748B] leading-snug">"{r.quote}"</p>}</div>)}</div>
            ) : <p className="text-[13px] text-[#64748B] mt-3">Verified dealership reviews appear here when the dealer connects a review source.</p>}
            <Link onClick={() => openPanel("owner-reviews")} className="mt-auto pt-3 self-start">Read all reviews</Link>
          </div>
        </section>

        {/* 7. INFORMATION GRID — three equal-height cards (the conversion CTA
            now lives in the sticky right rail). */}
        <section className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1.6fr] gap-5 items-stretch">
          {/* Highlights */}
          {pv("factoryOptions") && (
          <div data-module="highlights" className={`${CARD} p-5 flex flex-col`}>
            <H3>Vehicle Highlights</H3>
            {highlights.length ? (
              <div className="grid grid-cols-4 gap-y-4 gap-x-2 mt-4">{highlights.slice(0, 8).map((h, i) => <div key={i} className="flex flex-col items-center text-center gap-1.5"><span className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><h.icon className="w-5 h-5 text-[#2563EB]" /></span><div className="w-full min-w-0"><div className="text-[11px] font-bold leading-tight line-clamp-2 break-words">{h.t}</div><div className="text-[10px] text-[#94A3B8] truncate">{h.s}</div></div></div>)}</div>
            ) : <p className="text-[13px] text-[#64748B] mt-3">Equipment highlights appear here as the vehicle's data is decoded.</p>}
            <div className="mt-auto pt-3 flex items-center gap-4">
              <Link onClick={() => openPanel("highlights")} className="self-start">All features</Link>
              <Link onClick={() => openPanel("key-specs")} className="self-start">Full specs</Link>
            </div>
          </div>
          )}
          {/* Overview */}
          {pv("description") && (
          <div data-module="overview" className={`${CARD} p-5 flex flex-col`}>
            <H3>Vehicle Overview</H3>
            <p className="text-[13px] leading-relaxed text-[#64748B] mt-3 line-clamp-6">{d.overview}</p>
            {(gallery[1] || gallery[0]) && <img src={gallery[1] || gallery[0]} alt="" className="w-full aspect-[16/9] object-cover rounded-xl mt-3" />}
            <Link onClick={() => openPanel("overview")} className="mt-auto pt-3 self-start">Read full overview</Link>
          </div>
          )}
          {/* Why Buy From This Dealership (wider) */}
          <div data-module="dealer" className={`${CARD} p-5 flex flex-col`}>
            <H3>Why Buy From {d.dealerName}?</H3>
            {dealerChips.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-5 gap-y-4 mt-4">
                {dealerChips.map((c, i) => <div key={i} className="flex items-start gap-2.5"><span className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><c.icon className="w-[18px] h-[18px] text-[#2563EB]" /></span><div className="min-w-0"><p className="text-[12px] font-bold leading-tight">{c.t}</p><p className="text-[10px] text-[#64748B] mt-0.5 truncate">{c.s}</p></div></div>)}
              </div>
            ) : <p className="text-[13px] text-[#64748B] mt-3">Learn what makes {d.dealerName} a trusted choice.</p>}
            {(badges.length > 0 || d.dealerTrust.certifications.length > 0 || d.dealerTrust.storefrontUrl) && (
              <div className="mt-5 pt-5 border-t border-[#E6E8EC] flex flex-wrap items-center gap-x-6 gap-y-4">
                {d.dealerTrust.storefrontUrl && <img src={d.dealerTrust.storefrontUrl} alt={d.dealerName} className="w-28 h-20 rounded-xl object-cover border border-[#E6E8EC]" />}
                {badges.map((b, i) => <div key={i} className="text-center"><p className="text-[22px] font-bold text-[#2563EB] leading-none inline-flex items-center gap-1">{b.v}{b.star && <Star className="w-3.5 h-3.5 text-amber-400" fill="#F59E0B" />}</p><p className="text-[10px] text-[#64748B] mt-1">{b.l}</p></div>)}
                {d.dealerTrust.certifications.map((c, i) => <span key={`c${i}`} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#0F172A] bg-slate-100 rounded-full px-2.5 py-1"><Award className="w-3 h-3 text-[#2563EB]" />{c}</span>)}
              </div>
            )}
            <Link onClick={() => go("dealer")} className="mt-auto pt-4 self-start">Learn more about our dealership</Link>
          </div>
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
            <div className="hidden lg:flex items-center gap-2 text-[12px]">
              {sticky.enabled && sticky.items.map((it) => {
                const a = stickyAction(it.key);
                return <button key={it.key} onClick={a.onClick} className={`h-10 px-3.5 rounded-xl text-[12px] font-bold inline-flex items-center gap-1.5 transition-colors ${it.primary ? "bg-[#2563EB] text-white hover:bg-[#1d4fd7]" : "border border-[#E6E8EC] text-[#0F172A] hover:border-[#2563EB]"}`}><a.icon className={`w-4 h-4 ${it.primary ? "" : "text-[#2563EB]"}`} /> {it.label}</button>;
              })}
            </div>
          </div>
          <p className="text-[11px] text-[#94A3B8] text-center pb-2">Information is provided by trusted third parties and is accurate to the best of our knowledge. Verify details with the dealer. © {new Date().getFullYear()} {d.dealerName}. All rights reserved.</p>
          <div className="flex items-center justify-center gap-4 text-[11px] font-semibold text-[#64748B] pb-6"><a href="/privacy" className="hover:text-[#2563EB]">Privacy</a><span className="text-slate-300">·</span><a href="/terms" className="hover:text-[#2563EB]">Terms</a></div>
        </footer>
      </main>

      {/* Mobile sticky header — slides in after scrolling past the hero. */}
      <div className={`lg:hidden fixed top-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-b border-[#E6E8EC] transition-transform duration-200 ${showSticky ? "translate-y-0" : "-translate-y-full"}`}>
        <div className="h-14 px-3 flex items-center gap-2.5">
          <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Top" className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center shrink-0"><ChevronLeft className="w-5 h-5" /></button>
          {hero && <img src={hero} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />}
          <div className="min-w-0 flex-1"><p className="text-[13px] font-bold leading-tight truncate">{listing.ymm || "Vehicle"}</p>{price != null && <p className="text-[12px] font-bold text-[#2563EB] leading-tight">{fmt$(price)}</p>}</div>
          {d.confScore != null && <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#16A34A] bg-emerald-50 border border-emerald-200 rounded-full px-2 py-1 shrink-0"><ShieldCheck className="w-3 h-3" />{d.confScore}</span>}
          <button onClick={handleShare} aria-label="Share" className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center shrink-0"><Upload className="w-[18px] h-[18px] text-[#64748B]" /></button>
        </div>
      </div>

      {/* Mobile sticky bottom CTA — the small-screen counterpart of the desktop
          "Ready to take the next step?" card: blue gradient, rounded top,
          white actions, primary as the filled white pill. Buttons, order,
          primary, and labels are dealer-configurable (admin → Passport CTAs). */}
      {sticky.enabled && sticky.items.length > 0 && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 rounded-t-[20px] shadow-[0_-8px_30px_rgba(37,99,235,0.35)] px-3 pt-3 pb-[calc(10px+env(safe-area-inset-bottom))]" style={{ background: "linear-gradient(160deg,#2563EB 0%,#1e50c8 100%)" }}>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${sticky.items.length}, minmax(0,1fr))` }}>
            {sticky.items.map((it) => {
              const a = stickyAction(it.key);
              return (
                <button key={it.key} onClick={a.onClick} className={`h-12 rounded-xl text-[10px] leading-[1.05] font-bold inline-flex flex-col items-center justify-center gap-1 text-center px-0.5 transition-transform duration-150 active:scale-95 ${it.primary ? "bg-white text-[#2563EB] shadow-sm" : "bg-white/10 border border-white/40 text-white active:bg-white/20"}`}>
                  <a.icon className="w-[18px] h-[18px]" /> {it.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <PassportCtaDock go={go} dealerPhone={d.dealerPhone || undefined} reviewRating={d.reviewRating} advisor={adv} />

      <PassportInfoModal info={activeInfo} onClose={closeInfo} go={go} openPanel={(k) => setActivePanel(k as PassportPanelKey)} />

      <PassportPanel
        panel={activePanel}
        onClose={closePanel}
        openPanel={(key) => setActivePanel(key)}
        d={d}
        listing={listing}
        isPreview={isPreview}
        go={go}
      />
    </div>
  );
};

export default VehiclePassportV3;
