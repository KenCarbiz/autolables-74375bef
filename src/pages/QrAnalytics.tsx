import { useNavigate } from "react-router-dom";
import { useQrAnalytics } from "@/lib/stickerStudio/useQrAnalytics";
import { QrCode, TrendingUp, Smartphone, Monitor, Tablet, ArrowLeft } from "lucide-react";

// Dealer QR scan analytics dashboard (/dashboard/qr-analytics). Reads
// tenant-scoped qr_scan_events; resilient when the analytics tables aren't
// deployed yet.
const QrAnalytics = () => {
  const navigate = useNavigate();
  const a = useQrAnalytics(30);
  const maxDay = Math.max(1, ...a.byDay.map((d) => d.count));

  if (a.loading) return <p className="p-6 text-sm text-muted-foreground">Loading scan analytics…</p>;

  return (
    <div className="p-4 lg:p-6 max-w-[1100px] mx-auto space-y-5">
      <div>
        <button onClick={() => navigate("/dashboard")} className="text-[11px] font-semibold text-blue-600 hover:underline inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> Dashboard</button>
        <h1 className="text-xl font-semibold tracking-tight font-display text-foreground inline-flex items-center gap-2"><QrCode className="w-5 h-5 text-primary" /> QR scan analytics</h1>
        <p className="text-xs text-muted-foreground mt-1">How shoppers are engaging with the QR codes on your printed stickers — last 30 days.</p>
      </div>

      {!a.available ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <QrCode className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm font-semibold text-foreground">QR analytics not available yet</p>
          <p className="text-xs text-muted-foreground mt-1">Apply migration <span className="font-mono">20260620120000_qr_scan_analytics.sql</span> to start recording scans.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi label="Total scans" value={a.total} />
            <Kpi label="Window sticker" value={a.byType.window || 0} />
            <Kpi label="Addendum" value={a.byType.addendum || 0} />
            <Kpi label="Vehicles scanned" value={a.topVehicles.length} />
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="text-sm font-bold text-foreground inline-flex items-center gap-1.5 mb-3"><TrendingUp className="w-4 h-4 text-primary" /> Scans over time</h2>
            {a.total === 0 ? (
              <p className="text-xs text-muted-foreground">No scans recorded yet. They appear here as shoppers scan your stickers.</p>
            ) : (
              <div className="flex items-end gap-0.5 h-28">
                {a.byDay.map((d) => (
                  <div key={d.day} className="flex-1 flex flex-col items-center justify-end" title={`${d.day}: ${d.count}`}>
                    <div className="w-full rounded-t bg-blue-500/80" style={{ height: `${(d.count / maxDay) * 100}%`, minHeight: d.count ? 2 : 0 }} />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-border bg-card p-4">
              <h2 className="text-sm font-bold text-foreground mb-2">Most scanned vehicles</h2>
              {a.topVehicles.length === 0 ? <p className="text-xs text-muted-foreground">No scans yet.</p> : (
                <div className="space-y-1.5">
                  {a.topVehicles.map((v) => (
                    <button key={v.vehicle_id} onClick={() => navigate(`/vehicle-file/${v.vehicle_id}`)} className="w-full flex items-center justify-between text-left rounded-lg border border-border px-3 py-2 hover:bg-muted">
                      <span className="text-[11px] font-mono text-muted-foreground truncate">{v.vehicle_id.slice(0, 8)}…</span>
                      <span className="text-sm font-semibold text-foreground">{v.count} scans</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-card p-4">
              <h2 className="text-sm font-bold text-foreground mb-2">Latest scans</h2>
              {a.latest.length === 0 ? <p className="text-xs text-muted-foreground">No scans yet.</p> : (
                <div className="space-y-1">
                  {a.latest.map((e) => {
                    const Icon = e.device_type === "mobile" ? Smartphone : e.device_type === "tablet" ? Tablet : Monitor;
                    return (
                      <div key={e.id} className="flex items-center gap-2 text-[11px] text-muted-foreground py-1 border-b border-border last:border-0">
                        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="font-semibold text-foreground capitalize">{e.sticker_type || "?"}</span>
                        <span>· {e.browser || "—"}</span>
                        <span className="ml-auto">{new Date(e.scanned_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const Kpi = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-2xl border border-border bg-card p-4">
    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className="text-2xl font-black text-foreground mt-1 tabular-nums">{value.toLocaleString()}</p>
  </div>
);

export default QrAnalytics;
