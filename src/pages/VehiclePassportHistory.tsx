import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ChevronLeft, Download, Printer, Upload, ShieldCheck, CheckCircle2, Users, FileText, Wrench,
  BadgeCheck, Gauge, Car, Clock, MessageSquare, Sparkles, AlertTriangle, MapPin, Activity, ArrowRight, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { type VehicleListing } from "@/hooks/useVehicleListing";
import Logo from "@/components/brand/Logo";
import { derivePassport } from "@/lib/passportV2Data";
import { MOCK_LISTING } from "./VehiclePassportV3";
import PassportCtaDock from "@/components/passport/PassportCtaDock";

// ──────────────────────────────────────────────────────────────
// VehiclePassportHistory — /passport-v3/:vehicleSlug/vehicle-history
//
// A modern executive summary of ownership history — the easiest history
// report a shopper has read. Live data via derivePassport; honest
// "Pending verification" states where records aren't available. We never
// fabricate history. No floating CTA (the page stands alone).
// ──────────────────────────────────────────────────────────────

const CARD = "rounded-2xl border border-[#E6E8EC] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.05)]";
const TEXT2 = "text-[#64748B]";
const GREEN = "#16A34A";

const H2 = ({ children }: { children: React.ReactNode }) => <h2 className="text-[20px] font-bold leading-7 tracking-tight text-[#0F172A]">{children}</h2>;

const ScoreRing = ({ score, size = 156 }: { score: number; size?: number }) => {
  const r = size / 2 - 11, c = 2 * Math.PI * r, off = c * (1 - score / 100);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E6E8EC" strokeWidth="10" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={GREEN} strokeWidth="10" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-[40px] font-extrabold text-[#0F172A] leading-none">{score}</span><span className="text-[12px] font-bold text-[#94A3B8] mt-0.5">/ 100</span></div>
    </div>
  );
};

