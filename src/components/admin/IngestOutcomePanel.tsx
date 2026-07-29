import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { AUTOGEN_EXCEPTION_TYPE } from "@/lib/commandCenter/autogenExceptions";
import {
  INGEST_STEPS,
  buildIngestOutcomes,
  parseYmm,
  summarizeIngestOutcomes,
  type IngestLedgerRow,
  type IngestStep,
  type IngestStepOutcome,
  type IngestStepStatus,
  type OemLinkRow,
  type PacketAttemptRow,
  type StickerRecordRow,
} from "@/lib/ingest/ingestOutcome";
import { AlertTriangle, RefreshCw } from "lucide-react";

// Ingest Outcome — the per-vehicle answer to "did it actually auto-generate?".
//
// Diagnostic, not a dashboard. One row per vehicle, one cell per pipeline
// step, each cell carrying the status AND the reason. The evidence marker is
// the point: "recorded" means the step said so itself, "inferred" means we
// worked it out from downstream state, and a step that never ran says so
// instead of quietly passing.

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

const VEHICLE_LIMIT = 100;
const LINK_CACHE_LIMIT = 1000;

interface ListingRow {
  id: string;
  vin: string;
  ymm: string | null;
  condition: string | null;
  created_at: string | null;
}

const STATUS_TONE: Record<IngestStepStatus, string> = {
  succeeded: "bg-emerald-50 text-emerald-700",
  running: "bg-blue-50 text-blue-700",
  parked: "bg-amber-50 text-amber-700",
  failed: "bg-rose-50 text-rose-700",
  skipped: "bg-slate-100 text-slate-600",
  not_run: "bg-slate-100 text-slate-600",
};

const STATUS_LABEL: Record<IngestStepStatus, string> = {
  succeeded: "Generated",
  running: "In progress",
  parked: "Parked",
  failed: "Failed",
  skipped: "N/A",
  not_run: "Never ran",
};

const EVIDENCE_LABEL: Record<IngestStepOutcome["evidence"], string> = {
  recorded: "recorded",
  derived: "inferred",
  absent: "nothing recorded",
};

const NEEDS_ATTENTION = new Set<IngestStepStatus>(["failed", "parked", "not_run"]);

const Pill = ({ tone, children }: { tone: string; children: React.ReactNode }) => (
  <span className={`inline-flex text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap ${tone}`}>
    {children}
  </span>
);

