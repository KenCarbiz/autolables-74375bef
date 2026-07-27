import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowRight, Check, ExternalLink, FileText, History, Loader2,
  RefreshCw, Search, Sparkles,
} from "lucide-react";
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
  { n: 1, title: "Vehicle & VIN", detail: "Choose or enter the vehicle" },
  { n: 2, title: "OEM Data & Template", detail: "Match OEM & build data" },
  { n: 3, title: "Review & Validate", detail: "Check data integrity" },
  { n: 4, title: "Generate & Publish", detail: "Create and publish the PDF" },
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

const STATUS_TONE: Record<string, string> = {
  PUBLISHED: "bg-emerald-50 text-emerald-700",
  APPROVED: "bg-emerald-50 text-emerald-700",
  REVIEW_REQUIRED: "bg-amber-50 text-amber-700",
  READY_TO_GENERATE: "bg-blue-50 text-blue-700",
  PENDING_DATA: "bg-slate-100 text-slate-600",
  FAILED_RETRYABLE: "bg-rose-50 text-rose-700",
  FAILED_PERMANENT: "bg-rose-50 text-rose-700",
};

const humanize = (s: string) => s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
const fmtWhen = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

function StepRail({ active }: { active: number }) {
  return (
    <ol className="flex items-stretch gap-2 overflow-x-auto pb-1" aria-label="Window sticker steps">
      {STEPS.map((s, i) => {
        const state = s.n < active ? "done" : s.n === active ? "current" : "todo";
        return (
          <li key={s.n} className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className={`w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold ${
                  state === "done" ? "bg-emerald-600 text-white"
                    : state === "current" ? "bg-blue-600 text-white"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {state === "done" ? <Check className="w-3.5 h-3.5" /> : s.n}
              </span>
              <span className="min-w-0">
                <span className={`block text-[12.5px] font-bold ${state === "todo" ? "text-muted-foreground" : "text-foreground"}`}>
                  {s.title}
                </span>
                <span className="block text-[11px] text-muted-foreground">{s.detail}</span>
              </span>
            </div>
            {i < STEPS.length - 1 && <ArrowRight className="w-4 h-4 text-muted-foreground/60 mx-1" aria-hidden />}
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
      <div className="p-4 md:p-6">
        <p className="text-sm text-muted-foreground">Select a dealership to use the Window Sticker Studio.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <div className="max-w-[1600px] mx-auto space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-bold text-foreground inline-flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-blue-600" /> Window Sticker Studio
            </h1>
            <p className="text-[12.5px] text-muted-foreground mt-0.5">
              Create, validate and publish VIN-specific OEM window stickers.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTab(tab === "history" ? "create" : "history")}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-[13px] font-semibold hover:bg-muted/40"
            >
              <History className="w-3.5 h-3.5" /> {tab === "history" ? "Create" : "History"}
            </button>
          </div>
        </div>

        {tab === "create" && (
          <>
            <div className="rounded-2xl border border-border bg-card p-4">
              <StepRail active={selectedId ? 2 : 1} />
            </div>

            {selectedId ? (
              <>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="h-8 px-3 rounded-md border border-border text-[12.5px] font-semibold hover:bg-muted/40"
                  >
                    Choose a different vehicle
                  </button>
                  <Link
                    to={`/vehicle-file/${selectedId}`}
                    className="h-8 px-3 rounded-md border border-border text-[12.5px] font-semibold hover:bg-muted/40 inline-flex items-center gap-1.5"
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
                <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                  <h2 className="text-sm font-bold text-foreground">Select an existing vehicle</h2>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative flex-1 min-w-[220px]">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
                        placeholder="VIN, stock number, year, make or model"
                        className="w-full h-9 pl-8 pr-3 rounded-md border border-border bg-background text-[13px]"
                        aria-label="Search inventory"
                      />
                    </div>
                    <select
                      value={conditionFilter}
                      onChange={(e) => setConditionFilter(e.target.value)}
                      className="h-9 px-2 rounded-md border border-border bg-background text-[13px]"
                      aria-label="Condition"
                    >
                      <option value="">All conditions</option>
                      <option value="new">New</option>
                      <option value="used">Used</option>
                      <option value="cpo">CPO</option>
                    </select>
                    <button
                      type="button"
                      onClick={runSearch}
                      disabled={searching}
                      className="h-9 px-3 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} Search
                    </button>
                  </div>

                  <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
                    {hits === null && <p className="p-3 text-[12.5px] text-muted-foreground">Loading inventory…</p>}
                    {hits?.length === 0 && (
                      <p className="p-3 text-[12.5px] text-muted-foreground">
                        No vehicles matched. Try a different search, or start from a VIN.
                      </p>
                    )}
                    {hits?.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => select(v.id)}
                        className="w-full text-left p-3 hover:bg-muted/40 flex items-center justify-between gap-3"
                      >
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold text-foreground truncate">
                            {v.ymm || "Vehicle"}
                          </span>
                          <span className="block text-[11.5px] text-muted-foreground truncate">
                            {v.vin || "no VIN"}
                            {v.stock_number ? ` · Stock ${v.stock_number}` : ""}
                            {v.condition ? ` · ${humanize(v.condition)}` : ""}
                            {v.status ? ` · ${humanize(v.status)}` : ""}
                          </span>
                        </span>
                        <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-card p-4 space-y-3 h-fit">
                  <h2 className="text-sm font-bold text-foreground">Create from VIN</h2>
                  <p className="text-[12px] text-muted-foreground">
                    For a vehicle that did not arrive through the nightly inventory feed. The Studio checks this
                    dealership's records first and never creates a duplicate.
                  </p>
                  <input
                    value={vinInput}
                    onChange={(e) => setVinInput(e.target.value)}
                    placeholder="17-character VIN"
                    maxLength={17}
                    className="w-full h-9 px-3 rounded-md border border-border bg-background text-[13px] font-mono uppercase"
                    aria-label="VIN"
                  />
                  {vinInput.trim() && !vinValid && (
                    <p className="text-[11.5px] text-rose-600 inline-flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> That is not a valid 17-character VIN.
                    </p>
                  )}
                  {vinDuplicate && (
                    <p className="text-[11.5px] text-amber-700 inline-flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                      <span>
                        This VIN already exists in your inventory ({vinDuplicate.ymm || "vehicle"}). Continue opens the
                        existing record instead of creating a second one.
                      </span>
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={startFromVin}
                    disabled={!vinValid || busy || !canCreate}
                    className="w-full h-9 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                    {vinDuplicate ? "Open existing vehicle" : "Continue"}
                  </button>
                  {!canCreate && (
                    <p className="text-[11px] text-muted-foreground">
                      Starting a sticker from a VIN needs manager authority. You can still open an existing vehicle.
                    </p>
                  )}
                  {canCreate && !canPublish && (
                    <p className="text-[11px] text-muted-foreground">
                      Publishing to the customer passport needs manager authority — you can still review the draft.
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {tab === "history" && (
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-bold text-foreground flex-1">Window sticker history</h2>
              <div className="relative min-w-[220px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter by VIN or brand"
                  className="w-full h-9 pl-8 pr-3 rounded-md border border-border bg-background text-[13px]"
                  aria-label="Filter history"
                />
              </div>
              <button
                type="button"
                onClick={loadHistory}
                className="h-9 px-3 rounded-md border border-border text-[13px] font-semibold hover:bg-muted/40 inline-flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                    <th className="py-2 pr-3 font-semibold">VIN</th>
                    <th className="py-2 pr-3 font-semibold">Brand / template</th>
                    <th className="py-2 pr-3 font-semibold">Status</th>
                    <th className="py-2 pr-3 font-semibold">MSRP</th>
                    <th className="py-2 pr-3 font-semibold">Updated</th>
                    <th className="py-2 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredHistory === null && (
                    <tr><td colSpan={6} className="py-3 text-muted-foreground">Loading…</td></tr>
                  )}
                  {filteredHistory?.length === 0 && (
                    <tr><td colSpan={6} className="py-3 text-muted-foreground">No window sticker records yet.</td></tr>
                  )}
                  {filteredHistory?.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="py-2.5 pr-3 font-mono text-[11.5px]">{r.vin}</td>
                      <td className="py-2.5 pr-3">
                        <span className="block font-semibold text-foreground">{r.canonical_oem_id ? humanize(r.canonical_oem_id) : "—"}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {r.template_family_id || "no template"}{r.template_version ? ` v${r.template_version}` : ""}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className={`inline-flex text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_TONE[r.generation_status] || "bg-slate-100 text-slate-600"}`}>
                          {humanize(r.generation_status)}
                        </span>
                        {r.review_required && r.review_reason && (
                          <span className="block text-[11px] text-amber-700 mt-0.5 max-w-[280px]">{r.review_reason}</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground">
                        {r.reconciliation_status ? humanize(r.reconciliation_status) : "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{fmtWhen(r.published_at || r.updated_at)}</td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => select(r.vehicle_id)}
                            className="h-7 px-2 rounded border border-border text-[11.5px] font-semibold hover:bg-muted/40"
                          >
                            Open
                          </button>
                          <Link
                            to={`/vehicle-file/${r.vehicle_id}`}
                            className="h-7 px-2 rounded border border-border text-[11.5px] font-semibold hover:bg-muted/40 inline-flex items-center"
                          >
                            Vehicle File
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" /> Approved document versions are preserved and never overwritten.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
