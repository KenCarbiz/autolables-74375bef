import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, ExternalLink, Search } from "lucide-react";
import UsedVehicleDocsButton from "@/components/inventory/UsedVehicleDocsButton";
import { useAuth } from "@/contexts/AuthContext";
import { useComplianceIssueOwners } from "@/hooks/useApprovedFields";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useTenantMemberDirectory } from "@/hooks/useTenantMemberDirectory";
import { vehicleIssueKey } from "@/lib/approvedFields/complianceIssueKey";
import { canAssignComplianceOwners, complianceOwnerLabel } from "@/lib/approvedFields/complianceOwners";
import ComplianceOwnerDetail from "./ComplianceOwnerDetail";
import { EmptyState, Panel, SectionHeading, StateBadge, TableShell, formatDateTime } from "./primitives";
import { ISSUE_CATEGORY_LABEL, type IssueCategory, type IssueRow } from "./complianceData";

type Filter = "open" | "critical" | IssueCategory;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "open", label: "All open" },
  { id: "critical", label: "Critical" },
  { id: "certification", label: "Certification" },
  { id: "exception", label: "Exceptions" },
  { id: "price", label: "Price" },
  { id: "documents", label: "Documents" },
  { id: "recall", label: "Recall" },
];

const matches = (row: IssueRow, filter: Filter): boolean => {
  if (row.issues.length === 0) return false;
  if (filter === "open") return true;
  if (filter === "critical") return row.critical > 0;
  return row.issues.some((i) => i.category === filter);
};

export const IssuesSection = ({ rows, loading }: { rows: IssueRow[]; loading: boolean }) => {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [openOwner, setOpenOwner] = useState<string | null>(null);
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const { owners } = useComplianceIssueOwners();
  const { nameOf } = useTenantMemberDirectory();
  const canAssign = canAssignComplianceOwners(member?.role ?? "", isAdmin);
  const ownerFor = (vehicleId: string) =>
    owners?.status === "available" ? owners.data.get(vehicleIssueKey(vehicleId)) ?? null : null;

  const counts = useMemo(() => {
    const out = {} as Record<Filter, number>;
    for (const f of FILTERS) out[f.id] = rows.filter((r) => matches(r, f.id)).length;
    return out;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => matches(r, filter))
      .filter((r) =>
        !needle || [r.title, r.vin, r.stockNumber].filter(Boolean).join(" ").toLowerCase().includes(needle),
      )
      .sort((a, b) => b.critical - a.critical || b.issues.length - a.issues.length);
  }, [rows, filter, q]);

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Issues"
        description="Every unresolved problem across active inventory, one row per VIN. A vehicle with six open findings is one thing to work, not six."
      />

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[12px] leading-[18px] font-semibold transition-colors ${
              filter === f.id
                ? "border-adm-primary bg-adm-selected text-adm-primary"
                : "border-adm-border bg-adm-surface text-adm-ink hover:bg-adm-workspace"
            }`}
          >
            {f.label}
            <span className="tabular-nums opacity-70">{loading ? "–" : counts[f.id] ?? 0}</span>
          </button>
        ))}
      </div>

      <Panel
        title={`${filtered.length.toLocaleString()} vehicle${filtered.length === 1 ? "" : "s"}`}
        meta="Counts are vehicles, not findings."
        action={
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-adm-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search vehicle, stock, VIN"
              className="h-9 w-full rounded-lg border border-adm-border bg-adm-surface pl-9 pr-3 text-[14px] leading-[20px] text-adm-ink outline-none focus:ring-2 focus:ring-adm-primary"
            />
          </div>
        }
      >
        {loading ? (
          <p className="px-4 py-10 text-center text-[14px] leading-[20px] text-adm-muted">Loading issues…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            tone={q ? "neutral" : "clear"}
            headline={q ? "No vehicles match that search." : "No open issues in this category."}
            body={
              q
                ? "Try a different stock number, VIN, or vehicle name."
                : "Nothing in active inventory has an unresolved finding in this filter."
            }
          />
        ) : (
          <TableShell headers={["Vehicle", "Stock / VIN", "Open issues", "Owner", "Certification", "Last checked", "Action"]}>
            {filtered.map((r) => (
              <Fragment key={r.vehicleId}>
              <tr className="align-top hover:bg-adm-workspace">
                <td className="px-4 py-3">
                  <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{r.title}</p>
                  <p className="mt-0.5 text-[12px] leading-[18px] text-adm-muted">
                    {r.issues.length} open finding{r.issues.length === 1 ? "" : "s"}
                    {r.critical > 0 ? ` · ${r.critical} critical` : ""}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <p className="font-mono text-[12px] leading-[18px] text-adm-ink">{r.stockNumber || "—"}</p>
                  <p className="font-mono text-[12px] leading-[18px] text-adm-muted">{r.vin}</p>
                </td>
                <td className="px-4 py-3">
                  <ul className="max-w-[460px] space-y-1.5">
                    {r.issues.map((i, idx) => (
                      <li key={`${i.category}-${idx}`}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StateBadge tone={i.severity === "critical" ? "critical" : "attention"}>
                            {ISSUE_CATEGORY_LABEL[i.category]}
                          </StateBadge>
                          <span className="text-[14px] leading-[20px] text-adm-ink">{i.label}</span>
                        </div>
                        <p className="mt-0.5 text-[12px] leading-[18px] text-adm-muted">{i.detail}</p>
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="max-w-[180px] px-4 py-3">
                  {(() => {
                    const label = complianceOwnerLabel(ownerFor(r.vehicleId), nameOf);
                    return (
                      <button
                        type="button"
                        aria-expanded={openOwner === r.vehicleId}
                        onClick={() => setOpenOwner(openOwner === r.vehicleId ? null : r.vehicleId)}
                        title={label}
                        className="block w-full truncate text-left text-[14px] leading-[20px] text-adm-ink hover:underline"
                      >
                        {label}
                      </button>
                    );
                  })()}
                </td>
                <td className="px-4 py-3">
                  {r.certificationReady === null ? (
                    <StateBadge tone="neutral">Never run</StateBadge>
                  ) : r.certificationReady ? (
                    <StateBadge tone="clear">Cleared</StateBadge>
                  ) : (
                    <StateBadge tone="attention">Not ready</StateBadge>
                  )}
                  <p className="mt-1 text-[12px] leading-[18px] text-adm-muted">{formatDateTime(r.certifiedAt)}</p>
                </td>
                <td className="px-4 py-3 text-[12px] leading-[18px] text-adm-muted">{formatDateTime(r.lastCheckedAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap justify-end gap-2">
                    <UsedVehicleDocsButton vehicleId={r.vehicleId} vin={r.vin} condition={r.condition} />
                    <button
                      type="button"
                      onClick={() => navigate(`/vehicle-file/${r.vehicleId}`)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-adm-border px-2.5 text-[12px] leading-[18px] font-semibold text-adm-ink hover:bg-adm-workspace"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Open
                    </button>
                  </div>
                </td>
              </tr>
              {openOwner === r.vehicleId && (
                <tr className="bg-adm-workspace/60">
                  <td colSpan={7}>
                    <ComplianceOwnerDetail issueKey={vehicleIssueKey(r.vehicleId)} canAssign={canAssign} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </TableShell>
        )}
      </Panel>
    </div>
  );
};

export default IssuesSection;