export default function IngestOutcomePanel() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;

  const [listings, setListings] = useState<ListingRow[]>([]);
  const [stickers, setStickers] = useState<Record<string, StickerRecordRow>>({});
  const [ledger, setLedger] = useState<Record<string, IngestLedgerRow[]>>({});
  const [artifacts, setArtifacts] = useState<Record<string, Record<string, unknown>>>({});
  const [brochures, setBrochures] = useState<OemLinkRow[]>([]);
  const [manuals, setManuals] = useState<OemLinkRow[]>([]);
  const [attempts, setAttempts] = useState<PacketAttemptRow[]>([]);
  const [ledgerMissing, setLedgerMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [onlyAttention, setOnlyAttention] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) { setLoading(false); return; }
    try {
      const { data: vData, error: vErr } = await sb()
        .from("vehicle_listings")
        .select("id, vin, ymm, condition, created_at")
        .eq("tenant_id", tenantId)
        .neq("status", "archived")
        .order("created_at", { ascending: false })
        .limit(VEHICLE_LIMIT);
      if (vErr) throw vErr;
      const rows = ((vData || []) as ListingRow[]).filter((r) => !!r.vin);
      setListings(rows);

      const ids = rows.map((r) => r.id);
      const vins = Array.from(new Set(rows.map((r) => String(r.vin).toUpperCase())));
      if (ids.length === 0) {
        setStickers({}); setLedger({}); setArtifacts({});
        setBrochures([]); setManuals([]); setAttempts([]);
        setLoadError(false);
        return;
      }

      const [fs, lg, ex, br, mn, at] = await Promise.all([
        sb().from("factory_sticker_records")
          .select("vehicle_id, generation_status, review_required, review_reason, last_error, published_at, current_document_id, updated_at")
          .eq("tenant_id", tenantId).in("vehicle_id", ids),
        sb().from("vehicle_ingest_ledger")
          .select("vin, step, status, reason, attempt_count, last_run_at")
          .eq("tenant_id", tenantId).in("vin", vins),
        sb().from("vehicle_exceptions")
          .select("vin, source_values")
          .eq("tenant_id", tenantId).eq("exception_type", AUTOGEN_EXCEPTION_TYPE)
          .in("status", ["open", "in_progress"]).in("vin", vins),
        sb().from("oem_brochure_links")
          .select("make, model, year, url, title, verified_at").limit(LINK_CACHE_LIMIT),
        sb().from("oem_owners_manual_links")
          .select("make, model, year, url, title, verified_at").limit(LINK_CACHE_LIMIT),
        // The packet-backfill sweep's global negative cache — the only record
        // of why a triple has no link. Absent from older databases; a query
        // error simply means no "why" is available.
        sb().from("oem_packet_backfill_attempts")
          .select("kind, make_key, model_key, year_key, outcome, detail, attempts, last_attempt_at")
          .limit(LINK_CACHE_LIMIT),
      ]);

      const sMap: Record<string, StickerRecordRow> = {};
      for (const r of (fs.data || []) as (StickerRecordRow & { vehicle_id: string })[]) sMap[r.vehicle_id] = r;
      setStickers(sMap);

      // The ledger table may not be migrated into this database yet. Say so
      // rather than pretending the derived-only view is the whole truth.
      setLedgerMissing(!!lg.error);
      const lMap: Record<string, IngestLedgerRow[]> = {};
      for (const r of (lg.data || []) as (IngestLedgerRow & { vin: string })[]) {
        const key = String(r.vin || "").toUpperCase();
        (lMap[key] ||= []).push(r);
      }
      setLedger(lMap);

      const aMap: Record<string, Record<string, unknown>> = {};
      for (const r of (ex.data || []) as { vin: string; source_values?: { artifacts?: Record<string, unknown> } }[]) {
        aMap[String(r.vin || "").toUpperCase()] = r.source_values?.artifacts || {};
      }
      setArtifacts(aMap);

      setBrochures((br.data || []) as OemLinkRow[]);
      setManuals((mn.data || []) as OemLinkRow[]);
      setAttempts((at.data || []) as PacketAttemptRow[]);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  const attemptByKey = useMemo(() => {
    const map = new Map<string, PacketAttemptRow>();
    for (const a of attempts) {
      const key = [
        String(a.kind || ""),
        String(a.make_key || "").trim().toLowerCase(),
        String(a.model_key || "").trim().toLowerCase(),
        a.year_key ?? 0,
      ].join("|");
      map.set(key, a);
    }
    return map;
  }, [attempts]);

  const rows = useMemo(() => listings.map((v) => {
    const vin = String(v.vin).toUpperCase();
    const { year, make, model } = parseYmm(v.ymm);
    const attemptFor = (kind: string) =>
      attemptByKey.get([kind, make.toLowerCase(), model.toLowerCase(), year ?? 0].join("|")) ?? null;
    const outcomes = buildIngestOutcomes({
      vin,
      ymm: v.ymm,
      ledger: ledger[vin],
      sticker: stickers[v.id] ?? null,
      brochureLinks: brochures,
      manualLinks: manuals,
      brochureAttempt: attemptFor("brochure"),
      manualAttempt: attemptFor("owners_manual"),
      autogenArtifacts: artifacts[vin],
    });
    return { vehicle: v, outcomes, summary: summarizeIngestOutcomes(outcomes) };
  }), [listings, ledger, stickers, brochures, manuals, attemptByKey, artifacts]);

  const visible = useMemo(
    () => (onlyAttention ? rows.filter((r) => r.summary.needsAttention > 0) : rows),
    [rows, onlyAttention],
  );

  const perStep = useMemo(() => {
    const out = {} as Record<IngestStep, { confirmed: number; inferred: number; attention: number }>;
    for (const step of INGEST_STEPS) out[step] = { confirmed: 0, inferred: 0, attention: 0 };
    for (const r of rows) {
      for (const o of r.outcomes) {
        if (o.status === "succeeded") {
          if (o.evidence === "recorded") out[o.step].confirmed++; else out[o.step].inferred++;
        } else if (NEEDS_ATTENTION.has(o.status)) out[o.step].attention++;
      }
    }
    return out;
  }, [rows]);

  return (
    <div id="ingest-outcome" className="bg-card rounded-2xl border border-border p-4 shadow-premium">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-foreground font-display">Ingest Outcome</h4>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
            What each vehicle's ingest actually produced, per step, with the reason. A step marked
            <span className="font-semibold text-foreground"> recorded</span> reported its own outcome;
            <span className="font-semibold text-foreground"> inferred</span> was worked out from downstream state and is
            not a confirmation; <span className="font-semibold text-foreground">Never ran</span> means nothing recorded an
            attempt at all.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyAttention}
              onChange={(e) => setOnlyAttention(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border"
            />
            Needs attention only
          </label>
          <button
            type="button"
            onClick={() => { setLoading(true); void load(); }}
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-border text-xs font-semibold hover:bg-muted"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      {ledgerMissing && (
        <p className="mt-2 text-[11px] text-amber-700 inline-flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          The per-VIN ingest ledger is not present in this database yet, so nothing below is a step's own report —
          every outcome here is inferred from downstream state.
        </p>
      )}

      {loading ? (
        <div className="space-y-2 mt-3 animate-pulse">
          {[0, 1, 2].map((i) => <div key={i} className="h-9 bg-muted rounded" />)}
        </div>
      ) : loadError ? (
        <p className="text-xs text-rose-600 mt-3 inline-flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> Couldn't load ingest outcomes. Refresh to retry.
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center mt-3">
          <p className="text-xs font-semibold text-foreground">No vehicles to report on yet.</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Every ingested vehicle appears here with its per-step outcome.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
            {INGEST_STEPS.map((step) => {
              const s = perStep[step];
              return (
                <div key={step} className="rounded-xl border border-border p-2.5">
                  <p className="text-[11px] font-bold text-foreground">
                    {step === "factory_sticker" ? "Window sticker" : step === "oem_brochure" ? "OEM brochure" : "Owner's manual"}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                    {s.confirmed} confirmed · {s.inferred} inferred · {s.attention} needing attention
                  </p>
                </div>
              );
            })}
          </div>

          <div className="overflow-x-auto mt-3">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[11px] font-semibold text-muted-foreground border-b border-border">
                  <th scope="col" className="px-2.5 py-2">Vehicle</th>
                  <th scope="col" className="px-2.5 py-2">Window sticker</th>
                  <th scope="col" className="px-2.5 py-2">OEM brochure</th>
                  <th scope="col" className="px-2.5 py-2">Owner's manual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map(({ vehicle, outcomes }) => (
                  <tr key={vehicle.id} className="align-top hover:bg-muted/30 transition-colors">
                    <td className="px-2.5 py-2.5 whitespace-nowrap">
                      <Link
                        to={`/vehicle-file/${vehicle.id}?tab=documents`}
                        className="font-mono font-semibold text-foreground hover:text-blue-600 hover:underline"
                      >
                        {vehicle.vin}
                      </Link>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{vehicle.ymm || "No year/make/model"}</p>
                    </td>
                    {outcomes.map((o) => (
                      <td key={o.step} className="px-2.5 py-2.5 max-w-[280px]">
                        <Pill tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Pill>
                        <span className="ml-1.5 text-[10px] text-muted-foreground">{EVIDENCE_LABEL[o.evidence]}</span>
                        <p className="text-[10px] text-muted-foreground mt-1 break-words" title={o.reason}>{o.reason}</p>
                        {o.attemptCount != null && o.attemptCount > 1 && (
                          <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">{o.attemptCount} attempts</p>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {visible.length === 0 && (
              <p className="text-[11px] text-muted-foreground mt-3 text-center">
                None of the {rows.length} loaded vehicles has a step needing attention.
              </p>
            )}
            {rows.length >= VEHICLE_LIMIT && (
              <p className="text-[11px] text-muted-foreground mt-2">
                Showing the {VEHICLE_LIMIT} most recently created vehicles.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