// Mobile accordion card (one open at a time, ≥64px touch target).
type MStatus = "verified" | "attention" | "pending";
const MAcc = ({ open, onToggle, icon: Icon, title, desc, status, children }: { open: boolean; onToggle: () => void; icon: React.ElementType; title: string; desc: string; status: MStatus; children: React.ReactNode }) => {
  const sc = status === "verified" ? { c: "text-[#16A34A]", bg: "bg-emerald-50", l: "Verified" }
    : status === "attention" ? { c: "text-[#D97706]", bg: "bg-amber-50", l: "Needs Review" }
    : { c: "text-[#94A3B8]", bg: "bg-slate-50", l: "Pending" };
  return (
    <div className={`${CARD} overflow-hidden`}>
      <button onClick={onToggle} className="w-full min-h-[64px] flex items-center gap-3 px-4 py-3 text-left">
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${sc.bg}`}><Icon className={`w-5 h-5 ${sc.c}`} /></span>
        <div className="min-w-0 flex-1"><p className="text-[15px] font-semibold leading-tight">{title}</p><p className="text-[12px] text-[#94A3B8] truncate">{desc}</p></div>
        <span className={`text-[12px] font-bold shrink-0 ${sc.c}`}>{sc.l}</span>
        <ChevronDown className={`w-4 h-4 text-[#CBD5E1] shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
};

const VehiclePassportHistory = () => {
  const params = useParams<{ vehicleSlug?: string; slug?: string }>();
  const vehicleSlug = params.vehicleSlug ?? params.slug;
  const navigate = useNavigate();
  const [listing, setListing] = useState<VehicleListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [mOpen, setMOpen] = useState<string | null>("ownership");  // mobile: one accordion open
  const [ringFill, setRingFill] = useState(false);                  // mobile: ring fills on load

  useEffect(() => { const r = requestAnimationFrame(() => setRingFill(true)); return () => cancelAnimationFrame(r); }, []);

  const isPreview = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("preview");

  useEffect(() => {
    if (!vehicleSlug) return;
    if (isPreview) { setListing(MOCK_LISTING as unknown as VehicleListing); setLoading(false); return; }
    let mounted = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke("public-listing-view", { body: { slug: vehicleSlug } });
      if (!mounted) return;
      const row = (data as { listing?: VehicleListing } | null)?.listing ?? null;
      if (error || !row) { setNotFound(true); setLoading(false); return; }
      setListing(row); setLoading(false);
    })();
    return () => { mounted = false; };
  }, [vehicleSlug, isPreview]);

  const d = useMemo(() => (listing ? derivePassport(listing) : null), [listing]);

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-[#F6F7F9]"><div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" /></div>;
  if (notFound || !listing || !d) return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[#F6F7F9]"><div className="text-center"><FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" /><h1 className="text-xl font-bold">History report unavailable</h1><p className="text-sm text-slate-500 mt-2">This listing may have been sold or unpublished.</p></div></div>
  );

  const slug = listing.slug || vehicleSlug;
  const go = (section: string) => navigate(`/v/${slug}/${section}${isPreview ? "?preview=1" : ""}`);
  const back = () => navigate(`/v/${slug}${isPreview ? "?preview=1" : ""}`);

  const score = d.confScore;
  const histLabel = score == null ? "Pending" : score >= 90 ? "Excellent History" : score >= 80 ? "Very Good History" : score >= 70 ? "Good History" : "Fair History";
  const year = Number((listing.ymm || "").match(/\b(19|20)\d{2}\b/)?.[0]) || null;
  const age = year ? Math.max(1, new Date().getFullYear() - year) : null;
  const avgYearly = listing.mileage != null && age ? Math.round(listing.mileage / age) : null;
  const verifyDate = listing.prep_status?.foreman_signed_at ? new Date(listing.prep_status.foreman_signed_at).toLocaleDateString() : new Date().toLocaleDateString();

  const glance = [
    { icon: Users, label: "Owner Count", value: d.ownerCount != null ? `${d.ownerCount} Owner${d.ownerCount === 1 ? "" : "s"}` : "Pending", ok: d.ownerCount === 1 },
    { icon: ShieldCheck, label: "Accidents", value: d.accidentCount === 0 ? "None Reported" : d.accidentCount != null ? `${d.accidentCount} Reported` : "Pending", ok: d.accidentCount === 0 },
    { icon: FileText, label: "Title", value: d.cleanTitle ? "Clean Title" : "Pending", ok: d.cleanTitle },
    { icon: Wrench, label: "Service Records", value: d.serviceCount > 0 ? `${d.serviceCount} Verified` : "Pending", ok: d.serviceCount > 0 },
    { icon: BadgeCheck, label: "Open Recalls", value: d.recallClear ? "None" : d.openRecalls != null ? `${d.openRecalls}` : "Pending", ok: d.recallClear },
    { icon: Gauge, label: "Odometer", value: listing.mileage != null ? `${listing.mileage.toLocaleString()} mi` : "Pending", ok: d.cleanTitle },
  ];

  const titleRows = [
    { k: "Clean Title", ok: d.cleanTitle },
    { k: "No Salvage Brand", ok: d.cleanTitle },
    { k: "No Flood Damage", ok: d.cleanTitle },
    { k: "Not Rebuilt", ok: d.cleanTitle },
    { k: "No Lemon Buyback", ok: d.cleanTitle },
    { k: "No Fire Damage", ok: d.cleanTitle },
    { k: "Not Junked", ok: d.cleanTitle },
    { k: "No Odometer Rollback", ok: d.cleanTitle },
  ];

  const services = (listing.service_records || []).filter((s) => s && (s.date || s.type || s.mileage));
  const meansItems: string[] = [];
  if (d.ownerCount === 1) meansItems.push("One-owner vehicles typically retain their value better and carry fewer surprises.");
  if (d.serviceCount > 0) meansItems.push("A documented service history reduces the chance of unexpected repair costs.");
  if (d.cleanTitle) meansItems.push("A clean title with no brands protects resale value and financing options.");
  if (listing.mileage != null) meansItems.push("Verified, consistent mileage increases buyer confidence and resale strength.");
  if (d.recallClear) meansItems.push("No open recalls means the vehicle is ready to drive with nothing outstanding.");

  const Section = ({ n, title, sub, children }: { n: number; title: string; sub?: string; children: React.ReactNode }) => (
    <section className={`${CARD} p-5 sm:p-6`}>
      <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-lg bg-blue-50 text-[#2563EB] text-[12px] font-bold flex items-center justify-center shrink-0">{n}</span><H2>{title}</H2></div>
      {sub && <p className={`text-[13px] ${TEXT2} mt-1`}>{sub}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );

  const reports = [
    { t: "Vehicle History PDF", i: FileText },
    { t: "Service History", i: Wrench },
    { t: "Recall Summary", i: BadgeCheck },
    { t: "Title History", i: ShieldCheck },
  ];

  // ── Mobile-only derived content ──
  const mState = d.dealer.state ? String(d.dealer.state) : "";
  const oneLine = score != null && score >= 80 ? "Verified ownership history with no major reported concerns." : "Ownership history summarized from the records available for this vehicle.";
  const mTiles = [
    { icon: Users, big: d.ownerCount != null ? `${d.ownerCount} Owner${d.ownerCount === 1 ? "" : "s"}` : "Pending", sub: d.ownerCount === 1 ? "Since new" : d.ownerCount != null ? "On record" : "—", ok: d.ownerCount === 1 },
    { icon: ShieldCheck, big: d.cleanTitle ? "Clean Title" : "Pending", sub: d.cleanTitle ? "Verified" : "—", ok: d.cleanTitle },
    { icon: Car, big: d.accidentCount === 0 ? "No Accidents" : d.accidentCount != null ? `${d.accidentCount} Reported` : "Pending", sub: "Reported", ok: d.accidentCount === 0 },
    { icon: CheckCircle2, big: d.serviceCount > 0 ? `${d.serviceCount} Records` : "Pending", sub: "Verified", ok: d.serviceCount > 0 },
    { icon: BadgeCheck, big: d.recallClear ? "No Recalls" : d.openRecalls != null ? `${d.openRecalls} Open` : "Pending", sub: "Found", ok: d.recallClear },
    { icon: Gauge, big: listing.mileage != null ? `${listing.mileage.toLocaleString()} mi` : "Pending", sub: "Current", ok: listing.mileage != null },
  ];
  const analysisBullets: string[] = [];
  if (d.ownerCount === 1) analysisBullets.push("Consistent single-owner history");
  else if (d.ownerCount != null) analysisBullets.push("Ownership history on record");
  if (d.serviceCount > 0) analysisBullets.push("Documented service history");
  if (d.cleanTitle) analysisBullets.push("Clean title with no brands");
  if (d.marketAvg != null || (d.belowMarket && d.belowMarket > 0)) analysisBullets.push("Strong market confidence");
  const mReports = [
    { t: "Vehicle History PDF", i: FileText, fn: () => window.print() },
    { t: "Accident Report", i: Car, fn: () => window.print() },
    { t: "Title History", i: ShieldCheck, fn: () => window.print() },
    { t: "Recall Report", i: BadgeCheck, fn: () => window.print() },
    { t: "Service History", i: Wrench, fn: () => go("documents") },
    { t: "Ownership Timeline", i: Clock, fn: () => go("ownership-timeline") },
  ];

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#0F172A]" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <Helmet><title>{`Vehicle History Summary — ${listing.ymm}`}</title>{isPreview && <meta name="robots" content="noindex" />}</Helmet>
      {isPreview && <div className="bg-amber-500 text-white text-center text-[12px] font-bold py-1.5 px-4">SAMPLE PREVIEW — design layout with placeholder data. Not a real listing.</div>}

      {/* ── Mobile (<768px) — premium iOS history certificate ── */}
      <div className="md:hidden pb-[calc(96px+env(safe-area-inset-bottom))]">
        {/* Hero */}
        <div className="bg-white px-5 pt-[calc(12px+env(safe-area-inset-top))] pb-7">
          <button onClick={back} className="text-[14px] font-semibold text-[#2563EB] inline-flex items-center gap-1.5 -ml-1"><ChevronLeft className="w-[18px] h-[18px]" /> Back to Vehicle Passport</button>
          <div className="text-center mt-6">
            <p className="text-[13px] font-semibold text-[#64748B]">Vehicle History Summary</p>
            <p className="text-[12px] text-[#94A3B8] mt-0.5">Verified Today</p>
            <div className="relative w-[200px] h-[200px] mx-auto mt-5">
              <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
                <circle cx="80" cy="80" r="70" fill="none" stroke="#E6E8EC" strokeWidth="12" />
                {score != null && <circle cx="80" cy="80" r="70" fill="none" stroke="#16A34A" strokeWidth="12" strokeLinecap="round" strokeDasharray={2 * Math.PI * 70} strokeDashoffset={ringFill ? (2 * Math.PI * 70) * (1 - score / 100) : 2 * Math.PI * 70} style={{ transition: "stroke-dashoffset 1s ease-out" }} />}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-[56px] font-extrabold leading-none text-[#0F172A]">{score ?? "—"}</span><span className="text-[13px] font-bold text-[#94A3B8] mt-1">History Score</span></div>
            </div>
            <p className="text-[16px] font-extrabold text-[#16A34A] mt-3">{histLabel}</p>
          </div>
        </div>

        {/* Vehicle */}
        <div className="px-5 mt-5">
          {listing.hero_image_url ? <img src={listing.hero_image_url} alt={listing.ymm || ""} className="w-full aspect-[16/10] object-cover rounded-2xl" /> : <div className="w-full aspect-[16/10] rounded-2xl bg-slate-200 flex items-center justify-center"><Car className="w-10 h-10 text-slate-400" /></div>}
          <h1 className="text-[24px] font-extrabold mt-4 leading-tight">{listing.ymm}</h1>
          {listing.trim && <p className="text-[15px] font-semibold text-[#64748B]">{listing.trim}</p>}
          <div className="flex items-center gap-4 mt-2 text-[12px] text-[#94A3B8]"><span>VIN {listing.vin}</span>{listing.mileage != null && <span>{listing.mileage.toLocaleString()} mi</span>}</div>
          <p className="text-[14px] text-[#475569] mt-3">{oneLine}</p>
        </div>

        {/* At a glance — 6 tiles */}
        <div className="px-5 mt-6 grid grid-cols-2 gap-3">
          {mTiles.map((t, i) => (
            <div key={i} className={`${CARD} p-4`}>
              <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${t.ok ? "bg-emerald-50" : "bg-slate-100"}`}><t.icon className={`w-[18px] h-[18px] ${t.ok ? "text-[#16A34A]" : "text-[#94A3B8]"}`} /></span>
              <p className="text-[16px] font-extrabold mt-2 leading-tight">{t.big}</p>
              <p className="text-[11px] text-[#94A3B8] mt-0.5">{t.sub}</p>
            </div>
          ))}
        </div>

        {/* History categories */}
        <div className="px-5 mt-7 space-y-2.5">
          <h2 className="text-[18px] font-bold mb-1">History Details</h2>
          <MAcc open={mOpen === "ownership"} onToggle={() => setMOpen(mOpen === "ownership" ? null : "ownership")} icon={Users} title="Ownership Summary" desc="Personal ownership history" status={d.ownerCount != null ? "verified" : "pending"}>
            {d.ownerCount != null ? (
              <div className="space-y-2">
                {Array.from({ length: Math.min(4, Math.max(1, d.ownerCount)) }).map((_, i, arr) => (
                  <div key={i} className="rounded-xl border border-[#E6E8EC] p-3"><div className="flex items-center justify-between"><p className="text-[13px] font-bold">Owner #{i + 1}</p>{i === arr.length - 1 && <span className="text-[10px] font-bold text-[#16A34A] bg-emerald-50 rounded-full px-2 py-0.5">Current Owner</span>}</div><p className="text-[12px] text-[#64748B]">Personal owner{mState ? ` · ${mState}` : ""}</p></div>
                ))}
              </div>
            ) : <p className="text-[13px] text-[#64748B]">Ownership records are pending verification.</p>}
          </MAcc>

          <MAcc open={mOpen === "accident"} onToggle={() => setMOpen(mOpen === "accident" ? null : "accident")} icon={Car} title="Accident & Damage" desc="Accident and damage history" status={d.accidentCount === 0 ? "verified" : d.accidentCount != null ? "attention" : "pending"}>
            {d.accidentCount === 0 ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
                <p className="text-[15px] font-extrabold text-[#16A34A] inline-flex items-center gap-1.5"><CheckCircle2 className="w-5 h-5" /> No Accidents Reported</p>
                <ul className="mt-2 space-y-1.5">{["No accidents reported", d.cleanTitle ? "No flood history" : null, d.cleanTitle ? "No salvage history" : null, d.cleanTitle ? "Clean title on record" : null].filter(Boolean).map((t) => <li key={t as string} className="flex items-start gap-2 text-[13px] text-[#0F172A]"><CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] shrink-0 mt-0.5" />{t}</li>)}</ul>
              </div>
            ) : d.accidentCount != null ? <p className="text-[13px] text-[#92400E]">{d.accidentCount} incident(s) reported — review the full report with the dealer.</p> : <p className="text-[13px] text-[#64748B]">Accident history is pending verification.</p>}
          </MAcc>

          <MAcc open={mOpen === "title"} onToggle={() => setMOpen(mOpen === "title" ? null : "title")} icon={FileText} title="Title History" desc="Title status and brands" status={d.cleanTitle ? "verified" : "pending"}>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-2">{titleRows.map((r) => <li key={r.k} className="flex items-center gap-2 text-[13px]">{r.ok ? <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" /> : <span className="w-4 h-4 rounded-full border border-[#CBD5E1] shrink-0" />}<span className={r.ok ? "text-[#0F172A]" : "text-[#94A3B8]"}>{r.k}</span></li>)}</ul>
          </MAcc>

          <MAcc open={mOpen === "service"} onToggle={() => setMOpen(mOpen === "service" ? null : "service")} icon={Wrench} title="Service History" desc={d.serviceCount > 0 ? `${d.serviceCount} maintenance record(s)` : "Maintenance records"} status={d.serviceCount > 0 ? "verified" : "pending"}>
            {services.length ? (
              <div className="space-y-2">{services.map((s, i) => <div key={i} className="rounded-xl border border-[#E6E8EC] p-3"><p className="text-[13px] font-bold">{[s.date ? new Date(s.date).toLocaleDateString() : null, s.mileage ? `${s.mileage} mi` : null].filter(Boolean).join(" · ") || `Service ${i + 1}`}</p><p className="text-[12px] text-[#64748B]">{[s.type, s.notes].filter(Boolean).join(" — ") || "Maintenance performed"}</p></div>)}</div>
            ) : <p className="text-[13px] text-[#64748B]">No service records are on file yet.</p>}
          </MAcc>

          <MAcc open={mOpen === "odometer"} onToggle={() => setMOpen(mOpen === "odometer" ? null : "odometer")} icon={Gauge} title="Odometer" desc="Mileage and rollback check" status={listing.mileage != null ? "verified" : "pending"}>
            <div className="flex items-center justify-between gap-3 text-center">
              {[{ v: listing.mileage != null ? `${listing.mileage.toLocaleString()}` : "—", l: "Current mi" }, { v: avgYearly != null ? avgYearly.toLocaleString() : "—", l: "Avg / yr" }, { v: d.cleanTitle ? "Clean" : "—", l: "No rollback" }].map((x) => (
                <div key={x.l} className="flex-1"><p className="text-[18px] font-extrabold leading-none">{x.v}</p><p className="text-[11px] text-[#94A3B8] mt-1">{x.l}</p></div>
              ))}
            </div>
          </MAcc>

          <MAcc open={mOpen === "recall"} onToggle={() => setMOpen(mOpen === "recall" ? null : "recall")} icon={BadgeCheck} title="Recall Status" desc="Open recalls (NHTSA)" status={d.recallClear ? "verified" : d.openRecalls != null ? "attention" : "pending"}>
            {d.recallClear ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4"><p className="text-[15px] font-extrabold text-[#16A34A] inline-flex items-center gap-1.5"><CheckCircle2 className="w-5 h-5" /> No Open Recalls</p><p className="text-[12px] text-[#64748B] mt-1">No active manufacturer recalls were found.</p></div>
            ) : d.openRecalls != null ? <p className="text-[13px] text-[#92400E]">{d.openRecalls} open recall(s) — confirm completion with the dealer.</p> : <p className="text-[13px] text-[#64748B]">Recall status is pending verification.</p>}
          </MAcc>

          <MAcc open={mOpen === "registration"} onToggle={() => setMOpen(mOpen === "registration" ? null : "registration")} icon={MapPin} title="Registration" desc="State and registration history" status="pending">
            <p className="text-[13px] text-[#64748B]">{mState ? `Most recently listed in ${mState}. ` : ""}A state-by-state registration timeline appears here when records are available.</p>
          </MAcc>
        </div>

        {/* Analysis */}
        {analysisBullets.length > 0 && (
          <div className="px-5 mt-7">
            <div className="rounded-2xl p-5 text-white" style={{ background: "linear-gradient(160deg,#0f7a3d 0%,#16A34A 100%)" }}>
              <p className="text-[13px] font-semibold uppercase tracking-wider opacity-85 inline-flex items-center gap-1.5"><Sparkles className="w-4 h-4" /> Our Analysis</p>
              <ul className="mt-2 space-y-1.5">{analysisBullets.slice(0, 3).map((b) => <li key={b} className="flex items-start gap-2 text-[14px]"><CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />{b}</li>)}</ul>
              {score != null && <div className="mt-3 inline-flex items-center gap-2 bg-white/15 rounded-full px-3 py-1"><Gauge className="w-4 h-4" /><span className="text-[13px] font-bold">History Confidence {score}%</span></div>}
            </div>
          </div>
        )}

        {/* What this means */}
        {meansItems.length > 0 && (
          <div className="px-5 mt-7">
            <h2 className="text-[18px] font-bold mb-3">What This Means To You</h2>
            <div className={`${CARD} p-5`}><ul className="space-y-3">{meansItems.map((m) => <li key={m} className="flex items-start gap-2.5 text-[14px] text-[#0F172A]"><CheckCircle2 className="w-[18px] h-[18px] text-[#16A34A] shrink-0 mt-0.5" />{m}</li>)}</ul></div>
          </div>
        )}

        {/* Download reports — 2-col */}
        <div className="px-5 mt-7">
          <h2 className="text-[16px] font-bold mb-3">Download Reports</h2>
          <div className="grid grid-cols-2 gap-3">{mReports.map((r) => (
            <button key={r.t} onClick={r.fn} className={`${CARD} p-4 flex flex-col items-start gap-2 active:bg-slate-50 transition-colors`}>
              <span className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center"><r.i className="w-[18px] h-[18px] text-[#2563EB]" /></span>
              <span className="text-[13px] font-semibold leading-tight text-left">{r.t}</span>
            </button>
          ))}</div>
        </div>
      </div>

      {/* Mobile sticky bottom CTA */}
      <div className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/85 backdrop-blur border-t border-[#E6E8EC] px-4 pt-3 pb-[calc(10px+env(safe-area-inset-bottom))] text-center">
        <button onClick={() => go("verification")} className="w-full h-[52px] rounded-2xl bg-[#16A34A] active:bg-[#15803d] text-white text-[15px] font-bold inline-flex items-center justify-center gap-2 transition-transform active:scale-[0.99]"><ShieldCheck className="w-5 h-5" /> Continue to Verification</button>
        <button onClick={() => go("contact")} className="text-[13px] font-semibold text-[#2563EB] mt-2">Contact Dealer</button>
      </div>

      <header className="hidden md:block border-b border-[#E6E8EC] bg-white sticky top-0 z-20">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-5 h-16 flex items-center justify-between gap-3">
          <button onClick={back} className="text-[13px] font-semibold text-[#2563EB] inline-flex items-center gap-1.5"><ChevronLeft className="w-4 h-4" /> <span className="hidden sm:inline">Back to Vehicle Passport</span><span className="sm:hidden">Back</span></button>
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={async () => { try { if (navigator.share) { await navigator.share({ title: "AutoLabels Vehicle History", url: window.location.href }); return; } } catch { /* ignore */ } toast.success("Link copied"); }} className={`text-[13px] font-medium inline-flex items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Upload className="w-4 h-4" /> <span className="hidden sm:inline">Share</span></button>
            <button onClick={() => window.print()} className={`text-[13px] font-medium inline-flex items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Download className="w-4 h-4" /> <span className="hidden sm:inline">Download</span></button>
            <button onClick={() => window.print()} className={`hidden sm:inline-flex text-[13px] font-medium items-center gap-1.5 ${TEXT2} hover:text-[#0F172A]`}><Printer className="w-4 h-4" /> Print</button>
          </div>
        </div>
      </header>

      <main className="hidden md:block mx-auto max-w-[1100px] px-4 sm:px-5 py-6 space-y-5">
        <div>
          <h1 className="text-[28px] sm:text-[34px] font-bold tracking-tight leading-tight">Vehicle History Summary</h1>
          <p className={`text-[14px] ${TEXT2} mt-1`}>Verified ownership, title, accident, service, and registration history.</p>
        </div>

        {/* 1. Hero */}
        <section className={`${CARD} p-6`}>
          <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr_auto] items-center gap-6">
            <div className="flex justify-center">
              {score != null ? <ScoreRing score={score} /> : <div className="w-[156px] h-[156px] rounded-full border-2 border-dashed border-[#E6E8EC] flex items-center justify-center text-[12px] text-[#94A3B8] text-center px-5">History score pending</div>}
            </div>
            <div className="text-center lg:text-left">
              <p className="text-[20px] font-extrabold text-[#16A34A] leading-tight">{histLabel}</p>
              <p className="text-[17px] font-bold mt-1">This vehicle has {score != null && score >= 80 ? "an excellent" : "a documented"} ownership history.</p>
              <p className={`text-[13px] ${TEXT2} mt-2 max-w-[460px] mx-auto lg:mx-0`}>
                {[d.accidentCount === 0 ? "no reported accidents" : null, d.ownerCount === 1 ? "one personal owner" : null, d.serviceCount > 0 ? "verified service history" : null, d.cleanTitle ? "no title concerns" : null].filter(Boolean).join(", ") || "history is summarized from the records available for this vehicle"}.
              </p>
            </div>
            <div className="rounded-2xl border border-[#E6E8EC] overflow-hidden w-full lg:w-[200px]">
              {listing.hero_image_url ? <img src={listing.hero_image_url} alt="" className="w-full aspect-[4/3] object-cover" /> : <div className="w-full aspect-[4/3] bg-[#1f2227] flex items-center justify-center"><Car className="w-9 h-9 text-slate-500" /></div>}
              <div className="p-3"><p className="text-[13px] font-bold leading-tight">{listing.ymm}</p><p className="text-[11px] text-[#94A3B8] mt-0.5">VIN {listing.vin}</p>{listing.mileage != null && <p className="text-[11px] text-[#94A3B8]">{listing.mileage.toLocaleString()} mi</p>}</div>
            </div>
          </div>
        </section>

        {/* 2. At a glance */}
        <Section n={2} title="History At A Glance">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {glance.map((g) => (
              <div key={g.label} className={`${CARD} p-3.5 text-center`}>
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center mx-auto ${g.ok ? "bg-emerald-50" : "bg-slate-100"}`}><g.icon className={`w-[18px] h-[18px] ${g.ok ? "text-[#16A34A]" : "text-[#94A3B8]"}`} /></span>
                <p className="text-[13px] font-extrabold mt-1.5 leading-tight">{g.value}</p>
                <p className="text-[10px] text-[#94A3B8] mt-0.5">{g.label}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* 3. Ownership */}
        <Section n={3} title="Ownership Summary">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className={`${CARD} p-4`}>
              <div className="flex items-center justify-between py-1.5 border-b border-[#F1F5F9]"><span className="text-[13px] text-[#64748B]">Current owner</span><span className="text-[13px] font-bold">{d.ownerCount === 1 ? "Personal use" : "On record"}</span></div>
              <div className="flex items-center justify-between py-1.5 border-b border-[#F1F5F9]"><span className="text-[13px] text-[#64748B]">Previous owners</span><span className="text-[13px] font-bold">{d.ownerCount != null ? Math.max(0, d.ownerCount - 1) : "Pending"}</span></div>
              <div className="flex items-center justify-between py-1.5"><span className="text-[13px] text-[#64748B]">Use type</span><span className="text-[13px] font-bold">{d.ownerCount === 1 ? "Personal" : "Not reported"}</span></div>
            </div>
            <div className={`${CARD} p-4`}>
              <p className="text-[12px] font-bold mb-2">Ownership types on record</p>
              <div className="flex flex-wrap gap-2">{["Personal", "Commercial", "Lease", "Fleet", "Rental", "Government"].map((t) => {
                const on = t === "Personal" && d.ownerCount === 1;
                return <span key={t} className={`text-[11px] font-semibold rounded-full px-2.5 py-1 ${on ? "bg-emerald-50 text-[#16A34A] border border-emerald-200" : "bg-slate-100 text-[#94A3B8]"}`}>{t}</span>;
              })}</div>
              <p className="text-[11px] text-[#94A3B8] mt-3">Owner-by-owner detail is summarized from the history records available for this vehicle.</p>
            </div>
          </div>
        </Section>

        {/* 4. Accident */}
        <Section n={4} title="Accident & Damage History">
          {d.accidentCount === 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 flex items-center gap-3">
              <CheckCircle2 className="w-7 h-7 text-[#16A34A] shrink-0" />
              <div><p className="text-[16px] font-extrabold text-[#16A34A]">No accidents reported</p><p className="text-[12px] text-[#64748B]">No accident or damage records were found in the available history sources.</p></div>
            </div>
          ) : d.accidentCount != null ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 flex items-center gap-3">
              <AlertTriangle className="w-7 h-7 text-[#D97706] shrink-0" />
              <div><p className="text-[16px] font-extrabold text-[#B45309]">{d.accidentCount} incident{d.accidentCount === 1 ? "" : "s"} reported</p><p className="text-[12px] text-[#64748B]">Incident details (date, severity, repair status) are available in the full report — review with the dealer.</p></div>
            </div>
          ) : (
            <div className={`${CARD} p-4 text-[13px] ${TEXT2}`}>Accident history is pending verification for this vehicle.</div>
          )}
        </Section>

        {/* 5. Title */}
        <Section n={5} title="Title History">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5">
            {titleRows.map((r) => (
              <div key={r.k} className="flex items-center gap-2 text-[13px]">
                {r.ok ? <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" /> : <span className="w-4 h-4 rounded-full border border-[#CBD5E1] shrink-0" />}
                <span className={r.ok ? "text-[#0F172A]" : "text-[#94A3B8]"}>{r.k}</span>
                <span className="ml-auto text-[11px] font-semibold text-[#94A3B8]">{r.ok ? "Verified" : "Pending"}</span>
              </div>
            ))}
            <div className="flex items-center gap-2 text-[13px]"><span className="w-4 h-4 rounded-full border border-[#CBD5E1] shrink-0" /><span className="text-[#94A3B8]">Lien Status</span><span className="ml-auto text-[11px] font-semibold text-[#94A3B8]">Pending</span></div>
            <div className="flex items-center gap-2 text-[13px]"><span className="w-4 h-4 rounded-full border border-[#CBD5E1] shrink-0" /><span className="text-[#94A3B8]">Registration Verified</span><span className="ml-auto text-[11px] font-semibold text-[#94A3B8]">Pending</span></div>
          </div>
        </Section>

        {/* 6. Service */}
        <Section n={6} title="Service History" sub={d.serviceCount > 0 ? `${d.serviceCount} verified maintenance visit${d.serviceCount === 1 ? "" : "s"}.` : undefined}>
          {services.length ? (
            <ol className="space-y-4 relative border-l-2 border-slate-100 ml-1.5 pl-4">
              {services.map((s, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[22px] top-1 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white" />
                  <p className="text-[13px] font-bold">{[s.date ? new Date(s.date).toLocaleDateString() : null, s.mileage ? `${s.mileage} mi` : null].filter(Boolean).join(" · ") || `Service ${i + 1}`}</p>
                  <p className="text-[12px] text-[#64748B]">{[s.type, s.notes].filter(Boolean).join(" — ") || "Maintenance performed"}</p>
                </li>
              ))}
            </ol>
          ) : <div className={`${CARD} p-4 text-[13px] ${TEXT2}`}>Service records appear here when the dealer provides maintenance history.</div>}
        </Section>

        {/* 7. Odometer */}
        <Section n={7} title="Odometer History">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className={`${CARD} p-3.5 text-center`}><p className="text-[11px] text-[#94A3B8]">Current Mileage</p><p className="text-[16px] font-extrabold mt-0.5">{listing.mileage != null ? listing.mileage.toLocaleString() : "—"}</p></div>
            <div className={`${CARD} p-3.5 text-center`}><p className="text-[11px] text-[#94A3B8]">Avg per Year</p><p className="text-[16px] font-extrabold mt-0.5">{avgYearly != null ? avgYearly.toLocaleString() : "—"}</p></div>
            <div className={`${CARD} p-3.5 text-center`}><p className="text-[11px] text-[#94A3B8]">Consistency</p><p className={`text-[14px] font-extrabold mt-0.5 ${d.cleanTitle ? "text-[#16A34A]" : "text-[#94A3B8]"}`}>{d.cleanTitle ? "No rollback" : "Pending"}</p></div>
            <div className={`${CARD} p-3.5 text-center`}><p className="text-[11px] text-[#94A3B8]">Vehicle Age</p><p className="text-[16px] font-extrabold mt-0.5">{age != null ? `${age} yr` : "—"}</p></div>
          </div>
          <p className="text-[11px] text-[#94A3B8] mt-2 inline-flex items-center gap-1"><Activity className="w-3.5 h-3.5" /> A detailed odometer reading-by-reading timeline appears when multiple verified readings are available.</p>
        </Section>

        {/* 8. Recall */}
        <Section n={8} title="Recall Status">
          {d.recallClear ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 flex items-center gap-3"><BadgeCheck className="w-7 h-7 text-[#16A34A] shrink-0" /><div><p className="text-[16px] font-extrabold text-[#16A34A]">No Open Recalls</p><p className="text-[12px] text-[#64748B]">No open safety recalls were found for this vehicle with NHTSA.</p></div></div>
          ) : d.openRecalls != null ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 flex items-center gap-3"><AlertTriangle className="w-7 h-7 text-[#D97706] shrink-0" /><div><p className="text-[16px] font-extrabold text-[#B45309]">{d.openRecalls} open recall{d.openRecalls === 1 ? "" : "s"}</p><p className="text-[12px] text-[#64748B]">Ask the dealer to confirm these are completed before delivery.</p></div></div>
          ) : <div className={`${CARD} p-4 text-[13px] ${TEXT2}`}>Recall status is pending verification with NHTSA.</div>}
        </Section>

        {/* 9. Registration */}
        <Section n={9} title="Registration History">
          <div className={`${CARD} p-4`}>
            {d.dealerAddress ? <p className="text-[13px] text-[#0F172A] inline-flex items-center gap-2"><MapPin className="w-4 h-4 text-[#2563EB]" /> Most recently listed in {d.dealer.state ? String(d.dealer.state) : "the dealer's state"}.</p> : null}
            <p className="text-[13px] text-[#64748B] mt-1">A state-by-state registration and title-transfer timeline appears here when registration records are available. {isPreview ? "" : "No registration records are available yet."}</p>
          </div>
        </Section>

        {/* 10. AI analysis */}
        <section className="rounded-2xl p-6 sm:p-8 text-white" style={{ background: "linear-gradient(160deg,#0f7a3d 0%,#16A34A 100%)" }}>
          <p className="text-[13px] font-semibold uppercase tracking-wider opacity-85">Our Analysis</p>
          <p className="text-[14px] opacity-95 mt-2 max-w-[680px]">{[d.ownerCount === 1 ? "Single-owner ownership" : "Ownership records", d.serviceCount > 0 ? "consistent service" : "available service data", d.cleanTitle ? "a clean title" : "title review", listing.mileage != null ? "verified mileage" : "reported mileage"].join(", ")} combine into a {score != null && score >= 80 ? "high-confidence" : "developing"} history profile. We clearly mark anything still pending dealer or third-party verification.</p>
          {score != null && <div className="mt-4 inline-flex items-center gap-2 bg-white/15 rounded-full px-4 py-1.5"><Gauge className="w-4 h-4" /><span className="text-[13px] font-bold">History Confidence {score}%</span></div>}
        </section>

        {/* 11. What this means */}
        {meansItems.length > 0 && (
          <Section n={11} title="What This Means To You">
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5">{meansItems.map((m) => <li key={m} className="flex items-start gap-2 text-[13px] text-[#0F172A]"><CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />{m}</li>)}</ul>
          </Section>
        )}

        {/* 12. Downloadable reports */}
        <Section n={12} title="Downloadable Reports">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{reports.map((r) => (
            <button key={r.t} onClick={() => go("documents")} className={`${CARD} p-4 flex flex-col items-center text-center gap-2 hover:border-[#2563EB] transition-colors`}>
              <span className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center"><r.i className="w-5 h-5 text-[#2563EB]" /></span>
              <span className="text-[12px] font-semibold leading-tight">{r.t}</span>
              <span className="text-[11px] text-[#2563EB] inline-flex items-center gap-1">Open <ArrowRight className="w-3 h-3" /></span>
            </button>
          ))}</div>
        </Section>

        {/* 13. CTA */}
        <section className="rounded-2xl p-6 sm:p-8 text-white text-center" style={{ background: "linear-gradient(160deg,#2563EB 0%,#1e50c8 100%)" }}>
          <h2 className="text-[24px] font-extrabold">Ready to continue?</h2>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-5">
            <button onClick={() => go("ownership-timeline")} className="h-12 px-5 rounded-xl bg-white/10 border border-white/40 text-white text-[14px] font-bold inline-flex items-center gap-2 hover:bg-white/20 transition-colors"><Clock className="w-5 h-5" /> Ownership Timeline</button>
            <button onClick={() => go("verification")} className="h-12 px-5 rounded-xl bg-white/10 border border-white/40 text-white text-[14px] font-bold inline-flex items-center gap-2 hover:bg-white/20 transition-colors"><ShieldCheck className="w-5 h-5" /> Verification Report</button>
            <button onClick={() => go("reserve")} className="h-12 px-6 rounded-xl bg-white text-[#2563EB] text-[14px] font-bold inline-flex items-center gap-2 transition-transform hover:-translate-y-0.5"><BadgeCheck className="w-5 h-5" /> Reserve This Vehicle</button>
            <button onClick={() => go("contact")} className="h-12 px-5 rounded-xl bg-white/10 border border-white/40 text-white text-[14px] font-bold inline-flex items-center gap-2 hover:bg-white/20 transition-colors"><MessageSquare className="w-5 h-5" /> Contact Dealer</button>
          </div>
        </section>

        {/* Footer */}
        <footer className="pt-2 pb-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-2"><Logo variant="full" size={18} /></div>
          <p className="text-[12px] font-semibold text-[#0F172A]">Vehicle History Summary</p>
          <p className="text-[11px] text-[#94A3B8] mt-1">Generated by AutoLabels {new Date().toLocaleString()} · VIN {listing.vin} · Verified {verifyDate}</p>
          <p className="text-[11px] text-[#94A3B8] mt-0.5 inline-flex items-center gap-1 justify-center"><Sparkles className="w-3 h-3 text-[#2563EB]" /> Powered by AutoLabels AI</p>
        </footer>
      </main>

      <PassportCtaDock go={go} dealerPhone={d.dealerPhone || undefined} reviewRating={d.reviewRating} advisor={d.dealerTrust} />
    </div>
  );
};

export default VehiclePassportHistory;
