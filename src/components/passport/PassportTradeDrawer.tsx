import { useState } from "react";
import { RefreshCw, Car, CheckCircle2, AlertTriangle, Loader2, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatPhone } from "@/components/addendum/CustomerInfoSection";
import type { VehicleListing } from "@/hooks/useVehicleListing";
import { PassportSlideOver, CARD } from "./PassportSlideOver";

// ──────────────────────────────────────────────────────────────────────
// PassportTradeDrawer — "Value My Trade", over the passport.
//
// What this replaced asked for name, email, phone and a free-text message and
// called itself a trade appraisal. It never asked what the shopper drives, so
// it could not appraise anything; it was a contact form with a valuation
// headline on it.
//
// The order here is the point. The shopper identifies their car, states its
// mileage and condition, and sees whatever the valuation provider actually
// returns — and only then is asked who they are. Contact details are the last
// step, not the price of entry.
//
// Two honesty rules are structural rather than editorial:
//
//   * No number is produced in this file. The range comes from Black Book via
//     the trade-appraisal function, and if the provider returns nothing the
//     drawer says so and offers to have the dealership appraise it. There is
//     no client-side estimate, no "typical value", no placeholder.
//
//   * The call to action matches the capability. Until a valuation has come
//     back the button says "Ask About My Trade", never "Get My Trade Value".
// ──────────────────────────────────────────────────────────────────────

const NAVY = "#0F172A";
const SUB = "#64748B";
const BLUE = "#2563EB";

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

const CONDITIONS: { key: string; label: string; hint: string }[] = [
  { key: "xclean", label: "Excellent", hint: "No cosmetic work needed, full service history" },
  { key: "clean", label: "Good", hint: "Minor wear, mechanically sound" },
  { key: "average", label: "Fair", hint: "Visible wear, some work needed" },
  { key: "rough", label: "Rough", hint: "Significant cosmetic or mechanical needs" },
];

const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

interface Decoded { year: number | null; make: string | null; model: string | null; trim: string | null }

type Step = "identify" | "details" | "confirm" | "result" | "contact" | "done";

const fmt$ = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const Field = ({ label, value, onChange, placeholder, maxLength, inputMode }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  maxLength?: number; inputMode?: "text" | "numeric";
}) => (
  <label className="block">
    <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: SUB }}>{label}</span>
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      inputMode={inputMode}
      className="mt-1 w-full h-12 px-3 rounded-xl border text-[15px] focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
      style={{ borderColor: "#E6E8EC", color: NAVY }}
    />
  </label>
);

export interface PassportTradeDrawerProps {
  open: boolean;
  onClose: () => void;
  listing: VehicleListing;
  dealerName: string;
  /** Non-personal analytics only. */
  track: (event: string, meta?: Record<string, unknown>) => void;
}

