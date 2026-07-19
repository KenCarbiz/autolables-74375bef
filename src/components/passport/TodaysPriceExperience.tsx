import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Phone, MessageSquare, Mail, Lock, ShieldCheck, CheckCircle2,
  Send, User, PenLine, Car, ChevronLeft, Info,
} from "lucide-react";
import { AutoLabelsSpecIcon, type AutoLabelsSpecIconKey } from "@/components/icons/AutoLabelsSpecIcons";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { type VehicleListing } from "@/hooks/useVehicleListing";
import { formatPhone } from "@/components/addendum/CustomerInfoSection";
import { trackLeadSubmitted, trackCustomerEngagement } from "@/lib/engagement/customerEngagement";
import { estimateAffordability, DEFAULT_APR_PERCENT } from "@/lib/affordability";
import { fmt$, type PassportData } from "@/lib/passportV2Data";
import { readBuildSheet } from "@/lib/buildSheet";
import { listingGallery, listingHero } from "@/lib/photos";
import { resolveTodaysPrice } from "@/lib/todaysPrice";
import {
  presentApr, creditImpactCopy, estimateDueAtSigning, contactConsentCopy,
  CREDIT_TIER_DISCLOSURE, EXCLUDED_CHARGES, EXCLUDED_CHARGES_SUMMARY,
  PAYMENT_CALC_VERSION, type CreditTier, type PaymentCalculationSnapshot,
} from "@/lib/payment/disclosure";

// This calculator performs NO credit-bureau inquiry. The "no credit impact"
// assertion is gated on this flag so the copy stays truthful if a soft pull
// is ever added.
const performsCreditInquiry = false;

// ──────────────────────────────────────────────────────────────
// Today's Price & Payment Options — the premium payment experience on the
// passport action-page system. Left: vehicle summary, price transparency,
// what-happens-next (with the custom clipboard illustration). Right: payment
// builder with live breakdown + the dealer-reviewed request form. All copy
// resolves through the dealer's configured Today's Price mode so the
// compliance guardrails from that setting still apply here.
// ──────────────────────────────────────────────────────────────

const CARD = "rounded-2xl border border-[#DDE5EE] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_10px_28px_-18px_rgba(16,24,40,0.14)]";
const field = "w-full h-12 border rounded-xl px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const TERMS = [48, 60, 72, 84] as const;
const CREDIT_PROFILES: { key: string; label: string; range: string; apr: number }[] = [
  { key: "excellent", label: "Excellent", range: "720+", apr: 6.49 },
  { key: "good", label: "Good", range: "690–719", apr: DEFAULT_APR_PERCENT },
  { key: "fair", label: "Fair", range: "630–689", apr: 9.99 },
  { key: "rebuilding", label: "Rebuilding", range: "629 or less", apr: 13.49 },
];

const track = (listing: VehicleListing, event: string, extra: Record<string, unknown> = {}) =>
  trackCustomerEngagement({
    tenantId: listing.tenant_id, storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin,
    source: "passport", surface: "lead_form",
    eventType: event.endsWith("_viewed") ? "lead_form_opened" : event.endsWith("_clicked") ? "cta_clicked" : "engagement_ping",
    metadata: { event, ...extra },
  });

