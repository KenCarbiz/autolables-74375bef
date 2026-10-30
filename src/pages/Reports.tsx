import { Children, useState, type ComponentType, type ReactElement, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, LocalTabs, MetricStrip, PageBody, PageHeader, type LocalTab } from "@/components/product";
import { format } from "date-fns";
import {
  AlertTriangle, ArrowLeft, ArrowUpRight, BarChart3, Car, CheckCircle2, Download, DollarSign,
  FileText, QrCode, ShieldCheck, TrendingUp, Wrench,
} from "lucide-react";
import { useAutoLabelsReports } from "@/lib/entitlements/useAutoLabelsReports";
import { useOperatingMetrics } from "@/hooks/useOperatingMetrics";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useAudit } from "@/contexts/AuditContext";
import { logStickerAudit } from "@/lib/stickerStudio/api";
import FeatureGate from "@/components/entitlements/FeatureGate";
import SigningFunnelWidget from "@/components/admin/SigningFunnelWidget";
import { OpenSigningsList } from "@/components/admin/OpenSigningsList";

// Reports — six views over one dealership.
//
// Every number here carries the population it counted and the window it
// counted over: "235 stickers, last 30 days" and "134 vehicles, current
// snapshot" are different kinds of number and reading them side by side
// without that label is how a period total gets mistaken for inventory.

const WINDOW_DAYS = 30;
const LAST_30 = "Last 30 days";
const CREATED_30 = "Created in the last 30 days";
const SNAPSHOT = "Current snapshot";
const NO_DATA = "No data in this time period.";

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

type ReportView = "operations" | "inventory" | "get-ready" | "customers" | "compliance" | "roi";

const VIEWS: { id: ReportView; label: string }[] = [
  { id: "operations", label: "Operations" },
  { id: "inventory", label: "Inventory" },
  { id: "get-ready", label: "Get Ready" },
  { id: "customers", label: "Customers" },
  { id: "compliance", label: "Compliance" },
  { id: "roi", label: "Platform ROI" },
];

// /admin still deep-links with the pre-split tab names.
const LEGACY_VIEWS: Record<string, ReportView> = {
  analytics: "compliance",
  signings: "customers",
};

const resolveView = (raw: string | null): ReportView => {
  if (!raw) return "operations";
  if (VIEWS.some((v) => v.id === raw)) return raw as ReportView;
  return LEGACY_VIEWS[raw] ?? "operations";
};

interface KpiProps {
  label: string;
  value: number | string;
  /** Population and window. Required: a count with no stated scope is not a metric. */
  scope: string;
  icon?: ComponentType<{ className?: string }>;
  money?: boolean;
}

// A Kpi is declared as an element so every metric states its scope, then
// laid out by Strip as a flat metric strip of four or fewer per row.
const Kpi = (_: KpiProps) => null;

const Strip = ({ children }: { children: ReactNode }) => {
  const items = Children.toArray(children) as ReactElement<KpiProps>[];
  const rows: ReactElement<KpiProps>[][] = [];
  for (let i = 0; i < items.length; i += 4) rows.push(items.slice(i, i + 4));
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, i) => (
        <MetricStrip
          key={i}
          label="Report metrics"
          metrics={row.map((e) => ({
            label: e.props.label,
            value: typeof e.props.value === "number" ? (e.props.money ? money(e.props.value) : e.props.value.toLocaleString()) : e.props.value,
            hint: e.props.scope,
          }))}
        />
      ))}
    </div>
  );
};

const ViewHeader = ({ title, scope }: { title: string; scope: string }) => (
  <div>
    <h2 className="text-[17px] leading-[24px] font-semibold text-adm-ink">{title}</h2>
    <p className="text-[12px] leading-[18px] text-adm-muted mt-0.5">{scope}</p>
  </div>
);

