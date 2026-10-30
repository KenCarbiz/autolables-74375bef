import { Link } from "react-router-dom";
import { MetricStrip, Panel, QueryState, StatusText, Td, Th, WorkTable } from "@/components/product";
import { formatDateTime } from "./primitives";
import { priceReviewHref, vinDefenseHref } from "./childLinks";
import { ISSUE_CATEGORY_LABEL, type ComplianceSectionId, type IssueRow, type OverviewCounts, type VehicleIssue } from "./complianceData";

const rank = (r: IssueRow): number => r.critical * 1000 + r.issues.length;

const principal = (r: IssueRow): VehicleIssue =>
  r.issues.find((i) => i.severity === "critical") ?? r.issues[0];

const nextAction = (r: IssueRow, issue: VehicleIssue): { label: string; to: string } => {
  switch (issue.category) {
    case "price":
      return { label: "Review price", to: priceReviewHref(r.vin) };
    case "documents":
      return { label: "Collect documents", to: "/compliance?tab=titles" };
    case "certification":
      return { label: "Open vehicle file", to: `/vehicle-file/${r.vehicleId}?tab=compliance` };
    case "recall":
      return { label: "Resolve recall", to: `/vehicle-file/${r.vehicleId}?tab=compliance` };
    default:
      return { label: "Defend VIN", to: vinDefenseHref(r.vin) };
  }
};

export const OverviewSection = ({
  overview,
  issueRows,
  loading,
  failed = false,
  onNavigate: _onNavigate,
}: {
  overview: OverviewCounts;
  issueRows: IssueRow[];
  loading: boolean;
  failed?: boolean;
  onNavigate: (section: ComplianceSectionId) => void;
}) => {
  const top = [...issueRows].filter((r) => r.issues.length > 0).sort((a, b) => rank(b) - rank(a)).slice(0, 12);
  const n = (v: number) => (failed ? null : v);
  const scope = loading || failed ? undefined : `of ${overview.activeInventory.toLocaleString()} in stock`;
  const status = loading ? "loading" : failed ? "error" : top.length === 0 ? "empty" : "ready";

  return (
    <>
      <MetricStrip
        numberFirst
        label="Compliance summary"
        metrics={[
          { label: "Critical", value: n(overview.critical), hint: scope, tone: overview.critical > 0 ? "danger" : "neutral", loading },
          { label: "Needs review", value: n(overview.needsReview), hint: "Last certification not ready", tone: overview.needsReview > 0 ? "warning" : "neutral", loading },
          { label: "Missing evidence", value: n(overview.missingEvidence), hint: "Title or MCO incomplete", tone: overview.missingEvidence > 0 ? "warning" : "neutral", loading },
          { label: "Audit ready", value: n(overview.auditReady), hint: scope, tone: overview.auditReady > 0 ? "success" : "neutral", loading },
        ]}
      />

      <Panel
        title="Top blockers"
        flush
        inset="sm"
      >
        <QueryState
          status={status}
          errorTitle="Vehicles needing attention are unavailable"
          errorDetail="The compliance read failed, so this list is unknown rather than clear. Retry to try again."
          emptyTitle={overview.activeInventory > 0 ? "No open issues" : "No active inventory"}
          emptyDetail={overview.activeInventory > 0 ? "Every in-stock vehicle is clear of certification, exception, price, document and recall issues." : "Nothing is in stock for this store, so there is nothing to check."}
        >
          <WorkTable caption="Top blockers" minWidth={760}>
            <thead>
              <tr>
                <Th>Vehicle</Th>
                <Th>Principal issue</Th>
                <Th>Checked</Th>
                <Th>Next action</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {top.map((r) => {
                const issue = principal(r);
                const action = nextAction(r, issue);
                return (
                  <tr key={r.vehicleId}>
                    <Td className="whitespace-nowrap" title={r.title}><span className="font-medium">{r.title.split(" ").slice(0, 3).join(" ")}</span> <span className="font-mono text-[12px] text-adm-muted">({r.vin.slice(-8)})</span></Td>
                    <Td className="max-w-[380px] truncate">{ISSUE_CATEGORY_LABEL[issue.category]}: {issue.label}</Td>
                    <Td className="whitespace-nowrap text-adm-muted">{formatDateTime(r.lastCheckedAt)}</Td>
                    <Td><Link to={action.to} className="font-semibold text-adm-primary hover:underline">{action.label}</Link></Td>
                    <Td><StatusText tone={r.critical > 0 ? "danger" : "warning"}>{r.critical > 0 ? "Critical" : "Open"}</StatusText></Td>
                  </tr>
                );
              })}
            </tbody>
          </WorkTable>
        </QueryState>
      </Panel>

      <MetricStrip
        label="Populations measured differently"
        metrics={[
          { label: "Open recalls", value: n(overview.openRecallVehicles), hint: "In-stock vehicles with an NHTSA open recall", loading },
          { label: "Recall review required", value: n(overview.recallReviewTasks), hint: "Service tasks awaiting an outcome", loading },
          { label: "Never certified", value: n(overview.uncertified), hint: "No certification run on record", loading },
        ]}
      />
    </>
  );
};

export default OverviewSection;
