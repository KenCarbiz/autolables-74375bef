import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Seo from "@/components/Seo";
import Logo from "@/components/brand/Logo";
import LandingIcon from "@/components/brand/LandingIcon";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowRight, CheckCircle2, ShieldCheck, Car, QrCode, Package, CalendarClock,
} from "lucide-react";

const ROLES = [
  "Dealer Principal / Owner", "General Manager", "GSM / Sales Manager",
  "Finance Director / F&I", "Compliance / Office", "Marketing / BDC",
  "Fixed Ops", "Technology / Operations", "Other",
];
const ROOFTOPS = ["1 rooftop", "2–5 rooftops", "6–15 rooftops", "16–50 rooftops", "50+ rooftops"];
const VOLUMES = ["Under 50 units", "50–100 units", "100–250 units", "250–500 units", "500+ units"];

const BENEFIT_CHIPS = ["FTC-aligned addendums", "VIN-decoded vehicle data", "QR-connected packets"];

// Icons come from the locked /public SVG set (blue gradient tile baked in) —
// same system as the landing page, rendered bare via LandingIcon.
const FEATURES = [
  { icon: "/inventory_feed_sync_icon_transparent.svg", title: "Inventory-aware labels", body: "Generate vehicle-specific labels from VIN, trim, pricing, installed products, and inventory feed data." },
  { icon: "/dealer_tenant_logo_icon_transparent.svg", title: "Dealer-branded packets", body: "Apply your store logo, dealership details, disclaimers, and QR codes to every label automatically." },
  { icon: "/fifty_state_disclosure_engine_icon_transparent.svg", title: "Disclosure engine, 50 states", body: "Generate FTC-aligned addendum disclosures, Buyers Guides, warranty selections, and state-specific disclosure language automatically." },
  { icon: "/vehicle_passport_link_icon_transparent.svg", title: "QR-connected vehicle passport", body: "Link every printed label back to the live vehicle record — disclosures, media, warranty, and packet included." },
];

const TRUST_ROW = [
  { icon: "/secure_compliance_cloud_icon_transparent.svg", title: "Secure dealership onboarding", body: "We never sell your information or share it with other stores." },
  { icon: "/ftc_aligned_addendums_icon_transparent.svg", title: "Built for automotive compliance workflows", body: "Designed around real dealership label, addendum, and disclosure processes." },
  { icon: "/foreman_signoff_icon_transparent.svg", title: "Early-access spots reviewed manually", body: "We onboard the right stores the right way." },
];

// Compliance vocabulary is deliberate: "FTC-Aligned", never "FTC Compliant"
// (certification-style claims are banned copy — see CLAUDE.md), and the FTC
// form is the "Buyers Guide", no apostrophe (16 CFR Part 455).
const LABEL_TILES = [
  { title: "Factory Warranty", line1: "6yr / 75k", line2: "Powertrain" },
  { title: "Dealer Addendum", line1: "FTC-Aligned", line2: "Doc Fee Disclosed" },
  { title: "Buyers Guide", line1: "Used Vehicle", line2: "As Is / Dealer Warranty" },
];

const STATUS_ROW = [
  ["Addendum", "Ready"], ["Warranty", "Matched"], ["QR Packet", "Active"], ["Disclosures", "Complete"],
] as const;

// Two floating status cards, landscape tablets up. Four identical pills read
// as decoration; two asymmetric accents read as product. Positions ride the
// card edges so they never sit on content.
const FLOATING = [
  { label: "Disclosures Ready", pos: "-left-6 -top-3", show: "hidden min-[901px]:flex" },
  { label: "QR Linked", pos: "-right-4 top-[58%]", show: "hidden min-[901px]:flex" },
];

type FieldKey = "full_name" | "email" | "dealership_name";
const FIELD_IDS: Record<FieldKey, string> = { full_name: "wl-name", email: "wl-email", dealership_name: "wl-store" };

