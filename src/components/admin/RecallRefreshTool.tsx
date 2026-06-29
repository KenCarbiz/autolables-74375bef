import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw, CheckCircle2, Clock } from "lucide-react";

// ──────────────────────────────────────────────────────────────
// RecallRefreshTool — admin surface that lists published listings
// whose recall_check is missing or older than 30 days, and lets
// the admin batch-refresh them by re-invoking nhtsa-recall and
// writing the result back onto vehicle_listings.recall_check.
//
// The publish-gate enforces freshness for NEW publishes; this
// tool is for the backlog of rows that pre-date the gate or have
// aged past the 30-day window.
// ──────────────────────────────────────────────────────────────

interface StaleRow {
  id: string;
  tenant_id: string | null;
  store_id: string | null;
  vin: string;
  ymm: string | null;
  slug: string;
  published_at: string | null;
  recall_checked_at: string | null;
  status: "missing" | "stale" | "fresh";
}

const RecallRefreshTool = () => {
  const [rows, setRows] = useState<StaleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; failures: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("listings_with_stale_recalls", { p_limit: 200 });
    if (error) {
      toast.error("Couldn't load stale-recall worklist");
      setRows([]);
    } else {
      setRows(((data as StaleRow[]) || []).filter((r) => r.status !== "fresh"));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const refreshOne = async (row: StaleRow): Promise<{ ok: boolean; reason?: string }> => {
    try {
      if (!row.tenant_id) return { ok: false, reason: "no tenant on listing" };
      // VIN-based MarketCheck AutoRecalls (with NHTSA fallback), server-side.
      // The function writes recall_check itself, so no client write here.
      const { data, error } = await supabase.functions.invoke("marketcheck-recalls", {
        body: { vin: row.vin, tenant_id: row.tenant_id, force: true },
      });
      if (error) return { ok: false, reason: `marketcheck-recalls: ${error.message || "invoke failed"}` };
      const resp = data as { recallStatus?: string; error?: string } | null;
      if (!resp) return { ok: false, reason: "no data" };
      if (resp.recallStatus === "error") return { ok: false, reason: resp.error || "recall lookup error" };
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: (e as Error)?.message || "unexpected error" };
    }
  };

  const refreshAll = async () => {
    if (rows.length === 0) return;
    setRefreshing(true);
    setProgress({ done: 0, total: rows.length, failures: 0 });
    let done = 0;
    let failures = 0;
    let firstError = "";
    try {
      for (const row of rows) {
        const res = await refreshOne(row);
        done += 1;
        if (!res.ok) {
          failures += 1;
          if (!firstError && res.reason) firstError = res.reason;
          // eslint-disable-next-line no-console
          console.warn("recall refresh failed", row.vin, res.reason);
        }
        setProgress({ done, total: rows.length, failures });
      }
    } finally {
      setRefreshing(false);
    }
    if (failures === 0) toast.success(`Refreshed ${done} listing${done === 1 ? "" : "s"}`);
    else if (failures < rows.length) toast.warning(`Refreshed ${done - failures}/${rows.length} — ${failures} failed. First error: ${firstError}`);
    else toast.error(`All ${rows.length} failed. First error: ${firstError || "unknown"}`);
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-foreground">Recall backfill</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Published listings with a missing or &gt;30-day-old recall check. Re-checks each VIN via MarketCheck AutoRecalls (NHTSA fallback) and clears the backlog.
          </p>
        </div>
        <button
          onClick={refreshAll}
          disabled={refreshing || rows.length === 0}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? `Refreshing ${progress?.done ?? 0}/${progress?.total ?? rows.length}…` : `Refresh all (${rows.length})`}
        </button>
      </div>

      {loading && (
        <p className="text-xs text-muted-foreground">Loading worklist…</p>
      )}

      {!loading && rows.length === 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <p className="text-sm text-emerald-900 font-semibold">All published listings have a fresh recall check.</p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">VIN</th>
                <th className="px-3 py-2 font-semibold">Vehicle</th>
                <th className="px-3 py-2 font-semibold">Checked</th>
                <th className="px-3 py-2 font-semibold">Published</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    {r.status === "missing" ? (
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <AlertTriangle className="w-3 h-3" /> Missing
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-orange-700">
                        <Clock className="w-3 h-3" /> Stale
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.vin}</td>
                  <td className="px-3 py-2">{r.ymm || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.recall_checked_at ? new Date(r.recall_checked_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.published_at ? new Date(r.published_at).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default RecallRefreshTool;
