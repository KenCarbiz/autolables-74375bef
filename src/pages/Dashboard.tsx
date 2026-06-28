import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useAudit } from "@/contexts/AuditContext";
import { usePredictiveAcceptance } from "@/hooks/usePredictiveAcceptance";
import { useNavigate } from "react-router-dom";
import { format, isToday, isThisWeek, isThisMonth } from "date-fns";
import {
  FileText,
  CheckCircle2,
  DollarSign,
  TrendingUp,
  Plus,
  ArrowUpRight,
  Clock,
  Sparkles,
  Filter,
  Search,
  ChevronRight,
} from "lucide-react";

// Shape of an addendum row as the dashboard reads it. The query returns
// loosely-typed rows (PostgREST), so this names just the fields used here;
// JSON-blob columns stay `any` to preserve the existing untyped handling.
interface DashAddendum {
  id: string;
  status: string;
  created_at: string;
  customer_name?: string | null;
  vehicle_ymm?: string | null;
  total_with_optional?: number | null;
  signing_token?: string | null;
  rate?: any;
  optional_selections?: any;
  products_snapshot?: any;
}

const Dashboard = () => {
  const { user } = useAuth();
  const { currentStore, tenant } = useTenant();
  const { entries } = useAudit();
  const { predictForVehicle } = usePredictiveAcceptance();
  const navigate = useNavigate();

  const { data: addendums } = useQuery({
    queryKey: ["addendums-dashboard", tenant?.id, currentStore?.id],
    queryFn: async () => {
      try {
        let q = supabase
          .from("addendums")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(500);
        if (tenant?.id) {
          q = q.or(`tenant_id.eq.${tenant.id},tenant_id.is.null`);
        }
        const { data, error } = await q;
        if (error) {
          console.warn("addendums query failed:", error.message);
          return [];
        }
        return data || [];
      } catch (err) {
        console.warn("addendums query threw:", err);
        return [];
      }
    },
    enabled: !!user,
  });

  const all: DashAddendum[] = addendums || [];
  const signed = all.filter(a => a.status === "signed");
  const drafts = all.filter(a => a.status === "draft");

  const signedToday = signed.filter(a => isToday(new Date(a.created_at)));
  const signedWeek = signed.filter(a => isThisWeek(new Date(a.created_at)));
  const createdThisMonth = all.filter(a => isThisMonth(new Date(a.created_at)));
  const revenueMonth = createdThisMonth.reduce((sum, a) => sum + (Number(a.total_with_optional) || 0), 0);
  const revenueWeek = signedWeek.reduce((sum, a) => sum + (Number(a.total_with_optional) || 0), 0);

  const recentAddendums = all.slice(0, 8);
  const recentActivity = entries.slice(-10).reverse();

  // Top products by acceptance
  const productStats: Record<string, { name: string; accepted: number; declined: number }> = {};
  for (const a of all) {
    const products = (a.products_snapshot as Array<{ id: string; name: string; badge_type: string }>) || [];
    const selections = (a.optional_selections as Record<string, string>) || {};
    for (const p of products) {
      if (p.badge_type === "optional") {
        if (!productStats[p.id]) productStats[p.id] = { name: p.name, accepted: 0, declined: 0 };
        if (selections[p.id] === "accept") productStats[p.id].accepted++;
        else if (selections[p.id] === "decline") productStats[p.id].declined++;
      }
    }
  }
  const topProducts = Object.values(productStats)
    .map(ps => ({ ...ps, rate: ps.accepted + ps.declined > 0 ? Math.round((ps.accepted / (ps.accepted + ps.declined)) * 100) : 0 }))
    .filter(p => p.accepted + p.declined > 0)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 5);

  return (
    <div className="p-4 lg:p-6 max-w-[1400px] mx-auto space-y-5">
      {/* Status pills bar (HarteCash style) */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 text-xs flex-wrap">
          <StatusPill dotColor="bg-red-500" label="Needs Follow-Up" value={drafts.length} />
          <StatusPill dotColor="bg-amber-500" label="Pending Signatures" value={drafts.filter(d => d.signing_token).length} />
          <StatusPill dotColor="bg-emerald-500" label="Signed Today" value={signedToday.length} />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>Total Addendums: <strong className="text-foreground">{all.length}</strong></span>
          <span>Revenue MTD: <strong className="text-foreground">${revenueMonth.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></span>
        </div>
      </div>

      {/* Analytics section header */}
      <div className="flex items-center justify-between mt-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-label text-muted-foreground">
          Analytics
        </h2>
        <button className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-card border border-border text-xs font-medium hover:bg-muted transition-colors">
          All Time
          <ChevronRight className="w-3 h-3 rotate-90" />
        </button>
      </div>

      {/* HarteCash gradient stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <GradientStatCard
          className="stat-card-blue"
          label="TOTAL ADDENDUMS"
          value={all.length.toString()}
          sublabel={`${signed.length} signed · ${drafts.length} drafts`}
        />
        <GradientStatCard
          className="stat-card-green"
          label="SIGN RATE"
          value={all.length > 0 ? `${Math.round((signed.length / all.length) * 100)}%` : "0%"}
          sublabel={`${signed.length} of ${all.length} addendums`}
        />
        <GradientStatCard
          className="stat-card-orange"
          label="REVENUE MTD"
          value={`$${revenueMonth >= 1000 ? `${(revenueMonth / 1000).toFixed(0)}k` : revenueMonth.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          sublabel={`$${revenueWeek.toLocaleString(undefined, { maximumFractionDigits: 0 })} this week`}
        />
        <GradientStatCard
          className="stat-card-purple"
          label="AVG TICKET"
          value={all.length > 0 ? `$${Math.round(revenueMonth / Math.max(createdThisMonth.length, 1)).toLocaleString()}` : "$0"}
          sublabel={`${createdThisMonth.length} this month`}
        />
      </div>

      {/* Quick stat row (white cards like Docs Uploaded etc.) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <QuickStat icon={FileText} iconColor="text-amber-500" value={drafts.length} label="Drafts" />
        <QuickStat icon={CheckCircle2} iconColor="text-emerald-500" value={signedWeek.length} label="Signed This Week" />
        <QuickStat icon={TrendingUp} iconColor="text-blue-500" value={topProducts[0]?.rate || 0} label="Top Product Rate" suffix="%" />
        <QuickStat icon={DollarSign} iconColor="text-purple-500" value={all.length > 0 ? Math.round(revenueMonth / Math.max(all.length, 1)) : 0} label="Avg PVR" prefix="$" />
      </div>

      {/* Pipeline overview — HarteCash-style segmented bar */}
      <div className="bg-card rounded-xl border border-border shadow-premium p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-label text-muted-foreground">Pipeline Overview</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Addendum workflow by status</p>
          </div>
        </div>
        <div className="flex rounded-lg overflow-hidden h-8 bg-muted">
          <PipelineSegment color="bg-blue-500" count={drafts.length} total={all.length} label="Drafts" />
          <PipelineSegment color="bg-amber-500" count={drafts.filter(d => d.signing_token).length} total={all.length} label="Sent" />
          <PipelineSegment color="bg-emerald-500" count={signed.length} total={all.length} label="Signed" />
        </div>
        <div className="flex items-center gap-6 mt-3 text-xs flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-muted-foreground">Drafts: <strong className="text-foreground">{drafts.length}</strong></span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-muted-foreground">Sent: <strong className="text-foreground">{drafts.filter(d => d.signing_token).length}</strong></span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">Signed: <strong className="text-foreground">{signed.length}</strong></span>
          </div>
        </div>
      </div>

      {/* Search and filters (HarteCash style) */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search addendums..."
            className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <button className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-xs font-medium hover:bg-muted transition-colors">
          <Filter className="w-3.5 h-3.5" />
          Filter
        </button>
        <button
          onClick={() => navigate("/addendum")}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90"
        >
          <Plus className="w-3.5 h-3.5" />
          New Addendum
        </button>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Recent addendums table */}
        <div className="lg:col-span-2 bg-card rounded-xl border border-border shadow-premium overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Recent Addendums</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Latest activity across your store</p>
            </div>
            <button
              onClick={() => navigate("/saved")}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              View all
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-5 py-2.5 font-semibold">Date</th>
                <th className="text-left py-2.5 font-semibold">Customer</th>
                <th className="text-left py-2.5 font-semibold">Vehicle</th>
                <th className="text-right px-5 py-2.5 font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {recentAddendums.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center">
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                      <FileText className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-foreground">No addendums yet</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Create your first addendum to see it here
                    </p>
                    <button
                      onClick={() => navigate("/addendum")}
                      className="mt-4 inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      New Addendum
                    </button>
                  </td>
                </tr>
              ) : (
                recentAddendums.map(a => (
                  <tr
                    key={a.id}
                    className="border-t border-border hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => navigate(`/addendum?id=${a.id}`)}
                  >
                    <td className="px-5 py-3 text-xs text-muted-foreground tabular-nums">
                      {format(new Date(a.created_at), "M/d/yyyy")}
                    </td>
                    <td className="py-3 text-sm">
                      <div className="font-medium text-foreground">
                        {a.customer_name || "—"}
                      </div>
                      <span className={`inline-block mt-0.5 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        a.status === "signed" ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"
                      }`}>
                        {a.status}
                      </span>
                    </td>
                    <td className="py-3 text-sm text-foreground">
                      {a.vehicle_ymm || "—"}
                    </td>
                    <td className="px-5 py-3 text-right text-sm font-semibold text-foreground tabular-nums">
                      {a.total_with_optional != null ? `$${Number(a.total_with_optional).toLocaleString()}` : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Right column: top products + activity */}
        <div className="space-y-5">
          {/* Top products */}
          <div className="bg-card rounded-xl border border-border shadow-premium">
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Top Products</h3>
              <p className="text-xs text-muted-foreground mt-0.5">By acceptance rate</p>
            </div>
            <div className="px-5 py-3">
              {topProducts.length === 0 ? (
                <div className="py-6 text-center">
                  <Sparkles className="w-5 h-5 text-muted-foreground mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">No data yet</p>
                </div>
              ) : (
                topProducts.map((p, i) => (
                  <div key={i} className="flex items-center gap-3 py-2">
                    <span className="text-xs text-muted-foreground font-mono w-4 tabular-nums">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{p.name}</p>
                      <div className="w-full h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full"
                          style={{ width: `${p.rate}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-foreground tabular-nums">{p.rate}%</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Activity feed */}
          <div className="bg-card rounded-xl border border-border shadow-premium">
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Recent Activity</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Compliance log</p>
            </div>
            <div>
              {recentActivity.length === 0 ? (
                <div className="px-5 py-6 text-center">
                  <Clock className="w-5 h-5 text-muted-foreground mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">No activity yet</p>
                </div>
              ) : (
                recentActivity.map(e => (
                  <div key={e.id} className="px-5 py-2.5 border-b border-border last:border-0">
                    <p className="text-xs font-medium text-foreground capitalize">
                      {e.action.replace(/_/g, " ")}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {format(new Date(e.created_at), "MMM d, h:mm a")}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const StatusPill = ({ dotColor, label, value }: { dotColor: string; label: string; value: number }) => (
  <div className="inline-flex items-center gap-1.5 text-xs">
    <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
    <span className="text-muted-foreground">{label}:</span>
    <span className="font-semibold text-foreground tabular-nums">{value}</span>
  </div>
);

const GradientStatCard = ({
  className,
  label,
  value,
  sublabel,
}: {
  className: string;
  label: string;
  value: string;
  sublabel: string;
}) => (
  <div className={`rounded-xl p-5 shadow-premium ${className} relative overflow-hidden`}>
    <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-white/10 -mr-8 -mt-8" />
    <div className="relative">
      <p className="text-[10px] font-semibold uppercase tracking-label text-white/80">{label}</p>
      <p className="text-3xl font-semibold tracking-tight mt-1 font-display tabular-nums">{value}</p>
      <p className="text-[11px] text-white/70 mt-1">{sublabel}</p>
    </div>
  </div>
);

const QuickStat = ({
  icon: Icon,
  iconColor,
  value,
  label,
  prefix,
  suffix,
}: {
  icon: typeof FileText;
  iconColor: string;
  value: number;
  label: string;
  prefix?: string;
  suffix?: string;
}) => (
  <div className="bg-card rounded-xl border border-border p-4 shadow-premium hover:shadow-premium-md transition-shadow">
    <Icon className={`w-4 h-4 ${iconColor} mb-2`} />
    <div className="text-2xl font-semibold tracking-tight text-foreground font-display tabular-nums">
      {prefix}{value.toLocaleString()}{suffix}
    </div>
    <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
  </div>
);

const PipelineSegment = ({
  color,
  count,
  total,
  label,
}: {
  color: string;
  count: number;
  total: number;
  label: string;
}) => {
  if (total === 0 || count === 0) return null;
  const pct = (count / total) * 100;
  return (
    <div
      className={`${color} flex items-center justify-center text-[10px] font-semibold text-white relative group`}
      style={{ width: `${pct}%` }}
      title={`${label}: ${count}`}
    >
      {pct > 10 && <span>{count}</span>}
    </div>
  );
};

export default Dashboard;
