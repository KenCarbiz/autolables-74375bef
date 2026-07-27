import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle, ExternalLink, Loader2, RefreshCw, Radar, Search,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasWindowStickerPermission } from "@/lib/permissions/windowStickerPermissions";
import { useWindowSticker } from "@/hooks/useWindowSticker";
import {
  buildIntelligenceRow, STAGE_TONE, type PipelineStage, type VehicleIntelligenceRow,
} from "@/lib/documents/inventoryIntelligence";
import { DOCUMENT_FAMILIES, DOCUMENT_FAMILY_IDS, familyForDocumentType } from "@/lib/documents/families";

// Inventory Intelligence — what the ingest pipeline actually did to each
// vehicle, per document family.
//
// The rule this screen exists to honour: a vehicle can hold an approved
// Buyers Guide and a blocked OEM reproduction at the same time. There is
// no combined score anywhere on this page, because a combined score would
// hide exactly the case a dealer needs to act on.

const TONE_CLASS: Record<string, string> = {
  good: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-700",
  bad: "bg-rose-50 text-rose-700",
  info: "bg-blue-50 text-blue-700",
  muted: "bg-slate-100 text-slate-500",
};

const Stage = ({ stage }: { stage: PipelineStage }) => (
  <span className={`inline-flex text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap ${TONE_CLASS[STAGE_TONE[stage]]}`}>
    {stage}
  </span>
);

interface Vehicle {
  id: string;
  vin: string | null;
  ymm: string | null;
  condition: string | null;
  status: string | null;
  updated_at: string | null;
  mc_attributes: Record<string, unknown> | null;
}

interface StickerRecord {
  vehicle_id: string;
  generation_status: string;
  review_required: boolean;
  review_reason: string | null;
  updated_at: string | null;
}

interface DocRow {
  vehicle_id: string;
  document_type: string;
  document_status: string;
  version: number;
}

interface Row {
  vehicle: Vehicle;
  intel: VehicleIntelligenceRow;
}

const fmtWhen = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

