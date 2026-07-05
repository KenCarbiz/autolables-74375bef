import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ChevronLeft, Download, Printer, Upload, ShieldCheck, CheckCircle2, Users, FileText, Wrench,
  BadgeCheck, Gauge, Car, Clock, MessageSquare, Sparkles, AlertTriangle, ChevronDown, Factory, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { type VehicleListing } from "@/hooks/useVehicleListing";
import Logo from "@/components/brand/Logo";
import { derivePassport, historyReportName, ratingTier } from "@/lib/passportV2Data";
import { packetVisible } from "@/lib/packetModules";
import { trackCustomerCtaClicked } from "@/lib/engagement/customerEngagement";
import { MOCK_LISTING } from "./VehiclePassportV3";
import { usePublicListing } from "@/hooks/usePublicListing";
import PassportCtaDock from "@/components/passport/PassportCtaDock";
import { GREEN, CARD } from "@/lib/passportTokens";

// ──────────────────────────────────────────────────────────────
// VehiclePassportHistory — /v/:slug/vehicle-history
//
// Condition-aware history summary. New cars get a born-new provenance
// story (no history score — a car with no history can't have an
// "excellent" one). Used/CPO cars get the data-confidence score WITH
// its deduction receipt, and only sections backed by real records.
// Missing data is omitted, never rendered as "Pending" filler.
// ──────────────────────────────────────────────────────────────

