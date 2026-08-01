import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DollarSign, RefreshCw, AlertTriangle } from "lucide-react";

// ──────────────────────────────────────────────────────────────────────
// MarketCheck API spend, per tenant, per nightly run.
//
// PLATFORM-ADMIN ONLY. It exposes vendor unit economics across every tenant, so
// it renders nothing unless the viewer is a platform admin — the route gate is
// the primary control and this check is the belt to its braces. Never mount
// this inside a dealer-facing settings page.
//
// The figures are estimates built from MarketCheck's PUBLIC list prices, not
// invoices; the negotiated contract governs actual billing.
// ──────────────────────────────────────────────────────────────────────

interface UsageBreakdown { product: string; calls: number; usd: number }
interface ApiUsage {
  totalCalls?: number;
  estimatedUsd?: number;
  projectedMonthlyUsd?: number;
  breakdown?: UsageBreakdown[];
  priceSource?: string;
  hasUnpricedCalls?: boolean;
}
interface Row {
  tenant_id: string;
  source: string;
  last_run_at: string | null;
  last_status: {
    seen?: number;
    api_usage?: ApiUsage;
    rejected_other_rooftop?: number;
    prune_skipped?: string | null;
    mc_param?: string;
    pinned?: boolean;
    error?: string;
  } | null;
}

const usd = (n?: number) => `$${(n ?? 0).toFixed(2)}`;
const PRODUCT_LABEL: Record<string, string> = {
  dealer_inventory_syndication: "Dealer Inventory Syndication",
  inventory_search: "Inventory Search",
  dealer_api: "Dealer API",
  vin_history: "VIN History",
  market_days_supply: "Market Days Supply",
  recent_inventory: "Recent Inventory",
  sales_stats: "Sales Statistics",
  price_prediction: "MarketCheck Price",
  neovin: "NeoVIN",
  basic_vin_decode: "Basic VIN Decode",
  auto_recalls: "AutoRecalls",
  cached_images: "Cached Images",
  oem_incentive: "OEM Incentives",
  unknown: "Unpriced endpoint",
};

export default function MarketcheckApiUsagePanel() {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantNames, setTenantNames] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      // deno-lint-ignore no-explicit-any
      const { data } = await (supabase as any)
        .from("marketcheck_sync_config")
        .select("tenant_id, source, last_run_at, last_status")
        .order("last_run_at", { ascending: false, nullsFirst: false });
      const list = (data || []) as Row[];
      setRows(list);
      if (list.length) {
        // deno-lint-ignore no-explicit-any
        const { data: tenants } = await (supabase as any)
          .from("tenants").select("id, name").in("id", list.map((r) => r.tenant_id));
        const map: Record<string, string> = {};
        for (const t of (tenants || []) as Array<{ id: string; name: string }>) map[t.id] = t.name;
        setTenantNames(map);
      }
    } catch { /* panel is diagnostic; an empty table is an acceptable failure */ }
    setLoading(false);
  };

  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  // Defense in depth behind the route's own admin gate.
  if (!isAdmin) return null;
  if (loading) return <p className="p-4 text-sm text-muted-foreground">Loading API usage…</p>;

  const runTotal = rows.reduce((s, r) => s + (r.last_status?.api_usage?.estimatedUsd ?? 0), 0);
  const monthTotal = rows.reduce((s, r) => s + (r.last_status?.api_usage?.projectedMonthlyUsd ?? 0), 0);
  const metered = rows.filter((r) => r.last_status?.api_usage);

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-amber-700">
              Platform admin only
            </div>
            <h2 className="mt-3 text-2xl font-black tracking-tight text-foreground inline-flex items-center gap-2">
              <DollarSign className="w-5 h-5" /> MarketCheck API usage
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Calls and estimated spend from each tenant's most recent sync run. Figures use MarketCheck's
              public list prices — the negotiated contract governs actual billing.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-2xl bg-muted p-3 text-center">
              <p className="text-xl font-black text-foreground">{usd(runTotal)}</p>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Last run, all tenants</p>
            </div>
            <div className="rounded-2xl bg-muted p-3 text-center">
              <p className="text-xl font-black text-foreground">{usd(monthTotal)}</p>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Projected / month</p>
            </div>
            <button onClick={load} className="h-10 rounded-lg border border-border px-3 text-xs font-bold inline-flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>
        </div>
      </div>

      {!metered.length ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No metered runs yet. Usage appears after the next sync with the metering build deployed.
        </div>
      ) : null}

      {metered.map((r) => {
        const u = r.last_status?.api_usage as ApiUsage;
        return (
          <div key={r.tenant_id} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-black text-foreground truncate">
                  {tenantNames[r.tenant_id] || r.tenant_id}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {r.source || "no domain"} · {r.last_run_at ? new Date(r.last_run_at).toLocaleString() : "never run"}
                  {r.last_status?.mc_param ? ` · scoped by ${r.last_status.mc_param}` : ""}
                  {r.last_status?.pinned ? " · pinned" : ""}
                </p>
              </div>
              <div className="flex items-center gap-4 text-right">
                <div>
                  <p className="text-lg font-black text-foreground">{usd(u.estimatedUsd)}</p>
                  <p className="text-[10px] font-bold uppercase text-muted-foreground">{u.totalCalls ?? 0} calls</p>
                </div>
                <div>
                  <p className="text-lg font-black text-foreground">{usd(u.projectedMonthlyUsd)}</p>
                  <p className="text-[10px] font-bold uppercase text-muted-foreground">Per month</p>
                </div>
              </div>
            </div>

            {u.breakdown?.length ? (
              <div className="mt-3 space-y-1">
                {u.breakdown.map((b) => (
                  <div key={b.product} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-muted-foreground">{PRODUCT_LABEL[b.product] || b.product}</span>
                    <span className="font-semibold text-foreground tabular-nums">
                      {b.calls} × &nbsp;{usd(b.usd)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
              {typeof r.last_status?.seen === "number" && (
                <span className="text-muted-foreground">{r.last_status.seen} vehicles</span>
              )}
              {(r.last_status?.rejected_other_rooftop ?? 0) > 0 && (
                <span className="font-semibold text-emerald-700">
                  {r.last_status?.rejected_other_rooftop} foreign-rooftop listings blocked
                </span>
              )}
              {r.last_status?.prune_skipped && (
                <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                  <AlertTriangle className="w-3 h-3" /> prune skipped: {r.last_status.prune_skipped}
                </span>
              )}
              {u.hasUnpricedCalls && (
                <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                  <AlertTriangle className="w-3 h-3" /> includes calls with no list price
                </span>
              )}
              {r.last_status?.error && (
                <span className="font-semibold text-rose-700">{r.last_status.error}</span>
              )}
            </div>
          </div>
        );
      })}

      {metered.length ? (
        <p className="text-[11px] text-muted-foreground">
          Price source: {metered[0].last_status?.api_usage?.priceSource}. Monthly projection assumes 30 runs
          at the last run's rate; it is a planning figure, not a forecast.
        </p>
      ) : null}
    </div>
  );
}
