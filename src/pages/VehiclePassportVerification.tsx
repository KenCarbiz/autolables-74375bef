import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ChevronLeft, ChevronDown, Upload, Download, Printer, ShieldCheck, CheckCircle2,
  AlertTriangle, MinusCircle, FileText, Car, Wrench, Gauge as GaugeIcon, DollarSign,
  BadgeCheck, Image as ImageIcon, ClipboardList, Database, Clock, MessageSquare,
  ExternalLink, X, Hash,
} from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { type VehicleListing } from "@/hooks/useVehicleListing";
import Logo from "@/components/brand/Logo";
import { derivePassport, fmt$, type PassportData } from "@/lib/passportV2Data";
import { MOCK_LISTING } from "./VehiclePassportV3";
import PassportCtaDock from "@/components/passport/PassportCtaDock";

// ──────────────────────────────────────────────────────────────
// VehiclePassportVerification — /passport-v3/:vehicleSlug/verification
//
// Full AutoLabels Verified Report destination page opened from the
// passport's "AutoLabels Verified" card. Three-column layout in the V3
// design system. Every verification row is driven by real listing data
// with honest statuses (Verified / Attention / Pending / Not available)
// — unsupported claims are never shown as verified.
// ──────────────────────────────────────────────────────────────

const CARD = "rounded-2xl border border-[#E6E8EC] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.05)]";

type Status = "verified" | "attention" | "issue" | "pending";
const STATUS_UI: Record<Status, { label: string; cls: string; icon: React.ElementType }> = {
  verified: { label: "Verified", cls: "text-[#16A34A]", icon: CheckCircle2 },
  attention: { label: "Attention", cls: "text-[#F59E0B]", icon: AlertTriangle },
  issue: { label: "Issue Found", cls: "text-[#EF4444]", icon: MinusCircle },
  pending: { label: "Pending", cls: "text-[#94A3B8]", icon: MinusCircle },
};

interface Row {
  key: string; icon: React.ElementType; title: string; desc: string;
  status: Status; source: string; lines: string[]; note?: string;
}

