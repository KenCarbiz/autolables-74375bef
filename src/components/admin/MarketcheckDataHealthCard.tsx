import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";
import { Activity, Loader2, RefreshCw, CheckCircle2, AlertTriangle, MinusCircle } from "lucide-react";

// MarketcheckDataHealthCard — per-vehicle completeness monitor for the nightly
// MarketCheck enrichment. Surfaces, for every VIN in inventory, exactly which
// data points landed (advertised price, market value, comps, days-supply,
// recalls, VIN history/owners, Black Book) so an admin can confirm "all the
// data is being received every single time" — and re-pull any that didn't.
//
// It also flags advertised-price parse problems: a missing price, a non-
// positive price, or a price that exactly equals the OEM MSRP (a tell-tale sign
// the feed handed us the sticker, not the dealer's advertised number).

interface Row {
  vin: string;
  ymm: string | null;
  condition: string | null;
  price: number | null;
  market_value: number | null;
  market_meta: { market_days_supply?: number | null; similar_count?: number | null } | null;
  comparables: unknown[] | null;
  history_payload: { available?: boolean; owners?: number | null; entries?: unknown[]; inServiceDate?: string | null } | null;
  recall_status: string | null;
  open_recall_count: number | null;
  blackbook: { available?: boolean } | null;
  enriched_at: string | null;
  source_url: string | null;
  mc_attributes: { msrp?: number | null } | null;
}

type PriceFlag = "ok" | "missing" | "nonpositive" | "equals_msrp";

const priceFlag = (r: Row): PriceFlag => {
  if (r.price == null) return "missing";
  if (r.price <= 0) return "nonpositive";
  // NOTE: we deliberately do NOT flag price == MSRP. MarketCheck's msrp field
  // mirrors the advertised price on used cars (and new cars legitimately list
  // at MSRP), so that check produced almost entirely false positives. Genuine
  // advertised-vs-lot-price mismatches are caught by the Price Integrity panel.
  return "ok";
};

// `core: true` marks the signals that a successful enrichment should reliably
// produce, so they define "fully enriched" and which cars are "incomplete".
// The rest are display-only — they go grey for legitimate reasons that must NOT
// brand a car incomplete forever (or the backfill loop never terminates):
//   • Days supply — MarketCheck MDS is plan-gated / absent for rare ymm
//   • VIN history — brand-new cars have no prior listings
//   • Black Book — optional add-on, not configured by default
const SIGNALS = [
  { key: "price", label: "Advertised price", core: true, has: (r: Row) => priceFlag(r) === "ok" },
  { key: "value", label: "Market value", core: true, has: (r: Row) => r.market_value != null },
  { key: "comps", label: "Comparables", core: true, has: (r: Row) => Array.isArray(r.comparables) && r.comparables.length > 0 },
  { key: "mds", label: "Days supply", core: false, has: (r: Row) => r.market_meta?.market_days_supply != null },
  { key: "recall", label: "Recalls", core: true, has: (r: Row) => !!r.recall_status },
  { key: "history", label: "VIN history", core: false, has: (r: Row) => !!r.history_payload?.available },
  { key: "blackbook", label: "Black Book", core: false, has: (r: Row) => !!r.blackbook?.available },
] as const;

const CORE = SIGNALS.filter((s) => s.core);

type Sources = "all" | "marketcheck" | "blackbook";

// Whether a car still needs a pass for the given provider scope. For MarketCheck
// we also treat a missing Days Supply as "needs enrich" — it's a non-core signal
// that normally lands, so a blank one is a transient miss worth retrying (this is
// what the straggler-retry pass uses). Black Book only cares about its own value.
const needsEnrich = (r: Row, sources: Sources): boolean => {
  if (sources === "blackbook") return !r.blackbook?.available;
  if (!r.enriched_at) return true;
  return CORE.some((s) => !s.has(r)) || r.market_meta?.market_days_supply == null;
};

const SELECT =
  "vin, ymm, condition, price, market_value, market_meta, comparables, history_payload, recall_status, open_recall_count, blackbook, enriched_at, source_url, mc_attributes";

interface SyncState {
  last_run_at: string | null;
  last_status: { ran_at?: string; seen?: number; new_vehicles?: number; prices_recorded?: number; error?: string; note?: string } | null;
}

