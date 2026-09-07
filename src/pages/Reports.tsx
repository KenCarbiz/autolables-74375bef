import type { ComponentType } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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

const Kpi = ({ label, value, scope, icon: Icon, money: isMoney }: KpiProps) => (
  <div className="rounded-2xl border border-border bg-card p-4">
    <p className="text-al-meta font-bold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
      {Icon && <Icon className="w-3 h-3" />} {label}
    </p>
    <p className="text-al-page text-foreground mt-1 tabular-nums">
      {typeof value === "number" ? (isMoney ? money(value) : value.toLocaleString()) : value}
    </p>
    <p className="text-al-meta text-muted-foreground mt-1">{scope}</p>
  </div>
);

const ViewHeader = ({ title, scope }: { title: string; scope: string }) => (
  <div>
    <h2 className="text-al-section text-foreground">{title}</h2>
    <p className="text-al-meta text-muted-foreground mt-0.5">{scope}</p>
  </div>
);

const DailyChart = ({ title, data }: { title: string; data: { day: string; count: number }[] }) => {
  const total = data.reduce((n, d) => n + d.count, 0);
  const max = Math.max(1, ...data.map((d) => d.count));
  const first = data[0]?.day;
  const last = data[data.length - 1]?.day;
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <h3 className="text-al-card text-foreground">{title}</h3>
      <p className="text-al-meta text-muted-foreground mt-0.5">
        Daily count, last {WINDOW_DAYS} days - {total.toLocaleString()} total
      </p>
      {total === 0 ? (
        <p className="text-al-body text-muted-foreground mt-4">{NO_DATA}</p>
      ) : (
        <>
          <div className="flex items-end gap-0.5 h-24 mt-3" role="img"
            aria-label={`${title}: ${total} over the last ${WINDOW_DAYS} days, peak ${max} in one day`}>
            {data.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center justify-end" title={`${d.day}: ${d.count}`}>
                <div className="w-full rounded-t bg-primary/70" style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count ? 2 : 0 }} />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between text-al-meta text-muted-foreground mt-1.5">
            <span>{first}</span>
            <span>peak {max}/day</span>
            <span>{last}</span>
          </div>
        </>
      )}
    </div>
  );
};

