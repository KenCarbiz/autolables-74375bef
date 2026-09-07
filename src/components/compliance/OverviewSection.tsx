import { AlertTriangle, ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { CountTile, EmptyState, Panel, SectionHeading, StateBadge, TableShell, formatDateTime } from "./primitives";
import { ISSUE_CATEGORY_LABEL, type ComplianceSectionId, type IssueRow, type OverviewCounts } from "./complianceData";

const rank = (r: IssueRow): number => r.critical * 1000 + r.issues.length;

export const OverviewSection = ({
  overview,
  issueRows,
  loading,
  onNavigate,
  onOpenVin,
}: {
  overview: OverviewCounts;
  issueRows: IssueRow[];
  loading: boolean;
  onNavigate: (section: ComplianceSectionId) => void;
  onOpenVin: (vin: string) => void;
}) => {
  const top = [...issueRows].filter((r) => r.issues.length > 0).sort((a, b) => rank(b) - rank(a)).slice(0, 12);

  return (
    <div className="space-y-5">
      <SectionHeading
        title="What needs attention"
        description={`Four questions about the ${overview.activeInventory.toLocaleString()} vehicles currently in stock. Each tile counts a different population — the sentence under it says exactly which.`}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CountTile
          label="Critical"
          value={overview.critical}
          tone={overview.critical > 0 ? "critical" : "neutral"}
          means="In-stock vehicles carrying at least one critical issue: a failed certification check, a critical exception, an open NHTSA recall, or a live price discrepancy."
          onClick={() => onNavigate("issues")}
        />
        <CountTile
          label="Needs review"
          value={overview.needsReview}
          tone={overview.needsReview > 0 ? "attention" : "neutral"}
          means="In-stock vehicles whose most recent certification run came back not ready. Vehicles never run are counted separately below."
          onClick={() => onNavigate("issues")}
        />
        <CountTile
          label="Missing evidence"
          value={overview.missingEvidence}
          tone={overview.missingEvidence > 0 ? "attention" : "neutral"}
          means="In-stock vehicles without both sides of the required title (used) or MCO (new) on file."
          onClick={() => onNavigate("titles")}
        />
        <CountTile
          label="Audit ready"
          value={overview.auditReady}
          tone={overview.auditReady > 0 ? "clear" : "neutral"}
          means="In-stock vehicles with no open issue, a certification run that cleared, and title or MCO documentation complete."
          onClick={() => onNavigate("vin-defense")}
        />
      </div>

      <Panel
        title="Populations measured differently"
        meta="These answer different questions and are not expected to agree. Each is labelled with what it actually counts."
      >
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <CountTile
            label="Open recalls"
            value={overview.openRecallVehicles}
            means="In-stock vehicles whose record carries a non-zero NHTSA open-recall count from the last check."
          />
          <CountTile
            label="Recall review required"
            value={overview.recallReviewTasks}
            means="Recall service tasks sitting at open_review, awaiting a service outcome. A task can exist after the NHTSA count clears, and a count can exist with no task."
          />
          <CountTile
            label="Never certified"
            value={overview.uncertified}
            means="In-stock vehicles with no certification run on record at all. Not a failure — nothing has been run yet."
          />
        </div>
      </Panel>

      <Panel
        title="Vehicles needing attention"
        meta="One row per VIN. Every open problem on that vehicle is gathered onto its row."
        action={
          <button
            type="button"
            onClick={() => onNavigate("issues")}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-al-meta font-bold text-foreground hover:bg-muted"
          >
            All issues <ArrowRight className="h-3.5 w-3.5" />
          </button>
        }
      >
        {loading ? (
          <p className="px-4 py-10 text-center text-al-body text-muted-foreground">Loading inventory…</p>
        ) : top.length === 0 ? (
          <EmptyState
            icon={overview.activeInventory > 0 ? CheckCircle2 : ShieldCheck}
            tone={overview.activeInventory > 0 ? "clear" : "neutral"}
            headline={overview.activeInventory > 0 ? "No open issues in this category." : "No active inventory"}
            body={
              overview.activeInventory > 0
                ? "Every in-stock vehicle is clear of certification, exception, price, document, and recall issues."
                : "Nothing is in stock for this store, so there is nothing to check."
            }
          />
        ) : (
          <TableShell headers={["Vehicle", "Stock / VIN", "Open issues", "Last checked", ""]}>
            {top.map((r) => (
              <tr key={r.vehicleId} className="hover:bg-muted/30">
                <td className="px-4 py-3">
                  <p className="text-al-card text-foreground">{r.title}</p>
                  {r.critical > 0 && (
                    <span className="mt-1 inline-flex items-center gap-1 text-al-meta font-bold text-destructive">
                      <AlertTriangle className="h-3 w-3" /> {r.critical} critical
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <p className="font-mono text-al-meta text-foreground">{r.stockNumber || "—"}</p>
                  <p className="font-mono text-al-meta text-muted-foreground">{r.vin}</p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex max-w-[420px] flex-wrap gap-1">
                    {r.issues.slice(0, 3).map((i, idx) => (
                      <StateBadge key={`${i.category}-${idx}`} tone={i.severity === "critical" ? "critical" : "attention"}>
                        {ISSUE_CATEGORY_LABEL[i.category]}: {i.label}
                      </StateBadge>
                    ))}
                    {r.issues.length > 3 && <StateBadge tone="neutral">+{r.issues.length - 3} more</StateBadge>}
                  </div>
                </td>
                <td className="px-4 py-3 text-al-meta text-muted-foreground">{formatDateTime(r.lastCheckedAt)}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onOpenVin(r.vin)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-al-meta font-bold text-foreground hover:bg-muted"
                  >
                    Defend VIN
                  </button>
                </td>
              </tr>
            ))}
          </TableShell>
        )}
      </Panel>
    </div>
  );
};

export default OverviewSection;
