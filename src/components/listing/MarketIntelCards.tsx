import type { ReactNode } from "react";
import { Gauge, ShieldCheck, BarChart3, Star } from "lucide-react";

// Market Intelligence cards — the three "confidence" tiles on the Vehicle
// Passport: a market-price gauge, a verified-history vehicle score, and a
// price-confidence read. Every tile is computed from real MarketCheck /
// history signals and self-hides when the data isn't there (gone, not greyed).

// deno-lint-ignore no-explicit-any
type Listing = any;

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

function Shell({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-premium p-5 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-[13px] font-bold text-foreground">{title}</h3>
      </div>
      {children}
    </div>
  );
}

// ── Card 1: Market Price Analysis (semicircle gauge) ───────────────
function marketPriceCard(listing: Listing): ReactNode {
  const price = listing.price != null ? Number(listing.price) : null;
  const mv = listing.market_value != null ? Number(listing.market_value) : null;
  const pay = listing.market_payload || {};
  const low = pay.low != null ? Number(pay.low) : null;
  const high = pay.high != null ? Number(pay.high) : null;
  const pos = listing.market_position as string | null;

  if (price == null || (mv == null && (low == null || high == null))) return null;

  const lo = low != null ? low : mv != null ? Math.round(mv * 0.92) : price;
  const hi = high != null ? high : mv != null ? Math.round(mv * 1.08) : price;
  const span = Math.max(1, hi - lo);
  const t = Math.max(0, Math.min(1, (price - lo) / span));
  const angle = -90 + t * 180;
  const below = mv != null ? Math.round(mv - price) : null;

  const verdict =
    pos === "great_deal" ? { label: "Great Price", tone: "text-emerald-600" } :
    pos === "good_deal" ? { label: "Good Price", tone: "text-emerald-600" } :
    pos === "fair_deal" ? { label: "Fair Price", tone: "text-amber-600" } :
    pos === "above_market" ? { label: "Above Market", tone: "text-rose-600" } :
    below != null && below >= 250 ? { label: "Good Price", tone: "text-emerald-600" } :
    { label: "Market Price", tone: "text-slate-700" };

  return (
    <Shell icon={<Gauge className="w-4 h-4 text-blue-600" />} title="Market Price Analysis">
      <div className="relative mx-auto" style={{ width: 168, height: 96 }}>
        <svg viewBox="0 0 168 96" className="w-full h-full">
          <defs>
            <linearGradient id="mpc-arc" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#f43f5e" />
            </linearGradient>
          </defs>
          <path d="M 12 88 A 72 72 0 0 1 156 88" fill="none" stroke="url(#mpc-arc)" strokeWidth="12" strokeLinecap="round" />
          <g transform={`rotate(${angle} 84 88)`}>
            <line x1="84" y1="88" x2="84" y2="26" stroke="#0f172a" strokeWidth="3" strokeLinecap="round" />
          </g>
          <circle cx="84" cy="88" r="6" fill="#0f172a" />
        </svg>
      </div>
      <p className={`text-center text-base font-black font-display tracking-tight mt-1 ${verdict.tone}`}>{verdict.label}</p>
      <p className="text-center text-[11px] text-muted-foreground mt-1">
        {below != null && below >= 250
          ? `${usd(below)} below market average`
          : mv != null
          ? `Market average ${usd(mv)}`
          : `Range ${usd(lo)}–${usd(hi)}`}
      </p>
    </Shell>
  );
}