export default function MarketcheckDataHealthCard() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id || null;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [sync, setSync] = useState<SyncState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyVin, setBusyVin] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);
  const [fullPull, setFullPull] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const [listRes, cfgRes] = await Promise.all([
      (supabase as any).from("vehicle_listings").select(SELECT)
        .eq("tenant_id", tenantId).order("enriched_at", { ascending: true, nullsFirst: true }).limit(300),
      (supabase as any).from("marketcheck_sync_config").select("last_run_at, last_status").eq("tenant_id", tenantId).maybeSingle(),
    ]);
    if (listRes.error) toast.error(listRes.error.message);
    setRows((listRes.data as Row[]) || []);
    setSync((cfgRes.data as SyncState) || null);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  // Enrich VINs one at a time (sequential keeps us under MarketCheck's rate
  // limit), driven from the browser so there's no edge wall-clock cap.
  //   sources: which providers to run — "all", "marketcheck", or "blackbook".
  //   scope:   "all" = every car in inventory; "incomplete" = only cars that
  //            still need this provider's data.
  // After the main pass it re-queries and re-runs any transient stragglers
  // (e.g. a Days-Supply call that timed out) up to 2 rounds, so a full pull
  // self-cleans instead of leaving a handful for manual per-car re-pulls.
  const enrichLoop = useCallback(async (sources: Sources, scope: "all" | "incomplete"): Promise<number> => {
    if (!tenantId) return 0;
    const fetchRows = async (): Promise<Row[]> => {
      const { data } = await (supabase as any).from("vehicle_listings").select(SELECT).eq("tenant_id", tenantId).limit(2000);
      return (data as Row[]) || [];
    };
    const runBatch = async (list: Row[]) => {
      setProgress({ done: 0, total: list.length });
      let done = 0;
      for (const t of list) {
        try { await supabase.functions.invoke("vehicle-enrich", { body: { tenant_id: tenantId, vin: t.vin, sources } }); } catch { /* best-effort */ }
        done++;
        setProgress({ done, total: list.length });
      }
    };
    const all = await fetchRows();
    const targets = scope === "all" ? all : all.filter((r) => needsEnrich(r, sources));
    if (!targets.length) { setProgress(null); return 0; }
    await runBatch(targets);
    // Straggler retry for transient misses — skip for Black-Book-only (an
    // unconfigured Black Book would otherwise look like a permanent straggler
    // and retry the whole inventory).
    if (sources !== "blackbook") {
      const touched = new Set(targets.map((t) => t.vin));
      for (let round = 0; round < 2; round++) {
        const stragglers = (await fetchRows()).filter((r) => touched.has(r.vin) && needsEnrich(r, sources));
        if (!stragglers.length) break;
        await runBatch(stragglers);
      }
    }
    setProgress(null);
    return targets.length;
  }, [tenantId]);

  // Re-pull the ENTIRE inventory from the dealer's website via marketcheck-sync
  // (force), which re-ingests every VIN, THEN enrich every car from the browser.
  // We pass enrich:false so the edge function skips its bounded inline pass — the
  // client loop below covers all of them with live progress instead.
  const rePullInventory = async () => {
    if (!tenantId) return;
    setFullPull(true);
    const { data, error } = await supabase.functions.invoke("marketcheck-sync", { body: { tenant_id: tenantId, force: true, enrich: false } });
    if (error) { setFullPull(false); toast.error("Full inventory pull failed — check the MarketCheck key / domain"); return; }
    const r = (data || {}) as { listings_seen?: number; new_vehicles?: number; prices_recorded?: number; error?: string };
    if (r.error === "not_configured") { setFullPull(false); toast.error("MARKETCHECK_API_KEY_1 is not set on the server"); return; }
    const seen = r.listings_seen ?? 0;
    if (seen === 0) { setFullPull(false); toast.error("Pulled 0 vehicles — check the MarketCheck key / domain"); load(); return; }
    toast.success(`Pulled ${seen} vehicles · ${r.new_vehicles ?? 0} new · ${r.prices_recorded ?? 0} price updates · enriching all…`);
    await load();
    const enriched = await enrichLoop("all", "all");
    setFullPull(false);
    toast.success(enriched > 0 ? `Enriched ${enriched} vehicles — inventory is fully up to date` : "Every vehicle was already fully enriched");
    load();
  };

  // Run one provider across the WHOLE inventory (no website re-ingest). Lets the
  // admin refresh just MarketCheck market data, or backfill just Black Book,
  // without spending the other provider's quota.
  const runProviderFull = async (sources: Sources, label: string) => {
    if (!tenantId) return;
    setBulk(true);
    const n = await enrichLoop(sources, "all");
    setBulk(false);
    toast.success(n > 0 ? `${label}: ran ${n} vehicles` : "No vehicles to run");
    load();
  };

  const reEnrich = async (vin: string) => {
    if (!tenantId) return;
    setBusyVin(vin);
    const { data, error } = await supabase.functions.invoke("vehicle-enrich", { body: { tenant_id: tenantId, vin } });
    setBusyVin(null);
    if (error) { toast.error("Re-enrich failed — check the MarketCheck key"); return; }
    const p = (data as { pulled?: Record<string, unknown> })?.pulled;
    // Surface the comps diagnostic prominently: num_found vs listings_returned
    // tells us instantly whether the plan is withholding the listing records.
    if (p) {
      const nf = p.comps_num_found as number | null;
      const lr = p.comps_listings_returned as number | null;
      const got = p.comparables as number;
      toast.success(`Comps: ${nf ?? 0} found in market, ${lr ?? 0} listings returned, ${got} usable (http ${p.comps_http ?? "?"})`, { duration: 9000 });
    } else {
      toast.success("Re-enriched");
    }
    load();
  };

  const reEnrichStale = async () => {
    if (!tenantId) return;
    setBulk(true);
    const done = await enrichLoop("all", "incomplete");
    setBulk(false);
    toast.success(done > 0 ? `Enriched ${done} — every vehicle is now complete` : "Every vehicle is fully enriched");
    load();
  };

  const stats = useMemo(() => {
    if (!rows) return null;
    const total = rows.length;
    const fully = rows.filter((r) => CORE.every((s) => s.has(r))).length;
    const never = rows.filter((r) => !r.enriched_at).length;
    const priceProblems = rows.filter((r) => priceFlag(r) !== "ok").length;
    return { total, fully, never, priceProblems };
  }, [rows]);

  if (!tenantId) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#16A34A]" />
          <h3 className="font-display text-lg font-bold tracking-tight text-foreground">MarketCheck data health</h3>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={load} disabled={loading}
            className="h-9 px-3 rounded-md border border-border text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
          </button>
          <button onClick={reEnrichStale} disabled={bulk || fullPull || loading || !rows?.length}
            className="h-9 px-3 rounded-md border border-border text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50">
            {bulk ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Re-pull incomplete
          </button>
          <button onClick={() => runProviderFull("marketcheck", "MarketCheck")} disabled={bulk || fullPull || loading || !rows?.length}
            className="h-9 px-3 rounded-md border border-border text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50"
            title="Run MarketCheck (value, comps, days supply, recalls, history) across the whole inventory — no Black Book">
            <RefreshCw className="w-3.5 h-3.5" /> Full: MarketCheck
          </button>
          <button onClick={() => runProviderFull("blackbook", "Black Book")} disabled={bulk || fullPull || loading || !rows?.length}
            className="h-9 px-3 rounded-md border border-border text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50"
            title="Run Black Book values across the whole inventory — no MarketCheck quota used">
            <RefreshCw className="w-3.5 h-3.5" /> Full: Black Book
          </button>
          <button onClick={rePullInventory} disabled={fullPull || bulk || loading}
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
            title="Re-pull inventory from the dealer website, then run all APIs across every vehicle">
            {fullPull ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Full: all data
          </button>
        </div>
      </div>

      {/* During a full pull the website re-ingest (one long, opaque call) runs
          first; hide the generic banner once the enrich loop starts so the
          progress bar below is the single, continuous indicator. */}
      <SyncStatusLine sync={sync} running={fullPull && !progress} />
      {(progress || bulk) && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {progress ? "Enriching every vehicle — comps, recalls, VIN history, Black Book" : "Preparing enrichment…"}
            </span>
            {progress && <span className="tabular-nums">{progress.done} / {progress.total}</span>}
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-[#16A34A] transition-all" style={{ width: `${progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
          </div>
        </div>
      )}
      <p className="text-sm text-muted-foreground -mt-1 max-w-2xl">
        Every VIN in inventory and which enrichment data points actually landed on the last pull. Use this to confirm
        the nightly sync is receiving everything, and to re-pull any vehicle that came back incomplete.
      </p>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Vehicles" value={stats.total} />
          <Stat label="Fully enriched" value={stats.fully} tone={stats.fully === stats.total ? "green" : "amber"} />
          <Stat label="Never enriched" value={stats.never} tone={stats.never > 0 ? "amber" : "green"} />
          <Stat label="Price issues" value={stats.priceProblems} tone={stats.priceProblems > 0 ? "red" : "green"} />
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground py-6 text-center">Loading inventory…</div>
      ) : !rows?.length ? (
        <div className="text-sm text-muted-foreground py-6 text-center">No vehicles synced yet. Run the sync above first.</div>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-2 pr-3 font-semibold">Vehicle</th>
                <th className="py-2 px-2 font-semibold">Adv. price</th>
                {SIGNALS.map((s) => <th key={s.key} className="py-2 px-1.5 font-semibold text-center whitespace-nowrap">{s.label}</th>)}
                <th className="py-2 pl-2 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pf = priceFlag(r);
                return (
                  <tr key={r.vin} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="py-2 pr-3">
                      <div className="font-semibold text-foreground truncate max-w-[200px]">{r.ymm || "Vehicle"}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{r.vin}</div>
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      <PriceCell flag={pf} price={r.price} msrp={r.mc_attributes?.msrp ?? null} />
                    </td>
                    {SIGNALS.map((s) => (
                      <td key={s.key} className="py-2 px-1.5 text-center">
                        {s.has(r)
                          ? <CheckCircle2 className="w-4 h-4 text-[#16A34A] inline" />
                          : <MinusCircle className="w-4 h-4 text-slate-300 inline" />}
                      </td>
                    ))}
                    <td className="py-2 pl-2 text-right">
                      <button onClick={() => reEnrich(r.vin)} disabled={busyVin === r.vin || bulk || fullPull}
                        className="h-7 px-2.5 rounded-md border border-border text-[11px] font-semibold inline-flex items-center gap-1 hover:bg-muted disabled:opacity-50">
                        {busyVin === r.vin ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Re-pull
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SyncStatusLine({ sync, running }: { sync: SyncState | null; running: boolean }) {
  if (running) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Step 1 of 2 — pulling full inventory from the dealer website (enrichment starts next)…
      </div>
    );
  }
  if (!sync?.last_run_at) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
        <MinusCircle className="w-4 h-4 text-slate-400" /> No inventory pull has run yet for this dealer.
      </div>
    );
  }
  const st = sync.last_status || {};
  const failed = !!st.error;
  const seen = st.seen ?? 0;
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-4 py-2.5 text-sm ${failed ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
      {failed ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}
      <div>
        <span className="font-semibold">Last full pull {new Date(sync.last_run_at).toLocaleString()}</span>
        {failed
          ? <span> — failed{st.note ? `: ${st.note}` : st.error ? `: ${st.error}` : ""}</span>
          : <span> — success · {seen} vehicles · {st.new_vehicles ?? 0} new · {st.prices_recorded ?? 0} price updates</span>}
      </div>
    </div>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "green" | "amber" | "red" }) {
  const color = tone === "green" ? "text-[#16A34A]" : tone === "amber" ? "text-[#EA580C]" : tone === "red" ? "text-red-600" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2.5">
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function PriceCell({ flag, price, msrp }: { flag: PriceFlag; price: number | null; msrp: number | null }) {
  const fmt = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);
  if (flag === "ok") return <span className="font-semibold text-foreground tabular-nums">{fmt(price)}</span>;
  const map: Record<Exclude<PriceFlag, "ok">, string> = {
    missing: "No price parsed",
    nonpositive: "Price is 0",
    equals_msrp: `Matches MSRP ${fmt(msrp)}`,
  };
  return (
    <span className="inline-flex items-center gap-1 text-[#EA580C] font-semibold" title={map[flag as Exclude<PriceFlag, "ok">]}>
      <AlertTriangle className="w-3.5 h-3.5" /> {flag === "equals_msrp" ? fmt(price) : map[flag as Exclude<PriceFlag, "ok">]}
    </span>
  );
}
