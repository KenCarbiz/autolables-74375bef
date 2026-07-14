import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { toast } from "sonner";
import {
  AlertTriangle, CheckCircle2, Info, Loader2, Search, ShieldAlert, XCircle,
  MessageSquare, Clock, User as UserIcon, ChevronRight,
} from "lucide-react";

// ──────────────────────────────────────────────────────────────
// InventoryExceptions — Phase 2.3 data-integrity worklist.
// Filterable table + detail drawer. Read-only for everyone;
// resolve/assign/comment gated by `resolve_exceptions` capability.
// ──────────────────────────────────────────────────────────────

type Severity = "info" | "low" | "medium" | "high" | "critical";
type Status = "open" | "in_progress" | "resolved" | "dismissed";

interface Exception {
  id: string;
  tenant_id: string;
  vehicle_listing_id: string | null;
  vin: string;
  stock_number: string | null;
  exception_type: string;
  severity: Severity;
  title: string;
  explanation: string | null;
  source_values: Record<string, unknown> | null;
  recommended_action: string | null;
  assigned_to: string | null;
  status: Status;
  due_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  requires_new_document: boolean;
  created_at: string;
  updated_at: string;
}

interface Comment {
  id: string;
  exception_id: string;
  author: string | null;
  body: string;
  created_at: string;
}

const SEVERITY_META: Record<Severity, { label: string; cls: string; rank: number; Icon: typeof AlertTriangle }> = {
  critical: { label: "Critical", cls: "bg-red-500/15 text-red-700 border-red-500/40", rank: 5, Icon: ShieldAlert },
  high:     { label: "High",     cls: "bg-red-500/10 text-red-700 border-red-500/30",  rank: 4, Icon: AlertTriangle },
  medium:   { label: "Medium",   cls: "bg-amber-500/15 text-amber-700 border-amber-500/30", rank: 3, Icon: AlertTriangle },
  low:      { label: "Low",      cls: "bg-sky-500/15 text-sky-700 border-sky-500/30", rank: 2, Icon: Info },
  info:     { label: "Info",     cls: "bg-muted text-muted-foreground border-border", rank: 1, Icon: Info },
};

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  open:        { label: "Open",        cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" },
  in_progress: { label: "In progress", cls: "bg-sky-500/15 text-sky-700 border-sky-500/30" },
  resolved:    { label: "Resolved",    cls: "bg-muted text-muted-foreground border-border" },
  dismissed:   { label: "Dismissed",   cls: "bg-muted text-muted-foreground border-border" },
};

const TYPE_LABEL: Record<string, string> = {
  price_change: "Price change",
  mileage_change: "Mileage change",
  mileage_rollback: "Mileage rollback",
  vehicle_type_change: "Type change",
  certification_change: "Certification change",
  stock_number_change: "Stock # change",
  new_vehicle: "New vehicle",
  removed_from_feed: "Removed from feed",
  relisted: "Relisted",
  missing_required_field: "Missing required field",
  invalid_vin: "Invalid VIN",
  duplicate_stock: "Duplicate stock #",
};

const fmtWhen = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return d.toLocaleString();
};

