import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Upload, Bookmark, Printer, FileText, MessageSquare,
  RefreshCw, ShieldCheck, CheckCircle2, Star, Phone, Car, Cog, Fuel, Settings, Wind, AlertTriangle,
  Award, Wrench, DollarSign, Clock, Building2, Users, Truck, Lock, Zap, ArrowRight,
  Package, Eye, Play, TrendingUp, BadgeCheck, Gauge as GaugeIcon, Send, MapPin,
  Sun, Navigation, Smartphone, Camera, Volume2, Palette, Snowflake, ExternalLink, X,
} from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { useVehicleListing, type VehicleListing } from "@/hooks/useVehicleListing";
import { usePublicListing } from "@/hooks/usePublicListing";
import { formatPhone } from "@/components/addendum/CustomerInfoSection";
import Logo from "@/components/brand/Logo";
import { derivePassport, deriveRating, ratingTier, computePriceHistory, fmt$, listingEquipment, historyReportName, deriveSoldClaims } from "@/lib/passportV2Data";
import { resolveStickyButtons, type StickyBottomButtons } from "@/lib/stickyButtons";
import PriceDropWatch from "@/components/listing/PriceDropWatch";
import { listingGallery } from "@/lib/photos";
import { usePassportEngagement } from "@/lib/passportEngagement";
import { isVehicleSaved, toggleSavedVehicle } from "@/lib/savedVehicles";
import { readBuildSheet } from "@/lib/buildSheet";
import { readPassportOrigin, clearPassportOrigin, type PassportOrigin } from "@/lib/passportOrigin";
import { trackPassportOpened, trackWindowStickerScanned, trackCustomerCtaClicked, trackCustomerEngagement } from "@/lib/engagement/customerEngagement";
import { packetVisible } from "@/lib/packetModules";
import type { DiscountBreakdown } from "@/lib/priceModel";
import { scorePassportCard, selectCards, type CardSignals } from "@/lib/passportCards";
import PassportPanel, { isPassportPanelKey, type PassportPanelKey } from "@/components/passport/PassportPanel";
import { useNhtsaSafety } from "@/hooks/useNhtsaSafety";
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

