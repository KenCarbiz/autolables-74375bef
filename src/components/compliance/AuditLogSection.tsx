import { useCallback, useEffect, useMemo, useState } from "react";
import { History, RefreshCw, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, Panel, SectionHeading, TableShell, formatDateTime } from "./primitives";

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  user_email: string | null;
  created_at: string;
  content_hash: string | null;
  row_hash: string | null;
  details: Record<string, unknown> | null;
}

const WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

export const AuditLogSection = ({ tenantId }: { tenantId: string | null }) => {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    if (!tenantId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data } = await sb()
        .from("audit_log")
        .select("id, action, entity_type, entity_id, user_email, created_at, content_hash, row_hash, details")
        .eq("store_id", tenantId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500);
      setRows((data as AuditRow[]) || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId, days]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.action, r.entity_type, r.entity_id, r.user_email, JSON.stringify(r.details ?? {})]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [rows, q]);

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Audit log"
        description="The immutable event record for this store. Every entry carries its actor, timestamp, and hash — this is the trail an evidence packet quotes."
        action={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-4 text-al-button text-foreground hover:bg-muted disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        }
      />

      <Panel
        title={`${filtered.length.toLocaleString()} event${filtered.length === 1 ? "" : "s"}`}
        meta={`Most recent 500 events in the last ${days} days.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {WINDOWS.map((w) => (
              <button
                key={w.days}
                type="button"
                onClick={() => setDays(w.days)}
                className={`h-9 rounded-lg border px-3 text-al-meta font-bold ${
                  days === w.days
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card text-foreground hover:bg-muted"
                }`}
              >
                {w.label}
              </button>
            ))}
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search action, entity, user"
                className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-al-body text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        }
      >
        {loading ? (
          <p className="px-4 py-10 text-center text-al-body text-muted-foreground">Loading events…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={History}
            headline={q ? "No events match that search." : "No audit events in this window."}
            body={
              q
                ? "Try a different action name, entity id, or user."
                : "Nothing has been recorded for this store in the selected period. Widen the window to look further back."
            }
          />
        ) : (
          <TableShell headers={["When", "Action", "Entity", "User", "Hash"]}>
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-muted/30">
                <td className="whitespace-nowrap px-4 py-2.5 text-al-meta text-muted-foreground">
                  {formatDateTime(r.created_at)}
                </td>
                <td className="px-4 py-2.5 text-al-body text-foreground">{r.action}</td>
                <td className="px-4 py-2.5">
                  <p className="text-al-meta text-foreground">{r.entity_type}</p>
                  <p className="font-mono text-al-meta text-muted-foreground">{r.entity_id}</p>
                </td>
                <td className="px-4 py-2.5 text-al-meta text-muted-foreground">{r.user_email || "System"}</td>
                <td className="px-4 py-2.5">
                  <code className="font-mono text-al-meta text-muted-foreground">
                    {(r.content_hash || r.row_hash || "").slice(0, 16) || "—"}
                  </code>
                </td>
              </tr>
            ))}
          </TableShell>
        )}
      </Panel>
    </div>
  );
};

export default AuditLogSection;
