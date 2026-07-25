import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle, Calendar, Car, CheckCircle2, ClipboardList, Clock, DollarSign,
  ExternalLink, Info, Loader2, Lock, Mail, ShieldAlert, Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  CommandCard, CommandStepper, EmptyState, ErrorCard, LoadingCard, StatusPill,
} from "@/components/command/CommandPrimitives";
import { useGetReadyCommand, type GetReadyColumn } from "@/hooks/useCommandCenter";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";

// /get-ready-command/:vehicleId — the manager's single authorization surface.
// Everything on this page was prepared upstream; the only writes are the
// manager note, the authorization checklist, and the one-time dispatch.

const STEPS = [
  { n: 1, title: "Review Get Ready", caption: "You are here" },
  { n: 2, title: "Authorize & Dispatch", caption: "Create instructions" },
  { n: 3, title: "Work in Progress", caption: "Track and manage" },
  { n: 4, title: "Ready to Market", caption: "Print & publish" },
];

const REPORT_LABEL: Record<GetReadyColumn["key"], string> = {
  service: "View Service Report",
  prep: "View Prep Notes",
  vendor: "View Vendor Plan",
};

const money = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const dateLabel = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-amber-500",
  normal: "bg-blue-500",
  low: "bg-slate-400",
};

function SummaryRow({ Icon, value, label, tint }: {
  Icon: typeof Users; value: React.ReactNode; label: string; tint: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className={`grid place-items-center w-10 h-10 rounded-xl border shrink-0 ${tint}`}>
        <Icon className="w-5 h-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[22px] font-bold text-foreground leading-none">{value}</span>
        <span className="block text-[11.5px] text-muted-foreground mt-1 leading-tight">{label}</span>
      </span>
    </div>
  );
}

