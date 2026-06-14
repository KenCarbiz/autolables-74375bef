import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, RefreshCw, ArrowDownToLine, Clock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

// ──────────────────────────────────────────────────────────────
// InventoryFeedHealth — Wave 22.
//
// Surfaces the cross-app inventory contract between Autocurb
// (mothership) and AutoLabels (this app). The data lives on
// audit_log: every successful pull writes autocurb_pull_completed,
// every push writes autocurb_sync. We surface "last pull", "last
// push", and the trailing-10 sync events. Plus a manual "Pull
// from Autocurb" button that invokes the autocurb-pull edge
// function for a same-tab refresh.
//
// Tone reflects how fresh the feed is:
//   < 1h    → emerald  (live)
//   < 24h   → amber    (stale)
//   ≥ 24h   → rose     (broken / not configured)
//   never   → muted    (no integration yet)
// ──────────────────────────────────────────────────────────────

const fmtRelative = (iso: string | null): string => {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const ms = Date.now() - then;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
};

const toneForAge = (iso: string | null): {
  border: string;
  bg: string;
  text: string;
  iconColor: string;
  label: string;
} => {
  if (!iso) {
    return {
      border: "border-border",
      bg: "bg-muted/40",
      text: "text-muted-foreground",
      iconColor: "text-muted-foreground",
      label: "Not configured",
    };
  }
  const ms = Date.now() - new Date(iso).getTime();
  const h = ms / 3_600_000;
  if (h < 1) return { border: "border-emerald-200", bg: "bg-emerald-50/70", text: "text-emerald-900", iconColor: "text-emerald-700", label: "Live" };
  if (h < 24) return { border: "border-amber-200", bg: "bg-amber-50/70", text: "text-amber-900", iconColor: "text-amber-700", label: "Stale" };
  return { border: "border-rose-200", bg: "bg-rose-50/70", text: "text-rose-900", iconColor: "text-rose-700", label: "Broken" };
};

export const InventoryFeedHealth = () => {
  const qc = useQueryClient();
  const { tenant } = useTenant();
  const tenantId = tenant?.id || null;
  const [pulling, setPulling] = useState(false);

  const { data, refetch } = useQuery({
    queryKey: ["feed_health", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      // Recent autocurb-related events from audit_log. The
      // OR-filter pattern matches the existing audit_log scanner
      // queries elsewhere in the app.
      const { data: events } = await (supabase as any)
        .from("audit_log")
        .select("id, action, created_at, details, user_email")
        .or("action.eq.autocurb_pull_completed,action.eq.autocurb_sync,action.eq.autocurb_notified,action.eq.dms_sync")
        .order("created_at", { ascending: false })
        .limit(20);
      const rows = (events || []) as Array<{
        id: string;
        action: string;
        created_at: string;
        details: unknown;
        user_email: string | null;
      }>;
      const lastPull = rows.find(e => e.action === "autocurb_pull_completed")?.created_at || null;
      const lastSync = rows.find(e => e.action === "autocurb_sync")?.created_at || null;
      const lastDms  = rows.find(e => e.action === "dms_sync")?.created_at || null;
      return { rows, lastPull, lastSync, lastDms };
    },
    staleTime: 30_000,
  });

  const handleManualPull = async () => {
    setPulling(true);
    try {
      // autocurb-pull is the cross-app sync function (CLAUDE.md).
      // It's a no-op in shared-project mode and only calls
      // Autocurb's API in external-project mode.
      const { error } = await supabase.functions.invoke("autocurb-pull");
      if (error) throw new Error(error.message);
      toast.success("Pull triggered — refreshing feed");
      await refetch();
      qc.invalidateQueries({ queryKey: ["dash"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Pull failed");
    } finally {
      setPulling(false);
    }
  };

  const pullTone = toneForAge(data?.lastPull || null);
  const syncTone = toneForAge(data?.lastSync || null);

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <RefreshCw className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Inventory feed health</h3>
            <p className="text-[11px] text-muted-foreground">
              Cross-app sync · Autocurb &harr; AutoLabels
            </p>
          </div>
        </div>
        <button
          onClick={handleManualPull}
          disabled={pulling}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-gradient-to-r from-[#3BB4FF] to-[#1E90FF] text-white text-xs font-display font-black shadow-premium hover:brightness-110 disabled:opacity-60"
        >
          {pulling ? "Pulling…" : <><ArrowDownToLine className="w-3.5 h-3.5" /> Pull from Autocurb</>}
        </button>
      </div>

      {/* Two health badges */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FeedBadge
          icon={ArrowDownToLine}
          label="Last pull · Autocurb → AutoLabels"
          tone={pullTone}
          relative={fmtRelative(data?.lastPull || null)}
          detail={
            data?.lastPull
              ? `${new Date(data.lastPull).toLocaleString()}`
              : "No pull event recorded. The autocurb-pull edge function hasn't reported back yet."
          }
        />
        <FeedBadge
          icon={RefreshCw}
          label="Last entitlement sync · Stripe → AutoLabels"
          tone={syncTone}
          relative={fmtRelative(data?.lastSync || null)}
          detail={
            data?.lastSync
              ? `${new Date(data.lastSync).toLocaleString()}`
              : "Autocurb's stripe-webhook hasn't called autocurb_sync_entitlements yet."
          }
        />
      </div>

      {/* Recent events table */}
      {data?.rows && data.rows.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5">
            Recent events · last 20
          </p>
          <div className="rounded-lg border border-border overflow-hidden max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-[0.12em] text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left px-3 py-1.5 font-bold">When</th>
                  <th className="text-left px-3 py-1.5 font-bold">Action</th>
                  <th className="text-left px-3 py-1.5 font-bold">Actor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rows.map(ev => (
                  <tr key={ev.id}>
                    <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                      <Clock className="w-3 h-3 inline mr-1 opacity-60" />
                      {fmtRelative(ev.created_at)}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11px]">{ev.action}</td>
                    <td className="px-3 py-1.5 text-muted-foreground text-[11px]">
                      {ev.user_email || "system"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

interface FeedBadgeProps {
  icon: typeof RefreshCw;
  label: string;
  tone: ReturnType<typeof toneForAge>;
  relative: string;
  detail: string;
}

const FeedBadge = ({ icon: Icon, label, tone, relative, detail }: FeedBadgeProps) => (
  <div className={`rounded-lg border ${tone.border} ${tone.bg} px-3 py-2.5 flex items-start gap-3`}>
    <div className="w-8 h-8 rounded-md bg-card border border-border flex items-center justify-center flex-shrink-0">
      <Icon className={`w-4 h-4 ${tone.iconColor}`} strokeWidth={2} />
    </div>
    <div className="min-w-0 flex-1">
      <p className={`text-[10px] font-bold uppercase tracking-[0.12em] ${tone.text}`}>{label}</p>
      <p className={`text-base font-display font-bold mt-0.5 ${tone.text}`}>
        {relative}
        <span className={`ml-2 text-[10px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded ${tone.border} bg-card`}>
          {tone.label === "Live" && <CheckCircle2 className="w-2.5 h-2.5 inline mr-0.5" />}
          {tone.label === "Stale" && <AlertTriangle className="w-2.5 h-2.5 inline mr-0.5" />}
          {tone.label === "Broken" && <AlertTriangle className="w-2.5 h-2.5 inline mr-0.5" />}
          {tone.label}
        </span>
      </p>
      <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{detail}</p>
    </div>
  </div>
);

export default InventoryFeedHealth;
