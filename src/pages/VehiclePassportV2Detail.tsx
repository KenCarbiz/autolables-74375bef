import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  ChevronLeft, Upload, Phone, MessageSquare, Send, CheckCircle2, ShieldCheck,
  TrendingUp, DollarSign, Clock, Car, Wrench, Award, Gauge as GaugeIcon, BadgeCheck,
  Building2, Truck, Star, Settings, Lock, Zap, Package, FileText, Calendar,
  User, Mail, PenLine, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { type VehicleListing } from "@/hooks/useVehicleListing";
import { usePublicListing } from "@/hooks/usePublicListing";
import { formatPhone } from "@/components/addendum/CustomerInfoSection";
import { trackLeadSubmitted, trackCustomerEngagement } from "@/lib/engagement/customerEngagement";
import Logo from "@/components/brand/Logo";
import { derivePassport, fmt$, type PassportData } from "@/lib/passportV2Data";
import { readBuildSheet } from "@/lib/buildSheet";
import { resolveTodaysPrice } from "@/lib/todaysPrice";
import TodaysPriceExperience from "@/components/passport/TodaysPriceExperience";
import TestDriveExperience from "@/components/passport/TestDriveExperience";
import { listingGallery, listingHero } from "@/lib/photos";
import { MOCK_LISTING } from "./VehiclePassportV3";

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

const leadErrorMessage = (dealerPhone?: string | null): React.ReactNode => {
  const tel = dealerPhone ? dealerPhone.replace(/[^\d+]/g, "") : "";
  return tel
    ? <span>Couldn't send — <a href={`tel:${tel}`} className="font-bold underline">call the dealership</a> instead</span>
    : "Couldn't send — please call the dealer directly";
};

// Compact deal-recap chips — only chips whose underlying data exists.
const dealRecapChips = (listing: VehicleListing, d: PassportData): string[] => {
  const bs = readBuildSheet(listing);
  const cov = d.dealerCoverage.find((c) => c.mode === "included");
  const reconPoints = d.recon?.workItems.length ?? 0;
  return [
    d.belowMarket && d.belowMarket > 0 ? `${fmt$(d.belowMarket)} below market` : null,
    bs?.estValue ? `${fmt$(bs.estValue)} in factory options` : null,
    cov?.title || null,
    reconPoints > 0 ? `${reconPoints}-point reconditioning` : null,
  ].filter(Boolean) as string[];
};

const DealRecap = ({ listing, d, className = "" }: { listing: VehicleListing; d: PassportData; className?: string }) => {
  const chips = dealRecapChips(listing, d);
  if (!chips.length) return null;
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {chips.map((c) => <span key={c} className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1"><CheckCircle2 className="w-3 h-3 shrink-0" />{c}</span>)}
    </div>
  );
};

const Stars = ({ n, size = 16 }: { n: number; size?: number }) => (
  <div className="inline-flex items-center gap-0.5">
    {[0, 1, 2, 3, 4].map((i) => (
      <Star key={i} className="text-amber-400" style={{ width: size, height: size }} fill={i < Math.round(n) ? "#fbbf24" : "none"} strokeWidth={1.5} />
    ))}
  </div>
);

// Honest "data not available yet" panel with a dealer-facing hint.
const Unavailable = ({ what, hint }: { what: string; hint?: string }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ vehicleSlug?: string; slug?: string }>();
  const slug = params.vehicleSlug ?? params.slug;
  const base = location.pathname.startsWith("/v/") ? "v" : location.pathname.startsWith("/passport-v3") ? "passport-v3" : "passport-v2";
  const q = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("preview") ? "?preview=1" : "";
  return (
    <Card className="p-6 text-center">
      <span className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3"><Package className="w-6 h-6" /></span>
      <p className="text-[15px] font-bold text-slate-700">{what} isn't available yet</p>
      <p className="text-[13px] text-slate-500 mt-1.5 max-w-sm mx-auto">{hint || "The dealership can add this information to the vehicle's passport. Contact them for the latest details."}</p>
      {slug && (
        <button onClick={() => navigate(`/${base}/${slug}/contact${q}`)} className="mt-4 h-11 px-5 rounded-xl bg-[#2563EB] text-white text-[13px] font-bold inline-flex items-center justify-center gap-2"><MessageSquare className="w-4 h-4" /> Contact the dealership</button>
      )}
    </Card>
  );
};

