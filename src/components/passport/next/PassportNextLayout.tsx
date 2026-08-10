// ──────────────────────────────────────────────────────────────────────
// PassportNextLayout — the NEXT-VERSION passport design, as a pure layout.
//
// DRAFT. Reachable only at /v-next/:slug. The live passport at /v/:slug is
// untouched and stays that way until this is signed off.
//
// It owns presentation ONLY. It takes `data` and `dealer` and emits intents;
// it never fetches, never derives price, and never decides a verification
// status. Those stay in the one place they already live — passportV2Data,
// verificationSummary, saleCard — and reach this file through
// buildNextPassportData(). That boundary is the whole point: a second passport
// that forked the truth model would drift from the live one within a week, the
// way the new-car addendum drifted from the premium sheet.
// ──────────────────────────────────────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */

/* ============================================================================
   auto(LABELS) VEHICLE PASSPORT — MOBILE (production refinement)
   ----------------------------------------------------------------------------
   Single continuous vertical scroll. Mobile only (375–430px).
   Locked: dealer module w/ photo, warranty color semantics (B2B blue /
   powertrain green), window-sticker prominence, light card visual language.

   WIRE-UP POINTS
     <VehiclePassport data={apiPayload} dealer={dealerConfig}
                      onEvent={(name, ctx) => segment.track(name, ctx)}
                      onAction={(intent, ctx) => openFlow(intent, ctx)} />

   Every data-backed section accepts state: 'success' | 'loading' | 'pending'
   | 'unavailable' | 'error'. Missing data NEVER renders as a positive fact.
   ========================================================================== */

import React, { useState, useRef, useEffect, useCallback, createContext, useContext } from "react";
import {
  ChevronLeft, ChevronRight, Bell, User, Menu, Maximize2, CheckCircle2, Clock,
  Info, AlertTriangle, MinusCircle, ShieldCheck, Calendar, Tag, FileText, Star,
  DollarSign, HelpCircle, BookOpen, Car, Phone, MessageSquare, ExternalLink,
  TrendingUp, RefreshCw,
} from "lucide-react";

/* ==========================================================================
   1. STATUS VOCABULARY  (§9 — semantics are product-wide, do not localize)
   ========================================================================== */

type StatusStyle = {
  label: string;
  Icon: React.ComponentType<any>;
  text: string; dot: string; bg: string; ring: string;
};

const STATUS: Record<string, StatusStyle> = {
  VERIFIED:      { label: "Verified",      Icon: CheckCircle2,   text: "text-green-600", dot: "text-green-600", bg: "bg-green-50",  ring: "ring-green-200" },
  ACTIVE:        { label: "Active",        Icon: ShieldCheck,    text: "text-green-600", dot: "text-green-600", bg: "bg-green-50",  ring: "ring-green-200" },
  ESTIMATED:     { label: "Estimated",     Icon: Info,           text: "text-blue-600",  dot: "text-blue-600",  bg: "bg-blue-50",   ring: "ring-blue-200" },
  PENDING:       { label: "Pending",       Icon: Clock,          text: "text-amber-600", dot: "text-amber-500", bg: "bg-amber-50",  ring: "ring-amber-200" },
  NOT_AVAILABLE: { label: "Not available", Icon: MinusCircle,    text: "text-gray-500",  dot: "text-gray-400",  bg: "bg-gray-50",   ring: "ring-gray-200" },
  ATTENTION:     { label: "Review",        Icon: AlertTriangle,  text: "text-amber-600", dot: "text-amber-500", bg: "bg-amber-50",  ring: "ring-amber-200" },
};

