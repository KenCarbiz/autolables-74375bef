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
  const msrp = r.mc_attributes?.msrp ?? null;
  if (msrp != null && msrp > 0 && Math.abs(r.price - msrp) < 1) return "equals_msrp";
  return "ok";
};

const SIGNALS = [
  { key: "price", label: "Advertised price", has: (r: Row) => priceFlag(r) === "ok" },
  { key: "value", label: "Market value", has: (r: Row) => r.market_value != null },
  { key: "comps", label: "Comparables", has: (r: Row) => Array.isArray(r.comparables) && r.comparables.length > 0 },
  { key: "mds", label: "Days supply", has: (r: Row) => r.market_meta?.market_days_supply != null },
  { key: "recall", label: "Recalls", has: (r: Row) => !!r.recall_status },
  { key: "history", label: "VIN history", has: (r: Row) => !!r.history_payload?.available },
  { key: "blackbook", label: "Black Book", has: (r: Row) => !!r.blackbook?.available },
] as const;

const SELECT =
  "vin, ymm, price, market_value, market_meta, comparables, history_payload, recall_status, open_recall_count, blackbook, enriched_at, source_url, mc_attributes";

export default function MarketcheckDataHealthCard() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id || null;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyVin, setBusyVin] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("vehicle_listings").select(SELECT)
      .eq("tenant_id", tenantId)
      .order("enriched_at", { ascending: true, nullsFirst: true })
      .limit(300);
    if (error) toast.error(error.message);
    setRows((data as Row[]) || []);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const reEnrich = async (vin: string) => {
    if (!tenantId) return;
    setBusyVin(vin);
    const { data, error } = await supabase.functions.invoke("vehicle-enrich", { body: { tenant_id: tenantId, vin } });
    setBusyVin(null);
    if (error) { toast.error("Re-enrich failed — check the MarketCheck key"); return; }
    const p = (data as { pulled?: Record<string, unknown> })?.pulled;
    toast.success(p ? `Pulled: ${Object.entries(p).filter(([, v]) => v).map(([k]) => k).join(", ") || "nothing new"}` : "Re-enriched");
    load();
  };

  const reEnrichStale = async () => {
    if (!tenantId || !rows) return;
    const targets = rows.filter((r) => !r.enriched_at || SIGNALS.some((s) => !s.has(r))).slice(0, 25);
    if (!targets.length) { toast.success("Every vehicle is fully enriched"); return; }
    setBulk(true);
    let done = 0;
    for (const t of targets) {
      try { await supabase.functions.invoke("vehicle-enrich", { body: { tenant_id: tenantId, vin: t.vin } }); done++; } catch { /* best-effort */ }
    }
    setBulk(false);
    toast.success(`Re-enriched ${done} of ${targets.length} vehicles`);
    load();
  };

  const stats = useMemo(() => {
    if (!rows) return null;
    const total = rows.length;
    const fully = rows.filter((r) => SIGNALS.every((s) => s.has(r))).length;
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
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
            className="h-9 px-3 rounded-md border border-border text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
          </button>
          <button onClick={reEnrichStale} disabled={bulk || loading || !rows?.length}
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
            {bulk ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Re-pull incomplete
          </button>
        </div>
      </div>
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
                      <button onClick={() => reEnrich(r.vin)} disabled={busyVin === r.vin}
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