const Reports = () => {
  const navigate = useNavigate();
  const { tenant, currentStore } = useTenant();
  const { user } = useAuth();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const [searchParams, setSearchParams] = useSearchParams();
  const view = resolveView(searchParams.get("tab"));
  const setView = (v: ReportView) =>
    setSearchParams(v === "operations" ? {} : { tab: v }, { replace: true });

  const r = useAutoLabelsReports(WINDOW_DAYS);
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
    <div className="p-4 lg:p-6 max-w-[1100px] mx-auto space-y-5">
      <div>
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className="text-al-meta font-semibold text-primary hover:underline inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-3 h-3" /> Dashboard
        </button>
        <h1 className="text-al-page text-foreground inline-flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" /> Reports
        </h1>
        <p className="text-al-body text-muted-foreground mt-1">
          Every number states what it counted and the window it covers. Period totals and current
          snapshots are never mixed in one row.
        </p>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-muted/60 p-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              aria-current={view === v.id ? "page" : undefined}
              className={`h-9 px-3.5 rounded-lg text-al-meta font-semibold whitespace-nowrap transition-colors duration-hover ease-standard motion-reduce:transition-none ${
                view === v.id ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {view === "operations" && (
        <section className="space-y-4">
          <ViewHeader
            title="Document operations"
            scope={`Documents this dealership produced. Population: generated_documents. Window: ${LAST_30.toLowerCase()}.`}
          />
          {r.loading ? (
            <p className="text-al-body text-muted-foreground">Loading the last {WINDOW_DAYS} days…</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Kpi icon={FileText} label="Stickers generated" value={r.generated} scope={LAST_30} />
                <Kpi icon={FileText} label="Printed" value={r.printed} scope={CREATED_30} />
                <Kpi icon={ShieldCheck} label="Published documents" value={r.published} scope={CREATED_30} />
                <Kpi icon={AlertTriangle} label="Pending approval" value={r.pendingApproval} scope={CREATED_30} />
              </div>

              <DailyChart title="Documents generated" data={r.genByDay} />

              <div className="rounded-2xl border border-border bg-card p-4">
                <h3 className="text-al-card text-foreground">Documents by type</h3>
                <p className="text-al-meta text-muted-foreground mt-0.5">{LAST_30}</p>
                {docTypes.length === 0 ? (
                  <p className="text-al-body text-muted-foreground mt-3">{NO_DATA}</p>
                ) : (
                  <table className="w-full mt-3">
                    <thead>
                      <tr className="text-al-meta font-bold uppercase tracking-wide text-muted-foreground text-left border-b border-border">
                        <th className="py-1.5 pr-3">Document type</th>
                        <th className="py-1.5 pl-2 text-right">Generated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {docTypes.map(([type, count]) => (
                        <tr key={type} className="border-b border-border last:border-0">
                          <td className="py-1.5 pr-3 text-al-body text-foreground capitalize">{type.replace(/_/g, " ")}</td>
                          <td className="py-1.5 pl-2 text-right text-al-body tabular-nums text-foreground">{count.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {view === "inventory" && (
        <section className="space-y-4">
          <ViewHeader
            title="Inventory"
            scope="Vehicles on the lot right now. Population: listings whose status is not archived. Window: current snapshot, not a period total."
          />
          {snapshotUnavailable ? (
            <p className="text-al-body text-muted-foreground">{snapshotUnavailable}</p>
          ) : metricsLoading ? (
            <p className="text-al-body text-muted-foreground">Loading the current snapshot…</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Kpi icon={Car} label="Active vehicles" value={metrics.activeInventory} scope={`${SNAPSHOT} - not archived`} />
                <Kpi icon={Car} label="New" value={metrics.newInventory} scope={`${SNAPSHOT} - condition new`} />
                <Kpi icon={Car} label="Used and CPO" value={metrics.usedInventory} scope={`${SNAPSHOT} - condition used or CPO`} />
                <Kpi icon={ShieldCheck} label="Published listings" value={metrics.publishedInventory} scope={`${SNAPSHOT} - status published`} />
              </div>
              <p className="text-al-meta text-muted-foreground">
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
            scope="Where active used vehicles sit in the reconditioning lifecycle. Population: active inventory joined to vehicle_lifecycle. Window: current snapshot."
          />
          {snapshotUnavailable ? (
            <p className="text-al-body text-muted-foreground">{snapshotUnavailable}</p>
          ) : metricsLoading ? (
            <p className="text-al-body text-muted-foreground">Loading the current snapshot…</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Kpi icon={Wrench} label="In Get Ready" value={metrics.inGetReady} scope={`${SNAPSHOT} - intake, service, prep or verification`} />
                <Kpi icon={Wrench} label="Intake" value={metrics.getReadyIntake} scope={`${SNAPSHOT} - lifecycle bucket intake`} />
                <Kpi icon={Wrench} label="Service" value={metrics.getReadyService} scope={`${SNAPSHOT} - lifecycle bucket service`} />
                <Kpi icon={Wrench} label="Prep" value={metrics.getReadyPrep} scope={`${SNAPSHOT} - lifecycle bucket prep`} />
                <Kpi icon={CheckCircle2} label="Final verification" value={metrics.getReadyVerified} scope={`${SNAPSHOT} - lifecycle bucket verified`} />
                <Kpi icon={AlertTriangle} label="Awaiting authorization" value={metrics.awaitingAuthorization} scope={`${SNAPSHOT} - waiting on a manager`} />
                <Kpi icon={CheckCircle2} label="Retail ready" value={metrics.retailReady} scope={`${SNAPSHOT} - lifecycle state retail ready`} />
                <Kpi icon={Wrench} label="Open recon estimates" value={metrics.getReadyRecon} scope={`${SNAPSHOT} - distinct vehicles with a submitted estimate`} />
              </div>
              {metrics.gated > 0 && (
                <p className="text-al-meta text-muted-foreground">
                  {metrics.gated} active vehicle{metrics.gated === 1 ? " is" : "s are"} on hold or marked wholesale and are outside the retail lifecycle.
                </p>
              )}
              {metrics.usedMissingLifecycle > 0 && (
                <p className="text-al-body text-amber-700 inline-flex items-start gap-1.5">
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
            <p className="text-al-body text-muted-foreground">Loading the last {WINDOW_DAYS} days…</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Kpi icon={QrCode} label="QR scans" value={r.qrScans} scope={`${LAST_30} - scan events`} />
                <Kpi icon={FileText} label="Packets signed" value={r.packetsSigned} scope={`${CREATED_30} - addendums with a signature`} />
              </div>
              <DailyChart title="QR scans" data={r.qrByDay} />
            </>
          )}
          <div className="space-y-4">
            <h3 className="text-al-card text-foreground">Signing funnel</h3>
            <SigningFunnelWidget />
            <OpenSigningsList />
          </div>
        </section>
      )}

      {view === "compliance" && (
        <section className="space-y-4">
          <ViewHeader
            title="Compliance activity"
            scope="Addendum evidence recorded in the audit log. Population: the 500 most recent audit events for this store. Window: whatever period those events span."
          />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi icon={FileText} label="Addendums created" value={auditCount("addendum_created")} scope="Most recent 500 audit events" />
            <Kpi icon={ArrowUpRight} label="Sent to customer" value={auditCount("addendum_sent")} scope="Most recent 500 audit events" />
            <Kpi icon={Download} label="PDFs generated" value={auditCount("addendum_pdf")} scope="Most recent 500 audit events" />
            <Kpi icon={CheckCircle2} label="Printed" value={auditCount("addendum_printed")} scope="Most recent 500 audit events" />
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <h3 className="text-al-card text-foreground">Recent compliance events</h3>
            <p className="text-al-meta text-muted-foreground mt-0.5">Newest 20 of the loaded audit events</p>
            {storeEntries.length === 0 ? (
              <p className="text-al-body text-muted-foreground mt-3">
                No audit events recorded for this store yet. Creating, sending or signing an addendum writes one.
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto mt-3">
                {storeEntries.slice(-20).reverse().map((e) => (
                  <div key={e.id} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                    <div className="min-w-0">
                      <p className="text-al-body font-medium text-foreground capitalize">{e.action.replace(/_/g, " ")}</p>
                      <p className="text-al-meta text-muted-foreground truncate">{e.entity_type} - {e.entity_id || "—"}</p>
                    </div>
                    <span className="text-al-meta text-muted-foreground tabular-nums shrink-0">
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
            scope={`Optional add-ons shown on addendums and what shoppers accepted. Population: addendums created in the last ${WINDOW_DAYS} days.`}
          />
          {r.loading ? (
            <p className="text-al-body text-muted-foreground">Loading the last {WINDOW_DAYS} days…</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Kpi icon={DollarSign} label="Accepted add-on revenue" value={r.acceptedAddonRevenue} money scope={CREATED_30} />
                <Kpi icon={TrendingUp} label="Add-ons offered" value={r.addons.length} scope={`${CREATED_30} - distinct products`} />
                <Kpi icon={FileText} label="Add-on presentations" value={addonShown} scope={`${CREATED_30} - times an add-on was shown`} />
                <Kpi
                  icon={CheckCircle2}
                  label="Acceptance rate"
                  value={addonRate == null ? "—" : `${addonRate}%`}
                  scope={addonRate == null ? "No decisions recorded in this period" : `${CREATED_30} - accepted of decided`}
                />
              </div>

              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <h3 className="text-al-card text-foreground">Add-on acceptance</h3>
                  <FeatureGate feature="qr_tracking" variant="hide">
                    <button
                      type="button"
                      onClick={exportCsv}
                      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-al-meta font-semibold hover:bg-muted"
                    >
                      <Download className="w-3.5 h-3.5" /> Export CSV
                    </button>
                  </FeatureGate>
                </div>
                <p className="text-al-meta text-muted-foreground">{CREATED_30}</p>
                {r.addons.length === 0 ? (
                  <p className="text-al-body text-muted-foreground mt-3">{NO_DATA}</p>
                ) : (
                  <div className="overflow-x-auto mt-3">
                    <table className="w-full">
                      <thead>
                        <tr className="text-al-meta font-bold uppercase tracking-wide text-muted-foreground text-left border-b border-border">
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
                          <tr key={a.id} className="border-b border-border last:border-0">
                            <td className="py-1.5 pr-3 text-al-body font-medium text-foreground">{a.name}</td>
                            <td className="py-1.5 px-2 text-right text-al-body tabular-nums text-muted-foreground">{a.shown}</td>
                            <td className="py-1.5 px-2 text-right text-al-body tabular-nums text-foreground">{a.accepted}</td>
                            <td className="py-1.5 px-2 text-right text-al-body tabular-nums">
                              <span className={a.rate >= 50 ? "text-emerald-700" : "text-muted-foreground"}>{a.rate}%</span>
                            </td>
                            <td className="py-1.5 px-2 text-right text-al-body tabular-nums text-foreground">{money(a.revenue)}</td>
                            <td className="py-1.5 pl-2 text-right text-al-body tabular-nums text-muted-foreground">{money(a.avgPrice)}</td>
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
    </div>
  );
};

export default Reports;