const FeatureCards = ({ className }: { className: string }) => (
  <div className={className}>
    {FEATURES.map((c) => (
      <div key={c.title} className="rounded-[20px] border border-[#E6EAF0] bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-24px_rgba(6,25,74,0.3)]">
        <LandingIcon src={c.icon} alt={c.title} />
        <p className="mt-3 text-[14px] font-bold text-[#06194A]">{c.title}</p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#53627A]">{c.body}</p>
      </div>
    ))}
  </div>
);

// Miniature window-sticker artifact for the preview tile — the card claims a
// live label preview, so it shows a label, not a car icon.
const MiniSticker = () => (
  <div className="w-[96px] rounded-md border border-[#E6EAF0] bg-white p-2 shadow-sm">
    <div className="h-1.5 w-10 rounded bg-[#2563EB]" />
    <div className="mt-1.5 space-y-1">
      {[100, 86, 93, 72].map((w, i) => <div key={i} className="h-1 rounded bg-slate-200" style={{ width: `${w}%` }} />)}
    </div>
    <div className="mt-1.5 flex items-end justify-between">
      <div className="space-y-1"><div className="h-1 w-8 rounded bg-slate-200" /><div className="h-1 w-6 rounded bg-slate-200" /></div>
      <QRCodeSVG value="https://autolabels.io/v/demo" size={22} fgColor="#06194A" />
    </div>
  </div>
);

