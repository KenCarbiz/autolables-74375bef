import { useState } from "react";
import { ShieldCheck, RefreshCw, Phone, MessageSquare, Users, X, Star, Clock, Headset } from "lucide-react";
import { closedPillCopy, type PassportRoutingResult } from "@/lib/passportRouting";
import { trackCustomerEngagement, type CustomerEngagementEventType } from "@/lib/engagement/customerEngagement";

// ──────────────────────────────────────────────────────────────
// PassportCtaDock — the global "Ready to take the next step?" CTA.
// A collapsed pill (bottom-right, desktop) that expands into the blue
// conversion card. The help block at the bottom is routing-aware: the
// server-resolved PassportRoutingResult decides whether the shopper
// sees an assigned specialist, the BDC team, the store, or the
// after-hours capture copy. The shopper only ever sees the result —
// Reserve · Trade · Talk to us — never the routing machinery.
// Falls back to the legacy advisor fields when no routing is attached.
// ──────────────────────────────────────────────────────────────

interface Advisor { advisorName?: string; advisorTitle?: string; advisorPhoto?: string; advisorResponse?: string }

export interface PassportCtaDockProps {
  go: (section: string) => void;
  dealerPhone?: string;
  reviewRating?: number | null;
  advisor?: Advisor;
  routing?: PassportRoutingResult | null;
  vehicle?: { storeId?: string; vehicleId?: string; vin?: string | null };
}

const MiniStars = ({ n }: { n: number }) => (
  <span className="inline-flex items-center gap-0.5">{[0, 1, 2, 3, 4].map((i) => <Star key={i} className="w-3 h-3 text-amber-300" fill={i < Math.round(n) ? "#FCD34D" : "none"} strokeWidth={1.5} />)}</span>
);

