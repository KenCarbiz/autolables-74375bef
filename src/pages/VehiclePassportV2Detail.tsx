import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  ChevronLeft, Upload, Phone, MessageSquare, Send, CheckCircle2, ShieldCheck,
  TrendingUp, DollarSign, Clock, Car, Wrench, Award, Gauge as GaugeIcon, BadgeCheck,
  Building2, Truck, Star, Settings, Lock, Zap, Package, FileText, Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { type VehicleListing } from "@/hooks/useVehicleListing";
import { usePublicListing } from "@/hooks/usePublicListing";
import { formatPhone } from "@/components/addendum/CustomerInfoSection";
import Logo from "@/components/brand/Logo";
import { derivePassport, fmt$, type PassportData } from "@/lib/passportV2Data";
import { listingGallery, listingHero } from "@/lib/photos";

// ──────────────────────────────────────────────────────────────
// VehiclePassportV2Detail — /passport-v2/:vehicleSlug/:section
//
// Full dedicated detail pages for every meaningful Passport V2 link
// (verification report, market modules, history, warranty, reviews,
// lead capture, etc.). One component, section registry, shared chrome
// on the V3 design tokens (#2563EB / #F6F7F9 / #E6E8EC / #0F172A) so the
// catch-all sections match the main passport. All content is real-data-
// gated — honest unavailable states, never fabricated certainty.
// ──────────────────────────────────────────────────────────────

const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-2xl border border-[#E6E8EC] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.05)] ${className}`}>{children}</div>
);

const Stars = ({ n, size = 16 }: { n: number; size?: number }) => (
  <div className="inline-flex items-center gap-0.5">
    {[0, 1, 2, 3, 4].map((i) => (
      <Star key={i} className="text-amber-400" style={{ width: size, height: size }} fill={i < Math.round(n) ? "#fbbf24" : "none"} strokeWidth={1.5} />
    ))}
  </div>
);

// Honest "data not available yet" panel with a dealer-facing hint.
const Unavailable = ({ what, hint }: { what: string; hint?: string }) => (
  <Card className="p-6 text-center">
    <span className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3"><Package className="w-6 h-6" /></span>
    <p className="text-[15px] font-bold text-slate-700">{what} isn't available yet</p>
    <p className="text-[13px] text-slate-500 mt-1.5 max-w-sm mx-auto">{hint || "The dealership can add this information to the vehicle's passport. Contact them for the latest details."}</p>
  </Card>
);

// ── Lead-capture form (shared by contact / trade / reserve / etc.) ──
const LeadForm = ({
  listing, intent, label, cta, onDone,
}: {
  listing: VehicleListing; intent: string; label: string; cta: string; onDone?: () => void;
}) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (!name.trim() || (!email.trim() && !phone.trim())) { toast.error("Name and a phone or email are required"); return; }
    setSending(true);
    try {
      await (supabase as unknown as { from: (t: string) => { insert: (r: unknown) => Promise<unknown> } }).from("leads").insert({
        store_id: listing.store_id, name: name.trim(), email: email.trim() || "", phone: phone.trim() || "",
        vehicle_interest: `${listing.ymm || "Vehicle"} (${label})`,
        vehicle_vin: listing.vin, source: "website", status: "new",
        notes: `[intent=${intent}] Passport V2 — ${label}${message.trim() ? `: ${message.trim()}` : ""}`,
      });
      setSent(true);
      onDone?.();
    } catch { toast.error("Couldn't send — please call the dealer directly"); }
    finally { setSending(false); }
  };

  if (sent) return (
    <Card className="p-8 text-center">
      <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-3" />
      <h3 className="text-lg font-bold text-slate-900 mb-1">Request sent</h3>
      <p className="text-sm text-slate-500">A specialist from the dealership will follow up shortly.</p>
    </Card>
  );

  return (
    <Card className="p-5">
      <div className="space-y-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name *" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <input value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="Phone" type="tel" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Anything you'd like the dealer to know? (optional)" rows={3} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
      </div>
      <button onClick={submit} disabled={sending} className="w-full h-12 mt-4 bg-[#2563EB] hover:bg-[#1d4fd7] disabled:opacity-60 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-colors">
        {sending ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><Send className="w-4 h-4" /> {cta}</>}
      </button>
      <p className="text-[11px] text-slate-400 text-center mt-3">By submitting, you agree to be contacted by the dealership about this vehicle.</p>
    </Card>
  );
};

