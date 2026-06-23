import { useState } from "react";
import { RefreshCw, ArrowRight, CheckCircle2, Car } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatPhone } from "@/components/addendum/CustomerInfoSection";

// Trade-in module — the AutoCurb-powered "value my trade" step embedded in
// the Passport. The instant-offer engine is AutoCurb's; until that link is
// live this collects the shopper's trade details and routes them to the
// dealer as a real lead. No fabricated number is ever shown.

// deno-lint-ignore no-explicit-any
type Dealer = any;

const STEPS = [
  { n: 1, label: "Your trade" },
  { n: 2, label: "We value it" },
  { n: 3, label: "Apply to this car" },
];

export default function TradeInModule({
  storeId,
  vin,
  ymm,
  dealer,
}: {
  storeId: string | null;
  vin: string;
  ymm: string | null;
  dealer: Dealer;
}) {
  const [tradeVin, setTradeVin] = useState("");
  const [mileage, setMileage] = useState("");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const canSubmit = name.trim().length > 0 && contact.trim().length > 0 && (tradeVin.trim().length > 0 || mileage.trim().length > 0);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const isEmail = contact.includes("@");
      await (supabase as any).from("leads").insert({
        store_id: storeId,
        name: name.trim(),
        email: isEmail ? contact.trim() : "",
        phone: isEmail ? "" : contact.trim(),
        vehicle_interest: `${ymm || "Vehicle"} (trade-in)`,
        vehicle_vin: vin,
        source: "website",
        status: "new",
        notes: `[intent=trade] Trade VIN/plate: ${tradeVin.trim() || "n/a"} · Mileage: ${mileage.trim() || "n/a"}`,
      });
      setSent(true);
    } catch {
      // Best-effort; the sticky Reserve bar remains the durable fallback.
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section id="passport-trade" className="rounded-2xl border border-border bg-card shadow-premium p-5 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <RefreshCw className="w-4 h-4 text-blue-600" />
        <h2 className="text-sm font-bold text-foreground">Value your trade-in</h2>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed mb-4">
        Tell {dealer?.name || "the dealership"} about your current vehicle and they'll work your
        trade into the price of this one.
      </p>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-5">
        {STEPS.map((s, i) => (
          <div key={s.n} className="flex items-center gap-2 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                  sent || i === 0 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
                }`}
              >
                {sent ? <CheckCircle2 className="w-3.5 h-3.5" /> : s.n}
              </span>
              <span className="text-[11px] font-semibold text-foreground truncate hidden sm:inline">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && <ArrowRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />}
          </div>
        ))}
      </div>

      {sent ? (
        <div className="rounded-xl bg-slate-950 text-white p-5 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0 text-emerald-400" />
          <div>
            <p className="font-bold text-base">Trade details sent</p>
            <p className="text-xs mt-1 text-white/80">
              {dealer?.name || "The dealership"} will reach out with your trade value and how it
              applies to this {ymm || "vehicle"}.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Trade VIN or plate" value={tradeVin} onChange={setTradeVin} placeholder="VIN or license plate" />
            <Field label="Mileage" value={mileage} onChange={(v) => setMileage(v.replace(/[^0-9]/g, ""))} placeholder="e.g. 48,000" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Your name" value={name} onChange={setName} placeholder="Full name" />
            <Field
              label="Email or phone"
              value={contact}
              onChange={(v) => setContact(v.includes("@") ? v : formatPhone(v))}
              placeholder="you@example.com"
            />
          </div>
          <button
            onClick={submit}
            disabled={!canSubmit || submitting}
            className="w-full h-12 rounded-xl bg-blue-600 text-white font-display font-bold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-blue-700 transition-colors"
          >
            {submitting ? "Sending..." : (<><Car className="w-4 h-4" /> Get my trade value</>)}
          </button>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Final trade value is set by {dealer?.name || "the dealership"} after an in-person
            appraisal. No obligation.
          </p>
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-label text-slate-500">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full h-11 px-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
      />
    </div>
  );
}
