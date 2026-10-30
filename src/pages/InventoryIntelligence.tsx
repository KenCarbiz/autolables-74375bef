import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Search,
} from "lucide-react";
import { downloadCsv } from "@/lib/csvExport";
import { vehicleStockNumber } from "@/lib/vehicleStockNumber";
import { PageBody, PageHeader, Panel, WorkTable, Th, Td, Button, StatusText, InlineNote, QueryState, type Tone } from "@/components/product";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
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

const STAGE_TONE_MAP: Record<string, Tone> = {
  good: "success", warn: "warning", bad: "danger", info: "info", muted: "neutral",
};

// Compact status text: unknown and not-applicable stay distinct words, not
// repeated bright badges.
const Stage = ({ stage }: { stage: PipelineStage }) =>
  stage === "Not Applicable"
    ? <span className="text-adm-muted" aria-label="Not applicable">-</span>
    : <StatusText tone={STAGE_TONE_MAP[STAGE_TONE[stage]] ?? "neutral"} className="whitespace-nowrap">{stage === "Enrichment Pending" ? "Pending" : stage}</StatusText>;

const FAMILY_SHORT: Record<string, string> = {
  "OEM Window Sticker": "OEM sticker",
  "New Vehicle Addendum": "New addendum",
  "Used Vehicle Addendum": "Used addendum",
  "FTC Buyers Guide": "Buyers Guide",
  "Used Car Window Sticker": "Used sticker",
};

interface Vehicle {
  id: string;
  vin: string | null;
  ymm: string | null;
  condition: string | null;
  status: string | null;
  updated_at: string | null;
  mc_attributes: Record<string, unknown> | null;
  sticker_snapshot?: Record<string, unknown> | null;
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
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;

  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [condition, setCondition] = useState("all");

  const load = useCallback(async () => {
    if (!tenantId) return;
    setError(null);
    try {
      // deno-lint-ignore no-explicit-any
      const { data: vehicles, error: vErr } = await (supabase as any)
        .from("vehicle_listings")
        .select("id, vin, ymm, condition, status, updated_at, mc_attributes, sticker_snapshot")
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
      if (condition !== "all" && r.vehicle.condition !== condition) return false;
      if (!term) return true;
      return `${r.vehicle.vin ?? ""} ${r.vehicle.ymm ?? ""}`.toLowerCase().includes(term);
    });
  }, [rows, query, onlyBlocked, condition]);

  const exportCsv = () => {
    if (!filtered) return;
    const head = ["Stock #", "Vehicle", "VIN", "Source data", ...DOCUMENT_FAMILY_IDS.map((id) => DOCUMENT_FAMILIES[id].adminTitle), "Blocker"];
    const body = filtered.map(({ vehicle, intel }) => [
      vehicleStockNumber(vehicle) ?? "",
      vehicle.ymm ?? "",
      vehicle.vin ?? "",
      intel.sourceStage,
      ...DOCUMENT_FAMILY_IDS.map((id) => intel.families.find((x) => x.family === id)?.stage ?? ""),
      intel.blocker ?? "",
    ]);
    downloadCsv("inventory-intelligence.csv", [head, ...body]);
  };

  if (!tenantId) {
    return (
      <PageBody>
        <PageHeader title="Inventory Intelligence" description="What the ingest pipeline did to each vehicle, per document family." />
        <InlineNote tone="info" title="Select a dealership">Inventory intelligence is shown for one dealership at a time.</InlineNote>
      </PageBody>
    );
  }

  const blockedCount = rows?.filter((r) => r.intel.blocker).length ?? 0;

  return (
    <PageBody width="wide">
      <PageHeader
        title="Inventory Intelligence"
        description="Document status and source data for each vehicle."
        actions={
          <>
            <Button onClick={load}>Refresh</Button>
            <Button variant="primary" onClick={exportCsv} disabled={!filtered || filtered.length === 0}>Export</Button>
          </>
        }
      />

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-adm-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="VIN, year, make or model"
            className="w-full min-h-[36px] pl-8 pr-3 rounded-md border border-adm-border bg-adm-surface text-[14px]"
            aria-label="Filter inventory"
          />
        </div>
        <select
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          aria-label="Filter by condition"
          className="min-h-[36px] rounded-md border border-adm-border bg-adm-surface px-3 text-[14px]"
        >
          <option value="all">All conditions</option>
          <option value="new">New</option>
          <option value="used">Used</option>
          <option value="cpo">Certified</option>
        </select>
        <select
          value={onlyBlocked ? "attention" : "all"}
          onChange={(e) => setOnlyBlocked(e.target.value === "attention")}
          aria-label="Filter by status"
          className="min-h-[36px] rounded-md border border-adm-border bg-adm-surface px-3 text-[14px]"
        >
          <option value="all">All statuses</option>
          <option value="attention">{`Needs attention${blockedCount ? ` (${blockedCount})` : ""}`}</option>
        </select>
      </div>

      {error && (
        <InlineNote tone="danger" title="Could not load inventory" action={<Button size="sm" onClick={load}>Retry</Button>}>{error}</InlineNote>
      )}

      <Panel flush>
        <QueryState
          status={filtered === null ? "loading" : error ? "error" : filtered.length === 0 ? "empty" : "ready"}
          errorTitle="Inventory intelligence could not be read."
          onRetry={load}
          emptyTitle="No vehicles match"
          emptyDetail="Clear the search or the attention filter to widen the list."
        >
          <WorkTable className="[&_th]:px-2 [&_td]:px-2 [&_td]:py-2.5" caption="Document pipeline by vehicle and family" minWidth={960}>
            <thead>
              <tr>
                <Th className="whitespace-nowrap">Stock #</Th>
                <Th>Vehicle</Th>
                <Th>Source data</Th>
                {DOCUMENT_FAMILY_IDS.map((id) => (
                  <Th key={id} className="whitespace-nowrap">{FAMILY_SHORT[DOCUMENT_FAMILIES[id].adminTitle] ?? DOCUMENT_FAMILIES[id].adminTitle}</Th>
                ))}
                <Th>Blocker</Th>
                <Th align="right">Review</Th>
              </tr>
            </thead>
            <tbody>
              {filtered?.map(({ vehicle, intel }) => (
                <tr key={vehicle.id} className="hover:bg-adm-workspace">
                  <Td className="whitespace-nowrap font-mono text-[12px]">{vehicleStockNumber(vehicle) ?? "Unknown"}</Td>
                  <Td className="max-w-[190px]">
                    <span className="block truncate font-semibold text-adm-ink">{vehicle.ymm || "Vehicle"}</span>
                    <span className="block truncate font-mono text-[12px] leading-[16px] text-adm-muted">{vehicle.vin || "no VIN"}</span>
                  </Td>
                  <Td><Stage stage={intel.sourceStage} /></Td>
                  {DOCUMENT_FAMILY_IDS.map((id) => {
                    const f = intel.families.find((x) => x.family === id);
                    return <Td key={id}>{f ? <Stage stage={f.stage} /> : null}</Td>;
                  })}
                  <Td className="max-w-[130px]">
                    {intel.blocker
                      ? <span className="block truncate text-[13px] text-adm-warning" title={intel.blocker}>{intel.blocker}</span>
                      : <span className="text-[12px] text-adm-muted">None</span>}
                  </Td>
                  <Td align="right">
                    <div className="flex items-center justify-end gap-3 whitespace-nowrap text-[14px] font-semibold">
                      <Link to={`/vehicle-file/${vehicle.id}`} className="text-adm-primary hover:underline">Review</Link>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </WorkTable>
        </QueryState>
      </Panel>
    </PageBody>
  );
}
