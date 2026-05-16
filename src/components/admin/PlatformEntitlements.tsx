import { useMemo, useState } from "react";
import { useAdminPlatform, type EntitlementRow } from "@/hooks/useAdminPlatform";
import { toast } from "sonner";
import { CreditCard, Search, Zap } from "lucide-react";
import { SortHeader, TablePagination, useSortAndPaginate, toCsv, downloadCsv } from "./tablePrimitives";

const APP_SLUGS = ["autolabels", "autocurb", "autoframe", "autovideo"] as const;
const STATUSES: EntitlementRow["status"][] = ["trial", "active", "canceled", "past_due", "paused"];
const PLAN_TIERS = ["starter", "essential", "professional", "unlimited", "enterprise"];

const formatDate = (s: string | null) => {
  if (!s) return "—";
  return new Date(s).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
};

const statusColor = (s: EntitlementRow["status"]) =>
  s === "active" ? "bg-emerald-100 text-emerald-700" :
  s === "trial" ? "bg-blue-100 text-blue-700" :
  s === "past_due" ? "bg-amber-100 text-amber-700" :
  s === "canceled" ? "bg-rose-100 text-rose-700" :
  "bg-slate-100 text-slate-700";

export const PlatformEntitlements = () => {
  const { tenants, entitlements, overrideEntitlement } = useAdminPlatform();
  const [q, setQ] = useState("");
  const [appFilter, setAppFilter] = useState<string>("");
  const [editing, setEditing] = useState<string | null>(null);
  const [quickNew, setQuickNew] = useState(false);

  const tenantsById = useMemo(() => {
    const m = new Map<string, string>();
    (tenants.data || []).forEach((t) => m.set(t.id, t.name));
    return m;
  }, [tenants.data]);

  const rows = useMemo(() => {
    const all = entitlements.data || [];
    const lc = q.trim().toLowerCase();
    return all
      .filter((e) => (appFilter ? e.app_slug === appFilter : true))
      .filter((e) => {
        if (!lc) return true;
        const tn = (tenantsById.get(e.tenant_id) || "").toLowerCase();
        return tn.includes(lc) || e.plan_tier.toLowerCase().includes(lc) || e.status.includes(lc);
      });
  }, [entitlements.data, appFilter, q, tenantsById]);

  const sortPag = useSortAndPaginate<EntitlementRow>(rows, {
    defaultSortKey: "tenant",
    defaultSortDir: "asc",
    defaultPageSize: 50,
    getSortValue: (row, key) => {
      if (key === "tenant") return tenantsById.get(row.tenant_id) || "";
      return (row as unknown as Record<string, unknown>)[key];
    },
  });

  const handleExport = () => {
    const csv = toCsv<EntitlementRow>(sortPag.sorted, [
      { header: "Tenant",        get: r => tenantsById.get(r.tenant_id) || "" },
      { header: "Tenant ID",     get: r => r.tenant_id },
      { header: "App",           get: r => r.app_slug },
      { header: "Plan",          get: r => r.plan_tier },
      { header: "Status",        get: r => r.status },
      { header: "Trial ends",    get: r => r.trial_ends_at || "" },
      { header: "Expires",       get: r => r.expires_at || "" },
      { header: "Seat limit",    get: r => r.seat_limit ?? "" },
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`platform-entitlements-${stamp}.csv`, csv);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <CreditCard className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">Entitlements &amp; Billing</h2>
            <p className="text-[11px] text-muted-foreground">
              {entitlements.data?.length ?? 0} rows · overrides bypass Stripe
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setQuickNew(true)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold"
          >
            <Zap className="w-3.5 h-3.5" />
            Grant / override
          </button>
          <select
            value={appFilter}
            onChange={(e) => setAppFilter(e.target.value)}
            className="h-9 px-2 rounded-md border border-border bg-background text-sm"
          >
            <option value="">All apps</option>
            {APP_SLUGS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search tenant, plan, status…"
              className="h-9 pl-7 pr-3 rounded-md border border-border bg-background text-sm w-64"
            />
          </div>
        </div>
      </div>

      {quickNew && (
        <QuickOverride
          tenants={tenants.data || []}
          onClose={() => setQuickNew(false)}
          onSubmit={async (args) => {
            const ok = await overrideEntitlement(args);
            if (ok) {
              toast.success("Entitlement granted");
              setQuickNew(false);
            } else {
              toast.error("Override failed");
            }
          }}
        />
      )}

      {entitlements.isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading entitlements…</div>
      ) : rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">No entitlements match.</div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <SortHeader label="Tenant"     sortKey="tenant"        activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="App"        sortKey="app_slug"      activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="Plan"       sortKey="plan_tier"     activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="Status"     sortKey="status"        activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="Trial ends" sortKey="trial_ends_at" activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="Expires"    sortKey="expires_at"    activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="Seats"      sortKey="seat_limit"    activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="Override"   activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} align="right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortPag.paginated.map((e) => (
                <EntRow
                  key={e.id}
                  row={e}
                  tenantName={tenantsById.get(e.tenant_id) || e.tenant_id.slice(0, 8)}
                  editing={editing === e.id}
                  onEdit={() => setEditing(e.id)}
                  onClose={() => setEditing(null)}
                  onSubmit={async (patch) => {
                    const ok = await overrideEntitlement({
                      tenantId: e.tenant_id,
                      appSlug: e.app_slug,
                      planTier: patch.planTier,
                      status: patch.status,
                      expiresAt: patch.expiresAt,
                      seatLimit: patch.seatLimit,
                    });
                    if (ok) {
                      toast.success("Entitlement updated");
                      setEditing(null);
                    } else {
                      toast.error("Update failed");
                    }
                  }}
                />
              ))}
            </tbody>
          </table>
          <TablePagination
            page={sortPag.page}
            totalPages={sortPag.totalPages}
            pageSize={sortPag.pageSize}
            totalCount={sortPag.totalCount}
            visibleCount={sortPag.paginated.length}
            setPage={sortPag.setPage}
            setPageSize={sortPag.setPageSize}
            onExportCsv={handleExport}
            exportLabel="Export CSV"
          />
        </div>
      )}
    </div>
  );
};

