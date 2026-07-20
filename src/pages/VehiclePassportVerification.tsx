import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ChevronLeft, Download, Printer, Share2, CircleCheck, TriangleAlert, CircleAlert,
  Clock, CircleMinus, LayoutDashboard, Database, List, ExternalLink, Car, Loader2,
  X, ShieldCheck, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { type VehicleListing } from "@/hooks/useVehicleListing";
import Logo from "@/components/brand/Logo";
import { derivePassport, type PassportData } from "@/lib/passportV2Data";
import {
  deriveVerificationReport, PROVENANCE_LABEL,
  type VerificationReport, type ReportCheck, type VerificationStatus, type EvidenceProvenance,
} from "@/lib/passport/verificationSummary";
import { resolvePassportBack } from "@/lib/passportReturn";
import { listingHero } from "@/lib/photos";
import { MOCK_LISTING } from "./VehiclePassportV3";
import { usePublicListing } from "@/hooks/usePublicListing";
import VerificationReportDock from "@/components/passport/VerificationReportDock";
import { CARD } from "@/lib/passportTokens";
import { trackCustomerEngagement, type CustomerEngagementEventType } from "@/lib/engagement/customerEngagement";

// ──────────────────────────────────────────────────────────────
// VehiclePassportVerification — /v/:slug/verification
//
// The customer-facing AutoLabels Data-Verified Report. Every section reads
// from ONE canonical VerificationReport (see deriveVerificationReport) so the
// arithmetic can never diverge. Exception-first, no score ring: it leads with
// what needs review, then what checked out. Governance is absolute — a pending
// check is never shown as verified, a source conflict is "needs confirmation"
// (not "issue found"), and no reassuring line renders without supporting data.
// ──────────────────────────────────────────────────────────────

// Preview-only review-state fixture (noindex). Lets the amber "review" layout
// be rendered locally at /v/:slug/verification?preview=1&scenario=review without
// polluting the shared MOCK_LISTING (which is the all-verified happy path).
const MOCK_REVIEW_LISTING = {
  ...MOCK_LISTING,
  condition: "used",
  mileage: 12480,
  mc_attributes: { ...MOCK_LISTING.mc_attributes, carfax_clean_title: null, title_brand: "", owner_count: 1, accident_count: 0 },
  recall_status: "clear",
  open_recall_count: 1,
  recall_check: {
    checked_at: "2026-07-10T00:00:00Z", has_open: true, do_not_drive: false,
    campaigns: [{ campaignNumber: "25V-118", component: "Rear view camera", summary: "The rearview image may fail to display.", remedy: "Dealers will update the software free of charge." }],
  },
};

const STATUS_UI: Record<VerificationStatus, { label: string; icon: React.ElementType; fg: string; bg: string; ring: string }> = {
  verified:          { label: "Verified",          icon: CircleCheck,   fg: "text-[#16A34A]", bg: "bg-emerald-50", ring: "border-emerald-200" },
  needs_attention:   { label: "Needs attention",   icon: CircleAlert,   fg: "text-[#DC2626]", bg: "bg-red-50",     ring: "border-red-200" },
  needs_confirmation:{ label: "Needs confirmation", icon: TriangleAlert, fg: "text-[#D97706]", bg: "bg-amber-50",   ring: "border-amber-200" },
  pending:           { label: "Pending",           icon: Clock,         fg: "text-[#64748B]", bg: "bg-slate-100",  ring: "border-slate-200" },
  unavailable:       { label: "Unavailable",       icon: CircleMinus,   fg: "text-[#94A3B8]", bg: "bg-slate-100",  ring: "border-slate-200" },
};

const PROVENANCE_ORDER: EvidenceProvenance[] = ["oem", "government", "independent_history", "live_market", "dealer_provided", "autolabels_derived"];

const NAV = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "attention", label: "Needs attention", icon: TriangleAlert },
  { key: "verified", label: "Verified checks", icon: CircleCheck },
  { key: "sources", label: "Data sources", icon: Database },
  { key: "actions", label: "Report actions", icon: List },
] as const;

const BANNER_TONE: Record<string, { bg: string; border: string; icon: React.ElementType; iconCls: string; head: string }> = {
  green:   { bg: "bg-emerald-50/70", border: "border-emerald-200", icon: CircleCheck,   iconCls: "text-[#16A34A]", head: "text-[#0F172A]" },
  amber:   { bg: "bg-amber-50/70",   border: "border-amber-200",   icon: TriangleAlert, iconCls: "text-[#D97706]", head: "text-[#0F172A]" },
  red:     { bg: "bg-red-50/70",     border: "border-red-200",     icon: CircleAlert,   iconCls: "text-[#DC2626]", head: "text-[#0F172A]" },
  neutral: { bg: "bg-slate-50",      border: "border-slate-200",   icon: ShieldCheck,   iconCls: "text-[#64748B]", head: "text-[#0F172A]" },
};