// ── Lead-capture form (shared by contact / trade / reserve / etc.) ──
// extraNotes lets intent pages append structured context (test-drive time,
// trade vehicle, ZIP) without new fields here.
const LeadForm = ({
  listing, intent, label, cta, onDone, extraNotes, dealerPhone, flowPrefix,
}: {
  listing: VehicleListing; intent: string; label: string; cta: string; onDone?: () => void; extraNotes?: () => string; dealerPhone?: string | null; flowPrefix?: string;
}) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [started, setStarted] = useState(false);
  const navigate = useNavigate();
  const markStarted = () => { if (!started && flowPrefix) { setStarted(true); trackFlow(listing, `${flowPrefix}_form_started`); } };

  const submit = async () => {
    if (!name.trim() || (!email.trim() && !phone.trim())) { toast.error("Name and a phone or email are required"); return; }
    setSending(true);
    try {
      // Attribution: QR scans persist ?src=qr for the session; the leads table
      // has a qr_scan source. On-lot leads must not be mislabeled "website".
      let src = "website";
      let zip = "";
      try {
        if (sessionStorage.getItem("al_visit_src") === "qr") src = "qr_scan";
        zip = sessionStorage.getItem("al_zip") || "";
      } catch { /* storage unavailable */ }
      const extras = [extraNotes?.() || "", zip ? `ZIP ${zip}` : ""].filter(Boolean).join(" · ");
      // Contact routing context resolved server-side by public-listing-view.
      // Rides on the lead so the store knows who the shopper was shown, and
      // lead-alert re-resolves (CRM ownership can only be checked at lead time).
      const routing = (listing as unknown as { contact_routing?: Record<string, unknown> }).contact_routing || null;
      const subSource = intent === "reserve" ? "reserve_vehicle" : intent === "trade" ? "trade_appraisal" : "contact";
      const basePayload = {
        store_id: listing.store_id, name: name.trim(), email: email.trim() || "", phone: phone.trim() || "",
        vehicle_interest: `${listing.ymm || "Vehicle"} (${label})`,
        vehicle_vin: listing.vin, source: src, status: "new",
        notes: `[intent=${intent}] Passport V2 — ${label}${extras ? ` · ${extras}` : ""}${message.trim() ? `: ${message.trim()}` : ""}`,
      };
      const routedPayload = {
        ...basePayload,
        sub_source: subSource,
        routing: routing ? {
          source: "customer_passport",
          routingTargetType: routing.routingTargetType ?? null,
          routingTargetId: routing.routingTargetId ?? null,
          routingReason: routing.routingReason ?? null,
          displayMode: routing.displayMode ?? null,
          afterHours: routing.afterHours ?? false,
        } : null,
      };
      // Anonymous shoppers can INSERT leads but not SELECT them back, so no
      // .select() here — lead-alert locates the fresh row with the service
      // role. The routing columns land with a migration; until it's applied
      // the routed insert fails — a lead must never be lost to that, so
      // retry with the bare payload.
      type LeadsTable = { from: (t: string) => { insert: (r: unknown) => Promise<{ error: unknown }> } };
      let insErr = (await (supabase as unknown as LeadsTable).from("leads").insert(routedPayload)).error;
      if (insErr) insErr = (await (supabase as unknown as LeadsTable).from("leads").insert(basePayload)).error;
      if (insErr) throw insErr;
      trackLeadSubmitted({ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: src === "qr_scan" ? "window_sticker_qr" : "passport", metadata: { intent, routing_target_type: (routing?.routingTargetType as string) ?? null } });
      // Fire-and-forget dealer alert — a submitted lead should page someone
      // faster than a page view does.
      supabase.functions.invoke("lead-alert", {
        body: { slug: listing.slug, vin: listing.vin, intent, name: name.trim(), phone: phone.trim() || null, email: email.trim() || null, source: src, sub_source: subSource },
      }).catch(() => { /* alert failure never blocks the shopper */ });
      if (flowPrefix) { trackFlow(listing, `${flowPrefix}_form_submitted`); trackFlow(listing, `${flowPrefix}_form_success`); }
      setSent(true);
      onDone?.();
    } catch {
      if (flowPrefix) trackFlow(listing, `${flowPrefix}_form_error`);
      toast.error(leadErrorMessage(dealerPhone));
    }
    finally { setSending(false); }
  };

  if (sent) return (
    <Card className="p-8 text-center">
      <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-3" />
      <h3 className="text-lg font-bold text-slate-900 mb-1">Request sent</h3>
      <p className="text-sm text-slate-500">A specialist from the dealership will follow up shortly.</p>
      {/* The moment after a yes is the cheapest moment to get a second yes. */}
      <div className="flex flex-col sm:flex-row gap-2 justify-center mt-5">
        {dealerPhone && <a href={`tel:${dealerPhone.replace(/[^\d+]/g, "")}`} className="h-11 px-5 rounded-xl bg-[#2563EB] text-white text-sm font-bold inline-flex items-center justify-center gap-2"><Phone className="w-4 h-4" /> Call now instead</a>}
        {intent !== "test_drive" && <button onClick={() => navigate(`/v/${listing.slug}/test-drive`)} className="h-11 px-5 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 inline-flex items-center justify-center gap-2"><Car className="w-4 h-4" /> Schedule a test drive</button>}
      </div>
    </Card>
  );

  return (
    <Card className="p-5">
      <div className="space-y-3" onInput={markStarted}>
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
  const stroke = "#059669";
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

// ── Reserve experience — a premium two-column reservation checkout ──
// Left: guided form (3-step trust row, labeled fields, contact method +
// timing intent, inline validation, what-happens-next). Right: sticky
// vehicle confidence card. Same leads-table wiring as LeadForm; the
// method/timing context rides in notes so no schema change is needed.

// Action-flow analytics (reserve / contact) ride the existing engagement
// event vocabulary; the specific flow event name travels in metadata.event.
const trackFlow = (listing: VehicleListing, event: string, extra: Record<string, unknown> = {}) =>
  trackCustomerEngagement({
    tenantId: listing.tenant_id, storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin,
    source: "passport", surface: "lead_form",
    eventType: event.endsWith("_viewed") ? "lead_form_opened" : event.endsWith("_clicked") ? "cta_clicked" : "engagement_ping",
    metadata: { event, ...extra },
  });

const RESERVE_STEPS = ["Submit Request", "Dealer Confirms Availability", "Vehicle Held For You"];
const RESERVE_TIMINGS = ["Today", "This Week"];
const CONTACT_METHODS: { key: string; label: string; icon: React.ElementType }[] = [
  { key: "call", label: "Call", icon: Phone },
  { key: "text", label: "Text", icon: MessageSquare },
  { key: "email", label: "Email", icon: Mail },
];

const reserveField = "w-full border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

const ReserveExperience = ({ listing, d, navigate }: { listing: VehicleListing; d: PassportData; navigate: ReturnType<typeof useNavigate> }) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<string | null>("text");
  const [timing, setTiming] = useState<string | null>("Today");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; contact?: string; email?: string }>({});
  const [started, setStarted] = useState(false);

  const isPreview = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("preview");
  useEffect(() => { if (!isPreview) trackFlow(listing, "reserve_page_viewed"); }, [listing, isPreview]);
  const markStarted = () => { if (!started) { setStarted(true); if (!isPreview) trackFlow(listing, "reserve_form_started"); } };

  const modelName = (listing.ymm || "").replace(/^\d{4}\s*/, "").trim() || "Vehicle";
  const heroSrc = listingHero(listing);
  const stockNo = (() => { const s = (listing.mc_attributes as Record<string, unknown> | null)?.stock_no; return s ? String(s) : null; })();

  const q = isPreview ? "?preview=1" : "";
  const goBack = () => { if (!isPreview) trackFlow(listing, "back_to_passport_clicked"); navigate(`/v/${listing.slug}${q}`); };
  const goTrade = () => { if (!isPreview) trackFlow(listing, "trade_value_clicked"); navigate(`/v/${listing.slug}/trade${q}`); };

  const submit = async () => {
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = "Enter your full name.";
    if (!email.trim() && !phone.trim()) errs.contact = "Add a phone number or email so the dealership can reach you.";
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) errs.email = "That email doesn't look right.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    // The sample passport must never write real leads or page a dealer.
    if (isPreview) { setSent(true); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    setSending(true);
    try {
      let src = "website";
      let zip = "";
      try {
        if (sessionStorage.getItem("al_visit_src") === "qr") src = "qr_scan";
        zip = sessionStorage.getItem("al_zip") || "";
      } catch { /* storage unavailable */ }
      const extras = [
        method ? `Prefers ${method}` : "",
        timing ? `Timing: ${timing}` : "",
        stockNo ? `Stock ${stockNo}` : "",
        zip ? `ZIP ${zip}` : "",
        "via vehicle_passport_reserve_page",
      ].filter(Boolean).join(" · ");
      const routing = (listing as unknown as { contact_routing?: Record<string, unknown> }).contact_routing || null;
      const basePayload = {
        store_id: listing.store_id, name: name.trim(), email: email.trim() || "", phone: phone.trim() || "",
        vehicle_interest: `${listing.ymm || "Vehicle"} (Reserve Vehicle)`,
        vehicle_vin: listing.vin, source: src, status: "new",
        notes: `[intent=reserve] Passport V2 — Reserve Vehicle · ${extras}${message.trim() ? `: ${message.trim()}` : ""}`,
      };
      const routedPayload = {
        ...basePayload,
        sub_source: "reserve_vehicle",
        routing: routing ? {
          source: "customer_passport",
          routingTargetType: routing.routingTargetType ?? null,
          routingTargetId: routing.routingTargetId ?? null,
          routingReason: routing.routingReason ?? null,
          displayMode: routing.displayMode ?? null,
          afterHours: routing.afterHours ?? false,
        } : null,
      };
      type LeadsTable = { from: (t: string) => { insert: (r: unknown) => Promise<{ error: unknown }> } };
      let insErr = (await (supabase as unknown as LeadsTable).from("leads").insert(routedPayload)).error;
      if (insErr) insErr = (await (supabase as unknown as LeadsTable).from("leads").insert(basePayload)).error;
      if (insErr) throw insErr;
      trackLeadSubmitted({ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: src === "qr_scan" ? "window_sticker_qr" : "passport", metadata: { intent: "reserve", event: "reserve_form_submitted", contact_method: method, timing, routing_target_type: (routing?.routingTargetType as string) ?? null } });
      supabase.functions.invoke("lead-alert", {
        body: { slug: listing.slug, vin: listing.vin, intent: "reserve", name: name.trim(), phone: phone.trim() || null, email: email.trim() || null, source: src, sub_source: "reserve_vehicle" },
      }).catch(() => { /* alert failure never blocks the shopper */ });
      trackFlow(listing, "reserve_form_success");
      setSent(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      trackFlow(listing, "reserve_form_error");
      toast.error(leadErrorMessage(d.dealerPhone));
    } finally { setSending(false); }
  };

  // Sticky vehicle confidence card (right rail on desktop).
  const summaryCard = (compact = false) => (
    <Card className={compact ? "p-3" : "p-5"}>
      {compact ? (
        <div className="flex items-center gap-3">
          {heroSrc && <img src={heroSrc} alt="" className="w-16 h-12 rounded-lg object-cover shrink-0" />}
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold leading-tight truncate">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</p>
            <p className="text-[15px] font-extrabold text-[#2563EB] leading-tight">{d.price != null ? fmt$(d.price) : ""}</p>
          </div>
          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 shrink-0">Currently Listed</span>
        </div>
      ) : (
        <>
          <div className="rounded-xl overflow-hidden bg-slate-100 aspect-[16/10] flex items-center justify-center">
            {heroSrc ? <img src={heroSrc} alt={listing.ymm ?? "Vehicle"} className="w-full h-full object-cover" /> : <Car className="w-8 h-8 text-slate-300" />}
          </div>
          <div className="flex items-start justify-between gap-2 mt-3.5">
            <p className="text-[17px] font-extrabold leading-tight">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</p>
            <span className="text-[10.5px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1 shrink-0 mt-0.5">Currently Listed</span>
          </div>
          {d.price != null && <p className="text-[26px] font-extrabold tracking-tight text-[#2563EB] mt-1">{fmt$(d.price)}</p>}
          <div className="mt-3 space-y-2 text-[12.5px] text-slate-600">
            {listing.mileage != null && <p className="flex items-center gap-2"><GaugeIcon className="w-4 h-4 text-slate-400 shrink-0" /> {listing.mileage.toLocaleString()} miles</p>}
            {listing.vin && <p className="flex items-center gap-2"><FileText className="w-4 h-4 text-slate-400 shrink-0" /> VIN <span className="text-slate-500">{listing.vin}</span></p>}
            {stockNo && <p className="flex items-center gap-2"><Package className="w-4 h-4 text-slate-400 shrink-0" /> Stock <span className="text-slate-500">#{stockNo}</span></p>}
            {d.dealerName && <p className="flex items-center gap-2"><Building2 className="w-4 h-4 text-slate-400 shrink-0" /> {d.dealerName}</p>}
          </div>
          <DealRecap listing={listing} d={d} className="mt-3" />
          <ul className="mt-4 space-y-2.5 border-t border-[#F1F5F9] pt-4">
            {["No payment required — the dealership confirms everything with you.", "Dealer-confirmed availability", "Linked to this exact Vehicle Passport"].map((b) => (
              <li key={b} className="flex items-start gap-2 text-[12.5px] text-slate-700"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />{b}</li>
            ))}
          </ul>
          <div className="mt-4 space-y-2 border-t border-[#F1F5F9] pt-4">
            <button onClick={goBack} className="w-full h-11 rounded-xl border border-[#E6E8EC] text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"><ChevronLeft className="w-4 h-4" /> Back to Vehicle Passport</button>
            <button onClick={goTrade} className="w-full h-11 rounded-xl border border-[#2563EB] text-[#2563EB] text-[13px] font-bold inline-flex items-center justify-center gap-1.5 hover:bg-blue-50"><RefreshCw className="w-4 h-4" /> Get Trade Value</button>
          </div>
        </>
      )}
    </Card>
  );

  if (sent) return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-7 items-start">
      <Card className="p-8 text-center">
        <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-3" />
        <h1 className="text-[24px] font-extrabold tracking-tight">Reservation Request Sent</h1>
        <p className="text-[14px] text-slate-500 mt-2 max-w-md mx-auto">{d.dealerName || "The dealership"} received your request and will confirm availability shortly.</p>
        <div className="mt-5 mx-auto max-w-sm rounded-xl border border-[#E6E8EC] bg-white p-3 flex items-center gap-3 text-left">
          {heroSrc && <img src={heroSrc} alt="" className="w-16 h-12 rounded-lg object-cover shrink-0" />}
          <div className="min-w-0">
            <p className="text-[13px] font-bold leading-tight truncate">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</p>
            {d.price != null && <p className="text-[14px] font-extrabold text-[#2563EB] leading-tight">{fmt$(d.price)}</p>}
          </div>
        </div>
        <div className="mt-3 mx-auto max-w-sm rounded-xl border border-[#E6E8EC] bg-slate-50 p-4 text-left">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">We'll reach you at</p>
          <p className="text-[14px] font-bold text-slate-900">{name}</p>
          {phone && <p className="text-[13px] text-slate-600 mt-0.5">{phone}</p>}
          {email && <p className="text-[13px] text-slate-600 mt-0.5">{email}</p>}
          {(method || timing) && <p className="text-[12px] text-slate-500 mt-1.5">{[method ? `Prefers ${method}` : null, timing].filter(Boolean).join(" · ")}</p>}
        </div>
        <div className="flex flex-col sm:flex-row gap-2 justify-center mt-6">
          <button onClick={goBack} className="h-11 px-5 rounded-xl bg-[#2563EB] text-white text-sm font-bold inline-flex items-center justify-center gap-2"><ChevronLeft className="w-4 h-4" /> Back to Vehicle Passport</button>
          {d.dealerPhone && <a href={`tel:${d.dealerPhone.replace(/[^\d+]/g, "")}`} className="h-11 px-5 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 inline-flex items-center justify-center gap-2"><Phone className="w-4 h-4" /> Call Dealer</a>}
          {d.dealerPhone && <a href={`sms:${d.dealerPhone.replace(/[^\d+]/g, "")}`} className="h-11 px-5 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 inline-flex items-center justify-center gap-2"><MessageSquare className="w-4 h-4" /> Text Dealer</a>}
        </div>
      </Card>
      <div className="hidden lg:block lg:sticky lg:top-24">{summaryCard()}</div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-7 items-start">
      <div className="space-y-4 min-w-0">
        {/* Compact vehicle strip stays visible on mobile without pushing the form down. */}
        <div className="lg:hidden">{summaryCard(true)}</div>

        <div id="reserve-form" className="scroll-mt-20">
        <Card className="p-5 sm:p-7">
          <h1 className="text-[24px] sm:text-[27px] font-extrabold tracking-tight leading-tight">Request a Hold on This {modelName}</h1>
          <p className="text-[13.5px] text-slate-500 mt-1.5 max-w-[560px]">Submit your reservation request and the dealership will confirm availability before placing this vehicle on hold. No payment is collected online.</p>

          {/* Slim progress strip — supports the form without dominating it. */}
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-2.5 flex items-center gap-2 sm:gap-3">
            {RESERVE_STEPS.map((label, i) => (
              <Fragment key={label}>
                {i > 0 && <span className="hidden sm:block flex-1 border-t border-slate-200 min-w-[14px]" />}
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-6 h-6 rounded-full bg-[#2563EB] text-white text-[11px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  <span className="text-[12px] font-semibold text-slate-700 leading-tight">{label}</span>
                </div>
              </Fragment>
            ))}
          </div>

          <div className="mt-5 space-y-3.5" onInput={markStarted}>
            <div>
              <label htmlFor="rsv-name" className="block text-[12px] font-semibold text-slate-600 mb-1">Full Name *</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input id="rsv-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Alex Morgan" aria-invalid={!!errors.name} aria-describedby={errors.name ? "rsv-name-err" : undefined} className={`${reserveField} pl-10 ${errors.name ? "border-red-300" : "border-slate-200"}`} />
              </div>
              {errors.name && <p id="rsv-name-err" className="text-[12px] text-red-600 mt-1">{errors.name}</p>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label htmlFor="rsv-email" className="block text-[12px] font-semibold text-slate-600 mb-1">Email Address</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input id="rsv-email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" inputMode="email" placeholder="alex@example.com" aria-invalid={!!errors.email} aria-describedby={errors.email ? "rsv-email-err" : undefined} className={`${reserveField} pl-10 ${errors.email ? "border-red-300" : "border-slate-200"}`} />
                </div>
                {errors.email && <p id="rsv-email-err" className="text-[12px] text-red-600 mt-1">{errors.email}</p>}
              </div>
              <div>
                <label htmlFor="rsv-phone" className="block text-[12px] font-semibold text-slate-600 mb-1">Mobile Phone</label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input id="rsv-phone" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} type="tel" autoComplete="tel" inputMode="tel" placeholder="(555) 123-4567" aria-invalid={!!errors.contact} aria-describedby={errors.contact ? "rsv-contact-err" : undefined} className={`${reserveField} pl-10 ${errors.contact ? "border-red-300" : "border-slate-200"}`} />
                </div>
                {errors.contact && <p id="rsv-contact-err" className="text-[12px] text-red-600 mt-1">{errors.contact}</p>}
              </div>
            </div>
            <div>
              <p className="text-[12px] font-semibold text-slate-600 mb-1.5">Preferred Contact Method</p>
              <div className="grid grid-cols-3 gap-2">
                {CONTACT_METHODS.map(({ key, label, icon: Icon }) => (
                  <button key={key} type="button" aria-pressed={method === key} onClick={() => { setMethod(key); markStarted(); if (!isPreview) trackFlow(listing, "reserve_contact_method_selected", { method: key }); }} className={`h-11 rounded-xl text-[13px] inline-flex items-center justify-center gap-1.5 border transition-colors ${method === key ? "bg-[#2563EB] border-[#2563EB] text-white font-bold" : "border-slate-200 text-slate-600 font-semibold hover:border-slate-300"}`}>
                    <Icon className="w-4 h-4" /> {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[12px] font-semibold text-slate-600 mb-1.5">When would you like to move forward?</p>
              <div className="flex flex-wrap gap-2">
                {RESERVE_TIMINGS.map((t) => (
                  <button key={t} type="button" aria-pressed={timing === t} onClick={() => { setTiming(t); markStarted(); if (!isPreview) trackFlow(listing, "reserve_timing_selected", { timing: t }); }} className={`h-10 px-4 rounded-full text-[13px] font-semibold border transition-colors ${timing === t ? "border-[#2563EB] bg-blue-50 text-[#2563EB]" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>{t}</button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="rsv-msg" className="block text-[12px] font-semibold text-slate-600 mb-1">Message to Dealer <span className="font-normal text-slate-400">(optional)</span></label>
              <div className="relative">
                <PenLine className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                <textarea id="rsv-msg" value={message} onChange={(e) => setMessage(e.target.value.slice(0, 500))} rows={3} maxLength={500} placeholder="Anything you'd like the dealership to know?" className={`${reserveField} pl-10 border-slate-200 resize-none`} />
                <span className="absolute bottom-2.5 right-3.5 text-[11px] text-slate-400">{message.length} / 500</span>
              </div>
            </div>
          </div>

          <button onClick={submit} disabled={sending} className="w-full h-12 mt-4 bg-[#2563EB] hover:bg-[#1d4fd7] disabled:opacity-60 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-colors">
            {sending ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><ShieldCheck className="w-5 h-5" /> Request Vehicle Hold</>}
          </button>
          <p className="text-[11.5px] text-slate-500 text-center mt-3">No payment collected. A dealership representative will confirm availability before placing the vehicle on hold.</p>
          <p className="text-[11px] text-slate-400 text-center mt-1.5 inline-flex w-full items-center justify-center gap-1.5 flex-wrap"><Lock className="w-3 h-3 text-slate-400 shrink-0" /> Secure request · No online payment · Dealer-confirmed availability</p>
        </Card>
        </div>

        <Card className="p-5 sm:p-6">
          <p className="text-[16px] font-bold text-slate-900">What Happens After You Submit?</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mt-4">
            {([
              [Calendar, "Availability is confirmed", "The dealership verifies the vehicle is still available."],
              [Phone, "You are contacted quickly", "A team member reaches out by phone, text, or email."],
              [FileText, "Your request is tied to this vehicle", "Your reservation request is documented against this exact vehicle."],
            ] as [React.ElementType, string, string][]).map(([Icon, t, s]) => (
              <div key={t} className="flex items-start gap-3">
                <Icon className="w-6 h-6 text-[#2563EB] shrink-0 mt-0.5" strokeWidth={1.75} />
                <div><p className="text-[13px] font-bold text-slate-800 leading-snug">{t}</p><p className="text-[12px] text-slate-500 mt-1">{s}</p></div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="hidden lg:block lg:sticky lg:top-24">{summaryCard()}</div>
    </div>
  );
};

// ── Contact experience — the same action-page system as Reserve ──
// Left: guided form (3-step strip, inquiry topic selector with dynamic
// message placeholders, labeled fields, contact method, inline validation)
// plus what-happens-next. Right: sticky vehicle confidence card + quick
// actions. Same leads-table wiring; topic/method context rides in notes.

const CONTACT_STEPS = ["Choose Topic", "Share Contact Info", "Dealer Replies"];
const CONTACT_TOPICS: { key: string; label: string; icon: React.ElementType; placeholder: (v: string) => string }[] = [
  { key: "availability", label: "Availability", icon: Car, placeholder: (v) => `I'm interested in this ${v}. Is it still available?` },
  { key: "price", label: "Price Question", icon: DollarSign, placeholder: (v) => `I have a question about the price on this ${v}.` },
  { key: "financing", label: "Financing", icon: FileText, placeholder: () => "I'd like to ask about financing options for this vehicle." },
  { key: "trade", label: "Trade-In", icon: RefreshCw, placeholder: () => "I have a trade-in and would like to understand my options." },
  { key: "history", label: "Vehicle History", icon: Clock, placeholder: () => "I'd like more information about the vehicle history." },
  { key: "warranty", label: "Warranty / Recall", icon: ShieldCheck, placeholder: () => "I'd like more information about warranty coverage or recall status." },
  { key: "other", label: "Other", icon: MessageSquare, placeholder: () => "I have a question about this vehicle." },
];

const ContactExperience = ({ listing, d, navigate }: { listing: VehicleListing; d: PassportData; navigate: ReturnType<typeof useNavigate> }) => {
  // Deep links can preselect a topic and seed the message (e.g. the warranty
  // panel's "Ask about this coverage" passes ?topic=warranty&about=<program>).
  const qp = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const qpTopic = qp?.get("topic") || "";
  const qpAbout = (qp?.get("about") || "").slice(0, 120);
  const [topic, setTopic] = useState(CONTACT_TOPICS.some((t) => t.key === qpTopic) ? qpTopic : "availability");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<string | null>("text");
  const [message, setMessage] = useState(qpAbout ? `I'd like to learn more about ${qpAbout}.` : "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; contact?: string; email?: string }>({});
  const [started, setStarted] = useState(false);

  const isPreview = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("preview");
  useEffect(() => { if (!isPreview) trackFlow(listing, "contact_dealer_page_viewed"); }, [listing, isPreview]);
  const markStarted = () => { if (!started) { setStarted(true); if (!isPreview) trackFlow(listing, "contact_form_started"); } };

  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const shortModel = (typeof mc.model === "string" && mc.model.trim()) || (listing.ymm || "").replace(/^\d{4}\s*/, "").trim() || "Vehicle";
  const vehicleLabel = `${listing.ymm || "vehicle"}${listing.trim ? ` ${listing.trim}` : ""}`;
  const heroSrc = listingHero(listing);
  const stockNo = mc.stock_no ? String(mc.stock_no) : null;
  const topicDef = CONTACT_TOPICS.find((t) => t.key === topic) ?? CONTACT_TOPICS[0];
  const dealerTel = d.dealerPhone ? d.dealerPhone.replace(/[^\d+]/g, "") : null;

  const q = isPreview ? "?preview=1" : "";
  const goBack = () => { if (!isPreview) trackFlow(listing, "back_to_passport_clicked"); navigate(`/v/${listing.slug}${q}`); };
  const goTrade = () => { if (!isPreview) trackFlow(listing, "trade_value_clicked"); navigate(`/v/${listing.slug}/trade${q}`); };
  const goReserve = () => { if (!isPreview) trackFlow(listing, "reserve_vehicle_clicked"); navigate(`/v/${listing.slug}/reserve${q}`); };
  const goTestDrive = () => { if (!isPreview) trackFlow(listing, "test_drive_clicked"); navigate(`/v/${listing.slug}/test-drive${q}`); };
  const trackCall = () => { if (!isPreview) trackFlow(listing, "call_dealer_clicked"); };
  const trackText = () => { if (!isPreview) trackFlow(listing, "text_dealer_clicked"); };

  const submit = async () => {
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = "Enter your full name.";
    if (!email.trim() && !phone.trim()) errs.contact = "Add a phone number or email so the dealership can reach you.";
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) errs.email = "That email doesn't look right.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    // The sample passport must never write real leads or page a dealer.
    if (isPreview) { setSent(true); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    setSending(true);
    try {
      let src = "website";
      let zip = "";
      try {
        if (sessionStorage.getItem("al_visit_src") === "qr") src = "qr_scan";
        zip = sessionStorage.getItem("al_zip") || "";
      } catch { /* storage unavailable */ }
      const extras = [
        `Topic: ${topicDef.label}`,
        method ? `Prefers ${method}` : "",
        stockNo ? `Stock ${stockNo}` : "",
        zip ? `ZIP ${zip}` : "",
        "via vehicle_passport_contact_dealer_page",
      ].filter(Boolean).join(" · ");
      const routing = (listing as unknown as { contact_routing?: Record<string, unknown> }).contact_routing || null;
      const basePayload = {
        store_id: listing.store_id, name: name.trim(), email: email.trim() || "", phone: phone.trim() || "",
        vehicle_interest: `${listing.ymm || "Vehicle"} (Contact Dealer)`,
        vehicle_vin: listing.vin, source: src, status: "new",
        notes: `[intent=contact] Passport V2 — Contact Dealer · ${extras}${message.trim() ? `: ${message.trim()}` : ""}`,
      };
      const routedPayload = {
        ...basePayload,
        sub_source: "contact",
        routing: routing ? {
          source: "customer_passport",
          routingTargetType: routing.routingTargetType ?? null,
          routingTargetId: routing.routingTargetId ?? null,
          routingReason: routing.routingReason ?? null,
          displayMode: routing.displayMode ?? null,
          afterHours: routing.afterHours ?? false,
        } : null,
      };
      type LeadsTable = { from: (t: string) => { insert: (r: unknown) => Promise<{ error: unknown }> } };
      let insErr = (await (supabase as unknown as LeadsTable).from("leads").insert(routedPayload)).error;
      if (insErr) insErr = (await (supabase as unknown as LeadsTable).from("leads").insert(basePayload)).error;
      if (insErr) throw insErr;
      trackLeadSubmitted({ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: src === "qr_scan" ? "window_sticker_qr" : "passport", metadata: { intent: "contact", event: "contact_form_submitted", topic, contact_method: method, routing_target_type: (routing?.routingTargetType as string) ?? null } });
      supabase.functions.invoke("lead-alert", {
        body: { slug: listing.slug, vin: listing.vin, intent: "contact", name: name.trim(), phone: phone.trim() || null, email: email.trim() || null, source: src, sub_source: "contact", topic: topicDef.label },
      }).catch(() => { /* alert failure never blocks the shopper */ });
      trackFlow(listing, "contact_form_success");
      setSent(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      trackFlow(listing, "contact_form_error");
      toast.error(leadErrorMessage(d.dealerPhone));
    } finally { setSending(false); }
  };

  // Sticky vehicle confidence card (right rail on desktop).
  const summaryCard = (compact = false) => (
    <Card className={compact ? "p-3" : "p-5"}>
      {compact ? (
        <div className="flex items-center gap-3">
          {heroSrc && <img src={heroSrc} alt="" className="w-16 h-12 rounded-lg object-cover shrink-0" />}
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold leading-tight truncate">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</p>
            <p className="text-[15px] font-extrabold text-[#2563EB] leading-tight">{d.price != null ? fmt$(d.price) : ""}</p>
          </div>
          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 shrink-0">Currently Listed</span>
        </div>
      ) : (
        <>
          <div className="rounded-xl overflow-hidden bg-slate-100 aspect-[16/10] flex items-center justify-center">
            {heroSrc ? <img src={heroSrc} alt={listing.ymm ?? "Vehicle"} className="w-full h-full object-cover" /> : <Car className="w-8 h-8 text-slate-300" />}
          </div>
          <div className="flex items-start justify-between gap-2 mt-3.5">
            <p className="text-[17px] font-extrabold leading-tight">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</p>
            <span className="text-[10.5px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1 shrink-0 mt-0.5">Currently Listed</span>
          </div>
          {d.price != null && <p className="text-[26px] font-extrabold tracking-tight text-[#2563EB] mt-1">{fmt$(d.price)}</p>}
          <div className="mt-3 space-y-2 text-[12.5px] text-slate-600">
            {listing.mileage != null && <p className="flex items-center gap-2"><GaugeIcon className="w-4 h-4 text-slate-400 shrink-0" /> {listing.mileage.toLocaleString()} miles</p>}
            {listing.vin && <p className="flex items-center gap-2"><FileText className="w-4 h-4 text-slate-400 shrink-0" /> VIN <span className="text-slate-500">{listing.vin}</span></p>}
            {stockNo && <p className="flex items-center gap-2"><Package className="w-4 h-4 text-slate-400 shrink-0" /> Stock <span className="text-slate-500">#{stockNo}</span></p>}
            {d.dealerName && <p className="flex items-center gap-2"><Building2 className="w-4 h-4 text-slate-400 shrink-0" /> {d.dealerName}</p>}
          </div>
          <DealRecap listing={listing} d={d} className="mt-3" />
          <ul className="mt-4 space-y-2.5 border-t border-[#F1F5F9] pt-4">
            {["Message tied to this exact vehicle", "Dealer receives vehicle details automatically", "No obligation", "Vehicle Passport included"].map((b) => (
              <li key={b} className="flex items-start gap-2 text-[12.5px] text-slate-700"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />{b}</li>
            ))}
          </ul>
          <div className="mt-4 space-y-2 border-t border-[#F1F5F9] pt-4">
            <button onClick={goBack} className="w-full h-11 rounded-xl border border-[#E6E8EC] text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"><ChevronLeft className="w-4 h-4" /> Back to Vehicle Passport</button>
            <button onClick={goReserve} className="w-full h-11 rounded-xl border border-[#2563EB] text-[#2563EB] text-[13px] font-bold inline-flex items-center justify-center gap-1.5 hover:bg-blue-50"><BadgeCheck className="w-4 h-4" /> Reserve This Vehicle</button>
            <button onClick={goTrade} className="w-full h-11 rounded-xl border border-[#2563EB] text-[#2563EB] text-[13px] font-bold inline-flex items-center justify-center gap-1.5 hover:bg-blue-50"><RefreshCw className="w-4 h-4" /> Get Trade Value</button>
          </div>
        </>
      )}
    </Card>
  );

  // Quick paths for shoppers who don't want to wait on a form reply.
  const fasterCard = (
    <Card className="p-5">
      <p className="text-[15px] font-bold text-slate-900">Need something faster?</p>
      <div className="grid grid-cols-2 gap-2.5 mt-3">
        {dealerTel && <a href={`tel:${dealerTel}`} onClick={trackCall} className="h-11 rounded-xl border border-[#E6E8EC] text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"><Phone className="w-4 h-4 text-[#2563EB]" /> Call Dealer</a>}
        {dealerTel && <a href={`sms:${dealerTel}`} onClick={trackText} className="h-11 rounded-xl border border-[#E6E8EC] text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"><MessageSquare className="w-4 h-4 text-[#2563EB]" /> Text Dealer</a>}
        <button onClick={goTestDrive} className="h-11 rounded-xl border border-[#E6E8EC] text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"><Calendar className="w-4 h-4 text-[#2563EB]" /> Schedule Test Drive</button>
        <button onClick={goReserve} className="h-11 rounded-xl border border-[#E6E8EC] text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"><BadgeCheck className="w-4 h-4 text-[#2563EB]" /> Reserve Vehicle</button>
      </div>
    </Card>
  );

  if (sent) return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-7 items-start">
      <Card className="p-8 text-center">
        <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-3" />
        <h1 className="text-[24px] font-extrabold tracking-tight">Message Sent</h1>
        <p className="text-[14px] text-slate-500 mt-2 max-w-md mx-auto">{d.dealerName || "The dealership"} received your message and will reply shortly.</p>
        <div className="mt-5 mx-auto max-w-sm rounded-xl border border-[#E6E8EC] bg-white p-3 flex items-center gap-3 text-left">
          {heroSrc && <img src={heroSrc} alt="" className="w-16 h-12 rounded-lg object-cover shrink-0" />}
          <div className="min-w-0">
            <p className="text-[13px] font-bold leading-tight truncate">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</p>
            {d.price != null && <p className="text-[14px] font-extrabold text-[#2563EB] leading-tight">{fmt$(d.price)}</p>}
          </div>
        </div>
        <div className="mt-3 mx-auto max-w-sm rounded-xl border border-[#E6E8EC] bg-slate-50 p-4 text-left">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Your inquiry</p>
          <p className="text-[13px] font-semibold text-slate-800">{topicDef.label}</p>
          <p className="text-[14px] font-bold text-slate-900 mt-2">{name}</p>
          {phone && <p className="text-[13px] text-slate-600 mt-0.5">{phone}</p>}
          {email && <p className="text-[13px] text-slate-600 mt-0.5">{email}</p>}
          {method && <p className="text-[12px] text-slate-500 mt-1.5">Prefers {method}</p>}
          {message.trim() && <p className="text-[12.5px] text-slate-600 mt-2 border-t border-slate-200 pt-2 italic">"{message.trim()}"</p>}
        </div>
        <div className="flex flex-wrap gap-2 justify-center mt-6">
          <button onClick={goBack} className="h-11 px-5 rounded-xl bg-[#2563EB] text-white text-sm font-bold inline-flex items-center justify-center gap-2"><ChevronLeft className="w-4 h-4" /> Back to Vehicle Passport</button>
          {dealerTel && <a href={`tel:${dealerTel}`} onClick={trackCall} className="h-11 px-5 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 inline-flex items-center justify-center gap-2"><Phone className="w-4 h-4" /> Call Dealer</a>}
          {dealerTel && <a href={`sms:${dealerTel}`} onClick={trackText} className="h-11 px-5 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 inline-flex items-center justify-center gap-2"><MessageSquare className="w-4 h-4" /> Text Dealer</a>}
          <button onClick={goReserve} className="h-11 px-5 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 inline-flex items-center justify-center gap-2"><BadgeCheck className="w-4 h-4" /> Reserve This Vehicle</button>
          <button onClick={goTestDrive} className="h-11 px-5 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 inline-flex items-center justify-center gap-2"><Calendar className="w-4 h-4" /> Schedule Test Drive</button>
        </div>
      </Card>
      <div className="hidden lg:block lg:sticky lg:top-24">{summaryCard()}</div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-7 items-start">
      <div className="space-y-4 min-w-0">
        {/* Compact vehicle strip stays visible on mobile without pushing the form down. */}
        <div className="lg:hidden">{summaryCard(true)}</div>

        <div id="contact-form" className="scroll-mt-20">
        <Card className="p-5 sm:p-7">
          <h1 className="text-[24px] sm:text-[27px] font-extrabold tracking-tight leading-tight">Contact {d.dealerName || "the Dealership"} About This {shortModel}</h1>
          <p className="text-[13.5px] text-slate-500 mt-1.5 max-w-[560px]">Ask a question about availability, pricing, financing, trade value, history, warranty, or next steps.</p>

          {/* Slim progress strip — supports the form without dominating it. */}
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-2.5 flex items-center gap-2 sm:gap-3">
            {CONTACT_STEPS.map((label, i) => (
              <Fragment key={label}>
                {i > 0 && <span className="hidden sm:block flex-1 border-t border-slate-200 min-w-[14px]" />}
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${i === 0 ? "bg-[#2563EB] text-white" : "bg-white border border-slate-300 text-slate-500"}`}>{i + 1}</span>
                  <span className="text-[12px] font-semibold text-slate-700 leading-tight">{label}</span>
                </div>
              </Fragment>
            ))}
          </div>

          <div className="mt-5">
            <p className="text-[12px] font-semibold text-slate-600 mb-1.5">What can we help with?</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {CONTACT_TOPICS.map(({ key, label, icon: Icon }) => (
                <button key={key} type="button" aria-pressed={topic === key} onClick={() => { setTopic(key); markStarted(); if (!isPreview) trackFlow(listing, "contact_topic_selected", { topic: key }); }} className={`h-11 rounded-xl text-[12.5px] inline-flex items-center justify-center gap-1.5 border px-2 transition-colors ${topic === key ? "border-[#2563EB] bg-blue-50 text-[#2563EB] font-bold" : "border-slate-200 text-slate-600 font-semibold hover:border-slate-300"}`}>
                  <Icon className="w-4 h-4 shrink-0" /> <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 space-y-3.5" onInput={markStarted}>
            <div>
              <label htmlFor="ct-msg" className="block text-[12px] font-semibold text-slate-600 mb-1">Message to Dealer <span className="font-normal text-slate-400">(optional)</span></label>
              <div className="relative">
                <PenLine className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                <textarea id="ct-msg" value={message} onChange={(e) => setMessage(e.target.value.slice(0, 500))} rows={3} maxLength={500} placeholder={topicDef.placeholder(vehicleLabel)} className={`${reserveField} pl-10 border-slate-200 resize-none`} />
                <span className="absolute bottom-2.5 right-3.5 text-[11px] text-slate-400">{message.length} / 500</span>
              </div>
            </div>
            <div>
              <label htmlFor="ct-name" className="block text-[12px] font-semibold text-slate-600 mb-1">Full Name *</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input id="ct-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Alex Morgan" aria-invalid={!!errors.name} aria-describedby={errors.name ? "ct-name-err" : undefined} className={`${reserveField} pl-10 ${errors.name ? "border-red-300" : "border-slate-200"}`} />
              </div>
              {errors.name && <p id="ct-name-err" className="text-[12px] text-red-600 mt-1">{errors.name}</p>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label htmlFor="ct-email" className="block text-[12px] font-semibold text-slate-600 mb-1">Email Address</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input id="ct-email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" inputMode="email" placeholder="alex@example.com" aria-invalid={!!errors.email} aria-describedby={errors.email ? "ct-email-err" : undefined} className={`${reserveField} pl-10 ${errors.email ? "border-red-300" : "border-slate-200"}`} />
                </div>
                {errors.email && <p id="ct-email-err" className="text-[12px] text-red-600 mt-1">{errors.email}</p>}
              </div>
              <div>
                <label htmlFor="ct-phone" className="block text-[12px] font-semibold text-slate-600 mb-1">Mobile Phone</label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input id="ct-phone" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} type="tel" autoComplete="tel" inputMode="tel" placeholder="(555) 123-4567" aria-invalid={!!errors.contact} aria-describedby={errors.contact ? "ct-contact-err" : undefined} className={`${reserveField} pl-10 ${errors.contact ? "border-red-300" : "border-slate-200"}`} />
                </div>
                {errors.contact && <p id="ct-contact-err" className="text-[12px] text-red-600 mt-1">{errors.contact}</p>}
              </div>
            </div>
            <div>
              <p className="text-[12px] font-semibold text-slate-600 mb-1.5">Preferred Contact Method *</p>
              <div className="grid grid-cols-3 gap-2">
                {CONTACT_METHODS.map(({ key, label, icon: Icon }) => (
                  <button key={key} type="button" aria-pressed={method === key} onClick={() => { setMethod(key); markStarted(); if (!isPreview) trackFlow(listing, "contact_method_selected", { method: key }); }} className={`h-11 rounded-xl text-[13px] inline-flex items-center justify-center gap-1.5 border transition-colors ${method === key ? "bg-[#2563EB] border-[#2563EB] text-white font-bold" : "border-slate-200 text-slate-600 font-semibold hover:border-slate-300"}`}>
                    <Icon className="w-4 h-4" /> {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button onClick={submit} disabled={sending} className="w-full h-12 mt-4 bg-[#2563EB] hover:bg-[#1d4fd7] disabled:opacity-60 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-colors">
            {sending ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><Send className="w-4 h-4" /> Ask About This {shortModel}</>}
          </button>
          <p className="text-[11.5px] text-slate-500 text-center mt-3">No obligation. A dealership representative will reply by your preferred contact method.</p>
          <p className="text-[11px] text-slate-400 text-center mt-1.5 inline-flex w-full items-center justify-center gap-1.5 flex-wrap"><Lock className="w-3 h-3 text-slate-400 shrink-0" /> Secure request · Dealer-reviewed inquiry · No obligation</p>
        </Card>
        </div>

        <Card className="p-5 sm:p-6">
          <p className="text-[16px] font-bold text-slate-900">What Happens After You Submit?</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mt-4">
            {([
              [FileText, "Your message is tied to this vehicle", "The dealership receives your question with the exact VIN, stock number, and Vehicle Passport."],
              [User, "A specialist reviews your request", "Your selected topic helps the dealer route your inquiry correctly."],
              [MessageSquare, "You receive a reply", "A team member contacts you by phone, text, or email."],
            ] as [React.ElementType, string, string][]).map(([Icon, t, s]) => (
              <div key={t} className="flex items-start gap-3">
                <Icon className="w-6 h-6 text-[#2563EB] shrink-0 mt-0.5" strokeWidth={1.75} />
                <div><p className="text-[13px] font-bold text-slate-800 leading-snug">{t}</p><p className="text-[12px] text-slate-500 mt-1">{s}</p></div>
              </div>
            ))}
          </div>
        </Card>

        <div className="lg:hidden">{fasterCard}</div>
      </div>

      <div className="hidden lg:block lg:sticky lg:top-24 space-y-4">
        {summaryCard()}
        {fasterCard}
      </div>
    </div>
  );
};

// ── Section registry ──────────────────────────────────────────
type SectionRender = (ctx: { d: PassportData; listing: VehicleListing; slug: string; navigate: ReturnType<typeof useNavigate> }) => React.ReactNode;

const SECTIONS: Record<string, { title: string; render: SectionRender; wide?: boolean; hideCrossCta?: boolean; headerPill?: string }> = {
  "verification-report": {
    title: "Verification Report",
    render: ({ d }) => (
      <>
        <SectionHeading icon={ShieldCheck} title="Verification Report" subtitle="Every check on this vehicle against trusted automotive data." />
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
            <p className="text-[11px] text-slate-400 mt-3 leading-snug">Verification reflects data provided by third-party sources (vehicle history, live market data, NHTSA) and the dealership. Confirm details directly with the dealer before purchase.</p>
          </Card>
        )}
      </>
    ),
  },
  "market-price": {
    title: "Market Price Analysis",
    render: ({ d }) => {
      const hasRange = d.marketLow != null && d.marketHigh != null;
      const showAvg = d.marketAvg != null && d.price != null && d.price <= d.marketAvg;
      return (
        <>
          <SectionHeading icon={DollarSign} title="Market Price Analysis" subtitle="How this vehicle's price compares to the market." />
          {d.price != null && (hasRange || showAvg) ? (
            <Card className="p-5">
              {d.belowMarket && d.belowMarket > 0 && <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-600 text-white text-[13px] font-bold mb-3"><BadgeCheck className="w-4 h-4" /> Great Price · {fmt$(d.belowMarket)} below market average</div>}
              {hasRange ? (
                <div className="grid grid-cols-3 text-center text-[13px] gap-2">
                  <div className="rounded-xl bg-slate-50 py-3"><div className="text-slate-500 text-[11px]">Market Low</div><div className="font-bold mt-0.5">{fmt$(d.marketLow)}</div></div>
                  <div className="rounded-xl bg-emerald-50 py-3"><div className="text-emerald-600 text-[11px]">Our Price</div><div className="font-extrabold text-emerald-700 mt-0.5">{fmt$(d.price)}</div></div>
                  <div className="rounded-xl bg-slate-50 py-3"><div className="text-slate-500 text-[11px]">Market High</div><div className="font-bold mt-0.5">{fmt$(d.marketHigh)}</div></div>
                </div>
              ) : (
                <div className="rounded-xl bg-emerald-50 text-center text-[13px] py-3"><div className="text-emerald-600 text-[11px]">Our Price</div><div className="font-extrabold text-emerald-700 mt-0.5">{fmt$(d.price)}</div></div>
              )}
              {showAvg && (
                <div className="mt-3 flex items-center justify-between text-[13px] rounded-xl bg-slate-50 px-4 py-3">
                  <span className="text-slate-500">Market average</span><span className="font-bold">{fmt$(d.marketAvg)}</span>
                </div>
              )}
              <p className="text-[11px] text-slate-400 mt-3 leading-snug">Market values provided by third-party data sources. Actual market conditions may vary by region and time.</p>
            </Card>
          ) : <Unavailable what="Market pricing" hint="Live market comparables are not yet available for this vehicle." />}
        </>
      );
    },
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
              <li className="flex items-center gap-2.5"><CheckCircle2 className="w-4 h-4 text-emerald-600" />Compared against live market data</li>
            </ul>
            <p className="text-[11px] text-slate-400 mt-3">Powered by live market data.</p>
          </Card>
        ) : d.marketAvg != null ? (
          <Card className="p-5"><p className="text-xl font-extrabold text-blue-600">Fair</p><p className="text-[14px] text-slate-600 mt-0.5">Priced in line with the local market.</p><p className="text-[11px] text-slate-400 mt-3">Powered by live market data.</p></Card>
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
                  {d.priceChange7d != null && d.priceChange7d <= 0 && (
                    <div><p className="text-[11px] text-slate-500">7-Day change</p><p className={`text-[20px] font-extrabold ${d.priceChange7d < 0 ? "text-emerald-600" : "text-slate-900"}`}>{d.priceChange7d === 0 ? "No change" : `-${fmt$(Math.abs(d.priceChange7d))}`}</p></div>
                  )}
                  {d.priceChangeTotal != null && d.priceChangeTotal <= 0 && (
                    <div><p className="text-[11px] text-slate-500">Since first tracked</p><p className={`text-[20px] font-extrabold ${d.priceChangeTotal < 0 ? "text-emerald-600" : "text-slate-900"}`}>{d.priceChangeTotal === 0 ? "No change" : `-${fmt$(Math.abs(d.priceChangeTotal))}`}</p></div>
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
                <p className="text-[11px] text-slate-400 mt-3">Powered by live market price tracking.</p>
              </Card>
            </>
          ) : <Unavailable what="Price history" hint="We need at least two captured price points to show a trend. Tracking continues as this vehicle is re-checked." />}
        </>
      );
    },
  },
  "comparable-vehicles": {
    title: "Comparable Vehicles",
    render: ({ slug, listing, d }) => <CompsSection slug={slug} listing={listing} d={d} />,
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
          const milesPct = w.factory_miles && listing.mileage != null ? Math.max(4, 100 - Math.min(100, (listing.mileage / w.factory_miles) * 100)) : null;
          let yrsLeft: number | null = null; let expiry: string | null = null;
          if (w.in_service_date && w.factory_months) {
            const end = new Date(w.in_service_date); end.setMonth(end.getMonth() + w.factory_months);
            expiry = end.toLocaleDateString();
            const ms = end.getTime() - Date.now(); yrsLeft = ms > 0 ? ms / (1000 * 60 * 60 * 24 * 365) : 0;
          }
          return (
            <Card className="p-5">
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 mb-2"><ShieldCheck className="w-3 h-3" /> OEM Data</span>
              <p className="text-base font-bold">Factory warranty remaining</p>
              {milesPct != null && <div className="mt-3 h-3 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${milesPct}%` }} /></div>}
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
    render: ({ d, listing }) => (
      <>
        <SectionHeading icon={Award} title="Available Offers" subtitle="Current incentives and programs." />
        {d.offers.length > 0 ? (
          <div className="space-y-3">
            {d.offers.map((o, i) => (
              <Card key={i} className="p-4"><p className="text-[15px] font-bold">{o.title}</p><p className="text-[13px] text-slate-600 mt-0.5">{o.body}</p>{o.exp && <p className="text-[12px] text-slate-400 mt-0.5">{o.exp}</p>}</Card>
            ))}
          </div>
        ) : (
          <>
            {/* No published offers ≠ dead end: the shopper who typed a ZIP gets
                a form, not an apology. */}
            <p className="text-[14px] text-slate-600 mb-4">The dealership will send you today's best offer on this vehicle directly.</p>
            <LeadForm listing={listing} intent="offers" label="Best Offer Request" cta="Get today's best offer" dealerPhone={d.dealerPhone} />
          </>
        )}
      </>
    ),
  },
  "todays-price": {
    title: "Today's Price",
    wide: true,
    hideCrossCta: true,
    render: ({ d, listing }) => <TodaysPriceExperience listing={listing} d={d} />,
  },
  // ── Lead-capture sections ──
  "check-availability": {
    title: "Check Availability",
    render: ({ listing, d }) => (<><SectionHeading icon={CheckCircle2} title="Check Availability" subtitle="Confirm this vehicle is still available and get details." /><DealRecap listing={listing} d={d} className="mb-3" /><LeadForm listing={listing} intent="check_availability" label="Check Availability" cta="Check availability" dealerPhone={d.dealerPhone} /></>),
  },
  "contact": {
    title: "Contact the Dealer",
    wide: true,
    hideCrossCta: true,
    headerPill: "Currently Listed",
    render: ({ listing, d, navigate }) => <ContactExperience listing={listing} d={d} navigate={navigate} />,
  },
  "trade": {
    title: "Value My Trade",
    render: ({ listing, d }) => (<><SectionHeading icon={GaugeIcon} title="Value My Trade" subtitle="Know your trade value in minutes." /><DealRecap listing={listing} d={d} className="mb-3" /><LeadForm listing={listing} intent="trade" label="Value My Trade" cta="Get my trade value" dealerPhone={d.dealerPhone} /></>),
  },
  "reserve": {
    title: "Reserve This Vehicle",
    wide: true,
    hideCrossCta: true,
    headerPill: "Currently Listed",
    render: ({ listing, d, navigate }) => <ReserveExperience listing={listing} d={d} navigate={navigate} />,
  },
  "test-drive": {
    title: "Schedule a Test Drive",
    wide: true,
    hideCrossCta: true,
    render: ({ listing, d, navigate }) => <TestDriveExperience listing={listing} d={d} navigate={navigate} />,
  },
  "text": {
    title: "Text the Dealer",
    render: ({ listing, d }) => (
      <>
        <SectionHeading icon={MessageSquare} title="Text the Dealer" subtitle="Get a quick reply by text." />
        {d.dealerPhone && (
          <Card className="p-5 mb-4 text-center">
            <p className="text-[13px] text-slate-600 mb-3">Open your messages app to text the dealership directly.</p>
            <a href={`sms:${d.dealerPhone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(`Hi, I'm interested in the ${listing.ymm || "vehicle"}${listing.vin ? ` (VIN ...${listing.vin.slice(-8)})` : ""} — is it available?`)}`} className="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-xl bg-[#2563EB] text-white font-bold"><Send className="w-4 h-4" /> Text {formatPhone(d.dealerPhone)}</a>
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
// Comparable Vehicles — a sales-support view, not raw market research. The
// server (marketcheck-comps) applies the dealer's comp strategy, which by
// default only returns comps priced at or above this vehicle that are
// similar enough to be a fair comparison. Aggregate stats stay market-wide
// and honest; only the visible list is curated.
const CompsSection = ({ slug, listing, d }: { slug: string; listing: VehicleListing; d: PassportData }) => {
  const [state, setState] = useState<"loading" | "ready" | "empty">("loading");
  const [reason, setReason] = useState<string | null>(null);
  const [data, setData] = useState<{ count: number; median: number | null; comparables: { vin: string | null; price: number | null; miles: number | null; heading: string; trim: string | null; dealer: string; distance: number | null }[] } | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: res } = await supabase.functions.invoke("marketcheck-comps", { body: { slug } });
        if (!mounted) return;
        if (res && (res as { available?: boolean }).available) { setData(res as typeof data); setState("ready"); }
        else { setReason((res as { reason?: string })?.reason ?? null); setState("empty"); }
      } catch { if (mounted) setState("empty"); }
    })();
    return () => { mounted = false; };
  }, [slug]);

  const ourPrice = d.price;
  const comps = data?.comparables ?? [];
  const allAtOrAbove = ourPrice != null && comps.length > 0 && comps.every((c) => c.price == null || c.price >= ourPrice);

  return (
    <>
      <SectionHeading icon={Car} title="Comparable Vehicles Supporting This Value" subtitle="Similar nearby listings help show how this vehicle is positioned in the market." />
      {state === "loading" ? (
        <Card className="p-5"><div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse" />)}</div></Card>
      ) : state === "empty" || !data ? (
        reason === "no_value_comps"
          ? <Unavailable what="Comparable listings" hint="A fair comparison set isn't available for this vehicle right now." />
          : <Unavailable what="Comparable listings" hint="A live comparable set (year, trim, mileage, and price) is sourced from live market data and appears here when available for this vehicle and market." />
      ) : (
        <>
          <Card className="p-5">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <div><p className="text-[11px] text-slate-500">Comparable vehicles analyzed</p><p className="text-[22px] font-extrabold">{(d.marketMeta.similarCount ?? data.count).toLocaleString()}</p></div>
              {data.median != null && ourPrice != null && data.median >= ourPrice && <div><p className="text-[11px] text-slate-500">Comparable median</p><p className="text-[22px] font-extrabold">{fmt$(data.median)}</p></div>}
              {ourPrice != null && <div><p className="text-[11px] text-slate-500">This vehicle</p><p className="text-[22px] font-extrabold text-[#2563EB]">{fmt$(ourPrice)}</p></div>}
            </div>
            {allAtOrAbove && (
              <p className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> This vehicle is priced below these comparable local listings.
              </p>
            )}
            <p className="text-[11px] text-slate-400 mt-3">Market statistics from live market data.</p>
          </Card>
          {comps.length > 0 && (
            <Card className="p-5 mt-4">
              <div className="grid grid-cols-[minmax(0,1.6fr)_auto_auto_auto] gap-x-4 gap-y-2 text-[12.5px]">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Vehicle</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 text-right">Miles</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 text-right">Price</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 text-right">Difference</span>
                <span className="font-bold text-[#0F172A] truncate">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</span>
                <span className="text-right font-semibold">{listing.mileage != null ? listing.mileage.toLocaleString() : "—"}</span>
                <span className="text-right font-extrabold text-[#2563EB]">{ourPrice != null ? fmt$(ourPrice) : "—"}</span>
                <span className="text-right text-[11px] font-bold text-[#2563EB]">This vehicle</span>
                {comps.map((c, i) => {
                  const diff = ourPrice != null && c.price != null ? c.price - ourPrice : null;
                  return (
                    <Fragment key={c.vin || i}>
                      <span className="text-slate-600 truncate border-t border-slate-100 pt-2">{c.heading}</span>
                      <span className="text-right text-slate-600 border-t border-slate-100 pt-2">{c.miles != null ? c.miles.toLocaleString() : "—"}</span>
                      <span className="text-right font-semibold border-t border-slate-100 pt-2">{c.price != null ? fmt$(c.price) : "—"}</span>
                      <span className={`text-right font-semibold border-t border-slate-100 pt-2 ${diff != null && diff > 0 ? "text-emerald-700" : "text-slate-500"}`}>
                        {diff == null ? "—" : diff > 0 ? `+${fmt$(diff)}` : diff === 0 ? "Same" : `−${fmt$(Math.abs(diff))}`}
                      </span>
                    </Fragment>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-400 mt-3">Comparable listings from live market data.</p>
            </Card>
          )}
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
  // The sample passport (/v/demo?preview=1) links into these detail pages;
  // without preview support they dead-end at "Vehicle unavailable".
  const isPreview = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("preview");
  const { listing, loading, notFound } = usePublicListing(vehicleSlug, { preview: isPreview, previewData: MOCK_LISTING as unknown as VehicleListing });

  // Old shared links to the V2-era features/specifications pages redirect to
  // the passport's richer slide-out panels (deep-linked via ?panel=).
  const PANEL_SHIMS: Record<string, string> = { features: "highlights", specifications: "key-specs" };
  const shimPanel = section ? PANEL_SHIMS[section] : undefined;
  useEffect(() => {
    if (shimPanel && vehicleSlug) navigate(`/v/${vehicleSlug}?panel=${shimPanel}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shimPanel, vehicleSlug]);

  const d = useMemo(() => (listing ? derivePassport(listing) : null), [listing]);
  const def = section && !shimPanel ? SECTIONS[section] : undefined;

  const back = () => navigate(`/${base}/${vehicleSlug}${isPreview ? "?preview=1" : ""}`);

  if (loading || shimPanel) return <div className="min-h-screen flex items-center justify-center bg-[#F6F7F9]"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;

  if (notFound || !listing || !d) return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[#F6F7F9]">
      <div className="text-center">
        <Package className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <h1 className="text-xl font-bold">This vehicle may have just sold</h1>
        <p className="text-sm text-slate-500 mt-2">Ask {d?.dealerName || "the dealership"} about similar vehicles in stock.</p>
        {d?.dealerPhone && (
          <a href={`tel:${d.dealerPhone.replace(/[^\d+]/g, "")}`} className="mt-4 h-11 px-5 rounded-xl bg-[#2563EB] text-white text-sm font-bold inline-flex items-center justify-center gap-2"><Phone className="w-4 h-4" /> Call {d.dealerName || "the dealership"}</a>
        )}
      </div>
    </div>
  );

  if (!def) return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[#F6F7F9]">
      <div className="text-center"><Package className="w-12 h-12 text-slate-300 mx-auto mb-4" /><h1 className="text-xl font-bold">Page not found</h1><button onClick={back} className="mt-4 text-[#2563EB] font-semibold">Back to Passport</button></div>
    </div>
  );

  const heroSrc = listingHero(listing);
  const widthCls = def.wide ? "max-w-[1180px]" : "max-w-[760px]";

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#0F172A]" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <Helmet><title>{`${def.title} — ${listing.ymm} · Passport`}</title><meta name="robots" content="noindex" /></Helmet>

      {/* Sticky top header — back + vehicle context */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-[#E6E8EC]">
        <div className={`mx-auto ${widthCls} ${def.wide ? "h-16" : "h-14"} px-3 sm:px-4 flex items-center gap-3`}>
          <button onClick={back} aria-label="Back to passport" className="w-9 h-9 rounded-full border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center shrink-0"><ChevronLeft className="w-5 h-5" /></button>
          {heroSrc && <img src={heroSrc} alt="" className={`${def.wide ? "w-14 h-10" : "w-9 h-9"} rounded-lg object-cover shrink-0`} />}
          <div className="min-w-0">
            <p className={`${def.wide ? "text-[15px]" : "text-[14px]"} font-bold leading-tight truncate`}>{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</p>
            <p className="text-[12px] leading-tight truncate">{d.price != null && <span className="font-bold text-[#2563EB]">{fmt$(d.price)}</span>}{d.price != null && listing.mileage != null && <span className="text-slate-400"> · </span>}{listing.mileage != null && <span className="text-slate-500 font-medium">{listing.mileage.toLocaleString()} miles</span>}</p>
          </div>
          <span className="flex-1" />
          {def.headerPill && <span className="hidden sm:inline-flex text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1 shrink-0">{def.headerPill}</span>}
        </div>
      </header>

      <div className={`mx-auto ${widthCls} px-4 sm:px-6 py-5 pb-[calc(96px+env(safe-area-inset-bottom))] space-y-4`}>
        {def.render({ d, listing, slug: vehicleSlug || "", navigate })}

        {/* Cross-CTA + back to passport (suppressed on pages that carry
            their own primary action, like the reserve checkout) */}
        {!def.hideCrossCta && (
          <Card className="p-5">
            <p className="text-[13px] font-semibold text-slate-700 mb-3">Ready to move forward?</p>
            <div className="grid grid-cols-2 gap-2.5">
              <button onClick={() => navigate(`/${base}/${vehicleSlug}/reserve`)} className="h-11 rounded-xl bg-[#2563EB] text-white text-[13px] font-bold inline-flex items-center justify-center gap-1.5"><BadgeCheck className="w-4 h-4" /> Reserve</button>
              <button onClick={() => navigate(`/${base}/${vehicleSlug}/trade`)} className="h-11 rounded-xl border-2 border-[#2563EB] text-[#2563EB] text-[13px] font-bold inline-flex items-center justify-center gap-1.5"><GaugeIcon className="w-4 h-4" /> Trade value</button>
            </div>
            <button onClick={back} className="w-full mt-2.5 h-11 rounded-xl border border-[#E6E8EC] text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"><ChevronLeft className="w-4 h-4" /> Back to Vehicle Passport</button>
          </Card>
        )}

        <footer className="pt-2 pb-4">
          <div className="flex items-center justify-center gap-2 text-[12px] text-slate-500"><Lock className="w-3.5 h-3.5 text-emerald-600" /> Secure &amp; Private · Powered by <Logo variant="full" size={16} /></div>
        </footer>
      </div>

      {/* Sticky bottom action bar — a floating centered card. Compact icon
          grid on phones; two-line label + microcopy segments on desktop, with
          the primary as a strong blue block (Today's Price shows the amount). */}
      <div className="fixed bottom-0 inset-x-0 z-40 px-3 pb-[calc(10px+env(safe-area-inset-bottom))] pt-2 pointer-events-none">
        <div className={`mx-auto ${widthCls} pointer-events-auto rounded-2xl border border-[#E6E8EC] bg-white/95 backdrop-blur shadow-[0_10px_36px_-12px_rgba(16,24,40,0.28)] p-2 grid grid-cols-4 gap-1.5 sm:flex sm:justify-center sm:gap-2`}>
          {[
            { key: "call", icon: Phone, label: "Call Us", sub: d.dealerPhone ? formatPhone(d.dealerPhone) : "Reach the dealership", onClick: () => { if (d.dealerPhone) window.location.href = `tel:${d.dealerPhone}`; else navigate(`/${base}/${vehicleSlug}/contact`); } },
            { key: "text", icon: MessageSquare, label: "Text Us", sub: "We reply fast", onClick: () => navigate(`/${base}/${vehicleSlug}/text`) },
            section === "test-drive"
              ? { key: "td", icon: Clock, label: "Test Drive", sub: "Pick a time that works", onClick: () => { const el = document.getElementById("td-form"); el?.scrollIntoView({ behavior: "smooth" }); window.setTimeout(() => document.getElementById("td-name")?.focus({ preventScroll: true }), 450); } }
              : { key: "td", icon: Clock, label: "Test Drive", sub: "Pick a time that works", onClick: () => navigate(`/${base}/${vehicleSlug}/test-drive`) },
            // On the action pages (reserve / contact) the primary bar action IS
            // the page goal — Today's Price would compete with it.
            section === "reserve"
              ? { key: "hold", icon: ShieldCheck, label: "Request Hold", primary: true, onClick: () => { const el = document.getElementById("reserve-form"); el?.scrollIntoView({ behavior: "smooth" }); window.setTimeout(() => document.getElementById("rsv-name")?.focus({ preventScroll: true }), 450); } }
              : section === "contact"
              ? { key: "contact", icon: Mail, label: "Contact Dealer", primary: true, onClick: () => { const el = document.getElementById("contact-form"); el?.scrollIntoView({ behavior: "smooth" }); window.setTimeout(() => document.getElementById("ct-name")?.focus({ preventScroll: true }), 450); } }
              : section === "todays-price"
              ? { key: "price", icon: DollarSign, label: resolveTodaysPrice(listing as unknown as { todays_price_mode?: unknown }).barLabel, primary: true, onClick: () => { const el = document.getElementById("tp-form"); el?.scrollIntoView({ behavior: "smooth" }); window.setTimeout(() => document.getElementById("tp-name")?.focus({ preventScroll: true }), 450); } }
              : { key: "price", icon: DollarSign, label: "Today's Price", sub: d.price != null ? fmt$(d.price) : undefined, primary: true, onClick: () => navigate(`/${base}/${vehicleSlug}/todays-price`) },
          ].map((b) => {
            const sub = (b as { sub?: string }).sub;
            return (
              <button key={b.key} onClick={b.onClick} className={`h-12 rounded-xl text-[10px] leading-[1.05] font-bold inline-flex flex-col items-center justify-center gap-0.5 text-center px-0.5 sm:h-[52px] sm:flex-row sm:gap-2.5 sm:px-6 sm:text-[13px] sm:text-left ${b.primary ? "bg-[#2563EB] text-white hover:bg-[#1d4fd7]" : "bg-white text-[#0F172A] sm:border sm:border-transparent sm:hover:border-[#d8dce0]"}`}>
                <b.icon className={`w-4 h-4 shrink-0 ${b.primary ? "" : "text-[#2563EB]"}`} />
                <span className="sm:flex sm:flex-col sm:leading-tight">
                  <span>{b.label}</span>
                  {sub && <span className={`hidden sm:block font-semibold ${b.primary ? "text-[15px] font-extrabold" : "text-[11px] text-[#64748B]"}`}>{sub}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default VehiclePassportV2Detail;