interface EntRowProps {
  row: EntitlementRow;
  tenantName: string;
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
  onSubmit: (patch: {
    planTier: string;
    status: EntitlementRow["status"];
    expiresAt: string | null;
    seatLimit: number | null;
  }) => Promise<void>;
}

const EntRow = ({ row, tenantName, editing, onEdit, onClose, onSubmit }: EntRowProps) => {
  const [planTier, setPlanTier] = useState(row.plan_tier);
  const [status, setStatus] = useState<EntitlementRow["status"]>(row.status);
  const [expiresAt, setExpiresAt] = useState<string>(
    row.expires_at ? row.expires_at.slice(0, 10) : ""
  );
  const [seatLimit, setSeatLimit] = useState<string>(
    row.seat_limit == null ? "" : String(row.seat_limit)
  );

  if (!editing) {
    return (
      <tr>
        <td className="px-3 py-2.5 font-semibold text-foreground">{tenantName}</td>
        <td className="px-3 py-2.5 uppercase text-xs tracking-wider">{row.app_slug}</td>
        <td className="px-3 py-2.5 capitalize">{row.plan_tier}</td>
        <td className="px-3 py-2.5">
          <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${statusColor(row.status)}`}>
            {row.status}
          </span>
        </td>
        <td className="px-3 py-2.5 text-muted-foreground">{formatDate(row.trial_ends_at)}</td>
        <td className="px-3 py-2.5 text-muted-foreground">{formatDate(row.expires_at)}</td>
        <td className="px-3 py-2.5 text-muted-foreground">{row.seat_limit ?? "∞"}</td>
        <td className="px-3 py-2.5 text-right">
          <button
            onClick={onEdit}
            className="text-[11px] font-semibold px-2.5 h-7 rounded-md text-primary hover:bg-primary/10"
          >
            Edit
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="bg-muted/20">
      <td className="px-3 py-2.5 font-semibold text-foreground">{tenantName}</td>
      <td className="px-3 py-2.5 uppercase text-xs tracking-wider">{row.app_slug}</td>
      <td className="px-3 py-2.5">
        <select value={planTier} onChange={(e) => setPlanTier(e.target.value)} className="h-8 px-2 rounded-md border border-border bg-background text-xs">
          {PLAN_TIERS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </td>
      <td className="px-3 py-2.5">
        <select value={status} onChange={(e) => setStatus(e.target.value as EntitlementRow["status"])} className="h-8 px-2 rounded-md border border-border bg-background text-xs">
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td className="px-3 py-2.5 text-muted-foreground">{formatDate(row.trial_ends_at)}</td>
      <td className="px-3 py-2.5">
        <input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="h-8 px-2 rounded-md border border-border bg-background text-xs"
        />
      </td>
      <td className="px-3 py-2.5">
        <input
          type="number"
          value={seatLimit}
          onChange={(e) => setSeatLimit(e.target.value)}
          placeholder="∞"
          className="h-8 w-16 px-2 rounded-md border border-border bg-background text-xs"
        />
      </td>
      <td className="px-3 py-2.5 text-right whitespace-nowrap">
        <button
          onClick={() =>
            onSubmit({
              planTier,
              status,
              expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
              seatLimit: seatLimit ? parseInt(seatLimit, 10) : null,
            })
          }
          className="text-[11px] font-semibold px-2.5 h-7 rounded-md bg-primary text-primary-foreground mr-1"
        >
          Save
        </button>
        <button
          onClick={onClose}
          className="text-[11px] font-semibold px-2.5 h-7 rounded-md text-muted-foreground hover:bg-muted"
        >
          Cancel
        </button>
      </td>
    </tr>
  );
};

interface QuickProps {
  tenants: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSubmit: (args: {
    tenantId: string;
    appSlug: string;
    planTier: string;
    status: EntitlementRow["status"];
    expiresAt: string | null;
    seatLimit: number | null;
  }) => Promise<void>;
}

const QuickOverride = ({ tenants, onClose, onSubmit }: QuickProps) => {
  const [tenantId, setTenantId] = useState(tenants[0]?.id || "");
  const [appSlug, setAppSlug] = useState<string>("autolabels");
  const [planTier, setPlanTier] = useState("essential");
  const [status, setStatus] = useState<EntitlementRow["status"]>("active");
  const [expiresAt, setExpiresAt] = useState<string>("");

  return (
    <div className="rounded-xl border-2 border-primary bg-card p-4 shadow-lg">
      <h3 className="text-sm font-bold text-foreground mb-3">Grant or override an entitlement</h3>
      <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
        <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="h-9 px-2 rounded-md border border-border bg-background text-sm md:col-span-2">
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={appSlug} onChange={(e) => setAppSlug(e.target.value)} className="h-9 px-2 rounded-md border border-border bg-background text-sm">
          {APP_SLUGS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={planTier} onChange={(e) => setPlanTier(e.target.value)} className="h-9 px-2 rounded-md border border-border bg-background text-sm">
          {PLAN_TIERS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as EntitlementRow["status"])} className="h-9 px-2 rounded-md border border-border bg-background text-sm">
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="h-9 px-2 rounded-md border border-border bg-background text-sm" />
      </div>
      <div className="flex items-center justify-end gap-2 mt-3">
        <button onClick={onClose} className="h-8 px-3 rounded-md text-sm text-muted-foreground">Cancel</button>
        <button
          onClick={() =>
            onSubmit({
              tenantId, appSlug, planTier, status,
              expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
              seatLimit: null,
            })
          }
          disabled={!tenantId}
          className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
        >
          Apply
        </button>
      </div>
    </div>
  );
};

export default PlatformEntitlements;