/* Status is never color-alone: icon + text label always render together (§26) */
function StatusPill({ status, label, className = "" }: { status?: string; label?: string; className?: string }) {
  const s = (status && STATUS[status]) || STATUS.NOT_AVAILABLE;
  const { Icon } = s;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${s.text} ${className}`} style={{ fontSize: "11px" }}>
      <Icon size={13} aria-hidden="true" />
      {label || s.label}
    </span>
  );
}

/* ==========================================================================
   2. ANALYTICS  (§24, §25)
   ========================================================================== */

type EventContext = Record<string, unknown> & { section?: string; location?: string };
type MeaningfulInteraction = { name: string; section?: string };
type DetailHandler = (event: string, section: string) => void;
type ActHandler = (intent: string, ctx?: EventContext) => void;
type AnalyticsApi = {
  track: (name: string, ctx?: EventContext, opts?: { once?: boolean }) => void;
  act: (intent: string, ctx?: EventContext) => void;
  recent: () => MeaningfulInteraction[];
};

const AnalyticsCtx = createContext<AnalyticsApi>({ track: () => {}, act: () => {}, recent: () => [] });
const useAnalytics = () => useContext(AnalyticsCtx);

/* Interactions we consider "meaningful" for intent preservation (§25) */
const MEANINGFUL = /_interaction$|_click$/;

function useAnalyticsEngine({ vehicle, dealerId, onEvent, onAction }: {
  vehicle: any;
  dealerId?: string;
  onEvent?: (name: string, payload: Record<string, unknown>) => void;
  onAction?: (intent: string, payload: Record<string, unknown>) => void;
}): AnalyticsApi {
  const fired = useRef(new Set<string>());   // one-shot guard for *_view events
  const recent = useRef<MeaningfulInteraction[]>([]);  // rolling meaningful-interaction log
  const session = useRef(
    (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  );

  const baseContext = useCallback(() => ({
    dealer_id: dealerId,
    vehicle_id: vehicle.vehicleId,
    vin: vehicle.vin,
    stock_number: vehicle.stock,
    session_id: session.current,
    timestamp: new Date().toISOString(),
    current_page: "vehicle_passport",
    referrer: typeof document !== "undefined" ? document.referrer || null : null,
    previous_meaningful_interaction: recent.current[0]?.name || null,
  }), [dealerId, vehicle]);

  const track = useCallback((name: string, ctx: EventContext = {}, opts: { once?: boolean } = {}) => {
    if (opts.once !== false && /(_view$|^passport_scroll_)/.test(name)) {
      if (fired.current.has(name)) return;   // fires once, per §33
      fired.current.add(name);
    }
    if (MEANINGFUL.test(name)) {
      recent.current = [{ name, section: ctx.section }, ...recent.current].slice(0, 6);
    }
    const payload = { ...baseContext(), ...ctx };
    if (typeof window !== "undefined") {
      const w = window as typeof window & { dataLayer?: Record<string, unknown>[] };
      w.dataLayer = w.dataLayer || [];
      w.dataLayer.push({ event: name, ...payload });
    }
    onEvent?.(name, payload);
  }, [baseContext, onEvent]);

  /* Conversion actions carry non-sensitive passport context downstream (§25) */
  const act = useCallback((intent: string, ctx: EventContext = {}) => {
    const payload = {
      ...baseContext(),
      cta_location: ctx.location,
      intent,
      vehicle_label: `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim}`.trim(),
      recent_passport_interactions: recent.current.map((r) => r.section || r.name).filter(Boolean).slice(0, 3),
    };
    track(`${intent}_start`, payload, { once: false });
    onAction?.(intent, payload);
  }, [baseContext, track, onAction, vehicle]);

  return { track, act, recent: () => recent.current };
}

/* Section impressions */
function useSectionView(name: string, section: string) {
  const { track } = useAnalytics();
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { track(name, { section }); io.disconnect(); }
      }),
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [name, section, track]);
  return ref;
}

/* Scroll depth — capture:true so it works whether window or a container scrolls */
function useScrollDepth(rootRef: React.RefObject<HTMLElement | null>) {
  const { track } = useAnalytics();
  useEffect(() => {
    const handler = () => {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 0;
      const total = Math.max(r.height - vh, 1);
      const pct = Math.min(Math.max((-r.top / total) * 100, 0), 100);
      [25, 50, 75, 100].forEach((m) => { if (pct >= m) track(`passport_scroll_${m}`); });
    };
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    handler();
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [rootRef, track]);
}

/* ==========================================================================
   3. PRIMITIVES
   ========================================================================== */

function Card({ children, className = "", innerRef, ...rest }: {
  children: React.ReactNode; className?: string; innerRef?: React.Ref<HTMLElement>; [k: string]: any;
}) {
  return (
    <section
      ref={innerRef}
      className={`bg-white rounded-xl border border-gray-200 shadow-sm ${className}`}
      {...rest}
    >
      {children}
    </section>
  );
}

function CardTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <h2 className="text-sm font-bold text-gray-900 leading-tight">{children}</h2>
      {right}
    </div>
  );
}

function LinkRow({ children, onClick, href, className = "" }: {
  children: React.ReactNode; onClick?: () => void; href?: string; className?: string;
}) {
  const Comp = href ? "a" : "button";
  return (
    <Comp
      href={href}
      target={href ? "_blank" : undefined}
      rel={href ? "noreferrer" : undefined}
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded ${className}`}
    >
      {children}
      <ChevronRight size={13} aria-hidden="true" />
    </Comp>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`bg-gray-100 rounded animate-pulse ${className}`} aria-hidden="true" />;
}

/* Neutral state — never a false positive (§27) */
function DataState({ state, title, children }: {
  state?: string; title?: string; children: React.ReactNode;
}) {
  if (state === "success" || !state) return <>{children}</>;
  const map: Record<string, { Icon: StatusStyle["Icon"]; text: string }> = {
    loading:     { Icon: RefreshCw,   text: "Checking sources…" },
    pending:     { Icon: Clock,       text: "Source has not returned a result yet." },
    unavailable: { Icon: MinusCircle, text: "No source information is currently available." },
    error:       { Icon: AlertTriangle, text: "This information could not be loaded. Try again shortly." },
  };
  const { Icon, text } = map[state] || map.unavailable;
  return (
    <div className="flex items-start gap-2 py-3 text-gray-500">
      <Icon size={15} className="mt-px shrink-0" aria-hidden="true" />
      <p className="text-xs leading-relaxed">
        {title ? <span className="font-semibold text-gray-600">{title}. </span> : null}
        {text}
      </p>
    </div>
  );
}

