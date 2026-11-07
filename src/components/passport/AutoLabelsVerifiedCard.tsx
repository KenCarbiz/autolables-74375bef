import { ShieldCheck, ShieldAlert, TriangleAlert, Clock, CircleMinus, CircleCheck, ArrowRight, ChevronRight } from "lucide-react";
import { isSettledCheck, recallHeadline, verificationScopeLine, verificationStatusCounts } from "@/lib/passport/verificationSummary";
import type { VerificationReport, ReportCheck, VerificationStatus } from "@/lib/passport/verificationSummary";


// ──────────────────────────────────────────────────────────────
// AutoLabelsVerifiedCard — Option B "Balanced Status Dashboard".
//
// A self-contained summary of the SAME canonical VerificationReport the full
// report renders: proof up front (one count tile per status, summing to the
// checks in scope) with each non-verified item isolated as one slim, calm row. It derives
// NOTHING of its own — counts, statuses and labels all come from `report`. All
// styling is locally scoped so it can never affect a neighboring section.
//
// Governance: a pending/unavailable check is never shown as verified or as a
// confirmed failure; red is reserved for a confirmed material problem (a
// do-not-drive recall); everything else in need of a look is calm amber (or a
// neutral gray "not available" for missing source data).
// ──────────────────────────────────────────────────────────────

const C = {
  navy: "#0D1B2A", muted: "#71819A", blue: "#2563EB",
  green: "#16A34A", greenBg: "#ECFDF5",
  amber: "#D97706", amberBg: "#FFFBEB", amberBorder: "#FDE68A",
  gray: "#94A3B8", grayBg: "#F8FAFC", grayBorder: "#E2E8F0",
  red: "#DC2626", redBg: "#FEF2F2", redBorder: "#FECACA",
  border: "#DDE4ED",
};

// Short, chip-sized labels for the passed grid + attention rows. The green check
// already communicates "verified" — the word is never repeated after each.
const GRID_LABEL: Record<string, string> = {
  vin: "VIN", history: "Vehicle history", ownership: "Ownership", odometer: "Odometer",
  title: "Title & brand", recall: "Recall status", market: "Market value", warranty: "Warranty",
};
const labelFor = (c: ReportCheck) => GRID_LABEL[c.key] ?? c.name;

const rank = (s: VerificationStatus): number =>
  s === "needs_attention" ? 0 : s === "needs_confirmation" ? 1 : s === "pending" ? 2 : 3;

type Tone = "red" | "amber" | "gray";
const toneOf = (c: ReportCheck): Tone =>
  c.status === "needs_attention" && c.highSeverity ? "red" : c.status === "unavailable" ? "gray" : "amber";

const TONE_STYLE: Record<Tone, { bg: string; border: string; fg: string; Icon: React.ElementType }> = {
  red: { bg: C.redBg, border: C.redBorder, fg: C.red, Icon: ShieldAlert },
  amber: { bg: C.amberBg, border: C.amberBorder, fg: C.amber, Icon: TriangleAlert },
  gray: { bg: C.grayBg, border: C.grayBorder, fg: C.gray, Icon: CircleMinus },
};

// One concise status line per attention item — evidence-derived, never alarmist.
const attentionLine = (c: ReportCheck): string => {
  // Worded from the exact recall outcome: an unavailable lookup is never
  // phrased as an open recall (L01).
  if (c.key === "recall") return recallHeadline(c);
  switch (c.status) {
    case "needs_attention":
      return c.key === "title" ? "Title brand on record" : c.key === "history" ? "Reported accident history" : "Needs attention";
    case "needs_confirmation": return "Needs confirmation";
    case "pending": return "Pending · no result yet";
    case "unavailable": return "Not available · no source data";
    default: return "";
  }
};
// A pending/unavailable item uses a clock/minus glyph over the tone default.
const iconFor = (c: ReportCheck): React.ElementType =>
  c.status === "pending" ? Clock : TONE_STYLE[toneOf(c)].Icon;

interface Props {
  report: VerificationReport;
  onOpenReport: () => void;
  onReview?: (checkKey: string) => void;
  className?: string;
}

const CARD = "bg-white border border-[#E6EAF0] rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