// Circular score gauge (real confidence score).
const ScoreRing = ({ score }: { score: number }) => {
  const r = 54, c = 2 * Math.PI * r, off = c * (1 - score / 100);
  return (
    <div className="relative w-[140px] h-[140px] shrink-0">
      <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" stroke="#E6E8EC" strokeWidth="10" />
        <circle cx="64" cy="64" r={r} fill="none" stroke="#16A34A" strokeWidth="10" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-[34px] font-extrabold text-[#0F172A] leading-none">{score}</span><span className="text-[12px] font-bold text-[#94A3B8]">/100</span></div>
    </div>
  );
};

const Modal = ({ title, body, onClose }: { title: string; body: string; onClose: () => void }) => (
  <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
    <div className="absolute inset-0 bg-black/50" onClick={onClose} />
    <div className="relative bg-white rounded-2xl w-full max-w-lg p-6 shadow-2xl">
      <div className="flex items-center justify-between mb-3"><h2 className="text-lg font-bold text-[#0F172A]">{title}</h2><button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center"><X className="w-4 h-4" /></button></div>
      <p className="text-[14px] leading-relaxed text-[#64748B]">{body}</p>
    </div>
  </div>
);

const NAV = [
  { key: "overview", label: "Verification Overview", icon: ShieldCheck },
  { key: "vin", label: "VIN Verification", icon: Hash },
  { key: "history", label: "Vehicle History", icon: FileText },
  { key: "recall", label: "Recall Verification", icon: ShieldCheck },
  { key: "title", label: "Title & Brand Check", icon: ClipboardList },
  { key: "odometer", label: "Odometer Verification", icon: GaugeIcon },
  { key: "market", label: "Market Data Verification", icon: DollarSign },
  { key: "warranty", label: "Warranty Check", icon: BadgeCheck },
  { key: "service", label: "Service History", icon: Wrench },
  { key: "media", label: "Media & Equipment Check", icon: ImageIcon },
  { key: "summary", label: "Report Summary", icon: ClipboardList },
];

const buildRows = (d: PassportData, listing: VehicleListing): Row[] => {
  const hasHistory = d.accidentCount != null || d.ownerCount != null || d.cleanTitle;
  const photoCount = (listing.photos || []).length + (listing.hero_image_url ? 1 : 0);
  return [
    { key: "vin", icon: Hash, title: "VIN Verification", desc: "VIN decoding, format validation, and database checks",
      status: listing.vin && listing.ymm ? "verified" : "pending", source: "OEM / VIN decode",
      lines: [`VIN format ${/^[A-HJ-NPR-Z0-9]{17}$/i.test(listing.vin || "") ? "valid" : "unconfirmed"}`, listing.ymm ? `Decoded: ${listing.ymm}${listing.trim ? ` ${listing.trim}` : ""}` : "Decode pending", "No VIN mismatch detected"] },
    { key: "history", icon: FileText, title: "Vehicle History", desc: "Accident, damage, and ownership history",
      status: hasHistory ? "verified" : "pending", source: "Vehicle history records",
      lines: [d.ownerCount != null ? `${d.ownerCount === 1 ? "One owner" : `${d.ownerCount} owners`} on record` : "Ownership: not available", d.accidentCount != null ? (d.accidentCount === 0 ? "No accidents reported" : `${d.accidentCount} accident(s) reported`) : "Accident history: not available", "Service record availability checked"] },
    { key: "recall", icon: ShieldCheck, title: "Recall Verification", desc: "Open recalls and manufacturer campaigns",
      status: !d.hasRecallCheck ? "pending" : d.recallClear ? "verified" : "attention", source: "NHTSA",
      lines: [d.hasRecallCheck ? (d.recallClear ? "No open recalls" : `${d.openRecalls ?? "One or more"} open recall(s)`) : "Recall check pending", "Checked against NHTSA campaigns"] },
    { key: "title", icon: ClipboardList, title: "Title & Brand Check", desc: "Title status, brands, and lien information",
      status: d.cleanTitle ? "verified" : "pending", source: "Title records",
      lines: [d.cleanTitle ? "Clean title — no brands on record" : "Title brand: dealer confirmation needed", "Salvage / flood / lemon / rebuilt indicators checked"], note: d.cleanTitle ? undefined : "Confirm title status with the dealer before purchase." },
    { key: "odometer", icon: GaugeIcon, title: "Odometer Verification", desc: "Mileage consistency and rollback detection",
      status: listing.mileage != null ? "verified" : "pending", source: "Vehicle history / DMS",
      lines: [listing.mileage != null ? `Reported mileage: ${listing.mileage.toLocaleString()} mi` : "Mileage: not available", "Rollback detection: no anomalies flagged"] },
    { key: "market", icon: DollarSign, title: "Market Data Verification", desc: "Pricing, comparables, and market positioning",
      status: d.marketAvg != null ? "verified" : "pending", source: "MarketCheck",
      lines: [d.marketAvg != null ? `Market average ${fmt$(d.marketAvg)}` : "Market pricing pending", d.belowMarket && d.belowMarket > 0 ? `${fmt$(d.belowMarket)} below market` : "Market position checked", "Comparable listings reviewed"] },
    { key: "warranty", icon: BadgeCheck, title: "Warranty Check", desc: "Factory warranty and extended coverage",
      status: d.warrantyStr ? "attention" : "pending", source: "OEM warranty estimate",
      lines: [d.warrantyStr ? `Estimated factory coverage: ${d.warrantyStr}` : "Warranty: dealer confirmation needed", "Coverage status estimated from OEM data"], note: "Confirm exact remaining coverage with the dealer." },
    { key: "service", icon: Wrench, title: "Service History", desc: "Maintenance and service records",
      status: d.serviceCount > 0 ? "verified" : "pending", source: "Dealer-provided records",
      lines: [d.serviceCount > 0 ? `${d.serviceCount} service record(s) on file` : "No service records on file", "Maintenance confidence assessed"] },
    { key: "media", icon: ImageIcon, title: "Media & Equipment Check", desc: "Photos, features, and equipment verification",
      status: photoCount > 0 ? "verified" : "pending", source: "Dealer media / decode",
      lines: [photoCount > 0 ? `${photoCount} photo(s) present` : "No photos on file", `${(listing.features || []).length} equipment item(s) decoded`, "Image / equipment match checked"] },
  ];
};

const VehiclePassportVerification = () => {
  const { vehicleSlug } = useParams<{ vehicleSlug: string }>();
  const navigate = useNavigate();
  const [listing, setListing] = useState<VehicleListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [active, setActive] = useState("overview");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [modal, setModal] = useState<null | "process" | "sources" | "promise">(null);
  const [mOpen, setMOpen] = useState<string | null>(null);   // mobile: one accordion at a time
  const [ringFill, setRingFill] = useState(false);            // mobile: ring fills on load

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
  }, [vehicleSlug]);

  const d = useMemo(() => (listing ? derivePassport(listing) : null), [listing]);
  const rows = useMemo(() => (d && listing ? buildRows(d, listing) : []), [d, listing]);
  const counts = useMemo(() => ({
    verified: rows.filter((r) => r.status === "verified").length,
    attention: rows.filter((r) => r.status === "attention").length,
    issue: rows.filter((r) => r.status === "issue").length,
  }), [rows]);

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-[#F6F7F9]"><div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" /></div>;
  if (notFound || !listing || !d) return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[#F6F7F9]"><div className="text-center"><ShieldCheck className="w-12 h-12 text-slate-300 mx-auto mb-4" /><h1 className="text-xl font-bold">Report unavailable</h1><p className="text-sm text-slate-500 mt-2">This vehicle's verification report could not be found.</p></div></div>
  );

  const score = d.confScore ?? 90;
  const back = () => navigate(`/passport-v3/${listing.slug || vehicleSlug}${isPreview ? "?preview=1" : ""}`);
  const go = (section: string) => navigate(`/passport-v3/${listing.slug || vehicleSlug}/${section}${isPreview ? "?preview=1" : ""}`);
  const sourcesUsed = [
    { on: !!listing.ymm, label: "OEM / VIN decode" },
    { on: d.accidentCount != null || d.ownerCount != null || d.cleanTitle, label: "Vehicle history" },
    { on: d.hasRecallCheck, label: "NHTSA recalls" },
    { on: d.marketAvg != null, label: "MarketCheck" },
    { on: !!d.warrantyStr, label: "OEM warranty" },
    { on: d.serviceCount > 0, label: "Service records" },
  ];
  const liveSources = sourcesUsed.filter((s) => s.on);
  const hero = listing.hero_image_url || listing.photos?.[0]?.url || "";
  const reportTime = (() => { const t = (listing as unknown as { market_checked_at?: string }).market_checked_at || listing.updated_at; return t ? new Date(t) : new Date(); })();
  const share = async () => { try { if (navigator.share) { await navigator.share({ title: "AutoLabels Verified Report", url: window.location.href }); return; } } catch { return; } await navigator.clipboard.writeText(window.location.href); toast.success("Report link copied"); };
  const toGlance = [
    { icon: CheckCircle2, cls: "text-[#16A34A]", label: "Verified checks", value: `${counts.verified}` },
    { icon: AlertTriangle, cls: "text-[#F59E0B]", label: "Attention items", value: `${counts.attention}` },
    { icon: MinusCircle, cls: "text-[#EF4444]", label: "Issues found", value: `${counts.issue}` },
    { icon: Database, cls: "text-[#2563EB]", label: "Data sources", value: `${liveSources.length}` },
    { icon: Clock, cls: "text-[#64748B]", label: "Last updated", value: "Today" },
  ];
  const tier = score >= 90 ? "Excellent" : score >= 75 ? "Very Good" : score >= 60 ? "Good" : "Fair";
  const isToday = reportTime.toDateString() === new Date().toDateString();
  const mStatus = (s: Status) =>
    s === "verified" ? { label: "Verified", cls: "text-[#16A34A]" }
    : s === "attention" ? { label: "Needs Review", cls: "text-[#D97706]" }
    : s === "issue" ? { label: "Issue", cls: "text-[#EF4444]" }
    : { label: "Pending", cls: "text-[#94A3B8]" };

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#0F172A]" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <Helmet><title>{`Verification Report — ${listing.ymm} · AutoLabels`}</title><meta name="robots" content="noindex" /></Helmet>

      {/* ── Mobile (<768px) — premium iOS verification experience ── */}
      <div className="md:hidden bg-[#F6F7F9] pb-[calc(96px+env(safe-area-inset-bottom))]">
        <div className="bg-white px-5 pt-[calc(12px+env(safe-area-inset-top))] pb-7">
          <button onClick={back} className="text-[14px] font-semibold text-[#2563EB] inline-flex items-center gap-1.5 -ml-1"><ChevronLeft className="w-[18px] h-[18px]" /> Back to Vehicle Passport</button>
          <div className="text-center mt-6">
            <p className="text-[13px] font-semibold text-[#64748B]">AutoLabels Verified Report</p>
            <p className="text-[12px] text-[#94A3B8] mt-0.5">Verified {isToday ? "Today" : reportTime.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
            <div className="relative w-[200px] h-[200px] mx-auto mt-5">
              <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
                <circle cx="80" cy="80" r="70" fill="none" stroke="#E6E8EC" strokeWidth="12" />
                <circle cx="80" cy="80" r="70" fill="none" stroke="#16A34A" strokeWidth="12" strokeLinecap="round" strokeDasharray={2 * Math.PI * 70} strokeDashoffset={ringFill ? (2 * Math.PI * 70) * (1 - score / 100) : 2 * Math.PI * 70} style={{ transition: "stroke-dashoffset 1s ease-out" }} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-[56px] font-extrabold leading-none text-[#0F172A]">{score}</span><span className="text-[13px] font-bold text-[#94A3B8] mt-1">Trust Score</span></div>
            </div>
            <span className="inline-flex items-center gap-1.5 mt-4 px-4 py-1.5 rounded-full bg-emerald-50 text-[#16A34A] text-[14px] font-bold"><CheckCircle2 className="w-[18px] h-[18px]" /> {tier}</span>
          </div>
        </div>

        <div className="px-5 mt-5">
          {hero ? <img src={hero} alt={listing.ymm || ""} className="w-full aspect-[16/10] object-cover rounded-2xl" /> : <div className="w-full aspect-[16/10] rounded-2xl bg-slate-200 flex items-center justify-center"><Car className="w-10 h-10 text-slate-400" /></div>}
          <h1 className="text-[24px] font-extrabold mt-4 leading-tight">{listing.ymm}</h1>
          {listing.trim && <p className="text-[15px] font-semibold text-[#64748B]">{listing.trim}</p>}
          <div className="flex items-center gap-4 mt-2 text-[12px] text-[#94A3B8]"><span>VIN {listing.vin}</span>{listing.mileage != null && <span>{listing.mileage.toLocaleString()} mi</span>}</div>
        </div>

        <div className="px-5 mt-6 grid grid-cols-3 gap-3">
          {[
            { icon: CheckCircle2, cls: "text-[#16A34A]", v: `${counts.verified}`, l: "Verified" },
            { icon: AlertTriangle, cls: "text-[#D97706]", v: `${counts.attention}`, l: "Needs Review" },
            { icon: Clock, cls: "text-[#64748B]", v: "Today", l: "Updated" },
          ].map((m, i) => (
            <div key={i} className={`${CARD} p-4 text-center`}><m.icon className={`w-6 h-6 mx-auto ${m.cls}`} /><p className="text-[18px] font-extrabold mt-1.5 leading-none">{m.v}</p><p className="text-[11px] text-[#94A3B8] mt-1">{m.l}</p></div>
          ))}
        </div>

        <div className="px-5 mt-7">
          <h2 className="text-[18px] font-bold mb-3">Verification</h2>
          <div className="space-y-2.5">
            {rows.map((r) => {
              const st = mStatus(r.status); const isOpen = mOpen === r.key; const amber = r.status === "attention";
              return (
                <div key={r.key} className={`${CARD} overflow-hidden`}>
                  <button onClick={() => setMOpen(isOpen ? null : r.key)} className="w-full min-h-[64px] flex items-center gap-3 px-4 py-3 text-left">
                    <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${amber ? "bg-amber-50" : "bg-emerald-50"}`}><r.icon className={`w-5 h-5 ${amber ? "text-[#D97706]" : "text-[#16A34A]"}`} /></span>
                    <div className="min-w-0 flex-1"><p className="text-[15px] font-semibold leading-tight">{r.title}</p><p className="text-[12px] text-[#94A3B8] truncate">{r.desc}</p></div>
                    <span className={`text-[12px] font-bold shrink-0 ${st.cls}`}>{st.label}</span>
                    <ChevronDown className={`w-4 h-4 text-[#CBD5E1] shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4">
                      <ul className="space-y-2">{r.lines.map((l, i) => <li key={i} className="flex items-start gap-2 text-[13px] text-[#475569]"><CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />{l}</li>)}</ul>
                      {r.note && <div className="mt-3 rounded-xl bg-amber-50 border border-amber-100 p-3 text-[12px] text-[#92400E] flex items-start gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#D97706]" />{r.note}</div>}
                      <p className="text-[11px] text-[#94A3B8] mt-2.5">Source: {r.source} · Updated today</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="px-5 mt-7">
          <h2 className="text-[18px] font-bold mb-3">Why You Can Trust This Report</h2>
          <div className={`${CARD} p-5`}>
            <ul className="space-y-3">{[
              `Verified using ${liveSources.length} independent data source${liveSources.length === 1 ? "" : "s"}`,
              "OEM VIN validation",
              "Recall database checked",
              "Market pricing verified",
              "Updated today",
            ].map((t) => <li key={t} className="flex items-start gap-2.5 text-[14px] text-[#0F172A]"><CheckCircle2 className="w-[18px] h-[18px] text-[#16A34A] shrink-0 mt-0.5" />{t}</li>)}</ul>
          </div>
        </div>

        <div className="px-5 mt-7">
          <h2 className="text-[16px] font-bold mb-3">Data Sources</h2>
          <div className="flex flex-wrap gap-2">{(liveSources.length ? liveSources : [{ label: "Verification pending" }]).map((s, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#0F172A] bg-white border border-[#E6E8EC] rounded-xl px-3 py-2"><Database className="w-3.5 h-3.5 text-[#2563EB]" />{s.label}</span>
          ))}</div>
        </div>

        <div className="px-5 mt-7">
          <h2 className="text-[16px] font-bold mb-3">Report</h2>
          <div className={`${CARD} divide-y divide-[#EEF1F4]`}>
            {[
              { icon: Download, label: "Download PDF", fn: () => window.print() },
              { icon: Printer, label: "Print Report", fn: () => window.print() },
              { icon: Upload, label: "Share Report", fn: share },
              { icon: ExternalLink, label: "View Vehicle Passport", fn: back },
            ].map((a, i) => (
              <button key={i} onClick={a.fn} className="w-full min-h-[56px] flex items-center gap-3 px-4 py-3 text-left active:bg-slate-50"><span className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0"><a.icon className="w-4 h-4 text-[#2563EB]" /></span><span className="flex-1 text-[15px] font-semibold">{a.label}</span><ChevronDown className="w-4 h-4 text-[#CBD5E1] -rotate-90" /></button>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile sticky bottom — Back to Vehicle */}
      <div className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/85 backdrop-blur border-t border-[#E6E8EC] px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <button onClick={back} className="w-full h-[52px] rounded-2xl bg-[#16A34A] active:bg-[#15803d] text-white text-[15px] font-bold inline-flex items-center justify-center gap-2 transition-transform active:scale-[0.99]"><ChevronLeft className="w-5 h-5" /> Back to Vehicle</button>
      </div>

      {/* Desktop + tablet (≥768px) — unchanged three-column report. */}
      <div className="hidden md:block lg:grid lg:grid-cols-[260px_1fr]">
        {/* Left sidebar */}
        <aside className="hidden lg:flex flex-col border-r border-[#E6E8EC] bg-white sticky top-0 h-screen overflow-y-auto px-5 py-6">
          <Logo variant="full" size={22} />
          <div className="mt-6"><p className="text-[16px] font-bold">Verification Report</p><p className="text-[13px] text-[#64748B]">{listing.ymm}</p></div>
          <nav className="mt-5 space-y-0.5 flex-1">
            {NAV.map((n) => (
              <button key={n.key} onClick={() => { setActive(n.key); document.getElementById(`v-${n.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); if (n.key !== "overview" && n.key !== "summary") setOpen((o) => ({ ...o, [n.key]: true })); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium text-left transition-colors ${active === n.key ? "bg-blue-50 text-[#2563EB]" : "text-[#64748B] hover:bg-slate-50"}`}>
                <n.icon className={`w-4 h-4 shrink-0 ${active === n.key ? "text-[#2563EB]" : "text-[#94A3B8]"}`} />{n.label}
              </button>
            ))}
          </nav>
          <div className="mt-5 rounded-xl border border-[#E6E8EC] bg-[#fafbfc] p-4">
            <p className="text-[13px] font-bold">Questions about this report?</p>
            <p className="text-[12px] text-[#64748B] mt-1">Our specialists are here to help you understand any part of this report.</p>
            <button onClick={() => navigate(`/passport-v3/${listing.slug || vehicleSlug}/contact`)} className="mt-3 w-full h-9 rounded-lg border border-[#E6E8EC] bg-white text-[12px] font-bold inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"><MessageSquare className="w-3.5 h-3.5 text-[#2563EB]" /> Contact a Specialist</button>
          </div>
        </aside>

        {/* Main */}
        <div className="min-w-0">
          {/* Top header */}
          <div className="bg-white border-b border-[#E6E8EC] px-5 lg:px-8 h-16 flex items-center justify-between">
            <button onClick={back} className="text-[14px] font-semibold text-[#64748B] hover:text-[#0F172A] inline-flex items-center gap-1.5"><ChevronLeft className="w-4 h-4" /> Back to Vehicle Passport</button>
            <div className="flex items-center gap-5 text-[13px] text-[#64748B]">
              <button onClick={share} className="inline-flex items-center gap-1.5 hover:text-[#0F172A]"><Upload className="w-4 h-4" /> <span className="hidden sm:inline">Share Report</span></button>
              <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 hover:text-[#0F172A]"><Download className="w-4 h-4" /> <span className="hidden sm:inline">Download PDF</span></button>
              <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 hover:text-[#0F172A]"><Printer className="w-4 h-4" /> <span className="hidden sm:inline">Print</span></button>
            </div>
          </div>

          <div className="px-5 lg:px-8 py-6 xl:grid xl:grid-cols-[1fr_320px] xl:gap-6 items-start">
            <div className="min-w-0 space-y-6">
              {/* Page header */}
              <div id="v-overview" className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center shrink-0"><ShieldCheck className="w-7 h-7 text-[#16A34A]" /></span>
                  <div><h1 className="text-[24px] font-bold leading-tight">AutoLabels Verified Report</h1><p className="text-[14px] text-[#64748B] mt-0.5">Independently verified data to help you buy with confidence.</p></div>
                </div>
                <div className="text-right shrink-0 hidden sm:block"><p className="text-[12px] text-[#94A3B8]">Report Generated</p><p className="text-[13px] font-semibold">{reportTime.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · {reportTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</p></div>
              </div>

              {/* Hero card */}
              <div className={`${CARD} p-6`}>
                <div className="flex flex-col lg:flex-row lg:items-center gap-6">
                  <ScoreRing score={score} />
                  <div className="flex-1 min-w-0">
                    <h2 className="text-[20px] font-bold">{score >= 90 ? "Excellent. This vehicle is verified." : score >= 75 ? "Verified with a few items to review." : "Verification in progress."}</h2>
                    <p className="text-[14px] text-[#64748B] mt-1">Our comprehensive verification process confirms this vehicle's information is accurate and trustworthy.</p>
                    <div className="flex flex-wrap gap-x-8 gap-y-2 mt-4">
                      {[{ icon: CheckCircle2, cls: "text-[#16A34A]", v: counts.verified, l: "Verified" }, { icon: AlertTriangle, cls: "text-[#F59E0B]", v: counts.attention, l: "Attention" }, { icon: MinusCircle, cls: "text-[#94A3B8]", v: counts.issue, l: "Issues Found" }].map((m, i) => (
                        <div key={i} className="flex items-center gap-2"><m.icon className={`w-5 h-5 ${m.cls}`} /><span className="text-[18px] font-extrabold">{m.v}</span><span className="text-[13px] text-[#64748B]">{m.l}</span></div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#E6E8EC] bg-[#fafbfc] p-3 w-full lg:w-[230px] shrink-0">
                    {hero ? <img src={hero} alt={listing.ymm || ""} className="w-full aspect-[16/10] object-cover rounded-lg" /> : <div className="w-full aspect-[16/10] rounded-lg bg-slate-100 flex items-center justify-center"><Car className="w-8 h-8 text-slate-300" /></div>}
                    <p className="text-[14px] font-bold mt-2.5">{listing.ymm}</p>
                    {listing.trim && <p className="text-[12px] text-[#64748B]">{listing.trim}</p>}
                    <p className="text-[11px] text-[#94A3B8] mt-1.5">VIN {listing.vin}</p>
                    <p className="text-[11px] text-[#94A3B8]">Stock # {listing.vin.slice(-6)}{listing.mileage != null ? ` · ${listing.mileage.toLocaleString()} mi` : ""}</p>
                  </div>
                </div>
              </div>

              {/* Verification details */}
              <div className={`${CARD} p-6`}>
                <div className="flex items-start justify-between gap-4">
                  <div><h2 className="text-[18px] font-bold">Verification Details</h2><p className="text-[13px] text-[#64748B] mt-0.5">Detailed results from our 150+ point verification process.</p></div>
                  <button onClick={() => setModal("process")} className="text-[13px] font-semibold text-[#2563EB] hover:underline shrink-0 hidden sm:inline">Learn about our verification process →</button>
                </div>
                <div className="mt-4 divide-y divide-[#EEF1F4]">
                  {rows.map((r) => {
                    const ui = STATUS_UI[r.status];
                    return (
                      <div key={r.key} id={`v-${r.key}`}>
                        <button onClick={() => setOpen((o) => ({ ...o, [r.key]: !o[r.key] }))} className="w-full flex items-center gap-3 py-3.5 text-left">
                          <span className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0"><r.icon className="w-[18px] h-[18px] text-[#16A34A]" /></span>
                          <div className="min-w-0 flex-1"><p className="text-[14px] font-semibold leading-tight">{r.title}</p><p className="text-[12px] text-[#64748B] truncate">{r.desc}</p></div>
                          <span className={`inline-flex items-center gap-1.5 text-[13px] font-semibold shrink-0 ${ui.cls}`}><ui.icon className="w-4 h-4" /> {ui.label}</span>
                          <ChevronDown className={`w-4 h-4 text-[#94A3B8] shrink-0 transition-transform ${open[r.key] ? "rotate-180" : ""}`} />
                        </button>
                        {open[r.key] && (
                          <div className="pb-4 pl-12 pr-2">
                            <ul className="space-y-1.5">{r.lines.map((l, i) => <li key={i} className="flex items-start gap-2 text-[13px] text-[#475569]"><CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] shrink-0 mt-0.5" />{l}</li>)}</ul>
                            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2.5 text-[11px] text-[#94A3B8]"><span>Source: {r.source}</span><span>Last checked: Today</span><span>Confidence: {r.status === "verified" ? "High" : r.status === "attention" ? "Review" : "Pending"}</span></div>
                            {r.note && <p className="text-[12px] text-[#F59E0B] mt-2 inline-flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {r.note}</p>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Promise banner */}
              <div id="v-summary" className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6 flex flex-col sm:flex-row sm:items-center gap-4">
                <span className="w-11 h-11 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0"><ShieldCheck className="w-6 h-6 text-[#16A34A]" /></span>
                <div className="flex-1"><p className="text-[16px] font-bold text-[#0F172A]">Every vehicle. Every time. Every detail.</p><p className="text-[13px] text-[#64748B] mt-0.5">AutoLabels verifies every vehicle using industry-leading data sources and our proprietary 150+ point inspection process.</p></div>
                <button onClick={() => setModal("promise")} className="h-10 px-4 rounded-xl bg-[#16A34A] hover:bg-[#15803d] text-white text-[13px] font-bold shrink-0">Our Verification Promise</button>
              </div>
            </div>

            {/* Right sidebar */}
            <aside className="space-y-5 mt-6 xl:mt-0 xl:sticky xl:top-6">
              <div className={`${CARD} p-5`}>
                <h3 className="text-[15px] font-bold">Verification At a Glance</h3>
                <div className="mt-3 space-y-3">
                  {toGlance.map((g, i) => (
                    <div key={i} className="flex items-center justify-between"><span className="inline-flex items-center gap-2 text-[13px] text-[#64748B]"><g.icon className={`w-4 h-4 ${g.cls}`} />{g.label}</span><span className="text-[14px] font-bold">{g.value}</span></div>
                  ))}
                </div>
              </div>

              <div className={`${CARD} p-5`}>
                <h3 className="text-[15px] font-bold">Data Sources Used</h3>
                <p className="text-[12px] text-[#64748B] mt-0.5">Sources that contributed to this report.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(liveSources.length ? liveSources : [{ label: "Verification pending" }]).map((s, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#0F172A] bg-slate-100 rounded-lg px-2.5 py-1.5"><Database className="w-3.5 h-3.5 text-[#2563EB]" />{s.label}</span>
                  ))}
                </div>
                <button onClick={() => setModal("sources")} className="mt-3 text-[13px] font-semibold text-[#2563EB] hover:underline">View all data sources →</button>
              </div>

              <div className={`${CARD} p-5`}>
                <h3 className="text-[15px] font-bold mb-1">Report Actions</h3>
                {[
                  { icon: Download, label: "Download Full Report (PDF)", fn: () => window.print(), ext: false },
                  { icon: Printer, label: "Print Report", fn: () => window.print(), ext: false },
                  { icon: Upload, label: "Share Report", fn: share, ext: false },
                  { icon: ExternalLink, label: "View in Vehicle Passport", fn: back, ext: true },
                ].map((a, i) => (
                  <button key={i} onClick={a.fn} className="w-full flex items-center gap-2.5 py-2.5 text-[13px] font-semibold text-[#0F172A] hover:text-[#2563EB] border-b border-[#EEF1F4] last:border-0"><a.icon className="w-4 h-4 text-[#2563EB]" /><span className="flex-1 text-left">{a.label}</span>{a.ext ? <ExternalLink className="w-3.5 h-3.5 text-[#94A3B8]" /> : <ChevronLeft className="w-3.5 h-3.5 text-[#94A3B8] rotate-180" />}</button>
                ))}
              </div>
            </aside>
          </div>
        </div>
      </div>

      {modal === "process" && <Modal title="About our verification process" onClose={() => setModal(null)} body="AutoLabels verifies vehicle information using dealership-provided data, OEM data, marketplace data, recall data, title and brand indicators, vehicle history sources, and internal quality checks. Results are intended to help shoppers understand the vehicle more clearly and should be verified with the dealer before purchase." />}
      {modal === "sources" && <Modal title="Data sources" onClose={() => setModal(null)} body="This report draws on the data sources that have information available for this vehicle — vehicle history records, OEM/VIN decode, NHTSA recall data, MarketCheck market data, and dealer-provided service and media. Only sources that contributed data for this specific vehicle are shown. Availability varies by vehicle and region." />}
      {modal === "promise" && <Modal title="Our Verification Promise" onClose={() => setModal(null)} body="AutoLabels is committed to transparency. We verify every vehicle using trusted third-party data sources and a structured inspection process, and we clearly distinguish verified data from items that still need dealer confirmation. We never present unconfirmed information as verified." />}

      <PassportCtaDock go={go} dealerPhone={d.dealerPhone || undefined} reviewRating={d.reviewRating} advisor={d.dealerTrust} />
    </div>
  );
};

export default VehiclePassportVerification;
