import { useNavigate, useSearchParams } from "react-router-dom";
import { useAutoLabelsReports } from "@/lib/entitlements/useAutoLabelsReports";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useAudit } from "@/contexts/AuditContext";
import { logStickerAudit } from "@/lib/stickerStudio/api";
import FeatureGate from "@/components/entitlements/FeatureGate";
import SigningFunnelWidget from "@/components/admin/SigningFunnelWidget";
import { OpenSigningsList } from "@/components/admin/OpenSigningsList";
import { format } from "date-fns";
import { BarChart3, ArrowLeft, ArrowUpRight, CheckCircle2, Download, TrendingUp, FileText, QrCode, DollarSign } from "lucide-react";

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

type ReportsTab = "roi" | "analytics" | "signings";

const TABS: { id: ReportsTab; label: string }[] = [
  { id: "roi", label: "ROI" },
  { id: "analytics", label: "Analytics" },
  { id: "signings", label: "Deal Signings" },
];

// Single reports home (/dashboard/reports): ROI (server-backed, tenant-scoped),
// addendum analytics (moved from /admin?tab=analytics), and the signing funnel
// (moved from /admin?tab=funnel).
const Reports = () => {
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: ReportsTab = tabParam === "analytics" || tabParam === "signings" ? tabParam : "roi";
  const setTab = (t: ReportsTab) => setSearchParams(t === "roi" ? {} : { tab: t }, { replace: true });
  const r = useAutoLabelsReports(30);
  const maxGen = Math.max(1, ...r.genByDay.map((d) => d.count));
  const maxQr = Math.max(1, ...r.qrByDay.map((d) => d.count));

  const exportCsv = () => {
    const rows = [
      ["Add-on", "Shown", "Accepted", "Declined", "Acceptance %", "Accepted revenue", "Avg price"],
      ...r.addons.map((a) => [a.name, a.shown, a.accepted, a.declined, `${a.rate}%`, a.revenue, a.avgPrice]),
    ];
    const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `autolabels-addon-acceptance-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    logStickerAudit("report_exported", { tenantId: tenant?.id, entityType: "report", entityId: "addon_acceptance", details: { range_days: 30, by: user?.id } });
  };

  return (
    <div className="p-4 lg:p-6 max-w-[1100px] mx-auto space-y-5">
      <div>
        <button onClick={() => navigate("/dashboard")} className="text-[11px] font-semibold text-blue-600 hover:underline inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> Dashboard</button>
        <h1 className="text-xl font-semibold tracking-tight font-display text-foreground inline-flex items-center gap-2"><BarChart3 className="w-5 h-5 text-primary" /> Reports</h1>
        <p className="text-xs text-muted-foreground mt-1">Operational and sales value from your stickers, documents, and customer packets.</p>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-muted/60 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`h-8 px-3.5 rounded-lg text-[13px] font-semibold whitespace-nowrap transition-all ${
                tab === t.id ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "roi" && (
        r.loading ? (
          <p className="text-sm text-muted-foreground">Loading reports…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Kpi icon={FileText} label="Stickers generated" value={r.generated} />
              <Kpi icon={FileText} label="Printed" value={r.printed} />
              <Kpi icon={FileText} label="Published" value={r.published} />
              <Kpi icon={FileText} label="Pending approval" value={r.pendingApproval} />
              <Kpi icon={QrCode} label="QR scans" value={r.qrScans} />
              <Kpi icon={FileText} label="Packets signed" value={r.packetsSigned} />
              <Kpi icon={DollarSign} label="Accepted add-on $" value={r.acceptedAddonRevenue} money />
              <Kpi icon={TrendingUp} label="Add-ons tracked" value={r.addons.length} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Chart title="Stickers generated" data={r.genByDay} max={maxGen} color="bg-blue-500/80" />
              <Chart title="QR scans" data={r.qrByDay} max={maxQr} color="bg-emerald-500/80" />
            </div>

            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-foreground">Add-on acceptance</h2>
                <FeatureGate feature="qr_tracking" variant="hide">
                  <button onClick={exportCsv} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs font-semibold hover:bg-muted"><Download className="w-3.5 h-3.5" /> Export CSV</button>
                </FeatureGate>
              </div>
              {r.addons.length === 0 ? (
                <p className="text-xs text-muted-foreground">No optional add-on selections recorded in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground text-left border-b border-border">
                        <th className="py-1.5 pr-3">Add-on</th><th className="py-1.5 px-2 text-right">Shown</th><th className="py-1.5 px-2 text-right">Accepted</th>
                        <th className="py-1.5 px-2 text-right">Rate</th><th className="py-1.5 px-2 text-right">Revenue</th><th className="py-1.5 pl-2 text-right">Avg</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.addons.map((a) => (
                        <tr key={a.id} className="border-b border-border last:border-0">
                          <td className="py-1.5 pr-3 font-medium text-foreground">{a.name}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{a.shown}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-foreground">{a.accepted}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums"><span className={a.rate >= 50 ? "text-emerald-600" : "text-muted-foreground"}>{a.rate}%</span></td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-foreground">{money(a.revenue)}</td>
                          <td className="py-1.5 pl-2 text-right tabular-nums text-muted-foreground">{money(a.avgPrice)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )
      )}

      {tab === "analytics" && <AnalyticsTab />}

      {tab === "signings" && (
        <div className="space-y-4">
          <SigningFunnelWidget />
          <OpenSigningsList />
        </div>
      )}
    </div>
  );
};

// Addendum analytics, relocated from /admin?tab=analytics.
const AnalyticsTab = () => {
  const { entries: auditEntries } = useAudit();
  const { currentStore } = useTenant();
  const storeEntries = auditEntries.filter((e) => e.store_id === (currentStore?.id || ""));
  const created = storeEntries.filter((e) => e.action === "addendum_created").length;
  const sent = storeEntries.filter((e) => e.action === "addendum_sent").length;
  const printed = storeEntries.filter((e) => e.action === "addendum_printed").length;
  const pdfs = storeEntries.filter((e) => e.action === "addendum_pdf").length;

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border border-border shadow-premium p-5">
        <div className="flex items-center gap-2 mb-1">
          <BarChart3 className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-foreground">Addendum Analytics</h3>
        </div>
        <p className="text-xs text-muted-foreground">Performance metrics from your saved addendums.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatMini icon={FileText} label="Addendums Created" value={created} color="text-blue-600" />
        <StatMini icon={ArrowUpRight} label="Sent to Customer" value={sent} color="text-emerald-600" />
        <StatMini icon={Download} label="PDFs Generated" value={pdfs} color="text-purple-600" />
        <StatMini icon={CheckCircle2} label="Printed" value={printed} color="text-amber-600" />
      </div>

      <div className="bg-card rounded-xl border border-border shadow-premium p-5">
        <h4 className="text-sm font-semibold text-foreground mb-3">Recent Compliance Events</h4>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {storeEntries.slice(-20).reverse().map((e) => (
            <div key={e.id} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
              <div>
                <p className="text-xs font-medium text-foreground capitalize">{e.action.replace(/_/g, " ")}</p>
                <p className="text-[10px] text-muted-foreground">{e.entity_type} · {e.entity_id || "—"}</p>
              </div>
              <span className="text-[10px] text-muted-foreground tabular-nums">{format(new Date(e.created_at), "M/d h:mm a")}</span>
            </div>
          ))}
          {storeEntries.length === 0 && (
            <p className="text-xs text-muted-foreground py-6 text-center">No analytics data yet. Create and sign addendums to see metrics.</p>
          )}
        </div>
      </div>
    </div>
  );
};

const StatMini = ({ icon: Icon, label, value, color }: { icon: typeof FileText; label: string; value: number; color: string }) => (
  <div className="bg-card rounded-xl border border-border shadow-premium p-4">
    <Icon className={`w-4 h-4 ${color} mb-2`} />
    <div className="text-2xl font-semibold tracking-tight font-display tabular-nums text-foreground">{value}</div>
    <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
  </div>
);

const Kpi = ({ icon: Icon, label, value, money: isMoney }: { icon: typeof FileText; label: string; value: number; money?: boolean }) => (
  <div className="rounded-2xl border border-border bg-card p-4">
    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1"><Icon className="w-3 h-3" /> {label}</p>
    <p className="text-2xl font-black text-foreground mt-1 tabular-nums">{isMoney ? money(value) : value.toLocaleString()}</p>
  </div>
);

const Chart = ({ title, data, max, color }: { title: string; data: { day: string; count: number }[]; max: number; color: string }) => (
  <div className="rounded-2xl border border-border bg-card p-4">
    <h2 className="text-sm font-bold text-foreground inline-flex items-center gap-1.5 mb-3"><TrendingUp className="w-4 h-4 text-primary" /> {title}</h2>
    <div className="flex items-end gap-0.5 h-24">
      {data.map((d) => (
        <div key={d.day} className="flex-1 flex flex-col items-center justify-end" title={`${d.day}: ${d.count}`}>
          <div className={`w-full rounded-t ${color}`} style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count ? 2 : 0 }} />
        </div>
      ))}
    </div>
  </div>
);

export default Reports;
