import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BellRing, Check } from "lucide-react";

// ──────────────────────────────────────────────────────────────────────
// PriceDropWatch — shopper opt-in on the Vehicle Passport. Captures an email
// (and optional name) so the dealer can re-engage by email when this vehicle's
// advertised price drops. Writes through the anon watch_price RPC, which stamps
// the current price as the baseline; the price-drop-reengage sweep does the
// rest. Honors the dealer's price_drop_watch toggle (passed via `enabled`).
// ──────────────────────────────────────────────────────────────────────

interface Props { slug: string; enabled?: boolean; }

export const PriceDropWatch = ({ slug, enabled = true }: Props) => {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");

  if (!enabled) return null;

  const submit = async () => {
    const e = email.trim().toLowerCase();
    if (!e.includes("@")) { setState("error"); return; }
    setState("saving");
    try {
      // deno-lint-ignore no-explicit-any
      const { data, error } = await (supabase as any).rpc("watch_price", { _slug: slug, _email: e, _name: name.trim() || null });
      if (error || (data && data.ok === false)) { setState("error"); return; }
      setState("done");
    } catch { setState("error"); }
  };

  if (state === "done") return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 flex items-center gap-3">
      <span className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0"><Check className="w-5 h-5 text-[#16A34A]" /></span>
      <div><p className="text-[14px] font-bold text-[#16A34A]">You're on the list</p><p className="text-[12px] text-[#64748B]">We'll email you about price and availability updates for this vehicle.</p></div>
    </div>
  );

  return (
    <div className="rounded-2xl border border-[#E6E8EC] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.05)]">
      <p className="text-[13px] font-semibold inline-flex items-center gap-1.5 mb-2"><BellRing className="w-4 h-4 text-[#2563EB]" /> Get price &amp; availability alerts</p>
      <div className="space-y-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)" className="w-full h-10 px-3 rounded-xl border border-[#E6E8EC] text-sm outline-none focus:border-[#2563EB]" />
        <div className="flex gap-2">
          <input value={email} onChange={(e) => { setEmail(e.target.value); if (state === "error") setState("idle"); }} type="email" placeholder="Email address" inputMode="email"
            className={`flex-1 min-w-0 h-10 px-3 rounded-xl border text-sm outline-none focus:border-[#2563EB] ${state === "error" ? "border-red-400" : "border-[#E6E8EC]"}`} />
          <button onClick={submit} disabled={state === "saving"} className="h-10 px-4 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] disabled:opacity-60 text-white text-sm font-semibold shrink-0">{state === "saving" ? "…" : "Watch"}</button>
        </div>
        {state === "error" && <p className="text-[11px] text-red-500">Enter a valid email address.</p>}
      </div>
    </div>
  );
};

export default PriceDropWatch;