export default function PassportTradeDrawer({ open, onClose, listing, dealerName, track }: PassportTradeDrawerProps) {
  const [step, setStep] = useState<Step>("identify");
  const [mode, setMode] = useState<"vin" | "plate">("vin");
  const [vin, setVin] = useState("");
  const [plate, setPlate] = useState("");
  const [plateState, setPlateState] = useState("");
  const [mileage, setMileage] = useState("");
  const [condition, setCondition] = useState("clean");
  const [decoded, setDecoded] = useState<Decoded | null>(null);
  const [valuation, setValuation] = useState<{ available: boolean; low: number | null; high: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");

  const decodedLabel = decoded
    ? [decoded.year, decoded.make, decoded.model, decoded.trim].filter(Boolean).join(" ")
    : plate ? `Plate ${plate}${plateState ? ` (${plateState})` : ""}` : "";

  const reset = () => {
    setStep("identify"); setVin(""); setPlate(""); setPlateState(""); setMileage("");
    setCondition("clean"); setDecoded(null); setValuation(null); setName(""); setContact("");
  };

  const close = () => { onClose(); };

  // ── Step 1 → 2 : identify ───────────────────────────────────────────
  const identify = async () => {
    if (mode === "vin") {
      if (!VIN_RE.test(vin.trim().toUpperCase())) { toast.error("Enter a valid 17-character VIN"); return; }
      setBusy(true);
      try {
        const { data } = await supabase.functions.invoke("trade-appraisal", {
          body: { action: "decode", vin: vin.trim().toUpperCase() },
        });
        const dec = (data as { decoded?: Decoded } | null)?.decoded ?? null;
        setDecoded(dec);
        track("trade_vehicle_identified", { method: "vin", decoded: !!dec });
      } catch {
        setDecoded(null);
      } finally {
        setBusy(false);
      }
    } else {
      if (!plate.trim() || !plateState) { toast.error("Enter your plate and state"); return; }
      // No plate-to-VIN provider is configured, so we do not pretend to have
      // decoded the car. The plate is carried to the dealership, who can look
      // it up, and the shopper is told exactly that.
      setDecoded(null);
      track("trade_vehicle_identified", { method: "plate", decoded: false });
    }
    setStep("details");
  };

  // ── Step 2 → 3/4 : mileage + condition, then valuation ──────────────
  const requestValuation = async () => {
    const miles = Number(mileage.replace(/[^0-9]/g, ""));
    if (!Number.isFinite(miles) || miles <= 0) { toast.error("Enter your current mileage"); return; }
    // A plate-identified car has no VIN to price, so it goes straight to the
    // dealership rather than through a valuation that cannot run.
    if (mode !== "vin" || !VIN_RE.test(vin.trim().toUpperCase())) {
      setValuation({ available: false, low: null, high: null });
      setStep("result");
      return;
    }
    setBusy(true);
    try {
      const { data } = await supabase.functions.invoke("trade-appraisal", {
        body: { action: "value", vin: vin.trim().toUpperCase(), mileage: miles, condition },
      });
      const v = (data as { valuation?: { available: boolean; low: number | null; high: number | null } } | null)?.valuation
        ?? { available: false, low: null, high: null };
      setValuation(v);
      if (v.available) track("trade_valuation_viewed", { condition, has_range: true });
    } catch {
      setValuation({ available: false, low: null, high: null });
    } finally {
      setBusy(false);
      setStep("result");
    }
  };

  // ── Step 5 : contact, only now ──────────────────────────────────────
  const submitLead = async () => {
    if (!name.trim() || !contact.trim()) { toast.error("Add your name and how to reach you"); return; }
    setBusy(true);
    const isEmail = contact.includes("@");
    try {
      const { data, error } = await supabase.functions.invoke("trade-appraisal", {
        body: {
          action: "lead",
          store_id: listing.store_id,
          purchase_vin: listing.vin,
          purchase_label: listing.ymm,
          name: name.trim(),
          email: isEmail ? contact.trim() : "",
          phone: isEmail ? "" : contact.trim(),
          trade_vin: mode === "vin" ? vin.trim().toUpperCase() : "",
          plate: mode === "plate" ? plate.trim().toUpperCase() : "",
          plate_state: mode === "plate" ? plateState : "",
          trade_mileage: Number(mileage.replace(/[^0-9]/g, "")),
          condition,
          decoded_label: decodedLabel,
          valuation_low: valuation?.low ?? null,
          valuation_high: valuation?.high ?? null,
          source_page: typeof window !== "undefined" ? window.location.pathname : "",
          campaign: typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("utm_campaign") || "" : "",
        },
      });
      if (error || (data as { error?: string } | null)?.error) throw new Error("failed");
      track("lead_submitted", { intent: "trade", had_valuation: !!valuation?.available });
      setStep("done");
    } catch {
      toast.error("We couldn't send that. Please call the dealership.");
    } finally {
      setBusy(false);
    }
  };

  const Back = ({ to }: { to: Step }) => (
    <button onClick={() => setStep(to)} className="text-[13px] font-semibold inline-flex items-center gap-1" style={{ color: SUB }}>
      <ChevronLeft className="w-4 h-4" /> Back
    </button>
  );

  const body = (() => {
    switch (step) {
      case "identify":
        return (
          <div className="space-y-4">
            <p className="text-[14px] leading-relaxed" style={{ color: NAVY }}>
              Tell us what you're driving and we'll work it into the numbers on this {listing.ymm || "vehicle"}.
            </p>
            <div className="inline-flex rounded-xl border p-1 text-[13px] font-bold" style={{ borderColor: "#E6E8EC" }}>
              {(["vin", "plate"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className="px-4 h-9 rounded-lg transition-colors"
                  style={mode === m ? { background: BLUE, color: "#fff" } : { color: SUB }}
                >
                  {m === "vin" ? "By VIN" : "By licence plate"}
                </button>
              ))}
            </div>
            {mode === "vin" ? (
              <>
                <Field label="Your vehicle's VIN" value={vin} onChange={(v) => setVin(v.toUpperCase())} placeholder="17 characters" maxLength={17} />
                <p className="text-[12px]" style={{ color: SUB }}>
                  On your insurance card, registration, or the driver's-side windscreen.
                </p>
              </>
            ) : (
              <>
                <div className="grid grid-cols-[1fr_110px] gap-2">
                  <Field label="Licence plate" value={plate} onChange={(v) => setPlate(v.toUpperCase())} placeholder="ABC1234" maxLength={12} />
                  <label className="block">
                    <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: SUB }}>State</span>
                    <select
                      value={plateState}
                      onChange={(e) => setPlateState(e.target.value)}
                      className="mt-1 w-full h-12 px-2 rounded-xl border text-[15px] bg-white"
                      style={{ borderColor: "#E6E8EC", color: NAVY }}
                    >
                      <option value="">—</option>
                      {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                </div>
                {/* Said plainly rather than discovered later: we are not
                    decoding the plate, the dealership is. */}
                <p className="text-[12px] leading-relaxed" style={{ color: SUB }}>
                  {dealerName} looks your plate up on their side. If you have your VIN handy, entering it instead gets you a value range on this screen.
                </p>
              </>
            )}
          </div>
        );

      case "details":
        return (
          <div className="space-y-4">
            <Back to="identify" />
            {decoded && (
              <div className={`${CARD} p-4 flex items-start gap-3`}>
                <Car className="w-5 h-5 shrink-0 mt-0.5" style={{ color: BLUE }} />
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: SUB }}>We decoded your VIN as</p>
                  <p className="text-[15px] font-extrabold" style={{ color: NAVY }}>{decodedLabel}</p>
                </div>
              </div>
            )}
            {mode === "vin" && !decoded && (
              <div className={`${CARD} p-4 flex items-start gap-3`}>
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-500" />
                <p className="text-[13px]" style={{ color: NAVY }}>
                  We couldn't decode that VIN. You can carry on — {dealerName} will confirm the vehicle.
                </p>
              </div>
            )}
            <Field
              label="Current mileage"
              value={mileage}
              onChange={(v) => setMileage(v.replace(/[^0-9]/g, ""))}
              placeholder="e.g. 48000"
              inputMode="numeric"
              maxLength={7}
            />
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: SUB }}>Condition</span>
              <div className="mt-2 space-y-2">
                {CONDITIONS.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setCondition(c.key)}
                    aria-pressed={condition === c.key}
                    className={`${CARD} w-full text-left p-3 transition-colors`}
                    style={condition === c.key ? { borderColor: BLUE, background: "#EFF6FF" } : undefined}
                  >
                    <p className="text-[14px] font-bold" style={{ color: NAVY }}>{c.label}</p>
                    <p className="text-[12px]" style={{ color: SUB }}>{c.hint}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        );

      case "result":
        return (
          <div className="space-y-4">
            <Back to="details" />
            {valuation?.available && valuation.low != null && valuation.high != null ? (
              <>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                  <p className="text-[12px] font-bold uppercase tracking-wide text-emerald-700">Estimated trade-in range</p>
                  <p className="text-[30px] font-extrabold leading-tight mt-1" style={{ color: NAVY }}>
                    {fmt$(valuation.low)} – {fmt$(valuation.high)}
                  </p>
                  <p className="text-[12px] mt-1.5" style={{ color: SUB }}>
                    Black Book trade-in values for a {decodedLabel || "vehicle"} at {Number(mileage).toLocaleString()} miles in {CONDITIONS.find((c) => c.key === condition)?.label.toLowerCase()} condition.
                  </p>
                </div>
                {/* A desk range is not an offer, and saying so here is cheaper
                    than saying it after the shopper has driven over. */}
                <p className="text-[12.5px] leading-relaxed" style={{ color: SUB }}>
                  This is a guide, not an offer. {dealerName} confirms your final number after seeing the vehicle — options,
                  service history, tyres and reconditioning all move it.
                </p>
              </>
            ) : (
              <div className={`${CARD} p-5`}>
                <p className="text-[16px] font-extrabold" style={{ color: NAVY }}>
                  {dealerName} will appraise your {decodedLabel || "vehicle"}
                </p>
                <p className="text-[13px] mt-2 leading-relaxed" style={{ color: SUB }}>
                  We don't have a live valuation for this vehicle, so we're not going to guess at a number.
                  Send your details across and the dealership will come back with a real figure.
                </p>
              </div>
            )}
          </div>
        );

      case "contact":
        return (
          <div className="space-y-4">
            <Back to="result" />
            <p className="text-[14px]" style={{ color: NAVY }}>
              Where should {dealerName} send your trade number?
            </p>
            <Field label="Your name" value={name} onChange={setName} placeholder="Full name" />
            <Field
              label="Email or mobile"
              value={contact}
              onChange={(v) => setContact(v.includes("@") ? v : formatPhone(v))}
              placeholder="you@example.com"
            />
            <p className="text-[11px] leading-relaxed" style={{ color: SUB }}>
              By submitting you agree that {dealerName} may contact you about this vehicle and your trade by phone,
              text or email. Message and data rates may apply. Reply STOP to opt out of texts at any time. Consent is
              not a condition of purchase.
            </p>
          </div>
        );

      case "done":
        return (
          <div className={`${CARD} p-6 text-center`}>
            <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500" />
            <p className="text-[18px] font-extrabold mt-3" style={{ color: NAVY }}>Your trade details are on their way</p>
            <p className="text-[13px] mt-2" style={{ color: SUB }}>
              {dealerName} will confirm your trade value and how it applies to this {listing.ymm || "vehicle"}.
            </p>
          </div>
        );

      default:
        return null;
    }
  })();

  const footer = (() => {
    const btn = (label: string, onClick: () => void, disabled = false) => (
      <button
        onClick={onClick}
        disabled={disabled || busy}
        className="w-full h-12 rounded-xl text-white text-[15px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
        style={{ background: BLUE }}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} {label}
      </button>
    );
    switch (step) {
      case "identify": return btn("Continue", identify);
      case "details": return btn("See my range", requestValuation);
      // The label matches what we can actually deliver.
      case "result": return btn(valuation?.available ? "Apply this to my deal" : "Ask About My Trade", () => setStep("contact"));
      case "contact": return btn("Send to the dealership", submitLead);
      case "done": return (
        <button onClick={() => { reset(); close(); }} className="w-full h-12 rounded-xl border text-[15px] font-bold" style={{ borderColor: "#E6E8EC", color: NAVY }}>
          Back to the vehicle
        </button>
      );
      default: return undefined;
    }
  })();

  return (
    <PassportSlideOver
      open={open}
      onClose={close}
      title="Value My Trade"
      subtitle={step === "done" ? "Sent" : `Step ${["identify", "details", "result", "contact"].indexOf(step) + 1} of 4`}
      footer={footer}
    >
      {body}
    </PassportSlideOver>
  );
}
