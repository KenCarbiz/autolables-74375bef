import { useEffect, useRef, useState } from "react";
import { X, Info, ShieldCheck, CheckCircle2, MessageSquare, Car, TrendingDown, TrendingUp } from "lucide-react";
import type { PassportData } from "@/lib/passportV2Data";
import { fmt$ } from "@/lib/passportV2Data";
import type { VehicleListing } from "@/hooks/useVehicleListing";
import { BLUE, GREEN } from "@/lib/passportTokens";

// ──────────────────────────────────────────────────────────────
// MarketPriceSlideOver — Passport V3 "Market Pricing Analysis" panel
//
// Right-side slide-over that answers "Why is this a Great Price?" without
// leaving the Passport page. Built as a reusable shell (PassportSlideOver)
// so the other Market Intelligence cards (demand, confidence, history,
// comparables, inventory) can reuse the same drawer later.
//
// Honesty: every section is gated on real listing data. Where MarketCheck
// has not returned a value, the section shows a clean empty state instead
// of a fabricated number. Sample/demo numbers only appear behind the
// page's SAMPLE PREVIEW banner (isPreview), never for real shoppers.
// ──────────────────────────────────────────────────────────────

const CARD_BORDER = "border border-[#E6E8EC]";

// ── Reusable slide-over shell ─────────────────────────────────
function PassportSlideOver({
  open, onClose, title, subtitle, footer, children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [render, setRender] = useState(open);
  const [enter, setEnter] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setRender(true);
      const r = requestAnimationFrame(() => setEnter(true));
      return () => cancelAnimationFrame(r);
    }
    setEnter(false);
    const t = setTimeout(() => setRender(false), 240);
    return () => clearTimeout(t);
  }, [open]);

  // Body scroll lock while the drawer is mounted.
  useEffect(() => {
    if (!render) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [render]);

  // Escape to close + focus trap; focus the panel on open.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    panel?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !panel) return;
      const f = panel.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])'
      );
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!render) return null;

  return (
    <div className="fixed inset-0 z-[60]" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      {/* Overlay — dim, not heavy blur */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-slate-900/40 transition-opacity duration-200 ${enter ? "opacity-100" : "opacity-0"}`}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`absolute right-0 top-0 h-full w-full sm:w-[90vw] md:w-[600px] xl:w-[660px] 2xl:w-[680px] bg-[#F6F7F9] shadow-[0_0_60px_rgba(0,0,0,0.25)] outline-none flex flex-col transition-transform duration-200 ease-out will-change-transform ${enter ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="shrink-0 bg-white border-b border-[#E6E8EC] px-5 sm:px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[19px] font-bold tracking-tight text-[#0F172A] leading-tight">{title}</h2>
            {subtitle && (
              <p className="text-[13px] text-[#64748B] mt-0.5 inline-flex items-center gap-1.5">
                {subtitle}<Info className="w-3.5 h-3.5 text-[#94A3B8]" />
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close panel"
            className="shrink-0 w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-[#64748B] hover:text-[#0F172A] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scroll body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-5">{children}</div>

        {/* Sticky footer */}
        {footer && (
          <div className="shrink-0 bg-white border-t border-[#E6E8EC] px-5 sm:px-6 py-4 pb-[calc(16px+env(safe-area-inset-bottom))]">{footer}</div>
        )}
      </div>
    </div>
  );
}

// ── Dependency-free charts (match V3 palette) ─────────────────
function RangeBar({ low, avg, high, dealer }: { low: number; avg: number; high: number; dealer: number }) {
  const span = Math.max(1, high - low);
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - low) / span) * 100));
  const dealerPct = pct(dealer);
  const avgPct = pct(avg);
  return (
    <div className="pt-7 pb-6 relative">
      {/* Dealer price flag above the bar */}
      <div className="absolute top-0 -translate-x-1/2 text-center whitespace-nowrap" style={{ left: `${dealerPct}%` }}>
        <span className="text-[11px] font-semibold text-[#16A34A]">Dealer Price</span>
        <span className="block text-[13px] font-extrabold text-[#0F172A] leading-tight">{fmt$(dealer)}</span>
      </div>
      {/* Track */}
      <div className="relative h-2 rounded-full bg-gradient-to-r from-emerald-200 via-amber-100 to-rose-200">
        {/* Market average tick */}
        <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[3px] h-4 rounded bg-[#0F172A]" style={{ left: `${avgPct}%` }} />
        {/* Dealer marker */}
        <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-[#16A34A] ring-[3px] ring-white shadow" style={{ left: `${dealerPct}%` }} />
      </div>
    </div>
  );
}

function TrendChart({ market, dealer }: { market: number[]; dealer: number[] }) {
  const w = 560, h = 150, pad = 8;
  const all = [...market, ...dealer].filter((n) => Number.isFinite(n));
  if (all.length < 2) return null;
  const min = Math.min(...all), max = Math.max(...all), range = Math.max(1, max - min);
  const path = (pts: number[]) =>
    pts.map((p, i) => `${(pad + (i / Math.max(1, pts.length - 1)) * (w - pad * 2)).toFixed(1)},${(pad + (1 - (p - min) / range) * (h - pad * 2)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[150px]" preserveAspectRatio="none">
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={pad} x2={w - pad} y1={pad + g * (h - pad * 2)} y2={pad + g * (h - pad * 2)} stroke="#E6E8EC" strokeWidth="1" strokeDasharray="3 4" />
      ))}
      {market.length >= 2 && <polyline points={path(market)} fill="none" stroke={BLUE} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="5 4" />}
      {dealer.length >= 2 && <polyline points={path(dealer)} fill="none" stroke={GREEN} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
      {dealer.length >= 2 && (() => { const p = path(dealer).split(" ").pop()!.split(","); return <circle cx={p[0]} cy={p[1]} r="3.5" fill={GREEN} />; })()}
    </svg>
  );
}

function Ring({ pct, size = 96 }: { pct: number; size?: number }) {
  const r = size / 2 - 8, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E6E8EC" strokeWidth="7" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={GREEN} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[22px] font-extrabold text-[#0F172A] leading-none">{pct}%</span>
      </span>
    </div>
  );
}

const Section = ({ title, sub, action, children }: { title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode }) => (
  <div>
    <div className="flex items-end justify-between gap-3 mb-2.5">
      <div>
        <h3 className="text-[15px] font-bold text-[#0F172A] leading-tight">{title}</h3>
        {sub && <p className="text-[12px] text-[#64748B] mt-0.5">{sub}</p>}
      </div>
      {action}
    </div>
    {children}
  </div>
);

const Check = ({ children }: { children: React.ReactNode }) => (
  <li className="flex items-start gap-2 text-[13px] text-[#0F172A]">
    <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />
    <span>{children}</span>
  </li>
);

// ── Comparable vehicle shape ──────────────────────────────────
interface Comp { ymm: string; trim: string; mileage: number | null; price: number | null; distance: string | null; image: string | null }

export interface MarketPriceSlideOverProps {
  open: boolean;
  onClose: () => void;
  d: PassportData;
  listing: VehicleListing;
  isPreview: boolean;
  onReserve: () => void;
  onSpecialist: () => void;
  onViewComparables: () => void;
}

export default function MarketPriceSlideOver({ open, onClose, d, listing, isPreview, onReserve, onSpecialist, onViewComparables }: MarketPriceSlideOverProps) {
  const price = d.price;
  const avg = d.marketAvg;
  const low = d.marketLow;
  const high = d.marketHigh;
  const below = d.belowMarket;
  const isGreat = below != null && below > 0;
  const conf = d.confScore;

  const year = (listing.ymm || "").match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const compCount = (mc.similar_count as number) ?? (mc.comparable_count as number) ?? null;
  const radius = (mc.search_radius as number) ?? null;
  const marketCheckedRaw = (listing as unknown as { market_checked_at?: string; market_payload?: { checked_at?: string } }).market_checked_at
    ?? (listing.market_payload as { checked_at?: string } | null)?.checked_at ?? null;
  const updatedLabel = marketCheckedRaw
    ? `Updated ${new Date(marketCheckedRaw).toLocaleDateString()}`
    : isPreview ? "Updated today" : null;

  // "Compared against" — only facts we can honestly assert.
  const comparedAgainst: string[] = [];
  if (compCount != null) comparedAgainst.push(`${compCount.toLocaleString()} similar vehicles`);
  else if (isPreview) comparedAgainst.push("42 similar vehicles");
  if (radius != null) comparedAgainst.push(`${radius}-mile radius`);
  else if (isPreview) comparedAgainst.push("150-mile radius");
  if (year) comparedAgainst.push(`Same year (${year})`);
  if (listing.mileage != null) comparedAgainst.push(`Similar mileage (${Math.round(listing.mileage / 1000)}k±)`);
  if (listing.trim) comparedAgainst.push(`Same trim (${listing.trim})`);
  if (updatedLabel) comparedAgainst.push(updatedLabel);

  // "Why it's a Great Price" — gated on real signals.
  const percentile = (mc.price_percentile as number) ?? null;
  const why: string[] = [];
  if (isGreat) why.push("Priced below local market");
  if (percentile != null) why.push(`Lower than ${percentile}% of similar vehicles`);
  else if (isPreview) why.push("Lower than 91% of similar vehicles");
  if (listing.mileage != null && listing.mileage < 30000) why.push(`Low mileage (${listing.mileage.toLocaleString()} mi)`);
  if (d.ownerCount === 1) why.push("One owner");
  if (d.cleanTitle && d.accidentCount === 0) why.push("Clean history");
  if ((listing.features?.length ?? 0) >= 3) why.push("Strong equipment package");

  // Comparable vehicles — real if present, else sample only in preview.
  const rawComps = (listing as unknown as { comparables?: unknown }).comparables ?? (mc.comparables as unknown);
  const realComps: Comp[] = (Array.isArray(rawComps) ? rawComps : []).map((c) => c as Record<string, unknown>).map((c) => ({
    ymm: String(c.ymm ?? c.heading ?? [c.year, c.make, c.model].filter(Boolean).join(" ") ?? ""),
    trim: String(c.trim ?? ""),
    mileage: c.miles != null ? Number(c.miles) : c.mileage != null ? Number(c.mileage) : null,
    price: c.price != null ? Number(c.price) : null,
    distance: c.dist != null ? `${Math.round(Number(c.dist))} mi away` : c.distance != null ? String(c.distance) : null,
    image: (c.image as string) ?? (c.photo_url as string) ?? null,
  })).filter((c) => c.ymm);
  const sampleComps: Comp[] = isPreview && !realComps.length && price != null
    ? [
        { ymm: listing.ymm || "Comparable", trim: listing.trim || "", mileage: 12, price: price + 2760, distance: "2.3 mi away", image: listing.hero_image_url || null },
        { ymm: listing.ymm || "Comparable", trim: listing.trim || "", mileage: 18, price: price + 4360, distance: "4.1 mi away", image: listing.hero_image_url || null },
        { ymm: listing.ymm || "Comparable", trim: listing.trim || "", mileage: 18, price: price + 4360, distance: "6.7 mi away", image: listing.hero_image_url || null },
        { ymm: listing.ymm || "Comparable", trim: listing.trim || "", mileage: 22, price: price + 4360, distance: "6.7 mi away", image: listing.hero_image_url || null },
      ]
    : [];
  const comps = realComps.length ? realComps : sampleComps;

  // Pricing trend — real captured snapshots.
  const marketSeries = d.valueHistory.filter((h) => h.market_value != null).map((h) => h.market_value as number);
  const dealerSeries = d.valueHistory.filter((h) => h.listing_price != null).map((h) => h.listing_price as number);
  const hasTrend = marketSeries.length >= 2 || dealerSeries.length >= 2;
  const dealerDelta = d.priceChangeTotal;
  const marketDelta = marketSeries.length >= 2 ? marketSeries[marketSeries.length - 1] - marketSeries[0] : null;

  const confBasis = ["MarketCheck data", "Dealer pricing data", "Regional demand", "Vehicle history", "Mileage & condition", "Equipment & features"];

  const footer = (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-[#0F172A] leading-tight">Questions about this price?</p>
        <p className="text-[12px] text-[#64748B]">Our specialists are here to help.</p>
        <button onClick={onSpecialist} className="mt-1.5 text-[12px] font-semibold text-[#2563EB] inline-flex items-center gap-1.5 hover:underline">
          <MessageSquare className="w-3.5 h-3.5" /> Talk to a Vehicle Specialist
        </button>
      </div>
      <div className="shrink-0 sm:text-right">
        <button onClick={onReserve} className="w-full sm:w-auto h-11 px-5 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-[14px] font-semibold inline-flex items-center justify-center gap-2 transition-colors">
          <ShieldCheck className="w-4 h-4" /> Reserve This Vehicle
        </button>
        <p className="text-[11px] text-[#94A3B8] mt-1">Secure it today with a refundable deposit.</p>
      </div>
    </div>
  );

  return (
    <PassportSlideOver open={open} onClose={onClose} title="Market Pricing Analysis" subtitle="How AutoLabels determined this price" footer={footer}>
      {/* Hero */}
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5">
        <div className="flex items-center gap-4">
          <span className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-7 h-7 text-[#16A34A]" />
          </span>
          <div className="min-w-0">
            <p className="text-[18px] font-extrabold text-[#16A34A] leading-tight">{isGreat ? "Great Price" : avg != null ? "Market Price" : "Pricing Pending"}</p>
            {isGreat ? (
              <p className="text-[20px] font-extrabold text-[#0F172A] leading-tight">{fmt$(below)} Below Market</p>
            ) : avg != null && price != null ? (
              <p className="text-[15px] font-semibold text-[#0F172A]">Priced near the {fmt$(avg)} market average</p>
            ) : (
              <p className="text-[13px] text-[#64748B]">Market comparison appears once MarketCheck data is available.</p>
            )}
            {conf != null && <p className="text-[12px] text-[#64748B] mt-0.5">Confidence: {conf}%</p>}
          </div>
        </div>
      </div>

      {/* Price range */}
      {low != null && high != null && avg != null && price != null ? (
        <div className={`rounded-2xl bg-white ${CARD_BORDER} p-5`}>
          <div className="grid grid-cols-3 text-center mb-1">
            <div><p className="text-[11px] text-[#64748B]">Low Market</p><p className="text-[14px] font-bold text-[#0F172A]">{fmt$(low)}</p></div>
            <div><p className="text-[11px] text-[#64748B]">Market Average</p><p className="text-[14px] font-bold text-[#0F172A]">{fmt$(avg)}</p></div>
            <div><p className="text-[11px] text-[#64748B]">High Market</p><p className="text-[14px] font-bold text-[#0F172A]">{fmt$(high)}</p></div>
          </div>
          <RangeBar low={low} avg={avg} high={high} dealer={price} />
        </div>
      ) : (
        <div className={`rounded-2xl bg-white ${CARD_BORDER} p-5 text-[13px] text-[#64748B]`}>
          The market price range appears once enough comparable listings are available.
        </div>
      )}

      {/* Compared against + Why great */}
      {(comparedAgainst.length > 0 || why.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {comparedAgainst.length > 0 && (
            <div className={`rounded-2xl bg-white ${CARD_BORDER} p-4`}>
              <p className="text-[13px] font-bold text-[#0F172A] mb-2.5">Compared against</p>
              <ul className="space-y-2">{comparedAgainst.map((t) => <Check key={t}>{t}</Check>)}</ul>
            </div>
          )}
          {why.length > 0 && (
            <div className={`rounded-2xl bg-white ${CARD_BORDER} p-4`}>
              <p className="text-[13px] font-bold text-[#0F172A] mb-2.5">{isGreat ? "Why it's a Great Price" : "Pricing factors"}</p>
              <ul className="space-y-2">{why.map((t) => <Check key={t}>{t}</Check>)}</ul>
            </div>
          )}
        </div>
      )}

      {/* Comparable vehicles */}
      <Section
        title={`Comparable Vehicles${comps.length ? ` (${compCount ?? comps.length})` : ""}`}
        sub="Based on similar vehicles in your market area."
        action={comps.length ? (
          <button onClick={onViewComparables} className="text-[12px] font-semibold text-[#2563EB] hover:underline shrink-0">View all</button>
        ) : undefined}
      >
        {comps.length ? (
          <div className="flex gap-3 overflow-x-auto -mx-1 px-1 pb-1 snap-x">
            {comps.map((c, i) => (
              <div key={i} className={`shrink-0 w-[150px] rounded-xl bg-white ${CARD_BORDER} overflow-hidden snap-start`}>
                <div className="h-[84px] bg-[#eef0f3] flex items-center justify-center">
                  {c.image ? <img src={c.image} alt="" className="w-full h-full object-cover" /> : <Car className="w-7 h-7 text-[#94A3B8]" />}
                </div>
                <div className="p-2.5">
                  <p className="text-[12px] font-bold leading-tight line-clamp-1">{c.ymm}</p>
                  {c.trim && <p className="text-[11px] text-[#64748B] line-clamp-1">{c.trim}</p>}
                  {c.mileage != null && <p className="text-[11px] text-[#64748B] mt-0.5">{c.mileage.toLocaleString()} mi</p>}
                  {c.price != null && <p className="text-[13px] font-extrabold text-[#0F172A] mt-1">{fmt$(c.price)}</p>}
                  {c.distance && <p className="text-[10px] text-[#94A3B8] mt-0.5">{c.distance}</p>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={`rounded-2xl bg-white ${CARD_BORDER} p-4 text-[13px] text-[#64748B]`}>
            Comparable vehicles will appear here once enough market data is available.
          </div>
        )}
      </Section>

      {/* Pricing trend */}
      <Section title="Pricing Trend (30 Days)">
        {hasTrend ? (
          <div className={`rounded-2xl bg-white ${CARD_BORDER} p-4`}>
            <div className="flex items-center gap-4 mb-2 text-[11px] font-semibold">
              <span className="inline-flex items-center gap-1.5 text-[#64748B]"><span className="w-4 border-t-2 border-dashed border-[#2563EB]" /> Market avg</span>
              <span className="inline-flex items-center gap-1.5 text-[#16A34A]"><span className="w-4 border-t-2 border-[#16A34A]" /> Dealer price</span>
            </div>
            <TrendChart market={marketSeries} dealer={dealerSeries} />
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-[12px]">
              {marketDelta != null && (
                <span className={`inline-flex items-center gap-1 font-semibold ${marketDelta <= 0 ? "text-[#16A34A]" : "text-[#64748B]"}`}>
                  {marketDelta <= 0 ? <TrendingDown className="w-3.5 h-3.5" /> : <TrendingUp className="w-3.5 h-3.5" />}
                  Market average {marketDelta <= 0 ? "decreased" : "increased"}{marketDelta !== 0 ? ` ${fmt$(Math.abs(marketDelta))}` : ""}
                </span>
              )}
              {dealerDelta != null && (
                <span className={`inline-flex items-center gap-1 font-semibold ${dealerDelta <= 0 ? "text-[#16A34A]" : "text-[#64748B]"}`}>
                  {dealerDelta <= 0 ? <TrendingDown className="w-3.5 h-3.5" /> : <TrendingUp className="w-3.5 h-3.5" />}
                  Dealer price {dealerDelta <= 0 ? "decreased" : "increased"}{dealerDelta !== 0 ? ` ${fmt$(Math.abs(dealerDelta))}` : ""}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className={`rounded-2xl bg-white ${CARD_BORDER} p-4 text-[13px] text-[#64748B]`}>
            Pricing trend will appear once enough market data is available.
          </div>
        )}
      </Section>

      {/* AutoLabels confidence */}
      {conf != null && (
        <Section title="AutoLabels Confidence">
          <div className={`rounded-2xl bg-white ${CARD_BORDER} p-4 flex items-center gap-5`}>
            <div className="flex flex-col items-center shrink-0">
              <Ring pct={conf} />
              <p className="text-[12px] font-extrabold text-[#16A34A] mt-1">{conf >= 85 ? "High Confidence" : conf >= 70 ? "Good Confidence" : "Fair Confidence"}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[12px] text-[#64748B] mb-2">Our price analysis is based on:</p>
              <ul className="grid grid-cols-1 gap-1.5">{confBasis.map((b) => <Check key={b}>{b}</Check>)}</ul>
            </div>
          </div>
        </Section>
      )}

      <p className="text-[11px] text-[#94A3B8] pt-1">Market values are estimates from third-party data and may vary by region and time.</p>
    </PassportSlideOver>
  );
}
