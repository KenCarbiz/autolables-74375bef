import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ChevronLeft, Download, Printer, Share2, CircleCheck, TriangleAlert, CircleAlert,
  Clock, CircleMinus, LayoutDashboard, Database, ListChecks, ExternalLink, Loader2,
  X, ShieldCheck, ChevronDown, ArrowRight, SearchCheck, BadgeCheck, FileWarning,
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
//
// This file is a PRESENTATION layer over the frozen canonical model. It never
// re-derives a status, count, or finding — it only lays them out.
// ──────────────────────────────────────────────────────────────

// Preview-only review-state fixture (noindex). Lets the amber "review" layout
// be rendered locally at /v/:slug/verification?preview=1&scenario=review without
// polluting the shared MOCK_LISTING (which is the all-verified happy path).
export const MOCK_REVIEW_LISTING = {
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
  { key: "next", label: "What's next", icon: ListChecks },
] as const;

// Hero tone comes straight from the canonical banner.tone — never re-derived.
const HERO_TONE: Record<string, { bg: string; border: string; icon: React.ElementType; iconCls: string; chip: string; eyebrow: string }> = {
  green:   { bg: "bg-emerald-50", border: "border-emerald-200", icon: CircleCheck,   iconCls: "text-[#16A34A]", chip: "bg-emerald-100 text-[#15803D]", eyebrow: "Verification complete" },
  amber:   { bg: "bg-amber-50",   border: "border-amber-200",   icon: TriangleAlert, iconCls: "text-[#D97706]", chip: "bg-amber-100 text-[#B45309]", eyebrow: "Review before purchase" },
  red:     { bg: "bg-red-50",     border: "border-red-200",     icon: CircleAlert,   iconCls: "text-[#DC2626]", chip: "bg-red-100 text-[#B91C1C]", eyebrow: "Review before purchase" },
  neutral: { bg: "bg-slate-50",   border: "border-slate-200",   icon: ShieldCheck,   iconCls: "text-[#64748B]", chip: "bg-slate-200 text-[#475569]", eyebrow: "Verification in progress" },
};

const dateLabel = (iso: string | null | undefined): string | null =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

const ORDER: VerificationStatus[] = ["verified", "needs_attention", "needs_confirmation", "pending", "unavailable"];

// The full status arithmetic, EVERY non-zero status included (unavailable too).
// Presentation-only — reads the canonical counts, derives nothing.
const statusSegments = (report: VerificationReport): { status: VerificationStatus; count: number }[] => {
  const counts: Record<VerificationStatus, number> = {
    verified: report.verifiedChecks,
    needs_attention: report.needsAttentionChecks,
    needs_confirmation: report.needsConfirmationChecks,
    pending: report.pendingChecks,
    unavailable: report.unavailableChecks,
  };
  return ORDER.map((status) => ({ status, count: counts[status] })).filter((s) => s.count > 0);
};

const StatusPills = ({ report }: { report: VerificationReport }) => (
  <div className="flex flex-wrap items-center gap-2">
    {statusSegments(report).map(({ status, count }) => {
      const ui = STATUS_UI[status];
      return (
        <span key={status} className={`inline-flex items-center gap-1.5 rounded-full border ${ui.ring} bg-white px-2.5 py-1 text-[12.5px] font-semibold text-[#0F172A]`}>
          <ui.icon className={`w-3.5 h-3.5 ${ui.fg}`} aria-hidden="true" />
          <span className={ui.fg}>{count}</span> {ui.label}
        </span>
      );
    })}
  </div>
);

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

