import { useMemo, useState } from "react";
import { CheckCircle2, Search } from "lucide-react";
import TitleMcoPanel from "@/components/vehicle/TitleMcoPanel";
import { CountTile, EmptyState, Panel, RowAction, SectionHeading, StateBadge, TableShell, formatDate } from "./primitives";
import { TITLE_STATE_LABEL, type TitleRow } from "./complianceData";

export const TitlesSection = ({
  rows,
  loading,
  tenantId,
}: {
  rows: TitleRow[];
  loading: boolean;
  tenantId: string | null;
}) => {
  const [q, setQ] = useState("");
  const [showComplete, setShowComplete] = useState(false);
  const [openVin, setOpenVin] = useState<string | null>(null);

  const outstanding = useMemo(() => rows.filter((r) => r.state !== "on_file"), [rows]);
  const aged = outstanding.filter((r) => (r.ageDays ?? 0) >= 30).length;
  const owner = rows.find((r) => r.owner)?.owner ?? null;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (showComplete ? rows : outstanding)
      .filter((r) => !needle || [r.title, r.vin, r.stockNumber].filter(Boolean).join(" ").toLowerCase().includes(needle))
      .sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0));
  }, [rows, outstanding, showComplete, q]);

  const selected = rows.find((r) => r.vin === openVin) ?? null;

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Titles & MCO"
        description="Ownership documents on in-stock vehicles: the title front and back for a used car, the Manufacturer's Certificate of Origin for a new one. Files are dealer-only and never reach the customer packet."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <CountTile
          label="Outstanding"
          value={outstanding.length}
          tone={outstanding.length > 0 ? "attention" : "clear"}
          means="In-stock vehicles missing one or both sides of the required document."
        />
        <CountTile
          label="Over 30 days"
          value={aged}
          tone={aged > 0 ? "critical" : "neutral"}
          means="Outstanding vehicles that have been in stock 30 days or more without their document on file."
        />
        <CountTile
          label="Owner"
          value={owner ? "Assigned" : "Unassigned"}
          means={
            owner
              ? `Title requests route to ${owner}, set as the title clerk in Settings.`
              : "No title clerk email is configured, so no one owns these requests yet."
          }
        />
      </div>

      <Panel
        title={`${filtered.length.toLocaleString()} vehicle${filtered.length === 1 ? "" : "s"}`}
        action={
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-al-meta font-bold text-foreground">
              <input
                type="checkbox"
                checked={showComplete}
                onChange={(e) => setShowComplete(e.target.checked)}
                className="h-3.5 w-3.5 accent-foreground"
              />
              Include vehicles with documents on file
            </label>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search vehicle, stock, VIN"
                className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-al-body text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        }
      >
        {loading ? (
          <p className="px-4 py-10 text-center text-al-body text-muted-foreground">Loading vehicles…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            tone={q ? "neutral" : "clear"}
            headline={q ? "No vehicles match that search." : "Every in-stock vehicle has required title/MCO documentation."}
            body={
              q
                ? "Try a different stock number, VIN, or vehicle name."
                : "Nothing is outstanding. Tick the box above to review the documents already on file."
            }
          />
        ) : (
          <TableShell headers={["Vehicle", "Requirement", "Current state", "Age", "Owner", "Action"]}>
            {filtered.map((r) => (
              <tr key={r.vehicleId} className="hover:bg-muted/30">
                <td className="px-4 py-3">
                  <p className="text-al-card text-foreground">{r.title}</p>
                  <p className="font-mono text-al-meta text-muted-foreground">{r.stockNumber || r.vin}</p>
                </td>
                <td className="px-4 py-3 text-al-body text-foreground">{r.requirement.label}</td>
                <td className="px-4 py-3">
                  <StateBadge tone={r.state === "on_file" ? "clear" : r.state === "not_received" ? "attention" : "neutral"}>
                    {TITLE_STATE_LABEL[r.state]}
                  </StateBadge>
                  {r.receivedAt && (
                    <p className="mt-1 text-al-meta text-muted-foreground">Last upload {formatDate(r.receivedAt)}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-al-body tabular-nums text-foreground">
                  {r.ageDays == null ? "—" : `${r.ageDays}d`}
                  <span className="ml-1 text-al-meta text-muted-foreground">in stock</span>
                </td>
                <td className="px-4 py-3 text-al-meta text-muted-foreground">
                  {r.owner || "No title clerk configured"}
                </td>
                <td className="px-4 py-3 text-right">
                  <RowAction onClick={() => setOpenVin(r.vin === openVin ? null : r.vin)}>
                    {r.vin === openVin ? "Close" : "Open documents"}
                  </RowAction>
                </td>
              </tr>
            ))}
          </TableShell>
        )}
      </Panel>

      {selected && <TitleMcoPanel vin={selected.vin} tenantId={tenantId} condition={selected.condition} />}
    </div>
  );
};

export default TitlesSection;