/* Image with reserved dimensions (no CLS) + graceful missing-asset fallback */
function SafeImage({ src, alt, className = "", ratio = "56.25%", rounded = "rounded-lg", eager = false, children }: {
  src?: string; alt: string; className?: string; ratio?: string; rounded?: string;
  eager?: boolean; children?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(!src);
  return (
    <div className={`relative w-full overflow-hidden bg-gray-100 ${rounded} ${className}`} style={{ paddingTop: ratio }}>
      {!failed && (
        <img
          src={src}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 gap-1">
          <Car size={26} aria-hidden="true" />
          <span style={{ fontSize: "11px" }}>{alt}</span>
        </div>
      )}
      {children}
    </div>
  );
}

const money = (n: number | string | null | undefined): string =>
  typeof n === "number" ? `$${n.toLocaleString("en-US")}` : n || "—";

/* ==========================================================================
   4. DEFAULT DATA  (replace with API payload)
   ========================================================================== */

const DEFAULT_DATA = {
  vehicle: {
    vehicleId: "veh_78412",
    vin: "5N1AL1FW77TCS41119",
    stock: "TC341119",
    year: 2026, make: "INFINITI", model: "QX60", trim: "Sport",
    mileage: 7505,
    cpo: true, cpoLabel: "INFINITI CERTIFIED • CPO",
    overview:
      "The 2026 INFINITI QX60 Sport pairs a 3.5L V6, 9-speed automatic and all-wheel drive for confident performance.",
    photos: [], // ["https://cdn.autolabels.io/veh_78412/01.jpg", ...]
    photoCount: 26,
    specs: [
      { label: "Engine", value: "3.5L V6" },
      { label: "Drivetrain", value: "AWD" },
      { label: "Mileage", value: "7,505 miles" },
      { label: "Transmission", value: "Automatic" },
      { label: "Exterior", value: "Mineral" },
      { label: "Interior", value: "Graphite Package · Dark" },
    ],
  },

  trustBadges: [
    { label: "Vehicle History Verified", status: "VERIFIED" },
    { label: "Market Data Verified", status: "VERIFIED" },
    { label: "Factory Warranty Active", status: "ACTIVE" },
    { label: "INFINITI Certified · CPO", status: "VERIFIED" },
  ],

  price: {
    state: "success",
    current: 52876,
    lines: [
      { label: "Market Value", value: 53000 },
      { label: "Dealer Discount", value: -3184, negative: true },
      { label: "Vehicle Savings", value: 49816, strong: true },
      { label: "+ Dealer Fee (Est.)", value: 3000 },
    ],
    total: { label: "Total Advertised Price", value: 52876 },
    disclosure:
      "Price excludes taxes, title, registration and dealer conveyance fee where not shown. Final terms from dealer.",
  },

  payment: {
    state: "success",
    monthly: 817, apr: "7.25%", term: "72 months", down: 5500,
    disclosure: "Final terms from dealer. Taxes, title, fees, rates, and trade equity not included.",
  },

  verification: {
    state: "success",
    verifiedCount: 6,
    pendingCount: 2,
    items: [
      { label: "Title & Brand",  status: "VERIFIED", source: "NMVTIS", checked: "Aug 8, 2026" },
      { label: "Odometer",       status: "VERIFIED", source: "NMVTIS / CARFAX", checked: "Aug 8, 2026" },
      { label: "No Accidents",   status: "VERIFIED", source: "CARFAX", checked: "Aug 8, 2026" },
      { label: "No Flood / Hail",status: "VERIFIED", source: "NMVTIS", checked: "Aug 8, 2026" },
      { label: "No Frame Damage",status: "VERIFIED", source: "CARFAX", checked: "Aug 8, 2026" },
      { label: "No Open Recalls", status: "VERIFIED", source: "NHTSA", checked: "Aug 8, 2026" },
      { label: "No Lemon History", status: "VERIFIED", source: "NMVTIS", checked: "Aug 8, 2026" },
    ],
  },

  market: {
    state: "success",
    similar: 34, belowMarket: 626, daysOnMarket: 125,
    position: 0.22,           // 0 = great price, 1 = overpriced
    updated: "Aug 8, 2026",
    note: "Inventory-watch closely",
  },

  reasons: {
    state: "success",
    items: [
      "Below-market pricing",
      "One owner reported (CARFAX)",
      "Title verified: clean",
      "No open recalls",
      "INFINITI Certified (CPO)",
      "Recent service reported (dealer + marketing package)",
    ],
  },

  confirm: {
    state: "success",
    items: [
      { label: "View the CARFAX report", href: "https://www.carfax.com/", external: true },
      { label: "View all documents" },
    ],
    note: "Confirm equipment, coverage and final figures with the dealership before purchase.",
  },

  timeline: {
    state: "success",
    events: [
      { year: "2025", label: "Placed in Service", status: "VERIFIED" },
      { year: "2025", label: "INFINITI · Original Owner", status: "VERIFIED" },
      { year: "2026", label: "Arrived at Harte Auto Group", status: "ESTIMATED" },
      { year: "", label: "Available Today", status: "ACTIVE" },
    ],
  },

  windowSticker: {
    state: "success",
    previewImage: "",
    vinSpecific: true,
    url: "#window-sticker",
  },

  warranty: {
    state: "success",
    estimated: true,
    coverages: [
      { key: "b2b",        name: "Bumper-to-Bumper", pct: 75, color: "bg-blue-600",  terms: "5 yrs / Oct 9, 2031", remaining: "36,495 mi remaining" },
      { key: "powertrain", name: "Powertrain",       pct: 92, color: "bg-green-600", terms: "7 yrs / 100,000 mi",  remaining: "92,495 mi remaining" },
    ],
  },
};

const DEFAULT_DEALER = {
  dealer_id: "harte_auto_group",
  dealer_name: "Harte Auto Group",
  dealer_logo: "",
  dealer_hero_image: "",     // real dealership photograph
  dealer_headline: "Why Buy From Harte Auto Group",
  dealer_subheadline: "What makes buying here different.",
  founded_year: 1993,
  years_in_business: 33,
  proof_points: [
    "Family owned",
    "Authorized INFINITI retailer",
    "On-site service center",
    "Financing available",
    "Local delivery available",
  ],
  recognitions: [
    { name: "INFINITI Award of Excellence", disclosure: "Dealer-reported recognition" },
    { name: "Multiple Customer Satisfaction Awards", disclosure: "Dealer-reported recognition" },
  ],
  learn_more_url: "#dealer",
  phone: "+18605551234",
  sms: "+18605551234",
};

/* ==========================================================================
   5. SECTIONS
   ========================================================================== */

function Header() {
  return (
    <header className="sticky top-0 z-30 bg-white border-b border-gray-200">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-base font-bold text-gray-900 tracking-tight">
          auto<span className="text-blue-600">(LABELS)</span>
        </span>
        <nav className="flex items-center gap-4 text-gray-500" aria-label="Account">
          <button aria-label="Notifications" className="hover:text-gray-900"><Bell size={18} /></button>
          <button aria-label="Your account" className="hover:text-gray-900"><User size={18} /></button>
          <button aria-label="Menu" className="hover:text-gray-900"><Menu size={18} /></button>
        </nav>
      </div>
    </header>
  );
}

function Gallery({ vehicle }: { vehicle: any }) {
  const { track } = useAnalytics();
  const [i, setI] = useState(0);
  const count = vehicle.photos.length || vehicle.photoCount || 1;
  const go = (dir: number) => {
    setI((p) => (p + dir + count) % count);
    track("vehicle_gallery_interaction", { section: "Vehicle photos", direction: dir > 0 ? "next" : "prev" }, { once: false });
  };
  return (
    <div className="bg-white">
      <SafeImage
        src={vehicle.photos[i]}
        alt={`${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim}`}
        ratio="66%" rounded="rounded-none" eager
      >
        {vehicle.cpo && (
          <span className="absolute top-3 left-1/2 -translate-x-1/2 bg-black text-white px-3 py-1 rounded-full font-semibold tracking-wide" style={{ fontSize: "10px" }}>
            {vehicle.cpoLabel}
          </span>
        )}
        <span className="absolute top-3 right-3 bg-black bg-opacity-60 text-white px-2 py-1 rounded" style={{ fontSize: "10px" }}>
          {i + 1}/{count}
        </span>
        <button onClick={() => go(-1)} aria-label="Previous photo"
          className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white bg-opacity-90 shadow flex items-center justify-center text-gray-700">
          <ChevronLeft size={18} />
        </button>
        <button onClick={() => go(1)} aria-label="Next photo"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white bg-opacity-90 shadow flex items-center justify-center text-gray-700">
          <ChevronRight size={18} />
        </button>
        <button aria-label="View photos full screen"
          onClick={() => track("photos_interaction", { section: "Vehicle photos", mode: "fullscreen" }, { once: false })}
          className="absolute bottom-3 right-3 w-9 h-9 rounded-lg bg-white bg-opacity-90 shadow flex items-center justify-center text-gray-700">
          <Maximize2 size={16} />
        </button>
      </SafeImage>

      <div className="flex gap-2 px-3 py-2 overflow-x-auto">
        {Array.from({ length: Math.min(count, 6) }).map((_, n) => (
          <button key={n} onClick={() => { setI(n); track("vehicle_gallery_interaction", { section: "Vehicle photos", thumb: n }, { once: false }); }}
            aria-label={`View photo ${n + 1}`}
            className={`shrink-0 w-16 rounded-md overflow-hidden border-2 ${n === i ? "border-blue-600" : "border-transparent"}`}>
            <SafeImage src={vehicle.photos[n]} alt={`Photo ${n + 1}`} ratio="72%" rounded="rounded-none" />
          </button>
        ))}
      </div>
    </div>
  );
}

function Identity({ vehicle, badges }: { vehicle: any; badges: any[] }) {
  return (
    <div className="px-4 pt-1 pb-3 bg-white">
      <h1 className="text-lg font-bold text-gray-900 leading-tight">
        {vehicle.year} {vehicle.make} {vehicle.model} {vehicle.trim}
      </h1>
      <p className="text-sm text-gray-600 mt-0.5">{vehicle.mileage.toLocaleString("en-US")} miles</p>

      <ul className="flex flex-wrap gap-1.5 mt-3">
        {badges.slice(0, 4).map((b: any) => {
          const s = STATUS[b.status];
          const { Icon } = s;
          return (
            <li key={b.label}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full ring-1 ${s.bg} ${s.ring} ${s.text} font-semibold`}
              style={{ fontSize: "10px" }}>
              <Icon size={11} aria-hidden="true" />{b.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PriceSection({ price }: { price: any }) {
  return (
    <Card className="p-4">
      <DataState state={price.state} title="Pricing">
        <p className="text-xs font-semibold text-gray-500">Current Price</p>
        <p className="text-3xl font-bold text-blue-600 leading-none mt-1">{money(price.current)}</p>

        <dl className="mt-3 divide-y divide-gray-100">
          {price.lines.map((l: any) => (
            <div key={l.label} className="flex items-center justify-between py-1.5">
              <dt className={`text-xs ${l.strong ? "font-bold text-gray-900" : "text-gray-600"}`}>{l.label}</dt>
              <dd className={`text-xs font-semibold ${l.negative ? "text-red-600" : l.strong ? "text-gray-900" : "text-gray-800"}`}>
                {l.negative ? `-${money(Math.abs(l.value))}` : money(l.value)}
              </dd>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2">
            <dt className="text-xs font-bold text-gray-900">{price.total.label}</dt>
            <dd className="text-sm font-bold text-gray-900">{money(price.total.value)}</dd>
          </div>
        </dl>

        <p className="text-gray-500 mt-2 leading-relaxed" style={{ fontSize: "10px" }}>{price.disclosure}</p>
      </DataState>
    </Card>
  );
}

function PaymentSection({ payment, onBuild }: { payment: any; onBuild: () => void }) {
  return (
    <Card className="p-4">
      <DataState state={payment.state} title="Payment estimate">
        <p className="text-xs font-semibold text-gray-500">Estimated Payment ({payment.apr} APR)</p>
        <p className="mt-1">
          <span className="text-2xl font-bold text-gray-900">{money(payment.monthly)}</span>
          <span className="text-sm text-gray-500 font-medium">/mo</span>
        </p>
        <p className="text-xs text-gray-600 mt-1">
          {payment.term} · {money(payment.down)} down
        </p>
        <div className="mt-2">
          <LinkRow onClick={onBuild}>Build My Payment</LinkRow>
        </div>
        <p className="text-gray-500 mt-2 leading-relaxed" style={{ fontSize: "10px" }}>{payment.disclosure}</p>
      </DataState>
    </Card>
  );
}

function PrimaryActions({ onAct, location }: { onAct: ActHandler; location: string }) {
  return (
    <div className="space-y-2">
      <button
        onClick={() => onAct("test_drive", { location })}
        className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm py-3 rounded-lg shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
        <Calendar size={16} aria-hidden="true" /> Schedule Test Drive
      </button>
      <button
        onClick={() => onAct("vehicle_hold", { location })}
        className="w-full flex items-center justify-center gap-2 bg-white border border-blue-600 text-blue-600 hover:bg-blue-50 font-semibold text-sm py-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
        <Tag size={16} aria-hidden="true" /> Request Vehicle Hold
      </button>
    </div>
  );
}

function QuickActions({ onQuick }: { onQuick: (key: string, label: string) => void }) {
  const items = [
    { key: "trade",         label: "Value My Trade",   Icon: DollarSign },
    { key: "payment_detail",label: "Payment Details",  Icon: FileText },
    { key: "contact",       label: "Ask a Question",   Icon: HelpCircle },
    { key: "brochure",      label: "View Brochure",    Icon: BookOpen },
    { key: "reviews",       label: "Read Reviews",     Icon: Star },
    { key: "payment",       label: "Build My Payment", Icon: Calendar },
  ];
  return (
    <Card className="p-3">
      <ul className="grid grid-cols-3 gap-2">
        {items.map(({ key, label, Icon }) => (
          <li key={key}>
            <button onClick={() => onQuick(key, label)}
              className="w-full flex flex-col items-center gap-1 py-2 px-1 rounded-lg hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              <Icon size={17} className="text-blue-600" aria-hidden="true" />
              <span className="text-gray-700 font-medium text-center leading-tight" style={{ fontSize: "10px" }}>{label}</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function VerificationSection({ verification, onDetail }: { verification: any; onDetail: DetailHandler }) {
  const ref = useSectionView("verification_view", "Verification");
  return (
    <Card className="p-4" innerRef={ref}>
      <CardTitle right={<span className="text-gray-400" style={{ fontSize: "10px" }}>Verified by auto(LABELS)</span>}>
        Vehicle Passport Verification
      </CardTitle>

      <DataState state={verification.state} title="Verification">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-gray-200 py-2.5 text-center">
            <p className="text-2xl font-bold text-green-600 leading-none">{verification.verifiedCount}</p>
            <p className="text-gray-500 mt-1 font-medium" style={{ fontSize: "10px" }}>Verified<br />Data Sources</p>
          </div>
          <div className="rounded-lg border border-gray-200 py-2.5 text-center">
            <p className="text-2xl font-bold text-amber-500 leading-none">{verification.pendingCount}</p>
            <p className="text-gray-500 mt-1 font-medium" style={{ fontSize: "10px" }}>Pending<br />External Docs</p>
          </div>
        </div>

        <ul className="mt-3 divide-y divide-gray-100">
          {verification.items.map((it: any) => {
            const s = STATUS[it.status];
            const { Icon } = s;
            return (
              <li key={it.label} className="flex items-start justify-between gap-3 py-2">
                <div className="flex items-start gap-2 min-w-0">
                  <Icon size={15} className={`${s.dot} mt-px shrink-0`} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{it.label}</p>
                    {(it.source || it.checked) && (
                      <p className="text-gray-400 truncate" style={{ fontSize: "10px" }}>
                        {[it.source, it.checked && `checked ${it.checked}`].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                </div>
                <StatusPill status={it.status} className="shrink-0 mt-px" />
              </li>
            );
          })}
        </ul>

        <div className="pt-3">
          <LinkRow onClick={() => onDetail("verification_interaction", "Verification")}>See Full Vehicle History</LinkRow>
        </div>
      </DataState>
    </Card>
  );
}

function MarketSection({ market, onDetail }: { market: any; onDetail: DetailHandler }) {
  const ref = useSectionView("market_intelligence_view", "Market Intelligence");
  return (
    <Card className="p-4" innerRef={ref}>
      <CardTitle right={
        <span className="inline-flex items-center gap-1 text-gray-400" style={{ fontSize: "10px" }}>
          <RefreshCw size={10} aria-hidden="true" /> Updated {market.updated}
        </span>
      }>
        Market Intelligence
      </CardTitle>

      <DataState state={market.state} title="Market data">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { v: market.similar, l: "Similar Vehicles" },
            { v: money(market.belowMarket), l: "Below Market" },
            { v: market.daysOnMarket, l: "Days on Market" },
          ].map((m) => (
            <div key={m.l}>
              <p className="text-xl font-bold text-gray-900 leading-none">{m.v}</p>
              <p className="text-gray-500 mt-1" style={{ fontSize: "10px" }}>{m.l}</p>
            </div>
          ))}
        </div>

        <div className="mt-3">
          <div className="relative h-2 rounded-full"
            style={{ background: "linear-gradient(90deg,#2563eb 0%,#16a34a 32%,#facc15 66%,#dc2626 100%)" }}
            role="img"
            aria-label={`Market position: priced ${money(market.belowMarket)} below comparable market listings`}>
            <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 border-gray-900"
              style={{ left: `${Math.min(Math.max(market.position, 0), 1) * 100}%` }} />
          </div>
          <div className="flex justify-between mt-1 text-gray-500" style={{ fontSize: "10px" }}>
            <span>Great Price</span><span>Fair Price</span><span>Overpriced</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 mt-3">
          <LinkRow onClick={() => onDetail("market_intelligence_interaction", "Market Intelligence")}>View market details</LinkRow>
          <span className="inline-flex items-center gap-1 text-amber-600 font-medium" style={{ fontSize: "10px" }}>
            <AlertTriangle size={11} aria-hidden="true" />{market.note}
          </span>
        </div>
      </DataState>
    </Card>
  );
}

function ReasonsSection({ reasons, onDetail }: { reasons: any; onDetail: DetailHandler }) {
  return (
    <Card className="p-4">
      <CardTitle>Why This Vehicle Checks Out</CardTitle>
      <DataState state={reasons.state}>
        <ul className="space-y-1.5">
          {reasons.items.map((r: any) => (
            <li key={r} className="flex items-start gap-2">
              <CheckCircle2 size={14} className="text-green-600 mt-0.5 shrink-0" aria-hidden="true" />
              <span className="text-xs text-gray-700 leading-snug">{r}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-2 mt-3">
          <LinkRow onClick={() => onDetail("verification_interaction", "Supporting details")}>See supporting details</LinkRow>
          <LinkRow onClick={() => onDetail("verification_interaction", "Rating methodology")}>How We Rate Vehicles</LinkRow>
        </div>
      </DataState>
    </Card>
  );
}

function ConfirmSection({ confirm, onDetail }: { confirm: any; onDetail: DetailHandler }) {
  return (
    <Card className="p-4">
      <CardTitle>Confirm Before Purchase</CardTitle>
      <p className="text-gray-500 mb-2 leading-relaxed" style={{ fontSize: "10px" }}>{confirm.note}</p>
      <ul className="space-y-2">
        {confirm.items.map((c: any) => (
          <li key={c.label}>
            <LinkRow href={c.href} onClick={() => onDetail("documents_interaction", "Confirm Before Purchase")}>
              {c.label}{c.external && <ExternalLink size={11} aria-hidden="true" />}
            </LinkRow>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TimelineSection({ timeline, onDetail }: { timeline: any; onDetail: DetailHandler }) {
  const ref = useSectionView("ownership_timeline_view", "Ownership Timeline");
  return (
    <Card className="p-4" innerRef={ref}>
      <CardTitle>Ownership Timeline</CardTitle>
      <DataState state={timeline.state} title="Ownership history">
        <ol className="space-y-3">
          {timeline.events.map((e: any, idx: number) => {
            const s = STATUS[e.status];
            return (
              <li key={idx} className="flex items-start gap-3">
                <span className="relative flex flex-col items-center shrink-0" style={{ width: "10px" }}>
                  <span className={`w-2.5 h-2.5 rounded-full ${s.dot.replace("text-", "bg-")}`} />
                  {idx < timeline.events.length - 1 && <span className="w-px flex-1 bg-gray-200 mt-1" style={{ minHeight: "18px" }} />}
                </span>
                <div className="flex-1 min-w-0 -mt-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs text-gray-800">
                      {e.year && <span className="font-bold text-gray-900 mr-2">{e.year}</span>}
                      {e.label}
                    </p>
                    <StatusPill status={e.status} className="shrink-0" />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="mt-3">
          <LinkRow onClick={() => onDetail("ownership_timeline_interaction", "Ownership Timeline")}>View full timeline</LinkRow>
        </div>
      </DataState>
    </Card>
  );
}

function WindowStickerSection({ sticker, onDetail }: { sticker: any; onDetail: DetailHandler }) {
  const ref = useSectionView("window_sticker_view", "Window Sticker");
  return (
    <Card className="p-4" innerRef={ref}>
      <DataState state={sticker.state} title="Window sticker">
        <div className="flex gap-3">
          <div className="w-24 shrink-0">
            <SafeImage src={sticker.previewImage} alt="Window sticker preview" ratio="130%" rounded="rounded-md" className="border border-gray-200" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-gray-900 leading-tight">Original Factory Window Sticker</h2>
            {sticker.vinSpecific && (
              <p className="text-xs text-gray-600 mt-1 leading-snug">VIN-specific manufacturer document</p>
            )}
            <button
              onClick={() => onDetail("window_sticker_interaction", "Window Sticker")}
              className="mt-3 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs py-2.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              View Window Sticker
            </button>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-gray-100">
          <LinkRow onClick={() => onDetail("documents_interaction", "All Documents")}>All Documents &amp; Sources</LinkRow>
        </div>
      </DataState>
    </Card>
  );
}

/* LOCKED (§15): Bumper-to-Bumper = BLUE, Powertrain = GREEN */
function WarrantySection({ warranty, onDetail }: { warranty: any; onDetail: DetailHandler }) {
  const ref = useSectionView("warranty_view", "Factory Warranty");
  return (
    <Card className="p-4" innerRef={ref}>
      <CardTitle>Factory Warranty</CardTitle>
      <DataState state={warranty.state} title="Warranty coverage">
        <div className="space-y-4">
          {warranty.coverages.map((c: any) => (
            <div key={c.key}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-semibold text-gray-900">{c.name}</p>
                <p className="text-xs font-semibold text-gray-700">{c.pct}%</p>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-gray-200 overflow-hidden"
                role="progressbar" aria-valuenow={c.pct} aria-valuemin={0} aria-valuemax={100}
                aria-label={`${c.name}: ${c.pct}% ${warranty.estimated ? "estimated " : ""}remaining`}>
                <div className={`h-full rounded-full ${c.color}`} style={{ width: `${c.pct}%` }} />
              </div>
              <div className="flex items-center justify-between gap-2 mt-1">
                <p className="text-gray-500" style={{ fontSize: "10px" }}>{c.terms}</p>
                <p className="text-gray-500" style={{ fontSize: "10px" }}>{c.remaining}</p>
              </div>
              {warranty.estimated && (
                <StatusPill status="ESTIMATED" label={`${c.pct}% estimated remaining`} className="mt-1" />
              )}
            </div>
          ))}
        </div>
        <p className="text-gray-400 mt-3 leading-relaxed" style={{ fontSize: "10px" }}>
          Remaining coverage is calculated from in-service date, current date and current mileage against published
          manufacturer limits. auto(LABELS) is not the warranty administrator or manufacturer. Confirm coverage with the dealership.
        </p>
        <div className="mt-2">
          <LinkRow onClick={() => onDetail("warranty_interaction", "Factory Warranty")}>View warranty details</LinkRow>
        </div>
      </DataState>
    </Card>
  );
}

function SpecsSection({ vehicle, onDetail }: { vehicle: any; onDetail: DetailHandler }) {
  return (
    <Card className="p-4">
      <CardTitle>About This Vehicle</CardTitle>
      <dl className="grid grid-cols-3 gap-y-3 gap-x-2">
        {vehicle.specs.map((s: any) => (
          <div key={s.label} className="min-w-0">
            <dd className="text-xs font-semibold text-gray-900 leading-tight truncate">{s.value}</dd>
            <dt className="text-gray-500 mt-0.5" style={{ fontSize: "10px" }}>{s.label}</dt>
          </div>
        ))}
      </dl>
      <div className="grid grid-cols-2 gap-2 mt-4">
        <button onClick={() => onDetail("vehicle_specs_interaction", "Features & packages")}
          className="flex items-center justify-center gap-1 border border-gray-200 rounded-lg py-2 text-xs font-medium text-gray-700 hover:bg-gray-50">
          <Tag size={13} className="text-blue-600" aria-hidden="true" /> All features &amp; packages
        </button>
        <button onClick={() => onDetail("vehicle_specs_interaction", "Full specifications")}
          className="flex items-center justify-center gap-1 border border-gray-200 rounded-lg py-2 text-xs font-medium text-gray-700 hover:bg-gray-50">
          <FileText size={13} className="text-blue-600" aria-hidden="true" /> Full specifications
        </button>
      </div>
    </Card>
  );
}

function OverviewSection({ vehicle, onDetail }: { vehicle: any; onDetail: DetailHandler }) {
  return (
    <Card className="p-4">
      <CardTitle>Vehicle Overview</CardTitle>
      <p className="text-xs text-gray-700 leading-relaxed">{vehicle.overview}</p>
      <div className="mt-2">
        <LinkRow onClick={() => onDetail("vehicle_specs_interaction", "Vehicle Overview")}>Read more overview</LinkRow>
      </div>
    </Card>
  );
}

function PhotosSection({ vehicle, onDetail }: { vehicle: any; onDetail: DetailHandler }) {
  const count = Math.min(vehicle.photos.length || 4, 4);
  return (
    <Card className="p-4">
      <CardTitle>Photos</CardTitle>
      <div className="grid grid-cols-4 gap-1.5">
        {Array.from({ length: count }).map((_, n) => (
          <button key={n} onClick={() => onDetail("photos_interaction", "Photos")} aria-label={`View photo ${n + 1}`}>
            <SafeImage src={vehicle.photos[n]} alt={`Photo ${n + 1}`} ratio="75%" rounded="rounded-md" />
          </button>
        ))}
      </div>
      <div className="mt-3">
        <LinkRow onClick={() => onDetail("photos_interaction", "Photos")}>View all photos ({vehicle.photoCount})</LinkRow>
      </div>
    </Card>
  );
}

/* LOCKED (§19/§20): photo-based dealer module, fully dealer-configurable */
function DealerSection({ dealer }: { dealer: any }) {
  const { track } = useAnalytics();
  const ref = useSectionView("dealer_section_view", "Dealer");
  return (
    <Card className="overflow-hidden" innerRef={ref}>
      <div className="relative">
        <SafeImage src={dealer.dealer_hero_image} alt={`${dealer.dealer_name} dealership`} ratio="58%" rounded="rounded-none" />
        <div className="absolute inset-0 bg-black bg-opacity-55" aria-hidden="true" />
        <div className="absolute inset-0 flex flex-col justify-end p-4">
          <h2 className="text-white text-base font-bold leading-tight">{dealer.dealer_headline}</h2>
          <p className="text-gray-200 text-xs mt-0.5">{dealer.dealer_subheadline}</p>
          <div className="flex items-center gap-3 mt-2 text-gray-100" style={{ fontSize: "10px" }}>
            <span>Serving drivers since {dealer.founded_year}</span>
            <span className="opacity-50">•</span>
            <span>{dealer.years_in_business} years in business</span>
          </div>
        </div>
      </div>

      <div className="p-4">
        <ul className="grid grid-cols-2 gap-y-2 gap-x-3">
          {dealer.proof_points.map((p: any) => (
            <li key={p} className="flex items-start gap-1.5">
              <CheckCircle2 size={13} className="text-green-600 mt-0.5 shrink-0" aria-hidden="true" />
              <span className="text-gray-700 leading-snug" style={{ fontSize: "11px" }}>{p}</span>
            </li>
          ))}
        </ul>

        {dealer.recognitions?.length > 0 && (
          <ul className="mt-4 pt-3 border-t border-gray-100 space-y-2.5">
            {dealer.recognitions.map((r: any) => (
              <li key={r.name} className="flex items-start gap-2">
                <Star size={14} className="text-amber-500 mt-0.5 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-900 leading-tight">{r.name}</p>
                  <p className="text-gray-400" style={{ fontSize: "10px" }}>{r.disclosure}</p>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4">
          <LinkRow href={dealer.learn_more_url}
            onClick={() => track("dealer_learn_more_click", { section: "Dealer" }, { once: false })}>
            Learn more about {dealer.dealer_name}
          </LinkRow>
        </div>
      </div>
    </Card>
  );
}

function NextSteps({ onAct }: { onAct: ActHandler }) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-bold text-gray-900 mb-3">Ready to Move Forward?</h2>
      <PrimaryActions onAct={onAct} location="next_steps" />
      <div className="grid grid-cols-2 gap-2 mt-2">
        <button onClick={() => onAct("contact", { location: "next_steps" })}
          className="flex items-center justify-center gap-1.5 border border-gray-200 rounded-lg py-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
          <MessageSquare size={13} className="text-blue-600" aria-hidden="true" /> Contact Dealer
        </button>
        <button onClick={() => onAct("trade", { location: "next_steps" })}
          className="flex items-center justify-center gap-1.5 border border-gray-200 rounded-lg py-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
          <DollarSign size={13} className="text-blue-600" aria-hidden="true" /> Value My Trade
        </button>
      </div>
    </Card>
  );
}

function StickyNav({ dealer, price, onAct }: { dealer: any; price: any; onAct: ActHandler }) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200"
      style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
      aria-label="Vehicle actions">
      <div className="grid grid-cols-4 gap-1 px-2 pt-2 max-w-lg mx-auto">
        <a href={`tel:${dealer.phone}`} onClick={() => onAct("contact", { location: "sticky_nav", channel: "call" })}
          className="flex flex-col items-center gap-0.5 py-1 text-gray-700">
          <Phone size={16} className="text-blue-600" aria-hidden="true" />
          <span style={{ fontSize: "10px" }}>Call Us</span>
        </a>
        <a href={`sms:${dealer.sms}`} onClick={() => onAct("contact", { location: "sticky_nav", channel: "text" })}
          className="flex flex-col items-center gap-0.5 py-1 text-gray-700">
          <MessageSquare size={16} className="text-blue-600" aria-hidden="true" />
          <span style={{ fontSize: "10px" }}>Text Us</span>
        </a>
        <button onClick={() => onAct("test_drive", { location: "sticky_nav" })}
          className="flex flex-col items-center gap-0.5 py-1 text-gray-700">
          <Car size={16} className="text-blue-600" aria-hidden="true" />
          <span style={{ fontSize: "10px" }}>Test Drive</span>
        </button>
        <button onClick={() => onAct("payment", { location: "sticky_nav" })}
          className="flex flex-col items-center justify-center rounded-md bg-blue-600 text-white py-1 px-1">
          <TrendingUp size={14} aria-hidden="true" />
          <span className="font-semibold" style={{ fontSize: "10px" }}>{money(price.current)}</span>
        </button>
      </div>
    </nav>
  );
}

/* ==========================================================================
   6. ROOT
   ========================================================================== */

export default function PassportNextLayout({
  data = DEFAULT_DATA,
  dealer = DEFAULT_DEALER,
  onEvent,
  onAction,
}: {
  data?: any;
  dealer?: any;
  onEvent?: (name: string, payload: any) => void;
  onAction?: (intent: string, payload: any) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const engine = useAnalyticsEngine({ vehicle: data.vehicle, dealerId: dealer.dealer_id, onEvent, onAction });

  return (
    <AnalyticsCtx.Provider value={engine}>
      <PassportBody rootRef={rootRef} data={data} dealer={dealer} />
    </AnalyticsCtx.Provider>
  );
}

function PassportBody({ rootRef, data, dealer }: { rootRef: React.RefObject<HTMLDivElement>; data: any; dealer: any }) {
  const { track, act } = useAnalytics();
  useScrollDepth(rootRef);

  useEffect(() => { track("passport_view"); }, [track]);

  const detail: DetailHandler = (event, section) => track(event, { section }, { once: false });
  const quick = (key: string, label: string) => {
    if (["trade", "contact", "payment"].includes(key)) return act(key, { location: "quick_actions", quick_action: label });
    track(`${key}_interaction`, { section: "Quick actions", quick_action: label }, { once: false });
  };

  const { vehicle } = data;

  return (
    <div ref={rootRef} className="min-h-screen bg-gray-50 mx-auto" style={{ maxWidth: "430px" }}>
      <Header />

      <main className="pb-24">
        <Gallery vehicle={vehicle} />
        <Identity vehicle={vehicle} badges={data.trustBadges} />

        <div className="px-3 pb-4 space-y-3">
          <PriceSection price={data.price} />
          <PaymentSection payment={data.payment} onBuild={() => act("payment", { location: "payment_card" })} />
          <PrimaryActions onAct={act} location="above_fold" />
          <QuickActions onQuick={quick} />
          <VerificationSection verification={data.verification} onDetail={detail} />
          <MarketSection market={data.market} onDetail={detail} />
          <ReasonsSection reasons={data.reasons} onDetail={detail} />
          <ConfirmSection confirm={data.confirm} onDetail={detail} />
          <TimelineSection timeline={data.timeline} onDetail={detail} />
          <WindowStickerSection sticker={data.windowSticker} onDetail={detail} />
          <WarrantySection warranty={data.warranty} onDetail={detail} />
          <SpecsSection vehicle={vehicle} onDetail={detail} />
          <OverviewSection vehicle={vehicle} onDetail={detail} />
          <PhotosSection vehicle={vehicle} onDetail={detail} />
          <DealerSection dealer={dealer} />
          <NextSteps onAct={act} />

          <footer className="text-center py-4">
            <p className="text-gray-400" style={{ fontSize: "10px" }}>
              Secured &amp; Private · No Obligation
            </p>
            <p className="text-gray-400 mt-0.5" style={{ fontSize: "10px" }}>
              Powered by auto<span className="font-semibold">(LABELS)</span> ·{" "}
              <a href="#privacy" className="underline">Privacy</a>
            </p>
            <p className="text-gray-400 mt-1 px-4 leading-relaxed" style={{ fontSize: "9px" }}>
              VIN {vehicle.vin} · Stock {vehicle.stock}. Verification reflects information returned by third-party
              sources at the time shown. Items marked Pending or Not available have not been confirmed.
            </p>
          </footer>
        </div>
      </main>

      <StickyNav dealer={dealer} price={data.price} onAct={act} />
    </div>
  );
}
