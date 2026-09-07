import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, ExternalLink, Search } from "lucide-react";
import UsedVehicleDocsButton from "@/components/inventory/UsedVehicleDocsButton";
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
            className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-al-meta font-bold transition-colors ${
              filter === f.id
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-foreground hover:bg-muted"
            }`}
          >
            {f.label}
            <span className="tabular-nums opacity-70">{counts[f.id] ?? 0}</span>
          </button>
        ))}
      </div>

      <Panel
        title={`${filtered.length.toLocaleString()} vehicle${filtered.length === 1 ? "" : "s"}`}
        meta="Counts are vehicles, not findings."
        action={
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search vehicle, stock, VIN"
              className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-al-body text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        }
      >
        {loading ? (
          <p className="px-4 py-10 text-center text-al-body text-muted-foreground">Loading issues…</p>
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
          <TableShell headers={["Vehicle", "Stock / VIN", "Open issues", "Certification", "Last checked", "Action"]}>
            {filtered.map((r) => (
              <tr key={r.vehicleId} className="align-top hover:bg-muted/30">
                <td className="px-4 py-3">
                  <p className="text-al-card text-foreground">{r.title}</p>
                  <p className="mt-0.5 text-al-meta text-muted-foreground">
                    {r.issues.length} open finding{r.issues.length === 1 ? "" : "s"}
                    {r.critical > 0 ? ` · ${r.critical} critical` : ""}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <p className="font-mono text-al-meta text-foreground">{r.stockNumber || "—"}</p>
                  <p className="font-mono text-al-meta text-muted-foreground">{r.vin}</p>
                </td>
                <td className="px-4 py-3">
                  <ul className="max-w-[460px] space-y-1.5">
                    {r.issues.map((i, idx) => (
                      <li key={`${i.category}-${idx}`}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StateBadge tone={i.severity === "critical" ? "critical" : "attention"}>
                            {ISSUE_CATEGORY_LABEL[i.category]}
                          </StateBadge>
                          <span className="text-al-body text-foreground">{i.label}</span>
                        </div>
                        <p className="mt-0.5 text-al-meta text-muted-foreground">{i.detail}</p>
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="px-4 py-3">
                  {r.certificationReady === null ? (
                    <StateBadge tone="neutral">Never run</StateBadge>
                  ) : r.certificationReady ? (
                    <StateBadge tone="clear">Cleared</StateBadge>
                  ) : (
                    <StateBadge tone="attention">Not ready</StateBadge>
                  )}
                  <p className="mt-1 text-al-meta text-muted-foreground">{formatDateTime(r.certifiedAt)}</p>
                </td>
                <td className="px-4 py-3 text-al-meta text-muted-foreground">{formatDateTime(r.lastCheckedAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap justify-end gap-2">
                    <UsedVehicleDocsButton vehicleId={r.vehicleId} vin={r.vin} condition={r.condition} />
                    <button
                      type="button"
                      onClick={() => navigate(`/vehicle-file/${r.vehicleId}`)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-al-meta font-bold text-foreground hover:bg-muted"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Open
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </TableShell>
        )}
      </Panel>
    </div>
  );
};

export default IssuesSection;
