import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, ShieldAlert, ShieldCheck, Search, Loader2,
  ExternalLink, Clock, CheckCircle2, XCircle, FileWarning, DollarSign,
  Printer, ClipboardCheck, Activity, X,
} from "lucide-react";
import { useVehicleCompliance, type ComplianceStatus, type VehicleComplianceRow } from "@/hooks/useVehicleCompliance";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";

// ──────────────────────────────────────────────────────────────
// CommandCenter — Phase 3 primary management dashboard.
// Read-focused. Derives per-VIN compliance status from Phase-2
// signals (see useVehicleCompliance). Links out to:
//   • /admin/exceptions   — resolve a specific exception (write UI)
//   • /compliance         — per-VIN audit-packet export
//   • /admin/inventory-sync — ingestion health
// Does NOT duplicate ComplianceCenter or ComplianceActionCenter.
// ──────────────────────────────────────────────────────────────

const STATUS_META: Record<ComplianceStatus, { label: string; cls: string; dot: string }> = {
  compliant:           { label: "Compliant",           cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/40", dot: "bg-emerald-500" },
  verification_needed: { label: "Verification needed", cls: "bg-amber-500/15 text-amber-700 border-amber-500/40",       dot: "bg-amber-500"  },
  action_required:     { label: "Action required",     cls: "bg-orange-500/15 text-orange-700 border-orange-500/40",    dot: "bg-orange-500" },
  critical:            { label: "Critical",            cls: "bg-red-500/15 text-red-700 border-red-500/40",             dot: "bg-red-500"    },
  exempt:              { label: "Exempt",              cls: "bg-slate-500/15 text-slate-700 border-slate-400/40",       dot: "bg-slate-500"  },
  sold:                { label: "Sold",                cls: "bg-gray-200 text-gray-600 border-gray-300",                dot: "bg-gray-400"   },
};

const STATUS_ORDER: ComplianceStatus[] = ["critical", "action_required", "verification_needed", "compliant", "exempt", "sold"];

const CommandCenter = () => {
  const { user, isAdmin } = useAuth();
  const { member } = useEntitlements();
  const canResolve = hasDealerCapability(member?.role as any, "resolve_exceptions", isAdmin);

  const { rows, summary, latestSync, loading, error } = useVehicleCompliance();

  const [statusFilter, setStatusFilter] = useState<ComplianceStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [ageFilter, setAgeFilter] = useState<"all" | "0-14" | "15-30" | "31-60" | "60+">("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<VehicleComplianceRow | null>(null);

  const activeRows = useMemo(() => rows.filter((r) => r.compliance_status !== "sold"), [rows]);

  const typeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of activeRows) if (r.top_open_exception) s.add(r.top_open_exception.type);
    return Array.from(s).sort();
  }, [activeRows]);

  const filtered = useMemo(() => {
    const sevRank: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
    return activeRows
      .filter((r) => statusFilter === "all" ? true : r.compliance_status === statusFilter)
      .filter((r) => typeFilter === "all" ? true : r.top_open_exception?.type === typeFilter)
      .filter((r) => {
        if (ageFilter === "all") return true;
        const d = r.inventory_age_days ?? 0;
        if (ageFilter === "0-14") return d <= 14;
        if (ageFilter === "15-30") return d >= 15 && d <= 30;
        if (ageFilter === "31-60") return d >= 31 && d <= 60;
        return d > 60;
      })
      .filter((r) => {
        if (!search.trim()) return true;
        const q = search.trim().toLowerCase();
        return (
          r.vin.toLowerCase().includes(q) ||
          (r.stock_number || "").toLowerCase().includes(q) ||
          (r.ymm || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        // Severity of top exception first, then age.
        const sa = a.top_open_exception ? sevRank[a.top_open_exception.severity] : 0;
        const sb = b.top_open_exception ? sevRank[b.top_open_exception.severity] : 0;
        if (sa !== sb) return sb - sa;
        return (b.inventory_age_days ?? 0) - (a.inventory_age_days ?? 0);
      });
  }, [activeRows, statusFilter, typeFilter, ageFilter, search]);

  if (!user) return null;

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Compliance Command Center</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live per-VIN compliance derived from ingestion, exceptions, documents, prep, and price signals.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/admin/inventory-sync"
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 h-9 rounded-md border border-border hover:bg-muted">
            <Activity className="w-3.5 h-3.5" /> Sync Center
          </Link>
          <Link to="/admin/exceptions"
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 h-9 rounded-md border border-border hover:bg-muted">
            <AlertTriangle className="w-3.5 h-3.5" /> Exceptions
          </Link>
          <Link to="/compliance"
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 h-9 rounded-md border border-border hover:bg-muted">
            <ShieldCheck className="w-3.5 h-3.5" /> Audit packet
          </Link>
        </div>
      </header>

      {/* Ingestion status strip */}
      <div className="rounded-xl border border-border bg-card px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground">Ingestion</div>
            <div className="text-xs text-muted-foreground truncate">
              {latestSync?.finished_at
                ? <>Last run <span className="font-medium">{new Date(latestSync.finished_at).toLocaleString()}</span> · status <span className="font-medium">{latestSync.status || "unknown"}</span>{latestSync.error_summary ? <> · <span className="text-red-600">{latestSync.error_summary}</span></> : null}</>
                : "No sync runs yet"}
            </div>
          </div>
        </div>
        <Link to="/admin/inventory-sync" className="text-xs font-semibold text-primary hover:underline whitespace-nowrap">
          Open Sync Center →
        </Link>
      </div>

      {/* Summary cards — click to filter */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard label="Active inventory" value={summary.total_active} active={statusFilter === "all"}
          onClick={() => setStatusFilter("all")} />
        <SummaryCard label="Used vehicles" value={summary.used} />
        <SummaryCard label="Compliant" value={summary.compliant} tone="emerald" active={statusFilter === "compliant"}
          onClick={() => setStatusFilter("compliant")} />
        <SummaryCard label="Action required" value={summary.action_required} tone="orange" active={statusFilter === "action_required"}
          onClick={() => setStatusFilter("action_required")} />
        <SummaryCard label="Critical" value={summary.critical} tone="red" active={statusFilter === "critical"}
          onClick={() => setStatusFilter("critical")} />
        <SummaryCard label="Awaiting verification" value={summary.verification_needed} tone="amber" active={statusFilter === "verification_needed"}
          onClick={() => setStatusFilter("verification_needed")} />
        <SummaryCard label="Missing Buyers Guides" value={summary.missing_buyers_guides} hint="not yet tracked" />
        <SummaryCard label="Price mismatches" value={summary.price_mismatches} tone="orange" />
        <SummaryCard label="Reprints required" value={summary.reprints_required} tone="orange" />
        <SummaryCard label="Compliance score" value={summary.compliance_score !== null ? `${summary.compliance_score}%` : null}
          hint={summary.compliance_score === null ? "no used inventory" : "compliant ÷ active-used"} tone="emerald" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            className="pl-8 pr-3 h-9 rounded-md border border-border bg-background text-sm w-64"
            placeholder="VIN, stock, or Y/M/M"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <FilterSelect label="Status" value={statusFilter} onChange={(v) => setStatusFilter(v as any)}
          options={[["all", "All statuses"], ...STATUS_ORDER.filter((s) => s !== "sold").map((s) => [s, STATUS_META[s].label] as [string, string])]} />
        <FilterSelect label="Exception type" value={typeFilter} onChange={setTypeFilter}
          options={[["all", "All types"], ...typeOptions.map((t) => [t, t] as [string, string])]} />
        <FilterSelect label="Inventory age" value={ageFilter} onChange={(v) => setAgeFilter(v as any)}
          options={[["all", "Any age"], ["0-14", "0–14 days"], ["15-30", "15–30 days"], ["31-60", "31–60 days"], ["60+", "60+ days"]]} />
        {(statusFilter !== "all" || typeFilter !== "all" || ageFilter !== "all" || search) && (
          <button onClick={() => { setStatusFilter("all"); setTypeFilter("all"); setAgeFilter("all"); setSearch(""); }}
            className="text-xs text-muted-foreground hover:text-foreground underline">Reset</button>
        )}
        <div className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {activeRows.length} vehicles
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/70 backdrop-blur z-10 border-b border-border">
              <tr className="text-left">
                <Th>Status</Th>
                <Th>VIN / Stock</Th>
                <Th>Year / Make / Model</Th>
                <Th>Rooftop</Th>
                <Th>Top open exception</Th>
                <Th className="text-right">Age</Th>
                <Th>Last verified</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="p-10 text-center text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading…
                </td></tr>
              ) : error ? (
                <tr><td colSpan={8} className="p-10 text-center text-red-600 text-xs">{error}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="p-10 text-center text-muted-foreground text-xs">
                  No vehicles match the current filters.
                </td></tr>
              ) : filtered.map((r) => {
                const meta = STATUS_META[r.compliance_status];
                return (
                  <tr key={r.vehicle_id}
                    onClick={() => setSelected(r)}
                    className="border-b border-border/60 hover:bg-muted/40 cursor-pointer">
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${meta.cls}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="font-mono text-xs text-foreground">{r.vin}</div>
                      {r.stock_number && <div className="text-[11px] text-muted-foreground">#{r.stock_number}</div>}
                    </td>
                    <td className="px-4 py-2 text-xs text-foreground">{r.ymm}{r.trim ? ` · ${r.trim}` : ""}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{r.store_id || "—"}</td>
                    <td className="px-4 py-2 text-xs">
                      {r.top_open_exception ? (
                        <span className="text-foreground">
                          <span className="font-medium">{r.top_open_exception.type}</span>
                          <span className="text-muted-foreground"> · {r.top_open_exception.title}</span>
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-right text-foreground">{r.inventory_age_days ?? "—"}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {r.last_verified_at ? new Date(r.last_verified_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button className="text-xs font-semibold text-primary hover:underline">Open</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <Drawer row={selected} canResolve={canResolve} onClose={() => setSelected(null)} />
      )}
    </div>
  );
};

const Th = ({ children, className = "" }: { children?: React.ReactNode; className?: string }) => (
  <th className={`px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ${className}`}>{children}</th>
);

const FilterSelect = ({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][];
}) => (
  <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
    <span className="hidden sm:inline">{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </label>
);

const SummaryCard = ({ label, value, tone, hint, active, onClick }: {
  label: string;
  value: number | string | null;
  tone?: "emerald" | "amber" | "orange" | "red";
  hint?: string;
  active?: boolean;
  onClick?: () => void;
}) => {
  const toneCls =
    tone === "emerald" ? "text-emerald-700" :
    tone === "amber" ? "text-amber-700" :
    tone === "orange" ? "text-orange-700" :
    tone === "red" ? "text-red-700" : "text-foreground";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`text-left rounded-xl border p-3 transition-colors ${active ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40"} ${!onClick ? "cursor-default" : ""}`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${toneCls}`}>
        {value === null || value === undefined ? <span className="text-muted-foreground/70">—</span> : value}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </button>
  );
};

const Drawer = ({ row, canResolve, onClose }: {
  row: VehicleComplianceRow; canResolve: boolean; onClose: () => void;
}) => {
  const meta = STATUS_META[row.compliance_status];
  const nextActions: { icon: any; label: string; hint: string }[] = [];
  if (row.compliance_status === "critical" || row.compliance_status === "action_required") {
    if (row.open_exceptions > 0) nextActions.push({ icon: AlertTriangle, label: "Resolve open exceptions", hint: `${row.open_exceptions} open` });
    if (row.reprint_required) nextActions.push({ icon: Printer, label: "Reprint required documents", hint: "Stale document flag" });
    if (row.price_mismatch) nextActions.push({ icon: DollarSign, label: "Reconcile advertised price", hint: `parse: ${row.price_parse_status}` });
  }
  if (row.compliance_status === "verification_needed") {
    nextActions.push({ icon: ClipboardCheck, label: "Complete prep sign-off", hint: "Foreman verification pending" });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <aside className="relative w-full max-w-xl bg-background border-l border-border h-full overflow-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-background border-b border-border px-5 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">Vehicle compliance</div>
            <div className="font-mono text-sm truncate">{row.vin}</div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-5">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${meta.cls}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
              {meta.label}
            </span>
            <span className="text-xs text-muted-foreground">{row.ymm}{row.trim ? ` · ${row.trim}` : ""}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <Field label="Stock">{row.stock_number || "—"}</Field>
            <Field label="Rooftop">{row.store_id || "—"}</Field>
            <Field label="Inventory age">{row.inventory_age_days !== null ? `${row.inventory_age_days} days` : "—"}</Field>
            <Field label="Last verified">{row.last_verified_at ? new Date(row.last_verified_at).toLocaleDateString() : "—"}</Field>
            <Field label="Listing status">{row.listing_status || "—"}</Field>
            <Field label="Condition">{row.is_used ? "Used / CPO" : "New / Demo"}</Field>
          </div>

          {/* Signals */}
          <div className="rounded-lg border border-border">
            <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground border-b border-border">Signals</div>
            <ul className="divide-y divide-border">
              <SignalRow icon={AlertTriangle} label="Open exceptions" value={row.open_exceptions}
                tone={row.open_by_severity.critical > 0 ? "red" : row.open_by_severity.high + row.open_by_severity.medium > 0 ? "orange" : "muted"}>
                {row.top_open_exception && <span className="text-muted-foreground">Top: {row.top_open_exception.title}</span>}
              </SignalRow>
              <SignalRow icon={Printer} label="Reprint required" value={row.reprint_required ? "Yes" : "No"}
                tone={row.reprint_required ? "orange" : "muted"} />
              <SignalRow icon={DollarSign} label="Price" value={row.price != null ? `$${row.price.toLocaleString()}` : "—"}
                tone={row.price_mismatch ? "orange" : "muted"}>
                <span className="text-muted-foreground">parse: {row.price_parse_status || "—"}</span>
              </SignalRow>
              <SignalRow icon={ClipboardCheck} label="Physical verification" value={row.verified ? "Verified" : "Pending"}
                tone={row.verified ? "emerald" : "amber"} />
              <SignalRow icon={FileWarning} label="Missing Buyers Guide" value="—"
                tone="muted"><span className="text-muted-foreground">not yet tracked</span></SignalRow>
            </ul>
          </div>

          {nextActions.length > 0 && (
            <div className="rounded-lg border border-border">
              <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground border-b border-border">Recommended next actions</div>
              <ul className="divide-y divide-border">
                {nextActions.map((a, i) => {
                  const Icon = a.icon;
                  return (
                    <li key={i} className="px-3 py-2 flex items-center gap-2 text-xs">
                      <Icon className="w-3.5 h-3.5 text-orange-600" />
                      <span className="font-medium text-foreground">{a.label}</span>
                      <span className="ml-auto text-muted-foreground">{a.hint}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Link to={`/admin/exceptions?vin=${encodeURIComponent(row.vin)}`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 h-9 rounded-md border border-border hover:bg-muted">
              <AlertTriangle className="w-3.5 h-3.5" /> Open in Exceptions
              <ExternalLink className="w-3 h-3" />
            </Link>
            <Link to={`/compliance?vin=${encodeURIComponent(row.vin)}`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 h-9 rounded-md border border-border hover:bg-muted">
              <ShieldCheck className="w-3.5 h-3.5" /> Open audit packet
              <ExternalLink className="w-3 h-3" />
            </Link>
            <Link to={`/vehicle-file/${row.vehicle_id}`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 h-9 rounded-md border border-border hover:bg-muted">
              Vehicle file
            </Link>
            {!canResolve && (
              <div className="text-[11px] text-muted-foreground w-full pt-1">
                Read-only — resolving exceptions requires elevated role.
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className="text-foreground mt-0.5">{children}</div>
  </div>
);

const SignalRow = ({ icon: Icon, label, value, tone, children }: {
  icon: any; label: string; value: React.ReactNode;
  tone: "muted" | "emerald" | "amber" | "orange" | "red";
  children?: React.ReactNode;
}) => {
  const toneCls =
    tone === "emerald" ? "text-emerald-700" :
    tone === "amber" ? "text-amber-700" :
    tone === "orange" ? "text-orange-700" :
    tone === "red" ? "text-red-700" : "text-foreground";
  return (
    <li className="px-3 py-2 flex items-center gap-2 text-xs">
      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      <span className="font-medium text-foreground">{label}</span>
      <span className="ml-auto flex items-center gap-2">
        {children}
        <span className={`font-semibold ${toneCls}`}>{value}</span>
      </span>
    </li>
  );
};

export default CommandCenter;