function DepartmentColumn({ column, onSaveNote }: {
  column: GetReadyColumn;
  onSaveNote: (key: string, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState(column.managerNote);
  const [saving, setSaving] = useState(false);
  const showNote = column.key === "service" || column.key === "prep";
  const complete = column.tone === "emerald";

  // A reload after an unrelated write must not clobber what the manager is
  // still typing, so only adopt the server value when it actually changed.
  useEffect(() => { setNote(column.managerNote); }, [column.managerNote]);

  const blur = async () => {
    if (note === column.managerNote) return;
    setSaving(true);
    await onSaveNote(column.key, note);
    setSaving(false);
  };

  return (
    <CommandCard className="flex flex-col">
      <div className="flex items-start gap-2.5">
        <span className={`grid place-items-center w-9 h-9 rounded-full shrink-0 text-white ${complete ? "bg-emerald-600" : "bg-amber-500"}`}>
          {complete ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-bold text-foreground leading-tight">{column.title}</span>
          <span className="block text-[11.5px] text-muted-foreground mt-0.5">{column.headline}</span>
        </span>
      </div>

      <div className="mt-3 divide-y divide-border/70">
        {column.items.length === 0 ? (
          <p className="text-[12px] text-muted-foreground py-3">No work items assigned to this department.</p>
        ) : column.items.map((item) => {
          const done = item.status === "complete";
          return (
            <div key={item.id} className="flex items-start gap-2.5 py-2.5">
              {done
                ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                : <Clock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-foreground leading-tight">{item.label}</p>
                {item.sublabel && <p className="text-[11.5px] text-muted-foreground mt-0.5">{item.sublabel}</p>}
              </div>
              <div className="shrink-0 text-right">
                {done ? (
                  <StatusPill tone="emerald">Completed</StatusPill>
                ) : (
                  <StatusPill tone="amber">{item.status === "pending_proof" ? "Pending Proof" : "Pending"}</StatusPill>
                )}
                {item.dueLabel && <p className="text-[10.5px] text-muted-foreground mt-1">{item.dueLabel}</p>}
              </div>
            </div>
          );
        })}
      </div>

      {showNote && (
        <div className="mt-3">
          <label className="block text-[11.5px] font-semibold text-foreground mb-1.5" htmlFor={`note-${column.key}`}>
            Manager Note (Optional)
          </label>
          <textarea
            id={`note-${column.key}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={blur}
            placeholder="Add a note for this department…"
            className="w-full min-h-[92px] rounded-xl border border-border bg-background p-3 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-primary" />
          {saving && (
            <p className="text-[10.5px] text-muted-foreground mt-1 inline-flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Saving note…
            </p>
          )}
        </div>
      )}

      {column.key === "vendor" && (
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-[11.5px] font-semibold text-foreground mb-1.5">Vendor Assignments</p>
          {!column.vendors || column.vendors.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">No vendors assigned to this vehicle.</p>
          ) : (
            <div className="divide-y divide-border/70">
              {column.vendors.map((v, i) => (
                <div key={`${v.name}-${i}`} className="flex items-center gap-2.5 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-bold text-foreground leading-tight truncate">{v.name}</span>
                    <span className="block text-[11.5px] text-muted-foreground truncate">{v.category}</span>
                  </span>
                  {v.email ? (
                    <a href={`mailto:${v.email}`}
                      className="shrink-0 min-h-[44px] px-3 rounded-xl border border-border bg-card text-[12.5px] font-semibold text-foreground hover:border-primary inline-flex items-center gap-1.5">
                      <Mail className="w-4 h-4" /> Contact
                    </a>
                  ) : (
                    <button type="button" disabled title="No email on file for this vendor"
                      className="shrink-0 min-h-[44px] px-3 rounded-xl border border-border bg-card text-[12.5px] font-semibold text-muted-foreground inline-flex items-center gap-1.5 opacity-60 cursor-not-allowed">
                      <Mail className="w-4 h-4" /> Contact
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-auto pt-3 border-t border-border flex items-center justify-between gap-2 flex-wrap">
        <span className="min-w-0">
          <span className="block text-[11.5px] text-muted-foreground">Estimated Cost</span>
          <span className="block text-[15px] font-bold text-foreground leading-tight">{money(column.estimatedCost)}</span>
        </span>
        {column.reportHref ? (
          <a href={column.reportHref} target="_blank" rel="noreferrer"
            className="min-h-[44px] px-3 rounded-xl border border-border bg-card text-[12.5px] font-semibold text-foreground hover:border-primary inline-flex items-center gap-1.5">
            {REPORT_LABEL[column.key]} <ExternalLink className="w-4 h-4" />
          </a>
        ) : (
          <button type="button" disabled title="No report has been generated for this department yet"
            className="min-h-[44px] px-3 rounded-xl border border-border bg-card text-[12.5px] font-semibold text-muted-foreground inline-flex items-center gap-1.5 opacity-60 cursor-not-allowed">
            {REPORT_LABEL[column.key]} <ExternalLink className="w-4 h-4" />
          </button>
        )}
      </div>
    </CommandCard>
  );
}

export default function GetReadyCommand() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const canView = hasDealerCapability(member?.role, "can_view_get_ready", isAdmin);

  const { data, loading, error, reload, saveManagerNote, toggleChecklist, authorizeAndDispatch } =
    useGetReadyCommand(canView ? vehicleId : undefined);

  const [checkOverride, setCheckOverride] = useState<Record<string, boolean>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [authorizing, setAuthorizing] = useState(false);

  const refresh = useCallback(async () => { await Promise.resolve(reload()); }, [reload]);

  const onSaveNote = useCallback(async (key: string, note: string) => {
    const res = await saveManagerNote(key, note);
    if (!res.ok) { toast.error(res.error || "Note could not be saved"); return; }
    toast.success("Manager note saved");
    await refresh();
  }, [saveManagerNote, refresh]);

  const onToggle = useCallback(async (key: string, next: boolean) => {
    setBusyKey(key);
    setCheckOverride((c) => ({ ...c, [key]: next }));
    const clear = () => setCheckOverride((c) => {
      const rest = { ...c };
      delete rest[key];
      return rest;
    });
    const res = await toggleChecklist(key, next);
    if (!res.ok) {
      clear();
      setBusyKey(null);
      toast.error(res.error || "Could not update the checklist");
      return;
    }
    await refresh();
    clear();
    setBusyKey(null);
  }, [toggleChecklist, refresh]);

  const onAuthorize = useCallback(async () => {
    setAuthorizing(true);
    const res = await authorizeAndDispatch();
    setAuthorizing(false);
    if (!res.ok) { toast.error(res.error || "Authorization could not be completed"); return; }
    toast.success("Get Ready authorized and dispatched");
    await refresh();
  }, [authorizeAndDispatch, refresh]);

  const Header = (
    <div className="min-w-0 lg:hidden mb-4">
      <h1 className="font-display text-[26px] font-bold tracking-tight text-foreground leading-none">Get Ready Command</h1>
      <p className="text-sm text-muted-foreground mt-1">Review the work AutoLabels prepared, then authorize once.</p>
    </div>
  );

  const Frame = ({ children }: { children: React.ReactNode }) => (
    <div className="max-w-[1480px] mx-auto p-4 sm:p-6">{Header}{children}</div>
  );

  if (!canView) {
    return (
      <Frame>
        <EmptyState Icon={ShieldAlert} title="You do not have access to Get Ready."
          detail="Ask an owner or manager to grant your role get-ready access."
          action={
            <button onClick={() => navigate("/dashboard")}
              className="min-h-[44px] px-4 rounded-xl border border-border bg-card text-[13px] font-semibold text-foreground">
              Back to Dashboard
            </button>
          } />
      </Frame>
    );
  }

  if (!vehicleId) {
    return (
      <Frame>
        <EmptyState Icon={Car} title="Pick a vehicle to review."
          detail="Get Ready Command opens per vehicle. Choose one from Inventory to review and authorize its get-ready."
          action={
            <button onClick={() => navigate("/inventory")}
              className="min-h-[44px] px-4 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold">
              Go to Inventory
            </button>
          } />
      </Frame>
    );
  }

  if (error) {
    return <Frame><ErrorCard message={String(error)} onRetry={reload} /></Frame>;
  }

  if (loading) {
    return (
      <Frame>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
          <div className="min-w-0 space-y-4">
            <LoadingCard rows={3} />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {[0, 1, 2].map((i) => <LoadingCard key={i} rows={5} />)}
            </div>
          </div>
          <div className="lg:w-[300px] w-full space-y-4"><LoadingCard rows={4} /><LoadingCard rows={5} /></div>
        </div>
      </Frame>
    );
  }

  if (!data) {
    return (
      <Frame>
        <EmptyState Icon={Car} title="Vehicle not found."
          detail="This vehicle is not in your inventory, or it was removed."
          action={
            <button onClick={() => navigate("/inventory")}
              className="min-h-[44px] px-4 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold">
              Go to Inventory
            </button>
          } />
      </Frame>
    );
  }

  const { vehicle, columns, summary, checklist, canAuthorize, priority, deliveryTarget } = data;
  const delivery = dateLabel(deliveryTarget);

  return (
    <div className="max-w-[1480px] mx-auto p-4 sm:p-6">
      {Header}

      {/* CommandStepper scrolls inside itself; this only bounds it so a 375px
          viewport never scrolls the page. */}
      <div className="min-w-0 mb-4">
        <CommandStepper steps={STEPS} current={data.currentStep} />
      </div>

      {/* Vehicle card */}
      <div className="rounded-2xl border border-border bg-card p-5 mb-4">
        <div className="flex flex-wrap items-start gap-4">
          {vehicle.heroImageUrl ? (
            <img src={vehicle.heroImageUrl} alt="" loading="lazy"
              className="w-[200px] aspect-[16/10] object-cover rounded-xl border border-border shrink-0" />
          ) : (
            <div className="w-[200px] aspect-[16/10] rounded-xl border border-border bg-muted/40 grid place-items-center shrink-0">
              <Car className="w-6 h-6 text-muted-foreground" />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="text-[20px] font-bold text-foreground leading-tight truncate">{vehicle.ymm}</p>
            <p className="text-[12.5px] text-muted-foreground mt-0.5">{vehicle.trim || "—"}</p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3 max-w-[560px]">
              <div className="min-w-0">
                <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">VIN</p>
                <p className="text-[12.5px] font-mono text-foreground truncate">{vehicle.vin}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">Stock #</p>
                <p className="text-[12.5px] font-medium text-foreground truncate">{vehicle.stockNumber || "—"}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">Priority</p>
                <p className="text-[12.5px] font-medium text-foreground inline-flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${priority ? PRIORITY_DOT[priority] : "bg-slate-300"}`} />
                  {priority ? priority.charAt(0).toUpperCase() + priority.slice(1) : "Not set"}
                </p>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">Delivery Target</p>
              <p className="text-[12.5px] font-medium text-foreground inline-flex items-center gap-1.5 mt-0.5">
                <Calendar className="w-4 h-4 text-muted-foreground" /> {delivery || "Not scheduled"}
              </p>
            </div>
          </div>

          <button onClick={() => navigate(`/vehicle-file/${vehicle.id}`)}
            className="shrink-0 min-h-[44px] px-4 rounded-xl border border-border bg-card text-[13px] font-semibold text-foreground hover:border-primary inline-flex items-center gap-1.5">
            View Vehicle Details <ExternalLink className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
        {/* Three department columns */}
        <div className="min-w-0">
          {columns.length === 0 ? (
            <EmptyState Icon={ClipboardList} title="No get-ready work has been prepared yet."
              detail="Work items appear here once the vehicle is intaken and its departments are assigned." />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {columns.map((c) => <DepartmentColumn key={c.key} column={c} onSaveNote={onSaveNote} />)}
            </div>
          )}
        </div>

        {/* Right rail */}
        <div className="lg:w-[300px] w-full min-w-0 space-y-4">
          <CommandCard title="Get Ready Summary">
            <div className="divide-y divide-border/70">
              <SummaryRow Icon={ClipboardList} value={summary.workItems} label="Work Items" tint="bg-blue-50 text-blue-700 border-blue-200" />
              <SummaryRow Icon={Users} value={summary.departments} label="Departments" tint="bg-slate-100 text-slate-700 border-slate-200" />
              <SummaryRow Icon={DollarSign} value={money(summary.estimatedTotal)} label="Estimated Total Cost" tint="bg-emerald-50 text-emerald-700 border-emerald-200" />
              <SummaryRow Icon={AlertTriangle} value={summary.needAttention} label="Items Need Attention" tint="bg-amber-50 text-amber-800 border-amber-200" />
            </div>
          </CommandCard>

          <CommandCard title="Authorization Checklist">
            {checklist.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">No checklist items are configured for this vehicle.</p>
            ) : (
              <div className="space-y-0.5">
                {checklist.map((c) => {
                  const checked = checkOverride[c.key] ?? c.done;
                  return (
                    <label key={c.key}
                      className="flex items-center gap-2.5 min-h-[44px] px-1 rounded-lg cursor-pointer hover:bg-muted/40">
                      <input type="checkbox" className="sr-only" checked={checked} disabled={busyKey === c.key}
                        onChange={(e) => onToggle(c.key, e.target.checked)} />
                      <span className={`grid place-items-center w-5 h-5 rounded border shrink-0 ${
                        checked ? "bg-blue-600 border-blue-600 text-white" : "border-border bg-background text-transparent"}`}>
                        {busyKey === c.key
                          ? <Loader2 className={`w-3.5 h-3.5 animate-spin ${checked ? "text-white" : "text-muted-foreground"}`} />
                          : <CheckCircle2 className="w-3.5 h-3.5" />}
                      </span>
                      <span className="text-[12.5px] text-foreground leading-tight">{c.label}</span>
                    </label>
                  );
                })}
              </div>
            )}

            <button onClick={onAuthorize} disabled={!canAuthorize || authorizing}
              title={canAuthorize ? undefined : "Complete the authorization checklist to enable dispatch"}
              className="mt-3 w-full min-h-[44px] px-4 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
              {authorizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              Authorize Get Ready &amp; Dispatch
            </button>
            <p className="text-[11px] text-muted-foreground text-center mt-2">
              Creates immutable instructions, sends assignments, and releases eligible print jobs.
            </p>
          </CommandCard>
        </div>
      </div>

      <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-3 mt-4">
        <p className="text-[12.5px] text-blue-900 inline-flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Third-party items show "Pending Proof" until vendors upload completion proof. Items are due within five (5) business days.</span>
        </p>
      </div>
    </div>
  );
}