// Secondary exception (e.g. pending Title & Brand). Deliberately lighter than the
// decision hero so the visual weight steps down: hero → this card → unavailable row.
const ExceptionCard = ({ check, expanded, onToggleEvidence, onAskDealer }: CheckCardProps) => {
  const ui = STATUS_UI[check.status];
  return (
    <div className={`rounded-2xl border ${ui.ring} ${ui.bg} p-4 sm:p-5 print:break-inside-avoid`}>
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl bg-white flex items-center justify-center shrink-0 border border-black/5"><ui.icon className={`w-5 h-5 ${ui.fg}`} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <p className={`text-[11px] font-bold uppercase tracking-wide ${ui.fg}`}>{ui.label}</p>
          <h3 className="text-[15.5px] font-bold text-[#0F172A] leading-snug mt-0.5">{exceptionHeadline(check)}</h3>
          {check.finding && <p className="text-[13px] text-[#475569] mt-1.5 leading-relaxed">{check.finding}</p>}
          {!check.finding && check.status === "pending" && (
            <p className="text-[13px] text-[#475569] mt-1.5 leading-relaxed">This check has not completed. Pending does not mean a problem was found — it has simply not returned a result yet.</p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[11.5px] text-[#94A3B8]">
            <span>Source: {sourceLabelFor(check)}</span>
            {check.checkedAt && <span>Last checked <time dateTime={check.checkedAt}>{dateLabel(check.checkedAt)}</time></span>}
          </div>
          <div className="flex flex-wrap gap-2 mt-3 print:hidden">
            <button onClick={onToggleEvidence} aria-expanded={expanded} className="h-9 px-3.5 rounded-lg border border-[#E6E8EC] bg-white text-[12.5px] font-semibold text-[#0F172A] inline-flex items-center gap-1.5 hover:border-[#2563EB]">
              View evidence <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
            {onAskDealer && (
              <button onClick={onAskDealer} className="h-9 px-3.5 rounded-lg bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-[12.5px] font-bold inline-flex items-center gap-1.5">Ask the dealer</button>
            )}
          </div>
          {expanded && (
            <div className="mt-3 rounded-xl border border-black/5 bg-white p-4 divide-y divide-[#F1F5F9]">
              {check.evidence.map((e) => <EvidenceRow key={e.label} label={e.label} value={e.value} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const VerifiedCard = ({ check, expanded, onToggleEvidence }: CheckCardProps) => {
  const ui = STATUS_UI.verified;
  return (
    <div className={`${CARD} p-5 flex flex-col`}>
      <div className="flex items-center justify-between gap-3">
        <span className="w-11 h-11 rounded-2xl bg-emerald-50 flex items-center justify-center shrink-0 border border-emerald-100"><ui.icon className={`w-6 h-6 ${ui.fg}`} aria-hidden="true" /></span>
        <ProvenanceTag provenance={check.provenance} />
      </div>
      <h3 className="text-[16.5px] font-bold text-[#0F172A] mt-3 leading-snug">{check.name}</h3>
      {check.finding && <p className="text-[13px] text-[#475569] mt-1.5 leading-relaxed">{check.finding}</p>}
      <div className="mt-auto pt-4 border-t border-[#EEF1F4] mt-4 flex items-center justify-between gap-2 text-[11.5px] text-[#94A3B8]">
        <span>{sourceLabelFor(check)}</span>
        {check.checkedAt && <span>Checked <time dateTime={check.checkedAt}>{dateLabel(check.checkedAt)}</time></span>}
      </div>
      <button onClick={onToggleEvidence} aria-expanded={expanded} className="mt-3 text-[12.5px] font-semibold text-[#2563EB] inline-flex items-center gap-1 hover:underline print:hidden">
        View evidence <ArrowRight className="w-3.5 h-3.5" />
      </button>
      {expanded && (
        <div className="mt-3 rounded-xl border border-[#EEF1F4] bg-[#fafbfc] p-4 divide-y divide-[#F1F5F9]">
          {check.evidence.map((e) => <EvidenceRow key={e.label} label={e.label} value={e.value} />)}
        </div>
      )}
    </div>
  );
};

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

const conditionBadge = (listing: VehicleListing): string | null => {
  const c = String((listing as unknown as { condition?: string }).condition || "").toLowerCase();
  if (!c) return null;
  if (c === "new") return "New";
  if (c.includes("certified") || c === "cpo") return "Certified Pre-Owned";
  if (c === "used") return "Used";
  return c.charAt(0).toUpperCase() + c.slice(1);
};

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
  const recallIsException = !!recallCheck && recallCheck.status !== "verified";
  const exceptions = report.checks
    .filter((c) => c.status !== "verified")
    .sort((a, b) => exceptionRank(a.status) - exceptionRank(b.status));
  // Recall lives in the decision hero; the remaining actionable exceptions render
  // as lighter secondary cards so nothing is stated twice.
  const secondary = exceptions.filter((c) => c.status !== "unavailable" && c.key !== "recall");
  const unavailable = exceptions.filter((c) => c.status === "unavailable");
  const verified = report.checks.filter((c) => c.status === "verified");
  const hero = listingHero(listing);
  const tone = HERO_TONE[report.banner.tone];
  const lastChecked = report.lastCheckedAt ? dateLabel(report.lastCheckedAt) : null;
  const dealerName = ((listing as unknown as { dealer_snapshot?: { name?: string } }).dealer_snapshot?.name) || null;
  const condition = conditionBadge(listing);
  const reportGenerated = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const askDealerFor = (check: ReportCheck) => {
    if (check.key === "recall") return () => goContact({ topic: "warranty", checkId: "recall", about: `the recall status on this ${listing.ymm} (VIN ${listing.vin})` });
    if (check.key === "title") return () => goContact({ topic: "history", checkId: "title", about: `the title and brand status on this ${listing.ymm}` });
    return () => goContact({ topic: "other", checkId: check.key, about: `the ${check.name.toLowerCase()} on this ${listing.ymm}` });
  };
  const askRecall = () => goContact({ topic: "warranty", checkId: "recall", about: `the recall status on this ${listing.ymm} (VIN ${listing.vin})` });

  // Next-step checklist, derived purely from which exceptions exist — never a
  // fabricated recommendation.
  const nextSteps: string[] = [];
  if (recallIsException) {
    nextSteps.push("Ask the dealer about the open recall and whether the remedy is available.");
    nextSteps.push("Confirm the recall remedy has been completed before you take delivery.");
  }
  secondary.forEach((c) => {
    if (c.key === "title") nextSteps.push("Review the title and brand details with the dealer once that check completes.");
    else nextSteps.push(`Ask the dealer about ${c.name.toLowerCase()}.`);
  });
  if (unavailable.length) nextSteps.push("Ask the dealer for the records behind any checks marked unavailable.");
  if (nextSteps.length === 0) nextSteps.push("Review the verified checks above — every completed check returned a clear result.");
  nextSteps.push("Keep this report for your records. It reflects the source data as of the date shown.");

  const CountRow = ({ label, value, status }: { label: string; value: number; status: VerificationStatus }) => {
    const ui = STATUS_UI[status];
    return (
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-[13.5px] text-[#475569]"><ui.icon className={`w-[18px] h-[18px] ${ui.fg}`} aria-hidden="true" />{label}</span>
        <span className="text-[18px] font-extrabold tabular-nums text-[#0F172A]">{value}</span>
      </div>
    );
  };

  const RailActions = () => (
    <div className="space-y-2">
      <button onClick={downloadPdf} className="w-full min-h-[44px] px-4 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-[13px] font-bold inline-flex items-center justify-center gap-2">
        {pdfState === "working" ? <Loader2 className="w-4 h-4 animate-spin" /> : pdfState === "done" ? <CircleCheck className="w-4 h-4" /> : <Download className="w-4 h-4" />}
        {pdfState === "working" ? "Preparing PDF…" : pdfState === "done" ? "PDF ready" : "Download PDF"}
      </button>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={share} className="min-h-[44px] px-3 rounded-xl border border-[#E6E8EC] bg-white text-[13px] font-bold text-[#0F172A] inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"><Share2 className="w-4 h-4 text-[#2563EB]" /> Share</button>
        <button onClick={printReport} className="min-h-[44px] px-3 rounded-xl border border-[#E6E8EC] bg-white text-[13px] font-bold text-[#0F172A] inline-flex items-center justify-center gap-1.5 hover:border-[#2563EB]"><Printer className="w-4 h-4 text-[#2563EB]" /> Print</button>
      </div>
      <button onClick={back} className="w-full min-h-[44px] px-4 rounded-xl border border-transparent hover:bg-slate-50 text-[13px] font-bold text-[#64748B] inline-flex items-center justify-center gap-2"><ChevronLeft className="w-4 h-4" /> Back to Vehicle Passport</button>
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

      <div className="mx-auto max-w-[1240px] px-4 lg:px-8 py-6 lg:grid lg:grid-cols-[160px_minmax(0,1fr)_300px] lg:gap-6 lg:items-start">
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

          {/* Title + vehicle identity strip */}
          <header id="v-overview" className="scroll-mt-6">
            <h1 className="text-[24px] sm:text-[26px] font-bold leading-tight tracking-[-0.01em]">AutoLabels Data-Verified Report</h1>
            <div className={`${CARD} mt-3 p-3 sm:p-4 flex flex-wrap items-center gap-x-5 gap-y-3`}>
              {hero && <img src={hero} alt="" className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl object-cover shrink-0 border border-black/5" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="text-[16px] font-bold text-[#0F172A]">{listing.ymm}{listing.trim ? ` ${listing.trim}` : ""}</span>
                  {condition && <span className="inline-flex items-center rounded-full bg-blue-50 text-[#1e3a8a] text-[11px] font-bold px-2 py-0.5 uppercase tracking-wide">{condition}</span>}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[12.5px] text-[#64748B]">
                  <span>VIN {listing.vin}</span>
                  {listing.mileage != null && <span>{listing.mileage.toLocaleString()} mi</span>}
                  {dealerName && <span>{dealerName}</span>}
                </div>
                <p className="text-[11.5px] text-[#94A3B8] mt-1">Report generated {reportGenerated}{lastChecked ? ` · Source data last checked ${lastChecked}` : ""}</p>
              </div>
              <button onClick={back} className="print:hidden text-[12.5px] font-semibold text-[#2563EB] hover:underline inline-flex items-center gap-1 shrink-0"><ChevronLeft className="w-4 h-4" /> Back to Passport</button>
            </div>
          </header>

          {/* Decision hero + exceptions */}
          <section id="v-attention" aria-labelledby="v-hero-heading" className="scroll-mt-6 space-y-4">
            <div className={`rounded-2xl border ${tone.border} ${tone.bg} p-5 sm:p-7 print:break-inside-avoid`}>
              <div className="flex items-start gap-4">
                <span className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white flex items-center justify-center shrink-0 border border-black/5"><tone.icon className={`w-7 h-7 sm:w-8 sm:h-8 ${tone.iconCls}`} aria-hidden="true" /></span>
                <div className="min-w-0 flex-1">
                  <p className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${tone.chip}`}>{tone.eyebrow}</p>
                  <h2 id="v-hero-heading" className="text-[22px] sm:text-[28px] font-extrabold text-[#0F172A] leading-tight mt-2">{report.banner.heading}</h2>
                  {report.banner.body && <p className="text-[14px] sm:text-[15px] text-[#475569] mt-2 leading-relaxed max-w-2xl">{report.banner.body}</p>}
                  <div className="mt-4"><StatusPills report={report} /></div>
                </div>
              </div>

              {/* Recall decision — the ONLY place the recall is stated in full */}
              {recallIsException && recallCheck && (
                <div className="mt-5 rounded-2xl border border-black/5 bg-white/80 p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <span className="w-9 h-9 rounded-xl bg-white flex items-center justify-center shrink-0 border border-black/5"><TriangleAlert className={`w-5 h-5 ${STATUS_UI[recallCheck.status].fg}`} aria-hidden="true" /></span>
                    <div className="min-w-0">
                      <h3 className="text-[15.5px] font-bold text-[#0F172A] leading-snug">{exceptionHeadline(recallCheck)}</h3>
                      {recallCheck.finding && <p className="text-[13px] text-[#475569] mt-1 leading-relaxed">{recallCheck.finding}</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3 print:hidden">
                    <button onClick={() => toggleEvidence(recallCheck)} aria-expanded={!!evidenceOpen.recall} className="h-10 px-4 rounded-lg border border-[#E6E8EC] bg-white text-[13px] font-semibold text-[#0F172A] inline-flex items-center gap-1.5 hover:border-[#2563EB]">
                      View recall details <ChevronDown className={`w-4 h-4 transition-transform ${evidenceOpen.recall ? "rotate-180" : ""}`} />
                    </button>
                    <button onClick={askDealerFor(recallCheck)} className="h-10 px-4 rounded-lg bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-[13px] font-bold inline-flex items-center gap-1.5">Ask the dealer</button>
                  </div>
                  {evidenceOpen.recall && (
                    <div className="mt-3 rounded-xl border border-black/5 bg-white p-4 divide-y divide-[#F1F5F9]">
                      {recallCheck.evidence.map((e) => <EvidenceRow key={e.label} label={e.label} value={e.value} />)}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Secondary exceptions — lighter than the hero */}
            {secondary.map((check) => (
              <ExceptionCard key={check.key} check={check} expanded={!!evidenceOpen[check.key]}
                onToggleEvidence={() => toggleEvidence(check)} onAskDealer={askDealerFor(check)} />
            ))}

            {/* Unavailable — the most compact, neutral row */}
            {unavailable.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 print:break-inside-avoid">
                <div className="flex items-start gap-2.5">
                  <CircleMinus className="w-[18px] h-[18px] text-[#94A3B8] shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold text-[#475569]">Awaiting source data <span className="font-medium text-[#94A3B8]">— no result, not a problem found</span></p>
                    <p className="text-[12px] text-[#64748B] mt-0.5">{unavailable.map((c) => c.name).join(", ")} could not run because the underlying records are not available for this vehicle.</p>
                  </div>
                </div>
              </div>
            )}

            {secondary.length === 0 && unavailable.length === 0 && !recallIsException && (
              <div className={`${CARD} p-5 flex items-center gap-3`}><CircleCheck className="w-5 h-5 text-[#16A34A]" /><p className="text-[13.5px] text-[#475569]">Nothing needs your attention. Every completed check returned a clear result.</p></div>
            )}
          </section>

          {/* What checked out — verified */}
          <section id="v-verified" className="scroll-mt-6">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[17px] font-bold">What checked out</h2>
              <span className="text-[12.5px] text-[#94A3B8]">{verified.length} verified {verified.length === 1 ? "check" : "checks"}</span>
            </div>
            {verified.length === 0 ? (
              <div className={`${CARD} p-5 mt-3`}><p className="text-[13.5px] text-[#64748B]">No checks have returned a verified result yet.</p></div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-3">
                {verified.map((check) => <VerifiedCard key={check.key} check={check} expanded={!!evidenceOpen[check.key]} onToggleEvidence={() => toggleEvidence(check)} />)}
              </div>
            )}
          </section>

          {/* Methodology — four plain-language cards */}
          <section className="scroll-mt-6">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[17px] font-bold">How to read this report</h2>
              <button onClick={() => { setMethodologyOpen(true); track("verification_methodology_opened", {}); }} className="text-[13px] font-semibold text-[#2563EB] hover:underline inline-flex items-center gap-1 print:hidden">How AutoLabels verification works <ExternalLink className="w-3.5 h-3.5" /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
              <div className={`${CARD} p-5`}>
                <SearchCheck className="w-6 h-6 text-[#2563EB]" aria-hidden="true" />
                <h3 className="text-[15px] font-bold text-[#0F172A] mt-2.5">What AutoLabels checked</h3>
                <p className="text-[13px] text-[#475569] mt-1.5 leading-relaxed">{report.totalChecks} distinct checks — identity, history, title, safety recalls, market, and warranty — evaluated against real records for this VIN.</p>
              </div>
              <div className={`${CARD} p-5`}>
                <Database className="w-6 h-6 text-[#2563EB]" aria-hidden="true" />
                <h3 className="text-[15px] font-bold text-[#0F172A] mt-2.5">Where the data came from</h3>
                <p className="text-[13px] text-[#475569] mt-1.5 leading-relaxed">{report.sourceCount} independent source {report.sourceCount === 1 ? "family" : "families"} — manufacturer, government, independent history, live market, and dealer records — compared for agreement.</p>
              </div>
              <div className={`${CARD} p-5`}>
                <BadgeCheck className="w-6 h-6 text-[#16A34A]" aria-hidden="true" />
                <h3 className="text-[15px] font-bold text-[#0F172A] mt-2.5">What "verified" means</h3>
                <p className="text-[13px] text-[#475569] mt-1.5 leading-relaxed">Sources agreed and the supporting evidence is shown. When they disagree the check reads "needs confirmation"; a check with no result stays "pending" — never verified.</p>
                <div className="mt-3 pt-3 border-t border-[#EEF1F4] flex flex-wrap gap-x-4 gap-y-1.5">
                  {(Object.keys(STATUS_UI) as VerificationStatus[]).map((s) => {
                    const ui = STATUS_UI[s];
                    return <span key={s} className="inline-flex items-center gap-1.5 text-[11.5px] text-[#475569]"><ui.icon className={`w-3.5 h-3.5 ${ui.fg}`} aria-hidden="true" />{ui.label}</span>;
                  })}
                </div>
              </div>
              <div className={`${CARD} p-5`}>
                <FileWarning className="w-6 h-6 text-[#D97706]" aria-hidden="true" />
                <h3 className="text-[15px] font-bold text-[#0F172A] mt-2.5">What this report does not replace</h3>
                <p className="text-[13px] text-[#475569] mt-1.5 leading-relaxed">This is a data-verification report. It does not replace a physical inspection, an independent title search, or written confirmation from the dealer.</p>
              </div>
            </div>
          </section>

          {/* Data sources — the detailed cards live here only */}
          <section id="v-sources" className="scroll-mt-6">
            <h2 className="text-[17px] font-bold mb-3">Data sources ({report.sourceCount})</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {report.sources.map((s) => (
                <div key={s.family} onClick={() => track("verification_source_viewed", { source_id: s.family })} className={`${CARD} p-4`}>
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

          {/* Customer conclusion — what should I do next? */}
          <section id="v-next" className={`${CARD} p-6 scroll-mt-6 print:break-inside-avoid`}>
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><ListChecks className="w-5 h-5 text-[#2563EB]" aria-hidden="true" /></span>
              <h2 className="text-[17px] font-bold">What should I do next?</h2>
            </div>
            <ol className="mt-4 space-y-3">
              {nextSteps.map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-blue-50 text-[#1e3a8a] text-[12px] font-bold inline-flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                  <span className="text-[13.5px] text-[#334155] leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2.5 mt-5 print:hidden">
              <button onClick={askRecall} className="min-h-[44px] px-4 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-[13px] font-bold inline-flex items-center justify-center gap-2">{recallIsException ? "Ask about the recall" : "Ask the dealer"}</button>
              <button onClick={back} className="min-h-[44px] px-4 rounded-xl border border-[#E6E8EC] bg-white text-[13px] font-bold text-[#0F172A] inline-flex items-center justify-center gap-2 hover:border-[#2563EB]"><ChevronLeft className="w-4 h-4" /> Back to Vehicle Passport</button>
            </div>
          </section>
        </main>

        {/* Right summary rail */}
        <aside className="mt-6 lg:mt-0 lg:sticky lg:top-6 self-start space-y-4">
          <div className={`${CARD} p-5`}>
            <h2 className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#64748B]">Report summary</h2>
            <p className="text-[15px] font-bold text-[#0F172A] mt-1.5 leading-snug">{report.banner.heading}</p>
            <div className="mt-4 space-y-3">
              <CountRow label="Verified" value={report.verifiedChecks} status="verified" />
              {report.needsAttentionChecks > 0 && <CountRow label="Needs attention" value={report.needsAttentionChecks} status="needs_attention" />}
              {report.needsConfirmationChecks > 0 && <CountRow label="Needs confirmation" value={report.needsConfirmationChecks} status="needs_confirmation" />}
              {report.pendingChecks > 0 && <CountRow label="Pending" value={report.pendingChecks} status="pending" />}
              {report.unavailableChecks > 0 && <CountRow label="Unavailable" value={report.unavailableChecks} status="unavailable" />}
            </div>
            <div className="mt-4 pt-4 border-t border-[#EEF1F4]">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-[13.5px] text-[#475569]"><Database className="w-[18px] h-[18px] text-[#2563EB]" />Data sources</span>
                <span className="text-[18px] font-extrabold tabular-nums text-[#0F172A]">{report.sourceCount}</span>
              </div>
              <button onClick={() => scrollTo("sources")} className="mt-1.5 text-[12.5px] font-semibold text-[#2563EB] hover:underline inline-flex items-center gap-1 print:hidden">View sources <ArrowRight className="w-3.5 h-3.5" /></button>
            </div>
            {lastChecked && <p className="text-[11.5px] text-[#94A3B8] mt-3">Source data last checked {lastChecked}</p>}
            <div className="mt-4 print:hidden"><RailActions /></div>
            {pdfState === "error" && <p className="text-[12px] text-[#DC2626] mt-2 print:hidden">We could not generate the PDF. Please try Print instead.</p>}
          </div>
        </aside>
      </div>

      {methodologyOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4 print:hidden" role="dialog" aria-modal="true" aria-label="How AutoLabels verification works">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMethodologyOpen(false)} />
          <div className="relative bg-white rounded-2xl w-full max-w-lg p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-3"><h2 className="text-lg font-bold">How AutoLabels verification works</h2><button onClick={() => setMethodologyOpen(false)} aria-label="Close" className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center"><X className="w-4 h-4" /></button></div>
            <p className="text-[14px] leading-relaxed text-[#475569]">AutoLabels aggregates records from manufacturer, government, independent history, and dealer sources, then compares them for each check. When sources agree, the check is marked verified with the supporting evidence shown. When they disagree, the check is marked "needs confirmation" so you can resolve it with the dealer. Checks that have not returned a result are shown as pending — never as verified. This is a data-verification report; it aggregates records and does not replace a physical inspection, title search, or dealer confirmation.</p>
            <div className="mt-4 pt-4 border-t border-[#EEF1F4]">
              <h3 className="text-[12.5px] font-bold text-[#0F172A] uppercase tracking-wide">Source provenance</h3>
              <div className="mt-2.5 grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
                {PROVENANCE_ORDER.map((p) => (
                  <div key={p} className="flex items-center gap-2 text-[12.5px] text-[#475569]"><span className="w-1.5 h-1.5 rounded-full bg-[#2563EB]" />{PROVENANCE_LABEL[p]}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <VerificationReportDock
        recallNeedsConfirmation={!!recallNeedsConfirmation}
        onAskRecall={askRecall}
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
