import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Seo from "@/components/Seo";
import Logo from "@/components/brand/Logo";
import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";

const ROLES = ["Dealer Principal / Owner", "General Manager", "GSM / Sales Manager", "F&I Director", "Compliance / Legal", "Marketing", "Other"];
const ROOFTOPS = ["1", "2–3", "4–10", "11+"];
const VOLUMES = ["Under 50 / mo", "50–150 / mo", "150–400 / mo", "400+ / mo"];

const Waitlist = () => {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    full_name: "", email: "", phone: "", dealership_name: "", role: "",
    oem_brands: "", rooftops: "", city: "", state: "", current_provider: "",
    monthly_volume: "", notes: "", website: "", // website = honeypot
  });

  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (f.website) { setDone(true); return; } // honeypot tripped — silently succeed
    if (!f.full_name.trim() || !f.email.trim() || !f.dealership_name.trim()) {
      setError("Please fill in your name, work email, and dealership.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) {
      setError("Please enter a valid work email.");
      return;
    }
    setSubmitting(true);
    const { error: insErr } = await (supabase as unknown as { from: (t: string) => { insert: (v: unknown) => Promise<{ error: { message: string } | null }> } })
      .from("waitlist_signups")
      .insert({
        full_name: f.full_name.trim(),
        email: f.email.trim().toLowerCase(),
        phone: f.phone.trim() || null,
        dealership_name: f.dealership_name.trim(),
        role: f.role || null,
        oem_brands: f.oem_brands.trim() || null,
        rooftops: f.rooftops || null,
        city: f.city.trim() || null,
        state: f.state.trim().toUpperCase() || null,
        current_provider: f.current_provider.trim() || null,
        monthly_volume: f.monthly_volume || null,
        notes: f.notes.trim() || null,
        source: "landing_waitlist",
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      });
    setSubmitting(false);
    if (insErr) { setError("Something went wrong — please try again."); return; }
    setDone(true);
  };

  const input = "w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition";
  const label = "text-[12px] font-semibold text-slate-700 mb-1 block";

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <Seo
        title="Join the AutoLabels Wait List"
        description="AutoLabels opens July 1st. Join the wait list to get early access to the window-sticker, addendum, and 50-state compliance platform."
        path="/waitlist"
      />
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-slate-100 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
          <button onClick={() => navigate("/")} aria-label="AutoLabels home" className="flex items-center">
            <Logo variant="full" size={32} />
          </button>
          <button onClick={() => navigate("/")} className="text-sm text-slate-600 hover:text-slate-900">Back to home</button>
        </div>
      </nav>

      <main className="mx-auto max-w-3xl px-6 py-12 lg:py-16">
        {done ? (
          <div className="text-center py-12">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="h-9 w-9" />
            </div>
            <h1 className="font-display text-3xl font-black tracking-tight">You're on the list.</h1>
            <p className="mt-3 text-slate-600 max-w-md mx-auto">
              Thanks{f.full_name ? `, ${f.full_name.split(" ")[0]}` : ""} — we'll reach out before AutoLabels opens
              <span className="font-semibold text-slate-900"> July 1st</span> with your early-access details.
            </p>
            <button onClick={() => navigate("/")} className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-[#0B2041] px-6 text-sm font-semibold text-white hover:bg-[#13315e]">
              Back to home <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                Opening July 1st
              </div>
              <h1 className="font-display text-[34px] sm:text-5xl font-black tracking-tighter leading-[1.05]">
                Join the AutoLabels <span className="text-blue-600">wait list.</span>
              </h1>
              <p className="mt-4 text-slate-600 max-w-xl">
                Tell us about your store and we'll get you early access — window stickers, addendums,
                the customer packet, and the 50-state disclosure engine. A few basics is all we need.
              </p>
            </div>

            <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm space-y-5">
              {/* honeypot */}
              <input type="text" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set("website", e.target.value)} className="hidden" aria-hidden />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={label}>Full name *</label>
                  <input className={input} value={f.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="Jane Dealer" />
                </div>
                <div>
                  <label className={label}>Work email *</label>
                  <input type="email" className={input} value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="jane@dealership.com" />
                </div>
                <div>
                  <label className={label}>Phone</label>
                  <input className={input} value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="(555) 555-5555" />
                </div>
                <div>
                  <label className={label}>Your role</label>
                  <select className={input} value={f.role} onChange={(e) => set("role", e.target.value)}>
                    <option value="">Select…</option>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={label}>Dealership name *</label>
                  <input className={input} value={f.dealership_name} onChange={(e) => set("dealership_name", e.target.value)} placeholder="Harte Infiniti" />
                </div>
                <div>
                  <label className={label}>OEM brands / franchises</label>
                  <input className={input} value={f.oem_brands} onChange={(e) => set("oem_brands", e.target.value)} placeholder="Infiniti, Nissan — or Independent" />
                </div>
                <div>
                  <label className={label}>Number of rooftops</label>
                  <select className={input} value={f.rooftops} onChange={(e) => set("rooftops", e.target.value)}>
                    <option value="">Select…</option>
                    {ROOFTOPS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>City</label>
                  <input className={input} value={f.city} onChange={(e) => set("city", e.target.value)} placeholder="Hartford" />
                </div>
                <div>
                  <label className={label}>State</label>
                  <input className={input} maxLength={2} value={f.state} onChange={(e) => set("state", e.target.value.toUpperCase())} placeholder="CT" />
                </div>
                <div>
                  <label className={label}>Current inventory / DMS provider</label>
                  <input className={input} value={f.current_provider} onChange={(e) => set("current_provider", e.target.value)} placeholder="CDK, Reynolds, Tekion, vAuto…" />
                </div>
                <div>
                  <label className={label}>Monthly volume</label>
                  <select className={input} value={f.monthly_volume} onChange={(e) => set("monthly_volume", e.target.value)}>
                    <option value="">Select…</option>
                    {VOLUMES.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={label}>Anything else?</label>
                  <textarea className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition resize-y" rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="What's the biggest compliance or sticker headache we can take off your plate?" />
                </div>
              </div>

              {error && <p className="text-sm font-medium text-rose-600">{error}</p>}

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 pt-1">
                <button type="submit" disabled={submitting} className="inline-flex h-12 items-center gap-2 rounded-full bg-[#0B2041] px-7 text-sm font-semibold text-white hover:bg-[#13315e] disabled:opacity-60">
                  {submitting ? "Joining…" : "Join the wait list"}
                  {!submitting && <ArrowRight className="h-4 w-4" />}
                </button>
                <p className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                  <ShieldCheck className="h-3.5 w-3.5" /> We'll only use this to set up your early access. No spam.
                </p>
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  );
};

export default Waitlist;
