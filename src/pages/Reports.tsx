import { useNavigate } from "react-router-dom";
import { useAutoLabelsReports } from "@/lib/entitlements/useAutoLabelsReports";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { logStickerAudit } from "@/lib/stickerStudio/api";
import FeatureGate from "@/components/entitlements/FeatureGate";
import { BarChart3, ArrowLeft, Download, TrendingUp, FileText, QrCode, DollarSign } from "lucide-react";

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

// Dealer ROI + operations report (/dashboard/reports). Server-backed,
// tenant-scoped; CSV export for the add-on acceptance table.
const Reports = () => {
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const { user } = useAuth();
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

  if (r.loading) return <p className="p-6 text-sm text-muted-foreground">Loading reports…</p>;

  return (
    <div className="p-4 lg:p-6 max-w-[1100px] mx-auto space-y-5">
      <div>
        <button onClick={() => navigate("/dashboard")} className="text-[11px] font-semibold text-blue-600 hover:underline inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> Dashboard</button>
        <h1 className="text-xl font-semibold tracking-tight font-display text-foreground inline-flex items-center gap-2"><BarChart3 className="w-5 h-5 text-primary" /> AutoLabels reports</h1>
        <p className="text-xs text-muted-foreground mt-1">Operational and sales value from your stickers, documents, and customer packets — last 30 days.</p>
      </div>

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
    </div>
  );
};

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
