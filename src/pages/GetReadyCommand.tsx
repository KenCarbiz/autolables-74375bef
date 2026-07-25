import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, Building2, Calendar, Car, CheckCircle2, ClipboardList, Clock,
  DollarSign, ExternalLink, Info, Loader2, Lock, Mail, Users, type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  BTN_PRIMARY, BTN_SECONDARY, capabilityDenialReason, capabilityForHref, CommandAction,
  CommandCallout, CommandCapabilityProvider, CommandCard, CommandStepper, copyWithToast, EmptyState, ErrorCard,
  LoadingCard, StatusPill, VehicleIdentityStrip,
} from "@/components/command/CommandPrimitives";
import { useGetReadyCommand, type GetReadyColumn } from "@/hooks/useCommandCenter";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { TONE_CLASS, type Tone } from "@/lib/description/model";
import { cn } from "@/lib/utils";

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

// Same locale policy as every date on the three surfaces: the reader's, not a
// hardcoded en-US.
const money = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

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

function SummaryRow({ Icon, value, label, tone }: {
  Icon: LucideIcon; value: React.ReactNode; label: string; tone: Tone;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className={cn("grid place-items-center w-9 h-9 rounded-lg border shrink-0", TONE_CLASS[tone])}>
        <Icon className="w-5 h-5" aria-hidden="true" />
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
  // A department with nothing assigned is neither done nor overdue, so it must
  // not wear the amber "pending" badge that means real work is outstanding.
  const empty = column.total === 0;
  const complete = !empty && column.tone === "emerald";
  const HeadIcon = empty ? ClipboardList : complete ? CheckCircle2 : AlertTriangle;

  // The reload that follows our own save re-delivers the value the manager has
  // already typed past, so adopt the server note only while the textarea is
  // still showing the last value we saw from the server. Anything else is an
  // edit in progress and outranks the refetch.
  const serverNote = useRef(column.managerNote);
  useEffect(() => {
    setNote((local) => (local === serverNote.current ? column.managerNote : local));
    serverNote.current = column.managerNote;
  }, [column.managerNote]);

  const blur = async () => {
    if (note === column.managerNote) return;
    setSaving(true);
    await onSaveNote(column.key, note);
    setSaving(false);
  };

  return (
    <CommandCard
      className="flex flex-col"
      title={column.title}
      subtitle={column.headline}
      leading={
        <span className={cn(
          "grid place-items-center w-9 h-9 rounded-full shrink-0",
          empty ? "bg-slate-200 text-slate-600" : complete ? "bg-emerald-600 text-white" : "bg-amber-500 text-white",
        )}>
          <HeadIcon className="w-5 h-5" aria-hidden="true" />
        </span>
      }>
      <div className="divide-y divide-border/70">
        {column.items.length === 0 ? (
          <p className="text-[11.5px] text-muted-foreground py-2">No work items assigned to this department.</p>
        ) : column.items.map((item) => {
          const done = item.status === "complete";
          return (
            <div key={item.id} className="flex items-start gap-2.5 py-2.5">
              {done
                ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
                : <Clock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" aria-hidden="true" />}
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
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Saving note…
            </p>
          )}
        </div>
      )}

      {column.key === "vendor" && (
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-[11.5px] font-semibold text-foreground mb-1.5">Vendor Assignments</p>
          {!column.vendors || column.vendors.length === 0 ? (
            <p className="text-[11.5px] text-muted-foreground py-2">No vendors assigned to this vehicle.</p>
          ) : (
            <div className="divide-y divide-border/70">
              {column.vendors.map((v, i) => (
                <div key={`${v.name}-${i}`} className="flex items-center gap-2.5 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-bold text-foreground leading-tight truncate">{v.name}</span>
                    <span className="block text-[11.5px] text-muted-foreground truncate">{v.category}</span>
                  </span>
                  <CommandAction
                    Icon={Mail}
                    wrapperClassName="shrink-0"
                    href={v.email ? `mailto:${v.email}` : undefined}
                    disabledReason={v.email ? null : "No email on file for this vendor"}>
                    Contact
                  </CommandAction>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-auto pt-3 border-t border-border flex items-center justify-between gap-2 flex-wrap">
        <span className="min-w-0">
          <span className="block text-[11.5px] text-muted-foreground">Estimated Cost</span>
          <span className="block text-[13px] font-bold text-foreground leading-tight">{money(column.estimatedCost)}</span>
        </span>
        <CommandAction
          newTab
          href={column.reportHref}
          capability={capabilityForHref(column.reportHref)}
          disabledReason={column.reportHref ? null : "No report has been generated for this department yet"}
          TrailingIcon={ExternalLink}>
          {REPORT_LABEL[column.key]}
        </CommandAction>
      </div>
    </CommandCard>
  );
}

export default function GetReadyCommand() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { member, loading: entLoading } = useEntitlements();
  const canView = hasDealerCapability(member?.role, "can_view_get_ready", isAdmin);

  // Keep the vehicle in scope while entitlements settle: withholding it until
  // `canView` flips would hand the loader a fresh id after its first commit,
  // and that commit reads as "vehicle not found" for one frame.
  const { data, loading, error, errorDetail, notFound, reload, saveManagerNote, toggleChecklist, authorizeAndDispatch } =
    useGetReadyCommand(entLoading || canView ? vehicleId : undefined);

  const [checkOverride, setCheckOverride] = useState<Record<string, boolean>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [authorizing, setAuthorizing] = useState(false);

  const vin = data?.vehicle.vin ?? null;
  const copyVin = useCallback(() => { if (vin) void copyWithToast(vin, "VIN"); }, [vin]);

  // The hook already reloads itself after every successful write, so the page
  // must not fire a second refetch on top of it.
  const onSaveNote = useCallback(async (key: string, note: string) => {
    const res = await saveManagerNote(key, note);
    if (!res.ok) { toast.error(res.error || "Note could not be saved"); return; }
    toast.success("Manager note saved");
  }, [saveManagerNote]);

  const onToggle = useCallback(async (key: string, next: boolean) => {
    setBusyKey(key);
    setCheckOverride((c) => ({ ...c, [key]: next }));
    const clear = () => setCheckOverride((c) => {
      const rest = { ...c };
      delete rest[key];
      return rest;
    });
    const res = await toggleChecklist(key, next);
    clear();
    setBusyKey(null);
    if (!res.ok) toast.error(res.error || "Could not update the checklist");
  }, [toggleChecklist]);

  const onAuthorize = useCallback(async () => {
    setAuthorizing(true);
    const res = await authorizeAndDispatch();
    setAuthorizing(false);
    if (!res.ok) { toast.error(res.error || "Authorization could not be completed"); return; }
    toast.success("Get Ready authorized and dispatched");
  }, [authorizeAndDispatch]);

  // AppShell renders the title in the desktop chrome, so the in-content copy is
  // mobile-only — same convention as DescriptionOperations.
  const header = (
    <div className="min-w-0 lg:hidden mb-4">
      <h1 className="font-display text-[26px] font-bold tracking-tight text-foreground leading-none">Get Ready Command</h1>
      <p className="text-sm text-muted-foreground mt-1">Review the work AutoLabels prepared, then authorize once.</p>
    </div>
  );

  const shell = (children: React.ReactNode) => (
    <CommandCapabilityProvider role={member?.role} isAdmin={isAdmin}>
      <div className="max-w-[1480px] mx-auto p-4 sm:p-6">{header}{children}</div>
    </CommandCapabilityProvider>
  );

  // The skeleton mirrors the served layout at every breakpoint so the swap to
  // real content never shifts the page.
  const skeleton = (
    <>
      <div className="min-w-0 mb-4"><LoadingCard rows={1} /></div>
      <div className="mb-4"><LoadingCard rows={2} /></div>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
        <div className="min-w-0 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => <LoadingCard key={i} rows={5} />)}
        </div>
        <div className="w-full min-w-0 lg:w-[300px] space-y-4">
          <LoadingCard rows={4} />
          <LoadingCard rows={5} />
        </div>
      </div>
    </>
  );

  const inventoryAction = (
    <button type="button" onClick={() => navigate("/inventory")} className={BTN_PRIMARY}>
      Go to Inventory <ArrowRight className="w-4 h-4" aria-hidden="true" />
    </button>
  );

  const homeAction = (
    <button type="button" onClick={() => navigate("/dashboard")} className={BTN_SECONDARY}>
      Back to Home
    </button>
  );

  // One guard order across all three command surfaces: permission ->
  // entitlements loading -> no vehicleId -> error -> loading -> not found ->
  // no tenant. Everything after the permission check waits on `entLoading`, so
  // no state is ever shown and then swapped for the denial card.
  if (!entLoading && !canView) {
    return shell(
      <EmptyState Icon={Lock} title="You do not have access to the Get Ready Command"
        detail={capabilityDenialReason("can_view_get_ready")}
        action={homeAction} />,
    );
  }

  if (entLoading) {
    return shell(skeleton);
  }

  if (!vehicleId) {
    return shell(
      <EmptyState Icon={Car} title="Pick a vehicle to open its get ready command"
        detail="Get Ready Command opens per vehicle. Choose one from Inventory to review and authorize its get-ready."
        action={inventoryAction} />,
    );
  }

  if (error) {
    return shell(<ErrorCard message={error} detail={errorDetail} onRetry={reload} />);
  }

  if (loading) {
    return shell(skeleton);
  }

  // A vehicle that is not in this tenant is its own state — never the red error card.
  if (notFound) {
    return shell(
      <EmptyState Icon={Car} title="Vehicle not found"
        detail="This vehicle is not in your inventory, or it was removed. Pick another vehicle from Inventory."
        action={inventoryAction} />,
    );
  }

  if (!data) {
    return shell(
      <EmptyState Icon={Building2} title="Select a dealership to view this vehicle"
        detail="Get Ready Command reads records for the dealership you are working in. Choose one to continue."
        action={homeAction} />,
    );
  }

  const { vehicle, columns, summary, checklist, canAuthorize, authorizeBlockedReason,
    priority, deliveryTarget } = data;
  const delivery = dateLabel(deliveryTarget);

  return shell(
    <>
      {/* CommandStepper scrolls inside itself; this only bounds it so a 375px
          viewport never scrolls the page. */}
      <div className="min-w-0 mb-4">
        <CommandStepper steps={STEPS} current={data.currentStep} />
      </div>

      <div className="mb-4">
        <VehicleIdentityStrip
          imageUrl={vehicle.heroImageUrl}
          ymm={vehicle.ymm}
          trim={vehicle.trim}
          trimBelow
          stockNumber={vehicle.stockNumber}
          vin={vehicle.vin}
          conditionLabel={vehicle.condition}
          onCopyVin={copyVin}
          facts={[{
            label: "Priority",
            value: (
              <span className="inline-flex items-center gap-1.5">
                <span className={cn("w-2 h-2 rounded-full", priority ? PRIORITY_DOT[priority] : "bg-slate-300")} aria-hidden="true" />
                {priority ? priority.charAt(0).toUpperCase() + priority.slice(1) : "Not set"}
              </span>
            ),
          }]}
          footer={
            <>
              <p className="text-[11px] text-muted-foreground">Delivery Target</p>
              <p className="text-[12.5px] font-medium text-foreground inline-flex items-center gap-1.5 mt-0.5">
                <Calendar className="w-4 h-4 text-muted-foreground" aria-hidden="true" /> {delivery || "Not scheduled"}
              </p>
            </>
          }
          action={
            <CommandAction
              capability="can_view_inventory"
              TrailingIcon={ExternalLink}
              onClick={() => navigate(`/vehicle-file/${vehicle.id}`)}>
              View Vehicle Details
            </CommandAction>
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
        {/* Three department columns. The hook always emits the three §4
            departments, so the empty state that matters is the per-column one
            inside each card, not a page-level one that could never render. */}
        <div className="min-w-0">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {columns.map((c) => <DepartmentColumn key={c.key} column={c} onSaveNote={onSaveNote} />)}
          </div>
        </div>

        {/* Right rail */}
        <div className="w-full min-w-0 lg:w-[300px] space-y-4">
          <CommandCard title="Get Ready Summary">
            <div className="divide-y divide-border/70">
              <SummaryRow Icon={ClipboardList} value={summary.workItems} label="Work Items" tone="blue" />
              <SummaryRow Icon={Users} value={summary.departments} label="Departments" tone="slate" />
              <SummaryRow Icon={DollarSign} value={money(summary.estimatedTotal)} label="Estimated Total Cost" tone="emerald" />
              <SummaryRow Icon={AlertTriangle} value={summary.needAttention} label="Items Need Attention" tone="amber" />
            </div>
          </CommandCard>

          <CommandCard title="Authorization Checklist">
            {checklist.length === 0 ? (
              <p className="text-[11.5px] text-muted-foreground py-2">No checklist items are configured for this vehicle.</p>
            ) : (
              <div className="space-y-0.5">
                {checklist.map((c) => {
                  const checked = checkOverride[c.key] ?? c.done;
                  return (
                    <label key={c.key}
                      className="flex items-center gap-2.5 min-h-[44px] px-1 rounded-lg cursor-pointer hover:bg-muted/40">
                      <input type="checkbox" className="peer sr-only" checked={checked} disabled={busyKey === c.key}
                        onChange={(e) => onToggle(c.key, e.target.checked)} />
                      <span className={cn(
                        "grid place-items-center w-5 h-5 rounded border shrink-0 peer-focus-visible:ring-2 peer-focus-visible:ring-primary",
                        checked ? "bg-blue-600 border-blue-600 text-white" : "border-border bg-background text-transparent",
                      )}>
                        {busyKey === c.key
                          ? <Loader2 className={cn("w-3.5 h-3.5 animate-spin", checked ? "text-white" : "text-muted-foreground")} aria-hidden="true" />
                          : <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />}
                      </span>
                      <span className="text-[12.5px] text-foreground leading-tight">{c.label}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </CommandCard>

          <div>
            <CommandAction
              variant="primary"
              Icon={Lock}
              busy={authorizing}
              className="w-full"
              wrapperClassName="flex w-full"
              disabledReason={authorizing ? "Authorization is already running" : canAuthorize ? null : authorizeBlockedReason}
              onClick={onAuthorize}>
              Authorize Get Ready &amp; Dispatch
            </CommandAction>
            <p className="text-[11px] text-muted-foreground text-center mt-2">
              Creates immutable instructions, sends assignments, and releases eligible print jobs.
            </p>
          </div>
        </div>
      </div>

      <CommandCallout tone="blue" Icon={Info} className="rounded-2xl mt-4">
        Third-party items show "Pending Proof" until vendors upload completion proof. Items are
        due within five (5) business days.
      </CommandCallout>
    </>,
  );
}
