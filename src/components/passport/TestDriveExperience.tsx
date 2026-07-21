import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Phone, ChevronLeft, CheckCircle2, Car, MapPin } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { type VehicleListing } from "@/hooks/useVehicleListing";
import { formatPhone } from "@/components/addendum/CustomerInfoSection";
import { trackLeadSubmitted, trackCustomerEngagement } from "@/lib/engagement/customerEngagement";
import { fmt$, type PassportData } from "@/lib/passportV2Data";
import { resolvePassportBack, passportForwardPath } from "@/lib/passportReturn";
import { readBuildSheet } from "@/lib/buildSheet";
import { listingGallery, listingHero } from "@/lib/photos";
import { AutoLabelsSpecIcon, SpecIconBadge, type AutoLabelsSpecIconKey } from "@/components/icons/AutoLabelsSpecIcons";
import { smsConsentCopy } from "@/lib/payment/disclosure";

// ──────────────────────────────────────────────────────────────
// Schedule a Test Drive — premium action page on the passport system, a
// sibling of Today's Price / Contact / Reserve. Wide vehicle context card,
// two-column form + support rail, ready-to-move-forward card. A concrete
// date + window is a micro-contract that raises show rates versus "we'll
// call you," so the time selector leads the form. The dealer confirms
// availability — never promise a confirmed appointment here.
// ──────────────────────────────────────────────────────────────

const CARD = "rounded-2xl border border-[#DDE5EE] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_10px_28px_-18px_rgba(16,24,40,0.14)]";

const track = (listing: VehicleListing, event: string, extra: Record<string, unknown> = {}) =>
  trackCustomerEngagement({
    tenantId: listing.tenant_id, storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin,
    source: "passport", surface: "lead_form",
    eventType: event.endsWith("_viewed") ? "lead_form_opened" : event.endsWith("_clicked") ? "cta_clicked" : "engagement_ping",
    metadata: { event, ...extra },
  });

const TIME_WINDOWS: { key: string; label: string; range: string; icon: AutoLabelsSpecIconKey }[] = [
  { key: "Morning", label: "Morning", range: "8am – 12pm", icon: "morning" },
  { key: "Afternoon", label: "Afternoon", range: "12pm – 5pm", icon: "afternoon" },
  { key: "Evening", label: "Evening", range: "5pm – 8pm", icon: "evening" },
];

const IconField = ({
  icon, children,
}: { icon: AutoLabelsSpecIconKey; children: React.ReactNode }) => (
  <div className="relative">
    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8CA3BC] pointer-events-none">
      <AutoLabelsSpecIcon name={icon} className="w-4.5 h-4.5" accent="currentColor" style={{ width: 18, height: 18 }} />
    </span>
    {children}
  </div>
);

// Form fields are rounded rectangles (12px) — deliberately NOT pills.
const INPUT = "w-full h-[50px] border border-[#DDE5EE] rounded-[12px] pl-11 pr-4 text-sm text-[#10202B] placeholder:text-[#8CA3BC] focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white";

// Numbered step chip for the form's two-step structure.
const StepChip = ({ n, label }: { n: number; label: string }) => (
  <p className="flex items-center gap-2 text-[13.5px] font-bold text-[#0D1B2A]">
    <span className="w-6 h-6 rounded-full bg-[#0B6FEA] text-white text-[12px] font-black flex items-center justify-center shrink-0">{n}</span>
    {label}
  </p>
);