const StatusPill = ({ status }: { status: VerificationStatus }) => {
  const ui = STATUS_UI[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] font-bold ${ui.fg}`}>
      <ui.icon className="w-4 h-4" aria-hidden="true" /> {ui.label}
    </span>
  );
};

const dateLabel = (iso: string | null | undefined): string | null =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

// One evidence row; a null value is shown as an honest "not available" line,
// never a fabricated value.
const EvidenceRow = ({ label, value }: { label: string; value: string | null }) => (
  <div className="flex items-start justify-between gap-4 py-1.5 text-[12.5px]">
    <span className="text-[#64748B] shrink-0">{label}</span>
    <span className={`text-right ${value ? "text-[#0F172A] font-medium" : "text-[#94A3B8] italic"}`}>{value ?? "Not available from current sources"}</span>
  </div>
);

interface CheckCardProps {
  check: ReportCheck;
  expanded: boolean;
  onToggleEvidence: () => void;
  onAskDealer?: () => void;
}

const ExceptionCard = ({ check, expanded, onToggleEvidence, onAskDealer }: CheckCardProps) => {
  const ui = STATUS_UI[check.status];
  const isRecall = check.key === "recall";
  return (
    <div className={`rounded-2xl border ${ui.ring} ${ui.bg} p-5 print:break-inside-avoid`}>
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl bg-white flex items-center justify-center shrink-0 border border-black/5"><ui.icon className={`w-5 h-5 ${ui.fg}`} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <p className={`text-[11px] font-bold uppercase tracking-wide ${ui.fg}`}>{ui.label}</p>
          <h3 className="text-[16px] font-bold text-[#0F172A] leading-snug mt-0.5">{exceptionHeadline(check)}</h3>
          {check.finding && <p className="text-[13.5px] text-[#475569] mt-1.5 leading-relaxed">{check.finding}</p>}
          {!check.finding && check.status === "pending" && (
            <p className="text-[13.5px] text-[#475569] mt-1.5 leading-relaxed">This check has not completed. Pending does not mean a problem was found — it has simply not returned a result yet.</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[11.5px] text-[#94A3B8] pl-12">
        <span>Source: {sourceLabelFor(check)}</span>
        {check.checkedAt && <span>Last checked <time dateTime={check.checkedAt}>{dateLabel(check.checkedAt)}</time></span>}
      </div>
      <div className="flex flex-wrap gap-2 mt-3 pl-12 print:hidden">
        <button onClick={onToggleEvidence} aria-expanded={expanded} className="h-9 px-3.5 rounded-lg border border-[#E6E8EC] bg-white text-[12.5px] font-semibold text-[#0F172A] inline-flex items-center gap-1.5 hover:border-[#2563EB]">
          {isRecall ? "View recall details" : "View evidence"} <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
        {onAskDealer && (
          <button onClick={onAskDealer} className="h-9 px-3.5 rounded-lg bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-[12.5px] font-bold inline-flex items-center gap-1.5">Ask the dealer</button>
        )}
      </div>
      {expanded && (
        <div className="mt-3 ml-12 rounded-xl border border-black/5 bg-white p-4 divide-y divide-[#F1F5F9]">
          {check.evidence.map((e) => <EvidenceRow key={e.label} label={e.label} value={e.value} />)}
        </div>
      )}
    </div>
  );
};

const VerifiedCard = ({ check, expanded, onToggleEvidence }: CheckCardProps) => (
  <div className={`${CARD} p-5`}>
    <div className="flex items-center justify-between gap-3">
      <StatusPill status="verified" />
      <ProvenanceTag provenance={check.provenance} />
    </div>
    <h3 className="text-[15px] font-bold text-[#0F172A] mt-2.5">{check.name}</h3>
    {check.finding && <p className="text-[13px] text-[#475569] mt-1 leading-relaxed">{check.finding}</p>}
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[11.5px] text-[#94A3B8]">
      <span>{sourceLabelFor(check)}</span>
      {check.checkedAt && <span>Checked <time dateTime={check.checkedAt}>{dateLabel(check.checkedAt)}</time></span>}
    </div>
    <button onClick={onToggleEvidence} aria-expanded={expanded} className="mt-3 text-[12.5px] font-semibold text-[#2563EB] inline-flex items-center gap-1 hover:underline print:hidden">
      View evidence <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
    </button>
    {expanded && (
      <div className="mt-3 rounded-xl border border-[#EEF1F4] bg-[#fafbfc] p-4 divide-y divide-[#F1F5F9]">
        {check.evidence.map((e) => <EvidenceRow key={e.label} label={e.label} value={e.value} />)}
      </div>
    )}
  </div>
);

const ProvenanceTag = ({ provenance }: { provenance: EvidenceProvenance }) => (
  <span className="text-[10.5px] font-semibold text-[#64748B] bg-slate-100 rounded-md px-2 py-0.5">{PROVENANCE_LABEL[provenance]}</span>
);

const exceptionHeadline = (check: ReportCheck): string => {
  switch (check.key) {
    case "recall":
      if (check.status === "needs_confirmation") return "Recall status needs confirmation";
      if (check.highSeverity) return "Do-not-drive recall reported";
      if (check.status === "needs_attention") return "Open safety recall reported";
      return "Recall check pending";
    case "title":
      return check.status === "needs_attention" ? "Title brand on record" : "Title and brand check pending";
    case "history": return "Reported accident history";
    default: return check.status === "pending" ? `${check.name} pending` : `${check.name} needs review`;
  }
};

const FAMILY_SHORT: Record<string, string> = {
  oem_vin: "OEM / VIN decode", vehicle_history: "Vehicle history", nhtsa: "NHTSA recalls",
  live_market: "Live market data", oem_warranty: "OEM warranty", dealer: "Dealer-provided",
};
const sourceLabelFor = (check: ReportCheck): string => FAMILY_SHORT[check.family] ?? check.family;

// ── Loading / error shells ──────────────────────────────────────────────────
const Skeleton = () => (
  <div className="min-h-[100svh] bg-[#F6F7F9] px-5 lg:px-8 py-8" aria-busy="true" aria-label="Loading verification report">
    <div className="h-6 w-48 bg-slate-200 rounded-lg animate-pulse" />
    <div className="mt-6 h-24 w-full max-w-3xl bg-slate-200/70 rounded-2xl animate-pulse" />
    <div className="mt-5 grid gap-4 max-w-3xl">
      {[0, 1, 2].map((i) => <div key={i} className="h-28 bg-slate-200/60 rounded-2xl animate-pulse" />)}
    </div>
  </div>
);

const NeutralState = ({ title, body, onRetry, onBack }: { title: string; body: string; onRetry?: () => void; onBack: () => void }) => (
  <div className="min-h-[100svh] flex items-center justify-center px-6 bg-[#F6F7F9]">
    <div className="text-center max-w-md">
      <span className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto"><ShieldCheck className="w-7 h-7 text-slate-400" /></span>
      <h1 className="text-xl font-bold text-[#0F172A] mt-4">{title}</h1>
      <p className="text-sm text-[#64748B] mt-2 leading-relaxed">{body}</p>
      <div className="flex items-center justify-center gap-3 mt-5">
        {onRetry && <button onClick={onRetry} className="h-10 px-4 rounded-xl bg-[#2563EB] text-white text-[13px] font-bold">Try again</button>}
        <button onClick={onBack} className="h-10 px-4 rounded-xl border border-[#E6E8EC] bg-white text-[13px] font-bold text-[#0F172A]">Back to Vehicle Passport</button>
      </div>
    </div>
  </div>
);

const VehiclePassportVerification = () => {
  const params = useParams<{ vehicleSlug?: string; slug?: string }>();
  const vehicleSlug = params.vehicleSlug ?? params.slug;
  const navigate = useNavigate();

  const search = typeof window !== "undefined" ? window.location.search : "";
  const qp = new URLSearchParams(search);
  const isPreview = qp.has("preview");
  const scenario = qp.get("scenario");
  const previewData = (scenario === "review" ? MOCK_REVIEW_LISTING : MOCK_LISTING) as unknown as VehicleListing;
  const { listing, loading, notFound } = usePublicListing(vehicleSlug, { preview: isPreview, previewData });

  const d: PassportData | null = useMemo(() => (listing ? derivePassport(listing) : null), [listing]);
  const report: VerificationReport | null = useMemo(() => (d && listing ? deriveVerificationReport(d, listing) : null), [d, listing]);

  const [active, setActive] = useState<string>("overview");
  const [evidenceOpen, setEvidenceOpen] = useState<Record<string, boolean>>({});
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [pdfState, setPdfState] = useState<"idle" | "working" | "done" | "error">("idle");
  const viewedRef = useRef(false);

  const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const passportVersion = /\/v3\//.test(qp.get("returnTo") || "") ? "v3" : "v2";

  const track = useCallback((eventType: CustomerEngagementEventType, meta?: Record<string, unknown>) => {
    if (isPreview || !listing) return;
    void trackCustomerEngagement({
      eventType, surface: "vehicle_passport", source: "passport",
      storeId: (listing as unknown as { store_id?: string }).store_id, vehicleId: listing.id, vin: listing.vin,
      metadata: { passport_version: passportVersion, report_id: `${listing.id}:verification`, viewport: typeof window !== "undefined" ? window.innerWidth : null, ...(meta || {}) },
    });
  }, [isPreview, listing, passportVersion]);

  // One view event once the report is ready.
  useEffect(() => {
    if (viewedRef.current || !report || !report.valid) return;
    viewedRef.current = true;
    track("verification_report_viewed", { verified: report.verifiedChecks, needs_confirmation: report.needsConfirmationChecks, needs_attention: report.needsAttentionChecks, pending: report.pendingChecks, sources: report.sourceCount });
    report.checks
      .filter((c) => c.status === "needs_attention" || c.status === "needs_confirmation" || c.status === "pending")
      .forEach((c) => track("verification_exception_viewed", { check_id: c.key, status: c.status }));
  }, [report, track]);

  // Scroll-spy — no history spam, honors reduced-motion.
  useEffect(() => {
    if (!report) return;
    const els = NAV.map((n) => document.getElementById(`v-${n.key}`)).filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    const obs = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id.replace(/^v-/, ""));
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [report]);

  const back = useCallback(() => navigate(resolvePassportBack(search, listing?.slug || vehicleSlug || "", isPreview)), [navigate, search, listing, vehicleSlug, isPreview]);

  const goContact = useCallback((opts: { topic?: string; about?: string; checkId?: string }) => {
    track("verification_contact_clicked", { check_id: opts.checkId ?? null, action: opts.topic ?? "contact" });
    const p = new URLSearchParams();
    if (opts.topic) p.set("topic", opts.topic);
    if (opts.about) p.set("about", opts.about.slice(0, 120));
    if (isPreview) p.set("preview", "1");
    const q = p.toString();
    navigate(`/v/${listing?.slug || vehicleSlug}/contact${q ? `?${q}` : ""}`);
  }, [navigate, isPreview, listing, vehicleSlug, track]);

  const scrollTo = (key: string) => {
    setActive(key);
    document.getElementById(`v-${key}`)?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
  };

  const toggleEvidence = (check: ReportCheck) => {
    setEvidenceOpen((o) => {
      const next = !o[check.key];
      if (next) track("verification_evidence_opened", { check_id: check.key, status: check.status });
      return { ...o, [check.key]: next };
    });
  };

  // Canonical, production-safe report URL — never carries the preview param or a
  // preview hostname into a shared link.
  const canonicalReportUrl = useCallback(() => {
    if (typeof window === "undefined") return "";
    const origin = window.location.origin;
    return `${origin}/v/${listing?.slug || vehicleSlug}/verification`;
  }, [listing, vehicleSlug]);

  const reportDateISO = new Date().toISOString().slice(0, 10);

  const downloadPdf = useCallback(() => {
    if (!listing) return;
    track("verification_pdf_downloaded", {});
    try {
      setPdfState("working");
      const prevTitle = document.title;
      const filename = `AutoLabels-Verification-${listing.vin || "vehicle"}-${reportDateISO}`;
      document.title = filename;
      const restore = () => {
        document.title = prevTitle;
        setPdfState("done");
        window.removeEventListener("afterprint", restore);
        window.setTimeout(() => setPdfState("idle"), 2500);
      };
      window.addEventListener("afterprint", restore);
      window.print();
      // Safari does not always fire afterprint — restore the title defensively.
      window.setTimeout(() => { if (document.title === filename) document.title = prevTitle; }, 1500);
    } catch {
      setPdfState("error");
      toast.error("We could not generate the PDF. Please try Print instead.");
      window.setTimeout(() => setPdfState("idle"), 2500);
    }
  }, [listing, reportDateISO, track]);

  const printReport = useCallback(() => { track("verification_report_printed", {}); window.print(); }, [track]);

  const share = useCallback(async () => {
    track("verification_report_shared", {});
    const url = canonicalReportUrl();
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    if (nav?.share) {
      try { await nav.share({ title: "AutoLabels Data-Verified Report", url }); return; }
      catch { return; } // user cancelled — not an error
    }
    try { await nav?.clipboard?.writeText(url); toast.success("Report link copied"); }
    catch { toast.error("Could not copy the link"); }
  }, [canonicalReportUrl, track]);

  if (loading) return <Skeleton />;
  if (notFound || !listing || !d || !report) {
    return <NeutralState title="Verification report temporarily unavailable" body="We could not load this report. No verification conclusion has been made." onRetry={() => window.location.reload()} onBack={back} />;
  }
  // Refuse to render a valid-looking equation when the arithmetic does not hold.
  if (!report.valid) {
    return <NeutralState title="Report data unavailable" body="We could not assemble a complete verification report from the current sources. No verification conclusion has been made." onRetry={() => window.location.reload()} onBack={back} />;
  }

  const recallCheck = report.checks.find((c) => c.key === "recall");
  const recallNeedsConfirmation = recallCheck?.status === "needs_confirmation";
  const exceptions = report.checks
    .filter((c) => c.status !== "verified")
    .sort((a, b) => exceptionRank(a.status) - exceptionRank(b.status));
  const actionable = exceptions.filter((c) => c.status !== "unavailable");
  const unavailable = exceptions.filter((c) => c.status === "unavailable");
  const verified = report.checks.filter((c) => c.status === "verified");
  const hero = listingHero(listing);
  const banner = BANNER_TONE[report.banner.tone];
  const lastChecked = report.lastCheckedAt ? dateLabel(report.lastCheckedAt) : null;

  const askDealerFor = (check: ReportCheck) => {
    if (check.key === "recall") return () => goContact({ topic: "warranty", checkId: "recall", about: `the recall status on this ${listing.ymm} (VIN ${listing.vin})` });
    if (check.key === "title") return () => goContact({ topic: "history", checkId: "title", about: `the title and brand status on this ${listing.ymm}` });
    return () => goContact({ topic: "other", checkId: check.key, about: `the ${check.name.toLowerCase()} on this ${listing.ymm}` });
  };

  const CountRow = ({ label, value, status }: { label: string; value: number; status: VerificationStatus }) => {
    const ui = STATUS_UI[status];
    return (
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-[13px] text-[#64748B]"><ui.icon className={`w-4 h-4 ${ui.fg}`} aria-hidden="true" />{label}</span>
        <span className="text-[14px] font-bold text-[#0F172A]">{value}</span>
      </div>
    );
  };

  const ActionButtons = ({ compact }: { compact?: boolean }) => (
    <div className={compact ? "space-y-2" : "flex flex-wrap gap-2.5"}>
      <button onClick={downloadPdf} className={`${compact ? "w-full" : ""} min-h-[44px] px-4 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-[13px] font-bold inline-flex items-center justify-center gap-2`}>
        {pdfState === "working" ? <Loader2 className="w-4 h-4 animate-spin" /> : pdfState === "done" ? <CircleCheck className="w-4 h-4" /> : <Download className="w-4 h-4" />}
        {pdfState === "working" ? "Preparing PDF…" : pdfState === "done" ? "PDF ready" : "Download PDF"}
      </button>
      <button onClick={share} className={`${compact ? "w-full" : ""} min-h-[44px] px-4 rounded-xl border border-[#E6E8EC] bg-white text-[13px] font-bold text-[#0F172A] inline-flex items-center justify-center gap-2 hover:border-[#2563EB]`}><Share2 className="w-4 h-4 text-[#2563EB]" /> Share report</button>
      <button onClick={printReport} className={`${compact ? "w-full" : ""} min-h-[44px] px-4 rounded-xl border border-[#E6E8EC] bg-white text-[13px] font-bold text-[#0F172A] inline-flex items-center justify-center gap-2 hover:border-[#2563EB]`}><Printer className="w-4 h-4 text-[#2563EB]" /> Print</button>
      <button onClick={back} className={`${compact ? "w-full" : ""} min-h-[44px] px-4 rounded-xl border border-transparent hover:bg-slate-50 text-[13px] font-bold text-[#64748B] inline-flex items-center justify-center gap-2`}><ChevronLeft className="w-4 h-4" /> Back to Vehicle Passport</button>
    </div>
  );

  return (
    <div className="min-h-[100svh] bg-[#F6F7F9] text-[#0F172A]" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <Helmet><title>{`Data-Verified Report — ${listing.ymm} · AutoLabels`}</title><meta name="robots" content="noindex" /></Helmet>

      {/* Top bar — back + report actions */}
      <div className="bg-white border-b border-[#E6E8EC] px-4 lg:px-8 h-16 flex items-center justify-between gap-4 print:hidden">
        <button onClick={back} className="text-[14px] font-semibold text-[#64748B] hover:text-[#0F172A] inline-flex items-center gap-1.5 min-h-[44px]"><ChevronLeft className="w-4 h-4" /> Back to Vehicle Passport</button>
        <div className="hidden sm:block"><Logo variant="full" size={20} /></div>
        <div className="flex items-center gap-2">
          <button onClick={share} aria-label="Share report" className="h-10 px-3 rounded-lg text-[13px] font-semibold text-[#64748B] hover:text-[#0F172A] inline-flex items-center gap-1.5"><Share2 className="w-4 h-4" /><span className="hidden md:inline">Share</span></button>
          <button onClick={downloadPdf} aria-label="Download report as PDF" className="h-10 px-3 rounded-lg text-[13px] font-semibold text-[#64748B] hover:text-[#0F172A] inline-flex items-center gap-1.5">{pdfState === "working" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}<span className="hidden md:inline">Download PDF</span></button>
          <button onClick={printReport} aria-label="Print report" className="h-10 px-3 rounded-lg text-[13px] font-semibold text-[#64748B] hover:text-[#0F172A] inline-flex items-center gap-1.5"><Printer className="w-4 h-4" /><span className="hidden md:inline">Print</span></button>
        </div>
      </div>

      <div className="mx-auto max-w-[1200px] px-4 lg:px-8 py-6 lg:grid lg:grid-cols-[176px_minmax(0,1fr)_320px] lg:gap-5 lg:items-start">
        {/* Left report nav (desktop) */}
        <nav aria-label="Report sections" className="hidden lg:block sticky top-6 self-start print:hidden">
          <ul className="space-y-1">
            {NAV.map((n) => (
              <li key={n.key}>
                <button onClick={() => scrollTo(n.key)} aria-current={active === n.key ? "true" : undefined}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-left transition-colors ${active === n.key ? "bg-blue-50 text-[#1e3a8a] font-semibold" : "text-[#64748B] hover:bg-slate-50 font-medium"}`}>
                  <n.icon className={`w-4 h-4 shrink-0 ${active === n.key ? "text-[#2563EB]" : "text-[#94A3B8]"}`} aria-hidden="true" />{n.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Main evidence column */}
        <main className="min-w-0 space-y-6">
          {/* Mobile section selector */}
          <div className="lg:hidden -mx-4 px-4 overflow-x-auto print:hidden">
            <div className="flex gap-2 w-max pb-1">
              {NAV.map((n) => (
                <button key={n.key} onClick={() => scrollTo(n.key)} aria-current={active === n.key ? "true" : undefined}
                  className={`min-h-[40px] px-3 rounded-full text-[12.5px] font-semibold inline-flex items-center gap-1.5 border transition-colors ${active === n.key ? "border-[#2563EB] bg-blue-50 text-[#1e3a8a]" : "border-[#E6E8EC] bg-white text-[#64748B]"}`}>
                  <n.icon className="w-3.5 h-3.5" aria-hidden="true" />{n.label}
                </button>
              ))}
            </div>
          </div>

          {/* Header + identity */}
          <header id="v-overview" className="scroll-mt-6">
            <h1 className="text-[24px] font-bold leading-tight">AutoLabels Data-Verified Report</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[13px] text-[#64748B]">
              <span className="font-semibold text-[#0F172A]">{listing.ymm}{listing.trim ? ` · ${listing.trim}` : ""}</span>
              <span>VIN {listing.vin}</span>
              {listing.mileage != null && <span>{listing.mileage.toLocaleString()} mi</span>}
            </div>
            <p className="text-[12px] text-[#94A3B8] mt-1">Report generated {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}{lastChecked ? ` · Source data last checked ${lastChecked}` : ""}</p>
          </header>

          {/* Exception-first status banner */}
          <section aria-label="Verification status" className={`rounded-2xl border ${banner.border} ${banner.bg} p-5 flex items-start gap-3.5 print:break-inside-avoid`}>
            <span className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shrink-0 border border-black/5"><banner.icon className={`w-6 h-6 ${banner.iconCls}`} aria-hidden="true" /></span>
            <div className="min-w-0">
              <h2 className={`text-[18px] font-extrabold ${banner.head}`}>{report.banner.heading}</h2>
              <p className="text-[13.5px] text-[#475569] mt-1 leading-relaxed">{report.banner.body}</p>
            </div>
          </section>

          {/* Needs attention — exceptions */}
          <section id="v-attention" className="scroll-mt-6 space-y-3">
            <h2 className="text-[16px] font-bold">Needs attention</h2>
            {actionable.length === 0 && (
              <div className={`${CARD} p-5 flex items-center gap-3`}><CircleCheck className="w-5 h-5 text-[#16A34A]" /><p className="text-[13.5px] text-[#475569]">Nothing needs your attention. Every completed check returned a clear result.</p></div>
            )}
            {actionable.map((check) => (
              <ExceptionCard key={check.key} check={check} expanded={!!evidenceOpen[check.key]}
                onToggleEvidence={() => toggleEvidence(check)}
                onAskDealer={check.status === "unavailable" ? undefined : askDealerFor(check)} />
            ))}
            {unavailable.length > 0 && (
              <div className={`${CARD} p-5`}>
                <div className="flex items-center gap-2"><CircleMinus className="w-4 h-4 text-[#94A3B8]" /><h3 className="text-[13.5px] font-bold text-[#0F172A]">Checks awaiting source data</h3></div>
                <p className="text-[12.5px] text-[#64748B] mt-1">These checks could not run because the underlying source data is not available for this vehicle. Source data required.</p>
                <ul className="mt-2 flex flex-wrap gap-2">{unavailable.map((c) => <li key={c.key} className="text-[12px] font-medium text-[#64748B] bg-slate-100 rounded-lg px-2.5 py-1">{c.name}</li>)}</ul>
              </div>
            )}
          </section>

          {/* What checked out — verified */}
          <section id="v-verified" className="scroll-mt-6">
            <h2 className="text-[16px] font-bold mb-3">What checked out</h2>
            {verified.length === 0 ? (
              <div className={`${CARD} p-5`}><p className="text-[13.5px] text-[#64748B]">No checks have returned a verified result yet.</p></div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {verified.map((check) => <VerifiedCard key={check.key} check={check} expanded={!!evidenceOpen[check.key]} onToggleEvidence={() => toggleEvidence(check)} />)}
              </div>
            )}
          </section>

          {/* Evidence & methodology */}
          <section className={`${CARD} p-6 print:break-inside-avoid`}>
            <h2 className="text-[16px] font-bold">Evidence and methodology</h2>
            <p className="text-[13.5px] text-[#475569] mt-2 leading-relaxed">
              AutoLabels compares vehicle information across independent and dealer-provided sources, identifies conflicts, and never displays a pending check as verified. This report does not replace a physical inspection, title search, or dealer confirmation.
            </p>
            <button onClick={() => { setMethodologyOpen(true); track("verification_methodology_opened", {}); }} className="mt-3 text-[13px] font-semibold text-[#2563EB] hover:underline inline-flex items-center gap-1 print:hidden">How AutoLabels verification works <ExternalLink className="w-3.5 h-3.5" /></button>

            <div className="mt-5 pt-5 border-t border-[#EEF1F4]">
              <h3 className="text-[12.5px] font-bold text-[#0F172A] uppercase tracking-wide">Source provenance</h3>
              <div className="mt-2.5 grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
                {PROVENANCE_ORDER.map((p) => (
                  <div key={p} className="flex items-center gap-2 text-[12.5px] text-[#475569]"><span className="w-1.5 h-1.5 rounded-full bg-[#2563EB]" />{PROVENANCE_LABEL[p]}</div>
                ))}
              </div>
            </div>

            {/* Status legend */}
            <div className="mt-5 pt-5 border-t border-[#EEF1F4]">
              <h3 className="text-[12.5px] font-bold text-[#0F172A] uppercase tracking-wide">What each status means</h3>
              <div className="mt-2.5 grid sm:grid-cols-2 gap-x-6 gap-y-2">
                {(Object.keys(STATUS_UI) as VerificationStatus[]).map((s) => {
                  const ui = STATUS_UI[s];
                  return <div key={s} className="flex items-center gap-2 text-[12.5px] text-[#475569]"><ui.icon className={`w-4 h-4 ${ui.fg}`} aria-hidden="true" />{ui.label}{s === "needs_confirmation" ? " — sources disagree" : s === "pending" ? " — not yet complete" : ""}</div>;
                })}
              </div>
            </div>
          </section>

          {/* Data sources */}
          <section id="v-sources" className="scroll-mt-6">
            <h2 className="text-[16px] font-bold mb-3">Data sources ({report.sourceCount})</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {report.sources.map((s) => (
                <div key={s.family} className={`${CARD} p-4`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-[13.5px] font-bold text-[#0F172A]"><Database className="w-4 h-4 text-[#2563EB]" />{s.label}</span>
                    <ProvenanceTag provenance={s.provenance} />
                  </div>
                  <p className="text-[12px] text-[#64748B] mt-1.5">{s.type}</p>
                  <p className="text-[11.5px] text-[#94A3B8] mt-0.5">{s.checkedAt ? <>Last checked <time dateTime={s.checkedAt}>{dateLabel(s.checkedAt)}</time></> : "Available"}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Report actions */}
          <section id="v-actions" className={`${CARD} p-6 scroll-mt-6 print:hidden`}>
            <h2 className="text-[16px] font-bold mb-3">Report actions</h2>
            <ActionButtons />
            {pdfState === "error" && <p className="text-[12.5px] text-[#DC2626] mt-2">We could not generate the PDF. Please try Print instead.</p>}
            <p className="text-[11.5px] text-[#94A3B8] mt-3">The PDF matches this report exactly — same checks, statuses, sources, and dates.</p>
          </section>
        </main>

        {/* Right summary rail */}
        <aside className="mt-6 lg:mt-0 lg:sticky lg:top-6 self-start space-y-4">
          <div className={`${CARD} p-5`}>
            <h2 className="text-[15px] font-bold">Report summary</h2>
            <div className="mt-3 space-y-2.5">
              <CountRow label="Verified" value={report.verifiedChecks} status="verified" />
              {report.needsAttentionChecks > 0 && <CountRow label="Needs attention" value={report.needsAttentionChecks} status="needs_attention" />}
              {report.needsConfirmationChecks > 0 && <CountRow label="Needs confirmation" value={report.needsConfirmationChecks} status="needs_confirmation" />}
              {report.pendingChecks > 0 && <CountRow label="Pending" value={report.pendingChecks} status="pending" />}
              {report.unavailableChecks > 0 && <CountRow label="Unavailable" value={report.unavailableChecks} status="unavailable" />}
              <div className="flex items-center justify-between pt-2.5 border-t border-[#EEF1F4]">
                <span className="inline-flex items-center gap-2 text-[13px] text-[#64748B]"><Database className="w-4 h-4 text-[#2563EB]" />Data sources</span>
                <span className="text-[14px] font-bold text-[#0F172A]">{report.sourceCount}</span>
              </div>
            </div>
            {lastChecked && <p className="text-[11.5px] text-[#94A3B8] mt-3">Source data last checked {lastChecked}</p>}
            <div className="mt-4 print:hidden"><ActionButtons compact /></div>
          </div>

          <div className={`${CARD} p-5 print:hidden`}>
            <h3 className="text-[13.5px] font-bold">Data sources ({report.sourceCount})</h3>
            <ul className="mt-2.5 space-y-2.5">
              {report.sources.map((s) => (
                <li key={s.family} onClick={() => track("verification_source_viewed", { source_id: s.family })} className="text-[12.5px]">
                  <p className="font-semibold text-[#0F172A]">{s.label}</p>
                  <p className="text-[#94A3B8]">{s.type}{s.checkedAt ? ` · checked ${dateLabel(s.checkedAt)}` : ""}</p>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      {methodologyOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4 print:hidden" role="dialog" aria-modal="true" aria-label="How AutoLabels verification works">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMethodologyOpen(false)} />
          <div className="relative bg-white rounded-2xl w-full max-w-lg p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-3"><h2 className="text-lg font-bold">How AutoLabels verification works</h2><button onClick={() => setMethodologyOpen(false)} aria-label="Close" className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center"><X className="w-4 h-4" /></button></div>
            <p className="text-[14px] leading-relaxed text-[#475569]">AutoLabels aggregates records from manufacturer, government, independent history, and dealer sources, then compares them for each check. When sources agree, the check is marked verified with the supporting evidence shown. When they disagree, the check is marked "needs confirmation" so you can resolve it with the dealer. Checks that have not returned a result are shown as pending — never as verified. This is a data-verification report; it aggregates records and does not replace a physical inspection, title search, or dealer confirmation.</p>
          </div>
        </div>
      )}

      <VerificationReportDock
        recallNeedsConfirmation={!!recallNeedsConfirmation}
        onAskRecall={() => goContact({ topic: "warranty", checkId: "recall", about: `the recall status on this ${listing.ymm} (VIN ${listing.vin})` })}
        onContact={() => goContact({ topic: "other", checkId: "report" })}
        onBack={back}
        onOpenChange={(o) => { if (o) track("verification_bubble_opened", {}); }}
        onAction={(a) => track("verification_bubble_action_clicked", { action: a })}
      />
    </div>
  );
};

const exceptionRank = (s: VerificationStatus): number =>
  s === "needs_attention" ? 0 : s === "needs_confirmation" ? 1 : s === "pending" ? 2 : 3;

export default VehiclePassportVerification;