const AutoLabelsVerifiedCard = ({ report, onOpenReport, onReview, className }: Props) => {
  // Every number on this card comes from the canonical status inventory, so
  // the tiles always add up to the checks in scope and match the report.
  // Pending and not-available checks are never counted as "needs review".
  const verified = report.checks.filter((c) => isSettledCheck(c.status));
  const reviewCount = report.needsAttentionChecks + report.needsConfirmationChecks;
  const allVerified = report.totalChecks > 0 && report.verifiedChecks === report.totalChecks;
  const tiles = verificationStatusCounts(report);
  const highSeverity = report.checks.some((c) => c.highSeverity && c.status === "needs_attention");
  const tileColor = (s: VerificationStatus): string =>
    s === "verified" ? C.green
      : s === "dealer_attested" ? "#0F766E"
      : s === "needs_attention" ? (highSeverity ? C.red : C.amber)
      : s === "needs_confirmation" ? C.amber
      : s === "pending" ? C.blue
      : C.gray;

  const attention = report.checks
    .filter((c) => !isSettledCheck(c.status))
    .sort((a, b) => rank(a.status) - rank(b.status));

  const review = onReview ?? (() => onOpenReport());


  return (
    <div className={`${CARD} p-5 ${className ?? ""}`} data-module="verification-card">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="h-10 w-10 grid place-items-center rounded-full shrink-0" style={{ background: report.verifiedChecks > 0 ? C.greenBg : C.grayBg }}>
            <ShieldCheck className="w-[22px] h-[22px]" style={{ color: report.verifiedChecks > 0 ? C.green : C.gray }} />
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-extrabold leading-tight" style={{ color: C.navy }}>Vehicle data verification</div>
            <div className="text-[12px] leading-snug" style={{ color: C.muted }}>{verificationScopeLine(report)}</div>
          </div>
        </div>
        {(allVerified || reviewCount > 0) && (
          <span
            className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold shrink-0"
            style={allVerified ? { background: C.greenBg, color: C.green } : { background: C.amberBg, color: C.amber }}
          >
            {allVerified ? "All verified" : `${reviewCount} to review`}
          </span>
        )}
      </div>

      {/* One tile per status present; the tiles sum to the checks in scope. */}
      <div
        className="mt-3 rounded-2xl border grid"
        style={{ borderColor: C.border, background: "#FCFDFE", gridTemplateColumns: `repeat(${Math.max(1, tiles.length)}, minmax(0, 1fr))` }}
        data-verification-tiles={tiles.map((t) => `${t.status}:${t.count}`).join(",")}
      >
        {tiles.map((t, i) => (
          <div key={t.status} className={`px-2 py-3 text-center ${i > 0 ? "border-l" : ""}`} style={{ borderColor: C.border }}>
            <div className="text-[24px] font-extrabold tabular-nums leading-none" style={{ color: tileColor(t.status) }}>{t.count}</div>
            <div className="text-[11.5px] font-semibold mt-1 leading-tight" style={{ color: C.muted }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* Isolated attention rows */}
      {attention.map((c) => {
        const tone = TONE_STYLE[toneOf(c)];
        const Icon = iconFor(c);
        return (
          <button
            key={c.key}
            onClick={() => review(c.key)}
            className="mt-3 w-full min-h-[44px] rounded-xl border px-3 py-2.5 flex items-center gap-2.5 text-left"
            style={{ background: tone.bg, borderColor: tone.border }}
          >
            <Icon className="w-[20px] h-[20px] shrink-0" style={{ color: tone.fg }} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold leading-tight" style={{ color: C.navy }}>{labelFor(c)}</div>
              <div className="text-[11.5px] leading-tight mt-0.5" style={{ color: C.muted }}>{attentionLine(c)}</div>
            </div>
            <span className="text-[13px] font-bold inline-flex items-center gap-1 shrink-0" style={{ color: C.blue }}>{c.status === "needs_attention" || c.status === "needs_confirmation" ? "Review" : "Details"} <ArrowRight className="w-3.5 h-3.5" /></span>
          </button>
        );
      })}

      {/* Passed-check grid */}
      {verified.length > 0 && (
        <div className="mt-3 rounded-xl border px-3 py-2.5 grid grid-cols-2 max-[340px]:grid-cols-1 gap-x-3 gap-y-2" style={{ borderColor: C.border }}>
          {verified.map((c) => (
            <div key={c.key} className="flex items-center gap-2 min-w-0">
              {c.status === "dealer_attested"
                ? <ShieldCheck className="w-[18px] h-[18px] shrink-0" style={{ color: "#0F766E" }} aria-label="Dealer attested" />
                : <CircleCheck className="w-[18px] h-[18px] shrink-0" style={{ color: C.green }} aria-label="Verified" />}
              <span className="text-[13px] font-semibold truncate" style={{ color: C.navy }}>{c.status === "dealer_attested" && c.key === "title" ? "Title (dealer)" : `${labelFor(c)}${c.status === "dealer_attested" ? " (dealer)" : ""}`}</span>
            </div>
          ))}
        </div>
      )}

      {/* Full-report link */}
      <button onClick={onOpenReport} className="mt-4 w-full inline-flex items-center justify-center gap-1 text-[13px] font-bold" style={{ color: C.blue }}>
        Open Full Verification Report <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
};

export default AutoLabelsVerifiedCard;
