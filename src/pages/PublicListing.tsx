import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Share2, Printer, Bookmark,
  FileText, MessageSquare, RefreshCw, ExternalLink, Upload,
  ShieldCheck, Shield, CheckCircle2, Package, Clock, AlertTriangle,
  Star, Phone, Mail, MapPin, Globe,
  Car, Fuel, Cog, Settings, Wind,
  TrendingDown, User, Wrench, Award,
  Send, X, Info, Flame, Search, Navigation,
  BarChart3, Gauge, History, CreditCard,
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

const deriveDemandScore = (mp: { low?: number | null; high?: number | null } | null | undefined, price: number, similar: number | null) => {
  // Combine price-vs-market and scarcity into a demand label
  const scarce = similar != null && similar <= 5;
  const greatPrice = mp?.low != null && price < (mp.low ?? price);
  if (scarce && greatPrice) return { label: "Very High Demand", level: 0.9, color: "#dc2626" };
  if (scarce || greatPrice) return { label: "High Demand", level: 0.75, color: "#ea580c" };
  if (similar != null && similar > 15) return { label: "Moderate Demand", level: 0.5, color: "#ca8a04" };
  return { label: "High Demand", level: 0.75, color: "#ea580c" };
};

function getBuildCategories(listing: VehicleListing) {
  const ks = listing.key_specs || {};
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const features = listing.features || [];

  const kw = (f: { title: string }, ...terms: string[]) =>
    terms.some((t) => new RegExp(t, "i").test(f.title));

  const powertrain: string[] = [
    ks.engine,
    ks.drivetrain,
    ks.transmission,
    ks.fuel,
    mc.horsepower ? `${mc.horsepower} HP` : null,
    ks.mpg_city && ks.mpg_hwy ? `${ks.mpg_city}/${ks.mpg_hwy} MPG est.` : null,
  ].filter(Boolean) as string[];

  const interiorFeats = features.filter((f) =>
    kw(f, "seat", "leather", "heat", "cool", "moonroof", "sunroof", "memory", "ventilat", "panoram")
  ).map((f) => f.title);

  const exteriorFeats = features.filter((f) =>
    kw(f, "wheel", "alloy", "led", "headlight", "roof rail", "liftgate", "tow", "trailer", "mirror")
  ).map((f) => f.title);

  const safetyFeats = features.filter((f) =>
    kw(f, "safety", "blind", "backup", "camera", "alert", "warning", "assist", "brake", "lane", "collision", "monitor", "360")
  ).map((f) => f.title);

  const techFeats = features.filter((f) =>
    kw(f, "apple", "android", "bluetooth", "wifi", "navigation", "screen", "audio", "carplay", "usb", "wireless", "touch", "bose", "harman")
  ).map((f) => f.title);

  const pkgFeats = features.filter((f) =>
    kw(f, "package", "pkg", "edition", "bundle")
  ).map((f) => f.title);

  const interior: string[] = [
    ks.interior_color ? `${ks.interior_color} Interior` : null,
    ...interiorFeats,
  ].filter(Boolean).slice(0, 6) as string[];

  const exterior: string[] = [
    ks.exterior_color ? `${ks.exterior_color} Exterior` : null,
    ks.body_style || null,
    ...exteriorFeats,
  ].filter(Boolean).slice(0, 6) as string[];

  return {
    powertrain: powertrain.slice(0, 6),
    interior: interior.slice(0, 6),
    exterior: exterior.slice(0, 6),
    safety: safetyFeats.slice(0, 6),
    technology: techFeats.slice(0, 6),
    packages: pkgFeats.slice(0, 6),
  };
}

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

// ── SVG: Demand speedometer ─────────────────────────────────────
const DemandMeter = ({ level, color }: { level: number; color: string }) => {
  const angleDeg = level * 180;
  const rad = ((angleDeg - 180) * Math.PI) / 180;
  const nx = 50 + 36 * Math.cos(rad);
  const ny = 50 + 36 * Math.sin(rad);
  return (
    <svg viewBox="0 0 100 56" className="w-44">
      <path d="M 10 50 A 40 40 0 0 1 37 14" fill="none" stroke="#fef08a" strokeWidth="10" strokeLinecap="round" />
      <path d="M 37 14 A 40 40 0 0 1 63 14" fill="none" stroke="#fb923c" strokeWidth="10" strokeLinecap="round" />
      <path d="M 63 14 A 40 40 0 0 1 90 50" fill="none" stroke="#dc2626" strokeWidth="10" strokeLinecap="round" />
      <line x1="50" y1="50" x2={nx.toFixed(1)} y2={ny.toFixed(1)}
        stroke="#1e293b" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="50" cy="50" r="3.5" fill="#1e293b" />
    </svg>
  );
};