const SeverityBadge = ({ s }: { s: Severity }) => {
  const m = SEVERITY_META[s];
  const Icon = m.Icon;
  return (
    <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-full border text-[11px] font-semibold ${m.cls}`}>
      <Icon className="w-3 h-3" /> {m.label}
    </span>
  );
};

const StatusBadge = ({ s }: { s: Status }) => (
  <span className={`inline-flex items-center h-6 px-2 rounded-full border text-[11px] font-semibold ${STATUS_META[s].cls}`}>
    {STATUS_META[s].label}
  </span>
);

export default function InventoryExceptions() {
  const { tenant } = useTenant();
  const { role, isAdmin } = useAuth();
  const tenantId = tenant?.id || null;
  const canResolve = hasDealerCapability(role, "resolve_exceptions", isAdmin);

  const [rows, setRows] = useState<Exception[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("open");
  const [severityFilter, setSeverityFilter] = useState<"all" | Severity>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Exception | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [members, setMembers] = useState<Array<{ user_id: string; email: string }>>([]);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data } = await (supabase as any).from("vehicle_exceptions")
      .select("*").eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }).limit(1000);
    setRows((data as Exception[]) || []);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      const { data } = await (supabase as any).from("tenant_members")
        .select("user_id, profiles:profiles(email)").eq("tenant_id", tenantId)
        .not("accepted_at", "is", null);
      // deno-lint-ignore no-explicit-any
      const list = ((data as any[]) || []).map((r) => ({ user_id: r.user_id, email: r.profiles?.email || r.user_id.slice(0, 8) }));
      setMembers(list);
    })();
  }, [tenantId]);

  const openException = async (ex: Exception) => {
    setSelected(ex);
    setCommentDraft("");
    const { data } = await (supabase as any).from("exception_comments")
      .select("*").eq("exception_id", ex.id).order("created_at", { ascending: true });
    setComments((data as Comment[]) || []);
  };

  const updateException = async (patch: Partial<Exception>) => {
    if (!selected) return;
    const next = { ...patch };
    if (patch.status === "resolved" || patch.status === "dismissed") {
      next.resolved_at = new Date().toISOString();
    }
    const { error } = await (supabase as any).from("vehicle_exceptions")
      .update(next).eq("id", selected.id);
    if (error) { toast.error(error.message || "Update failed"); return; }
    toast.success("Exception updated");
    setSelected({ ...selected, ...next } as Exception);
    load();
  };

  const addComment = async () => {
    if (!selected || !commentDraft.trim() || !tenantId) return;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await (supabase as any).from("exception_comments").insert({
      exception_id: selected.id, tenant_id: tenantId,
      author: u?.user?.id ?? null, body: commentDraft.trim(),
    });
    if (error) { toast.error(error.message || "Comment failed"); return; }
    setCommentDraft("");
    const { data } = await (supabase as any).from("exception_comments")
      .select("*").eq("exception_id", selected.id).order("created_at", { ascending: true });
    setComments((data as Comment[]) || []);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return rows
      .filter((r) => statusFilter === "all" ? true : r.status === statusFilter)
      .filter((r) => severityFilter === "all" ? true : r.severity === severityFilter)
      .filter((r) => typeFilter === "all" ? true : r.exception_type === typeFilter)
      .filter((r) => !q ? true : r.vin.includes(q) || (r.stock_number || "").toUpperCase().includes(q))
      .sort((a, b) => {
        const s = SEVERITY_META[b.severity].rank - SEVERITY_META[a.severity].rank;
        if (s !== 0) return s;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [rows, statusFilter, severityFilter, typeFilter, search]);

  const typeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) s.add(r.exception_type);
    return Array.from(s).sort();
  }, [rows]);

  if (!tenantId) return null;

  return (
    <div className="max-w-6xl mx-auto p-4 lg:p-6 space-y-5">
      <div>
        <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          Data integrity
        </div>
        <h1 className="mt-1 text-2xl font-display font-semibold tracking-tight text-foreground">
          Exceptions
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Data anomalies raised by the reconciliation pass: price/mileage changes, missing required fields, duplicate stock numbers, and lifecycle events. Resolve or dismiss items after review.
        </p>
        {!canResolve && (
          <div className="mt-3 rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs text-sky-700 inline-flex items-center gap-2">
            <Info className="w-3.5 h-3.5" /> Read-only view — assigning and resolving requires an elevated role.
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="VIN or stock #"
            className="h-8 pl-8 pr-3 rounded-md border border-border bg-background text-xs w-52" />
        </div>
        <FilterSelect value={statusFilter} onChange={(v) => setStatusFilter(v as any)} label="Status"
          options={[["all", "All"], ["open", "Open"], ["in_progress", "In progress"], ["resolved", "Resolved"], ["dismissed", "Dismissed"]]} />
        <FilterSelect value={severityFilter} onChange={(v) => setSeverityFilter(v as any)} label="Severity"
          options={[["all", "All"], ["critical", "Critical"], ["high", "High"], ["medium", "Medium"], ["low", "Low"], ["info", "Info"]]} />
        <FilterSelect value={typeFilter} onChange={(v) => setTypeFilter(v)} label="Type"
          options={[["all", "All"], ...typeOptions.map((t) => [t, TYPE_LABEL[t] || t] as [string, string])]} />
        <div className="text-[11px] text-muted-foreground ml-auto">
          Showing {filtered.length} of {rows.length}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border bg-card">
        {loading ? (
          <div className="p-8 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading exceptions…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <div className="font-semibold text-foreground">Nothing needs attention</div>
            <div className="text-xs text-muted-foreground mt-1">
              No exceptions match the current filters. The reconciliation pass runs on every sync.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2">Severity</th>
                  <th className="text-left px-4 py-2">Type</th>
                  <th className="text-left px-4 py-2">Vehicle</th>
                  <th className="text-left px-4 py-2">Title</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-left px-4 py-2">Created</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} onClick={() => openException(r)}
                    className="border-t border-border hover:bg-muted/40 cursor-pointer">
                    <td className="px-4 py-2"><SeverityBadge s={r.severity} /></td>
                    <td className="px-4 py-2 text-xs font-semibold text-foreground">{TYPE_LABEL[r.exception_type] || r.exception_type}</td>
                    <td className="px-4 py-2 font-mono text-xs">{r.vin}{r.stock_number ? ` · ${r.stock_number}` : ""}</td>
                    <td className="px-4 py-2 text-xs">{r.title}</td>
                    <td className="px-4 py-2"><StatusBadge s={r.status} /></td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{fmtWhen(r.created_at)}</td>
                    <td className="px-2 py-2"><ChevronRight className="w-4 h-4 text-muted-foreground" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={() => setSelected(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg h-full overflow-y-auto bg-background border-l border-border p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {TYPE_LABEL[selected.exception_type] || selected.exception_type}
                </div>
                <div className="font-display text-lg font-bold text-foreground">{selected.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  <span className="font-mono">{selected.vin}</span>
                  {selected.stock_number ? <> · Stock #{selected.stock_number}</> : null}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <SeverityBadge s={selected.severity} />
                <StatusBadge s={selected.status} />
              </div>
            </div>

            {selected.explanation && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-foreground">
                {selected.explanation}
              </div>
            )}
            {selected.recommended_action && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800">
                <div className="text-[10px] font-bold uppercase tracking-wider mb-0.5">Recommended action</div>
                {selected.recommended_action}
                {selected.requires_new_document && (
                  <div className="mt-1 text-[11px] text-amber-800/80">
                    Flagged as requiring a new document — regenerate before printing.
                  </div>
                )}
              </div>
            )}
            {selected.source_values && (
              <details className="text-[11px] rounded-lg border border-border p-2">
                <summary className="cursor-pointer text-muted-foreground">Source values</summary>
                <pre className="mt-2 font-mono overflow-x-auto">{JSON.stringify(selected.source_values, null, 2)}</pre>
              </details>
            )}

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg border border-border p-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Created</div>
                <div className="text-foreground">{new Date(selected.created_at).toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-border p-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Due</div>
                <div className="text-foreground">{selected.due_at ? new Date(selected.due_at).toLocaleString() : "—"}</div>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3 rounded-xl border border-border p-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Actions</div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</label>
                <select disabled={!canResolve} value={selected.status}
                  onChange={(e) => updateException({ status: e.target.value as Status })}
                  className="mt-1 w-full h-9 rounded-md border border-border bg-background text-sm px-2 disabled:opacity-50">
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="dismissed">Dismissed</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Assign to</label>
                <select disabled={!canResolve} value={selected.assigned_to || ""}
                  onChange={(e) => updateException({ assigned_to: e.target.value || null })}
                  className="mt-1 w-full h-9 rounded-md border border-border bg-background text-sm px-2 disabled:opacity-50">
                  <option value="">Unassigned</option>
                  {members.map((m) => (<option key={m.user_id} value={m.user_id}>{m.email}</option>))}
                </select>
              </div>
            </div>

            {/* Comments */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                <div className="text-sm font-semibold text-foreground">Comments ({comments.length})</div>
              </div>
              {comments.length === 0 && <div className="text-xs text-muted-foreground">No comments yet.</div>}
              <ul className="space-y-2">
                {comments.map((c) => (
                  <li key={c.id} className="rounded-md border border-border p-2 text-xs">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <UserIcon className="w-3 h-3" /> {c.author ? c.author.slice(0, 8) : "system"}
                      <Clock className="w-3 h-3 ml-2" /> {fmtWhen(c.created_at)}
                    </div>
                    <div className="mt-1 text-foreground whitespace-pre-wrap">{c.body}</div>
                  </li>
                ))}
              </ul>
              {canResolve && (
                <div className="mt-2 flex items-center gap-2">
                  <input value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)}
                    placeholder="Add a comment…"
                    className="flex-1 h-9 rounded-md border border-border bg-background text-sm px-2" />
                  <button onClick={addComment} disabled={!commentDraft.trim()}
                    className="h-9 px-3.5 rounded-md bg-[#F97316] hover:bg-[#EA6A0C] text-white text-sm font-semibold disabled:opacity-50">
                    Post
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const FilterSelect = ({ value, onChange, label, options }: {
  value: string; onChange: (v: string) => void; label: string;
  options: Array<[string, string]>;
}) => (
  <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
    {label}:
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-border bg-background text-xs px-2">
      {options.map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
    </select>
  </label>
);