const TEXT2 = "text-[#64748B]";

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
type MStatus = "verified" | "attention" | "info";
const MAcc = ({ open, onToggle, icon: Icon, title, desc, status, children }: { open: boolean; onToggle: () => void; icon: React.ElementType; title: string; desc: string; status: MStatus; children: React.ReactNode }) => {
  const sc = status === "verified" ? { c: "text-[#16A34A]", bg: "bg-emerald-50", l: "Verified" }
    : status === "info" ? { c: "text-[#64748B]", bg: "bg-slate-100", l: "Available" }
    : { c: "text-[#D97706]", bg: "bg-amber-50", l: "Needs Review" };
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
  const [mOpen, setMOpen] = useState<string | null>(null);  // mobile: one accordion open
  const [ringFill, setRingFill] = useState(false);              // mobile: ring fills on load
  const [recallOpen, setRecallOpen] = useState(false);

  useEffect(() => { const r = requestAnimationFrame(() => setRingFill(true)); return () => cancelAnimationFrame(r); }, []);

  const isPreview = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("preview");
  const { listing, loading, notFound } = usePublicListing(vehicleSlug, { preview: isPreview, previewData: MOCK_LISTING as unknown as VehicleListing });

  const d = useMemo(() => (listing ? derivePassport(listing) : null), [listing]);

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-[#F6F7F9]"><div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" /></div>;
  if (notFound || !listing || !d) return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[#F6F7F9]"><div className="text-center"><FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" /><h1 className="text-xl font-bold">History report unavailable</h1><p className="text-sm text-slate-500 mt-2">This listing may have been sold or unpublished.</p></div></div>
  );

  const slug = listing.slug || vehicleSlug;
  const go = (section: string) => navigate(`/v/${slug}/${section}${isPreview ? "?preview=1" : ""}`);
  const back = () => navigate(`/v/${slug}${isPreview ? "?preview=1" : ""}`);

  const isNewCar = listing.condition === "new";
  const isCpo = listing.condition === "cpo";
  // A new car has no history to grade — the History & Title factor would read
  // as a fabricated "history score", so it is suppressed for new vehicles.
  // This page's score IS the History & Title factor of the unified rating
  // (confScore is its exported alias), with its deduction receipt as evidence.
  const score = isNewCar ? null : d.confScore;
  const tier = score == null ? null : ratingTier(score).label;
  const strongTier = score != null && score >= 70;
  const deductions = isNewCar ? [] : d.confDeductions;
  const year = Number((listing.ymm || "").match(/\b(19|20)\d{2}\b/)?.[0]) || null;
  const age = year ? Math.max(1, new Date().getFullYear() - year) : null;
  const avgYearly = !isNewCar && listing.mileage != null && age ? Math.round(listing.mileage / age) : null;
  // Real dates only: "Verified" needs a sign-off event; "Updated" uses the
  // latest real data timestamp. No fallback to today's date.
  const signedAt = listing.prep_status?.foreman_signed_at || null;
  const verifyLbl = signedAt ? `Verified ${new Date(signedAt).toLocaleDateString()}` : null;
  const updatedRaw = d.marketCheckedAt || (listing as unknown as { updated_at?: string }).updated_at || null;
  const updatedLbl = updatedRaw ? `Updated ${new Date(updatedRaw).toLocaleDateString()}` : null;
  const dealerName = d.dealerName || "the dealer";

  type CpoView = { name?: string; inspection_points?: string };
  const cpoProgram = isCpo ? (listing as unknown as { cpo_programs?: CpoView[] }).cpo_programs?.[0] ?? null : null;

  const services = (listing.service_records || []).filter((s) => s && (s.date || s.type || s.mileage));

  const recallCampaigns = ((listing.open_recall_count ?? 0) > 0 ? listing.recall_check?.campaigns ?? [] : [])
    .filter((c) => c.component || c.summary || c.remedy);

  // Odometer trail renders only when every dated sighting is non-decreasing —
  // a decrease renders nothing at all (absence is neutral, never an accusation).
  const mileageTrail = (() => {
    const pts = (d.history?.entries ?? [])
      .filter((e) => (e.miles ?? 0) > 0)
      .map((e) => ({ miles: e.miles as number, date: e.first_seen || e.last_seen || "", at: new Date(e.first_seen || e.last_seen || "").getTime() }))
      .filter((p) => !Number.isNaN(p.at))
      .sort((a, b) => a.at - b.at);
    if (pts.length < 2) return null;
    for (let i = 1; i < pts.length; i++) if (pts[i].miles < pts[i - 1].miles) return null;
    const distinct = pts.filter((p, i) => i === 0 || p.miles !== pts[i - 1].miles);
    return distinct.length >= 2 ? distinct.slice(-4) : null;
  })();
  const monthYear = (s: string) => new Date(s).toLocaleDateString("en-US", { month: "short", year: "numeric" });

  // Glance tiles: known values only — an unknown renders nothing, not "Pending".
  const glance = [
    !isNewCar && d.ownerCount != null && d.ownerCount > 0 ? { icon: Users, label: "Owners", value: `${d.ownerCount} Owner${d.ownerCount === 1 ? "" : "s"}`, ok: d.ownerCount === 1 } : null,
    !isNewCar && d.accidentCount != null ? { icon: ShieldCheck, label: "Accidents", value: d.accidentCount === 0 ? "None Reported" : `${d.accidentCount} Reported`, ok: d.accidentCount === 0 } : null,
    !isNewCar && d.cleanTitle ? { icon: FileText, label: "Title", value: "Clean Title", ok: true } : null,
    d.serviceCount > 0 ? { icon: Wrench, label: "Service Records", value: `${d.serviceCount} On File`, ok: true } : null,
    d.hasRecallCheck ? { icon: BadgeCheck, label: "Open Recalls", value: d.recallClear ? "None" : `${d.openRecalls ?? "See dealer"}`, ok: d.recallClear } : null,
    listing.mileage != null ? { icon: Gauge, label: isNewCar ? "Delivery Miles" : "Odometer", value: `${listing.mileage.toLocaleString()} mi`, ok: true } : null,
  ].filter(Boolean) as { icon: React.ElementType; label: string; value: string; ok: boolean }[];

  const missing: string[] = [];
  if (!isNewCar) {
    if (d.ownerCount == null) missing.push("ownership records");
    if (d.accidentCount == null) missing.push("accident reports");
    if (services.length === 0) missing.push("service records");
    if (!d.hasRecallCheck) missing.push("recall check");
  }

  const meansItems: string[] = [];
  if (isNewCar) {
    meansItems.push("No prior owners and no accident exposure — you are the first chapter of this vehicle's history.");
    if (d.warrantyStr) meansItems.push("Full factory warranty coverage begins the day you take delivery.");
    if (d.recallClear && d.hasRecallCheck) meansItems.push("No open recalls means the vehicle is ready to drive with nothing outstanding.");
  } else {
    if (d.ownerCount === 1) meansItems.push("One-owner vehicles typically retain their value better and carry fewer surprises.");
    if (d.serviceCount > 0) meansItems.push("A documented service history reduces the chance of unexpected repair costs.");
    if (d.cleanTitle) meansItems.push("A clean title with no brands protects resale value and financing options.");
    if (d.recallClear && d.hasRecallCheck) meansItems.push("No open recalls means the vehicle is ready to drive with nothing outstanding.");
    if (isCpo) meansItems.push("Factory certification adds inspection standards and extended coverage a regular used car doesn't carry.");
  }

  const Section = ({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) => (
    <section className={`${CARD} p-5 sm:p-6`}>
      <H2>{title}</H2>
      {sub && <p className={`text-[13px] ${TEXT2} mt-1`}>{sub}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );

  const TitleVerdict = () => d.titleStatus === "clean" ? (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 flex items-center gap-3">
      <CheckCircle2 className="w-7 h-7 text-[#16A34A] shrink-0" />
      <div><p className="text-[16px] font-extrabold text-[#16A34A]">Clean title — no brands on record</p><p className="text-[12px] text-[#64748B]">No salvage, flood, lemon, or rebuilt brands reported by vehicle history providers.</p></div>
    </div>
  ) : d.titleStatus === "branded" ? (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 flex items-center gap-3">
      <AlertTriangle className="w-7 h-7 text-[#D97706] shrink-0" />
      <div><p className="text-[16px] font-extrabold text-[#B45309]">Title brand on record</p><p className="text-[12px] text-[#64748B]">Review the title record with {dealerName}.</p></div>
    </div>
  ) : (
    <div className="rounded-2xl border border-[#E6E8EC] bg-white p-5 flex items-center gap-3">
      <FileText className="w-7 h-7 text-[#64748B] shrink-0" />
      <div><p className="text-[16px] font-extrabold text-[#0F172A]">Title record available from the dealership</p><p className="text-[12px] text-[#64748B]">Ask {dealerName} and we'll walk you through it.</p></div>
    </div>
  );

  const DeductionReceipt = ({ compact = false }: { compact?: boolean }) =>
    score == null ? null : deductions.length > 0 ? (
      <div className={`${compact ? "" : CARD} ${compact ? "" : "p-4"} space-y-1.5`}>
        <p className="text-[12px] font-bold text-[#64748B]">What lowered the score</p>
        {deductions.map((dd) => (
          <div key={dd.label} className="flex items-center justify-between gap-3 text-[13px]"><span className="text-[#0F172A]">{dd.label}</span><span className="font-bold text-[#B45309] shrink-0">−{dd.points} pts</span></div>
        ))}
      </div>
    ) : (
      <p className="text-[13px] text-[#16A34A] font-semibold">No deductions — every known signal on this vehicle is clean.</p>
    );

  const CertBand = () => !isCpo ? null : (
    <div className="rounded-2xl border border-violet-200 bg-violet-50/70 p-5">
      <div className="flex items-center gap-2"><BadgeCheck className="w-5 h-5 text-violet-700" /><p className="text-[15px] font-extrabold text-violet-900">Certified Pre-Owned{cpoProgram?.name ? ` — ${cpoProgram.name}` : ""}</p></div>
      {cpoProgram?.inspection_points && <p className="text-[13px] text-violet-800 mt-1.5">Passed the {cpoProgram.inspection_points}-point factory certification inspection.</p>}
      {d.recon?.inspection?.date && <p className="text-[13px] text-violet-800 mt-1">Dealer inspection completed {new Date(d.recon.inspection.date).toLocaleDateString()}.</p>}
      {!cpoProgram?.inspection_points && signedAt && <p className="text-[13px] text-violet-800 mt-1">Dealer inspection sign-off completed {new Date(signedAt).toLocaleDateString()}.</p>}
    </div>
  );

  // Born-new provenance chain — only events with a real backing field.
  const provenance = [
    year ? { t: `Built — ${year} model year`, s: "OEM model year · Estimated", n: "Exact build date comes from the OEM build sheet." } : null,
    d.history?.inServiceDate ? { t: `In service — ${new Date(d.history.inServiceDate).toLocaleDateString()}`, s: "Warranty record", n: "Factory warranty clock starts on this date." } : null,
    { t: `Offered new at ${dealerName}`, s: "Current listing", n: d.warrantyStr ? `Full factory coverage — ${d.warrantyStr}.` : "Original title will be issued at first registration." },
  ].filter(Boolean) as { t: string; s: string; n: string }[];

  const Provenance = () => (
    <ol className="space-y-4 relative border-l-2 border-slate-100 ml-1.5 pl-4">
      {provenance.map((e) => (
        <li key={e.t} className="relative">
          <span className="absolute -left-[22px] top-1 w-3 h-3 rounded-full bg-[#2563EB] ring-2 ring-white" />
          <p className="text-[13px] font-bold leading-tight">{e.t}</p>
          <p className="text-[11px] text-[#94A3B8] mt-0.5">{e.s}</p>
          <p className="text-[12px] text-[#64748B] mt-0.5">{e.n}</p>
        </li>
      ))}
    </ol>
  );

  // Dealer-paid CARFAX/AutoCheck link (already gated used/CPO + toggle by
  // public-listing-view); per-vehicle packet curation is the last gate.
  const hr = d.historyReport && packetVisible(listing, "historyReport") ? d.historyReport : null;
  const hrName = hr ? historyReportName(hr.provider) : "";
  const trackHr = (placement: string) => {
    if (!isPreview) trackCustomerCtaClicked({ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin, source: "passport", surface: "vehicle_passport", metadata: { cta: "history_report", provider: hr?.provider ?? null, placement } });
  };

  const RecallDetails = () => recallCampaigns.length === 0 ? null : (
    <div className="mt-3 rounded-xl border border-amber-200 bg-white overflow-hidden">
      <button onClick={() => setRecallOpen((v) => !v)} className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left">
        <span className="text-[13px] font-bold text-[#B45309]">Recall details</span>
        <ChevronDown className={`w-4 h-4 text-[#D97706] shrink-0 transition-transform ${recallOpen ? "rotate-180" : ""}`} />
      </button>
      {recallOpen && (
        <div className="px-4 pb-4 space-y-3">
          {recallCampaigns.map((c, i) => (
            <div key={c.campaignNumber || i} className="border-t border-[#EEF1F4] pt-3 first:border-t-0 first:pt-0">
              <p className="text-[13px] font-bold">{c.component || `NHTSA campaign${c.campaignNumber ? ` ${c.campaignNumber}` : ""}`}</p>
              {c.summary && <p className="text-[12px] text-[#64748B] mt-0.5">{c.summary}</p>}
              {c.remedy && <p className="text-[12px] font-semibold text-[#0F172A] mt-1">Remedy: free repair at any authorized dealer</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const MileageTrail = () => mileageTrail == null ? null : (
    <div className={`${CARD} p-4`}>
      <p className="text-[12px] font-bold text-[#64748B]">Mileage record</p>
      <p className="text-[14px] font-extrabold mt-1.5">
        {mileageTrail.map((p) => p.miles.toLocaleString()).join(" → ")} miles
        <span className="text-[#16A34A]"> — consistent odometer record</span>
      </p>
      <p className="text-[11px] text-[#94A3B8] mt-0.5">{mileageTrail.map((p) => monthYear(p.date)).join(" → ")}</p>
    </div>
  );

  const NotOnFile = () => missing.length === 0 ? null : (
    <div className={`${CARD} p-4`}>
      <p className="text-[13px] text-[#64748B]">
        Want the full report?{" "}
        {hr ? (
          <>View the <a href={hr.url} target="_blank" rel="noopener noreferrer" onClick={() => trackHr("history_page_not_on_file")} className="font-semibold text-[#2563EB] hover:underline">free {hrName} Report</a>.</>
        ) : (
          <>Ask us and we'll send it.</>
        )}
      </p>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#0F172A]" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <Helmet><title>{`Vehicle History Summary — ${listing.ymm}`}</title>{isPreview && <meta name="robots" content="noindex" />}</Helmet>
      {isPreview && <div className="bg-amber-500 text-white text-center text-[12px] font-bold py-1.5 px-4">SAMPLE PREVIEW — design layout with placeholder data. Not a real listing.</div>}

      {/* ── Mobile (<768px) ── */}
      <div className="md:hidden pb-[calc(96px+env(safe-area-inset-bottom))]">
        {/* Hero */}
        <div className="bg-white px-5 pt-[calc(12px+env(safe-area-inset-top))] pb-7">
          <button onClick={back} className="text-[14px] font-semibold text-[#2563EB] inline-flex items-center gap-1.5 -ml-1"><ChevronLeft className="w-[18px] h-[18px]" /> Back to Vehicle Passport</button>
          {isNewCar ? (
            <div className="text-center mt-6">
              <p className="text-[13px] font-semibold text-[#64748B]">Vehicle Provenance</p>
              {updatedLbl && <p className="text-[12px] text-[#94A3B8] mt-0.5">{updatedLbl}</p>}
              <div className="w-[104px] h-[104px] rounded-full bg-blue-50 flex items-center justify-center mx-auto mt-5"><Factory className="w-11 h-11 text-[#2563EB]" /></div>
              <p className="text-[18px] font-extrabold text-[#2563EB] mt-4">Factory-New Vehicle</p>
              <p className="text-[14px] text-[#475569] mt-1.5 max-w-[300px] mx-auto">Zero previous owners. This vehicle's history starts with you.</p>
            </div>
          ) : (
            <div className="text-center mt-6">
              <p className="text-[13px] font-semibold text-[#64748B]">Vehicle History Summary</p>
              {updatedLbl && <p className="text-[12px] text-[#94A3B8] mt-0.5">{updatedLbl}</p>}
              {score != null && (
                <>
                  <div className="relative w-[160px] h-[160px] mx-auto mt-5">
                    <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
                      <circle cx="80" cy="80" r="70" fill="none" stroke="#E6E8EC" strokeWidth="12" />
                      <circle cx="80" cy="80" r="70" fill="none" stroke="#16A34A" strokeWidth="12" strokeLinecap="round" strokeDasharray={2 * Math.PI * 70} strokeDashoffset={ringFill ? (2 * Math.PI * 70) * (1 - score / 100) : 2 * Math.PI * 70} style={{ transition: "stroke-dashoffset 1s ease-out" }} />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-[48px] font-extrabold leading-none text-[#0F172A]">{score}</span><span className="text-[13px] font-bold text-[#94A3B8] mt-1">History & Title</span></div>
                  </div>
                  {strongTier && <p className="text-[16px] font-extrabold text-[#16A34A] mt-3">{tier}</p>}
                  <div className="mt-3 text-left max-w-[320px] mx-auto"><DeductionReceipt compact /></div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Vehicle */}
        <div className="px-5 mt-5">
          <div className="flex items-center gap-3">
            {listing.hero_image_url ? <img src={listing.hero_image_url} alt={listing.ymm || ""} className="w-24 h-[72px] object-cover rounded-xl shrink-0" /> : <div className="w-24 h-[72px] rounded-xl bg-slate-200 flex items-center justify-center shrink-0"><Car className="w-7 h-7 text-slate-400" /></div>}
            <div className="min-w-0">
              <h1 className="text-[18px] font-extrabold leading-tight">{listing.ymm}</h1>
              {listing.trim && <p className="text-[13px] font-semibold text-[#64748B]">{listing.trim}</p>}
              <p className="text-[11px] text-[#94A3B8] mt-0.5">VIN {listing.vin}{listing.mileage != null ? ` · ${listing.mileage.toLocaleString()} mi` : ""}</p>
            </div>
          </div>
        </div>

        {isCpo && <div className="px-5 mt-5"><CertBand /></div>}

        {/* At a glance — known values only */}
        {glance.length >= 2 && (
          <div className="px-5 mt-6 grid grid-cols-2 gap-3">
            {glance.map((t) => (
              <div key={t.label} className={`${CARD} p-4`}>
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${t.ok ? "bg-emerald-50" : "bg-amber-50"}`}><t.icon className={`w-[18px] h-[18px] ${t.ok ? "text-[#16A34A]" : "text-[#D97706]"}`} /></span>
                <p className="text-[16px] font-extrabold mt-2 leading-tight">{t.value}</p>
                <p className="text-[11px] text-[#94A3B8] mt-0.5">{t.label}</p>
              </div>
            ))}
          </div>
        )}

        {isNewCar ? (
          <div className="px-5 mt-7 space-y-5">
            <div className={`${CARD} p-5`}>
              <h2 className="text-[18px] font-bold mb-4">From the factory to you</h2>
              <Provenance />
            </div>
            {d.hasRecallCheck && (d.recallClear ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4"><p className="text-[15px] font-extrabold text-[#16A34A] inline-flex items-center gap-1.5"><CheckCircle2 className="w-5 h-5" /> No Open Recalls</p><p className="text-[12px] text-[#64748B] mt-1">No active manufacturer recalls were found with NHTSA.</p></div>
            ) : (
              <div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4"><p className="text-[15px] font-extrabold text-[#B45309] inline-flex items-center gap-1.5"><AlertTriangle className="w-5 h-5" /> Open recall on record</p><p className="text-[12px] text-[#64748B] mt-1">Ask the dealer to confirm completion before delivery.</p></div>
                <RecallDetails />
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 mt-7 space-y-2.5">
            <h2 className="text-[18px] font-bold mb-1">History Details</h2>
            <MAcc open={mOpen === "title"} onToggle={() => setMOpen(mOpen === "title" ? null : "title")} icon={FileText} title="Title" desc={d.titleStatus === "clean" ? "Clean title on record" : d.titleStatus === "branded" ? "Title brand on record" : "Record available from the dealership"} status={d.titleStatus === "clean" ? "verified" : d.titleStatus === "branded" ? "attention" : "info"}>
              <TitleVerdict />
            </MAcc>
            {d.accidentCount != null && (
              <MAcc open={mOpen === "accident"} onToggle={() => setMOpen(mOpen === "accident" ? null : "accident")} icon={Car} title="Accidents & Damage" desc={d.accidentCount === 0 ? "None reported" : `${d.accidentCount} reported`} status={d.accidentCount === 0 ? "verified" : "attention"}>
                {d.accidentCount === 0 ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4"><p className="text-[15px] font-extrabold text-[#16A34A] inline-flex items-center gap-1.5"><CheckCircle2 className="w-5 h-5" /> No Accidents Reported</p><p className="text-[12px] text-[#64748B] mt-1">No accident or damage records were found in the available history sources.</p></div>
                ) : <p className="text-[13px] text-[#92400E]">{d.accidentCount} incident{d.accidentCount === 1 ? "" : "s"} reported — review the full report with the dealer.</p>}
              </MAcc>
            )}
            {d.ownerCount != null && d.ownerCount > 0 && (
              <MAcc open={mOpen === "ownership"} onToggle={() => setMOpen(mOpen === "ownership" ? null : "ownership")} icon={Users} title="Ownership" desc={`${d.ownerCount} owner${d.ownerCount === 1 ? "" : "s"} on record`} status="verified">
                <p className="text-[13px] text-[#0F172A] font-semibold">{d.ownerCount === 1 ? "One owner on record" : `${d.ownerCount} owners on record`}</p>
                <p className="text-[12px] text-[#64748B] mt-1">Source: vehicle history providers. Owner-by-owner dates appear when reported.</p>
              </MAcc>
            )}
            {services.length > 0 && (
              <MAcc open={mOpen === "service"} onToggle={() => setMOpen(mOpen === "service" ? null : "service")} icon={Wrench} title="Service History" desc={`${services.length} maintenance record${services.length === 1 ? "" : "s"}`} status="verified">
                <div className="space-y-2">{services.map((s, i) => <div key={i} className="rounded-xl border border-[#E6E8EC] p-3"><p className="text-[13px] font-bold">{[s.date ? new Date(s.date).toLocaleDateString() : null, s.mileage ? `${s.mileage} mi` : null].filter(Boolean).join(" · ") || `Service ${i + 1}`}</p><p className="text-[12px] text-[#64748B]">{[s.type, s.notes].filter(Boolean).join(" — ") || "Maintenance performed"}</p></div>)}</div>
              </MAcc>
            )}
            {listing.mileage != null && (
              <MAcc open={mOpen === "odometer"} onToggle={() => setMOpen(mOpen === "odometer" ? null : "odometer")} icon={Gauge} title="Odometer" desc={`${listing.mileage.toLocaleString()} mi`} status="verified">
                <div className="flex items-center justify-between gap-3 text-center">
                  {[{ v: listing.mileage.toLocaleString(), l: "Current mi" }, { v: avgYearly != null ? avgYearly.toLocaleString() : "—", l: "Avg / yr" }, { v: age != null ? `${age} yr` : "—", l: "Vehicle age" }].map((x) => (
                    <div key={x.l} className="flex-1"><p className="text-[18px] font-extrabold leading-none">{x.v}</p><p className="text-[11px] text-[#94A3B8] mt-1">{x.l}</p></div>
                  ))}
                </div>
              </MAcc>
            )}
            <MileageTrail />
            {d.hasRecallCheck && (
              <MAcc open={mOpen === "recall"} onToggle={() => setMOpen(mOpen === "recall" ? null : "recall")} icon={BadgeCheck} title="Recall Status" desc="Open recalls (NHTSA)" status={d.recallClear ? "verified" : "attention"}>
                {d.recallClear ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4"><p className="text-[15px] font-extrabold text-[#16A34A] inline-flex items-center gap-1.5"><CheckCircle2 className="w-5 h-5" /> No Open Recalls</p><p className="text-[12px] text-[#64748B] mt-1">No active manufacturer recalls were found.</p></div>
                ) : (
                  <>
                    <p className="text-[13px] text-[#92400E]">{d.openRecalls ?? "Open"} recall(s) — confirm completion with the dealer.</p>
                    <RecallDetails />
                  </>
                )}
              </MAcc>
            )}
            <NotOnFile />
          </div>
        )}

        {/* What this means */}
        {meansItems.length > 0 && (
          <div className="px-5 mt-7">
            <h2 className="text-[18px] font-bold mb-3">What This Means To You</h2>
            <div className={`${CARD} p-5`}><ul className="space-y-3">{meansItems.map((m) => <li key={m} className="flex items-start gap-2.5 text-[14px] text-[#0F172A]"><CheckCircle2 className="w-[18px] h-[18px] text-[#16A34A] shrink-0 mt-0.5" />{m}</li>)}</ul></div>
          </div>
        )}

        {/* Actions — only things that exist */}
        <div className="px-5 mt-7">
          <div className="grid grid-cols-2 gap-3">
            {hr && (
              <a href={hr.url} target="_blank" rel="noopener noreferrer" onClick={() => trackHr("history_page_actions")} className={`${CARD} p-4 flex flex-col items-start gap-2 active:bg-slate-50 transition-colors col-span-2`}>
                <span className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center"><ExternalLink className="w-[18px] h-[18px] text-[#2563EB]" /></span>
                <span className="text-[13px] font-semibold leading-tight text-left">{hr.source === "vin" ? `View the ${hrName} record` : `View the free ${hrName} Report`}</span>
                <span className="text-[11px] text-[#94A3B8] leading-tight text-left">{hr.source === "vin" ? `Official ${hrName} record for this VIN` : `Opens on ${hr.provider === "autocheck" ? "autocheck.com" : "carfax.com"} · provided at no cost by ${dealerName}`}</span>
              </a>
            )}
            <button onClick={() => window.print()} className={`${CARD} p-4 flex flex-col items-start gap-2 active:bg-slate-50 transition-colors`}>
              <span className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center"><Printer className="w-[18px] h-[18px] text-[#2563EB]" /></span>
              <span className="text-[13px] font-semibold leading-tight text-left">Print This Page</span>
            </button>
            <button onClick={() => go("documents")} className={`${CARD} p-4 flex flex-col items-start gap-2 active:bg-slate-50 transition-colors`}>
              <span className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center"><FileText className="w-[18px] h-[18px] text-[#2563EB]" /></span>
              <span className="text-[13px] font-semibold leading-tight text-left">{isNewCar ? "View Window Sticker" : "View Documents"}</span>
            </button>
            <button onClick={() => go("ownership-timeline")} className={`${CARD} p-4 flex flex-col items-start gap-2 active:bg-slate-50 transition-colors col-span-2`}>
              <span className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center"><Clock className="w-[18px] h-[18px] text-[#2563EB]" /></span>
              <span className="text-[13px] font-semibold leading-tight text-left">Ownership Timeline</span>
            </button>
          </div>
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
          <h1 className="text-[28px] sm:text-[34px] font-bold tracking-tight leading-tight">{isNewCar ? "Vehicle Provenance" : "Vehicle History Summary"}</h1>
          <p className={`text-[14px] ${TEXT2} mt-1`}>{isNewCar ? "The born-new record of this vehicle, from the factory to the showroom." : "The records on file — everything we've verified for this vehicle."}</p>
        </div>

        {/* Hero */}
        <section className={`${CARD} p-6`}>
          {isNewCar ? (
            <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr_auto] items-center gap-6">
              <div className="w-[120px] h-[120px] rounded-full bg-blue-50 flex items-center justify-center mx-auto"><Factory className="w-12 h-12 text-[#2563EB]" /></div>
              <div className="text-center lg:text-left">
                <p className="text-[20px] font-extrabold text-[#2563EB] leading-tight">Factory-New Vehicle</p>
                <p className="text-[17px] font-bold mt-1">Zero previous owners. This vehicle's history starts with you.</p>
                <p className={`text-[13px] ${TEXT2} mt-2 max-w-[460px] mx-auto lg:mx-0`}>{[d.warrantyStr ? `full factory coverage (${d.warrantyStr})` : null, d.recallClear && d.hasRecallCheck ? "no open recalls" : null, listing.mileage != null ? `${listing.mileage.toLocaleString()} delivery miles` : null].filter(Boolean).join(", ") || "born-new provenance from the factory to this showroom"}.</p>
              </div>
              <div className="rounded-2xl border border-[#E6E8EC] overflow-hidden w-full lg:w-[200px]">
                {listing.hero_image_url ? <img src={listing.hero_image_url} alt="" className="w-full aspect-[4/3] object-cover" /> : <div className="w-full aspect-[4/3] bg-[#1f2227] flex items-center justify-center"><Car className="w-9 h-9 text-slate-500" /></div>}
                <div className="p-3"><p className="text-[13px] font-bold leading-tight">{listing.ymm}</p><p className="text-[11px] text-[#94A3B8] mt-0.5">VIN {listing.vin}</p>{listing.mileage != null && <p className="text-[11px] text-[#94A3B8]">{listing.mileage.toLocaleString()} mi</p>}</div>
              </div>
            </div>
          ) : (
            <div className={`grid grid-cols-1 ${score != null ? "lg:grid-cols-[auto_1fr_auto]" : "lg:grid-cols-[1fr_auto]"} items-center gap-6`}>
              {score != null && (
                <div className="flex justify-center"><ScoreRing score={score} /></div>
              )}
              <div className="text-center lg:text-left">
                {score != null ? (
                  <>
                    <p className="text-[20px] font-extrabold text-[#16A34A] leading-tight">{strongTier ? `${tier} · History & Title` : "History & Title"}</p>
                    <p className={`text-[13px] ${TEXT2} mt-1`}>Scored only from verified signals — deductions are itemized below, never hidden.</p>
                    <div className="mt-3 max-w-[420px] mx-auto lg:mx-0 text-left"><DeductionReceipt compact /></div>
                  </>
                ) : (
                  <>
                    <p className="text-[20px] font-extrabold leading-tight">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</p>
                    <p className={`text-[13px] ${TEXT2} mt-1`}>The records on file for this vehicle are summarized below.</p>
                  </>
                )}
              </div>
              <div className="rounded-2xl border border-[#E6E8EC] overflow-hidden w-full lg:w-[200px]">
                {listing.hero_image_url ? <img src={listing.hero_image_url} alt="" className="w-full aspect-[4/3] object-cover" /> : <div className="w-full aspect-[4/3] bg-[#1f2227] flex items-center justify-center"><Car className="w-9 h-9 text-slate-500" /></div>}
                <div className="p-3"><p className="text-[13px] font-bold leading-tight">{listing.ymm}</p><p className="text-[11px] text-[#94A3B8] mt-0.5">VIN {listing.vin}</p>{listing.mileage != null && <p className="text-[11px] text-[#94A3B8]">{listing.mileage.toLocaleString()} mi</p>}</div>
              </div>
            </div>
          )}
        </section>

        {isCpo && <CertBand />}

        {isNewCar ? (
          <>
            <Section title="From the factory to you" sub="Every event here is backed by a record — nothing is inferred.">
              <Provenance />
            </Section>
            {d.hasRecallCheck && (
              <Section title="Recall Status">
                {d.recallClear ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 flex items-center gap-3"><BadgeCheck className="w-7 h-7 text-[#16A34A] shrink-0" /><div><p className="text-[16px] font-extrabold text-[#16A34A]">No Open Recalls</p><p className="text-[12px] text-[#64748B]">No open safety recalls were found for this vehicle with NHTSA.</p></div></div>
                ) : (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 flex items-center gap-3"><AlertTriangle className="w-7 h-7 text-[#D97706] shrink-0" /><div><p className="text-[16px] font-extrabold text-[#B45309]">Open recall on record</p><p className="text-[12px] text-[#64748B]">Ask the dealer to confirm completion before delivery.</p></div></div>
                )}
                {!d.recallClear && <RecallDetails />}
              </Section>
            )}
          </>
        ) : (
          <>
            {/* At a glance — known values only */}
            {glance.length >= 2 && (
              <Section title="History At A Glance">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {glance.map((g) => (
                    <div key={g.label} className={`${CARD} p-3.5 text-center`}>
                      <span className={`w-9 h-9 rounded-xl flex items-center justify-center mx-auto ${g.ok ? "bg-emerald-50" : "bg-amber-50"}`}><g.icon className={`w-[18px] h-[18px] ${g.ok ? "text-[#16A34A]" : "text-[#D97706]"}`} /></span>
                      <p className="text-[13px] font-extrabold mt-1.5 leading-tight">{g.value}</p>
                      <p className="text-[10px] text-[#94A3B8] mt-0.5">{g.label}</p>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            <Section title="Title">
              <TitleVerdict />
            </Section>

            {d.accidentCount != null && (
              <Section title="Accident & Damage History">
                {d.accidentCount === 0 ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 flex items-center gap-3">
                    <CheckCircle2 className="w-7 h-7 text-[#16A34A] shrink-0" />
                    <div><p className="text-[16px] font-extrabold text-[#16A34A]">No accidents reported</p><p className="text-[12px] text-[#64748B]">No accident or damage records were found in the available history sources.</p></div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 flex items-center gap-3">
                    <AlertTriangle className="w-7 h-7 text-[#D97706] shrink-0" />
                    <div><p className="text-[16px] font-extrabold text-[#B45309]">{d.accidentCount} incident{d.accidentCount === 1 ? "" : "s"} reported</p><p className="text-[12px] text-[#64748B]">Incident details (date, severity, repair status) are available in the full report — review with the dealer.</p></div>
                  </div>
                )}
              </Section>
            )}

            {d.ownerCount != null && d.ownerCount > 0 && (
              <Section title="Ownership">
                <div className={`${CARD} p-4`}>
                  <p className="text-[15px] font-extrabold text-[#0F172A]">{d.ownerCount === 1 ? "One owner on record" : `${d.ownerCount} owners on record`}</p>
                  <p className="text-[12px] text-[#64748B] mt-1">Source: vehicle history providers. Owner-by-owner dates and locations appear when reported.</p>
                </div>
              </Section>
            )}

            {services.length > 0 && (
              <Section title="Service History" sub={`${services.length} maintenance visit${services.length === 1 ? "" : "s"} on file.`}>
                <ol className="space-y-4 relative border-l-2 border-slate-100 ml-1.5 pl-4">
                  {services.map((s, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[22px] top-1 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white" />
                      <p className="text-[13px] font-bold">{[s.date ? new Date(s.date).toLocaleDateString() : null, s.mileage ? `${s.mileage} mi` : null].filter(Boolean).join(" · ") || `Service ${i + 1}`}</p>
                      <p className="text-[12px] text-[#64748B]">{[s.type, s.notes].filter(Boolean).join(" — ") || "Maintenance performed"}</p>
                    </li>
                  ))}
                </ol>
              </Section>
            )}

            {listing.mileage != null && (
              <Section title="Odometer">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className={`${CARD} p-3.5 text-center`}><p className="text-[11px] text-[#94A3B8]">Current Mileage</p><p className="text-[16px] font-extrabold mt-0.5">{listing.mileage.toLocaleString()}</p></div>
                  <div className={`${CARD} p-3.5 text-center`}><p className="text-[11px] text-[#94A3B8]">Avg per Year</p><p className="text-[16px] font-extrabold mt-0.5">{avgYearly != null ? avgYearly.toLocaleString() : "—"}</p></div>
                  <div className={`${CARD} p-3.5 text-center`}><p className="text-[11px] text-[#94A3B8]">Vehicle Age</p><p className="text-[16px] font-extrabold mt-0.5">{age != null ? `${age} yr` : "—"}</p></div>
                </div>
              </Section>
            )}

            <MileageTrail />

            {d.hasRecallCheck && (
              <Section title="Recall Status">
                {d.recallClear ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 flex items-center gap-3"><BadgeCheck className="w-7 h-7 text-[#16A34A] shrink-0" /><div><p className="text-[16px] font-extrabold text-[#16A34A]">No Open Recalls</p><p className="text-[12px] text-[#64748B]">No open safety recalls were found for this vehicle with NHTSA.</p></div></div>
                ) : d.openRecalls != null ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 flex items-center gap-3"><AlertTriangle className="w-7 h-7 text-[#D97706] shrink-0" /><div><p className="text-[16px] font-extrabold text-[#B45309]">{d.openRecalls} open recall{d.openRecalls === 1 ? "" : "s"}</p><p className="text-[12px] text-[#64748B]">Ask the dealer to confirm these are completed before delivery.</p></div></div>
                ) : (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 flex items-center gap-3"><AlertTriangle className="w-7 h-7 text-[#D97706] shrink-0" /><div><p className="text-[16px] font-extrabold text-[#B45309]">Open recall on record</p><p className="text-[12px] text-[#64748B]">Ask the dealer to confirm completion before delivery.</p></div></div>
                )}
                {!d.recallClear && <RecallDetails />}
              </Section>
            )}

            <NotOnFile />
          </>
        )}

        {/* What this means */}
        {meansItems.length > 0 && (
          <Section title="What This Means To You">
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5">{meansItems.map((m) => <li key={m} className="flex items-start gap-2 text-[13px] text-[#0F172A]"><CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />{m}</li>)}</ul>
          </Section>
        )}

        {/* CTA */}
        <section className="rounded-2xl p-6 sm:p-8 text-white text-center" style={{ background: "linear-gradient(160deg,#2563EB 0%,#1e50c8 100%)" }}>
          <h2 className="text-[24px] font-extrabold">Ready to continue?</h2>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-5">
            {hr && (
              <a href={hr.url} target="_blank" rel="noopener noreferrer" onClick={() => trackHr("history_page_cta")} className="h-12 px-5 rounded-xl bg-white/10 border border-white/40 text-white text-[14px] font-bold inline-flex items-center gap-2 hover:bg-white/20 transition-colors"><ExternalLink className="w-5 h-5" /> View the free {hrName} Report</a>
            )}
            <button onClick={() => go("ownership-timeline")} className="h-12 px-5 rounded-xl bg-white/10 border border-white/40 text-white text-[14px] font-bold inline-flex items-center gap-2 hover:bg-white/20 transition-colors"><Clock className="w-5 h-5" /> Ownership Timeline</button>
            <button onClick={() => go("verification")} className="h-12 px-5 rounded-xl bg-white/10 border border-white/40 text-white text-[14px] font-bold inline-flex items-center gap-2 hover:bg-white/20 transition-colors"><ShieldCheck className="w-5 h-5" /> Verification Report</button>
            <button onClick={() => go("reserve")} className="h-12 px-6 rounded-xl bg-white text-[#2563EB] text-[14px] font-bold inline-flex items-center gap-2 transition-transform hover:-translate-y-0.5"><BadgeCheck className="w-5 h-5" /> Reserve This Vehicle</button>
            <button onClick={() => go("contact")} className="h-12 px-5 rounded-xl bg-white/10 border border-white/40 text-white text-[14px] font-bold inline-flex items-center gap-2 hover:bg-white/20 transition-colors"><MessageSquare className="w-5 h-5" /> Contact Dealer</button>
          </div>
        </section>

        {/* Footer */}
        <footer className="pt-2 pb-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-2"><Logo variant="full" size={18} /></div>
          <p className="text-[12px] font-semibold text-[#0F172A]">{isNewCar ? "Vehicle Provenance" : "Vehicle History Summary"}</p>
          <p className="text-[11px] text-[#94A3B8] mt-1">VIN {listing.vin}{updatedLbl ? ` · ${updatedLbl}` : ""}{verifyLbl ? ` · ${verifyLbl}` : ""}</p>
          <p className="text-[11px] text-[#94A3B8] mt-0.5 inline-flex items-center gap-1 justify-center"><Sparkles className="w-3 h-3 text-[#2563EB]" /> Powered by AutoLabels</p>
        </footer>
      </main>

      <PassportCtaDock go={go} dealerPhone={d.dealerPhone || undefined} reviewRating={d.reviewRating} advisor={d.dealerTrust} routing={d.contactRouting} vehicle={{ storeId: listing.store_id, vehicleId: listing.id, vin: listing.vin }} />
    </div>
  );
};

export default VehiclePassportHistory;