const Waitlist = () => {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Partial<Record<FieldKey, string>>>({});
  const successRef = useRef<HTMLHeadingElement | null>(null);
  const [f, setF] = useState({
    full_name: "", email: "", phone: "", dealership_name: "", role: "",
    oem_brands: "", rooftops: "", city: "", state: "", current_provider: "",
    monthly_volume: "", notes: "", website: "", // website = honeypot
  });

  useEffect(() => { if (done) successRef.current?.focus(); }, [done]);

  const set = (k: keyof typeof f, v: string) => {
    setF((p) => ({ ...p, [k]: v }));
    if (fieldErr[k as FieldKey]) setFieldErr((p) => ({ ...p, [k]: undefined }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (f.website) { setDone(true); return; } // honeypot tripped — silently succeed
    const errs: Partial<Record<FieldKey, string>> = {};
    if (!f.full_name.trim()) errs.full_name = "Enter your full name.";
    if (!f.email.trim()) errs.email = "Enter your work email.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) errs.email = "Enter a valid work email.";
    if (!f.dealership_name.trim()) errs.dealership_name = "Enter your dealership name.";
    if (Object.keys(errs).length) {
      setFieldErr(errs);
      setError("Please complete the highlighted fields.");
      const first = (Object.keys(errs) as FieldKey[])[0];
      const el = document.getElementById(FIELD_IDS[first]);
      el?.focus();
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    setSubmitting(true);
    const { error: insErr } = await supabase
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
    if (insErr) { setError("Something went wrong — please try again, or email us and we'll set you up manually."); return; }
    setDone(true);
  };

  // 16px on phones so iOS Safari doesn't zoom on focus; 48px targets from md.
  const input = (bad?: boolean) =>
    `w-full h-11 md:h-12 px-3.5 rounded-xl border bg-white text-base md:text-sm text-[#0D1B2A] outline-none transition ${
      bad ? "border-rose-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-100" : "border-[#E6EAF0] focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
    }`;
  const label = "text-[12px] font-semibold text-[#53627A] mb-1 block";
  const sectionHead = "text-[11px] font-bold uppercase tracking-[0.12em] text-[#64748B]";
  const errText = "mt-1 text-[11px] font-medium text-rose-600";

  return (
    <div className="min-h-screen bg-white text-[#0D1B2A] antialiased">
      <Seo
        title="Request AutoLabels Early Access"
        description="Early access is open now. AutoLabels turns every vehicle into a branded, QR-connected sales packet — window stickers, addendums, Buyers Guides, and 50-state disclosures, straight from your inventory feed."
        path="/waitlist"
      />

      {/* Nav — 72px, white, thin border */}
      <nav className="sticky top-0 z-50 border-b border-[#E6EAF0] bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-[1280px] items-center justify-between px-6 md:px-8 lg:px-10">
          <button onClick={() => navigate("/")} aria-label="AutoLabels home" className="flex items-center">
            <Logo variant="full" size={32} />
          </button>
          <div className="flex items-center gap-5">
            <span className="hidden min-[901px]:inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3.5 py-1.5 text-[12px] font-semibold text-[#1D4ED8]">
              <Car className="h-3.5 w-3.5" /> Dealer early access
            </span>
            <button onClick={() => navigate("/")} className="inline-flex min-h-11 items-center text-sm font-medium text-[#53627A] hover:text-[#0D1B2A]">
              Back to home <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </nav>

      {done ? (
        /* ── Success state ── */
        <main className="relative mx-auto max-w-[720px] px-6 py-16 lg:py-24">
          <div className="pointer-events-none absolute inset-x-0 -top-24 h-[420px] bg-[radial-gradient(560px_260px_at_50%_0%,rgba(37,99,235,0.10),transparent_70%)]" />
          <div role="status" className="relative rounded-[28px] border border-[#E6EAF0] bg-white p-6 sm:p-10 text-center shadow-[0_20px_60px_-30px_rgba(6,25,74,0.25)]">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="h-9 w-9" />
            </div>
            <h1 ref={successRef} tabIndex={-1} className="font-display text-[26px] sm:text-[32px] font-black tracking-tight leading-tight outline-none [text-wrap:balance]">
              You're on the AutoLabels early-access list.
            </h1>
            <p className="mx-auto mt-4 max-w-md text-[#53627A]">
              We'll review your dealership information and follow up within one business day
              with the best rollout path for your rooftop, templates, and inventory connection.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href={`mailto:hello@autolabels.io?subject=${encodeURIComponent(`AutoLabels setup call — ${f.dealership_name || "my dealership"}`)}`}
                className="inline-flex h-12 items-center gap-2 whitespace-nowrap rounded-xl bg-[#2563EB] px-7 text-sm font-semibold text-white shadow-[0_10px_24px_-10px_rgba(37,99,235,0.6)] transition hover:-translate-y-0.5 hover:bg-[#1D4ED8]"
              >
                <CalendarClock className="h-4 w-4" /> Book a setup call
              </a>
              <button onClick={() => navigate("/")} className="inline-flex h-12 items-center gap-2 rounded-xl border border-[#E6EAF0] bg-white px-7 text-sm font-semibold text-[#0D1B2A] transition hover:border-blue-300">
                Back to home <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            {/* What happens next — fills the void, sets expectations */}
            <div className="mt-8 grid grid-cols-1 gap-3 border-t border-[#F4F6FA] pt-6 sm:grid-cols-3">
              {[["1. Review", "We look at your store, brands, and volume."], ["2. Configure", "Templates, disclosures, and inventory feed mapped to your rooftop."], ["3. Onboard", "Your team prints its first connected labels."]].map(([t, b]) => (
                <div key={t} className="text-left">
                  <p className="text-[13px] font-bold text-[#06194A]">{t}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-[#53627A]">{b}</p>
                </div>
              ))}
            </div>
          </div>
        </main>
      ) : (
        <>
          {/* ── Hero: two-column ── */}
          {/* overflow-x-clip (not hidden): clips the floating cards' negative
              offsets without creating a scroll container, so the form's
              position:sticky actually works. */}
          <main className="relative overflow-x-clip">
            {/* Radial glow + faint blueprint grid */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[720px] bg-[radial-gradient(900px_420px_at_30%_-10%,rgba(37,99,235,0.10),transparent_70%)]" />
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.35]"
              style={{ backgroundImage: "linear-gradient(to right, #F4F6FA 1px, transparent 1px), linear-gradient(to bottom, #F4F6FA 1px, transparent 1px)", backgroundSize: "44px 44px" }}
            />

            <div className="relative mx-auto max-w-[1280px] px-6 md:px-8 lg:px-12 pb-14 pt-10 lg:pt-16">
              {/* Portrait tablets (768-900px) read as a centered single column;
                  landscape tablets (901px+) split hero left / form right. */}
              <div className="grid grid-cols-1 gap-12 max-[900px]:mx-auto max-[900px]:max-w-[720px] min-[901px]:grid-cols-[minmax(0,1fr)_400px] min-[901px]:gap-9 xl:grid-cols-[minmax(0,1fr)_430px] xl:gap-16">
                {/* ── Left column: sell the product ── */}
                <div>
                  <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#E6EAF0] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#53627A] shadow-sm">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    </span>
                    Early access now open
                  </div>

                  <h1 className="font-display text-[36px] font-black leading-[1.06] tracking-tighter text-[#06194A] sm:text-[48px] md:text-[52px] min-[901px]:text-[44px] min-[1181px]:text-[54px]">
                    Window stickers, addendums, and <span className="text-[#2563EB]">disclosures — done right, every vehicle.</span>
                  </h1>

                  <p className="mt-5 max-w-[620px] text-[16px] md:text-[18px] min-[901px]:text-[16px] xl:text-[17px] leading-relaxed text-[#53627A]">
                    AutoLabels turns every vehicle into a branded, QR-connected sales packet —
                    window stickers, addendums, Buyers Guides, and 50-state disclosures,
                    generated straight from your inventory feed.
                  </p>

                  <div className="mt-5 flex flex-wrap gap-2.5">
                    {BENEFIT_CHIPS.map((c) => (
                      <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-[#E6EAF0] bg-white px-3.5 py-1.5 text-[13px] font-semibold text-[#06194A] shadow-sm">
                        <CheckCircle2 className="h-3.5 w-3.5 text-[#16A34A]" /> {c}
                      </span>
                    ))}
                  </div>

                  <p className="mt-4 text-[13px] text-[#64748B]">
                    Built for franchised dealers, independent stores, and multi-rooftop dealer groups.
                  </p>

                  {/* Single-column widths put the form ~3 viewports down — give
                      those visitors a conversion path above the fold. */}
                  <a
                    href="#early-access"
                    className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-6 text-[15px] font-bold text-white shadow-[0_12px_28px_-10px_rgba(37,99,235,0.6)] transition hover:-translate-y-0.5 hover:bg-[#1D4ED8] sm:w-auto min-[901px]:hidden"
                  >
                    Request early access <ArrowRight className="h-4 w-4" />
                  </a>

                  {/* ── Product preview card ── */}
                  <div className="relative mt-10">
                    {FLOATING.map((m) => (
                      <div key={m.label} className={`absolute ${m.pos} z-10 ${m.show} items-center gap-1.5 rounded-xl border border-[#E6EAF0] bg-white px-3 py-2 text-[11px] font-bold text-[#06194A] shadow-[0_12px_30px_-14px_rgba(6,25,74,0.35)]`}>
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {m.label}
                      </div>
                    ))}

                    <div className="rounded-[24px] border border-[#E6EAF0] bg-white p-5 shadow-[0_24px_70px_-32px_rgba(6,25,74,0.28)] sm:p-6">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                        <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#53627A]">
                          <span className="sm:hidden">Label Preview</span>
                          <span className="hidden sm:inline">Live Vehicle Label Preview</span>
                        </p>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Inventory synced
                        </span>
                      </div>

                      {/* Interior stacks in the narrow 901-1180 left column so
                          prices never clip; splits image|details when wide. */}
                      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[200px_minmax(0,1fr)] min-[901px]:grid-cols-1 min-[1181px]:grid-cols-[200px_minmax(0,1fr)]">
                        <div className="flex h-[132px] items-center justify-center rounded-2xl border border-[#E6EAF0] bg-gradient-to-br from-[#F4F6FA] to-[#e8edf5]">
                          <MiniSticker />
                        </div>
                        <div>
                          <p className="text-[17px] font-extrabold leading-tight text-[#06194A]">2026 INFINITI QX60 Luxe AWD</p>
                          <p className="mt-0.5 text-[12px] font-medium tracking-wide text-[#64748B]">VIN: 5N1DL1FS8RC412873</p>
                          <div className="mt-3 grid grid-cols-2 gap-3">
                            <div className="rounded-xl border border-[#E6EAF0] bg-[#F4F6FA] px-3.5 py-2.5">
                              <p className="text-[11px] font-bold uppercase tracking-wide text-[#64748B]">Market Price</p>
                              <p className="text-[18px] font-extrabold text-[#06194A]">$48,995</p>
                            </div>
                            <div className="rounded-xl border border-[#E6EAF0] bg-[#F4F6FA] px-3.5 py-2.5">
                              <p className="text-[11px] font-bold uppercase tracking-wide text-[#64748B]">MSRP</p>
                              <p className="text-[18px] font-extrabold text-[#06194A]">$51,450</p>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {["VIN Etch", "Ceramic Coat", "Tire & Wheel", "Appearance Pkg"].map((p) => (
                              <span key={p} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-[#1D4ED8]">
                                <Package className="h-3 w-3" /> {p}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Label / disclosure tiles — 2x2 at every width; the
                          4-across variant never has room without wrapping. */}
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        {LABEL_TILES.map((t) => (
                          <div key={t.title} className="rounded-2xl border border-[#E6EAF0] bg-white p-3.5">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-[#64748B]">{t.title}</p>
                            <p className="mt-1 text-[14px] font-bold leading-tight text-[#06194A]">{t.line1}</p>
                            <p className="text-[11px] font-medium text-[#53627A]">{t.line2}</p>
                          </div>
                        ))}
                        <div className="flex items-center gap-3 rounded-2xl border border-[#E6EAF0] bg-white p-3.5">
                          <div className="rounded-lg border border-[#E6EAF0] bg-white p-1">
                            <QRCodeSVG value="https://autolabels.io/v/demo" size={44} fgColor="#06194A" />
                          </div>
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-wide text-[#64748B]">QR Passport</p>
                            <p className="mt-0.5 text-[12px] font-semibold text-[#06194A]">Scan to view</p>
                          </div>
                        </div>
                      </div>

                      {/* Compliance status row */}
                      <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-2 rounded-2xl bg-[#F4F6FA] px-4 py-3">
                        {STATUS_ROW.map(([k, v]) => (
                          <span key={k} className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-semibold text-[#06194A]">
                            <CheckCircle2 className="h-3.5 w-3.5 text-[#16A34A]" /> {k}: <span className="text-[#16A34A]">{v}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Feature cards — 2x2 in-column at every width: fills the
                      901-1180 whitespace and never renders as 4 slivers. */}
                  <FeatureCards className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2" />
                </div>

                {/* ── Right column: early-access form ── */}
                <div className="min-[901px]:pt-2">
                  <form id="early-access" onSubmit={submit} noValidate className="scroll-mt-24 min-[901px]:sticky min-[901px]:top-[96px] rounded-[24px] border border-[#E6EAF0] bg-white p-6 shadow-[0_24px_70px_-32px_rgba(6,25,74,0.28)] sm:p-7 md:p-8 min-[901px]:p-7">
                    {/* honeypot */}
                    <input type="text" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set("website", e.target.value)} className="hidden" aria-hidden />

                    <h2 className="font-display text-[24px] font-black tracking-tight text-[#06194A]">Request early access</h2>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-[#53627A]">
                      Tell us about your store so we can configure the right label, addendum,
                      disclosure, and inventory workflow for your rooftop.
                    </p>

                    {/* Section 1 — Contact */}
                    <p className={`${sectionHead} mt-6`}>Contact</p>
                    <div className="mt-2.5 space-y-3.5">
                      <div>
                        <label htmlFor="wl-name" className={label}>Full name *</label>
                        <input id="wl-name" name="name" autoComplete="name" className={input(!!fieldErr.full_name)} value={f.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="Alex Morgan" aria-invalid={!!fieldErr.full_name} aria-required aria-describedby={fieldErr.full_name ? "wl-name-err" : undefined} />
                        {fieldErr.full_name && <p id="wl-name-err" className={errText}>{fieldErr.full_name}</p>}
                      </div>
                      <div>
                        <label htmlFor="wl-email" className={label}>Work email *</label>
                        <input id="wl-email" name="email" type="email" autoComplete="email" className={input(!!fieldErr.email)} value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="alex@dealership.com" aria-invalid={!!fieldErr.email} aria-required aria-describedby={fieldErr.email ? "wl-email-err" : undefined} />
                        {fieldErr.email && <p id="wl-email-err" className={errText}>{fieldErr.email}</p>}
                      </div>
                      <div>
                        <label htmlFor="wl-phone" className={label}>Phone</label>
                        <input id="wl-phone" name="tel" type="tel" inputMode="tel" autoComplete="tel" className={input()} value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="(555) 555-5555" />
                      </div>
                      <div>
                        <label htmlFor="wl-role" className={label}>Your role</label>
                        <select id="wl-role" name="role" className={input()} value={f.role} onChange={(e) => set("role", e.target.value)}>
                          <option value="">Select your role...</option>
                          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Section 2 — Dealership */}
                    <p className={`${sectionHead} mt-6 border-t border-[#F4F6FA] pt-5`}>Dealership</p>
                    <div className="mt-2.5 space-y-3.5">
                      <div>
                        <label htmlFor="wl-store" className={label}>Dealership name *</label>
                        <input id="wl-store" name="organization" autoComplete="organization" className={input(!!fieldErr.dealership_name)} value={f.dealership_name} onChange={(e) => set("dealership_name", e.target.value)} placeholder="Riverside Motors" aria-invalid={!!fieldErr.dealership_name} aria-required aria-describedby={fieldErr.dealership_name ? "wl-store-err" : undefined} />
                        {fieldErr.dealership_name && <p id="wl-store-err" className={errText}>{fieldErr.dealership_name}</p>}
                      </div>
                      <div>
                        <label htmlFor="wl-oem" className={label}>OEM brands / franchises</label>
                        <input id="wl-oem" name="oem_brands" className={input()} value={f.oem_brands} onChange={(e) => set("oem_brands", e.target.value)} placeholder="Infiniti, Nissan, Hyundai, Toyota, Independent..." />
                      </div>
                      <div>
                        <label htmlFor="wl-rooftops" className={label}>Number of rooftops</label>
                        <select id="wl-rooftops" name="rooftops" className={input()} value={f.rooftops} onChange={(e) => set("rooftops", e.target.value)}>
                          <option value="">Select number of rooftops...</option>
                          {ROOFTOPS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
                        <div>
                          <label htmlFor="wl-city" className={label}>City</label>
                          <input id="wl-city" name="city" autoComplete="address-level2" className={input()} value={f.city} onChange={(e) => set("city", e.target.value)} placeholder="Hartford" />
                        </div>
                        <div>
                          <label htmlFor="wl-state" className={label}>State</label>
                          <input id="wl-state" name="state" autoComplete="address-level1" className={input()} maxLength={2} value={f.state} onChange={(e) => set("state", e.target.value.toUpperCase())} placeholder="CT" />
                        </div>
                      </div>
                    </div>

                    {/* Section 3 — Systems */}
                    <p className={`${sectionHead} mt-6 border-t border-[#F4F6FA] pt-5`}>Systems</p>
                    <div className="mt-2.5 space-y-3.5">
                      <div>
                        <label htmlFor="wl-dms" className={label}>Current inventory / DMS provider</label>
                        <input id="wl-dms" name="dms_provider" className={input()} value={f.current_provider} onChange={(e) => set("current_provider", e.target.value)} placeholder="Reynolds, CDK, Dealertrack, Tekion, vAuto..." />
                        <p className="mt-1 text-[11px] text-[#64748B]">This helps us understand your inventory feed and integration path.</p>
                      </div>
                      <div>
                        <label htmlFor="wl-volume" className={label}>Monthly volume</label>
                        <select id="wl-volume" name="monthly_volume" className={input()} value={f.monthly_volume} onChange={(e) => set("monthly_volume", e.target.value)}>
                          <option value="">Select monthly volume...</option>
                          {VOLUMES.map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                        <p className="mt-1 text-[11px] text-[#64748B]">Used to estimate label volume, template complexity, and rollout priority.</p>
                      </div>
                      <div>
                        <label htmlFor="wl-notes" className={label}>Anything else?</label>
                        <textarea
                          id="wl-notes" name="notes" rows={3}
                          className="w-full resize-y rounded-xl border border-[#E6EAF0] bg-white px-3.5 py-2.5 text-base md:text-sm text-[#0D1B2A] outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          value={f.notes} onChange={(e) => set("notes", e.target.value)}
                          placeholder="What label, addendum, warranty, or compliance workflow slows your store down today?"
                        />
                      </div>
                    </div>

                    {error && (
                      <p role="alert" className="mt-4 text-sm font-medium text-rose-600">
                        {error}{error.includes("email us") && <> <a href="mailto:hello@autolabels.io" className="underline">hello@autolabels.io</a></>}
                      </p>
                    )}

                    <button
                      type="submit" disabled={submitting}
                      className="mt-5 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] text-[15px] font-bold text-white shadow-[0_12px_28px_-10px_rgba(37,99,235,0.6)] transition hover:-translate-y-0.5 hover:bg-[#1D4ED8] disabled:translate-y-0 disabled:opacity-60"
                    >
                      {submitting ? (
                        <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Submitting…</>
                      ) : (
                        <>Request early access <ArrowRight className="h-4 w-4" /></>
                      )}
                    </button>
                    <p className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] text-[#64748B]">
                      <ShieldCheck className="h-3.5 w-3.5" /> No spam. We'll only use this to configure your AutoLabels early-access setup.
                    </p>

                    {/* Rollout box */}
                    <div className="mt-5 rounded-2xl border border-[#E6EAF0] bg-[#F4F6FA] p-4">
                      <p className="inline-flex items-center gap-1.5 text-[12px] font-bold text-[#06194A]">
                        <QrCode className="h-3.5 w-3.5 text-[#2563EB]" /> Early-access rollout
                      </p>
                      <ul className="mt-2 space-y-1.5 text-[12px] text-[#53627A]">
                        <li><span className="font-semibold text-[#06194A]">Phase 1:</span> Single rooftops and pilot stores</li>
                        <li><span className="font-semibold text-[#06194A]">Phase 2:</span> Dealer groups — group signups today reserve priority onboarding</li>
                        <li><span className="font-semibold text-[#06194A]">Phase 3:</span> Advanced state-specific disclosure packs</li>
                      </ul>
                    </div>
                  </form>
                </div>
              </div>

              {/* ── Footer trust row ── */}
              <div className="mt-16 grid grid-cols-1 gap-4 border-t border-[#E6EAF0] pt-10 sm:grid-cols-3">
                {TRUST_ROW.map((t) => (
                  <div key={t.title} className="flex items-start gap-3">
                    <LandingIcon src={t.icon} alt={t.title} className="h-10 w-10" />
                    <div>
                      <p className="text-[13px] font-bold text-[#06194A]">{t.title}</p>
                      <p className="mt-0.5 text-[12px] leading-relaxed text-[#53627A]">{t.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </main>
        </>
      )}
    </div>
  );
};

export default Waitlist;
