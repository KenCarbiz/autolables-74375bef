import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowRight, Check, ExternalLink, FileText, Loader2,
  RefreshCw, Search,
} from "lucide-react";
import { PageBody, PageHeader, LocalTabs, Panel, WorkTable, Th, Td, Button, StatusText, InlineNote, type Tone, type LocalTab } from "@/components/product";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasWindowStickerPermission } from "@/lib/permissions/windowStickerPermissions";
import { useWindowSticker } from "@/hooks/useWindowSticker";
import FactoryStickerWorkspace from "./FactoryStickerWorkspace";

// Window Sticker Studio — the standalone entry point.
//
// It only chooses the vehicle. Everything downstream (OEM identity,
// template selection, normalization, validation, rendering, filing and
// publication) runs through the same factory-sticker-orchestrate services
// the nightly ingest and the Vehicle File use, so a sticker built here is
// indistinguishable from one built automatically.

const STEPS = [
  { n: 1, title: "Vehicle", detail: "Choose or enter the vehicle" },
  { n: 2, title: "OEM data", detail: "Match OEM and build data" },
  { n: 3, title: "Review", detail: "Check data integrity" },
  { n: 4, title: "Publish", detail: "Generate and publish after review" },
];

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

interface VehicleHit {
  id: string;
  vin: string | null;
  ymm: string | null;
  condition: string | null;
  status: string | null;
  slug: string | null;
  stock_number?: string | null;
}

interface HistoryRow {
  id: string;
  vehicle_id: string;
  vin: string;
  generation_status: string;
  canonical_oem_id: string | null;
  template_family_id: string | null;
  template_version: string | null;
  reconciliation_status: string | null;
  review_required: boolean;
  review_reason: string | null;
  published_at: string | null;
  updated_at: string | null;
  current_document_id: string | null;
}

const STATUS_TONE: Record<string, Tone> = {
  PUBLISHED: "success",
  APPROVED: "success",
  REVIEW_REQUIRED: "warning",
  READY_TO_GENERATE: "info",
  PENDING_DATA: "neutral",
  FAILED_RETRYABLE: "danger",
  FAILED_PERMANENT: "danger",
};

const humanize = (s: string) => s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
const fmtWhen = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