export default function InventoryIntelligence() {
  const { tenant } = useTenant();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const canRegenerate = hasWindowStickerPermission(member?.role, "window_sticker.regenerate", isAdmin);
  const { generate, busy } = useWindowSticker();

  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [working, setWorking] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setError(null);
    try {
      // deno-lint-ignore no-explicit-any
      const { data: vehicles, error: vErr } = await (supabase as any)
        .from("vehicle_listings")
        .select("id, vin, ymm, condition, status, updated_at, mc_attributes")
        .eq("tenant_id", tenantId)
        .order("updated_at", { ascending: false })
        .limit(150);
      if (vErr) throw vErr;
      const list = (vehicles || []) as Vehicle[];
      const ids = list.map((v) => v.id);

      // deno-lint-ignore no-explicit-any
      const { data: records } = ids.length ? await (supabase as any)
        .from("factory_sticker_records")
        .select("vehicle_id, generation_status, review_required, review_reason, updated_at")
        .eq("tenant_id", tenantId).in("vehicle_id", ids) : { data: [] };
      const byVehicle = new Map(((records || []) as StickerRecord[]).map((r) => [r.vehicle_id, r]));

      // deno-lint-ignore no-explicit-any
      const { data: docs } = ids.length ? await (supabase as any)
        .from("generated_documents")
        .select("vehicle_id, document_type, document_status, version")
        .eq("tenant_id", tenantId).in("vehicle_id", ids) : { data: [] };
      const docsByVehicle = new Map<string, DocRow[]>();
      for (const d of (docs || []) as DocRow[]) {
        docsByVehicle.set(d.vehicle_id, [...(docsByVehicle.get(d.vehicle_id) || []), d]);
      }

      setRows(list.map((vehicle) => {
        const mc = (vehicle.mc_attributes || {}) as Record<string, unknown>;
        const rec = byVehicle.get(vehicle.id);
        const statuses: Record<string, string | null> = {};
        for (const d of docsByVehicle.get(vehicle.id) || []) {
          const family = familyForDocumentType(d.document_type, vehicle.condition);
          if (!family) continue;
          // Newest version wins.
          statuses[family.id] = d.document_status;
        }
        return {
          vehicle,
          intel: buildIntelligenceRow({
            condition: vehicle.condition,
            imported: true,
            hasStoredSourceData: Object.keys(mc).length > 0,
            hasBuildSheet: !!mc.build_sheet,
            oemRecordStatus: rec?.generation_status ?? null,
            oemReviewReason: rec?.review_reason ?? null,
            documentStatuses: statuses,
          }),
        };
      }));
    } catch (e) {
      setError(String((e as Error).message || e));
      setRows([]);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const term = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyBlocked && !r.intel.blocker) return false;
      if (!term) return true;
      return `${r.vehicle.vin ?? ""} ${r.vehicle.ymm ?? ""}`.toLowerCase().includes(term);
    });
  }, [rows, query, onlyBlocked]);

  const processVin = async (vehicleId: string) => {
    if (!tenantId) return;
    setWorking(vehicleId);
    try {
      await generate(tenantId, vehicleId);
      toast.success("Processed — the pipeline state below is refreshed.");
      await load();
    } catch (e) {
      toast.error(`Couldn't process that vehicle: ${String((e as Error).message || e)}`);
    } finally {
      setWorking(null);
    }
  };

  if (!tenantId) {
    return <div className="p-4 md:p-6"><p className="text-sm text-muted-foreground">Select a dealership to view inventory intelligence.</p></div>;
  }

  const blockedCount = rows?.filter((r) => r.intel.blocker).length ?? 0;

  return (
    <div className="p-4 md:p-6">
      <div className="max-w-[1600px] mx-auto space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-bold text-foreground inline-flex items-center gap-2">
              <Radar className="w-5 h-5 text-blue-600" /> Inventory Intelligence
            </h1>
            <p className="text-[12.5px] text-muted-foreground mt-0.5">
              What the ingest pipeline did to each vehicle, per document family. No combined score — a vehicle can be
              approved on one document and blocked on another.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-[13px] font-semibold hover:bg-muted/40"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="VIN, year, make or model"
                className="w-full h-9 pl-8 pr-3 rounded-md border border-border bg-background text-[13px]"
                aria-label="Filter inventory"
              />
            </div>
            <label className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-foreground">
              <input type="checkbox" checked={onlyBlocked} onChange={(e) => setOnlyBlocked(e.target.checked)} />
              Needs attention only{blockedCount ? ` (${blockedCount})` : ""}
            </label>
          </div>

          {error && (
            <p className="text-[12px] text-rose-600 inline-flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> Couldn't load inventory: {error}
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3 font-semibold">Vehicle</th>
                  <th className="py-2 pr-3 font-semibold">Source data</th>
                  {DOCUMENT_FAMILY_IDS.map((id) => (
                    <th key={id} className="py-2 pr-3 font-semibold whitespace-nowrap">
                      {DOCUMENT_FAMILIES[id].adminTitle}
                    </th>
                  ))}
                  <th className="py-2 pr-3 font-semibold">Blocker</th>
                  <th className="py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered === null && (
                  <tr><td colSpan={9} className="py-3 text-muted-foreground">Loading inventory…</td></tr>
                )}
                {filtered?.length === 0 && (
                  <tr><td colSpan={9} className="py-3 text-muted-foreground">No vehicles match.</td></tr>
                )}
                {filtered?.map(({ vehicle, intel }) => (
                  <tr key={vehicle.id} className="align-top">
                    <td className="py-2.5 pr-3">
                      <span className="block font-semibold text-foreground">{vehicle.ymm || "Vehicle"}</span>
                      <span className="block text-[11px] font-mono text-muted-foreground">{vehicle.vin || "no VIN"}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {intel.conditionClass} · refreshed {fmtWhen(vehicle.updated_at)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3"><Stage stage={intel.sourceStage} /></td>
                    {DOCUMENT_FAMILY_IDS.map((id) => {
                      const f = intel.families.find((x) => x.family === id);
                      return (
                        <td key={id} className="py-2.5 pr-3">
                          {f ? <Stage stage={f.stage} /> : null}
                        </td>
                      );
                    })}
                    <td className="py-2.5 pr-3 max-w-[260px]">
                      {intel.blocker
                        ? <span className="text-[11.5px] text-amber-700">{intel.blocker}</span>
                        : <span className="text-[11.5px] text-muted-foreground">—</span>}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Link
                          to={`/vehicle-file/${vehicle.id}`}
                          className="h-7 px-2 rounded border border-border text-[11.5px] font-semibold hover:bg-muted/40 inline-flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" /> File
                        </Link>
                        {canRegenerate && (
                          <button
                            type="button"
                            onClick={() => processVin(vehicle.id)}
                            disabled={busy || working === vehicle.id}
                            className="h-7 px-2 rounded border border-border text-[11.5px] font-semibold hover:bg-muted/40 inline-flex items-center gap-1 disabled:opacity-50"
                          >
                            {working === vehicle.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <RefreshCw className="w-3 h-3" />}
                            Process
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