// ── Card 2: Vehicle Score (verified-history signals) ───────────────
function vehicleScoreCard(listing: Listing): ReactNode {
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const signals: { ok: boolean; weight: number }[] = [];

  if (typeof mc.carfax_clean_title === "boolean") signals.push({ ok: mc.carfax_clean_title === true, weight: 1.4 });
  if (typeof mc.carfax_1_owner === "boolean") signals.push({ ok: mc.carfax_1_owner === true, weight: 1.0 });
  if (listing.recall_status === "clear" || listing.recall_status === "open_recalls")
    signals.push({ ok: listing.recall_status === "clear", weight: 1.0 });
  const sr = (listing.service_records?.length || 0) as number;
  if (sr > 0) signals.push({ ok: true, weight: 0.8 });
  if (listing.condition === "new" || listing.condition === "cpo") signals.push({ ok: true, weight: 0.8 });
  if (listing.warranty_info && Object.keys(listing.warranty_info).length > 0) signals.push({ ok: true, weight: 0.6 });

  if (signals.length < 2) return null;

  const got = signals.reduce((s, x) => s + (x.ok ? x.weight : 0), 0);
  const max = signals.reduce((s, x) => s + x.weight, 0);
  const rating = Math.round((got / max) * 50) / 10;

  return (
    <Shell icon={<ShieldCheck className="w-4 h-4 text-emerald-600" />} title="Vehicle Score">
      <div className="flex-1 flex flex-col items-center justify-center py-1">
        <p className="text-4xl font-black font-display tabular-nums text-foreground leading-none">{rating.toFixed(1)}</p>
        <div className="flex items-center gap-0.5 mt-2">
          {[0, 1, 2, 3, 4].map((i) => {
            const fill = Math.max(0, Math.min(1, rating - i));
            return (
              <span key={i} className="relative inline-block w-4 h-4">
                <Star className="absolute inset-0 w-4 h-4 text-slate-200" fill="currentColor" />
                <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                  <Star className="w-4 h-4 text-amber-400" fill="currentColor" />
                </span>
              </span>
            );
          })}
        </div>
      </div>
      <p className="text-center text-[11px] text-muted-foreground mt-2">
        Based on {signals.length} verified history signal{signals.length === 1 ? "" : "s"}
      </p>
    </Shell>
  );
}

// ── Card 3: Price Confidence (data-quality read) ───────────────────
function priceConfidenceCard(listing: Listing): ReactNode {
  const mv = listing.market_value != null ? Number(listing.market_value) : null;
  const pay = listing.market_payload || {};
  const hasBand = pay.low != null && pay.high != null;
  const hasPos = !!listing.market_position;

  if (mv == null && !hasBand) return null;

  let score = 0;
  if (mv != null) score += 1;
  if (hasBand) score += 1;
  if (hasPos) score += 1;
  const level = score >= 3 ? "High" : score === 2 ? "Medium" : "Fair";
  const pct = score >= 3 ? 92 : score === 2 ? 74 : 56;
  const tone =
    level === "High" ? { text: "text-emerald-600", bar: "bg-emerald-500" } :
    level === "Medium" ? { text: "text-blue-600", bar: "bg-blue-500" } :
    { text: "text-amber-600", bar: "bg-amber-500" };

  return (
    <Shell icon={<BarChart3 className="w-4 h-4 text-blue-600" />} title="Price Confidence">
      <div className="flex-1 flex flex-col items-center justify-center py-1">
        <p className={`text-3xl font-black font-display tracking-tight ${tone.text}`}>{level}</p>
        <div className="w-full mt-3 h-2 rounded-full bg-slate-100 overflow-hidden">
          <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <p className="text-center text-[11px] text-muted-foreground mt-2">
        {level === "High"
          ? "Backed by live market comparables"
          : level === "Medium"
          ? "Supported by current market data"
          : "Limited comparable data"}
      </p>
    </Shell>
  );
}

// deno-lint-ignore no-explicit-any
export default function MarketIntelCards({ listing }: { listing: any }) {
  const cards = [
    marketPriceCard(listing),
    vehicleScoreCard(listing),
    priceConfidenceCard(listing),
  ].filter(Boolean);

  if (cards.length === 0) return null;

  return (
    <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {cards.map((c, i) => (
        <div key={i}>{c}</div>
      ))}
    </section>
  );
}
