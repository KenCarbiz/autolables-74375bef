import { Link } from "react-router-dom";
import { useTenant } from "@/contexts/TenantContext";
import { useVehicleFiles } from "@/hooks/useVehicleFiles";
import { useViewFixture } from "@/lib/admin/dataSource";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";
import { Al97Frame, Banner, Card, KeyVals, Metrics, Savebar, useFixtureCopy, type MetricItem } from "@/components/admin/al97/al97ui";

// Review legacy store assignments. A preview of how unassigned vehicle files
// would gain a store, built only from saved records: nothing is assigned,
// nothing is guessed and no provider is called. Applying a plan needs a
// server writer that does not exist and the owner's approval of the exact plan.

export interface AssignmentSet { id: string; set: string; candidate: string; evidence: string; outcome: { label: string; tone: string } }

export interface LegacyAssignmentsFixture {
  account: string;
  store: string | null;
  tenantTotal: number | null;
  sets: AssignmentSet[];
  /** Checklist items a reviewer has recorded as done. */
  reviewed: string[];
}

const CHECKLIST = ["Store identity validated", "Tenant boundary checked", "Every proposed association inspected", "Snapshot and rollback tested locally", "Owner approves exact plan"];
const SIGNED: AssignmentSet = { id: "signed", set: "Signed history", candidate: "Original seller retained", evidence: "Signed legal identity", outcome: { label: "Never rewritten", tone: "neutral" } };
const APPLY_REASON = "No server writer applies store assignments yet, and the exact plan needs the owner's approval.";

export function LegacyAssignmentsScreen({ account, store, tenantTotal, sets, reviewed, unassigned = null }: LegacyAssignmentsFixture & { unassigned?: number | null }) {
  const copy = useFixtureCopy();
  const items: MetricItem[] = [
    { label: "Tenant files", value: tenantTotal == null ? "Unknown" : tenantTotal.toLocaleString(), sub: tenantTotal == null ? "Read failed" : "Starting population", icon: "file", known: tenantTotal != null },
    { label: "Auto-assigned", value: "0", sub: "No guessing", icon: "shield" },
    { label: "Ambiguous", value: "Review", sub: "Do not infer from current tab", icon: "warning" },
    { label: "Paid calls", value: "0", sub: "Saved evidence only", icon: "database" },
  ];
  const main = (
    <div className="work">
      <Banner tone="blue" icon="info" title="No production assignments will change from this preview" detail="Use exact evidence. Ambiguous records remain unassigned for a person to resolve." />
      <Metrics label="Assignment review summary" items={items} />
      <Card id="la-evidence" title="Assignment evidence" description={copy("assign.note", `Candidate stores are not computed yet${unassigned != null ? `; ${unassigned.toLocaleString()} files have no store` : ""}. Nothing here is an eligible count.`)}>
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Record set</th><th scope="col">Candidate store</th><th scope="col">Evidence</th><th scope="col">Outcome</th></tr></thead>
            <tbody>{sets.map((r) => <tr key={r.id}><td>{r.set}</td><td>{r.candidate}</td><td>{r.evidence}</td><td><span className={`chip ${r.outcome.tone}`}>{r.outcome.label}</span></td></tr>)}</tbody>
          </table>
        </div>
      </Card>
      <div className="split">
        <div><div>
          <Card id="la-bounds" title="Impact boundaries">
            <KeyVals rows={[["Changed", "Ownership association only"], ["Preserved", "Record IDs / docs / hashes / public routes"], ["Excluded", "Other tenants and ambiguous episodes"], ["Rollback", "Exact before-images, guarded by later edits"]]} />
          </Card>
        </div></div>
        <div><div>
          <Card id="la-checklist" title="Review checklist">
            <ul className="checklist">
              {CHECKLIST.map((c) => {
                const done = reviewed.includes(c);
                return <li key={c}><span className="sr-only">{done ? "Done: " : "Not done: "}</span>{`${done ? "✓" : "□"} ${c}`}</li>;
              })}
            </ul>
          </Card>
        </div></div>
      </div>
      <Savebar title="Not approved" detail="A new reader must not hide unassigned records while migration is pending."
        action={<><span id="la-apply-reason" className="sr-only">{APPLY_REASON}</span><button type="button" className="btn primary" disabled title={APPLY_REASON} aria-describedby="la-apply-reason">Apply assignments</button></>} />
    </div>
  );
  return (
    <Al97Frame section="brand" trail={[{ label: "Dealership & Brand", to: adminTabHref("identity") }]} crumb="Review legacy store assignments" title="Review legacy store assignments" subtitle="Resolve existing ownership before changing store-scoped readers." scopeLabel={{ account, store }} main={main}>
      <p className="mt-4 text-[13px] text-adm-muted">Each file stays readable on <Link to={ADMIN_CHILD_ROUTES.vehicleFiles} className="font-semibold text-adm-primary hover:underline">Vehicle files</Link>.</p>
    </Al97Frame>
  );
}

function LiveLegacyAssignments() {
  const { tenant, currentStore } = useTenant();
  const { stats, isError } = useVehicleFiles(currentStore?.id ?? "");
  const unassigned = isError ? null : stats.unassigned;
  const sets: AssignmentSet[] = [
    { id: "unassigned", set: unassigned == null ? "Unassigned files" : `Unassigned files (${unassigned.toLocaleString()})`, candidate: "Unresolved", evidence: "No exact evidence computed yet", outcome: { label: "Manual review", tone: "amber" } },
    SIGNED,
  ];
  return <LegacyAssignmentsScreen account={tenant?.name ?? "This account"} store={currentStore?.name ?? null} tenantTotal={isError ? null : stats.tenantTotal} sets={sets} reviewed={[]} unassigned={unassigned} />;
}

export default function LegacyAssignmentsPage() {
  const fx = useViewFixture<LegacyAssignmentsFixture>("al97-assignments");
  return fx ? <LegacyAssignmentsScreen {...fx} /> : <LiveLegacyAssignments />;
}