function StepRail({ active }: { active: number }) {
  return (
    <ol className="flex items-stretch gap-0 overflow-x-auto border border-adm-border rounded-[4px] bg-adm-surface" aria-label="Window sticker steps">
      {STEPS.map((s, i) => {
        const state = s.n < active ? "done" : s.n === active ? "current" : "todo";
        return (
          <li
            key={s.n}
            aria-current={state === "current" ? "step" : undefined}
            className={`flex-1 min-w-[150px] flex items-center gap-2 px-3 py-2 ${i > 0 ? "border-l border-adm-border" : ""} ${state === "current" ? "border-b-2 border-b-adm-primary" : ""}`}
          >
            <span aria-hidden className={`w-6 h-6 rounded-full grid place-items-center text-[12px] font-bold shrink-0 ${
              state === "done" ? "bg-adm-success text-white" : state === "current" ? "bg-adm-primary text-white" : "bg-adm-workspace text-adm-muted"
            }`}>
              {state === "done" ? <Check className="w-3.5 h-3.5" /> : s.n}
            </span>
            <span className="min-w-0">
              <span className={`block text-[14px] leading-[20px] font-semibold ${state === "todo" ? "text-adm-muted" : "text-adm-ink"}`}>{s.title}</span>
              <span className="block text-[12px] leading-[18px] text-adm-muted truncate">{s.detail}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function WindowStickerStudio() {
  const { tenant } = useTenant();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const canCreate = hasWindowStickerPermission(member?.role, "window_sticker.create", isAdmin);
  const canPublish = hasWindowStickerPermission(member?.role, "window_sticker.publish", isAdmin);
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const { generate, busy } = useWindowSticker();

  const [params, setParams] = useSearchParams();
  const selectedId = params.get("vehicle");
  const tab = params.get("tab") === "history" ? "history" : "create";

  const [query, setQuery] = useState("");
  const [conditionFilter, setConditionFilter] = useState("");
  const [hits, setHits] = useState<VehicleHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [vinInput, setVinInput] = useState("");
  const [vinDuplicate, setVinDuplicate] = useState<VehicleHit | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);

  const select = useCallback((vehicleId: string) => {
    const next = new URLSearchParams(params);
    next.set("vehicle", vehicleId);
    next.delete("tab");
    setParams(next, { replace: false });
  }, [params, setParams]);

  const clearSelection = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete("vehicle");
    setParams(next, { replace: false });
  }, [params, setParams]);

  const setTab = useCallback((t: "create" | "history") => {
    const next = new URLSearchParams(params);
    if (t === "history") next.set("tab", "history"); else next.delete("tab");
    next.delete("vehicle");
    setParams(next, { replace: false });
  }, [params, setParams]);

  // ── Existing inventory search. Tenant-scoped on the server by RLS and
  // again here, so a studio query can never reach another dealership.
  const runSearch = useCallback(async () => {
    if (!tenantId) return;
    setSearching(true);
    try {
      const term = query.trim();
      // Stock numbers live on vehicle_files, not on the listing, so a stock
      // search resolves through the file's VIN rather than being dropped.
      let stockVins: string[] = [];
      if (term) {
        // deno-lint-ignore no-explicit-any
        const { data: files } = await (supabase as any)
          .from("vehicle_files")
          .select("vin, stock_number")
          .eq("tenant_id", tenantId)
          .ilike("stock_number", `%${term}%`)
          .limit(25);
        stockVins = ((files || []) as { vin: string }[]).map((f) => f.vin).filter(Boolean);
      }
      // deno-lint-ignore no-explicit-any
      let q = (supabase as any)
        .from("vehicle_listings")
        .select("id, vin, ymm, condition, status, slug")
        .eq("tenant_id", tenantId)
        .order("updated_at", { ascending: false })
        .limit(25);
      if (term) {
        const clauses = [`vin.ilike.%${term}%`, `ymm.ilike.%${term}%`];
        if (stockVins.length) clauses.push(`vin.in.(${stockVins.join(",")})`);
        q = q.or(clauses.join(","));
      }
      if (conditionFilter) q = q.eq("condition", conditionFilter);
      const { data, error } = await q;
      if (error) throw error;
      setHits((data || []) as VehicleHit[]);
    } catch (e) {
      toast.error(`Couldn't search inventory: ${String((e as Error).message || e)}`);
      setHits([]);
    } finally {
      setSearching(false);
    }
  }, [tenantId, query, conditionFilter]);

  useEffect(() => { if (tenantId && tab === "create" && !selectedId) runSearch(); },
    // Initial load only; subsequent searches are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tenantId, tab, selectedId]);

  // ── Create from VIN. The tenant's own records are checked first so the
  // studio never quietly creates a second record for a VIN it already has.
  const vinNormalized = vinInput.toUpperCase().trim();
  const vinValid = VIN_RE.test(vinNormalized);

  useEffect(() => {
    if (!tenantId || !vinValid) { setVinDuplicate(null); return; }
    let cancelled = false;
    (async () => {
      // deno-lint-ignore no-explicit-any
      const { data } = await (supabase as any)
        .from("vehicle_listings")
        .select("id, vin, ymm, condition, status, slug")
        .eq("tenant_id", tenantId).eq("vin", vinNormalized).maybeSingle();
      if (!cancelled) setVinDuplicate((data as VehicleHit) || null);
    })();
    return () => { cancelled = true; };
  }, [tenantId, vinNormalized, vinValid]);

  const startFromVin = async () => {
    if (!tenantId || !vinValid) return;
    if (vinDuplicate) { select(vinDuplicate.id); return; }
    try {
      const res = await generate(tenantId, undefined, vinNormalized);
      if (res.record_id) {
        toast.success("Started the window sticker for this VIN.");
        await runSearch();
      }
    } catch (e) {
      toast.error(
        `This VIN is not in ${tenant?.name || "your"} inventory yet. Add the vehicle first, then return to the Studio. (${String((e as Error).message || e)})`,
      );
    }
  };

  // ── History
  const loadHistory = useCallback(async () => {
    if (!tenantId) return;
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (supabase as any)
      .from("factory_sticker_records")
      .select("id, vehicle_id, vin, generation_status, canonical_oem_id, template_family_id, template_version, reconciliation_status, review_required, review_reason, published_at, updated_at, current_document_id")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) { toast.error(`Couldn't load history: ${error.message}`); setHistory([]); return; }
    setHistory((data || []) as HistoryRow[]);
  }, [tenantId]);

  useEffect(() => { if (tab === "history") loadHistory(); }, [tab, loadHistory]);

  const filteredHistory = useMemo(() => {
    if (!history) return null;
    const term = query.trim().toLowerCase();
    if (!term) return history;
    return history.filter((r) =>
      r.vin.toLowerCase().includes(term) || (r.canonical_oem_id || "").toLowerCase().includes(term));
  }, [history, query]);

  if (!tenantId) {
    return (
      <PageBody>
        <PageHeader title="Window Sticker Studio" description="Create, validate and publish VIN-specific OEM window stickers." />
        <InlineNote tone="info" title="Select a dealership">The Studio works inside one dealership at a time.</InlineNote>
      </PageBody>
    );
  }

  const studioTabs: LocalTab[] = [
    { key: "create", label: "Create", to: "/window-sticker-studio" + (selectedId ? `?vehicle=${encodeURIComponent(selectedId)}` : ""), active: tab === "create" },
    { key: "history", label: "History", to: "/window-sticker-studio?tab=history", active: tab === "history" },
  ];

  return (
    <PageBody width="wide">
      <PageHeader
        title="Window Sticker Studio"
        description="Create, validate and publish VIN-specific OEM window stickers. Nothing is fetched or generated until you choose to."
      />

      <LocalTabs tabs={studioTabs} label="Window sticker studio" />

      {tab === "create" && (
        <>
          <StepRail active={selectedId ? 2 : 1} />

          {selectedId ? (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" onClick={clearSelection}>Choose a different vehicle</Button>
                <Link
                  to={`/vehicle-file/${selectedId}`}
                  className="min-h-[32px] px-3 rounded-md border border-adm-border bg-adm-surface text-[13px] font-semibold hover:bg-adm-workspace inline-flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3 h-3" /> Vehicle File
                </Link>
              </div>
              {/* Steps 2-4 are the shared per-vehicle workspace, not a
                  second implementation of the same pipeline. */}
              <FactoryStickerWorkspace vehicleId={selectedId} embedded />
            </>
          ) : (
            <div className="grid lg:grid-cols-[1fr_360px] gap-4">
              <Panel title="Select an existing vehicle">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative flex-1 min-w-[220px]">
                    <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-adm-muted" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
                      placeholder="VIN, stock number, year, make or model"
                      className="w-full min-h-[36px] pl-8 pr-3 rounded-md border border-adm-border bg-adm-surface text-[14px]"
                      aria-label="Search inventory"
                    />
                  </div>
                  <select
                    value={conditionFilter}
                    onChange={(e) => setConditionFilter(e.target.value)}
                    className="min-h-[36px] px-2 rounded-md border border-adm-border bg-adm-surface text-[14px]"
                    aria-label="Condition"
                  >
                    <option value="">All conditions</option>
                    <option value="new">New</option>
                    <option value="used">Used</option>
                    <option value="cpo">CPO</option>
                  </select>
                  <Button variant="primary" onClick={runSearch} disabled={searching}>
                    {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} Search
                  </Button>
                </div>

                <div className="divide-y divide-adm-border rounded-[4px] border border-adm-border overflow-hidden mt-3">
                  {hits === null && <p className="p-3 text-[14px] text-adm-muted">Loading inventory...</p>}
                  {hits?.length === 0 && (
                    <p className="p-3 text-[14px] text-adm-muted">
                      No vehicles matched. Try a different search, or start from a VIN.
                    </p>
                  )}
                  {hits?.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => select(v.id)}
                      className="w-full text-left min-h-[52px] px-3 py-2 hover:bg-adm-workspace flex items-center justify-between gap-3"
                    >
                      <span className="min-w-0">
                        <span className="block text-[14px] leading-[20px] font-semibold text-adm-ink truncate">
                          {v.ymm || "Vehicle"}
                        </span>
                        <span className="block text-[12px] leading-[18px] text-adm-muted truncate">
                          {v.vin || "no VIN"}
                          {v.stock_number ? ` | Stock ${v.stock_number}` : ""}
                          {v.condition ? ` | ${humanize(v.condition)}` : ""}
                          {v.status ? ` | ${humanize(v.status)}` : ""}
                        </span>
                      </span>
                      <ArrowRight className="w-4 h-4 text-adm-muted shrink-0" />
                    </button>
                  ))}
                </div>
              </Panel>

              <Panel title="Create from VIN" className="h-fit">
                <p className="text-[13px] leading-[18px] text-adm-muted">
                  For a vehicle that did not arrive through the nightly inventory feed. The Studio checks this
                  dealership&apos;s records first and never creates a duplicate.
                </p>
                <input
                  value={vinInput}
                  onChange={(e) => setVinInput(e.target.value)}
                  placeholder="17-character VIN"
                  maxLength={17}
                  className="w-full min-h-[36px] px-3 rounded-md border border-adm-border bg-adm-surface text-[14px] font-mono uppercase mt-3"
                  aria-label="VIN"
                />
                {vinInput.trim() && !vinValid && (
                  <p className="text-[12px] leading-[18px] text-adm-danger inline-flex items-start gap-1.5 mt-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> That is not a valid 17-character VIN.
                  </p>
                )}
                {vinDuplicate && (
                  <p className="text-[12px] leading-[18px] text-adm-warning inline-flex items-start gap-1.5 mt-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                    <span>
                      This VIN already exists in your inventory ({vinDuplicate.ymm || "vehicle"}). Continue opens the
                      existing record instead of creating a second one.
                    </span>
                  </p>
                )}
                <Button variant="primary" className="w-full mt-3" onClick={startFromVin} disabled={!vinValid || busy || !canCreate}>
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                  {vinDuplicate ? "Open existing vehicle" : "Continue"}
                </Button>
                {!canCreate && (
                  <p className="text-[12px] leading-[18px] text-adm-muted mt-2">
                    Starting a sticker from a VIN needs manager authority. You can still open an existing vehicle.
                  </p>
                )}
                {canCreate && !canPublish && (
                  <p className="text-[12px] leading-[18px] text-adm-muted mt-2">
                    Publishing to the customer passport needs manager authority. You can still review the draft.
                  </p>
                )}
              </Panel>
            </div>
          )}
        </>
      )}

      {tab === "history" && (
        <Panel title="Window sticker history">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <div className="relative min-w-[220px] flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-adm-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by VIN or brand"
                className="w-full min-h-[36px] pl-8 pr-3 rounded-md border border-adm-border bg-adm-surface text-[14px]"
                aria-label="Filter history"
              />
            </div>
            <Button onClick={loadHistory}><RefreshCw className="w-3.5 h-3.5" /> Refresh</Button>
          </div>

          <WorkTable caption="Window sticker history" minWidth={760}>
            <thead>
              <tr>
                <Th>VIN</Th>
                <Th>Brand / template</Th>
                <Th>Status</Th>
                <Th>Reconciliation</Th>
                <Th>Updated</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filteredHistory === null && (
                <tr><Td className="text-adm-muted" >Loading...</Td></tr>
              )}
              {filteredHistory?.length === 0 && (
                <tr><Td className="text-adm-muted">No window sticker records yet.</Td></tr>
              )}
              {filteredHistory?.map((r) => (
                <tr key={r.id} className="align-top hover:bg-adm-workspace">
                  <Td className="font-mono text-[12px]">{r.vin}</Td>
                  <Td>
                    <span className="block font-semibold text-adm-ink">{r.canonical_oem_id ? humanize(r.canonical_oem_id) : "Unknown"}</span>
                    <span className="block text-[12px] leading-[18px] text-adm-muted">
                      {r.template_family_id || "no template"}{r.template_version ? ` v${r.template_version}` : ""}
                    </span>
                  </Td>
                  <Td>
                    <StatusText tone={STATUS_TONE[r.generation_status] ?? "neutral"}>{humanize(r.generation_status)}</StatusText>
                    {r.review_required && r.review_reason && (
                      <span className="block text-[12px] leading-[18px] text-adm-warning mt-0.5 max-w-[280px]">{r.review_reason}</span>
                    )}
                  </Td>
                  <Td className="text-adm-muted">
                    {r.reconciliation_status ? humanize(r.reconciliation_status) : "Unknown"}
                  </Td>
                  <Td className="text-adm-muted whitespace-nowrap">{fmtWhen(r.published_at || r.updated_at)}</Td>
                  <Td align="right">
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      <Button size="sm" onClick={() => select(r.vehicle_id)}>Open</Button>
                      <Link
                        to={`/vehicle-file/${r.vehicle_id}`}
                        className="min-h-[32px] px-3 rounded-md border border-adm-border bg-adm-surface text-[13px] font-semibold hover:bg-adm-workspace inline-flex items-center"
                      >
                        Vehicle File
                      </Link>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </WorkTable>
          <p className="text-[12px] leading-[18px] text-adm-muted inline-flex items-center gap-1.5 mt-3">
            <FileText className="w-3.5 h-3.5" /> Approved document versions are preserved and never overwritten.
          </p>
        </Panel>
      )}
    </PageBody>
  );
}