// Custom SaaS clipboard illustration — dimensional, friendly, and reusable.
// Deliberately NOT an icon-library clipboard: rotated body, depth line,
// paper rows, circular check badge, faint background sheet + person outline.
export function PaymentClipboardIllustration({ className }: { className?: string }) {
  const c = { stroke: "#2F6FEA", strokeSoft: "#9DBDF8", fill: "#FFFFFF", fillSoft: "#EEF6FF", shadow: "rgba(47, 111, 234, 0.14)", checkBg: "#FFFFFF", checkStroke: "#0B6FEA" };
  return (
    <svg viewBox="0 0 220 180" className={className} role="img" aria-label="Dealer-reviewed payment request illustration" fill="none">
      {/* faint background sheet + person outline */}
      <rect x="18" y="30" width="74" height="96" rx="8" stroke={c.strokeSoft} strokeWidth="2" opacity="0.45" />
      <circle cx="44" cy="58" r="9" stroke={c.strokeSoft} strokeWidth="2" opacity="0.45" />
      <path d="M30 84c2.5-8 8-12 14-12s11.5 4 14 12" stroke={c.strokeSoft} strokeWidth="2" opacity="0.45" strokeLinecap="round" />
      <path d="M28 98h38M28 108h28" stroke={c.strokeSoft} strokeWidth="2" opacity="0.4" strokeLinecap="round" />

      {/* soft ground shadow */}
      <ellipse cx="130" cy="160" rx="62" ry="9" fill={c.shadow} />

      {/* rotated clipboard group */}
      <g transform="rotate(6 130 88)">
        {/* depth line */}
        <rect x="86" y="26" width="92" height="126" rx="12" fill={c.fillSoft} transform="translate(6 6)" />
        {/* clipboard body */}
        <rect x="86" y="26" width="92" height="126" rx="12" fill={c.fill} stroke={c.stroke} strokeWidth="3" />
        {/* paper */}
        <rect x="96" y="44" width="72" height="98" rx="6" fill={c.fillSoft} opacity="0.55" />
        {/* clip tab */}
        <rect x="118" y="16" width="28" height="18" rx="6" fill={c.fillSoft} stroke={c.stroke} strokeWidth="3" />
        <circle cx="132" cy="25" r="3" fill={c.stroke} />
        {/* paper lines */}
        <path d="M102 58h60M102 72h60M102 86h44M102 100h52M102 114h34" stroke={c.strokeSoft} strokeWidth="3.5" strokeLinecap="round" />
      </g>

      {/* circular check badge, lower-right of clipboard */}
      <circle cx="172" cy="132" r="21" fill={c.checkBg} stroke={c.checkStroke} strokeWidth="3.5" />
      <path d="m163 132.5 6 6 12-13" stroke={c.checkStroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const TrustStrip = ({ dealerPhone }: { dealerPhone: string | null }) => (
  <div className={`${CARD} px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap`}>
    <div className="flex items-center gap-x-5 gap-y-1.5 flex-wrap text-[12px] font-semibold text-[#10202B]">
      <span className="inline-flex items-center gap-1.5"><Lock className="w-3.5 h-3.5 text-[#0B6FEA]" /> Secure &amp; Private</span>
      <span className="inline-flex items-center gap-1.5"><Lock className="w-3.5 h-3.5 text-[#0B6FEA]" /> Secure &amp; Private</span>
      <span className="inline-flex items-center gap-1.5" title="A dealership representative will review your request and follow up with confirmed details."><ShieldCheck className="w-3.5 h-3.5 text-[#0B6FEA]" /> Dealer will review</span>
      <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-[#0B6FEA]" /> No Obligation</span>
    </div>
    {dealerPhone && <a href={`tel:${dealerPhone.replace(/[^\d+]/g, "")}`} className="text-[12px] font-semibold text-[#0B6FEA] inline-flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> Questions? Call {formatPhone(dealerPhone)}</a>}
  </div>
);

const VehicleSummaryCard = ({ listing, d }: { listing: VehicleListing; d: PassportData }) => {
  const gallery = listingGallery(listing);
  const hero = listingHero(listing);
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const stockNo = mc.stock_no ? String(mc.stock_no) : null;
  const spec = (label: string) => d.keySpecs.find(([k]) => k === label)?.[1] ?? null;
  // Each vehicle fact carries its own AutoLabels spec icon — mileage reads as
  // an odometer, 4WD as a drivetrain, never four identical gauges.
  const facts = [
    listing.mileage != null ? { icon: "odometer" as AutoLabelsSpecIconKey, label: `${listing.mileage.toLocaleString()} miles` } : null,
    spec("Drivetrain") ? { icon: "drivetrain" as AutoLabelsSpecIconKey, label: spec("Drivetrain") as string } : null,
    spec("Engine") ? { icon: "engine" as AutoLabelsSpecIconKey, label: spec("Engine") as string } : null,
    spec("Transmission") ? { icon: "shifter" as AutoLabelsSpecIconKey, label: spec("Transmission") as string } : null,
  ].filter(Boolean) as { icon: AutoLabelsSpecIconKey; label: string }[];
  const details: [string, AutoLabelsSpecIconKey, React.ReactNode][] = [
    ...(stockNo ? [["Stock #", "price-tag", stockNo] as [string, AutoLabelsSpecIconKey, React.ReactNode]] : []),
    ...(listing.vin ? [["VIN", "vin-barcode", (
      <span key="vin" className="inline-flex items-center gap-1.5 min-w-0"><span className="font-mono text-[11.5px] truncate">{listing.vin}</span>
        <button onClick={async () => { try { await navigator.clipboard.writeText(listing.vin); toast.success("VIN copied"); } catch { /* unavailable */ } }} aria-label="Copy VIN" className="text-[#64748B] hover:text-[#10202B] shrink-0"><AutoLabelsSpecIcon name="copy" className="w-3.5 h-3.5" accent="currentColor" /></button>
      </span>
    )] as [string, AutoLabelsSpecIconKey, React.ReactNode]] : []),
    ...(spec("Exterior Color") ? [["Exterior", "paint", spec("Exterior Color")] as [string, AutoLabelsSpecIconKey, React.ReactNode]] : []),
    ...(spec("Interior Color") ? [["Interior", "seat", spec("Interior Color")] as [string, AutoLabelsSpecIconKey, React.ReactNode]] : []),
  ];
  return (
    <div className={`${CARD} overflow-hidden`}>
      <div className="relative aspect-[16/10] bg-slate-100 flex items-center justify-center">
        {hero ? <img src={hero} alt={listing.ymm ?? "Vehicle"} className="w-full h-full object-cover" /> : <Car className="w-10 h-10 text-slate-300" />}
        {gallery.length > 1 && <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1.5 text-[11px] font-bold text-white bg-black/55 rounded-lg px-2 py-1"><AutoLabelsSpecIcon name="camera" className="w-3.5 h-3.5" accent="#FFFFFF" /> {gallery.length} Photos</span>}
      </div>
      <div className="p-5">
        <p className="text-[17px] font-extrabold leading-tight text-[#0D1B2A]">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</p>
        {d.price != null && <p className="mt-1"><span className="text-[24px] font-extrabold tracking-tight text-[#0D1B2A]">{fmt$(d.price)}</span><span className="text-[12px] font-semibold text-[#64748B] ml-2">{d.priceLabel}</span></p>}
        {facts.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-[12.5px] text-[#334155]">
            {facts.map((f) => (
              <span key={f.label} className="inline-flex items-center gap-1.5">
                <AutoLabelsSpecIcon name={f.icon} className="w-4 h-4 text-[#3D5876] shrink-0" /> {f.label}
              </span>
            ))}
          </div>
        )}
        {details.length > 0 && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 mt-4 pt-4 border-t border-[#F1F5F9]">
            {details.map(([k, icon, v]) => (
              <div key={k} className="min-w-0 flex items-start gap-2">
                <AutoLabelsSpecIcon name={icon} className="w-4 h-4 text-[#3D5876] shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#94A3B8]">{k}</p>
                  <p className="text-[12.5px] font-semibold text-[#10202B] truncate mt-0.5">{v}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const PriceTransparencyCard = ({ listing, d }: { listing: VehicleListing; d: PassportData }) => {
  const optionsValue = readBuildSheet(listing)?.estValue ?? null;
  const includedCoverage = d.dealerCoverage.find((c) => c.mode === "included" && c.title) ?? null;
  const recap: string[] = [
    ...(d.belowMarket && d.belowMarket > 0 ? [`${fmt$(d.belowMarket)} below market`] : []),
    ...(optionsValue ? [`${fmt$(optionsValue)} in factory options`] : []),
    ...(includedCoverage ? [`${includedCoverage.title} included`] : []),
  ].slice(0, 3);
  return (
    <div className={`${CARD} p-5`}>
      <p className="text-[15px] font-bold text-[#0D1B2A]">Price Transparency</p>
      {d.price != null && <p className="mt-2"><span className="text-[22px] font-extrabold tracking-tight text-[#0D1B2A]">{fmt$(d.price)}</span><span className="text-[12px] font-semibold text-[#64748B] ml-2">{d.priceLabel}</span></p>}
      <p className="text-[12.5px] text-[#64748B] leading-relaxed mt-2">Excludes tax, title, registration, and fees.</p>
      {recap.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {recap.map((label) => (
            <span key={label} className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-[12px] font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" /> {label}
            </span>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-[#F1F5F9]">
        {[["Up-Front Pricing", CheckCircle2], ["Secure & Private", Lock], ["Dealer will review", ShieldCheck], ["Vehicle-Specific", Car]].map(([label, Icon]) => (
          <span key={label as string} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-[#334155]">
            {(() => { const I = Icon as React.ElementType; return <I className="w-3.5 h-3.5 text-[#0B6FEA] shrink-0" />; })()} {label as string}
          </span>
        ))}
      </div>
    </div>
  );
};

const WHAT_NEXT: [string, string][] = [
  ["Submit your payment request", "Tell us a little about yourself and your preferences."],
  ["Our team reviews your request", "A dealership representative will review and confirm details."],
  ["Receive your payment options", "We'll share available terms tailored to this vehicle."],
  ["Choose what works best for you", "Reserve, schedule a test drive, or finalize when ready."],
];

const WhatHappensNextCard = () => (
  <div className={`${CARD} p-5`}>
    <p className="text-[15px] font-bold text-[#0D1B2A]">What happens next?</p>
    <div className="flex items-start gap-4 mt-3">
      <ol className="space-y-3.5 min-w-0 flex-1">
        {WHAT_NEXT.map(([t, s], i) => (
          <li key={t} className="flex items-start gap-2.5">
            <span className="grid place-items-center w-6 h-6 rounded-full bg-[#EAF4FF] text-[#0B6FEA] text-[11px] font-bold shrink-0 mt-0.5">{i + 1}</span>
            <span className="min-w-0">
              <span className="block text-[12.5px] font-bold text-[#10202B] leading-snug">{t}</span>
              <span className="block text-[11.5px] text-[#64748B] mt-0.5 leading-snug">{s}</span>
            </span>
          </li>
        ))}
      </ol>
      <PaymentClipboardIllustration className="w-[130px] sm:w-[170px] shrink-0" />
    </div>
  </div>
);

const TodaysPriceExperience = ({ listing, d }: { listing: VehicleListing; d: PassportData }) => {
  const navigate = useNavigate();
  const copy = useMemo(() => resolveTodaysPrice(listing as unknown as { todays_price_mode?: unknown; todays_price_custom?: unknown }), [listing]);
  const isPreview = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("preview");
  useEffect(() => { if (!isPreview) track(listing, "todays_price_page_viewed", { mode: copy.mode }); }, [listing, isPreview, copy.mode]);

  const price = d.price ?? 0;
  const [down, setDown] = useState(() => Math.min(price, Math.round((price * 0.1) / 500) * 500));
  const [term, setTerm] = useState<(typeof TERMS)[number]>(72);
  const [apr, setApr] = useState(DEFAULT_APR_PERCENT);
  const [profile, setProfile] = useState<string | null>(null);
  const safeDown = Math.min(down, price);
  const row = estimateAffordability({ price, downPayment: safeDown, aprPercent: Math.max(0, apr) }, [term])[0];
  const monthly = Math.round(row.monthly_payment);
  const financed = Math.max(0, price - safeDown);
  const aprPresentation = useMemo(() => presentApr(apr), [apr]);
  const dueAtSigning = useMemo(() => estimateDueAtSigning({ downPayment: safeDown, firstMonthPayment: monthly }), [safeDown, monthly]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<"call" | "text" | "email">("text");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; contact?: string; email?: string }>({});
  const [started, setStarted] = useState(false);
  const markStarted = () => { if (!started) { setStarted(true); if (!isPreview) track(listing, "todays_price_form_started"); } };

  const emit = (event: string, extra: Record<string, unknown> = {}) => { if (!isPreview) track(listing, event, extra); };

  const submit = async () => {
    // Duplicate-submit guard: any in-flight or already-sent request is ignored
    // so repeated taps can't produce a second lead row.
    if (sending || sent) return;
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = "Enter your full name.";
    if (!email.trim() && !phone.trim()) errs.contact = "Add a phone number or email so the dealership can reach you.";
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) errs.email = "That email doesn't look right.";
    setErrors(errs);
    if (Object.keys(errs).length) { emit("lead_validation_failed", { fields: Object.keys(errs) }); return; }
    emit("payment_request_submitted", { mode: copy.mode, term, apr_bucket: Math.round(apr), monthly_bucket: Math.round(monthly / 25) * 25 });
    if (isPreview) { setSent(true); return; }
    setSending(true);
    // Preserve the exact calculation the shopper modeled so the dealer sees it.
    const paymentSnapshot: PaymentCalculationSnapshot = {
      vin: listing.vin, vehiclePrice: price, downPayment: safeDown, termMonths: term,
      exampleAprPercent: apr, aprIsVerifiedOffer: false, estMonthlyPayment: monthly,
      amountFinanced: financed, creditTier: (profile?.toLowerCase() as CreditTier | undefined) ?? null,
      dueAtSigningKnown: dueAtSigning.known, excludedCharges: [...EXCLUDED_CHARGES],
      preferredContact: method, calcVersion: PAYMENT_CALC_VERSION, calculatedAt: new Date().toISOString(),
    };
    try {
      let src = "website";
      let zip = "";
      try {
        if (sessionStorage.getItem("al_visit_src") === "qr") src = "qr_scan";
        zip = sessionStorage.getItem("al_zip") || "";
      } catch { /* storage unavailable */ }
      const terms = copy.showCalculator ? `Payment goal ${fmt$(monthly)}/mo · ${term} mo · Example APR ${apr.toFixed(2)}% · ${fmt$(safeDown)} down${profile ? ` · Credit profile ${profile}` : ""}` : "";
      const extras = [`Mode ${copy.mode}`, terms, method ? `Prefers ${method}` : "", zip ? `ZIP ${zip}` : "", `Due at signing (est.) ${fmt$(dueAtSigning.known)} (excl. tax/title/reg)`, "via vehicle_passport_todays_price_page"].filter(Boolean).join(" · ");
      const routing = (listing as unknown as { contact_routing?: Record<string, unknown> }).contact_routing || null;
      const basePayload = {
        store_id: listing.store_id, name: name.trim(), email: email.trim() || "", phone: phone.trim() || "",
        vehicle_interest: `${listing.ymm || "Vehicle"} (Today's Price)`,
        vehicle_vin: listing.vin, source: src, status: "new",
        notes: `[intent=todays_price] Passport V2 — Today's Price · ${extras}${message.trim() ? `: ${message.trim()}` : ""}\n[payment_calculation]${JSON.stringify(paymentSnapshot)}`,
      };
      const routedPayload = {
        ...basePayload, sub_source: "contact",
        routing: routing ? { source: "customer_passport", routingTargetType: routing.routingTargetType ?? null, routingTargetId: routing.routingTargetId ?? null, routingReason: routing.routingReason ?? null, displayMode: routing.displayMode ?? null, afterHours: routing.afterHours ?? false } : null,
      };
      type LeadsTable = { from: (t: string) => { insert: (r: unknown) => Promise<{ error: unknown }> } };
      let insErr = (await (supabase as unknown as LeadsTable).from("leads").insert(routedPayload)).error;
      if (insErr) insErr = (await (supabase as unknown as LeadsTable).from("leads").insert(basePayload)).error;
      if (insErr) throw insErr;
      trackLeadSubmitted({ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: src === "qr_scan" ? "window_sticker_qr" : "passport", metadata: { intent: "todays_price", event: "todays_price_form_submitted", mode: copy.mode, monthly, term, apr, down: safeDown, calc_version: PAYMENT_CALC_VERSION } });
      supabase.functions.invoke("lead-alert", {
        body: { slug: listing.slug, vin: listing.vin, intent: "todays_price", name: name.trim(), phone: phone.trim() || null, email: email.trim() || null, source: src, sub_source: "contact" },
      }).catch(() => { /* alert failure never blocks the shopper */ });
      emit("payment_request_succeeded", { mode: copy.mode });
      setSent(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      emit("payment_request_failed");
      toast.error("Couldn't send — please call the dealer directly");
    } finally { setSending(false); }
  };

  const q = isPreview ? "?preview=1" : "";

  if (sent) return (
    <div className="max-w-[640px] mx-auto">
      <div className={`${CARD} p-8 text-center`}>
        <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-3" />
        <h2 className="text-[24px] font-extrabold tracking-tight text-[#0D1B2A]">Request Sent</h2>
        <p className="text-[14px] text-[#64748B] mt-2">{d.dealerName || "The dealership"} received your request and will follow up with available payment details.</p>
        <div className="mt-4 mx-auto max-w-sm rounded-xl border border-[#DDE5EE] bg-[#F5F7FA] p-4 text-left text-[13px] text-[#334155]">
          {copy.showCalculator && <p className="font-bold text-[#0D1B2A]">{fmt$(monthly)}/mo · {term} months · {apr.toFixed(2)}% APR · {fmt$(safeDown)} down</p>}
          <p className="mt-1">{name}{phone ? ` · ${phone}` : ""}{email ? ` · ${email}` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2 justify-center mt-6">
          <button onClick={() => navigate(`/v/${listing.slug}${q}`)} className="h-11 px-5 rounded-xl bg-[#0B6FEA] text-white text-sm font-bold inline-flex items-center gap-2"><ChevronLeft className="w-4 h-4" /> Back to Vehicle Passport</button>
          <button onClick={() => navigate(`/v/${listing.slug}/reserve${q}`)} className="h-11 px-5 rounded-xl border border-[#DDE5EE] text-sm font-bold text-[#334155]">Reserve This Vehicle</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <TrustStrip dealerPhone={d.dealerPhone} />
      <div>
        <h1 className="text-[24px] sm:text-[27px] font-extrabold tracking-tight leading-tight text-[#0D1B2A]">{copy.headline}</h1>
        <p className="text-[13.5px] text-[#64748B] mt-1">{copy.sub}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6 items-start">
        {/* Left column */}
        <div className="space-y-5 min-w-0 order-2 lg:order-1">
          <VehicleSummaryCard listing={listing} d={d} />
          <PriceTransparencyCard listing={listing} d={d} />
          <div className="hidden lg:block"><WhatHappensNextCard /></div>
        </div>

        {/* Right column */}
        <div className="space-y-5 min-w-0 order-1 lg:order-2">
          {copy.showCalculator && (
            <div className={`${CARD} p-5 sm:p-6`}>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-[16px] font-bold text-[#0D1B2A]">Build Your Payment</p>
                  <p className="text-[12px] text-[#64748B] mt-0.5">Customize your estimate. This does not affect your credit score.</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#94A3B8]">Estimated Payment</p>
                  <p className="text-[28px] font-extrabold tracking-tight text-[#0B6FEA] leading-none mt-0.5">{fmt$(monthly)}<span className="text-[14px] font-semibold text-[#64748B]">/mo</span></p>
                  <p className="text-[11px] text-[#64748B] mt-1">For {term} months at {apr.toFixed(2)}% APR</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_220px] gap-6 mt-5">
                <div className="space-y-4 min-w-0">
                  {copy.showDown && (
                    <div>
                      <div className="flex justify-between text-[12px] text-[#64748B] mb-1"><span>Down Payment</span><span className="font-bold text-[#0D1B2A]">{fmt$(safeDown)}</span></div>
                      <input type="range" min={0} max={Math.max(500, Math.round((price * 0.5) / 500) * 500)} step={500} value={safeDown} onChange={(e) => { setDown(Math.min(Number(e.target.value), price)); markStarted(); }} onPointerUp={() => emit("payment_slider_changed", { down: safeDown })} className="w-full accent-[#0B6FEA]" />
                    </div>
                  )}
                  {copy.showTerm && (
                    <div>
                      <p className="text-[12px] text-[#64748B] mb-1.5">Term</p>
                      <div className="grid grid-cols-4 gap-2">{TERMS.map((t) => (
                        <button key={t} onClick={() => { setTerm(t); markStarted(); emit("term_selected", { term: t }); }} className={`h-10 rounded-xl text-[13px] font-semibold border transition-colors ${term === t ? "border-[#0B6FEA] bg-[#EAF4FF] text-[#0B6FEA]" : "border-[#DDE5EE] text-[#64748B] hover:border-slate-300"}`}>{t} mo</button>
                      ))}</div>
                    </div>
                  )}
                  {copy.showApr && (
                    <div>
                      <div className="flex justify-between text-[12px] text-[#64748B] mb-1"><span>Est. APR</span><span className="font-bold text-[#0D1B2A]">{apr.toFixed(2)}%</span></div>
                      <input type="range" min={0} max={16} step={0.25} value={apr} onChange={(e) => { setApr(Math.max(0, Number(e.target.value))); markStarted(); }} onPointerUp={() => emit("apr_changed", { apr })} className="w-full accent-[#0B6FEA]" />
                    </div>
                  )}
                  <div>
                    <p className="text-[12px] text-[#64748B] mb-1.5 inline-flex items-center gap-1.5">Credit Profile (Optional) <Info className="w-3 h-3" /></p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{CREDIT_PROFILES.map((p) => (
                      <button key={p.key} onClick={() => { setProfile(p.label); setApr(p.apr); markStarted(); emit("apr_changed", { apr: p.apr, profile: p.key }); }} className={`h-12 rounded-xl border text-center transition-colors ${profile === p.label ? "border-[#0B6FEA] bg-[#EAF4FF]" : "border-[#DDE5EE] hover:border-slate-300"}`}>
                        <span className={`block text-[12px] font-bold leading-tight ${profile === p.label ? "text-[#0B6FEA]" : "text-[#10202B]"}`}>{p.label}</span>
                        <span className="block text-[10px] text-[#94A3B8]">{p.range}</span>
                      </button>
                    ))}</div>
                    <p className="text-[10.5px] text-[#94A3B8] mt-1.5">This does not affect your credit score.</p>
                  </div>
                </div>

                {/* Breakdown panel */}
                <div className="rounded-xl border border-[#DDE5EE] bg-[#F5F7FA] p-4 self-start">
                  {([
                    ["Vehicle Price", price ? fmt$(price) : "—"],
                    ["Down Payment", `-${fmt$(safeDown)}`],
                    ["Est. Amount Financed", fmt$(financed)],
                    ["Term", `${term} months`],
                    ["Est. APR", `${apr.toFixed(2)}%`],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-3 py-1.5 text-[12.5px]">
                      <span className="text-[#64748B]">{k}</span><span className="font-semibold text-[#10202B] tabular-nums">{v}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-3 pt-2.5 mt-1.5 border-t border-[#DDE5EE]">
                    <span className="text-[12.5px] font-bold text-[#0D1B2A]">Est. Monthly Payment</span>
                    <span className="text-[16px] font-extrabold text-[#0B6FEA] tabular-nums">{fmt$(monthly)}<span className="text-[11px] font-semibold text-[#64748B]">/mo</span></span>
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-[#94A3B8] mt-4">{copy.disclaimer}</p>
            </div>
          )}

          <div id="tp-form" className={`${CARD} p-5 sm:p-6 scroll-mt-24`}>
            <p className="text-[16px] font-bold text-[#0D1B2A]">Get Dealer-Reviewed Payment Details</p>
            <p className="text-[12px] text-[#64748B] mt-0.5">Send this estimate to the dealership and get available payment options for this exact vehicle.</p>
            <div className="mt-4 space-y-3.5" onInput={markStarted}>
              <div>
                <label htmlFor="tp-name" className="block text-[12px] font-semibold text-[#64748B] mb-1">Your Name *</label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input id="tp-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Full name" aria-invalid={!!errors.name} className={`${field} pl-10 ${errors.name ? "border-red-300" : "border-[#DDE5EE]"}`} />
                </div>
                {errors.name && <p className="text-[12px] text-red-600 mt-1">{errors.name}</p>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label htmlFor="tp-email" className="block text-[12px] font-semibold text-[#64748B] mb-1">Email</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input id="tp-email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" inputMode="email" placeholder="email@example.com" aria-invalid={!!errors.email} className={`${field} pl-10 ${errors.email ? "border-red-300" : "border-[#DDE5EE]"}`} />
                  </div>
                  {errors.email && <p className="text-[12px] text-red-600 mt-1">{errors.email}</p>}
                </div>
                <div>
                  <label htmlFor="tp-phone" className="block text-[12px] font-semibold text-[#64748B] mb-1">Phone</label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input id="tp-phone" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} type="tel" autoComplete="tel" inputMode="tel" placeholder="(555) 555-5555" aria-invalid={!!errors.contact} className={`${field} pl-10 ${errors.contact ? "border-red-300" : "border-[#DDE5EE]"}`} />
                  </div>
                  {errors.contact && <p className="text-[12px] text-red-600 mt-1">{errors.contact}</p>}
                </div>
              </div>
              <div>
                <p className="text-[12px] font-semibold text-[#64748B] mb-1.5">Preferred Contact Method</p>
                <div className="grid grid-cols-3 gap-2">
                  {([["call", "Call", Phone], ["text", "Text", MessageSquare], ["email", "Email", Mail]] as ["call" | "text" | "email", string, React.ElementType][]).map(([key, label, Icon]) => (
                    <button key={key} type="button" aria-pressed={method === key} onClick={() => { setMethod(key); markStarted(); emit("contact_method_selected", { method: key }); }} className={`h-11 rounded-xl text-[13px] inline-flex items-center justify-center gap-1.5 border transition-colors ${method === key ? "bg-[#0B6FEA] border-[#0B6FEA] text-white font-bold" : "border-[#DDE5EE] text-[#64748B] font-semibold hover:border-slate-300"}`}>
                      <Icon className="w-4 h-4" /> {label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-[#64748B] mt-2 leading-snug">{contactConsentCopy(d.dealerName || "", method)}</p>
              </div>
              <div>
                <label htmlFor="tp-msg" className="block text-[12px] font-semibold text-[#64748B] mb-1">Anything you'd like the dealer to know? <span className="font-normal text-[#94A3B8]">(Optional)</span></label>
                <div className="relative">
                  <PenLine className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                  <textarea id="tp-msg" value={message} onChange={(e) => setMessage(e.target.value.slice(0, 500))} rows={2} maxLength={500} placeholder="Tell us about your trade-in, financing goals, or anything else…" className="w-full border rounded-xl px-4 py-3 pl-10 text-sm border-[#DDE5EE] resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            </div>
            <button onClick={submit} disabled={sending} className="w-full h-[52px] mt-4 bg-[#0B6FEA] hover:bg-[#0958bd] disabled:opacity-60 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-colors">
              {sending ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><Send className="w-4 h-4" /> {copy.cta}</>}
            </button>
            <p className="text-[11px] text-[#94A3B8] text-center mt-2.5">By submitting, you agree to be contacted by the dealership about this vehicle.</p>
            <p className="text-[11px] text-[#64748B] text-center mt-1 inline-flex w-full items-center justify-center gap-1.5"><Lock className="w-3 h-3 shrink-0" /> {copy.reassurance}</p>
          </div>

          <div className="lg:hidden"><WhatHappensNextCard /></div>
        </div>
      </div>
    </div>
  );
};

export default TodaysPriceExperience;
