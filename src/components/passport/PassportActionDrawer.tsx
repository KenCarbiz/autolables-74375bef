import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Send, CheckCircle2, Phone } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { VehicleListing } from "@/hooks/useVehicleListing";
import type { PassportData } from "@/lib/passportV2Data";
import { formatPhone } from "@/components/addendum/CustomerInfoSection";
import { trackLeadSubmitted, trackCustomerEngagement } from "@/lib/engagement/customerEngagement";
import TestDriveExperience from "@/components/passport/TestDriveExperience";
import TodaysPriceExperience from "@/components/passport/TodaysPriceExperience";

// ──────────────────────────────────────────────────────────────────────
// PassportActionDrawer — governed V3 action surface.
//
// Every primary/secondary action on the V3 governed passport opens THIS
// drawer instead of navigating into the /v/:slug/:section pages that render
// the other (V2) passport. The shopper never leaves the /v3/ experience.
//
// Reuses the already-governed TestDrive and Today's-Price experiences; the
// reserve / contact / trade / availability actions use one governed lead
// form that writes the SAME leads-table path as the rest of the platform
// (same payload, routing, alerting, attribution) — no divergent data logic.
// ──────────────────────────────────────────────────────────────────────

export type PassportActionKey = "reserve" | "test-drive" | "trade" | "contact" | "payment" | "availability";

const ACTION_META: Record<PassportActionKey, { title: string; subtitle: string; intent: string; cta: string; label: string }> = {
  reserve: { title: "Reserve This Vehicle", subtitle: "Ask the dealership to hold this vehicle for you.", intent: "reserve", cta: "Reserve This Vehicle", label: "Reserve" },
  contact: { title: "Contact Dealer", subtitle: "Send a question — the dealership will follow up.", intent: "contact", cta: "Send message", label: "Contact" },
  trade: { title: "Value My Trade", subtitle: "Tell the dealer about your trade to get an estimate.", intent: "trade", cta: "Get my trade value", label: "Trade" },
  availability: { title: "Check Availability", subtitle: "Confirm this vehicle is still available.", intent: "check_availability", cta: "Check availability", label: "Availability" },
  "test-drive": { title: "Schedule Test Drive", subtitle: "Pick a time that works for you.", intent: "test_drive", cta: "Request test drive", label: "Test drive" },
  payment: { title: "Request Payment Details", subtitle: "See governed payment information for this vehicle.", intent: "payment", cta: "Request payment details", label: "Payment" },
};

function leadErrorMessage(dealerPhone?: string | null): string {
  return dealerPhone
    ? `We couldn't send that just now. Please call the dealership at ${dealerPhone}.`
    : "We couldn't send that just now. Please try again in a moment.";
}