const DailyChart = ({ title, data, days }: { title: string; data: { day: string; count: number }[]; days: number }) => {
  const total = data.reduce((n, d) => n + d.count, 0);
  const max = Math.max(1, ...data.map((d) => d.count));
  const W = 580;
  const H = 180;
  const L = 32;
  const B = 26;
  const step = data.length > 1 ? (W - L - 8) / (data.length - 1) : 0;
  const y = (c: number) => H - B - (c / max) * (H - B - 12);
  const pts = data.map((d, i) => `${L + i * step},${y(d.count)}`);
  const ticks = max >= 4 ? [0, Math.round(max / 4), Math.round(max / 2), Math.round((3 * max) / 4), max].filter((t, i, a) => a.indexOf(t) === i) : [0, Math.ceil(max / 2), max];
  const labelAt = data.length > 1 ? [0, 1, 2, 3, 4].map((k) => Math.round((k * (data.length - 1)) / 4)).filter((v, i, a) => a.indexOf(v) === i) : [0];
  return (
    <section className="rounded-[6px] border border-adm-border bg-adm-surface p-4">
      <h3 className="text-[16px] leading-[22px] font-semibold text-adm-ink">{title}</h3>
      <p className="text-[13px] leading-[18px] text-adm-muted">Daily count, last {days} days, {total.toLocaleString()} total</p>
      {total === 0 ? (
        <p className="text-[14px] leading-[20px] text-adm-muted mt-4">{NO_DATA}</p>
      ) : (
        <svg role="img" viewBox={`0 0 ${W} ${H}`} className="mt-3 h-auto w-full" aria-label={`${title}: ${total} over the last ${days} days, peak ${max} in one day`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} stroke="#E3E7EC" />
              <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="12" fill="#5B6578">{t}</text>
            </g>
          ))}
          <polygon points={`${L},${H - B} ${pts.join(" ")} ${L + (data.length - 1) * step},${H - B}`} fill="#2457D6" opacity="0.1" />
          <polyline points={pts.join(" ")} fill="none" stroke="#2457D6" strokeWidth="2" strokeLinejoin="round" />
          {data.map((d, i) => <circle key={d.day} cx={L + i * step} cy={y(d.count)} r="2.5" fill="#2457D6" />)}
          {labelAt.map((i, k) => (
            <text key={data[i].day} x={L + i * step} y={H - 6} textAnchor={k === 0 ? "start" : k === labelAt.length - 1 ? "end" : "middle"} fontSize="12" fill="#5B6578">{data[i].day.slice(5)}</text>
          ))}
        </svg>
      )}
    </section>
  );
};

const weeklyRows = (data: { day: string; count: number }[]) => {
  const rows: { range: string; count: number; days: number }[] = [];
  for (let i = 0; i < data.length; i += 7) {
    const chunk = data.slice(i, i + 7);
    rows.push({ range: `${chunk[0].day} to ${chunk[chunk.length - 1].day}`, count: chunk.reduce((n, d) => n + d.count, 0), days: chunk.length });
  }
  return rows;
};