export default function PassportCtaDock({ go, dealerPhone, reviewRating, advisor, routing, vehicle }: PassportCtaDockProps) {
  const [open, setOpen] = useState(false);
  const adv = advisor || {};

  // Legacy advisor fields act as an agent-mode routing result so older
  // payloads keep their current behavior.
  const r: PassportRoutingResult | null = routing ?? (adv.advisorName ? {
    routingTargetType: "dealership_default", displayMode: "agent",
    displayName: `${adv.advisorName} is here to help.`,
    displaySubtitle: adv.advisorTitle || "Vehicle Specialist",
    callLabel: `Call ${adv.advisorName.split(" ")[0]}`, contactLabel: "Contact",
    phone: dealerPhone, agentPhotoUrl: adv.advisorPhoto || undefined,
    routingReason: "legacy_advisor", afterHours: false,
  } : null);

  const pill = closedPillCopy(r);
  const phone = r?.phone || dealerPhone;
  const callLabel = r?.callLabel || "Call Sales";
  const contactLabel = r?.contactLabel || "Contact";

  const track = (eventType: CustomerEngagementEventType) => {
    void trackCustomerEngagement({
      eventType, surface: "vehicle_passport", source: "passport",
      storeId: vehicle?.storeId, vehicleId: vehicle?.vehicleId, vin: vehicle?.vin || undefined,
      metadata: r ? { routing_target_type: r.routingTargetType, routing_target_id: r.routingTargetId ?? null, routing_reason: r.routingReason, display_mode: r.displayMode, after_hours: r.afterHours } : {},
    });
  };
  const toggle = () => {
    setOpen((o) => {
      track(o ? "customer_passport_closed" : "customer_passport_opened");
      return !o;
    });
  };
  const onContact = () => {
    track("customer_passport_contact_clicked");
    if (r?.smsNumber) { window.location.href = `sms:${r.smsNumber}`; return; }
    go("contact");
  };

  const helpTitle = r?.afterHours ? "We'll follow up as soon as we open." : (r?.displayName || "Our specialists are here to help.");
  const helpSub = r?.afterHours
    ? (r.afterHoursMessage || "We're closed right now, but send us a message and our team will follow up as soon as we open.")
    : (r?.displaySubtitle || "No pressure. Real people.");
  const HelpIcon = r?.afterHours ? Clock : r?.displayMode === "team" ? Headset : Users;

  return (
    <div className="hidden lg:block fixed bottom-6 right-6 z-40" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <div className={`absolute bottom-[68px] right-0 w-[330px] transition-all duration-200 ${open ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-3 pointer-events-none"}`}>
        <div className="relative rounded-2xl p-6 text-white shadow-[0_20px_50px_rgba(37,99,235,0.35)]" style={{ background: r?.afterHours ? "linear-gradient(160deg,#1e3a8a 0%,#172d6e 100%)" : "linear-gradient(160deg,#2563EB 0%,#1e50c8 100%)" }}>
          <button onClick={toggle} aria-label="Close" className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors"><X className="w-4 h-4" /></button>
          {r?.afterHours ? (
            <>
              <h2 className="text-[20px] font-extrabold leading-tight text-center px-5">Request a callback — we'll reach out when we open.</h2>
              <p className="text-[12px] opacity-90 text-center mt-1">We're closed right now, but your message goes straight to our team.</p>
            </>
          ) : (
            <>
              <h2 className="text-[20px] font-extrabold leading-tight text-center px-5">Ready to take the next step?</h2>
              <p className="text-[12px] opacity-90 text-center mt-1">Choose the option that works best for you.</p>
            </>
          )}
          <button onClick={() => { track("customer_passport_reserve_clicked"); go("reserve"); }} className="mt-5 w-full rounded-xl bg-white text-[#2563EB] px-4 py-3.5 flex items-center justify-center gap-2 shadow-sm transition-transform hover:-translate-y-0.5"><ShieldCheck className="w-5 h-5" /><span className="text-left"><span className="block text-[15px] font-extrabold leading-tight">Reserve This Vehicle</span><span className="block text-[11px] font-medium text-[#2563EB]/70">Ask the dealer to hold it — no payment now.</span></span></button>
          <button onClick={() => { track("customer_passport_trade_clicked"); go("trade"); }} className="mt-3 w-full rounded-xl bg-white/10 border border-white/40 text-white px-4 py-3.5 flex items-center justify-center gap-2 transition-colors hover:bg-white/20"><RefreshCw className="w-5 h-5" /><span className="text-left"><span className="block text-[14px] font-extrabold leading-tight">Get a Trade Appraisal</span><span className="block text-[11px] font-medium opacity-80">Know your trade value in minutes.</span></span></button>
          <div className="mt-5 pt-4 border-t border-white/20">
            {!r?.afterHours && r?.displayMode === "agent" ? (
              <div className="flex items-center gap-3">
                {r.agentPhotoUrl ? <img src={r.agentPhotoUrl} alt="" className="w-11 h-11 rounded-full object-cover ring-2 ring-white/40 shrink-0" /> : <span className="w-11 h-11 rounded-full bg-white/15 flex items-center justify-center shrink-0"><Users className="w-5 h-5" /></span>}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold leading-tight">{r.displayName}</p>
                  <p className="text-[11px] opacity-80 leading-tight">{r.availabilityLabel ? <><span>{r.displaySubtitle.replace(/ · Available now$/, "")}</span> · <span className="text-emerald-300 font-semibold">Available now</span></> : r.displaySubtitle}</p>
                  {reviewRating != null && <div className="mt-0.5"><MiniStars n={reviewRating} /></div>}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3"><span className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center shrink-0"><HelpIcon className="w-5 h-5" /></span><div className="min-w-0 flex-1"><p className="text-[13px] font-bold leading-tight">{helpTitle}</p><p className="text-[11px] opacity-80">{helpSub}</p></div></div>
            )}
            {!routing && adv.advisorResponse && <p className="text-[11px] opacity-80 mt-2">{adv.advisorResponse}</p>}
            <div className="grid grid-cols-2 gap-2 mt-3">
              {phone ? (
                <a href={`tel:${phone}`} onClick={() => track("customer_passport_call_clicked")} className="h-9 rounded-lg bg-white/15 border border-white/40 text-[12px] font-bold inline-flex items-center justify-center gap-1 hover:bg-white/25 transition-colors"><Phone className="w-3.5 h-3.5" /> {callLabel}</a>
              ) : (
                <button onClick={() => { track("customer_passport_call_clicked"); go("contact"); }} className="h-9 rounded-lg bg-white/15 border border-white/40 text-[12px] font-bold inline-flex items-center justify-center gap-1 hover:bg-white/25 transition-colors"><Phone className="w-3.5 h-3.5" /> {callLabel}</button>
              )}
              <button onClick={onContact} className="h-9 rounded-lg bg-white/15 border border-white/40 text-[12px] font-bold inline-flex items-center justify-center gap-1 hover:bg-white/25 transition-colors"><MessageSquare className="w-3.5 h-3.5" /> {contactLabel}</button>
            </div>
          </div>
        </div>
      </div>

      <button onClick={toggle} aria-expanded={open} aria-label={pill.title} className="h-14 pl-5 pr-6 rounded-full text-white shadow-[0_12px_30px_rgba(37,99,235,0.4)] inline-flex items-center gap-2.5 transition-transform hover:-translate-y-0.5" style={{ background: "linear-gradient(160deg,#2563EB 0%,#1e50c8 100%)" }}>
        {open ? <X className="w-5 h-5 shrink-0" /> : r?.displayMode === "agent" && r.agentPhotoUrl && !r.afterHours ? <img src={r.agentPhotoUrl} alt="" className="w-8 h-8 rounded-full object-cover ring-2 ring-white/40 shrink-0 -ml-1" /> : <ShieldCheck className="w-5 h-5 shrink-0" />}
        <span className="text-left leading-tight"><span className="block text-[13px] font-extrabold">{pill.title}</span><span className="block text-[11px] opacity-85">{pill.sub}</span></span>
      </button>
    </div>
  );
}