// The MSRP → discounts → your price → + doc fee → sale price ladder, mirroring
// the dealer's own VDP. Every row is a real or reconciled number from
// buildDiscountBreakdown; the discount lines always sum to MSRP − our price.
function PriceLadder({ b, priceLabel }: { b: DiscountBreakdown; priceLabel: string }) {
  const row = (label: React.ReactNode, value: React.ReactNode, cls = "") => (
    <div className={`flex items-baseline justify-between gap-3 ${cls}`}>
      <span className="truncate">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-[12px] text-[#64748B]">
      {row("MSRP", <span className="font-semibold text-[#0F172A]">{fmt$(b.msrp)}</span>)}
      {b.lines.map((l) => (
        <div key={l.key} className="mt-1">
          {row(l.label, <span className="font-semibold text-[#16A34A]">−{fmt$(l.amount)}</span>, "text-[#16A34A]")}
        </div>
      ))}
      {row(
        <span className="font-bold text-[#0F172A]">{priceLabel}</span>,
        <span className="font-extrabold text-[#0F172A]">{fmt$(b.ourPrice)}</span>,
        "mt-2 pt-2 border-t border-slate-200",
      )}
      {b.docFee ? (
        <>
          <div className="mt-1">{row("+ Conveyance / doc fee", <span className="font-semibold text-[#0F172A]">{fmt$(b.docFee)}</span>)}</div>
          {row(
            <span className="font-bold text-[#0F172A]">Sale price</span>,
            <span className="font-extrabold text-[#0F172A]">{fmt$(b.salePrice ?? b.ourPrice)}</span>,
            "mt-2 pt-2 border-t border-slate-200",
          )}
        </>
      ) : null}
    </div>
  );
}

const V3_PRINT = `
@page { size: Letter portrait; margin: 0.5in; }
@media print {
  html, body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .lg\\:sticky, [class*="sticky"] { position: static !important; top: auto !important; }
  [data-module] { break-inside: avoid; page-break-inside: avoid; }
  section[data-module="vehicle-details"] { break-inside: auto; page-break-inside: auto; }
  section[data-module="vehicle-details"] > div:first-child { break-inside: avoid; page-break-inside: avoid; }
  section[data-module="vehicle-details"] [class*="aspect-"] { aspect-ratio: auto !important; height: 3.1in !important; }
  main { padding-bottom: 0 !important; }
  button[aria-label] { display: none !important; }
}
`;

const abbrevDrive = (s: string) => s.replace(/all[- ]?wheel drive/i, "AWD").replace(/front[- ]?wheel drive/i, "FWD").replace(/rear[- ]?wheel drive/i, "RWD").replace(/(four|4)[- ]?wheel drive/i, "4WD");

const H2 = ({ children }: { children: React.ReactNode }) => <h2 className="text-[20px] font-bold leading-7 tracking-tight text-[#0F172A]">{children}</h2>;
const H3 = ({ children }: { children: React.ReactNode }) => <h3 className="text-[16px] font-semibold leading-6 text-[#0F172A]">{children}</h3>;
const Link = ({ onClick, children, className = "" }: { onClick: () => void; children: React.ReactNode; className?: string }) => (
  <button onClick={onClick} className={`text-[13px] font-semibold text-[#2563EB] inline-flex items-center gap-1 hover:underline print:hidden ${className}`}>{children} <ArrowRight className="w-3.5 h-3.5" /></button>
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
  mc_attributes: {
    msrp: 61640, horsepower: 295, owner_count: 1, accident_count: 0, carfax_clean_title: true, dom: 45, seating: 7,
    torque: "270 lb-ft", displacement: "3.5 L", overall_length: "198.5 in", overall_width: "77.9 in",
    overall_height: "69.9 in", wheelbase: "114.2 in", curb_weight: "4,610 lbs", ground_clearance: "6.5 in",
    cargo_capacity: "75.4 cu ft", fuel_tank: "19.5 gal", combined_mpg: "22", towing: "6,000 lbs",
    wheel_size: '20" aluminum-alloy', tire_size: "235/55R20", front_suspension: "Independent strut",
    rear_suspension: "Independent multi-link", steering: "Electric power-assisted",
    options: [
      "3.5L V6 Engine", "9-Speed Automatic Transmission", "Intelligent All-Wheel Drive", "Drive Mode Selector",
      "Paddle Shifters", "Leather-Appointed Seats", "Heated Front Seats", "Ventilated Front Seats",
      "Heated Steering Wheel", "Tri-Zone Automatic Climate Control", "Memory Driver Seat",
      "Second-Row Captain's Chairs", "Panoramic Moonroof", "Power Liftgate", "Ambient Interior Lighting",
      "Remote Engine Start", "Wireless Phone Charging",
    ],
    features: [
      "12.3-inch Touchscreen Display", "Wireless Apple CarPlay", "Wireless Android Auto",
      "Bose Performance Series 17-Speaker Audio", "12.3-inch Digital Instrument Cluster", "Head-Up Display",
      "NissanConnect Navigation", "HD Radio", "SiriusXM Satellite Radio", "Wi-Fi Hotspot",
      "ProPILOT Assist", "Blind Spot Warning", "Lane Departure Warning", "Forward Collision Warning",
      "Automatic Emergency Braking", "Adaptive Cruise Control", "Around View Monitor", "Rear Cross Traffic Alert",
      "Front and Rear Parking Sensors", "Driver Attention Alert", "LED Headlights", "LED Fog Lights",
      "Roof Rails", "Rain-Sensing Wipers", "Power-Folding Heated Mirrors",
    ],
    build_sheet: {
      packages: [
        { name: "Sensory Package", msrp: 2900, contents: ["Bose Performance Series 17-Speaker Audio", "Head-Up Display", "Ventilated Front Seats", "Semi-Aniline Leather", "Motion-Activated Power Liftgate"] },
        { name: "LUXE ProACTIVE Package", msrp: 1800, contents: ["ProPILOT Assist", "Adaptive Cruise Control", "Lane Departure Prevention", "Traffic Sign Recognition"] },
      ],
      options: [
        { name: "Illuminated Kick Plates", msrp: 425 },
        { name: "Roof Rail Crossbars", msrp: 360 },
        { name: "Welcome Lighting", msrp: 320 },
        { name: "First Aid Kit" },
      ],
      key_features: {
        adas: ["ProPILOT Assist", "Blind Spot Warning", "Around View Monitor"],
        infotainment: ["Wireless Apple CarPlay", "12.3-inch Touchscreen", "Bose Performance Series Audio"],
        seats: ["Heated & Ventilated Front Seats", "Semi-Aniline Leather"],
        comfort: ["Tri-Zone Climate Control", "Panoramic Moonroof"],
      },
      standard: {
        safety_features: ["Automatic Emergency Braking", "Rear Cross Traffic Alert", "10 Airbags", "Tire Pressure Monitoring"],
        exterior_lighting: ["LED Headlights", "LED Daytime Running Lights", "LED Fog Lights"],
        seating: ["Second-Row Captain's Chairs", "Third-Row Seating", "60/40 Split-Folding Rear Seats"],
        technology: ["NissanConnect Navigation", "Wi-Fi Hotspot", "Wireless Charging", "SiriusXM Satellite Radio"],
        comfort_convenience: ["Remote Engine Start", "Power Liftgate", "Heated Steering Wheel", "Ambient Lighting"],
        wheels: ['20" Aluminum-Alloy Wheels', "Roof Rails"],
      },
      generic: false,
      decoded_at: "2026-06-01T00:00:00Z",
      source: "neovin",
    },
  },
  epa_economy: { city: 20, highway: 25, combined: 22, annualFuelCost: 2650, rangeMiles: 429, fuelType: "Gasoline" },
  available_accessories: [
    { name: "Ceramic Paint Protection" }, { name: "All-Weather Floor Liners" },
    { name: "Window Tint" }, { name: "Cargo Cover" },
  ],
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
  dealer_coverage: [{ title: "Lifetime Powertrain Warranty", coverage: "Powertrain", term_years: null, term_miles: null, lifetime: true, mode: "included", offer: "Dealer-added lifetime powertrain coverage — engine, transmission, and drive components for as long as you own the vehicle.", disclosure: "Valid for the original purchaser with documented factory-scheduled maintenance. See dealer for the written warranty." }],
  dealer_trust: { years_in_business: "45", satisfaction: "98%", bbb_rating: "A+", google_rating: "4.9", google_count: "1248", certifications: "INFINITI Award of Excellence, 2024 Consumer Satisfaction", storefront_url: "/harte-infiniti-storefront.jpg", review_sources: "Google | 4.9 | Excellent family SUV. Very smooth ride.\nEdmunds | 4.7 | Quiet, comfortable, and packed with technology.\nCars.com | 4.8 | Luxury feel without the luxury price.", advisor_name: "John Smith", advisor_title: "Senior Vehicle Specialist", advisor_photo: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200", advisor_response: "Usually replies within 5 minutes", family_owned: "yes", service_location: "offsite", service_address: "120 Service Drive, Hartford, CT 06120", delivery: "regional", financing: "yes", amenities: "Customer lounge, Café, Kids area, EV charging, Loaner vehicles", services: "OEM parts, Warranty repairs, Online scheduling, State inspection, Express service", hours: "Mon–Sat 9–7, Sun 11–4" },
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

  // Deep link: /v/:slug?panel=<key> opens that slide-out on load, so panel
  // content (specs, highlights, warranty) is shareable and the Documents
  // sidebar has a real target. The param is stripped from the base history
  // entry so the back gesture lands on a clean URL with the panel closed.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("panel");
    if (!isPassportPanelKey(p)) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("panel");
    window.history.replaceState(window.history.state, "", url);
    setActivePanel(p);
  }, []);

  // Panel <-> browser history: on mobile the drawer covers the page, so the OS
  // back gesture must close the panel — not exit the passport (a lost session
  // on the lot; QR shoppers rarely re-scan). One history entry per panel
  // session; switching panels reuses it, closing by X consumes it. The entry
  // carries ?panel=<key> so the open panel is copyable from the address bar.
  const panelOpen = activePanel != null;
  useEffect(() => {
    if (activePanel == null) return;
    let popped = false;
    const url = new URL(window.location.href);
    url.searchParams.set("panel", activePanel);
    window.history.pushState({ alPanel: true }, "", url);
    const onPop = () => { popped = true; setActivePanel(null); };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (!popped && window.history.state?.alPanel) window.history.back();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen]);
  useEffect(() => {
    if (activePanel == null || !window.history.state?.alPanel) return;
    const url = new URL(window.location.href);
    url.searchParams.set("panel", activePanel);
    window.history.replaceState({ alPanel: true }, "", url);
  }, [activePanel]);

  const isPreview = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("preview");
  // QR attribution: window-sticker QRs land with ?src=qr. Persist for the whole
  // session so leads are stamped qr_scan even after in-app navigation.
  useEffect(() => {
    try {
      const src = new URLSearchParams(window.location.search).get("src");
      if (src) sessionStorage.setItem("al_visit_src", src);
    } catch { /* storage unavailable */ }
  }, []);
  const { listing, loading, notFound } = usePublicListing(vehicleSlug, { preview: isPreview, previewData: MOCK_LISTING as unknown as VehicleListing });
  const [savedState, setSavedState] = useState<boolean | null>(null);

  const d = useMemo(() => (listing ? derivePassport(listing) : null), [listing]);
  const rating = useMemo(() => (listing && d ? deriveRating(listing, d) : null), [listing, d]);
  const { data: nhtsa } = useNhtsaSafety(listing?.ymm, !!listing?.ymm);
  // Photos module off = lead photo only, no gallery chrome (server also
  // trims the payload; this keeps preview/mock rendering honest).
  const gallery = useMemo(() => {
    const g = listing ? listingGallery(listing) : ([] as string[]);
    return packetVisible(listing, "photos") ? g : g.slice(0, 1);
  }, [listing]);
  // Engagement events (schema + dealer dashboard already exist; these are the
  // missing call sites). Fire once per listing load, never in preview.
  useEffect(() => {
    if (!listing || isPreview) return;
    let viaQr = false;
    try { viaQr = sessionStorage.getItem("al_visit_src") === "qr"; } catch { /* ignore */ }
    const base = { storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin };
    (viaQr ? trackWindowStickerScanned(base) : trackPassportOpened(base));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.id, isPreview]);
  // Shopper Focus Breakdown — time per module + open panel (skipped in preview).
  usePassportEngagement(listing?.slug || vehicleSlug, activePanel, !isPreview);

  // Page-level engagement signals the module-dwell tracker doesn't cover:
  // scroll depth (25/50/75/100%, once each per session) and time-on-page
  // (a 30s ping + a final elapsed reading on unload). Distinct from
  // usePassportEngagement, which credits per-module seconds. Never in preview.
  const vid = listing?.id;
  const vvin = listing?.vin;
  const vstore = listing?.store_id;
  useEffect(() => {
    if (!vid || isPreview || typeof window === "undefined") return;
    const base = {
      storeId: vstore, vehicleId: vid, vin: vvin,
      source: "passport" as const, surface: "vehicle_passport" as const,
    };
    const start = Date.now();
    const elapsed = () => Math.round((Date.now() - start) / 1000);

    const fired = new Set<number>();
    const seenKey = (p: number) => `al_scroll_${vid}_${p}`;
    [25, 50, 75, 100].forEach((p) => {
      try { if (sessionStorage.getItem(seenKey(p))) fired.add(p); } catch { /* ignore */ }
    });
    const onScroll = () => {
      const doc = document.documentElement;
      const max = (doc.scrollHeight || 0) - window.innerHeight;
      const pct = max > 0 ? ((window.scrollY || 0) / max) * 100 : 100;
      for (const p of [25, 50, 75, 100]) {
        if (pct >= p && !fired.has(p)) {
          fired.add(p);
          try { sessionStorage.setItem(seenKey(p), "1"); } catch { /* ignore */ }
          trackCustomerEngagement({ ...base, eventType: "scroll_depth", metadata: { percent: p } });
        }
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const pingTimer = window.setTimeout(() => {
      trackCustomerEngagement({ ...base, eventType: "time_on_page", metadata: { seconds: elapsed() } });
    }, 30_000);

    let closed = false;
    const onHide = () => {
      if (closed) return;
      closed = true;
      trackCustomerEngagement({ ...base, eventType: "time_on_page", metadata: { seconds: elapsed(), final: true } });
    };
    window.addEventListener("pagehide", onHide);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onHide);
      window.clearTimeout(pingTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vid, isPreview]);

  // "Back to the vehicle you were viewing" — set when the shopper clicked a
  // dealer-alternative card on another passport. Cleared once they return.
  const [originBack, setOriginBack] = useState<PassportOrigin | null>(null);
  useEffect(() => {
    if (!listing?.slug) return;
    const o = readPassportOrigin();
    if (!o) { setOriginBack(null); return; }
    if (o.slug === listing.slug) { clearPassportOrigin(); setOriginBack(null); return; }
    setOriginBack(o);
  }, [listing?.slug]);

  // The floating dock duplicates the final CTA block — hide it once the
  // final CTA scrolls into view so the two never compete.
  const finalCtaRef = useRef<HTMLElement | null>(null);
  const [finalCtaInView, setFinalCtaInView] = useState(false);
  useEffect(() => {
    const el = finalCtaRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const ob = new IntersectionObserver(([e]) => setFinalCtaInView(e.isIntersecting), { threshold: 0.15 });
    ob.observe(el);
    return () => ob.disconnect();
  }, [loading, notFound]);
  // Watch-price form collapses behind a toggle inside the action panel.
  const [watchOpen, setWatchOpen] = useState(false);

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-[#F6F7F9]"><div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" /></div>;
  if (notFound || !listing || !d) return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[#F6F7F9]"><div className="text-center"><Package className="w-12 h-12 text-slate-300 mx-auto mb-4" /><h1 className="text-xl font-bold">Vehicle unavailable</h1><p className="text-sm text-slate-500 mt-2">This listing may have been sold or unpublished.</p></div></div>
  );

  const go = (section: string) => navigate(`/v/${listing.slug || vehicleSlug}/${section}${isPreview ? (section.includes("?") ? "&" : "?") + "preview=1" : ""}`);
  const viewUrl = publicUrl(listing.slug);
  // Decoded build sheet: the dollar story (packages + option value) for the
  // hero price block and highlights strip.
  const buildSheet = readBuildSheet(listing);
  // Real save: persists an on-device shortlist (no more no-op toast).
  const isSaved = savedState ?? isVehicleSaved(listing.slug);
  const handleSave = () => {
    const nowSaved = toggleSavedVehicle({ slug: listing.slug, ymm: listing.ymm, trim: listing.trim, price: listing.price, image: hero || listing.hero_image_url || null });
    setSavedState(nowSaved);
    toast.success(nowSaved ? "Saved to your list on this device" : "Removed from your saved list");
  };
  const handleShare = async () => { try { if (navigator.share) { await navigator.share({ title: listing.ymm || "Vehicle", url: viewUrl }); return; } } catch { return; } go("share"); };
  const hero = gallery[idx] || gallery[0] || "";
  const photoCount = gallery.length;
  // The secondary image (Vehicle Overview) must never duplicate the hero — pick
  // the first gallery photo that differs from whatever the hero is showing; if
  // there is no distinct second photo, render none rather than repeat.
  const secondaryImage = gallery.find((g) => g && g !== hero) || "";
  const { priceChangeLatest } = computePriceHistory(listing);
  const priceSeries = d.valueHistory.filter((h) => h.listing_price != null).map((h) => h.listing_price as number);
  const marketSeries = d.valueHistory.filter((h) => h.market_value != null).map((h) => h.market_value as number);

  const verifyL = d.verifyRows.slice(0, Math.ceil(d.verifyRows.length / 2));
  const verifyR = d.verifyRows.slice(Math.ceil(d.verifyRows.length / 2));

  // Packet curation: a module renders unless the dealer switched it off
  // (Vehicle File → Scan Info). Required disclosures are never curatable.
  const pv = (id: string) => packetVisible(listing, id);
  const trackHistoryReport = (placement: string) => {
    if (!isPreview) trackCustomerCtaClicked({ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: "passport", surface: "vehicle_passport", metadata: { cta: "history_report", provider: d.historyReport?.provider ?? null, placement } });
  };

  // Dealer-configurable sticky bar (admin → Passport CTAs). Resolves the chosen
  // buttons/order/primary/labels; falls back to Call/Text/Test Drive/Today's
  // Price when unconfigured. Drives both the desktop footer row and mobile bar.
  const sticky = resolveStickyButtons((listing as unknown as { sticky_bottom_buttons?: StickyBottomButtons }).sticky_bottom_buttons);
  const stickyAction = (key: string): { icon: React.ElementType; onClick: () => void } => {
    const tapTrack = (cta: string) => { if (!isPreview) trackCustomerCtaClicked({ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: "passport", surface: "vehicle_passport", metadata: { cta } }); };
    const call = () => { tapTrack("call"); if (d.dealerPhone) window.location.href = `tel:${d.dealerPhone}`; else go("contact"); };
    // Prefilled body: the shopper skips composing and the BDC knows the vehicle.
    const text = () => {
      tapTrack("text");
      if (d.dealerPhone) {
        const body = encodeURIComponent(`Hi, I'm interested in the ${listing.ymm || "vehicle"}${listing.vin ? ` (VIN ...${listing.vin.slice(-8)})` : ""} — is it available?`);
        window.location.href = `sms:${d.dealerPhone.replace(/[^\d+]/g, "")}?&body=${body}`;
      } else go("text");
    };
    // Directions stay in-flow: the premium Visit Dealer slide-out (map card,
    // departments, hours, before-you-go) instead of bouncing to Maps.
    const directions = () => { tapTrack("directions"); openPanel("visit-dealer"); };
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
      save_vehicle: { icon: Bookmark, onClick: handleSave },
      share_vehicle: { icon: Upload, onClick: handleShare },
      directions: { icon: MapPin, onClick: directions },
      chat: { icon: MessageSquare, onClick: () => go("contact") },
      email_dealer: { icon: Send, onClick: () => go("contact") },
    };
    return map[key] || { icon: CheckCircle2, onClick: () => go("check-availability") };
  };

  // Value-first comp story per the locked hierarchy: belowMarket is the spine
  // signal, counts come from the REAL market (marketMeta.similarCount), and
  // the 16-row stored sample never supplies a rank claim or a denominator —
  // it is an API page, not the market. Sentiment must match the adjacent
  // Market Price card: positive iff belowMarket > 0. Null = no tile.
  const sold = deriveSoldClaims(d, listing.mileage ?? null, listing.condition);
  const compStory = ((): { strong: string; sub: string } | null => {
    const ourPrice = d.price;
    const mkt = d.marketAvg;
    const bm = d.belowMarket;
    const N = d.marketMeta.similarCount;
    const isNewCar = String(listing.condition || "").toLowerCase() === "new";
    const noun = isNewCar ? "same-model" : "comparable";
    const pct = d.marketMeta.percentile;
    if (ourPrice == null || mkt == null) {
      if (N) return { strong: `${N} Comps Reviewed`, sub: `Local ${noun} vehicles analyzed` };
      return null;
    }
    if (bm != null && bm > 0) {
      if (pct != null && pct <= 25 && N != null && N >= 5) {
        if (pct <= 2) return { strong: "Best Price Nearby", sub: `Lowest of ${N} ${noun} nearby` };
        const beats = Math.round((N * (100 - pct)) / 100);
        return { strong: `Below ${beats} of ${N}`, sub: `Of ${N} ${noun} vehicles nearby` };
      }
      return {
        strong: `${fmt$(bm)} Below Comps`,
        sub: N != null && N >= 3 ? `vs ${N} ${noun} nearby` : `Comp average ${fmt$(mkt)}`,
      };
    }
    if (sold.soldPrice && d.marketMeta.soldCount != null && d.marketMeta.soldState) {
      return { strong: "Below Typical Sold Price", sub: `vs ${d.marketMeta.soldCount} sold in ${d.marketMeta.soldState}, 90 days` };
    }
    if (ourPrice <= mkt * 1.02) {
      return {
        strong: N ? `${N} ${isNewCar ? "Same-Model" : "Comparable"} Nearby` : "Priced at Market",
        sub: isNewCar ? "In line with same-model inventory" : "In line with the local market",
      };
    }
    const supply = d.marketMeta.daysSupply;
    if (supply != null && supply > 0 && supply <= 30) {
      return { strong: "In-Demand Locally", sub: `${supply}-day local supply` };
    }
    if (buildSheet?.estValue) {
      return { strong: "Factory Options Included", sub: `Includes ${fmt$(buildSheet.estValue)} in factory options` };
    }
    if (N) {
      return { strong: `${N} ${isNewCar ? "Same-Model" : "Comparable"} Nearby`, sub: `${isNewCar ? "Same-model" : "Similar"} vehicles nearby` };
    }
    return null;
  })();
  type MiTile = { icon: React.ElementType; title: string; strong: string; sub: string; chart?: React.ReactNode; donut?: number | null; comps?: boolean; section: string; cta: string };
  const domFavorable = d.dom != null && (d.marketMeta.avgDom != null ? d.dom <= d.marketMeta.avgDom : d.dom <= 30);
  const demandParts = [
    d.viewCount != null && d.viewCount >= 5 ? `${d.viewCount.toLocaleString()} views` : null,
    domFavorable ? `${d.dom} days on market` : null,
    sold.velocity && d.marketMeta.soldCount != null ? `${d.marketMeta.soldCount} sold in 90 days` : null,
  ].filter(Boolean) as string[];
  const warrantyIncl = d.dealerCoverage.find((c) => c.mode === "included");
  const warrantyAvail = d.dealerCoverage.find((c) => c.mode === "available");
  // Warranty card precedence: dealer-included coverage (the dealer's headline)
  // -> CPO certification -> a live factory term (always for new cars) -> the
  // optional plans the dealer offers to add. No coverage of any kind -> no card.
  const warrantyTile: MiTile | null = (() => {
    const base = { icon: ShieldCheck, title: "Warranty", section: "factory-warranty", cta: "View coverage" };
    const cond = String(listing.condition || "").toLowerCase();
    const w = d.warranty;
    const fmtMY = (dt: Date) => dt.toLocaleDateString(undefined, { month: "short", year: "numeric" });
    const endOf = (m?: number | null) => { if (!w?.in_service_date || !m) return null; const e = new Date(w.in_service_date); e.setMonth(e.getMonth() + m); return e.getTime() > Date.now() ? fmtMY(e) : null; };
    const inSvc = w?.in_service_date ? fmtMY(new Date(w.in_service_date)) : null;
    const coverEnd = endOf(w?.powertrain_months) || endOf(w?.factory_months);
    const coverWindow = inSvc && coverEnd ? `In service ${inSvc} · covered to ${coverEnd}` : coverEnd ? `Covered through ${coverEnd}` : null;
    if (warrantyIncl) return { ...base, strong: warrantyIncl.lifetime ? `Lifetime ${warrantyIncl.coverage || "Powertrain"}` : (warrantyIncl.title || "Dealer Coverage"), sub: "Included with this vehicle" };
    if (cond === "cpo") return { ...base, strong: "Certified Pre-Owned", sub: coverWindow || (d.warrantyStr ? `${d.warrantyStr} coverage` : "Manufacturer-backed coverage") };
    if (cond === "new" || (d.warrantyStr && !d.warrantyExpired)) return { ...base, strong: "Factory Warranty", sub: coverWindow || (cond === "new" ? (d.warrantyStr || "Full factory coverage") : (d.warrantyStr ? `${d.warrantyStr} remaining` : "Factory coverage remaining")) };
    if (warrantyAvail) return { ...base, strong: "Coverage Available", sub: "Optional protection plans — see terms" };
    return null;
  })();
  const miRaw = ([
    d.belowMarket && d.belowMarket > 0
      ? { icon: DollarSign, title: "Market Price", strong: "Great Price", sub: `${fmt$(d.belowMarket)} below market average`, chart: <Spark points={marketSeries} />, section: "market-price", cta: "View report" }
      : d.marketAvg != null && d.price != null && d.price <= d.marketAvg
        ? { icon: DollarSign, title: "Market Price", strong: "Market Price", sub: `Market avg ${fmt$(d.marketAvg)}`, chart: <Spark points={marketSeries} />, section: "market-price", cta: "View report" }
        : null,
    demandParts.length
      ? { icon: TrendingUp, title: "Market Demand", strong: (d.viewCount ?? 0) > 20 ? "High Interest" : "Active", sub: demandParts.join(" · "), section: "market-demand", cta: "View report" }
      : null,
    d.marketAvg != null && rating?.overall != null
      ? { icon: GaugeIcon, title: "Price Confidence", strong: ratingTier(rating.overall).label, sub: "overall vehicle score", donut: rating.overall, section: "price-confidence", cta: "View report" }
      : null,
    warrantyTile,
    priceChangeLatest != null && priceChangeLatest < 0
      ? { icon: Clock, title: "Price History", strong: `-${fmt$(Math.abs(priceChangeLatest))}`, sub: "latest price reduction", chart: <Spark points={priceSeries} color="#7C3AED" />, section: "price-history", cta: "View history" }
      : null,
    compStory
      ? { icon: Car, title: "Comparable Vehicles", strong: compStory.strong, sub: compStory.sub, comps: false, section: "comparable-vehicles", cta: "View comp set" }
      : null,
  ] as (MiTile | null)[]).filter((t): t is MiTile => t != null);

  // Card arsenal selection: the tiles above already passed their own data gates,
  // so every one is worth showing. The registry RANKS them by buy-signal
  // strength (strongest value message first) and caps the strip — floor present
  // tiles at 1 so ranking never drops a tile the gates already approved.
  const cond = String(listing.condition || "").toLowerCase();
  const cardSignals: CardSignals = {
    belowMarket: d.belowMarket, marketAvg: d.marketAvg, price: d.price,
    similarCount: d.marketMeta.similarCount, soldCount: d.marketMeta.soldCount,
    viewCount: d.viewCount, domFavorable,
    priceDrop: priceChangeLatest != null && priceChangeLatest < 0 ? Math.abs(priceChangeLatest) : null,
    ratingOverall: rating?.overall ?? null,
    demandPartsCount: demandParts.length,
    warrantyStrength: warrantyIncl ? 4 : cond === "cpo" ? 3 : cond === "new" || (!!d.warrantyStr && !d.warrantyExpired) ? 2 : warrantyAvail ? 1 : 0,
  };
  const miChosen = selectCards(
    miRaw.map((t) => ({ key: t.section, score: Math.max(1, scorePassportCard(t.section, cardSignals)) })),
    { max: 7 },
  );
  const miOrder = new Map(miChosen.map((c, i) => [c.key, i] as const));
  const mi = miRaw
    .filter((t) => miOrder.has(t.section))
    .sort((a, b) => (miOrder.get(a.section) ?? 0) - (miOrder.get(b.section) ?? 0));

  const highlights: { icon: React.ElementType; t: string; s: string }[] = [];
  // Specs are written into mc_attributes by the pull; key_specs is usually
  // empty, so merge mc_attributes in (mapping its field names) before reading.
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const ksRaw = (listing.key_specs || {}) as Record<string, unknown>;
  const stockNo = mc.stock_no ? String(mc.stock_no) : ((listing as unknown as { stock_number?: string | null }).stock_number || null);
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
  if (ks.exterior_color) highlights.push({ icon: Wind, t: ks.exterior_color, s: "Exterior Color" });
  const interiorColor = (ksRaw.interior_color ?? mc.interior_color) as string | undefined;
  if (interiorColor) highlights.push({ icon: Palette, t: interiorColor, s: "Interior Color" });
  const seats = (mc.seating_capacity ?? mc.std_seating ?? ksRaw.seating) as number | string | undefined;
  if (seats) highlights.push({ icon: Users, t: `${seats}-Passenger`, s: "Seating" });
  // Amenity detection from the decoded equipment/options blob — only chips
  // whose feature is actually present are shown (no invented equipment).
  // listingEquipment already merges the cleaned options + features, so use it
  // directly — re-appending the raw mc blobs would just add back the decoder
  // noise (codes, paint, ratings) we strip.
  const featBlob = listingEquipment(listing).join(" | ").toLowerCase();
  const amenityDefs: { re: RegExp; icon: React.ElementType; t: string; s: string }[] = [
    { re: /panoramic|moonroof|sunroof|pano roof/, icon: Sun, t: "Panoramic Roof", s: "Sunroof" },
    { re: /navigation|nav system|gps/, icon: Navigation, t: "Navigation", s: "Built-in" },
    { re: /carplay|android auto/, icon: Smartphone, t: "CarPlay / Android", s: "Smartphone" },
    { re: /adaptive cruise|propilot|pro-pilot|driver assist|lane keep/, icon: GaugeIcon, t: "Driver Assist", s: "Adaptive Cruise" },
    { re: /blind spot|blind-spot/, icon: Eye, t: "Blind Spot", s: "Monitor" },
    { re: /wireless charg/, icon: Zap, t: "Wireless Charging", s: "Built-in" },
    { re: /360|surround view|around view/, icon: Camera, t: "360° Camera", s: "Surround View" },
    { re: /bose|premium audio|harman|mark levinson|sound system|burmester/, icon: Volume2, t: "Premium Audio", s: "Premium Sound" },
    { re: /tri-zone|dual-zone|multi-zone|climate control/, icon: Snowflake, t: "Multi-Zone Climate", s: "Comfort" },
    { re: /wi-?fi|hotspot/, icon: Smartphone, t: "Wi-Fi Hotspot", s: "Built-in" },
  ];
  amenityDefs.forEach((f) => {
    if (highlights.length < 10 && f.re.test(featBlob) && !highlights.some((h) => h.s === f.s || h.t === f.t)) {
      highlights.push({ icon: f.icon, t: f.t, s: f.s });
    }
  });
  listingEquipment(listing).forEach((label) => { if (highlights.length < 10) highlights.push({ icon: Award, t: label, s: "Feature" }); });

  // Dealer trust chips — only render what the dealer actually configured
  // (onboarding / admin), so we never assert an unverified capability.
  const dt = d.dealerTrust;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const dealerChips: { icon: React.ElementType; t: string; s: string }[] = [];
  if (dt.familyOwned) dealerChips.push({ icon: Building2, t: "Family Owned", s: dt.yearsInBusiness ? `Since ${new Date().getFullYear() - Number(dt.yearsInBusiness)}` : "Locally owned" });
  else if (dt.yearsInBusiness) dealerChips.push({ icon: Building2, t: "Established", s: `Since ${new Date().getFullYear() - Number(dt.yearsInBusiness)}` });
  if (dt.googleRating) dealerChips.push({ icon: Star, t: "Top Rated", s: `${dt.googleRating} Google Rating` });
  if (dt.certifications.length) {
    // "Factory Certified" only when the cert text names this vehicle's make;
    // otherwise the cert speaks for itself.
    const make = (listing.ymm || "").replace(/^\d{4}\s+/, "").split(/\s+/)[0] || "";
    const factoryCert = make ? dt.certifications.find((c) => c.toLowerCase().includes(make.toLowerCase())) : undefined;
    dealerChips.push(factoryCert
      ? { icon: Wrench, t: "Factory Certified", s: factoryCert }
      : { icon: Wrench, t: dt.certifications[0], s: "Dealer certification" });
  }
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
      <style>{V3_PRINT}</style>
      <Helmet><title>{`${listing.ymm}${listing.trim ? ` ${listing.trim}` : ""} — ${d.dealerName}`}</title><meta name="description" content={`${listing.ymm}${price != null ? ` · ${fmt$(price)}` : ""} · ${d.dealerName}`} />{isPreview && <meta name="robots" content="noindex" />}</Helmet>

      {isPreview && (
        <div className="bg-amber-500 text-white text-center text-[12px] font-bold py-1.5 px-4 print:hidden">SAMPLE PREVIEW — design layout with placeholder data. Not a real listing.</div>
      )}

      {/* Top bar */}
      <header className="border-b border-[#E6E8EC] bg-white print:hidden">
        <div className="mx-auto max-w-[1320px] px-4 sm:px-5 h-16 flex items-center justify-between">
          {listing.dealer_snapshot?.logo_url ? <img src={listing.dealer_snapshot.logo_url as string} alt="" className="h-7" /> : <Logo variant="full" size={22} />}
          <div className="flex items-center gap-3 sm:gap-5">
            <button onClick={handleShare} className={`text-sm font-medium inline-flex items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Upload className="w-4 h-4" /> <span className="hidden sm:inline">Share</span></button>
            <button onClick={handleSave} className={`hidden sm:inline-flex text-sm font-medium items-center gap-1.5 ${isSaved ? "text-[#2563EB]" : TEXT2} hover:text-[#0F172A]`}><Bookmark className="w-4 h-4" fill={isSaved ? "currentColor" : "none"} /> {isSaved ? "Saved" : "Save"}</button>
            <button onClick={() => window.print()} className={`hidden sm:inline-flex text-sm font-medium items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Printer className="w-4 h-4" /> Print</button>
            <button onClick={() => go("todays-price")} className="h-11 px-3.5 sm:px-5 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-sm font-semibold inline-flex items-center gap-2"><DollarSign className="w-4 h-4" /> <span className="hidden sm:inline">See My Price</span><span className="sm:hidden">Price</span></button>
          </div>
        </div>
      </header>

      {/* Return path after browsing a sibling listing — sticky so the shopper
          can always get back to the vehicle they started on. */}
      {originBack && (
        <div className="sticky top-0 z-30 bg-[#0D1B2A] text-white print:hidden">
          <div className="mx-auto max-w-[1320px] px-4 sm:px-5 h-11 flex items-center justify-between gap-3">
            <a href={`/v/${originBack.slug}${isPreview ? "?preview=1" : ""}`} onClick={() => clearPassportOrigin()} className="inline-flex items-center gap-2 text-[13px] font-semibold min-w-0 hover:underline">
              <ChevronLeft className="w-4 h-4 shrink-0" />
              <span className="truncate">Back to the {originBack.ymm || "vehicle"} you were viewing</span>
            </a>
            <button onClick={() => { clearPassportOrigin(); setOriginBack(null); }} className="text-white/70 hover:text-white shrink-0" aria-label="Dismiss"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1320px] px-4 sm:px-5 py-5 sm:py-6 pb-[calc(92px+env(safe-area-inset-bottom))] lg:pb-6 space-y-6 max-[767px]:space-y-8 lg:space-y-7">
        <div className="hidden print:block mb-4 pb-3 border-b border-[#E6E8EC]">
          <div className="flex items-start justify-between gap-4">
            <div>
              {listing.dealer_snapshot?.logo_url
                ? <img src={listing.dealer_snapshot.logo_url as string} alt="" className="h-6" />
                : <span className="text-[15px] font-bold">{d.dealerName}</span>}
              <p className="text-[15px] font-bold mt-1">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</p>
            </div>
            <div className="text-right text-[11px] text-[#64748B]">
              <p className="text-[18px] font-extrabold text-[#0F172A]">{price != null ? fmt$(price) : ""}</p>
              <p className="mt-0.5">VIN {listing.vin}</p>
            </div>
          </div>
        </div>

        {/* 1–2. TOP ZONE — three-zone hero: gallery · identity · action panel */}
        <section data-module="vehicle-details" className="grid grid-cols-1 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)_310px] gap-5 items-start print:block print:space-y-4">
          {/* Gallery */}
          <div>
            <div className="relative overflow-hidden rounded-2xl bg-[#1f2227] aspect-[4/3] max-[767px]:aspect-[5/4]">
              {hero ? <img src={hero} alt={listing.ymm || ""} onClick={() => go("gallery")} className="absolute inset-0 w-full h-full object-cover cursor-zoom-in" /> : <div className="absolute inset-0 flex items-center justify-center text-slate-500"><Car className="w-14 h-14" strokeWidth={1.25} /></div>}
              {photoCount > 0 && <span className="print:hidden absolute right-3 top-3 text-white text-xs font-semibold px-2.5 py-1 rounded bg-black/60">{idx + 1} / {photoCount}</span>}
              {photoCount > 1 && <>
                <button onClick={() => setIdx((i) => (i - 1 + photoCount) % photoCount)} className="print:hidden absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/95 hover:bg-white flex items-center justify-center shadow"><ChevronLeft className="w-5 h-5" /></button>
                <button onClick={() => setIdx((i) => (i + 1) % photoCount)} className="print:hidden absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/95 hover:bg-white flex items-center justify-center shadow"><ChevronRight className="w-5 h-5" /></button>
              </>}
            </div>
            {photoCount > 1 && <div className="flex gap-2 mt-2 print:hidden">{gallery.slice(0, 6).map((s, i) => <button key={i} onClick={() => setIdx(i)} className="w-[60px] h-11 rounded-lg overflow-hidden bg-[#e9ecef]" style={{ outline: i === idx ? `2px solid ${BLUE}` : "2px solid transparent", outlineOffset: -2 }}><img src={s} alt="" className="w-full h-full object-cover" /></button>)}{photoCount > 6 && <button onClick={() => go("gallery")} className="w-[60px] h-11 rounded-lg bg-black/70 text-white text-[11px] font-bold">+{photoCount - 6}</button>}</div>}
            <div className="flex gap-2 mt-2 print:hidden">
              {pv("photos") && photoCount > 1 && <button onClick={() => go("gallery")} className={`flex-1 h-10 rounded-xl border border-[#E6E8EC] bg-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]`}><Eye className="w-4 h-4 text-[#2563EB]" /> All Photos ({photoCount})</button>}
              {pv("videos") && listing.videos?.length ? <a href={listing.videos[0].url} target="_blank" rel="noreferrer" className="flex-1 h-10 rounded-xl border border-[#E6E8EC] bg-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"><Play className="w-4 h-4 text-[#2563EB]" /> Walkaround Video</a> : null}
            </div>
          </div>

          {/* Identity zone */}
          <div className="min-w-0">
            <div className="space-y-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg bg-blue-100 text-blue-700">{listing.condition || "vehicle"}</span>
                  {listing.status !== "published" && <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg bg-amber-100 text-amber-700">Preview — not yet published</span>}
                </div>
                <h1 className="text-[30px] font-bold leading-9 tracking-tight">{listing.ymm}{listing.trim ? <span className="text-[#64748B] font-semibold"> {listing.trim}</span> : null}</h1>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-2 text-[13px] text-[#64748B]">
                  <span><span className="font-semibold text-[#0F172A]">VIN</span> {listing.vin}</span>
                  {stockNo && <><span className="text-slate-300">•</span><span>Stock # {stockNo}</span></>}{listing.mileage != null && <><span className="text-slate-300">•</span><span>{listing.mileage.toLocaleString()} mi</span></>}
                </div>
                {(() => {
                  const dw = d.dealerCoverage.find((c) => c.mode === "included");
                  // 16 CFR 239.4: a lifetime claim must define its measuring
                  // life — inline when the program has no disclosure text.
                  const dwChip = dw
                    ? (dw.lifetime
                        ? `Lifetime ${dw.coverage || "Powertrain"}${dw.disclosure ? "" : " — for as long as you own it"}`
                        : [dw.termYears ? `${dw.termYears}-Yr` : null, dw.termMiles ? `${Math.round(dw.termMiles / 1000)}K-Mi` : null].filter(Boolean).join("/") + ` ${dw.coverage || "Warranty"}`)
                    : null;
                  const idBadges = ([
                    dwChip && dwChip.trim() !== "" ? dwChip.trim() : null,
                    d.priceChangeTotal != null && d.priceChangeTotal < 0 ? `Reduced ${fmt$(Math.abs(d.priceChangeTotal))}` : null,
                    d.ownerCount === 1 ? "One Owner" : null,
                    d.dealerVerified ? "Dealer Verified" : null,
                    d.marketAvg != null || d.comparables.length > 0 ? "Market Data Verified" : null,
                    d.recallClear ? "Recall Checked" : null,
                  ].filter(Boolean) as string[]).slice(0, 4);
                  return idBadges.length ? (
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      {idBadges.map((b) => <span key={b} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0F172A] bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1"><CheckCircle2 className="w-3 h-3 text-[#16A34A]" />{b}</span>)}
                    </div>
                  ) : null;
                })()}
                {/* Price stays visible early on small screens; the action panel carries it on desktop. */}
                {price != null && (
                  <div className="lg:hidden mt-3">
                    <div className="text-[13px] font-semibold text-[#64748B]">{d.priceLabel}</div>
                    <div className="text-[26px] font-extrabold leading-8">{fmt$(price)}</div>
                    {d.priceBreakdown ? (
                      <PriceLadder b={d.priceBreakdown} priceLabel={d.priceLabel} />
                    ) : (
                      <>
                        {d.docFee ? (
                          <div className="text-[12px] text-[#64748B]">
                            {d.priceIncludesDoc
                              ? `Incl. ${fmt$(d.docFee)} doc fee · ${fmt$(Math.max(0, price - d.docFee))} before doc fee`
                              : `+ ${fmt$(d.docFee)} doc fee · Sale ${fmt$(d.websiteSalePrice ?? price + d.docFee)}`}
                          </div>
                        ) : null}
                        {d.saveVsMsrp != null && <div className="text-[13px] font-semibold text-[#16A34A]">You save {fmt$(d.saveVsMsrp)}</div>}
                        {d.belowOriginalMsrp != null && <div className="text-[13px] font-semibold text-[#16A34A]">{fmt$(d.belowOriginalMsrp)} below original MSRP</div>}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Verification card */}
              {d.dealerVerified && d.verifyRows.length > 0 && (
                <div className={`${CARD} p-5`}>
                  <div className="flex items-start gap-2">
                    <button onClick={() => go("verification")} className="flex items-center gap-2.5 text-left flex-1 min-w-0">
                      <span className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0"><ShieldCheck className="w-5 h-5 text-[#16A34A]" /></span>
                      <div><p className="text-[15px] font-bold">AutoLabels Verified</p><p className="text-[12px] text-[#64748B]">Checked against trusted automotive data sources.</p></div>
                    </button>
                    <button onClick={(e) => openInfo("verification-process", e)} aria-label="How verification works" className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center shrink-0"><Info className="w-4 h-4 text-[#94A3B8]" /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 mt-4">
                    {[verifyL, verifyR].map((col, ci) => <div key={ci} className="space-y-2.5">{col.map((r) => <div key={r.label} className="flex items-center gap-2 text-[13px] font-medium text-[#0F172A]"><CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" />{r.label}</div>)}</div>)}
                  </div>
                  {pv("documents") && ((listing.documents as { name?: string }[] | undefined)?.length ?? 0) > 0 && (
                    <div className="mt-4 pt-3 border-t border-slate-100">
                      <p className="text-[11px] font-semibold text-[#94A3B8] mb-2">Source documents on file</p>
                      <div className="flex flex-wrap gap-2">
                        {(listing.documents as { name?: string }[]).filter((x) => x?.name).slice(0, 4).map((doc, i) => (
                          <button key={i} onClick={() => go("documents")} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#0F172A] bg-slate-50 hover:bg-blue-50 hover:text-[#2563EB] border border-slate-200 rounded-full px-2.5 py-1 transition-colors"><FileText className="w-3 h-3" />{doc.name}</button>
                        ))}
                        {((listing.documents as unknown[]).length > 4) && <button onClick={() => go("documents")} className="text-[11px] font-semibold text-[#2563EB] px-1.5 py-1">+{(listing.documents as unknown[]).length - 4} more</button>}
                      </div>
                    </div>
                  )}
                  <Link onClick={() => go("verification")} className="mt-4">View full verification report</Link>
                </div>
              )}
            </div>
          </div>

          {/* Action panel — one sticky checkout-style card */}
          <div className="lg:sticky lg:top-6 print:hidden">
            <div className={`${CARD} p-5`}>
              {price != null && (
                <div className="hidden lg:block">
                  <div className="text-[12px] font-semibold text-[#64748B]">{d.priceLabel}</div>
                  <div className="text-[30px] font-extrabold leading-9 tracking-tight">{fmt$(price)}</div>
                  <div className="mt-1 space-y-0.5 text-[12px] text-[#64748B]">
                    {!d.priceBreakdown && d.docFee ? (
                      <p>{d.priceIncludesDoc
                        ? `Incl. ${fmt$(d.docFee)} doc fee · ${fmt$(Math.max(0, price - d.docFee))} before doc fee`
                        : `+ ${fmt$(d.docFee)} doc fee · Sale ${fmt$(d.websiteSalePrice ?? price + d.docFee)}`}</p>
                    ) : null}
                    {buildSheet?.estValue ? <p className="font-semibold text-[#16A34A]">Incl. {fmt$(buildSheet.estValue)} in factory options</p> : null}
                    {pv("payment") && d.estMonthly != null && <p>Est. {fmt$(d.estMonthly)}/mo{d.paymentAssumptions ? <span className="text-[11px] text-[#94A3B8]"> {d.paymentAssumptions}</span> : null}</p>}
                    {!d.priceBreakdown && d.msrp != null && <p>MSRP {fmt$(d.msrp)}</p>}
                  </div>
                  {d.priceBreakdown && <PriceLadder b={d.priceBreakdown} priceLabel={d.priceLabel} />}
                </div>
              )}
              {(() => {
                // With the savings ladder present, MSRP savings are itemized there —
                // reserve this chip for the below-market signal to avoid double-counting.
                const msrpChip = !d.priceBreakdown && d.saveVsMsrp ? d.saveVsMsrp : null;
                const mktChip = d.belowMarket && d.belowMarket > 0 ? d.belowMarket : null;
                const amt = msrpChip ?? mktChip;
                if (amt == null) return null;
                return (
                <div className="mt-3 lg:mt-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <BadgeCheck className="w-4 h-4 text-[#16A34A] shrink-0" />
                    <p className="text-[12px] font-bold text-emerald-800">{fmt$(amt)} {msrpChip ? "below MSRP" : "below market"}</p>
                  </div>
                  {d.belowMarket != null && d.belowMarket > 0 && d.marketMeta.similarCount != null && d.marketMeta.similarCount >= 5 && (
                    <p className="text-[11px] text-emerald-800/80 mt-1">Compared against {d.marketMeta.similarCount.toLocaleString()} similar listings {d.marketMeta.radius != null ? `within ${d.marketMeta.radius} miles` : "in the region"} · live market data</p>
                  )}
                </div>
                );
              })()}
              <button onClick={() => go("todays-price")} className="mt-4 w-full h-12 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-[14px] font-bold inline-flex items-center justify-center gap-2"><DollarSign className="w-4 h-4" /> See My Price</button>
              <button onClick={() => go("reserve")} className="mt-2 w-full h-11 rounded-xl border border-[#2563EB] text-[#2563EB] text-[13.5px] font-bold inline-flex items-center justify-center gap-2 hover:bg-blue-50 transition-colors"><BadgeCheck className="w-4 h-4" /> Reserve This Vehicle</button>
              <div className="grid grid-cols-2 gap-2 mt-3">
                {[
                  { icon: RefreshCw, label: "Value My Trade", onClick: () => go("trade") },
                  { icon: Clock, label: "Test Drive", onClick: () => go("test-drive") },
                  { icon: MessageSquare, label: "Contact Dealer", onClick: () => go("contact") },
                  ...(pv("documents") ? [{ icon: FileText, label: "Documents", onClick: () => go("documents") }] : []),
                ].map((a) => <button key={a.label} onClick={a.onClick} className="h-10 rounded-xl border border-[#E6E8EC] bg-white text-[12px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB] transition-colors px-1"><a.icon className="w-4 h-4 text-[#2563EB] shrink-0" /><span className="truncate">{a.label}</span></button>)}
              </div>
              <div className="flex items-center justify-center gap-4 mt-3 pt-3 border-t border-[#F1F5F9] text-[12px] font-semibold text-[#64748B]">
                <button onClick={handleSave} className={`inline-flex items-center gap-1.5 hover:text-[#0F172A] ${isSaved ? "text-[#2563EB]" : ""}`}><Bookmark className="w-3.5 h-3.5" fill={isSaved ? "currentColor" : "none"} /> {isSaved ? "Saved" : "Save"}</button>
                <button onClick={handleShare} className="inline-flex items-center gap-1.5 hover:text-[#0F172A]"><Upload className="w-3.5 h-3.5" /> Share</button>
                <button onClick={() => setWatchOpen((v) => !v)} aria-expanded={watchOpen} className={`inline-flex items-center gap-1.5 hover:text-[#0F172A] ${watchOpen ? "text-[#2563EB]" : ""}`}><Eye className="w-3.5 h-3.5" /> Watch Price</button>
              </div>
              {watchOpen && price != null && <div className="mt-3"><PriceDropWatch slug={listing.slug || vehicleSlug || listing.vin} enabled={(listing as unknown as { price_drop_watch?: boolean }).price_drop_watch !== false} /></div>}
            </div>
          </div>
        </section>

        {/* 4. MARKET INTELLIGENCE */}
        {pv("marketValue") && mi.length > 0 && (
        <section data-module="market" className={`${CARD} p-5`}>
          <div className="flex items-center justify-between"><div><H2>{d.belowMarket && d.belowMarket > 0 ? `Priced ${fmt$(d.belowMarket)} Under the Local Market` : "Market Intelligence"}</H2><p className={`text-[13px] ${TEXT2} mt-0.5`}>Independent pricing, demand, and value analysis for this vehicle.</p></div><span className="text-[12px] text-[#94A3B8] inline-flex items-center gap-1">Live market data{d.marketMeta.similarCount != null && d.marketMeta.similarCount >= 5 ? ` · ${d.marketMeta.similarCount.toLocaleString()} similar listings reviewed` : ""}<button onClick={(e) => openInfo("data-sources", e)} aria-label="Data sources explained" className="w-4 h-4 inline-flex items-center justify-center"><Info className="w-3.5 h-3.5 text-[#94A3B8]" /></button></span></div>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mt-5">
            {mi.map((c) => (
              <div key={c.section} onClick={(e) => openPanel(c.section as PassportPanelKey, e)} className="rounded-xl border border-[#E6E8EC] p-4 flex flex-col cursor-pointer hover:border-[#2563EB] transition-colors">
                <div className="flex items-center gap-1.5 mb-2"><c.icon className="w-4 h-4 text-[#2563EB]" /><span className="text-[12px] font-semibold text-[#64748B]">{c.title}</span></div>
                {c.donut != null ? <div className="flex flex-col items-center text-center"><Donut pct={c.donut} label={`${c.donut}`} /><p className="text-[14px] font-extrabold text-[#16A34A] leading-tight mt-2">{c.strong}</p><p className="text-[11px] text-[#64748B] leading-snug">{c.sub}</p></div>
                  : <><p className={`text-[16px] font-extrabold leading-tight ${/Great|High|Excellent|^-/.test(String(c.strong)) ? "text-[#16A34A]" : "text-[#0F172A]"}`}>{c.strong}</p><p className="text-[11px] text-[#64748B] leading-snug mt-0.5 flex-1">{c.sub}</p>{c.comps ? <div className="flex gap-1 mt-2">{[0, 1, 2].map((i) => <div key={i} className="flex-1 h-8 rounded bg-[#F1F5F9] flex items-center justify-center"><Car className="w-4 h-4 text-[#94A3B8]" /></div>)}</div> : c.chart}</>}
                <button onClick={(e) => { e.stopPropagation(); openPanel(c.section as PassportPanelKey, e); }} className="print:hidden mt-2.5 text-[12px] font-semibold text-[#2563EB] inline-flex items-center gap-1 hover:underline">{c.cta} <ArrowRight className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[#94A3B8] mt-3">Market values are estimates from third-party data and may vary by region and time.</p>
        </section>
        )}

        {/* 3.5 RECONDITIONING PROOF — value-building, above the fold.
            Customers see everything the dealership did to prep the vehicle;
            one dominant CTA moves them to request a price. Only declined work
            is ever hidden — every fact here is cost-free and PII-free. */}
        {pv("recon") && d.recon && (() => {
          const r = d.recon;
          const stepCount = r.workItems.length + (r.inspection ? 1 : 0) + r.thirdParty.length;
          // Only make the grand "everything we did" claim when there's real
          // substance behind it; a lone inspection gets honest, lighter copy.
          const substantial = r.workItems.length >= 3 || r.photos.length > 0 || r.thirdParty.length > 0;
          return (
            <section data-module="recon" className={`${CARD} p-0 overflow-hidden`}>
              <div className="bg-[#0F172A] px-6 py-6 sm:px-8 sm:py-7">
                <div className="flex flex-wrap items-center justify-between gap-5">
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold uppercase tracking-wider text-emerald-400 inline-flex items-center gap-1.5"><BadgeCheck className="w-4 h-4" /> Dealer-Completed Reconditioning</p>
                    <h2 className="text-[22px] sm:text-[26px] font-bold text-white leading-tight mt-1.5">{substantial ? "Everything we did to get this vehicle ready for you" : "Inspected and prepped for you"}</h2>
                    <p className="text-[13px] text-slate-300 mt-1.5 max-w-xl">{substantial
                      ? <>Before this {listing.ymm || "vehicle"} was listed, our team completed and documented {stepCount} reconditioning, safety, and detailing step{stepCount === 1 ? "" : "s"} — so you can buy with total confidence.</>
                      : <>Our team inspected and prepared this {listing.ymm || "vehicle"} before listing it, with every step documented — so you can buy with confidence.</>}</p>
                  </div>
                  <div className="flex items-center gap-6 shrink-0">
                    {substantial && <div className="text-center"><p className="text-[34px] font-extrabold text-emerald-400 leading-none">{stepCount}</p><p className="text-[11px] text-slate-400 mt-1 leading-tight">Steps<br />completed</p></div>}
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
                  <div className="mt-auto pt-5 print:hidden">
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

        {/* 5. CHAPTER 2 — WHY THIS VEHICLE CHECKS OUT
            Two focused cards (verified strengths · confirm before purchase)
            plus compact timeline/warranty/reviews — the warranty and reviews
            cards hide entirely when there's no data to show, so the row never
            renders empty customer-facing cards. */}
        <section>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-none xl:grid-flow-col xl:auto-cols-fr gap-6 items-stretch print:block print:space-y-5">
          {/* Why this vehicle checks out */}
          {pv("insights") && (
          <div className={`${CARD} p-5 flex flex-col max-[767px]:p-6 max-[767px]:ring-1 max-[767px]:ring-blue-200 max-[767px]:shadow-[0_10px_30px_rgba(37,99,235,0.10)] print:ring-0 print:shadow-none`}>
            <H3>Why This Vehicle Checks Out</H3>
            {rating?.overall != null && (
              <div className="flex items-center justify-between gap-2 mt-3 rounded-xl bg-emerald-50/60 border border-emerald-100 px-3 py-2">
                <p className="text-[12px] font-bold text-emerald-800 inline-flex items-center gap-1">
                  {rating.overall}% Confidence · {ratingTier(rating.overall).label}
                </p>
                <button onClick={(e) => openInfo("score-meaning", e)} aria-label="What does this score mean?" className="w-5 h-5 inline-flex items-center justify-center shrink-0"><Info className="w-3.5 h-3.5 text-emerald-600/70" /></button>
              </div>
            )}
            {(() => {
              const nhtsaOverall = nhtsa?.ratings?.overall ?? null;
              const safetyChips = [
                nhtsaOverall != null && nhtsaOverall >= 4 ? `NHTSA ${nhtsaOverall}-Star Overall` : null,
                d.iihsAward ? d.iihsAward.label : null,
              ].filter(Boolean) as string[];
              // The flagship comp sentence: a named sample, a radius, and a
              // count it beats — only when the data actually supports it.
              const compN = d.marketMeta.similarCount, compPct = d.marketMeta.percentile, compRadius = d.marketMeta.radius;
              const modelName = (listing.ymm || "").split(/\s+/).slice(2).join(" ").trim();
              const compNoun = `similar ${modelName ? `${modelName} ` : ""}listings`;
              const flagship = compN != null && compN >= 5
                ? compPct != null && compPct <= 50
                  ? `We compared ${compN.toLocaleString()} ${compNoun}${compRadius != null ? ` within ${compRadius} miles` : ""}. This one is priced below ${Math.round((compN * (100 - compPct)) / 100)} of them.`
                  : compPct == null && d.belowMarket != null && d.belowMarket > 0
                    ? `We compared ${compN.toLocaleString()} ${compNoun}${compRadius != null ? ` within ${compRadius} miles` : ""} — this one is ${fmt$(d.belowMarket)} under their average.`
                    : null
                : null;
              const checksOut = Array.from(new Set([
                ...(d.dealerVerified ? ["Dealer-verified listing"] : []),
                ...(flagship ? [flagship] : []),
                ...(flagship ? d.whyBuy.filter((b) => !/below market average/.test(b)) : d.whyBuy),
                ...(!flagship && d.marketAvg != null ? ["Market-supported price"] : []),
              ])).slice(0, 6);
              return <>
                {safetyChips.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {safetyChips.map((c) => <span key={c} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0F172A] bg-blue-50 border border-blue-100 rounded-full px-2.5 py-1"><ShieldCheck className="w-3 h-3 text-[#2563EB]" />{c}</span>)}
                  </div>
                )}
                <ul className="mt-3 space-y-2">{(checksOut.length ? checksOut : ["Details confirmed at the dealership"]).map((b, i) => <li key={i} className="flex items-start gap-2 text-[13px]"><CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />{b}</li>)}</ul>
              </>;
            })()}
            <Link onClick={() => go("great-buy")} className="mt-auto pt-3 self-start">See full buying report</Link>
          </div>
          )}

          {/* Confirm before purchase — required disclosures only (open
              recalls, accidents, title brands), never hidden when present;
              the card does not render when there is nothing to disclose. */}
          {(() => {
            const rows = [
              d.openRecalls != null && d.openRecalls > 0 ? { t: `${d.openRecalls} open recall${d.openRecalls === 1 ? "" : "s"} need${d.openRecalls === 1 ? "s" : ""} remedy`, s: "Ask the dealer about the fix before purchase." } : null,
              d.accidentCount != null && d.accidentCount > 0 ? { t: `${d.accidentCount} reported accident${d.accidentCount === 1 ? "" : "s"}`, s: "Review the full history report and reconditioning work." } : null,
              d.titleStatus === "branded" ? { t: "Title brand reported", s: "Review the title history with the dealer." } : null,
            ].filter(Boolean) as { t: string; s: string }[];
            if (!rows.length) return null;
            return (
              <div className={`${CARD} p-5 flex flex-col`}>
                <H3>Confirm Before Purchase</H3>
                <div className="mt-3 space-y-2.5">
                  {rows.map((r) => (
                    <div key={r.t} className="rounded-xl border border-amber-100 bg-amber-50/50 p-3 flex items-start gap-2">
                      <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <div className="min-w-0"><p className="text-[12.5px] font-semibold text-[#0F172A] leading-tight">{r.t}</p><p className="text-[11px] text-[#64748B] mt-0.5">{r.s}</p></div>
                    </div>
                  ))}
                </div>
                {d.historyReport && pv("historyReport") && (
                  <div className="mt-3 pt-3 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
                    <a href={d.historyReport.url} target="_blank" rel="noopener noreferrer" onClick={() => trackHistoryReport("history_card")} className="text-[13px] font-semibold text-[#2563EB] inline-flex items-center gap-1.5 hover:underline">
                      {d.historyReport.source === "vin" ? `View the ${historyReportName(d.historyReport.provider)} record` : `View the free ${historyReportName(d.historyReport.provider)} Report`} <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    {d.historyReport.source !== "vin" && <p className="text-[11px] text-[#94A3B8] mt-0.5">Provided at no cost by {d.dealerName}</p>}
                  </div>
                )}
                <Link onClick={() => go("vehicle-history")} className="mt-auto pt-3 self-start">View full history report</Link>
              </div>
            );
          })()}

          {/* Ownership Timeline */}
          <div onClick={(e) => openPanel("ownership-timeline", e)} className={`${CARD} p-5 flex flex-col cursor-pointer hover:border-[#2563EB] transition-colors`}>
            <H3>Ownership Timeline</H3>
            <ol className="mt-4 space-y-4 relative border-l-2 border-slate-100 ml-1.5 pl-4">
              {([
                /^\d{4}$/.test((listing.ymm || "").split(" ")[0]) ? { d: (listing.ymm || "").split(" ")[0], t: "Manufactured", s: "Factory production", c: "bg-slate-400" } : null,
                d.warranty.in_service_date ? { d: new Date(d.warranty.in_service_date).toLocaleDateString(), t: "Placed in service", s: "Warranty begins", c: "bg-emerald-500" } : null,
                d.ownerCount != null ? { d: d.ownerCount === 0 ? "New" : d.ownerCount === 1 ? "Single owner" : `${d.ownerCount} owners`, t: d.ownerCount === 0 ? "You'd be the first owner" : "First owner", s: d.ownerCount === 0 ? "No prior owners" : "Personal use", c: "bg-emerald-500" } : null,
                d.serviceCount > 0 ? { d: `${d.serviceCount} records`, t: "Regular service", s: "Well maintained", c: "bg-emerald-500" } : null,
                listing.prep_status?.foreman_signed_at ? { d: new Date(listing.prep_status.foreman_signed_at).toLocaleDateString(), t: "Dealer inspection sign-off", s: "Prep work completed", c: "bg-emerald-500" } : null,
                { d: "Today", t: "Ready for you", s: "At the dealership", c: "bg-[#2563EB]" },
              ].filter(Boolean) as { d: string; t: string; s: string; c: string }[]).map((e, i) => <li key={i} className="relative"><span className={`absolute -left-[22px] top-1 w-3 h-3 rounded-full ${e.c} ring-2 ring-white`} /><p className="text-[12px] font-bold">{e.d} · {e.t}</p><p className="text-[11px] text-[#64748B]">{e.s}</p></li>)}
            </ol>
            <Link onClick={() => openPanel("ownership-timeline")} className="mt-auto pt-3 self-start">View full timeline</Link>
          </div>

          {/* Factory Warranty — hidden entirely when no coverage data exists;
              the Confirm Before Purchase card carries the confirm-with-dealer
              row instead of an empty card. */}
          {pv("warranty") && d.warrantyStr && (!d.warrantyExpired || d.dealerCoverage.length > 0) && (
          <div data-module="warranty" className={`${CARD} p-5 flex flex-col`}>
            {(() => {
              const w = d.warranty;
              const isNew = listing.condition === "new";
              const calc = (months?: number, miles?: number) => {
                let timePct: number | null = null, monthsLeft: number | null = null, endDate: Date | null = null;
                if (w.in_service_date && months) { const end = new Date(w.in_service_date); end.setMonth(end.getMonth() + months); endDate = end; const ms = end.getTime() - Date.now(); monthsLeft = ms > 0 ? Math.round(ms / (1000 * 60 * 60 * 24 * 30.4)) : 0; timePct = Math.max(3, Math.min(100, (monthsLeft / months) * 100)); }
                const milesLeft = miles != null && miles > 0 && listing.mileage != null ? Math.max(0, miles - listing.mileage) : null;
                const milesPct = miles && miles > 0 && listing.mileage != null ? Math.max(3, 100 - Math.min(100, (listing.mileage / miles) * 100)) : null;
                const vals = [timePct, milesPct].filter((x): x is number => x != null);
                const remainPct = vals.length ? Math.round(Math.min(...vals)) : null;
                const yrs = monthsLeft == null ? null : monthsLeft >= 12 ? `${Math.round(monthsLeft / 12)} yr` : `${monthsLeft} mo`;
                const milesLbl = milesLeft == null ? null : `${(milesLeft / 1000).toFixed(0)}K mi`;
                const fYrs = months ? `${Math.round(months / 12)} yr` : null;
                const fMiles = miles === -1 ? "Unlimited" : miles ? `${(miles / 1000).toFixed(0)}K mi` : null;
                const fullTerm = [fYrs, fMiles].filter(Boolean).join(" / ");
                // New cars: full term ahead (100%). Used cars: remaining.
                const pct = isNew ? 100 : remainPct;
                const label = isNew ? (fullTerm || null) : ([yrs, milesLbl].filter(Boolean).join(" / ") ? `${[yrs, milesLbl].filter(Boolean).join(" / ")} left` : null);
                return { pct, label, endMonthYear: endDate ? endDate.toLocaleDateString(undefined, { month: "long", year: "numeric" }) : null, remainPct };
              };
              const b2b = calc(w.factory_months, w.factory_miles);
              const ptw = (w.powertrain_months != null || w.powertrain_miles != null) ? calc(w.powertrain_months, w.powertrain_miles) : null;
              const active = !d.warrantyExpired;
              type CpoView = { name?: string; basic_months?: number; basic_miles?: number; powertrain_months?: number; powertrain_miles?: number };
              const cpo = listing.condition === "cpo" ? (listing as unknown as { cpo_programs?: CpoView[] }).cpo_programs?.[0] : null;
              const cpoTerm = cpo ? [(cpo.powertrain_months ?? cpo.basic_months) ? `${Math.round(((cpo.powertrain_months ?? cpo.basic_months) as number) / 12)} yr` : null, ((cpo.powertrain_miles ?? cpo.basic_miles) === -1) ? "Unlimited mi" : (cpo.powertrain_miles ?? cpo.basic_miles) ? `${(((cpo.powertrain_miles ?? cpo.basic_miles) as number) / 1000).toFixed(0)}K mi` : null].filter(Boolean).join(" / ") : "";
              // OEM-data-driven confidence one-liner — turns raw terms into a selling point.
              const confidence = isNew
                ? "Factory coverage begins when you take delivery."
                : cpo
                  ? "Certified Pre-Owned extends your factory powertrain coverage."
                  : ptw?.endMonthYear
                    ? `Powertrain coverage extends through ${ptw.endMonthYear}.`
                    : (b2b.remainPct ?? 0) >= 80
                      ? "Nearly all of the factory warranty remains."
                      : "This vehicle is still covered by the factory warranty.";
              const Bar = ({ label, tone, pct, sub, badge }: { label: string; tone: "blue" | "green" | "gold"; pct: number | null; sub?: string | null; badge?: string }) => {
                const c = tone === "blue" ? { ic: "text-[#2563EB]", bar: "bg-[#2563EB]" } : tone === "green" ? { ic: "text-[#16A34A]", bar: "bg-[#16A34A]" } : { ic: "text-amber-600", bar: "bg-amber-500" };
                return (
                  <div>
                    <div className="flex items-center gap-1.5"><ShieldCheck className={`w-3.5 h-3.5 ${c.ic}`} /><span className="text-[12px] font-semibold text-[#0F172A]">{label}</span>{badge && <span className="ml-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{badge}</span>}</div>
                    <div className="flex items-center gap-2 mt-1.5">
                      {pct != null && <span className={`text-[15px] font-extrabold tabular-nums w-9 ${c.ic}`}>{pct}%</span>}
                      <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${c.bar}`} style={{ width: `${pct ?? 100}%` }} /></div>
                    </div>
                    {sub && <p className="text-[11px] text-[#64748B] mt-1">{sub}</p>}
                  </div>
                );
              };
              return <>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5"><H3>{active ? "Factory Warranty" : "Warranty Coverage"}</H3><button onClick={(e) => openInfo("warranty-terms", e)} aria-label="Warranty terminology" className="w-6 h-6 rounded-full hover:bg-slate-100 flex items-center justify-center"><Info className="w-3.5 h-3.5 text-[#94A3B8]" /></button></div>
                  {active && <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{isNew ? "Full Coverage" : "Active"}</span>}
                </div>
                <p className="text-[11px] text-[#94A3B8] mt-0.5">{isNew ? "Starts When You Purchase" : active ? "Coverage Remaining" : "Dealer Coverage"}</p>
                {active ? (
                  <div className="mt-3 space-y-3">
                    {b2b.pct != null && <Bar label="Bumper-to-Bumper" tone="blue" pct={b2b.pct} sub={b2b.label} />}
                    {ptw && ptw.pct != null && <Bar label="Powertrain" tone="green" pct={ptw.pct} sub={ptw.label} />}
                    {cpo && <Bar label="Certified Pre-Owned" tone="gold" pct={100} sub={cpoTerm || "Certified coverage"} badge="Certified" />}
                    <div className="flex items-start gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-[5px] shrink-0" />
                      <p className="text-[11px] font-medium text-emerald-800 leading-snug">{confidence}</p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    {d.dealerCoverage.map((c, i) => (
                      <div key={i} className="flex items-start gap-2 rounded-lg bg-emerald-50 px-2.5 py-2">
                        <ShieldCheck className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-[12px] font-semibold text-[#0F172A]">{c.title || c.coverage || "Dealer coverage"}{c.mode === "included" ? " — included" : " — available"}</p>
                          {(c.lifetime || c.termYears || c.termMiles) && <p className="text-[11px] text-[#64748B]">{c.lifetime ? "For as long as you own the vehicle" : [c.termYears ? `${c.termYears} yr` : null, c.termMiles ? `${Math.round(c.termMiles / 1000)}K mi` : null].filter(Boolean).join(" / ")}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>;
            })()}
            <Link onClick={() => openPanel("factory-warranty")} className="mt-auto pt-3 self-start">View complete warranty</Link>
          </div>
          )}

          {/* What Owners Say — only when review data exists; an empty review
              card reads as unfinished to a shopper. */}
          {(d.reviewRating != null || d.dealerTrust.reviewSources.length > 0) && (
          <div className={`${CARD} p-5 flex flex-col`}>
            <H3>What Owners Say</H3>
            {d.reviewRating != null && <div className="flex items-center gap-2.5 mt-2"><span className="text-[32px] font-extrabold text-[#0F172A] leading-none">{d.reviewRating.toFixed(1)}</span><div><Stars n={d.reviewRating} />{d.reviewCount != null && <p className="text-[11px] text-[#64748B] mt-0.5">{d.reviewCount.toLocaleString()} Reviews</p>}</div></div>}
            {d.dealerTrust.reviewSources.length > 0 ? (
              <div className="mt-3 space-y-3">{d.dealerTrust.reviewSources.slice(0, 3).map((r, i) => <div key={i}><div className="flex items-center gap-2"><span className="text-[12px] font-bold">{r.name}</span>{r.rating != null && <Stars n={r.rating} size={12} />}</div>{r.quote && <p className="text-[12px] text-[#64748B] leading-snug">"{r.quote}"</p>}</div>)}</div>
            ) : null}
            <Link onClick={() => openPanel("owner-reviews")} className="mt-auto pt-3 self-start">Read all reviews</Link>
          </div>
          )}
          </div>
        </section>

        {/* 7. CHAPTER 3 — ABOUT THIS VEHICLE */}
        <section>
          <div className="mb-4"><H2>About This Vehicle</H2><p className={`text-[13px] ${TEXT2} mt-0.5`}>Highlights and a quick look at how it's equipped.</p></div>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-6 items-stretch print:block print:space-y-5">
          {/* Highlights */}
          {pv("factoryOptions") && (highlights.length > 0 || (buildSheet?.packages.length ?? 0) > 0) && (
          <div data-module="highlights" className={`${CARD} p-5 flex flex-col`}>
            <H3>Vehicle Highlights</H3>
            {buildSheet && buildSheet.packages.length > 0 && (
              <p className="text-[12px] text-[#64748B] mt-1.5">
                <span className="font-semibold text-[#0F172A]">Built with:</span>{" "}
                {buildSheet.packages.slice(0, 3).map((p) => p.msrp ? `${p.name} (${fmt$(p.msrp)})` : p.name).join(" · ")}
                {buildSheet.packages.length > 3 ? ` +${buildSheet.packages.length - 3} more` : ""}
                {buildSheet.estValue ? ` — ${fmt$(buildSheet.estValue)} in options beyond a standard ${listing.trim || "build"}` : ""}
              </p>
            )}
            {highlights.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3.5">{highlights.slice(0, 12).map((h, i) => <span key={i} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#334155] bg-slate-50 border border-slate-200 rounded-full pl-2 pr-3 py-1.5"><h.icon className="w-3.5 h-3.5 text-[#2563EB] shrink-0" strokeWidth={1.75} />{h.t}<span className="text-[10px] font-medium text-[#94A3B8]">{h.s}</span></span>)}</div>
            )}
            {d.epa?.annualFuelCost != null && <p className="text-[12px] text-[#64748B] mt-2.5"><span className="font-semibold text-[#0F172A]">EPA-estimated fuel cost:</span> {fmt$(d.epa.annualFuelCost)}/yr</p>}
            <div className="mt-auto pt-3 flex items-center gap-4">
              <Link onClick={() => openPanel("highlights")} className="self-start">All features &amp; equipment</Link>
              <Link onClick={() => openPanel("key-specs")} className="self-start">Full specifications</Link>
            </div>
          </div>
          )}
          {/* Overview — text plus a compact photo story strip instead of one
              oversized secondary image. */}
          {pv("description") && (d.overview.trim().length > 0 || gallery.length > 1) && (
          <div data-module="overview" className={`${CARD} p-5 flex flex-col`}>
            <H3>Vehicle Overview</H3>
            {d.overview.trim().length > 0 && <p className="text-[13px] leading-relaxed text-[#64748B] mt-3 line-clamp-4">{d.overview}</p>}
            {gallery.length > 1 && (
              <div className="mt-3">
                <p className="text-[11px] font-semibold text-[#94A3B8] mb-1.5">Vehicle photo story</p>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                  {gallery.slice(1, 7).map((g, i) => (
                    <button key={i} onClick={() => go("gallery")} className="rounded-lg overflow-hidden bg-slate-100 aspect-[4/3] hover:opacity-90 transition-opacity"><img src={g} alt="" loading="lazy" className="w-full h-full object-cover" /></button>
                  ))}
                </div>
              </div>
            )}
            <Link onClick={() => openPanel("overview")} className="mt-auto pt-3 self-start">Read full overview</Link>
          </div>
          )}
          </div>
        </section>

        {/* 8. CHAPTER 4 — WHY BUY HERE */}
        <section>
          <div className="mb-4"><H2>Why Buy From {d.dealerName}</H2><p className={`text-[13px] ${TEXT2} mt-0.5`}>What makes buying here different.</p></div>
          <div data-module="dealer" className={`${CARD} p-6 flex flex-col`}>
            {(() => {
              // When the dealer hasn't configured trust content, fall back to
              // platform-true facts so this section never renders empty.
              const city = (listing.dealer_snapshot?.city as string) || "";
              const fallback: { icon: React.ElementType; t: string; s: string }[] = [
                ...(d.dealerVerified && d.verifyRows.length > 0 ? [{ icon: ShieldCheck, t: "Dealer-Verified Vehicle", s: "Checked against trusted data sources" }] : []),
                { icon: FileText, t: "Vehicle Passport Transparency", s: "One record for this exact VIN" },
                ...((listing.documents?.length ?? 0) > 0 ? [{ icon: FileText, t: "Documents Available", s: "Source documents on file" }] : []),
                { icon: BadgeCheck, t: "Secure Reservation Request", s: "No payment required · dealer-confirmed" },
                ...(city ? [{ icon: MapPin, t: `Local ${city} Dealer`, s: "See it in person" }] : []),
                { icon: MessageSquare, t: "Contact the Dealer Directly", s: "Call, text, or message" },
              ];
              const chips = dealerChips.length > 0 ? dealerChips : fallback;
              return (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-4 mt-1">
                  {chips.map((c, i) => <div key={i} className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" /><div className="min-w-0"><p className="text-[13px] font-semibold leading-tight text-[#0F172A]">{c.t}</p><p className="text-[11px] text-[#64748B] mt-0.5">{c.s}</p></div></div>)}
                </div>
              );
            })()}
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

        {/* FINAL CTA — the strongest conversion moment on the page; the
            floating dock hides while this block is in view. Hidden on small
            screens where the sticky bottom bar already owns this job. */}
        <section ref={finalCtaRef} className="hidden md:block rounded-2xl p-6 sm:p-7 text-white print:hidden" style={{ background: "linear-gradient(160deg,#2563EB 0%,#1e50c8 100%)" }}>
          <div className="flex flex-col lg:flex-row lg:items-center gap-5 lg:justify-between">
            <div className="flex items-start gap-3">
              <span className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0"><ShieldCheck className="w-6 h-6" /></span>
              <div>
                <h2 className="text-[22px] font-extrabold leading-tight">Ready to take the next step on this {(listing.ymm || "").split(/\s+/).slice(2).join(" ").trim() || "vehicle"}?</h2>
                <p className="text-[13px] opacity-90 mt-0.5">Reserve the vehicle, schedule a test drive, or contact the dealer to confirm final details.</p>
                {(() => {
                  const dw = d.dealerCoverage.find((c) => c.mode === "included");
                  const reconSteps = d.recon ? d.recon.workItems.length + (d.recon.inspection ? 1 : 0) + d.recon.thirdParty.length : 0;
                  const recap = [
                    d.belowMarket && d.belowMarket > 0 ? `${fmt$(d.belowMarket)} below market` : null,
                    buildSheet?.estValue ? `${fmt$(buildSheet.estValue)} in factory options` : null,
                    dw?.title ? `${dw.title} included` : null,
                    reconSteps > 0 ? `${reconSteps}-point reconditioning complete` : null,
                  ].filter(Boolean).slice(0, 3) as string[];
                  return recap.length ? (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {recap.map((c) => <span key={c} className="inline-flex items-center gap-1.5 text-[11.5px] font-bold bg-white/15 border border-white/30 rounded-full px-3 py-1"><CheckCircle2 className="w-3.5 h-3.5" />{c}</span>)}
                    </div>
                  ) : null;
                })()}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <button onClick={() => go("reserve")} className="h-11 px-5 rounded-xl bg-white text-[#2563EB] text-[13.5px] font-bold inline-flex items-center gap-2 transition-transform hover:-translate-y-0.5"><BadgeCheck className="w-[18px] h-[18px]" /> Reserve This Vehicle</button>
              <button onClick={() => go("test-drive")} className="h-11 px-4 rounded-xl bg-white/10 border border-white/40 text-white text-[13.5px] font-bold inline-flex items-center gap-2 hover:bg-white/20 transition-colors"><Clock className="w-[18px] h-[18px]" /> Schedule Test Drive</button>
              <button onClick={() => go("contact")} className="h-11 px-4 rounded-xl bg-white/10 border border-white/40 text-white text-[13.5px] font-bold inline-flex items-center gap-2 hover:bg-white/20 transition-colors"><MessageSquare className="w-[18px] h-[18px]" /> Contact Dealer</button>
              <button onClick={() => window.print()} className="h-11 px-4 rounded-xl bg-white/10 border border-white/40 text-white text-[13.5px] font-bold inline-flex items-center gap-2 hover:bg-white/20 transition-colors"><Printer className="w-[18px] h-[18px]" /> Print Vehicle Passport</button>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="pt-2">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-5 border-t border-[#E6E8EC]">
            <Logo variant="full" size={20} />
            <div className="flex gap-6 text-[12px] text-[#64748B]">
              <span className="inline-flex items-center gap-1.5"><Lock className="w-3.5 h-3.5 text-[#16A34A]" /> Secure &amp; Private</span>
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-[#16A34A]" /> VIN-Verified Data</span>
              <span className="inline-flex items-center gap-1.5"><FileText className="w-3.5 h-3.5 text-[#16A34A]" /> Dealer-Provided Documents</span>
            </div>
            <div className="hidden lg:flex items-center gap-2 text-[12px] print:hidden">
              {sticky.enabled && sticky.items.map((it) => {
                const a = stickyAction(it.key);
                return <button key={it.key} onClick={a.onClick} className={`h-10 px-3.5 rounded-xl text-[12px] font-bold inline-flex items-center gap-1.5 transition-colors ${it.primary ? "bg-[#2563EB] text-white hover:bg-[#1d4fd7]" : "border border-[#E6E8EC] text-[#0F172A] hover:border-[#2563EB]"}`}><a.icon className={`w-4 h-4 ${it.primary ? "" : "text-[#2563EB]"}`} /> {it.label}</button>;
              })}
            </div>
          </div>
          <p className="text-[11px] text-[#94A3B8] text-center pb-1">Vehicle Passport · VIN {listing.vin} · {d.dealerName}</p>
          <p className="text-[11px] text-[#94A3B8] text-center pb-2">Information is provided by trusted third parties and is accurate to the best of our knowledge. Verify details with the dealer. © {new Date().getFullYear()} {d.dealerName}. All rights reserved.</p>
          <div className="flex items-center justify-center gap-4 text-[11px] font-semibold text-[#64748B] pb-6"><a href="/privacy" className="hover:text-[#2563EB]">Privacy</a><span className="text-slate-300">·</span><a href="/terms" className="hover:text-[#2563EB]">Terms</a></div>
        </footer>
      </main>

      {/* Mobile sticky header — slides in after scrolling past the hero. */}
      <div className={`lg:hidden print:hidden fixed top-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-b border-[#E6E8EC] transition-transform duration-200 ${showSticky ? "translate-y-0" : "-translate-y-full"}`}>
        <div className="h-14 px-3 flex items-center gap-2.5">
          <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Top" className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center shrink-0"><ChevronLeft className="w-5 h-5" /></button>
          {hero && <img src={hero} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />}
          <div className="min-w-0 flex-1"><p className="text-[13px] font-bold leading-tight truncate">{listing.ymm || "Vehicle"}</p>{price != null && <p className="text-[12px] font-bold text-[#2563EB] leading-tight">{fmt$(price)}</p>}</div>
          {rating?.overall != null && <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#16A34A] bg-emerald-50 border border-emerald-200 rounded-full px-2 py-1 shrink-0"><ShieldCheck className="w-3 h-3" />{rating.overall}</span>}
          <button onClick={handleShare} aria-label="Share" className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center shrink-0"><Upload className="w-[18px] h-[18px] text-[#64748B]" /></button>
        </div>
      </div>

      {/* Mobile sticky bottom CTA — the small-screen counterpart of the desktop
          "Ready to take the next step?" card: blue gradient, rounded top,
          white actions, primary as the filled white pill. Buttons, order,
          primary, and labels are dealer-configurable (admin → Passport CTAs). */}
      {sticky.enabled && sticky.items.length > 0 && (
        <div className="lg:hidden print:hidden fixed bottom-0 inset-x-0 z-40 rounded-t-[20px] shadow-[0_-8px_30px_rgba(37,99,235,0.35)] px-3 pt-3 pb-[calc(10px+env(safe-area-inset-bottom))]" style={{ background: "linear-gradient(160deg,#2563EB 0%,#1e50c8 100%)" }}>
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

      {!finalCtaInView && <div className="print:hidden"><PassportCtaDock go={go} dealerPhone={d.dealerPhone || undefined} reviewRating={d.reviewRating} advisor={adv} routing={d.contactRouting} vehicle={{ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin }} /></div>}

      <div className="print:hidden">
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
    </div>
  );
};

export default VehiclePassportV3;
