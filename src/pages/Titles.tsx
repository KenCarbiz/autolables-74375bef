import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileText, Loader2, RefreshCw, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import TitleMcoPanel from "@/components/vehicle/TitleMcoPanel";

// /titles — the office/title-clerk workspace. Lists in-stock vehicles that are
// still missing their Title (used) or MCO (new) front+back uploads, and hosts
// the per-vehicle TitleMcoPanel (view docs, email the office the upload link).
// Gated by can_view_compliance in RouteCapabilityGuard.

interface TitleVehicle {
  id: string;
  vin: string;
  ymm: string | null;
  stock_number: string | null;
  condition: string | null;
}

const requiredDocs = (condition: string | null): [string, string] =>
  String(condition || "").toLowerCase() === "new"
    ? ["mco_front", "mco_back"]
    : ["title_front", "title_back"];

const Titles = () => {
  const { tenant } = useTenant();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const [vehicles, setVehicles] = useState<TitleVehicle[]>([]);
  const [docsByVin, setDocsByVin] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [showComplete, setShowComplete] = useState(false);
  const [selectedVin, setSelectedVin] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    if (!tenantId) { setVehicles([]); setDocsByVin({}); setLoading(false); return; }
    setLoading(true);
    try {
      const [{ data: rows }, { data: docs }] = await Promise.all([
        (supabase as any)
          .from("vehicle_listings")
          .select("id, vin, ymm, stock_number, condition")
          .eq("tenant_id", tenantId)
          .order("updated_at", { ascending: false })
          .limit(400),
        (supabase as any)
          .from("vehicle_documents")
          .select("vin, doc_type")
          .eq("tenant_id", tenantId)
          .in("doc_type", ["title_front", "title_back", "mco_front", "mco_back"]),
      ]);
      const byVin: Record<string, Set<string>> = {};
      for (const d of (docs || []) as { vin: string | null; doc_type: string }[]) {
        if (!d.vin) continue;
        const key = d.vin.toUpperCase();
        (byVin[key] ||= new Set()).add(d.doc_type);
      }
      setVehicles(((rows || []) as TitleVehicle[]).filter((v) => !!v.vin));
      setDocsByVin(byVin);
    } catch {
      setVehicles([]);
      setDocsByVin({});
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const withStatus = useMemo(() => vehicles.map((v) => {
    const have = docsByVin[v.vin.toUpperCase()] || new Set<string>();
    const [front, back] = requiredDocs(v.condition);
    const missing = [!have.has(front) && "front", !have.has(back) && "back"].filter(Boolean) as string[];
    return { ...v, missing };
  }), [vehicles, docsByVin]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return withStatus.filter((v) => {
      if (!showComplete && v.missing.length === 0) return false;
      if (!needle) return true;
      return [v.vin, v.ymm, v.stock_number].filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
  }, [withStatus, showComplete, q]);

  const missingCount = withStatus.filter((v) => v.missing.length > 0).length;
  const selected = withStatus.find((v) => v.vin === selectedVin) || null;

  if (!tenantId) return null;

  return (
    <div className="max-w-5xl mx-auto p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-600" />
            <h1 className="text-xl font-semibold tracking-tight font-display text-foreground">Titles &amp; MCOs</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            In-stock vehicles missing the title (used) or MCO (new) upload. Documents are dealer-only and never appear on the public Passport.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-xs font-semibold hover:bg-muted disabled:opacity-60">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm">
        <div className="relative min-w-[220px] flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search VIN, stock #, or vehicle…"
            className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-foreground">
          <input type="checkbox" checked={showComplete} onChange={(e) => setShowComplete(e.target.checked)} />
          Show vehicles with documents on file
        </label>
        <span className="ml-auto text-xs font-semibold text-muted-foreground">{missingCount} missing title/MCO</span>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-premium overflow-hidden">
        {loading ? (
          <p className="px-5 py-10 text-center text-xs text-muted-foreground">Loading vehicles…</p>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">
              {q ? "No vehicles match your search" : "Every in-stock vehicle has its title or MCO on file"}
            </p>
          </div>
        ) : (
          filtered.map((v) => {
            const isNew = String(v.condition || "").toLowerCase() === "new";
            const active = v.vin === selectedVin;
            return (
              <button
                key={v.id}
                onClick={() => setSelectedVin(active ? null : v.vin)}
                className={`w-full text-left px-5 py-3 border-b border-border last:border-0 hover:bg-muted/30 transition-colors ${active ? "bg-blue-50/60" : ""}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{v.ymm || "Vehicle"}</p>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                      <span className="font-mono">{v.vin}</span>
                      {v.stock_number && <span>Stock: {v.stock_number}</span>}
                      <span className="capitalize">{v.condition || "used"}</span>
                    </div>
                  </div>
                  {v.missing.length === 0 ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 flex-shrink-0">
                      <CheckCircle2 className="w-3 h-3" /> On file
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 flex-shrink-0">
                      {isNew ? "MCO" : "Title"} missing {v.missing.join(" + ")}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>

      {selected && (
        <TitleMcoPanel vin={selected.vin} tenantId={tenantId} condition={selected.condition} />
      )}
    </div>
  );
};

export default Titles;