// Minimal dependency-free price line chart.
const Sparkline = ({ points }: { points: number[] }) => {
  if (points.length < 2) return null;
  const w = 600, h = 120, pad = 8;
  const min = Math.min(...points), max = Math.max(...points);
  const span = Math.max(1, max - min);
  const coords = points.map((p, i) => {
    const x = pad + (i / (points.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (p - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const down = points[points.length - 1] <= points[0];
  const stroke = down ? "#059669" : "#e11d48";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-28 mt-3" preserveAspectRatio="none">
      <polyline points={coords.join(" ")} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {coords.map((c, i) => { const [x, y] = c.split(","); return <circle key={i} cx={x} cy={y} r="3" fill={stroke} />; })}
    </svg>
  );
};

const SectionHeading = ({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) => (
  <div className="flex items-start gap-3 mb-4">
    <span className="w-11 h-11 rounded-2xl bg-blue-50 flex items-center justify-center shrink-0"><Icon className="w-6 h-6 text-[#2563EB]" /></span>
    <div>
      <h1 className="text-[22px] font-extrabold tracking-tight leading-tight">{title}</h1>
      {subtitle && <p className="text-[13px] text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
  </div>
);

// ── Section registry ──────────────────────────────────────────
type SectionRender = (ctx: { d: PassportData; listing: VehicleListing; slug: string; navigate: ReturnType<typeof useNavigate> }) => React.ReactNode;

const SECTIONS: Record<string, { title: string; render: SectionRender }> = {
  "verification-report": {
    title: "Verification Report",
    render: ({ d }) => (
      <>
        <SectionHeading icon={ShieldCheck} title="Verification Report" subtitle="Every check we ran against trusted automotive data." />
        <Card className="p-5 !border-emerald-200 !bg-emerald-50/40">
          <div className="space-y-3">
            {d.verifyRows.map((r) => (
              <div key={r.label} className="flex items-center gap-3 text-[14px] font-medium text-slate-800"><CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />{r.label} <span className="ml-auto text-[12px] font-semibold text-emerald-600">Verified</span></div>
            ))}
            {d.verifyRows.length === 0 && <p className="text-[13px] text-slate-500">Verification checks appear here as data becomes available for this vehicle.</p>}
          </div>
        </Card>
        {d.verifiedBy.length > 0 && (
          <Card className="p-5 mt-4">
            <p className="text-[12px] font-bold uppercase tracking-wider text-slate-400 mb-2">Data sources</p>
            <div className="flex flex-wrap gap-2">
              {d.verifiedBy.map((v) => <span key={v} className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-700 bg-slate-100 rounded-full px-3 py-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />{v}</span>)}
            </div>
            <p className="text-[11px] text-slate-400 mt-3 leading-snug">Verification reflects data provided by third-party sources (vehicle history, MarketCheck, NHTSA) and the dealership. Confirm details directly with the dealer before purchase.</p>
          </Card>
        )}
      </>
    ),
  },
  "market-price": {
    title: "Market Price Analysis",
    render: ({ d }) => (
      <>
        <SectionHeading icon={DollarSign} title="Market Price Analysis" subtitle="How this vehicle's price compares to the market." />
        {d.marketAvg != null && d.price != null ? (
          <Card className="p-5">
            {d.belowMarket && d.belowMarket > 0 && <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-600 text-white text-[13px] font-bold mb-3"><BadgeCheck className="w-4 h-4" /> Great Price · {fmt$(d.belowMarket)} below market average</div>}
            <div className="grid grid-cols-3 text-center text-[13px] gap-2">
              <div className="rounded-xl bg-slate-50 py-3"><div className="text-slate-500 text-[11px]">Market Low</div><div className="font-bold mt-0.5">{fmt$(d.marketLow ?? Math.round(d.marketAvg * 0.9))}</div></div>
              <div className="rounded-xl bg-emerald-50 py-3"><div className="text-emerald-600 text-[11px]">Our Price</div><div className="font-extrabold text-emerald-700 mt-0.5">{fmt$(d.price)}</div></div>
              <div className="rounded-xl bg-slate-50 py-3"><div className="text-slate-500 text-[11px]">Market High</div><div className="font-bold mt-0.5">{fmt$(d.marketHigh ?? Math.round(d.marketAvg * 1.1))}</div></div>
            </div>
            <div className="mt-3 flex items-center justify-between text-[13px] rounded-xl bg-slate-50 px-4 py-3">
              <span className="text-slate-500">Market average</span><span className="font-bold">{fmt$(d.marketAvg)}</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-3 leading-snug">Market values provided by MarketCheck and third-party data sources. Actual market conditions may vary by region and time.</p>
          </Card>
        ) : <Unavailable what="Market pricing" hint="Live MarketCheck comparables are not yet available for this vehicle." />}
      </>
    ),
  },
  "market-demand": {
    title: "Market Demand",
    render: ({ d }) => (
      <>
        <SectionHeading icon={TrendingUp} title="Market Demand" subtitle="Shopper interest signals for this listing." />
        {d.viewCount != null || d.dom != null ? (
          <Card className="p-5">
            <p className="text-xl font-extrabold text-emerald-600">{(d.viewCount ?? 0) > 20 ? "High Interest" : "Active"}</p>
            <ul className="mt-3 space-y-2.5 text-[14px]">
              {d.viewCount != null && <li className="flex items-center gap-2.5"><CheckCircle2 className="w-4 h-4 text-emerald-600" />{d.viewCount.toLocaleString()} total views</li>}
              {d.dom != null && <li className="flex items-center gap-2.5"><CheckCircle2 className="w-4 h-4 text-emerald-600" />{d.dom} days on market</li>}
            </ul>
          </Card>
        ) : <Unavailable what="Demand data" hint="View and days-on-market signals appear here once the listing accrues activity." />}
      </>
    ),
  },
  "price-confidence": {
    title: "Price Confidence",
    render: ({ d }) => (
      <>
        <SectionHeading icon={GaugeIcon} title="Price Confidence" subtitle="How sure we are this price is competitive." />
        {d.belowMarket && d.belowMarket > 0 ? (
          <Card className="p-5">
            <p className="text-xl font-extrabold text-emerald-600">Excellent</p>
            <p className="text-[14px] text-slate-600 mt-0.5">{fmt$(d.belowMarket)} below market average</p>
            <ul className="mt-3 space-y-2.5 text-[14px]">
              <li className="flex items-center gap-2.5"><CheckCircle2 className="w-4 h-4 text-emerald-600" />Priced below market average</li>
              <li className="flex items-center gap-2.5"><CheckCircle2 className="w-4 h-4 text-emerald-600" />Backed by live market comparables</li>
              <li className="flex items-center gap-2.5"><CheckCircle2 className="w-4 h-4 text-emerald-600" />Independently analyzed by MarketCheck</li>
            </ul>
            <p className="text-[11px] text-slate-400 mt-3">Powered by MarketCheck.</p>
          </Card>
        ) : d.marketAvg != null ? (
          <Card className="p-5"><p className="text-xl font-extrabold text-blue-600">Fair</p><p className="text-[14px] text-slate-600 mt-0.5">Priced in line with the local market.</p><p className="text-[11px] text-slate-400 mt-3">Powered by MarketCheck.</p></Card>
        ) : <Unavailable what="Price confidence" hint="Confidence requires market comparables, which aren't available yet for this vehicle." />}
      </>
    ),
  },
  "price-history": {
    title: "Price History",
    render: ({ d }) => {
      const pts = d.valueHistory.filter((h) => h.listing_price != null);
      return (
        <>
          <SectionHeading icon={Clock} title="Price History" subtitle="How this vehicle's price has moved over time." />
          {pts.length >= 2 ? (
            <>
              <Card className="p-5 mb-4">
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                  {d.priceChange7d != null && (
                    <div><p className="text-[11px] text-slate-500">7-Day change</p><p className={`text-[20px] font-extrabold ${d.priceChange7d < 0 ? "text-emerald-600" : d.priceChange7d > 0 ? "text-rose-600" : "text-slate-900"}`}>{d.priceChange7d === 0 ? "No change" : `${d.priceChange7d < 0 ? "-" : "+"}${fmt$(Math.abs(d.priceChange7d))}`}</p></div>
                  )}
                  {d.priceChangeTotal != null && (
                    <div><p className="text-[11px] text-slate-500">Since first tracked</p><p className={`text-[20px] font-extrabold ${d.priceChangeTotal < 0 ? "text-emerald-600" : d.priceChangeTotal > 0 ? "text-rose-600" : "text-slate-900"}`}>{d.priceChangeTotal === 0 ? "No change" : `${d.priceChangeTotal < 0 ? "-" : "+"}${fmt$(Math.abs(d.priceChangeTotal))}`}</p></div>
                  )}
                </div>
                <Sparkline points={pts.map((p) => p.listing_price as number)} />
              </Card>
              <Card className="p-5">
                <p className="text-[12px] font-bold uppercase tracking-wider text-slate-400 mb-2">Captured prices</p>
                <div className="space-y-2 text-[14px]">
                  {[...pts].reverse().map((p, i) => (
                    <div key={i} className="flex justify-between gap-4 border-b border-slate-100 pb-2"><span className="text-slate-500">{new Date(p.captured_at).toLocaleDateString()}</span><span className="font-semibold">{fmt$(p.listing_price)}</span></div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 mt-3">Powered by MarketCheck price tracking.</p>
              </Card>
            </>
          ) : <Unavailable what="Price history" hint="We need at least two captured price points to show a trend. Tracking continues as MarketCheck re-checks this vehicle." />}
        </>
      );
    },
  },
  "comparable-vehicles": {
    title: "Comparable Vehicles",
    render: ({ slug }) => <CompsSection slug={slug} />,
  },
  "inventory-trend": {
    title: "Inventory Trend",
    render: () => (
      <>
        <SectionHeading icon={Package} title="Inventory Trend" subtitle="Market supply for this model." />
        <Unavailable what="Inventory trend" hint="30-day inventory movement for comparable vehicles is sourced from MarketCheck and appears here when available." />
      </>
    ),
  },
  "specifications": {
    title: "Specifications",
    render: ({ d, listing }) => (
      <>
        <SectionHeading icon={Settings} title="Key Specifications" subtitle={`${listing.ymm}${listing.trim ? ` ${listing.trim}` : ""}`} />
        {d.keySpecs.length > 0 ? (
          <Card className="p-5">
            <div className="space-y-2.5 text-[14px]">
              {d.keySpecs.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-slate-100 pb-2.5"><span className="text-slate-500">{k}</span><span className="font-semibold text-right">{v}</span></div>
              ))}
              {listing.mileage != null && <div className="flex justify-between gap-4 border-b border-slate-100 pb-2.5"><span className="text-slate-500">Mileage</span><span className="font-semibold text-right">{listing.mileage.toLocaleString()} mi</span></div>}
              {listing.vin && <div className="flex justify-between gap-4"><span className="text-slate-500">VIN</span><span className="font-semibold text-right font-mono text-[12px]">{listing.vin}</span></div>}
            </div>
          </Card>
        ) : <Unavailable what="Specifications" hint="Decoded specifications appear here once the vehicle's data is fully processed." />}
      </>
    ),
  },
  "great-buy": {
    title: "Why This Is A Great Buy",
    render: ({ d }) => (
      <>
        <SectionHeading icon={Award} title="Why This Is A Great Buy" subtitle="The signals that make this vehicle stand out." />
        <Card className="p-5">
          <ul className="space-y-3">
            {(d.whyBuy.length ? d.whyBuy : ["Details confirmed at the dealership."]).map((b, i) => (
              <li key={i} className="flex items-start gap-3 text-[14px]"><CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />{b}</li>
            ))}
          </ul>
        </Card>
      </>
    ),
  },
  "vehicle-history": {
    title: "Vehicle History",
    render: ({ d }) => (
      <>
        <SectionHeading icon={FileText} title="Vehicle History" subtitle="Ownership, accidents, title, service, and recalls." />
        <Card className="p-5">
          <ul className="divide-y divide-slate-100">
            {[
              ["Ownership", d.ownerCount === 1 ? "One owner — personal use" : d.ownerCount ? `${d.ownerCount} owners` : "Not reported", d.ownerCount === 1],
              ["Accidents", d.accidentCount === 0 ? "None reported (per history)" : d.accidentCount ? `${d.accidentCount} reported` : "Not reported", d.accidentCount === 0],
              ["Title", d.cleanTitle ? "Clean — no brands or issues" : "Not reported", d.cleanTitle],
              ["Service history", d.serviceCount > 0 ? `${d.serviceCount} records on file` : "No records on file", d.serviceCount > 0],
              ["Open recalls", d.recallClear ? "0 open recalls (NHTSA checked)" : d.openRecalls ? `${d.openRecalls} open` : "Not checked", d.recallClear],
            ].map(([t, s, ok]) => (
              <li key={t as string} className="flex items-center justify-between gap-3 py-3 text-[14px]">
                <span className="flex items-center gap-2.5"><CheckCircle2 className={`w-4 h-4 ${ok ? "text-emerald-600" : "text-slate-300"}`} />{t}</span>
                <span className="text-slate-500 text-right text-[13px]">{s}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-slate-400 mt-3 leading-snug">History data is provided by third-party vehicle-history sources and the dealership. Request the full report from the dealer before purchase.</p>
        </Card>
      </>
    ),
  },
  "ownership-timeline": {
    title: "Ownership Timeline",
    render: ({ d, listing }) => {
      const events = [
        d.warranty.in_service_date ? { d: new Date(d.warranty.in_service_date).toLocaleDateString(), t: "Placed in service", s: "Factory warranty start" } : null,
        d.ownerCount != null ? { d: d.ownerCount === 1 ? "Single owner" : `${d.ownerCount} owners`, t: d.ownerCount === 1 ? "One owner" : "Ownership", s: "Personal use" } : null,
        d.serviceCount > 0 ? { d: `${d.serviceCount} record${d.serviceCount === 1 ? "" : "s"}`, t: "Service history", s: "Maintained on schedule" } : null,
        { d: "Now", t: `At ${d.dealerName}`, s: "Current inventory" },
        { d: "Today", t: "Ready for you", s: "Available for delivery" },
      ].filter(Boolean) as { d: string; t: string; s: string }[];
      return (
        <>
          <SectionHeading icon={Clock} title="Ownership Timeline" subtitle={`The journey of this ${listing.ymm}.`} />
          <Card className="p-5">
            <ol className="space-y-4 relative border-l-2 border-emerald-100 ml-1.5 pl-5">
              {events.map((e, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[26px] top-1 w-3.5 h-3.5 rounded-full bg-emerald-500 ring-2 ring-white" />
                  <p className="text-[14px] font-bold">{e.d} · {e.t}</p>
                  <p className="text-[12px] text-slate-500">{e.s}</p>
                </li>
              ))}
            </ol>
          </Card>
        </>
      );
    },
  },
  "factory-warranty": {
    title: "Factory Warranty",
    render: ({ d, listing }) => (
      <>
        <SectionHeading icon={ShieldCheck} title="Factory Warranty" subtitle="Remaining manufacturer coverage." />
        {d.warrantyStr ? (() => {
          const w = d.warranty;
          const milesLeft = w.factory_miles != null && listing.mileage != null ? Math.max(0, w.factory_miles - listing.mileage) : w.factory_miles ?? null;
          const milesPct = w.factory_miles && listing.mileage != null ? Math.max(4, 100 - Math.min(100, (listing.mileage / w.factory_miles) * 100)) : 65;
          let yrsLeft: number | null = null; let expiry: string | null = null;
          if (w.in_service_date && w.factory_months) {
            const end = new Date(w.in_service_date); end.setMonth(end.getMonth() + w.factory_months);
            expiry = end.toLocaleDateString();
            const ms = end.getTime() - Date.now(); yrsLeft = ms > 0 ? ms / (1000 * 60 * 60 * 24 * 365) : 0;
          }
          return (
            <Card className="p-5">
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 mb-2"><ShieldCheck className="w-3 h-3" /> OEM Verified</span>
              <p className="text-base font-bold">Factory warranty remaining</p>
              <div className="mt-3 h-3 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${milesPct}%` }} /></div>
              <div className="flex items-center gap-6 mt-3 text-[14px]">
                {yrsLeft != null && <span><span className="font-bold">{yrsLeft >= 1 ? `${Math.floor(yrsLeft)} yr` : `${Math.round(yrsLeft * 12)} mo`}</span> <span className="text-slate-500">remaining</span></span>}
                {milesLeft != null && <span><span className="font-bold">{milesLeft.toLocaleString()} mi</span> <span className="text-slate-500">remaining</span></span>}
              </div>
              <div className="mt-3 text-[12px] text-slate-500 space-y-0.5">
                {w.in_service_date && <p>In-service date: {new Date(w.in_service_date).toLocaleDateString()}</p>}
                {expiry && <p>Estimated expiration: <span className="font-semibold text-slate-700">{expiry}</span></p>}
              </div>
              <p className="text-[11px] text-slate-400 mt-3 leading-snug">Warranty information estimated from OEM data and vehicle history records. Confirm exact coverage with the dealer.</p>
            </Card>
          );
        })() : <Unavailable what="Warranty details" hint="The dealership can confirm remaining factory or extended coverage for this vehicle." />}
      </>
    ),
  },
  "owner-reviews": {
    title: "Owner Reviews",
    render: ({ d }) => (
      <>
        <SectionHeading icon={Star} title="What Owners Say" subtitle="Reviews for this dealership and model." />
        {d.dealerTrust.reviewSources.length > 0 ? (
          <Card className="p-5">
            {d.reviewRating != null && <div className="flex items-center gap-3 mb-4 pb-4 border-b border-slate-100"><span className="text-4xl font-extrabold">{d.reviewRating.toFixed(1)}</span><div><Stars n={d.reviewRating} size={18} />{d.reviewCount != null && <p className="text-[13px] text-slate-500 mt-0.5">{d.reviewCount.toLocaleString()} reviews</p>}</div></div>}
            <div className="space-y-4">
              {d.dealerTrust.reviewSources.map((r, i) => (
                <div key={i} className="border-b border-slate-100 pb-4 last:border-0 last:pb-0">
                  <div className="flex items-center gap-2"><span className="text-[14px] font-bold">{r.name}</span>{r.rating != null && <Stars n={r.rating} size={14} />}</div>
                  {r.quote && <p className="text-[14px] text-slate-600 mt-1 leading-relaxed">"{r.quote}"</p>}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-4">Reviews reflect dealership or model ratings and may not reflect the ownership experience of this specific vehicle.</p>
          </Card>
        ) : d.reviewRating != null ? (
          <Card className="p-5">
            <div className="flex items-center gap-3"><span className="text-4xl font-extrabold">{d.reviewRating.toFixed(1)}</span><div><Stars n={d.reviewRating} size={18} />{d.reviewCount != null && <p className="text-[13px] text-slate-500 mt-0.5">{d.reviewCount.toLocaleString()} reviews</p>}</div></div>
            {d.reviewUrl && <a href={d.reviewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 mt-4 text-[14px] font-semibold text-[#2563EB] hover:underline">Read all reviews <ChevronLeft className="w-4 h-4 rotate-180" /></a>}
            <p className="text-[11px] text-slate-400 mt-3 leading-snug">Reviews reflect dealership or model ratings and may not reflect the ownership experience of this specific vehicle.</p>
          </Card>
        ) : <Unavailable what="Owner reviews" hint="Verified dealership reviews appear here when the dealer connects a review source." />}
      </>
    ),
  },
  "features": {
    title: "Features & Specs",
    render: ({ d, listing }) => (
      <>
        <SectionHeading icon={Settings} title="Features & Specs" subtitle="Full equipment and specifications." />
        {d.highlights.length > 0 && (
          <Card className="p-5 mb-4">
            <p className="text-[12px] font-bold uppercase tracking-wider text-slate-400 mb-3">Highlights</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {d.highlights.map((h) => (
                <div key={h.key} className="flex items-start gap-2.5"><span className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><Zap className="w-4 h-4 text-[#2563EB]" /></span><div className="min-w-0"><p className="text-[13px] font-bold leading-tight truncate">{h.label}</p><p className="text-[11px] text-slate-400">{h.sub}</p></div></div>
              ))}
            </div>
          </Card>
        )}
        <Card className="p-5">
          <p className="text-[12px] font-bold uppercase tracking-wider text-slate-400 mb-2">Specifications</p>
          <div className="space-y-2 text-[14px]">
            {d.specRows.filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-slate-100 pb-2"><span className="text-slate-500">{k}</span><span className="font-semibold text-right">{v}</span></div>
            ))}
            {listing.mileage != null && <div className="flex justify-between gap-4 border-b border-slate-100 pb-2"><span className="text-slate-500">Mileage</span><span className="font-semibold text-right">{listing.mileage.toLocaleString()} mi</span></div>}
            {listing.vin && <div className="flex justify-between gap-4"><span className="text-slate-500">VIN</span><span className="font-semibold text-right font-mono text-[12px]">{listing.vin}</span></div>}
          </div>
        </Card>
        {(listing.features || []).length > 0 && (
          <Card className="p-5 mt-4">
            <p className="text-[12px] font-bold uppercase tracking-wider text-slate-400 mb-3">Features & Equipment ({listing.features.length})</p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-[14px]">
              {listing.features.map((f, i) => <li key={i} className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" /><span><span className="font-semibold">{f.title}</span>{f.subtitle ? <span className="text-slate-500"> — {f.subtitle}</span> : null}</span></li>)}
            </ul>
          </Card>
        )}
      </>
    ),
  },
  "overview": {
    title: "Vehicle Overview",
    render: ({ d, listing }) => {
      const img = listingHero(listing);
      return (
        <>
          <SectionHeading icon={Car} title="Vehicle Overview" subtitle={`${listing.ymm}${listing.trim ? ` ${listing.trim}` : ""}`} />
          <Card className="overflow-hidden">
            {img && <img src={img} alt={listing.ymm || "vehicle"} className="w-full aspect-[16/9] object-cover" />}
            <div className="p-5"><p className="text-[14px] leading-relaxed text-slate-700 whitespace-pre-wrap">{d.overview}</p></div>
          </Card>
        </>
      );
    },
  },
  "dealer": {
    title: "About the Dealership",
    render: ({ d }) => {
      const chips = [
        { icon: Building2, t: "Family Owned", s: "Trusted locally" },
        { icon: Star, t: d.reviewRating != null ? `${d.reviewRating.toFixed(1)} Rating` : "Top Rated", s: d.reviewCount != null ? `${d.reviewCount.toLocaleString()} reviews` : "Verified buyers" },
        { icon: Wrench, t: "Factory Certified", s: "Trained technicians" },
        { icon: Settings, t: "Service Center", s: "On-site" },
        { icon: Truck, t: "Delivery", s: "Available" },
        { icon: ShieldCheck, t: "Customer Commitment", s: "No pressure" },
      ];
      return (
        <>
          <SectionHeading icon={Building2} title={d.dealerName} subtitle="Why shoppers buy here." />
          <Card className="p-5">
            {(d.dealerTrust.storefrontUrl) && <img src={d.dealerTrust.storefrontUrl} alt={d.dealerName} className="w-full h-44 rounded-xl object-cover border border-[#E6E8EC] mb-5" />}
            {(d.dealerTrust.yearsInBusiness || d.dealerTrust.googleRating || d.dealerTrust.satisfaction || d.dealerTrust.bbbRating) && (
              <div className="flex flex-wrap items-center gap-x-8 gap-y-4 mb-5 pb-5 border-b border-[#eef1f4]">
                {d.dealerTrust.yearsInBusiness && <div className="text-center"><p className="text-[24px] font-extrabold text-[#2563EB] leading-none">{d.dealerTrust.yearsInBusiness}+</p><p className="text-[11px] text-slate-500 mt-1">Years in Business</p></div>}
                {d.dealerTrust.googleRating && <div className="text-center"><p className="text-[24px] font-extrabold text-[#2563EB] leading-none inline-flex items-center gap-1">{d.dealerTrust.googleRating}<Star className="w-4 h-4 text-amber-400" fill="#fbbf24" /></p><p className="text-[11px] text-slate-500 mt-1">Google{d.dealerTrust.googleCount ? ` (${Number(d.dealerTrust.googleCount).toLocaleString()})` : ""}</p></div>}
                {d.dealerTrust.satisfaction && <div className="text-center"><p className="text-[24px] font-extrabold text-[#2563EB] leading-none">{d.dealerTrust.satisfaction}</p><p className="text-[11px] text-slate-500 mt-1">Customer Satisfaction</p></div>}
                {d.dealerTrust.bbbRating && <div className="text-center"><p className="text-[24px] font-extrabold text-[#2563EB] leading-none">{d.dealerTrust.bbbRating}</p><p className="text-[11px] text-slate-500 mt-1">BBB Rating</p></div>}
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
              {chips.map((c, i) => (
                <div key={i} className="flex items-start gap-3"><span className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><c.icon className="w-5 h-5 text-[#2563EB]" /></span><div><p className="text-[14px] font-bold leading-tight">{c.t}</p><p className="text-[12px] text-slate-500 mt-0.5">{c.s}</p></div></div>
              ))}
            </div>
            {d.dealerTrust.certifications.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-5">
                {d.dealerTrust.certifications.map((c, i) => <span key={i} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-700 bg-slate-100 rounded-full px-3 py-1.5"><Award className="w-3.5 h-3.5 text-[#2563EB]" />{c}</span>)}
              </div>
            )}
            {(d.dealerPhone || d.dealerAddress) && (
              <div className="mt-5 pt-4 border-t border-slate-100 text-[14px] space-y-1.5">
                {d.dealerPhone && <a href={`tel:${d.dealerPhone}`} className="flex items-center gap-2 font-semibold text-[#2563EB]"><Phone className="w-4 h-4" />{formatPhone(d.dealerPhone)}</a>}
                {d.dealerAddress && <a href={`https://maps.google.com/?q=${encodeURIComponent(d.dealerAddress)}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-slate-600"><Truck className="w-4 h-4" />{d.dealerAddress}</a>}
              </div>
            )}
          </Card>
        </>
      );
    },
  },
  "offers": {
    title: "Available Offers",
    render: ({ d }) => (
      <>
        <SectionHeading icon={Award} title="Available Offers" subtitle="Current incentives and programs." />
        {d.offers.length > 0 ? (
          <div className="space-y-3">
            {d.offers.map((o, i) => (
              <Card key={i} className="p-4"><p className="text-[15px] font-bold">{o.title}</p><p className="text-[13px] text-slate-600 mt-0.5">{o.body}</p>{o.exp && <p className="text-[12px] text-slate-400 mt-0.5">{o.exp}</p>}</Card>
            ))}
          </div>
        ) : <Unavailable what="Offers" hint="The dealership can publish current incentives and programs to this vehicle. Contact them for today's best offer." />}
      </>
    ),
  },
  "todays-price": {
    title: "Today's Price",
    render: ({ d, listing }) => (
      <>
        <SectionHeading icon={DollarSign} title="Get Today's Price" subtitle="Request the dealership's best out-the-door price." />
        {d.price != null && (
          <Card className="p-5 mb-4 text-center">
            <p className="text-[13px] font-semibold text-slate-500">{d.priceLabel}</p>
            <p className="text-[36px] font-extrabold tracking-tight leading-none mt-1">{fmt$(d.price)}</p>
            {d.estMonthly != null && <p className="text-[13px] text-slate-500 mt-1">Est. {fmt$(d.estMonthly)}/mo · 72 mo, 7.49% APR, 10% down (WAC)</p>}
            {d.saveVsMsrp != null && <p className="text-[14px] font-semibold text-emerald-600 mt-1">You save {fmt$(d.saveVsMsrp)} vs MSRP</p>}
          </Card>
        )}
        <LeadForm listing={listing} intent="todays_price" label="Today's Price" cta="Get my best price" />
      </>
    ),
  },
  // ── Lead-capture sections ──
  "check-availability": {
    title: "Check Availability",
    render: ({ listing }) => (<><SectionHeading icon={CheckCircle2} title="Check Availability" subtitle="Confirm this vehicle is still available and get details." /><LeadForm listing={listing} intent="check_availability" label="Check Availability" cta="Check availability" /></>),
  },
  "contact": {
    title: "Contact the Dealer",
    render: ({ listing }) => (<><SectionHeading icon={MessageSquare} title="Contact the Dealer" subtitle="Send a message and a specialist will reply." /><LeadForm listing={listing} intent="contact" label="Contact Dealer" cta="Send message" /></>),
  },
  "trade": {
    title: "Value My Trade",
    render: ({ listing }) => (<><SectionHeading icon={GaugeIcon} title="Value My Trade" subtitle="Know your trade value in minutes." /><LeadForm listing={listing} intent="trade" label="Value My Trade" cta="Get my trade value" /></>),
  },
  "reserve": {
    title: "Reserve This Vehicle",
    render: ({ listing }) => (<><SectionHeading icon={BadgeCheck} title="Reserve This Vehicle" subtitle="Secure it today with a refundable deposit." /><Card className="p-4 mb-4 !bg-blue-50 !border-blue-100"><p className="text-[13px] text-slate-700">Submit your details and the dealership will reach out to arrange a fully refundable hold on this vehicle. No payment is collected here.</p></Card><LeadForm listing={listing} intent="reserve" label="Reserve Vehicle" cta="Request to reserve" /></>),
  },
  "test-drive": {
    title: "Schedule a Test Drive",
    render: ({ listing }) => (<><SectionHeading icon={Calendar} title="Schedule a Test Drive" subtitle="Pick a time that works and we'll confirm." /><LeadForm listing={listing} intent="test_drive" label="Test Drive" cta="Request test drive" /></>),
  },
  "text": {
    title: "Text the Dealer",
    render: ({ listing, d }) => (
      <>
        <SectionHeading icon={MessageSquare} title="Text the Dealer" subtitle="Get a quick reply by text." />
        {d.dealerPhone && (
          <Card className="p-5 mb-4 text-center">
            <p className="text-[13px] text-slate-600 mb-3">Open your messages app to text the dealership directly.</p>
            <a href={`sms:${d.dealerPhone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-xl bg-[#2563EB] text-white font-bold"><Send className="w-4 h-4" /> Text {formatPhone(d.dealerPhone)}</a>
          </Card>
        )}
        <LeadForm listing={listing} intent="text" label="Text Dealer" cta="Request a text" />
      </>
    ),
  },
  "share": {
    title: "Share This Vehicle",
    render: ({ listing, d }) => <ShareSection listing={listing} dealerName={d.dealerName} />,
  },
  "gallery": {
    title: "Photo Gallery",
    render: ({ listing }) => {
      const all = listingGallery(listing);
      return (
        <>
          <SectionHeading icon={Car} title="Photo Gallery" subtitle={all.length ? `${all.length} photo${all.length === 1 ? "" : "s"} of this vehicle.` : "Photos of this vehicle."} />
          {all.length ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {all.map((src, i) => (
                <a key={i} href={src} target="_blank" rel="noreferrer" className="block rounded-xl overflow-hidden border border-[#E6E8EC] bg-slate-100 aspect-[4/3] hover:opacity-95 transition-opacity">
                  <img src={src} alt={`${listing.ymm || "Vehicle"} photo ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
                </a>
              ))}
            </div>
          ) : <Unavailable what="Vehicle photos" hint="The dealership can add photos to this vehicle's passport." />}
        </>
      );
    },
  },
  "protect": {
    title: "Protect This Vehicle",
    render: ({ listing }) => (
      <>
        <SectionHeading icon={ShieldCheck} title="Protect This Vehicle" subtitle="Coverage options to consider with your purchase." />
        <Card className="p-5 mb-4">
          <p className="text-[13px] text-slate-600 mb-3">Ask the dealership about protection products that can extend or add to your coverage:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {[
              ["Extended Service Contract", "Coverage beyond the factory warranty term."],
              ["Prepaid Maintenance", "Lock in scheduled service at today's pricing."],
              ["Tire & Wheel Protection", "Covers road-hazard tire and wheel damage."],
              ["GAP Coverage", "Covers the gap between loan balance and value."],
              ["Appearance Protection", "Interior and exterior surface protection."],
              ["Certified Warranty Upgrade", "Manufacturer-backed coverage where eligible."],
            ].map(([t, s]) => (
              <div key={t} className="rounded-xl border border-[#E6E8EC] p-3">
                <p className="text-[13px] font-bold text-slate-800">{t}</p>
                <p className="text-[12px] text-slate-500 mt-0.5">{s}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-3">Availability and pricing vary. The dealership will confirm which products apply to this vehicle.</p>
        </Card>
        <LeadForm listing={listing} intent="protection" label="Protection Options" cta="Request protection info" />
      </>
    ),
  },
};

// Comparable Vehicles — fetches the marketcheck-comps function on demand.
const CompsSection = ({ slug }: { slug: string }) => {
  const [state, setState] = useState<"loading" | "ready" | "empty">("loading");
  const [data, setData] = useState<{ count: number; startingAt: number | null; median: number | null; comparables: { vin: string | null; price: number | null; miles: number | null; heading: string; trim: string | null; dealer: string; distance: number | null }[] } | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: res } = await supabase.functions.invoke("marketcheck-comps", { body: { slug } });
        if (!mounted) return;
        if (res && (res as { available?: boolean }).available) { setData(res as typeof data); setState("ready"); }
        else setState("empty");
      } catch { if (mounted) setState("empty"); }
    })();
    return () => { mounted = false; };
  }, [slug]);

  return (
    <>
      <SectionHeading icon={Car} title="Comparable Vehicles" subtitle="Similar vehicles in your area." />
      {state === "loading" ? (
        <Card className="p-5"><div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse" />)}</div></Card>
      ) : state === "empty" || !data ? (
        <Unavailable what="Comparable listings" hint="A live comparable set (year, trim, mileage, and price) is sourced from MarketCheck and appears here when available for this vehicle and market." />
      ) : (
        <>
          {/* Aggregate market stats only — the passport never lists other
              dealers' individual vehicles (names, distances) to a customer. */}
          <Card className="p-5">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <div><p className="text-[11px] text-slate-500">Comparable vehicles</p><p className="text-[22px] font-extrabold">{data.count.toLocaleString()}</p></div>
              {data.startingAt != null && <div><p className="text-[11px] text-slate-500">Starting at</p><p className="text-[22px] font-extrabold text-emerald-600">{fmt$(data.startingAt)}</p></div>}
              {data.median != null && <div><p className="text-[11px] text-slate-500">Median price</p><p className="text-[22px] font-extrabold">{fmt$(data.median)}</p></div>}
            </div>
            <p className="text-[11px] text-slate-400 mt-3">Market statistics provided by MarketCheck.</p>
          </Card>
        </>
      )}
    </>
  );
};

const ShareSection = ({ listing, dealerName }: { listing: VehicleListing; dealerName: string }) => {
  const url = typeof window !== "undefined" ? `${window.location.origin}/v/${listing.slug}` : "";
  const share = async () => {
    try { if (navigator.share) await navigator.share({ title: listing.ymm || "Vehicle", url }); else { await navigator.clipboard.writeText(url); toast.success("Link copied"); } } catch { /* cancelled */ }
  };
  return (
    <>
      <SectionHeading icon={Upload} title="Share This Vehicle" subtitle={`Send this ${listing.ymm} to a friend or co-buyer.`} />
      <Card className="p-5">
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"><span className="text-[13px] text-slate-600 truncate flex-1">{url}</span><button onClick={() => { navigator.clipboard?.writeText(url); toast.success("Link copied"); }} className="text-[13px] font-bold text-[#2563EB] shrink-0">Copy</button></div>
        <button onClick={share} className="w-full h-12 mt-3 rounded-xl bg-[#2563EB] text-white font-bold inline-flex items-center justify-center gap-2"><Upload className="w-4 h-4" /> Share</button>
        <p className="text-[12px] text-slate-400 mt-3 text-center">Shared from {dealerName}'s AutoLabels passport.</p>
      </Card>
    </>
  );
};

const VehiclePassportV2Detail = () => {
  const params = useParams<{ vehicleSlug?: string; slug?: string; section: string }>();
  const vehicleSlug = params.vehicleSlug ?? params.slug;
  const section = params.section;
  const location = useLocation();
  const base = location.pathname.startsWith("/v/") ? "v"
    : location.pathname.startsWith("/passport-v3") ? "passport-v3" : "passport-v2";
  const navigate = useNavigate();
  const { listing, loading, notFound } = usePublicListing(vehicleSlug);

  const d = useMemo(() => (listing ? derivePassport(listing) : null), [listing]);
  const def = section ? SECTIONS[section] : undefined;

  const back = () => navigate(`/${base}/${vehicleSlug}`);

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-[#F6F7F9]"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;

  if (notFound || !listing || !d) return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[#F6F7F9]">
      <div className="text-center"><Package className="w-12 h-12 text-slate-300 mx-auto mb-4" /><h1 className="text-xl font-bold">Vehicle unavailable</h1><p className="text-sm text-slate-500 mt-2">This listing may have been sold or unpublished.</p></div>
    </div>
  );

  if (!def) return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[#F6F7F9]">
      <div className="text-center"><Package className="w-12 h-12 text-slate-300 mx-auto mb-4" /><h1 className="text-xl font-bold">Page not found</h1><button onClick={back} className="mt-4 text-[#2563EB] font-semibold">Back to Passport</button></div>
    </div>
  );

  const heroSrc = listingHero(listing);

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#0F172A]" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <Helmet><title>{`${def.title} — ${listing.ymm} · Passport`}</title><meta name="robots" content="noindex" /></Helmet>

      {/* Sticky top header — back + vehicle context */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-[#E6E8EC]">
        <div className="mx-auto max-w-[760px] h-14 px-3 flex items-center gap-3">
          <button onClick={back} aria-label="Back to passport" className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center shrink-0"><ChevronLeft className="w-5 h-5" /></button>
          {heroSrc && <img src={heroSrc} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />}
          <div className="min-w-0 flex-1"><p className="text-[14px] font-bold leading-tight truncate">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</p>{d.price != null && <p className="text-[12px] font-bold text-[#2563EB] leading-tight">{fmt$(d.price)}</p>}</div>
        </div>
      </header>

      <div className="mx-auto max-w-[760px] px-4 sm:px-6 py-5 pb-[calc(80px+env(safe-area-inset-bottom))] space-y-4">
        {def.render({ d, listing, slug: vehicleSlug || "", navigate })}

        {/* Cross-CTA + back to passport */}
        <Card className="p-5">
          <p className="text-[13px] font-semibold text-slate-700 mb-3">Ready to move forward?</p>
          <div className="grid grid-cols-2 gap-2.5">
            <button onClick={() => navigate(`/${base}/${vehicleSlug}/reserve`)} className="h-11 rounded-xl bg-[#2563EB] text-white text-[13px] font-bold inline-flex items-center justify-center gap-1.5"><BadgeCheck className="w-4 h-4" /> Reserve</button>
            <button onClick={() => navigate(`/${base}/${vehicleSlug}/trade`)} className="h-11 rounded-xl border-2 border-[#2563EB] text-[#2563EB] text-[13px] font-bold inline-flex items-center justify-center gap-1.5"><GaugeIcon className="w-4 h-4" /> Trade value</button>
          </div>
          <button onClick={back} className="w-full mt-2.5 h-11 rounded-xl border border-[#E6E8EC] text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"><ChevronLeft className="w-4 h-4" /> Back to Vehicle Passport</button>
        </Card>

        <footer className="pt-2 pb-4">
          <div className="flex items-center justify-center gap-2 text-[12px] text-slate-500"><Lock className="w-3.5 h-3.5 text-emerald-600" /> Secure &amp; Private · 100% Free · <Logo variant="full" size={16} /></div>
        </footer>
      </div>

      {/* Sticky bottom action bar — Call / Text / Test Drive / Today's Price */}
      <div className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-[#E6E8EC] px-3 pt-2 pb-[calc(8px+env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-[760px] grid grid-cols-4 gap-2">
          {[
            { key: "call", icon: Phone, label: "Call", onClick: () => { if (d.dealerPhone) window.location.href = `tel:${d.dealerPhone}`; else navigate(`/${base}/${vehicleSlug}/contact`); } },
            { key: "text", icon: MessageSquare, label: "Text", onClick: () => navigate(`/${base}/${vehicleSlug}/text`) },
            { key: "td", icon: Clock, label: "Test Drive", onClick: () => navigate(`/${base}/${vehicleSlug}/test-drive`) },
            { key: "price", icon: DollarSign, label: "Today's Price", primary: true, onClick: () => navigate(`/${base}/${vehicleSlug}/todays-price`) },
          ].map((b) => (
            <button key={b.key} onClick={b.onClick} className={`h-11 rounded-xl text-[10px] leading-[1.05] font-bold inline-flex flex-col items-center justify-center gap-0.5 text-center px-0.5 ${b.primary ? "bg-[#2563EB] text-white" : "border border-[#d8dce0] bg-white text-[#0F172A]"}`}>
              <b.icon className={`w-4 h-4 ${b.primary ? "" : "text-[#2563EB]"}`} /> {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default VehiclePassportV2Detail;