// Wide vehicle context card — the customer schedules for this exact vehicle.
// Trust content (rating, review count, years in business) is the tenant's
// own configured data via dealer_trust; nothing here is ever fabricated,
// and each line hides when the dealer hasn't provided it.
const VehicleContextCard = ({ listing, d }: { listing: VehicleListing; d: PassportData }) => {
  const hero = listingHero(listing);
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const badges: { icon: AutoLabelsSpecIconKey; label: string }[] = [
    ...(mc.carfax_clean_title === true ? [{ icon: "clean-title" as AutoLabelsSpecIconKey, label: "Clean Title" }] : []),
    ...(mc.carfax_1_owner === true ? [{ icon: "shield-check" as AutoLabelsSpecIconKey, label: "1-Owner" }] : []),
    { icon: "passport", label: "Vehicle Passport" },
  ];
  const photoCount = listingGallery(listing).length;
  const optionsValue = readBuildSheet(listing)?.estValue ?? null;
  const includedCoverage = d.dealerCoverage.find((c) => c.mode === "included" && c.title) ?? null;
  const recap: string[] = [
    ...(d.belowMarket && d.belowMarket > 0 ? [`${fmt$(d.belowMarket)} below market`] : []),
    ...(optionsValue ? [`${fmt$(optionsValue)} in factory options`] : []),
    ...(includedCoverage ? [`${includedCoverage.title} included`] : []),
  ].slice(0, 3);
  const dealerTel = d.dealerPhone ? d.dealerPhone.replace(/[^\d+]/g, "") : null;
  const trust = d.dealerTrust;
  const rating = parseFloat(trust.googleRating);
  const hasRating = Number.isFinite(rating) && rating > 0 && rating <= 5;
  const count = parseInt(trust.googleCount.replace(/[^\d]/g, ""), 10);
  const hasCount = Number.isFinite(count) && count > 0;
  const years = parseInt(trust.yearsInBusiness.replace(/[^\d]/g, ""), 10);
  const hasYears = Number.isFinite(years) && years > 0;
  const chip = "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border text-[12px] font-semibold";
  return (
    <div className={`${CARD} p-4 sm:p-5`}>
      <div className="flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-5">
        <div className="relative w-full sm:w-72 lg:w-64 aspect-[16/10] rounded-xl overflow-hidden bg-slate-100 flex items-center justify-center shrink-0">
          {hero ? <img src={hero} alt={listing.ymm ?? "Vehicle"} className="w-full h-full object-cover" /> : <Car className="w-8 h-8 text-slate-300" />}
          {photoCount > 1 && (
            <span className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 text-[11px] font-bold text-white bg-black/60 rounded-lg px-2 py-1">
              <AutoLabelsSpecIcon name="camera" className="w-3.5 h-3.5" accent="#FFFFFF" /> {photoCount} Photos
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[19px] font-extrabold leading-tight text-[#0D1B2A]">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</p>
          <p className="mt-1.5 flex items-baseline gap-3 flex-wrap">
            {d.price != null && <span className="text-[24px] font-extrabold tracking-tight text-[#0B6FEA]">{fmt$(d.price)}</span>}
            {listing.mileage != null && (
              <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#64748B]">
                <AutoLabelsSpecIcon name="odometer" className="w-4 h-4 text-[#8CA3BC]" accent="currentColor" /> {listing.mileage.toLocaleString()} miles
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            <span className={`${chip} border-emerald-200 bg-emerald-50 text-emerald-700`}>
              <CheckCircle2 className="w-3.5 h-3.5" /> Available Now
            </span>
            {badges.map((b) => (
              <span key={b.label} className={`${chip} border-[#D3E6FB] bg-[#F5FAFF] text-[#0B6FEA]`}>
                <AutoLabelsSpecIcon name={b.icon} className="w-3.5 h-3.5" /> {b.label}
              </span>
            ))}
            {recap.map((label) => (
              <span key={label} className={`${chip} border-emerald-200 bg-emerald-50 text-emerald-700`}>
                <AutoLabelsSpecIcon name="shield-check" className="w-3.5 h-3.5" /> {label}
              </span>
            ))}
          </div>
          {(hasRating || hasCount) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 pt-3 border-t border-[#F1F5F9]">
              {hasCount && (
                <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#334155]">
                  <AutoLabelsSpecIcon name="people" className="w-4 h-4 text-[#0B6FEA]" /> Trusted by {count.toLocaleString()}+ reviewers
                </span>
              )}
              {hasRating && (
                <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#334155]">
                  Rated {trust.googleRating}/5
                  <span className="text-amber-500 tracking-tight text-[13px]" aria-hidden>
                    {"★".repeat(Math.round(rating))}{"☆".repeat(Math.max(0, 5 - Math.round(rating)))}
                  </span>
                </span>
              )}
              {hasYears && <span className="text-[12px] font-semibold text-[#64748B]">{years} years in business</span>}
            </div>
          )}
        </div>
        <div className="shrink-0 lg:pl-5 lg:border-l lg:border-[#F1F5F9] space-y-1.5 lg:max-w-[220px]">
          {d.dealerName && <p className="text-[13.5px] font-bold text-[#0D1B2A]">{d.dealerName}</p>}
          {d.dealerAddress && <p className="text-[12px] font-medium text-[#64748B] leading-snug">{d.dealerAddress}</p>}
          {dealerTel && (
            <a href={`tel:${dealerTel}`} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#0B6FEA]">
              <Phone className="w-3.5 h-3.5" /> {formatPhone(d.dealerPhone!)}
            </a>
          )}
          <p className="text-[11.5px] text-[#64748B] inline-flex items-center gap-1.5">
            <AutoLabelsSpecIcon name="lock" className="w-3.5 h-3.5 text-[#1F7A4D]" accent="currentColor" /> Secure &amp; Private · No Obligation
          </p>
        </div>
      </div>
    </div>
  );
};

// Right rail — why scheduling through the passport beats walking in cold.
const TestDriveSupportCard = () => (
  <div className={`${CARD} p-5`}>
    <p className="text-[16px] font-bold text-[#0D1B2A]">A better way to test drive</p>
    <div className="mt-4 space-y-4">
      {([
        ["calendar-check", "Flexible Timing", "Tell us the date and time you'd prefer — the dealership confirms availability."],
        ["paper-plane", "Fast Confirmation", "We'll confirm your test drive quickly."],
        ["people", "No Pressure, Just Answers", "Our team is here to help — no hassle, no obligations."],
      ] as [AutoLabelsSpecIconKey, string, string][]).map(([icon, title, sub]) => (
        <div key={title} className="flex items-start gap-3">
          <SpecIconBadge name={icon} size={44} />
          <div>
            <p className="text-[13.5px] font-bold text-[#10202B]">{title}</p>
            <p className="text-[12.5px] text-[#64748B] leading-relaxed mt-0.5">{sub}</p>
          </div>
        </div>
      ))}
    </div>
    <div className="mt-5 rounded-xl bg-[#EAF4FF] border border-[#D3E6FB] p-3.5 flex items-start gap-2.5">
      <AutoLabelsSpecIcon name="shield-check" className="w-5 h-5 text-[#0B6FEA] shrink-0 mt-0.5" />
      <div>
        <p className="text-[12.5px] font-bold text-[#0B6FEA]">Your Information is Secure</p>
        <p className="text-[12px] text-[#3D5876] leading-relaxed mt-0.5">Your details are encrypted in transit and shared only with this dealership to respond to your request.</p>
      </div>
    </div>
  </div>
);

const TestDriveExperience = ({ listing, d, navigate }: { listing: VehicleListing; d: PassportData; navigate: ReturnType<typeof useNavigate> }) => {
  const [date, setDate] = useState("");
  const [window_, setWindow] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<string>("text");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; contact?: string; email?: string }>({});
  const [started, setStarted] = useState(false);
  // Text contact requires explicit SMS consent (TCPA). Idempotency key guards
  // against duplicate leads from repeated taps / retries.
  const [smsConsent, setSmsConsent] = useState(false);
  const [idempotencyKey] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `td-${listing.vin || "x"}-${Math.round(performance.now())}`);

  const isPreview = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("preview");
  useEffect(() => { if (!isPreview) track(listing, "test_drive_page_viewed"); }, [listing, isPreview]);
  const markStarted = () => { if (!started) { setStarted(true); if (!isPreview) track(listing, "test_drive_form_started"); } };

  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const stockNo = mc.stock_no ? String(mc.stock_no) : null;
  const dealerTel = d.dealerPhone ? d.dealerPhone.replace(/[^\d+]/g, "") : null;
  const q = isPreview ? "?preview=1" : "";
  const goBack = () => { if (!isPreview) track(listing, "back_to_passport_clicked"); navigate(resolvePassportBack(window.location.search, listing.slug, isPreview)); };
  const goReserve = () => { if (!isPreview) track(listing, "reserve_vehicle_clicked"); navigate(passportForwardPath(listing.slug, "reserve", window.location.search, isPreview)); };
  const goTrade = () => { if (!isPreview) track(listing, "trade_value_clicked"); navigate(passportForwardPath(listing.slug, "trade", window.location.search, isPreview)); };

  const windowDef = TIME_WINDOWS.find((w) => w.key === window_);

  const submit = async () => {
    if (sent) return; // idempotent: never resubmit after a successful send
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = "Enter your full name.";
    // Contact requirement follows the selected method — Text can't proceed on an
    // email alone, Call needs a phone, Email needs an email.
    if (method === "email") {
      if (!email.trim()) errs.contact = "Add your email so the dealership can reply.";
    } else if (!phone.trim()) {
      errs.contact = method === "text"
        ? "Add a mobile number to receive text updates."
        : "Add a phone number so the dealership can call you.";
    }
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) errs.email = "That email doesn't look right.";
    setErrors(errs);
    const needsConsent = method === "text";
    if (Object.keys(errs).length || (needsConsent && !smsConsent)) {
      if (needsConsent && !smsConsent && !Object.keys(errs).length) toast.error("Please agree to receive text messages, or choose Call or Email.");
      if (!isPreview) track(listing, "test_drive_validation_failed");
      return;
    }
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
        date ? `Requested ${date}` : "",
        windowDef ? `${windowDef.label} (${windowDef.range})` : "",
        method ? `Prefers ${method}` : "",
        stockNo ? `Stock ${stockNo}` : "",
        zip ? `ZIP ${zip}` : "",
        "via vehicle_passport_test_drive_page",
      ].filter(Boolean).join(" · ");
      const routing = (listing as unknown as { contact_routing?: Record<string, unknown> }).contact_routing || null;
      const basePayload = {
        store_id: listing.store_id, name: name.trim(), email: email.trim() || "", phone: phone.trim() || "",
        vehicle_interest: `${listing.ymm || "Vehicle"} (Test Drive)`,
        vehicle_vin: listing.vin, source: src, status: "new",
        notes: `[intent=test_drive] Passport V2 — Test Drive · ${extras}${message.trim() ? `: ${message.trim()}` : ""}`,
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
      trackLeadSubmitted({ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: src === "qr_scan" ? "window_sticker_qr" : "passport", metadata: { intent: "test_drive", event: "test_drive_form_submitted", requested_date: date || null, requested_window: window_ || null, contact_method: method, idempotency_key: idempotencyKey, routing_target_type: (routing?.routingTargetType as string) ?? null } });
      supabase.functions.invoke("lead-alert", {
        body: { slug: listing.slug, vin: listing.vin, intent: "test_drive", name: name.trim(), phone: phone.trim() || null, email: email.trim() || null, source: src, sub_source: "contact" },
      }).catch(() => { /* alert failure never blocks the shopper */ });
      track(listing, "test_drive_form_success");
      setSent(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      track(listing, "test_drive_form_error");
      toast.error("Couldn't send — please call the dealer directly");
    } finally { setSending(false); }
  };

  const readyCard = (
    <div className={`${CARD} p-5`}>
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-[#0D1B2A]">Ready to move forward?</p>
          <p className="text-[12.5px] text-[#64748B] mt-0.5">Explore your options and take the next step with confidence.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 md:w-[440px] shrink-0">
          <button onClick={goReserve} className="h-11 rounded-xl bg-[#0B6FEA] text-white text-[13px] font-bold inline-flex items-center justify-center gap-1.5 hover:bg-[#095CC4]">
            <AutoLabelsSpecIcon name="reserve" className="w-4 h-4" accent="#FFFFFF" /> Reserve This Vehicle
          </button>
          <button onClick={goTrade} className="h-11 rounded-xl border-2 border-[#0B6FEA] text-[#0B6FEA] text-[13px] font-bold inline-flex items-center justify-center gap-1.5 hover:bg-blue-50">
            <AutoLabelsSpecIcon name="trade" className="w-4 h-4" /> Get Trade Value
          </button>
          <button onClick={goBack} className="sm:col-span-2 h-11 rounded-xl border border-[#DDE5EE] text-[13px] font-semibold text-[#10202B] inline-flex items-center justify-center gap-1.5 hover:border-[#0B6FEA]">
            <ChevronLeft className="w-4 h-4" /> Back to Vehicle Passport
          </button>
        </div>
      </div>
    </div>
  );

  if (sent) return (
    <div className="space-y-4">
      <VehicleContextCard listing={listing} d={d} />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        <div className={`${CARD} p-8 text-center`}>
          <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-3" />
          <h2 className="text-[20px] font-extrabold text-[#0D1B2A]">Test-drive request sent</h2>
          <p className="text-[14px] font-semibold text-[#10202B] mt-1">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</p>
          <div className="mt-3 inline-block text-left text-[13px] text-[#64748B] space-y-0.5">
            {date && <div>Preferred date: <span className="font-semibold text-[#10202B]">{date}</span></div>}
            {windowDef && <div>Preferred time: <span className="font-semibold text-[#10202B]">{windowDef.label} · {windowDef.range}</span></div>}
            <div>Preferred contact: <span className="font-semibold text-[#10202B] capitalize">{method}</span></div>
          </div>
          <p className="text-[13px] text-[#64748B] mt-3 max-w-md mx-auto">
            {d.dealerName || "The dealership"} will confirm the exact time. <span className="font-semibold text-[#0D1B2A]">This is not yet a confirmed appointment.</span>
          </p>
          <div className="flex flex-wrap gap-2.5 justify-center mt-5">
            <button onClick={() => { setSent(false); if (!isPreview) track(listing, "test_drive_request_edited"); }} className="h-11 px-4 rounded-xl border border-[#DDE5EE] text-sm font-bold text-[#10202B] inline-flex items-center gap-2">Edit request</button>
            {dealerTel && <a href={`tel:${dealerTel}`} className="h-11 px-4 rounded-xl bg-[#0B6FEA] text-white text-sm font-bold inline-flex items-center gap-2"><Phone className="w-4 h-4" /> Call dealership</a>}
            {d.dealerAddress && <a href={`https://maps.google.com/?q=${encodeURIComponent(d.dealerAddress)}`} target="_blank" rel="noreferrer" className="h-11 px-4 rounded-xl border border-[#DDE5EE] text-sm font-bold text-[#10202B] inline-flex items-center gap-2"><MapPin className="w-4 h-4 text-[#0B6FEA]" /> Get directions</a>}
            <button onClick={goBack} className="h-11 px-4 rounded-xl border border-[#DDE5EE] text-sm font-bold text-[#10202B] inline-flex items-center gap-2"><ChevronLeft className="w-4 h-4" /> Return to Passport</button>
          </div>
        </div>
        <TestDriveSupportCard />
        <div className="lg:col-start-1">{readyCard}</div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <VehicleContextCard listing={listing} d={d} />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        <div id="td-form" className={`${CARD} p-5 sm:p-6 scroll-mt-24`}>
            <div className="flex items-start gap-3.5">
              <SpecIconBadge name="calendar" size={48} />
              <div>
                <h1 className="text-[21px] font-extrabold tracking-tight leading-tight text-[#0D1B2A]">Request a Test Drive</h1>
                <p className="text-[13px] text-[#64748B] mt-0.5">Choose your preferred date and time. The dealership will confirm availability.</p>
              </div>
            </div>

            {/* Step 1 — date + time of day */}
            <div className="mt-6">
              <StepChip n={1} label="Choose a preferred time" />
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 mt-3">
                <div className="relative">
                  <input
                    type="date" value={date} min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => { setDate(e.target.value); markStarted(); }}
                    aria-label="Select a date"
                    className="w-full h-[50px] border border-[#DDE5EE] rounded-[12px] px-4 pr-11 text-sm text-[#10202B] focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8CA3BC] pointer-events-none">
                    <AutoLabelsSpecIcon name="calendar" className="w-[18px] h-[18px]" accent="currentColor" />
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {TIME_WINDOWS.map((w) => {
                    const on = window_ === w.key;
                    return (
                      <button
                        key={w.key} type="button"
                        onClick={() => { setWindow(on ? "" : w.key); markStarted(); }}
                        aria-pressed={on}
                        className={`rounded-xl border px-2 py-3 text-center transition-colors ${on ? "border-[#0B6FEA] bg-[#EAF4FF]" : "border-[#DDE5EE] bg-white hover:border-[#B9CBE0]"}`}
                      >
                        <AutoLabelsSpecIcon name={w.icon} className={`w-7 h-7 mx-auto ${on ? "text-[#0B6FEA]" : "text-[#8CA3BC]"}`} accent={on ? "#0B6FEA" : "currentColor"} style={{ width: 28, height: 28 }} />
                        <p className={`text-[12.5px] font-bold mt-1.5 ${on ? "text-[#0B6FEA]" : "text-[#10202B]"}`}>{w.label}</p>
                        <p className={`text-[10.5px] font-medium ${on ? "text-[#3D5876]" : "text-[#8CA3BC]"}`}>{w.range}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Step 2 — contact details */}
            <div className="mt-6" onInput={markStarted}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <StepChip n={2} label="Your contact details" />
                <div className="flex items-center gap-2">
                  <span className="text-[11.5px] font-semibold text-[#64748B]">Preferred contact method</span>
                  <div className="inline-flex rounded-[10px] border border-[#DDE5EE] bg-white p-0.5">
                    {([["call", "phone", "Call"], ["text", "message", "Text"], ["email", "email", "Email"]] as [string, AutoLabelsSpecIconKey, string][]).map(([key, icon, label]) => {
                      const on = method === key;
                      return (
                        <button
                          key={key} type="button" aria-pressed={on}
                          onClick={() => { setMethod(key); markStarted(); }}
                          className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-[12px] font-semibold transition-colors ${on ? "bg-[#EAF4FF] text-[#0B6FEA] border border-[#0B6FEA]" : "text-[#64748B] hover:text-[#10202B]"}`}
                        >
                          <AutoLabelsSpecIcon name={icon} className="w-3.5 h-3.5" accent="currentColor" /> {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <div>
                  <IconField icon="user">
                    <input id="td-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name *" autoComplete="name" className={`${INPUT} ${errors.name ? "border-rose-400" : ""}`} />
                  </IconField>
                  {errors.name && <p className="text-[11.5px] text-rose-600 mt-1">{errors.name}</p>}
                </div>
                <div>
                  <IconField icon="email">
                    <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" type="email" autoComplete="email" className={`${INPUT} ${errors.email ? "border-rose-400" : ""}`} />
                  </IconField>
                  {errors.email && <p className="text-[11.5px] text-rose-600 mt-1">{errors.email}</p>}
                </div>
                <div>
                  <IconField icon="phone">
                    <input value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="Phone number" type="tel" autoComplete="tel" className={INPUT} />
                  </IconField>
                  {errors.contact
                    ? <p className="text-[11.5px] text-rose-600 mt-1">{errors.contact}</p>
                    : <p className="text-[11.5px] text-[#8CA3BC] mt-1">Email or phone — whichever you prefer.</p>}
                </div>
                <div className="relative">
                  <span className="absolute left-3.5 top-4 text-[#8CA3BC] pointer-events-none">
                    <AutoLabelsSpecIcon name="message" className="w-[18px] h-[18px]" accent="currentColor" />
                  </span>
                  <textarea
                    value={message} onChange={(e) => setMessage(e.target.value)}
                    placeholder="Anything you'd like the dealer to know? (optional)" rows={3}
                    className="w-full min-h-[76px] border border-[#DDE5EE] rounded-[14px] pl-11 pr-4 py-3.5 text-sm text-[#10202B] placeholder:text-[#8CA3BC] focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-white"
                  />
                </div>
              </div>

              {method === "text" && (
                <label className="flex items-start gap-2.5 mt-4 cursor-pointer">
                  <input type="checkbox" checked={smsConsent} onChange={(e) => setSmsConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#0B6FEA] shrink-0" aria-label="Agree to receive text messages" />
                  <span className="text-[11.5px] text-[#64748B] leading-snug">{smsConsentCopy(d.dealerName || "the dealership")}</span>
                </label>
              )}

              <button
                onClick={submit} disabled={sending}
                className="w-full h-[52px] mt-4 rounded-xl bg-[#0B6FEA] hover:bg-[#095CC4] disabled:opacity-60 text-white text-[15px] font-bold flex items-center justify-center gap-2 transition-colors"
              >
                {sending
                  ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <><AutoLabelsSpecIcon name="paper-plane" className="w-4.5 h-4.5" accent="#FFFFFF" style={{ width: 18, height: 18 }} /> Request Test Drive</>}
              </button>
              <p className="text-[11.5px] text-[#8CA3BC] text-center mt-3 inline-flex items-center gap-1.5 w-full justify-center">
                <AutoLabelsSpecIcon name="lock" className="w-3.5 h-3.5 shrink-0" accent="currentColor" />
                Your information is shared with this dealership to respond to your request.
              </p>
          </div>
        </div>

        <TestDriveSupportCard />
        <div className="lg:col-start-1">{readyCard}</div>
      </div>
    </div>
  );
};

export default TestDriveExperience;