// ── Mini vertical bar chart ────────────────────────────────────
const PriceBars = ({ low, price, high }: { low: number; price: number; high: number }) => {
  const range = high - low || 1;
  const bars = [
    { label: "Low", val: low, h: 30 },
    { label: "Avg", val: (low + high) / 2, h: 55 },
    { label: "Yours", val: price, h: Math.max(20, Math.min(70, ((price - low) / range) * 60 + 15)), highlight: true },
    { label: "High", val: high, h: 80 },
  ];
  return (
    <div className="flex items-end gap-2 h-20 mt-3">
      {bars.map((b) => (
        <div key={b.label} className="flex flex-col items-center gap-1 flex-1">
          <span className="text-[9px] text-slate-500 font-semibold">{fmt$(b.val)}</span>
          <div
            className={`w-full rounded-t ${b.highlight ? "bg-blue-500" : "bg-slate-200"}`}
            style={{ height: b.h }}
          />
          <span className={`text-[9px] font-bold ${b.highlight ? "text-blue-600" : "text-slate-400"}`}>{b.label}</span>
        </div>
      ))}
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

// ── Build category card ─────────────────────────────────────────
const BuildCard = ({ icon: Icon, title, items }: {
  icon: React.ElementType; title: string; items: string[];
}) => (
  <div className="border border-slate-200 rounded-2xl p-5">
    <div className="flex items-center gap-2 mb-4">
      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
        <Icon className="w-4 h-4 text-slate-600" />
      </div>
      <p className="text-sm font-black text-slate-900 uppercase tracking-wide">{title}</p>
    </div>
    {items.length > 0 ? (
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm text-slate-700">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
            {item}
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-sm text-slate-400 italic">See dealer for full details</p>
    )}
  </div>
);

// ── Document card ───────────────────────────────────────────────
const DocCard = ({
  icon: Icon, title, status, date, url,
}: {
  icon: React.ElementType; title: string; status: "on_file" | "available" | "pending";
  date?: string | null; url?: string | null;
}) => {
  const statusCfg = {
    on_file:   { text: "On File",   cls: "text-emerald-700 bg-emerald-50 border-emerald-200" },
    available: { text: "Available", cls: "text-blue-700 bg-blue-50 border-blue-200" },
    pending:   { text: "Pending",   cls: "text-amber-700 bg-amber-50 border-amber-200" },
  }[status];
  return (
    <div className="border border-slate-200 rounded-2xl p-4 flex flex-col">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-slate-600" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 leading-tight">{title}</p>
          {date && <p className="text-xs text-slate-400 mt-0.5">Verified {date}</p>}
        </div>
      </div>
      <div className="flex items-center justify-between mt-auto pt-2 border-t border-slate-100">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusCfg.cls}`}>
          {statusCfg.text}
        </span>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1"
          >
            View <ExternalLink className="w-3 h-3" />
          </a>
        ) : (
          <button className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1">
            View <ExternalLink className="w-3 h-3" />
          </button>
        )}
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
  const [tradeTab, setTradeTab] = useState<"vin" | "plate">("vin");
  const [tradeInput, setTradeInput] = useState("");

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
      ).slice(0, 6);
    }
    const rows: { icon: React.ElementType; title: string; subtitle?: string | null }[] = [];
    if (ks.engine) rows.push({ icon: Cog, title: ks.engine, subtitle: "Engine" });
    if (ks.drivetrain) rows.push({ icon: Car, title: ks.drivetrain, subtitle: "Drivetrain" });
    if (ks.transmission) rows.push({ icon: Settings, title: ks.transmission, subtitle: "Transmission" });
    if (ks.fuel) rows.push({ icon: Fuel, title: ks.fuel, subtitle: "Fuel" });
    if (ks.body_style) rows.push({ icon: Car, title: ks.body_style, subtitle: "Body Style" });
    if (ks.exterior_color) rows.push({ icon: Wind, title: ks.exterior_color, subtitle: "Color" });
    return rows.slice(0, 6);
  }, [listing]);

  const buildCategories = useMemo(() => listing ? getBuildCategories(listing) : null, [listing]);

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
  const similarCount = (mc.similar_count as number) ?? null;

  const warrantyStr = (() => {
    const w = listing.warranty_info;
    if (!w) return null;
    const yrs = w.factory_months ? Math.round(w.factory_months / 12) : null;
    const mi = w.factory_miles ? `${(w.factory_miles / 1000).toFixed(0)}K mi` : null;
    return [yrs ? `${yrs} yr` : null, mi].filter(Boolean).join(" / ") || null;
  })();

  const rating = deriveVehicleRating(accidentCount ?? 0, ownerCount ?? 1, recallCount, serviceCount);
  const demand = deriveDemandScore(mp, price, similarCount);

  const ymm = listing.ymm || "";
  const [ymmYear, ...ymmRest] = ymm.split(" ");
  const ymmMakeModel = ymmRest.join(" ");

  const handleShare = async () => {
    try {
      if (navigator.share) await navigator.share({ title: listing.ymm || "Vehicle", url: viewUrl });
      else { await navigator.clipboard.writeText(viewUrl); toast.success("Link copied"); }
    } catch { /* cancelled */ }
  };

  // Service record timeline events
  const serviceEvents = (listing.service_records || []).map((r) => ({
    date: r.date || "On File",
    type: r.type || "Service",
    notes: r.notes || "",
    mileage: r.mileage || null,
  }));

  // Document cards configuration
  const today = new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
  const docCards = [
    {
      icon: FileText, title: "OEM Window Sticker", key: "oem_sticker",
      status: listing.oem_sticker_url ? "on_file" : "available" as const,
      url: listing.oem_sticker_url,
    },
    {
      icon: Shield, title: "FTC Buyers Guide", key: "buyers_guide",
      status: "on_file" as const, date: today, url: null,
    },
    {
      icon: CheckCircle2, title: "Inspection Report", key: "inspection",
      status: listing.prep_status?.foreman_signed_at ? "on_file" : "available" as const,
      date: listing.prep_status?.foreman_signed_at
        ? new Date(listing.prep_status.foreman_signed_at).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })
        : null,
      url: null,
    },
    {
      icon: BarChart3, title: "CARFAX Report", key: "carfax",
      status: "available" as const, url: null,
    },
    {
      icon: ShieldCheck, title: "Factory Warranty", key: "warranty",
      status: warrantyStr ? "on_file" : "pending" as const, url: null,
    },
    {
      icon: FileText, title: "Addendum Sticker", key: "addendum",
      status: (listing.documents || []).some((d) => d.type === "sticker") ? "on_file" : "available" as const,
      url: (listing.documents || []).find((d) => d.type === "sticker")?.url || null,
    },
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

      {/* ══ 2. HERO CAROUSEL ════════════════════════════════════ */}
      <div className="relative bg-slate-900 overflow-hidden" style={{ maxHeight: 540 }}>
        {gallery.length > 0 ? (
          <img src={gallery[photoIdx] || gallery[0]} alt={ymm}
            className="w-full object-cover" style={{ height: 540 }} />
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

      {/* ══ 4. QUICK ACTIONS + OFFERS ════════════════════════════ */}
      <div className="border-b border-slate-100 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex gap-2 flex-1 flex-wrap">
            {[
              { icon: FileText, label: "Documents" },
              { icon: MessageSquare, label: "Contact Dealer", action: () => setInquiryOpen(true) },
              { icon: RefreshCw, label: "Value My Trade" },
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

      {/* ══ 5. TRUST STRIP — 12 BADGES ═══════════════════════════ */}
      <div className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
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
            <TrustBadge icon={recallCount > 0 ? AlertTriangle : ShieldCheck}
              label={recallCount > 0 ? `${recallCount} Open Recall${recallCount > 1 ? "s" : ""}` : "No Open Recalls"}
              sub={recallCount > 0 ? "Contact Dealer for Details" : "NHTSA Verified Clean"}
              state={recallCount > 0 ? "bad" : "good"} />
            <TrustBadge icon={Award} label="Dealer Rating"
              sub="Verified Reviews"
              state="good" />
            <TrustBadge icon={Gauge}
              label={belowMarket > 0 ? "Priced Below Market" : "Market Price"}
              sub={belowMarket > 0 ? `${fmt$(belowMarket)} savings` : "Competitively Priced"}
              state={belowMarket > 0 ? "good" : "neutral"} />
            <TrustBadge icon={CheckCircle2} label="Vehicle Inspected" sub="162 Point Inspection" state="good" />
            <TrustBadge icon={Shield} label="FTC Transparent Pricing" sub="Upfront, No Hidden Fees" state="good" />
            <TrustBadge icon={ShieldCheck} label="Secure & Verified" sub="Documents Protected" state="good" />
            <TrustBadge icon={RefreshCw} label="7-Day Exchange Policy" sub="Hassle-Free" state="good" />
          </div>
        </div>
      </div>

      {/* ══ 6. WHY THIS VEHICLE ══════════════════════════════════ */}
      <div className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <h2 className="text-xl font-black text-slate-900 mb-2">Why This Vehicle Stands Out</h2>
          <p className="text-sm text-slate-500 mb-6">Data-driven insights from AutoCheck, MarketCheck, and our market analysis engine.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {/* Card 1: Vehicle Rating */}
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

            {/* Card 2: Market Position */}
            <div className="border border-slate-200 rounded-2xl p-6 flex flex-col items-center text-center">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4">
                Market Position <span className="font-normal normal-case">· MarketCheck</span>
              </p>
              {belowMarket > 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full mb-2">
                  <TrendingDown className="w-3.5 h-3.5" /> Great Price
                </span>
              )}
              <p className="text-3xl font-black text-slate-900 mb-1">{fmt$(price || undefined)}</p>
              {belowMarket > 0 && (
                <p className="text-sm text-emerald-700 font-semibold mb-2">
                  You save {fmt$(belowMarket)} below market average
                </p>
              )}
              <MarketGauge price={price} avg={marketAvg || price * 1.05} />
              {marketLow > 0 && marketHigh > 0 && (
                <div className="flex justify-between w-full text-xs text-slate-500 mt-2">
                  <span>Market Low<br /><b className="text-slate-700">{fmt$(marketLow)}</b></span>
                  <span className="text-right">Market High<br /><b className="text-slate-700">{fmt$(marketHigh)}</b></span>
                </div>
              )}
            </div>

            {/* Card 3: Demand Score */}
            <div className="border border-slate-200 rounded-2xl p-6 flex flex-col items-center text-center">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4">Demand Score</p>
              <div className="flex items-center gap-2 mb-2">
                <Flame className="w-6 h-6" style={{ color: demand.color }} />
                <span className="text-xl font-black" style={{ color: demand.color }}>{demand.label}</span>
              </div>
              <DemandMeter level={demand.level} color={demand.color} />
              <div className="flex justify-between w-full text-xs text-slate-500 mt-2">
                <span>Low</span><span>High</span>
              </div>
              {similarCount != null && (
                <p className="text-xs text-slate-600 mt-3 font-semibold">
                  {similarCount} similar vehicles within 100 mi
                </p>
              )}
              <p className="text-xs text-slate-500 mt-1">This model is in {demand.label.toLowerCase()}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ══ 7. COMPLETE FACTORY BUILD ════════════════════════════ */}
      {buildCategories && (
        <div className="border-b border-slate-200 bg-white">
          <div className="max-w-6xl mx-auto px-4 py-8">
            <h2 className="text-xl font-black text-slate-900 mb-2">Complete Factory Build &amp; Equipment</h2>
            <p className="text-sm text-slate-500 mb-6">Full equipment list decoded from factory build data and VIN.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <BuildCard icon={Cog} title="Powertrain" items={buildCategories.powertrain} />
              <BuildCard icon={Settings} title="Interior" items={buildCategories.interior} />
              <BuildCard icon={Car} title="Exterior" items={buildCategories.exterior} />
              <BuildCard icon={ShieldCheck} title="Safety" items={buildCategories.safety} />
              <BuildCard icon={Gauge} title="Technology" items={buildCategories.technology} />
              <BuildCard icon={Award} title="Packages" items={buildCategories.packages} />
            </div>
            {highlights.length > 0 && (
              <div className="mt-6 pt-5 border-t border-slate-100">
                <h3 className="text-sm font-bold text-slate-700 mb-4">Additional Highlights</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {highlights.map((h, i) => {
                    const fl = h as { icon?: string | React.ElementType; title: string; subtitle?: string | null };
                    const Icon = typeof fl.icon === "function" ? (fl.icon as React.ElementType) : Cog;
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                          <Icon className="w-4 h-4 text-slate-600" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900 leading-tight">{fl.title}</p>
                          {fl.subtitle && <p className="text-xs text-slate-500">{fl.subtitle}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <button className="mt-5 text-sm font-semibold text-blue-600 hover:underline flex items-center gap-1">
              View All Features &amp; Specs <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ══ 8. MARKET INTELLIGENCE ═══════════════════════════════ */}
      {marketAvg > 0 && (
        <div className="border-b border-slate-200 bg-white">
          <div className="max-w-6xl mx-auto px-4 py-8">
            <h2 className="text-xl font-black text-slate-900 mb-2">Market Intelligence</h2>
            <p className="text-sm text-slate-500 mb-6">Real-time pricing and inventory data from MarketCheck across your region.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {/* Market Position */}
              <div className="border border-slate-200 rounded-2xl p-5">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Market Position</p>
                <p className="text-lg font-black text-emerald-600 mb-3">
                  {belowMarket > 0 ? "GREAT PRICE" : marketAvg > 0 && price <= marketAvg ? "GOOD PRICE" : "MARKET PRICE"}
                </p>
                <p className="text-3xl font-black text-slate-900">{fmt$(price)}</p>
                {belowMarket > 0 && (
                  <p className="text-sm text-emerald-700 font-semibold mt-1">
                    You save {fmt$(belowMarket)} below market average
                  </p>
                )}
                <div className="mt-4">
                  <MarketGauge price={price} avg={marketAvg} />
                </div>
                {marketLow > 0 && marketHigh > 0 && (
                  <PriceBars low={marketLow} price={price} high={marketHigh} />
                )}
                <button className="mt-4 text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1">
                  View Full Market Report <ExternalLink className="w-3 h-3" />
                </button>
              </div>

              {/* Similar Vehicles Available */}
              <div className="border border-slate-200 rounded-2xl p-5">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Similar Vehicles Available</p>
                <p className={`text-lg font-black mb-3 ${similarCount != null && similarCount <= 5 ? "text-red-600" : "text-amber-600"}`}>
                  {similarCount != null && similarCount <= 5 ? "LOW INVENTORY" : "LIMITED INVENTORY"}
                </p>
                <p className="text-3xl font-black text-slate-900">
                  {similarCount ?? "—"} <span className="text-base font-normal text-slate-500">vehicles</span>
                </p>
                <p className="text-sm text-slate-500 mt-1">within 100 miles</p>
                {/* Scarcity bar chart */}
                <div className="mt-5 space-y-2">
                  {[
                    { label: "This Model + Trim", pct: similarCount != null ? Math.min(100, similarCount * 8) : 30 },
                    { label: "This Model", pct: similarCount != null ? Math.min(100, similarCount * 15) : 60 },
                    { label: "Same Price Range", pct: 75 },
                  ].map(({ label, pct }) => (
                    <div key={label}>
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>{label}</span><span>{pct}%</span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Days to Sell */}
              <div className="border border-slate-200 rounded-2xl p-5">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Days To Sell (This Model)</p>
                <p className="text-lg font-black text-blue-600 mb-3">SELLS FAST</p>
                <p className="text-3xl font-black text-slate-900">
                  {(mc.days_on_market as number) ?? 22}{" "}
                  <span className="text-base font-normal text-slate-500">days on market average</span>
                </p>
                <div className="my-4">
                  <DemandMeter level={0.75} color="#2563eb" />
                  <div className="flex justify-between text-xs text-slate-400 mt-1">
                    <span>Slow</span><span>Fast</span>
                  </div>
                </div>
                <button className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1">
                  View Mkt Trends <ExternalLink className="w-3 h-3" />
                </button>
              </div>

              {/* What Others Paid */}
              <div className="border border-slate-200 rounded-2xl p-5">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">What Others Paid</p>
                <p className="text-lg font-black text-slate-700 mb-3">AVG SELLING PRICE</p>
                <p className="text-3xl font-black text-slate-900">{fmt$(marketAvg)}</p>
                <p className="text-sm text-slate-500 mt-1">in your market last 30 days</p>
                {marketLow > 0 && marketHigh > 0 && (
                  <PriceBars low={marketLow} price={price} high={marketHigh} />
                )}
                {belowMarket > 0 && (
                  <div className="mt-4 p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                    <p className="text-sm font-bold text-emerald-700">
                      This vehicle is priced {fmt$(belowMarket)} below the average paid in your market.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ 9. VEHICLE HISTORY & TRANSPARENCY ═══════════════════ */}
      <div className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <h2 className="text-xl font-black text-slate-900 mb-2">Vehicle History &amp; Transparency</h2>
          <p className="text-sm text-slate-500 mb-6">Full ownership, service, and event history for this vehicle.</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left: Summary cards */}
            <div className="space-y-3">
              {[
                {
                  icon: User, title: "Ownership",
                  value: ownerCount != null ? `${ownerCount}-Owner` : "1-Owner",
                  detail: "Personal Use",
                  state: (ownerCount ?? 1) <= 2 ? "good" : "warn",
                },
                {
                  icon: AlertTriangle, title: "Accident History",
                  value: accidentCount === 0 || accidentCount == null ? "No Accidents" : `${accidentCount} Accident${(accidentCount ?? 1) > 1 ? "s" : ""}`,
                  detail: accidentCount === 0 || accidentCount == null ? "AutoCheck Verified" : "See Full Report",
                  state: accidentCount != null && accidentCount > 0 ? "warn" : "good",
                },
                {
                  icon: FileText, title: "Title Status",
                  value: "Clean Title / No Liens",
                  detail: "No Brands or Issues",
                  state: "good",
                },
                {
                  icon: Wrench, title: "Service History",
                  value: serviceCount > 0 ? `${serviceCount} Records on File` : "Available on Request",
                  detail: serviceCount > 0 ? "Full History Available" : "Contact Dealer",
                  state: serviceCount > 0 ? "good" : "neutral",
                },
              ].map((item) => {
                const Icon = item.icon;
                const colors = {
                  good: "text-emerald-600 bg-emerald-50",
                  warn: "text-amber-600 bg-amber-50",
                  neutral: "text-slate-500 bg-slate-100",
                }[item.state as string] || "text-slate-500 bg-slate-100";
                return (
                  <div key={item.title} className="flex items-center gap-4 p-4 border border-slate-200 rounded-2xl">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${colors}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-slate-500 font-semibold">{item.title}</p>
                      <p className="text-sm font-black text-slate-900">{item.value}</p>
                    </div>
                    <p className="text-xs text-slate-500 text-right">{item.detail}</p>
                  </div>
                );
              })}
            </div>

            {/* Right: Timeline */}
            <div>
              <p className="text-sm font-bold text-slate-700 mb-4">Service &amp; Event Timeline</p>
              {serviceEvents.length > 0 ? (
                <div className="relative pl-6">
                  <div className="absolute left-2.5 top-0 bottom-0 w-0.5 bg-slate-100" />
                  {serviceEvents.map((ev, i) => (
                    <div key={i} className="relative mb-5 last:mb-0">
                      <div className="absolute -left-4 top-1 w-3 h-3 rounded-full bg-blue-500 border-2 border-white shadow" />
                      <div className="border border-slate-200 rounded-xl p-3.5 ml-1">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="text-xs font-black text-slate-900 uppercase tracking-wide">{ev.type}</p>
                          <p className="text-[11px] text-slate-400 shrink-0">{ev.date}</p>
                        </div>
                        {ev.notes && <p className="text-xs text-slate-600">{ev.notes}</p>}
                        {ev.mileage && <p className="text-[11px] text-slate-400 mt-1">{Number(ev.mileage).toLocaleString()} mi</p>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="relative pl-6">
                  <div className="absolute left-2.5 top-0 bottom-0 w-0.5 bg-slate-100" />
                  {[
                    { icon: History, label: "Original Sale", date: "On File", sub: "Registered · Original Sale" },
                    { icon: Wrench, label: "Service Visit", date: "On File", sub: "Oil & Filter Change" },
                    { icon: CheckCircle2, label: "Vehicle Detailed", date: "On File", sub: "Full Detail & Reconditioning" },
                    { icon: ShieldCheck, label: "Inspection", date: "On File", sub: "162 Point Inspection Completed" },
                  ].map((ev, i) => {
                    const Icon = ev.icon;
                    return (
                      <div key={i} className="relative mb-5 last:mb-0">
                        <div className="absolute -left-4 top-1 w-3 h-3 rounded-full bg-blue-500 border-2 border-white shadow" />
                        <div className="border border-slate-200 rounded-xl p-3.5 ml-1">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <p className="text-xs font-black text-slate-900 uppercase tracking-wide">{ev.label}</p>
                            <p className="text-[11px] text-slate-400 shrink-0">{ev.date}</p>
                          </div>
                          <p className="text-xs text-slate-600">{ev.sub}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <button className="mt-4 text-sm font-semibold text-blue-600 hover:underline flex items-center gap-1">
                View Full History Report <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ══ 10. VEHICLE OVERVIEW (description + specs) ═══════════ */}
      {(listing.description || ks.transmission || ks.exterior_color) && (
        <div className="border-b border-slate-200 bg-white">
          <div className="max-w-6xl mx-auto px-4 py-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2">
                <h2 className="text-xl font-black text-slate-900 mb-3">Vehicle Overview</h2>
                {listing.description && (
                  <p className="text-sm text-slate-600 leading-relaxed mb-5">{listing.description}</p>
                )}
                {(ks.transmission || ks.exterior_color || ks.fuel || ks.interior_color) && (
                  <div className="grid grid-cols-2 gap-x-8 gap-y-2.5 border-t border-slate-100 pt-4">
                    {[
                      ["Trim", listing.trim],
                      ["Transmission", ks.transmission],
                      ["Exterior Color", ks.exterior_color],
                      ["Fuel Type", ks.fuel],
                      ["Interior Color", ks.interior_color],
                      ks.mpg_city && ks.mpg_hwy ? ["MPG (est.)", `${ks.mpg_city} city / ${ks.mpg_hwy} hwy`] : null,
                    ].filter(Boolean).map(([label, val]) =>
                      val ? (
                        <div key={label} className="flex justify-between text-sm border-b border-slate-50 pb-1.5">
                          <span className="text-slate-500">{label}</span>
                          <span className="font-semibold text-slate-900 text-right">{val}</span>
                        </div>
                      ) : null,
                    )}
                  </div>
                )}
              </div>
              {gallery[1] && (
                <div className="rounded-2xl overflow-hidden border border-slate-100">
                  <img src={gallery[1]} alt={ymm} className="w-full h-full object-cover" style={{ maxHeight: 220 }} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ 11. DOCUMENT CENTER ══════════════════════════════════ */}
      <div className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <h2 className="text-xl font-black text-slate-900 mb-2">Vehicle Documents</h2>
          <p className="text-sm text-slate-500 mb-6">All key documents for this vehicle — view, download, or request on file.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-4">
            {docCards.map((doc) => (
              <DocCard
                key={doc.key}
                icon={doc.icon}
                title={doc.title}
                status={doc.status}
                date={doc.date ?? null}
                url={doc.url ?? null}
              />
            ))}
          </div>
          {/* Additional dealer-attached documents */}
          {(listing.documents || []).filter((d) => d.type !== "sticker").length > 0 && (
            <div className="mt-5 pt-5 border-t border-slate-100">
              <p className="text-sm font-bold text-slate-700 mb-3">Additional Documents</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {listing.documents.filter((d) => d.type !== "sticker").map((doc) => (
                  <a key={doc.url} href={doc.url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2.5 p-3 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
                    <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                    <span className="text-xs font-semibold text-slate-700 truncate">{doc.name}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ══ 12. TRADE VALUE MODULE ═══════════════════════════════ */}
      <div className="bg-slate-900">
        <div className="max-w-6xl mx-auto px-4 py-10">
          <div className="flex flex-col lg:flex-row items-start justify-between gap-8">
            <div className="text-white flex-1">
              <h2 className="text-3xl font-black mb-2">What's Your Trade Worth?</h2>
              <p className="text-slate-400 text-sm mb-6">Get a real offer in minutes with no obligation.</p>
              {/* Tab toggle */}
              <div className="flex bg-slate-800 rounded-xl p-1 gap-1 w-fit mb-4">
                <button
                  onClick={() => setTradeTab("vin")}
                  className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${tradeTab === "vin" ? "bg-white text-slate-900" : "text-slate-400 hover:text-white"}`}
                >
                  By VIN
                </button>
                <button
                  onClick={() => setTradeTab("plate")}
                  className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${tradeTab === "plate" ? "bg-white text-slate-900" : "text-slate-400 hover:text-white"}`}
                >
                  By License Plate
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  value={tradeInput}
                  onChange={(e) => setTradeInput(e.target.value)}
                  placeholder={tradeTab === "vin" ? "Enter VIN Number" : "Enter License Plate"}
                  className="flex-1 max-w-xs bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={() => {
                    if (!tradeInput.trim()) { toast.error("Please enter a VIN or license plate"); return; }
                    toast.success("Connecting to trade valuation — dealer will follow up shortly");
                  }}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-5 py-3 rounded-xl text-sm transition-colors whitespace-nowrap"
                >
                  Get My Trade Value
                </button>
              </div>
              <div className="flex gap-4 mt-4 text-xs text-slate-500">
                <span className="flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" />100% Secure</span>
                <span className="flex items-center gap-1"><CreditCard className="w-3.5 h-3.5" />No Credit Impact</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />Real Market Offers</span>
              </div>
            </div>
            {gallery[2] && (
              <div className="shrink-0 lg:w-64 rounded-2xl overflow-hidden opacity-60">
                <img src={gallery[2]} alt={ymm} className="w-full h-48 object-cover" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══ 13. CUSTOMER REVIEWS ═════════════════════════════════ */}
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

      {/* ══ 14. DEALER CTA ═══════════════════════════════════════ */}
      <div className="bg-blue-700">
        <div className="max-w-6xl mx-auto px-4 py-12">
          <div className="flex flex-col sm:flex-row items-start justify-between gap-8">
            <div className="text-white flex-1">
              <h2 className="text-3xl font-black mb-2">
                Ready to make the {ymmMakeModel || ymm || "vehicle"} yours?
              </h2>
              <p className="text-blue-200 text-sm mb-6">
                Our team is here to help you every step of the way — no pressure, no surprises.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {dealer.phone && (
                  <a href={`tel:${dealer.phone}`}
                    className="flex flex-col items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold px-4 py-4 rounded-xl transition-colors text-center">
                    <Phone className="w-5 h-5" />
                    <span className="text-xs">Call {formatPhone(dealer.phone as string)}</span>
                  </a>
                )}
                {dealer.phone && (
                  <a href={`sms:${dealer.phone}`}
                    className="flex flex-col items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold px-4 py-4 rounded-xl transition-colors text-center">
                    <MessageSquare className="w-5 h-5" />
                    <span className="text-xs">Text Us {formatPhone(dealer.phone as string)}</span>
                  </a>
                )}
                {dealer.email && (
                  <a href={`mailto:${dealer.email}`}
                    className="flex flex-col items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold px-4 py-4 rounded-xl transition-colors text-center">
                    <Mail className="w-5 h-5" />
                    <span className="text-xs">Email Us</span>
                  </a>
                )}
                {dealer.address && (
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(`${dealer.address} ${dealer.city || ""} ${dealer.state || ""}`)}`}
                    target="_blank" rel="noreferrer"
                    className="flex flex-col items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold px-4 py-4 rounded-xl transition-colors text-center">
                    <MapPin className="w-5 h-5" />
                    <span className="text-xs">Get Directions</span>
                  </a>
                )}
                {/* Fallbacks if dealer data is sparse */}
                {!dealer.phone && (
                  <button onClick={() => setInquiryOpen(true)}
                    className="flex flex-col items-center gap-2 bg-white text-blue-700 font-bold px-4 py-4 rounded-xl hover:bg-blue-50 transition-colors text-center col-span-2">
                    <MessageSquare className="w-5 h-5" />
                    <span className="text-xs">Contact Dealer</span>
                  </button>
                )}
              </div>
            </div>
            {(dealer.phone || dealer.name) && (
              <div className="text-white shrink-0 sm:text-right">
                {(dealer.logo_url as string) ? (
                  <img src={dealer.logo_url as string} alt={(dealer.name as string) || "Dealer"} className="h-10 w-auto mb-3 sm:ml-auto" />
                ) : null}
                {dealer.name && <p className="text-lg font-black text-white">{dealer.name as string}</p>}
                {dealer.address && (
                  <p className="text-blue-200 text-xs mt-1">
                    {dealer.address as string}{dealer.city ? `, ${dealer.city}` : ""}{dealer.state ? `, ${dealer.state}` : ""}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══ 15. FOOTER ════════════════════════════════════════════ */}
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
        <button className="flex-1 h-11 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors">
          <RefreshCw className="w-4 h-4" /> Value My Trade
        </button>
        <button onClick={() => setInquiryOpen(true)}
          className="flex-1 h-11 border-2 border-blue-600 text-blue-600 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 hover:bg-blue-50 transition-colors">
          <MessageSquare className="w-4 h-4" /> Contact
        </button>
      </div>

      {inquiryOpen && (
        <InquiryModal listing={listing} dealer={dealer} onClose={() => setInquiryOpen(false)} />
      )}
    </div>
  );
};

export default PublicListing;