const Reports = () => {
  const { tenant, currentStore } = useTenant();
  const { user } = useAuth();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const [searchParams, setSearchParams] = useSearchParams();
  const view = resolveView(searchParams.get("tab"));

  const [days, setDays] = useState(WINDOW_DAYS);
  const [draftDays, setDraftDays] = useState(WINDOW_DAYS);
  const r = useAutoLabelsReports(days);
  const { metrics, loading: metricsLoading, error: metricsError } = useOperatingMetrics(tenantId);
  const { entries: auditEntries } = useAudit();

  const storeEntries = auditEntries.filter((e) => e.store_id === (currentStore?.id || ""));
  const auditCount = (action: string) => storeEntries.filter((e) => e.action === action).length;

  const addonShown = r.addons.reduce((n, a) => n + a.shown, 0);
  const addonAccepted = r.addons.reduce((n, a) => n + a.accepted, 0);
  const addonDeclined = r.addons.reduce((n, a) => n + a.declined, 0);
  const addonRate = addonAccepted + addonDeclined > 0
    ? Math.round((addonAccepted / (addonAccepted + addonDeclined)) * 100) : null;

  const docTypes = Object.entries(r.byType).sort((a, b) => b[1] - a[1]);

  const exportCsv = () => {
    const rows = [
      ["Add-on", "Shown", "Accepted", "Declined", "Acceptance %", "Accepted revenue", "Avg price"],
      ...r.addons.map((a) => [a.name, a.shown, a.accepted, a.declined, `${a.rate}%`, a.revenue, a.avgPrice]),
    ];
    const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `autolabels-addon-acceptance-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    logStickerAudit("report_exported", {
      tenantId: tenant?.id, entityType: "report", entityId: "addon_acceptance",
      details: { range_days: WINDOW_DAYS, by: user?.id },
    });
  };

  const snapshotUnavailable = !tenantId
    ? "Select a dealership to see its current inventory snapshot."
    : metricsError
      ? `Inventory counts unavailable: ${metricsError}`
      : null;

  return (
    <PageBody width="wide">
      <PageHeader title="Reports" />

      <LocalTabs
        label="Report views"
        tabs={VIEWS.map((v): LocalTab => ({ key: v.id, label: v.label, to: v.id === "operations" ? "/dashboard/reports" : `/dashboard/reports?tab=${v.id}`, active: view === v.id }))}
      />

      {view === "operations" && (
        <section className="flex flex-col gap-4">
          <form
            aria-label="Report filters"
            className="flex flex-wrap items-center gap-x-5 gap-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setDays(draftDays);
            }}
          >
            <label className="flex items-center gap-2 text-[13px] leading-[18px] text-adm-ink">
              Timezone
              <select className="h-10 min-w-[170px] rounded-md border border-adm-border bg-adm-surface px-3 text-[14px]" disabled value="local">
                <option value="local">{Intl.DateTimeFormat().resolvedOptions().timeZone}</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-[13px] leading-[18px] text-adm-ink">
              Scope
              <select className="h-10 min-w-[170px] rounded-md border border-adm-border bg-adm-surface px-3 text-[14px]" disabled value="store">
                <option value="store">{currentStore?.name || tenant?.name || "This dealership"}</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-[13px] leading-[18px] text-adm-ink">
              Date range
              <select className="h-10 min-w-[170px] rounded-md border border-adm-border bg-adm-surface px-3 text-[14px]" value={draftDays} onChange={(e) => setDraftDays(Number(e.target.value))}>
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            </label>
            <Button type="submit" variant="primary" className="ml-auto min-h-[40px] px-6">Run report</Button>
          </form>
          {r.loading ? (
            <p className="text-[14px] leading-[20px] text-adm-muted">Loading the last {days} days…</p>
          ) : (
            <>
              <Strip>
                <Kpi label="Stickers generated" value={r.generated} scope={`Last ${days} days`} />
                <Kpi label="Printed" value={r.printed} scope={CREATED_30.replace("30", String(days))} />
                <Kpi label="Published documents" value={r.published} scope={CREATED_30.replace("30", String(days))} />
                <Kpi label="Pending approval" value={r.pendingApproval} scope={CREATED_30.replace("30", String(days))} />
              </Strip>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] items-start">
                <DailyChart title="Documents generated" data={r.genByDay} days={days} />
                <section className="rounded-[6px] border border-adm-border bg-adm-surface">
                  <h3 className="px-4 pt-4 text-[16px] leading-[22px] font-semibold text-adm-ink">Activity by week</h3>
                  <table className="mt-3 w-full text-left text-[14px] leading-[20px]">
                    <thead>
                      <tr className="bg-adm-workspace text-[12px] leading-[18px] font-semibold text-adm-muted">
                        <th className="px-4 py-2.5">Week</th>
                        <th className="px-4 py-2.5 text-right">Generated</th>
                        <th className="px-4 py-2.5 text-right">Daily average</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weeklyRows(r.genByDay).map((w) => (
                        <tr key={w.range} className="border-t border-adm-border">
                          <td className="px-4 py-2.5 text-adm-ink">{w.range}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-adm-ink">{w.count.toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-adm-ink">{(w.count / w.days).toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </div>

              <section className="rounded-[6px] border border-adm-border bg-adm-surface">
                <h3 className="px-4 pt-4 text-[16px] leading-[22px] font-semibold text-adm-ink">Documents by type</h3>
                {docTypes.length === 0 ? (
                  <p className="px-4 pb-4 pt-2 text-[14px] leading-[20px] text-adm-muted">{NO_DATA}</p>
                ) : (
                  <table className="mt-3 w-full text-left text-[14px] leading-[20px]">
                    <thead>
                      <tr className="bg-adm-workspace text-[12px] leading-[18px] font-semibold text-adm-muted">
                        <th className="px-4 py-2.5">Document type</th>
                        <th className="px-4 py-2.5 text-right">Generated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {docTypes.map(([type, count]) => (
                        <tr key={type} className="border-t border-adm-border">
                          <td className="px-4 py-2.5 capitalize text-adm-ink">{type.replace(/_/g, " ")}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-adm-ink">{count.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}
        </section>
      )}

      {view === "inventory" && (
        <section className="space-y-4">
          <ViewHeader
            title="Inventory"
            scope="Vehicles on the lot right now, excluding archived listings. This is a current snapshot, not a period total."
          />
          {snapshotUnavailable ? (
            <p className="text-[14px] leading-[20px] text-adm-muted">{snapshotUnavailable}</p>
          ) : metricsLoading ? (
            <p className="text-[14px] leading-[20px] text-adm-muted">Loading the current snapshot…</p>
          ) : (
            <>
              <Strip>
                <Kpi icon={Car} label="Active vehicles" value={metrics.activeInventory} scope={`${SNAPSHOT} - not archived`} />
                <Kpi icon={Car} label="New" value={metrics.newInventory} scope={`${SNAPSHOT} - condition new`} />
                <Kpi icon={Car} label="Used and CPO" value={metrics.usedInventory} scope={`${SNAPSHOT} - condition used or CPO`} />
                <Kpi icon={ShieldCheck} label="Published listings" value={metrics.publishedInventory} scope={`${SNAPSHOT} - status published`} />
              </Strip>
              <p className="text-[12px] leading-[18px] text-adm-muted">
                Active inventory is measured on listing status. A publication date stays set after a
                vehicle is archived, so it is historical evidence and never a test of what is on the lot today.
              </p>
            </>
          )}
        </section>
      )}

      {view === "get-ready" && (
        <section className="space-y-4">
          <ViewHeader
            title="Get Ready"
            scope="Where active used vehicles sit in the reconditioning process right now. This is a current snapshot, not a period total."
          />
          {snapshotUnavailable ? (
            <p className="text-[14px] leading-[20px] text-adm-muted">{snapshotUnavailable}</p>
          ) : metricsLoading ? (
            <p className="text-[14px] leading-[20px] text-adm-muted">Loading the current snapshot…</p>
          ) : (
            <>
              <Strip>
                <Kpi icon={Wrench} label="In Get Ready" value={metrics.inGetReady} scope={`${SNAPSHOT} - intake, service, prep or verification`} />
                <Kpi icon={Wrench} label="Intake" value={metrics.getReadyIntake} scope={`${SNAPSHOT} - lifecycle bucket intake`} />
                <Kpi icon={Wrench} label="Service" value={metrics.getReadyService} scope={`${SNAPSHOT} - lifecycle bucket service`} />
                <Kpi icon={Wrench} label="Prep" value={metrics.getReadyPrep} scope={`${SNAPSHOT} - lifecycle bucket prep`} />
                <Kpi icon={CheckCircle2} label="Final verification" value={metrics.getReadyVerified} scope={`${SNAPSHOT} - lifecycle bucket verified`} />
                <Kpi icon={AlertTriangle} label="Awaiting authorization" value={metrics.awaitingAuthorization} scope={`${SNAPSHOT} - waiting on a manager`} />
                <Kpi icon={CheckCircle2} label="Retail ready" value={metrics.retailReady} scope={`${SNAPSHOT} - lifecycle state retail ready`} />
                <Kpi icon={Wrench} label="Open recon estimates" value={metrics.getReadyRecon} scope={`${SNAPSHOT} - distinct vehicles with a submitted estimate`} />
              </Strip>
              {metrics.gated > 0 && (
                <p className="text-[12px] leading-[18px] text-adm-muted">
                  {metrics.gated} active vehicle{metrics.gated === 1 ? " is" : "s are"} on hold or marked wholesale and are outside the retail lifecycle.
                </p>
              )}
              {metrics.usedMissingLifecycle > 0 && (
                <p className="text-[14px] leading-[20px] text-adm-warning inline-flex items-start gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  {metrics.usedMissingLifecycle} used or CPO vehicle{metrics.usedMissingLifecycle === 1 ? " has" : "s have"} no
                  lifecycle record, so {metrics.usedMissingLifecycle === 1 ? "it is" : "they are"} missing from every bucket above.
                </p>
              )}
            </>
          )}
        </section>
      )}

      {view === "customers" && (
        <section className="space-y-4">
          <ViewHeader
            title="Customers"
            scope="What shoppers did with the packets and signing links this dealership sent."
          />
          {r.loading ? (
            <p className="text-[14px] leading-[20px] text-adm-muted">Loading the last {WINDOW_DAYS} days…</p>
          ) : (
            <>
              <Strip>
                <Kpi icon={QrCode} label="QR scans" value={r.qrScans} scope={`${LAST_30} - scan events`} />
                <Kpi icon={FileText} label="Packets signed" value={r.packetsSigned} scope={`${CREATED_30} - addendums with a signature`} />
              </Strip>
              <DailyChart title="QR scans" data={r.qrByDay} days={days} />
            </>
          )}
          <div className="space-y-4">
            <h3 className="text-[14px] leading-[20px] font-semibold text-adm-ink">Signing funnel</h3>
            <SigningFunnelWidget />
            <OpenSigningsList />
          </div>
        </section>
      )}

      {view === "compliance" && (
        <section className="space-y-4">
          <ViewHeader
            title="Compliance activity"
            scope="Addendum activity recorded for this store. These counts cover only the most recent recorded events, so they are a recent sample and not a full-period total."
          />
          <Strip>
            <Kpi icon={FileText} label="Addendums created" value={auditCount("addendum_created")} scope="Most recent 500 audit events" />
            <Kpi icon={ArrowUpRight} label="Sent to customer" value={auditCount("addendum_sent")} scope="Most recent 500 audit events" />
            <Kpi icon={Download} label="PDFs generated" value={auditCount("addendum_pdf")} scope="Most recent 500 audit events" />
            <Kpi icon={CheckCircle2} label="Printed" value={auditCount("addendum_printed")} scope="Most recent 500 audit events" />
          </Strip>

          <div className="rounded-2xl border border-adm-border bg-adm-surface p-4">
            <h3 className="text-[14px] leading-[20px] font-semibold text-adm-ink">Recent compliance events</h3>
            <p className="text-[12px] leading-[18px] text-adm-muted mt-0.5">Newest 20 of the loaded audit events</p>
            {storeEntries.length === 0 ? (
              <p className="text-[14px] leading-[20px] text-adm-muted mt-3">
                No audit events recorded for this store yet. Creating, sending or signing an addendum writes one.
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto mt-3">
                {storeEntries.slice(-20).reverse().map((e) => (
                  <div key={e.id} className="flex items-center justify-between py-1.5 border-b border-adm-border last:border-0">
                    <div className="min-w-0">
                      <p className="text-[14px] leading-[20px] font-medium text-adm-ink capitalize">{e.action.replace(/_/g, " ")}</p>
                      <p className="text-[12px] leading-[18px] text-adm-muted truncate">{e.entity_type} - {e.entity_id || "—"}</p>
                    </div>
                    <span className="text-[12px] leading-[18px] text-adm-muted tabular-nums shrink-0">
                      {format(new Date(e.created_at), "M/d h:mm a")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {view === "roi" && (
        <section className="space-y-4">
          <ViewHeader
            title="Platform ROI"
            scope={`Optional add-ons shown on addendums and what shoppers accepted, for addendums created in the last ${WINDOW_DAYS} days.`}
          />
          {r.loading ? (
            <p className="text-[14px] leading-[20px] text-adm-muted">Loading the last {WINDOW_DAYS} days…</p>
          ) : (
            <>
              <Strip>
                <Kpi icon={DollarSign} label="Accepted add-on revenue" value={r.acceptedAddonRevenue} money scope={CREATED_30} />
                <Kpi icon={TrendingUp} label="Add-ons offered" value={r.addons.length} scope={`${CREATED_30} - distinct products`} />
                <Kpi icon={FileText} label="Add-on presentations" value={addonShown} scope={`${CREATED_30} - times an add-on was shown`} />
                <Kpi
                  icon={CheckCircle2}
                  label="Acceptance rate"
                  value={addonRate == null ? "—" : `${addonRate}%`}
                  scope={addonRate == null ? "No decisions recorded in this period" : `${CREATED_30} - accepted of decided`}
                />
              </Strip>

              <div className="rounded-2xl border border-adm-border bg-adm-surface p-4">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <h3 className="text-[14px] leading-[20px] font-semibold text-adm-ink">Add-on acceptance</h3>
                  <FeatureGate feature="qr_tracking" variant="hide">
                    <button
                      type="button"
                      onClick={exportCsv}
                      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-adm-border text-[12px] leading-[18px] font-semibold hover:bg-adm-workspace"
                    >
                      <Download className="w-3.5 h-3.5" /> Export CSV
                    </button>
                  </FeatureGate>
                </div>
                <p className="text-[12px] leading-[18px] text-adm-muted">{CREATED_30}</p>
                {r.addons.length === 0 ? (
                  <p className="text-[14px] leading-[20px] text-adm-muted mt-3">{NO_DATA}</p>
                ) : (
                  <div className="overflow-x-auto mt-3">
                    <table className="w-full">
                      <thead>
                        <tr className="text-[12px] leading-[18px] font-semibold text-adm-muted text-left border-b border-adm-border">
                          <th className="py-1.5 pr-3">Add-on</th>
                          <th className="py-1.5 px-2 text-right">Shown</th>
                          <th className="py-1.5 px-2 text-right">Accepted</th>
                          <th className="py-1.5 px-2 text-right">Rate</th>
                          <th className="py-1.5 px-2 text-right">Revenue</th>
                          <th className="py-1.5 pl-2 text-right">Avg</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.addons.map((a) => (
                          <tr key={a.id} className="border-b border-adm-border last:border-0">
                            <td className="py-1.5 pr-3 text-[14px] leading-[20px] font-medium text-adm-ink">{a.name}</td>
                            <td className="py-1.5 px-2 text-right text-[14px] leading-[20px] tabular-nums text-adm-muted">{a.shown}</td>
                            <td className="py-1.5 px-2 text-right text-[14px] leading-[20px] tabular-nums text-adm-ink">{a.accepted}</td>
                            <td className="py-1.5 px-2 text-right text-[14px] leading-[20px] tabular-nums">
                              <span className={a.rate >= 50 ? "text-adm-success" : "text-adm-muted"}>{a.rate}%</span>
                            </td>
                            <td className="py-1.5 px-2 text-right text-[14px] leading-[20px] tabular-nums text-adm-ink">{money(a.revenue)}</td>
                            <td className="py-1.5 pl-2 text-right text-[14px] leading-[20px] tabular-nums text-adm-muted">{money(a.avgPrice)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </PageBody>
  );
};

export default Reports;