// Governed lead form — reserve / contact / trade / availability.
const ActionLeadForm = ({ listing, d, action, onClose }: { listing: VehicleListing; d: PassportData; action: PassportActionKey; onClose: () => void }) => {
  const meta = ACTION_META[action];
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (sending || sent) return;
    if (!name.trim() || (!email.trim() && !phone.trim())) { toast.error("Name and a phone or email are required"); return; }
    setSending(true);
    try {
      let src = "website";
      let zip = "";
      try { if (sessionStorage.getItem("al_visit_src") === "qr") src = "qr_scan"; zip = sessionStorage.getItem("al_zip") || ""; } catch { /* storage unavailable */ }
      const routing = (listing as unknown as { contact_routing?: Record<string, unknown> }).contact_routing || null;
      const subSource = action === "reserve" ? "reserve_vehicle" : action === "trade" ? "trade_appraisal" : "contact";
      const basePayload = {
        store_id: listing.store_id, name: name.trim(), email: email.trim() || "", phone: phone.trim() || "",
        vehicle_interest: `${listing.ymm || "Vehicle"} (${meta.title})`,
        vehicle_vin: listing.vin, source: src, status: "new",
        notes: `[intent=${meta.intent}] Passport V3 — ${meta.title}${zip ? ` · ZIP ${zip}` : ""}${message.trim() ? `: ${message.trim()}` : ""}`,
      };
      const routedPayload = { ...basePayload, sub_source: subSource, routing: routing ? {
        source: "customer_passport", routingTargetType: routing.routingTargetType ?? null, routingTargetId: routing.routingTargetId ?? null,
        routingReason: routing.routingReason ?? null, displayMode: routing.displayMode ?? null, afterHours: routing.afterHours ?? false,
      } : null };
      // Anonymous shoppers can INSERT but not SELECT leads; retry bare payload
      // if the routing columns aren't migrated yet — a lead is never lost.
      type LeadsTable = { from: (t: string) => { insert: (r: unknown) => Promise<{ error: unknown }> } };
      let insErr = (await (supabase as unknown as LeadsTable).from("leads").insert(routedPayload)).error;
      if (insErr) insErr = (await (supabase as unknown as LeadsTable).from("leads").insert(basePayload)).error;
      if (insErr) throw insErr;
      trackLeadSubmitted({ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: src === "qr_scan" ? "window_sticker_qr" : "passport", metadata: { intent: meta.intent, surface: "v3_action_drawer" } });
      supabase.functions.invoke("lead-alert", { body: { slug: listing.slug, vin: listing.vin, intent: meta.intent, name: name.trim(), phone: phone.trim() || null, email: email.trim() || null, source: src, sub_source: subSource } }).catch(() => { /* alert failure never blocks the shopper */ });
      setSent(true);
    } catch {
      toast.error(leadErrorMessage(d.dealerPhone));
    } finally { setSending(false); }
  };

  if (sent) return (
    <div className="p-8 text-center">
      <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-3" />
      <h3 className="text-lg font-bold text-slate-900 mb-1">Request sent</h3>
      <p className="text-sm text-slate-500">A specialist from the dealership will follow up shortly. This is not yet a confirmed {action === "reserve" ? "hold" : "appointment"}.</p>
      <div className="flex flex-col gap-2 mt-5">
        {d.dealerPhone && <a href={`tel:${d.dealerPhone.replace(/[^\d+]/g, "")}`} className="h-11 px-5 rounded-xl bg-[#2563EB] text-white text-sm font-bold inline-flex items-center justify-center gap-2"><Phone className="w-4 h-4" /> Call now instead</a>}
        <button onClick={onClose} className="h-11 px-5 rounded-xl border border-slate-200 text-sm font-bold text-slate-700">Back to vehicle</button>
      </div>
    </div>
  );

  const field = "w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
  return (
    <div className="p-5">
      <div className="space-y-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name *" className={field} aria-label="Your name" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" className={field} aria-label="Email" />
        <input value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="Phone" type="tel" className={field} aria-label="Phone" />
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Anything you'd like the dealer to know? (optional)" rows={3} className={`${field} resize-none`} aria-label="Message" />
      </div>
      <button onClick={submit} disabled={sending} className="w-full h-12 mt-4 bg-[#2563EB] hover:bg-[#1d4fd7] disabled:opacity-60 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-colors">
        {sending ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><Send className="w-4 h-4" /> {meta.cta}</>}
      </button>
      <p className="text-[11px] text-slate-400 text-center mt-3">By submitting, you agree to be contacted by the dealership about this vehicle.</p>
    </div>
  );
};

export default function PassportActionDrawer({ action, listing, d, onClose }: { action: PassportActionKey | null; listing: VehicleListing; d: PassportData; onClose: () => void }) {
  const navigate = useNavigate();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const open = action != null;

  // Escape to close, background scroll lock, focus the close control, and emit
  // one governed open event per action.
  useEffect(() => {
    if (!open || !action) return;
    trackCustomerEngagement({ tenantId: listing.tenant_id, storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: "passport", surface: "vehicle_passport", eventType: "cta_clicked", metadata: { cta: action, cta_action: action, surface_variant: "v3_action_drawer" } });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => closeRef.current?.focus(), 30);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prevOverflow; window.clearTimeout(t); };
  }, [open, action, onClose, listing]);

  if (!open || !action) return null;
  const meta = ACTION_META[action];

  return createPortal(
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label={meta.title}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 w-full sm:max-w-[560px] bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200 max-sm:top-auto max-sm:inset-x-0 max-sm:rounded-t-2xl max-sm:max-h-[92vh]">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100 shrink-0">
          <div className="min-w-0">
            <h2 className="text-[18px] font-extrabold text-slate-900 leading-tight">{meta.title}</h2>
            <p className="text-[13px] text-slate-500 mt-0.5">{meta.subtitle}</p>
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Close" className="h-9 w-9 grid place-items-center rounded-full hover:bg-slate-100 shrink-0"><X className="w-5 h-5 text-slate-600" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {action === "test-drive" ? (
            <TestDriveExperience listing={listing} d={d} navigate={navigate} />
          ) : action === "payment" ? (
            <TodaysPriceExperience listing={listing} d={d} />
          ) : (
            <ActionLeadForm listing={listing} d={d} action={action} onClose={onClose} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
