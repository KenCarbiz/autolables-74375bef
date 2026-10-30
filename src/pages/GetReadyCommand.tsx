import { PageBody, PageHeader, Panel, StatusText, Td, Th, WorkTable, type Tone as ProductTone } from "@/components/product";
import { Crumbs, SummaryList } from "@/components/detail/parts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, Building2, Car, CheckCircle2, Copy, Loader2, Lock, Mail,
} from "lucide-react";
import { toast } from "sonner";
import {
  capabilityDenialReason, capabilityForHref, CommandAction,
  CommandCallout, CommandCapabilityProvider,
  conditionLabel, copyWithToast, DegradedNotice, EM_DASH, EmptyState, ErrorCard, formatCommandDate,
  formatCommandDateTime, LoadingCard, TimelineRail, TONE_FILL, TONE_TEXT,
  useDisabledReason, type Tone,
} from "@/components/command/CommandPrimitives";
import {
  useGetReadyCommand,
  type AuthorizationOutcome,
  type GetReadyColumn,
  type GetReadyPriority,
  type ServiceApprovalRequest,
} from "@/hooks/useCommandCenter";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { dealerRoleHome, hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { vinKey } from "@/lib/vinKeys";
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
// hardcoded en-US. Dates themselves come from formatCommandDate — this page used
// to keep its own copy that printed the raw ISO string on an unparseable stamp.
const money = (n: number | null | undefined) =>
  n == null ? EM_DASH : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

// 20260726030000 gave get_ready_records real delivery_target + priority
// columns; the loader reads them and the Delivery & Priority card writes them.
const PRIORITY_TONE: Record<string, Tone> = {
  high: "amber",
  normal: "blue",
  low: "slate",
};

// notify-getready labels every target by department, so the failure list arrives
// as dept keys. It cannot name WHICH vendor of several was missed (see W10) —
// so this says what is known and no more.
const DEPT_LABEL: Record<string, string> = {
  service: "Service",
  detail: "Detail",
  prep: "Prep",
  vendor: "The third-party vendors",
};

const deptLabel = (d: string) =>
  DEPT_LABEL[d] ?? d.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const PRODUCT_TONE: Record<Tone, ProductTone> = {
  slate: "neutral",
  blue: "info",
  amber: "warning",
  red: "danger",
  emerald: "success",
  violet: "info",
};

const StatusPill = ({ tone, children }: { tone: Tone; children: React.ReactNode }) => (
  <StatusText tone={PRODUCT_TONE[tone]}>{children}</StatusText>
);

const CommandCard = ({ title, subtitle, children, className }: { title?: string; subtitle?: string; children: React.ReactNode; className?: string }) => (
  <Panel title={title} description={subtitle} titleSize="sm" inset="sm" className={className}>{children}</Panel>
);

const COMPACT_ACTION = "min-h-[36px] rounded-md";

function ProposedWork({ columns }: { columns: GetReadyColumn[] }) {
  const rows = columns.flatMap((c) => c.items.map((item) => ({ column: c, item })));
  return (
    <Panel title="Proposed work" titleSize="sm" inset="sm" description="Prepared upstream. Nothing starts until you authorize." flush headerClassName="pb-3">
      <WorkTable caption="Proposed work by department" minWidth={640}>
        <thead>
          <tr><Th>Department</Th><Th>Work item</Th><Th>Status</Th><Th>Due</Th></tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><Td className="text-adm-muted">No work items are assigned to any department for this vehicle.</Td></tr>
          ) : rows.map(({ column, item }) => {
            const done = item.status === "complete";
            return (
              <tr key={`${column.key}-${item.id}`}>
                <Td className="whitespace-nowrap text-adm-muted">{column.title}</Td>
                <Td>
                  <p className="font-semibold text-adm-ink">{item.label || "Work item"}</p>
                  {item.sublabel && <p className="text-[12px] leading-[18px] text-adm-muted">{item.sublabel}</p>}
                </Td>
                <Td>
                  <StatusPill tone={done ? "emerald" : "amber"}>{done ? "Completed" : item.status === "pending_proof" ? "Pending proof" : "Pending"}</StatusPill>
                </Td>
                <Td className="whitespace-nowrap text-adm-muted">{item.dueLabel || EM_DASH}</Td>
              </tr>
            );
          })}
        </tbody>
      </WorkTable>
    </Panel>
  );
}

function DepartmentNote({ column, onSaveNote }: { column: GetReadyColumn; onSaveNote: (key: string, note: string) => Promise<void> }) {
  const [note, setNote] = useState(column.managerNote);
  const [saving, setSaving] = useState(false);
  // The reload that follows our own save re-delivers the value the manager has
  // already typed past, so adopt the server note only while the textarea is
  // still showing the last value we saw from the server.
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
    <div>
      <label className="block text-[13px] leading-[18px] font-semibold text-adm-ink mb-1" htmlFor={`note-${column.key}`}>
        {column.title} note (optional)
      </label>
      <textarea
        id={`note-${column.key}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={blur}
        placeholder="Add a note for this department"
        className="w-full min-h-[72px] rounded-md border border-adm-border bg-adm-surface p-2.5 text-[14px] leading-[20px] focus:outline-none focus:ring-2 focus:ring-adm-primary" />
      {saving && (
        <p className="text-[12px] leading-[18px] text-adm-muted mt-1 inline-flex items-center gap-1">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Saving note
        </p>
      )}
    </div>
  );
}

function VendorAssignments({ column }: { column: GetReadyColumn }) {
  return (
    <Panel title="Vendor assignments" titleSize="sm" inset="sm">
      {!column.vendors || column.vendors.length === 0 ? (
        <p className="text-[14px] leading-[20px] text-adm-muted">No vendors are assigned to this vehicle.</p>
      ) : (
        <div className="divide-y divide-adm-border">
          {column.vendors.map((v, i) => (
            <div key={`${v.name}-${i}`} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] leading-[20px] font-semibold text-adm-ink truncate">{v.name}</span>
                <span className="block text-[12px] leading-[18px] text-adm-muted truncate">{v.category}</span>
              </span>
              <CommandAction
                Icon={Mail}
                className={COMPACT_ACTION}
                wrapperClassName="shrink-0"
                href={v.email ? `mailto:${v.email}` : undefined}
                disabledReason={v.email ? null : "No email is on file for this vendor."}>
                Contact
              </CommandAction>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// The one blocked control on the three surfaces that cannot be wrapped in
// DisabledReason: Tailwind's `peer-*` styling requires the input to stay a direct
// sibling of the box it paints. `disabled` also made it unfocusable, so the
// browser blurred it mid-save and published no reason. aria-disabled keeps it
// focusable and the reason reaches a screen reader and a mouse alike.
function ChecklistRow({ label, checked, busy, onToggle }: {
  label: string; checked: boolean; busy: boolean; onToggle: (next: boolean) => void;
}) {
  const { describedBy, title, reasonNode } = useDisabledReason(busy ? "This checklist item is saving." : null);
  return (
    // reasonNode sits OUTSIDE the label. Inside it, the sr-only sentence became
    // part of the checkbox's accessible NAME as well as its description, so a
    // screen reader read "…saving" twice on one control.
    <div>
      <label
        title={title}
        className={cn(
          "flex items-center gap-2.5 min-h-[40px] px-1 rounded-md hover:bg-adm-workspace",
          busy ? "cursor-progress" : "cursor-pointer",
        )}>
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          aria-disabled={busy || undefined}
          aria-describedby={describedBy}
          onChange={(e) => { if (!busy) onToggle(e.target.checked); }} />
        <span className={cn(
          "grid place-items-center w-5 h-5 rounded-[4px] border shrink-0 peer-focus-visible:ring-2 peer-focus-visible:ring-primary",
          checked ? cn(TONE_FILL.blue, "border-transparent text-white") : "border-adm-border bg-adm-surface text-transparent",
        )}>
          {busy
            ? <Loader2 className={cn("w-4 h-4 animate-spin", checked ? "text-white" : "text-adm-muted")} aria-hidden="true" />
            : <CheckCircle2 className="w-4 h-4" aria-hidden="true" />}
        </span>
        <span className="text-[14px] leading-[20px] text-adm-ink">{label}</span>
      </label>
      {reasonNode}
    </div>
  );
}

// Local calendar date for <input type="date">, from the stored timestamptz.
// Slicing the ISO string reads the UTC date, which is the previous day for any
// evening save in the US — so the parts are taken in the reader's zone.
function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// B4 — the manager's delivery-target and priority controls, writing the real
// get_ready_records columns. Rendered on both views: the review stage is where
// the target gets confirmed, and mid-work is where the priority gets raised.
function DeliveryPriorityCard({ deliveryTarget, priority, canEdit, onSaveDate, onSavePriority }: {
  deliveryTarget: string | null;
  priority: GetReadyPriority | null;
  canEdit: boolean;
  onSaveDate: (iso: string | null) => Promise<void>;
  onSavePriority: (p: GetReadyPriority | null) => Promise<void>;
}) {
  const [saving, setSaving] = useState<"date" | "priority" | null>(null);
  const serverDate = toDateInputValue(deliveryTarget);
  const [localDate, setLocalDate] = useState(serverDate);
  // Same adopt-the-server-value rule as the manager note: a refetch must not
  // overwrite an edit in progress.
  const lastServerDate = useRef(serverDate);
  useEffect(() => {
    setLocalDate((local) => (local === lastServerDate.current ? serverDate : local));
    lastServerDate.current = serverDate;
  }, [serverDate]);

  const reasonId = "delivery-priority-reason";
  const denied = !canEdit;
  const busyReason = saving ? "This change is saving." : null;

  const commitDate = async () => {
    if (denied || saving || localDate === serverDate) return;
    setSaving("date");
    await onSaveDate(localDate ? new Date(`${localDate}T12:00:00`).toISOString() : null);
    setSaving(null);
  };

  const commitPriority = async (raw: string) => {
    if (denied || saving) return;
    setSaving("priority");
    await onSavePriority(raw === "high" || raw === "normal" || raw === "low" ? raw : null);
    setSaving(null);
  };

  return (
    <CommandCard title="Delivery & Priority" subtitle="The commitment the shop is working against.">
      <div className="space-y-3">
        <div>
          <label className="block text-[11.5px] font-semibold text-adm-ink mb-1.5" htmlFor="gr-delivery-target">
            Delivery Target
          </label>
          <input
            id="gr-delivery-target"
            type="date"
            value={localDate}
            aria-disabled={denied || !!saving || undefined}
            aria-describedby={denied || busyReason ? reasonId : undefined}
            readOnly={denied || !!saving}
            onChange={(e) => { if (!denied && !saving) setLocalDate(e.target.value); }}
            onBlur={commitDate}
            className={cn(
              "w-full min-h-[40px] rounded-md border border-adm-border bg-adm-surface px-3 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-primary",
              denied && "opacity-50 cursor-not-allowed",
            )} />
        </div>
        <div>
          <label className="block text-[11.5px] font-semibold text-adm-ink mb-1.5" htmlFor="gr-priority">
            Priority
          </label>
          <select
            id="gr-priority"
            value={priority ?? ""}
            aria-disabled={denied || !!saving || undefined}
            aria-describedby={denied || busyReason ? reasonId : undefined}
            onChange={(e) => void commitPriority(e.target.value)}
            disabled={denied || !!saving}
            className={cn(
              "w-full min-h-[40px] rounded-md border border-adm-border bg-adm-surface px-3 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-primary",
              denied && "opacity-50 cursor-not-allowed",
            )}>
            <option value="">Not set</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </div>
        {saving && (
          <p className="text-[10.5px] text-adm-muted inline-flex items-center gap-1">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Saving…
          </p>
        )}
        {(denied || busyReason) && (
          <p id={reasonId} className="text-[10.5px] text-adm-muted">
            {denied ? "Only a manager can set the delivery target and priority." : busyReason}
          </p>
        )}
      </div>
    </CommandCard>
  );
}

// The four S6 result lines, shown once after a completed authorization run.
function AuthorizationResults({ outcome }: { outcome: AuthorizationOutcome }) {
  const reached = outcome.targets.filter((t) => t.ok).map((t) => deptLabel(t.name));
  const lines: { label: string; detail: string; ok: boolean }[] = [
    {
      // The real EVT_AUTHORIZED write status, not a hardcoded yes: a marker
      // that never reached the timeline is the one failure this line exists
      // to surface.
      label: "Get Ready Authorized",
      detail: !outcome.recorded
        ? "The work orders went out, but the authorization could not be recorded on the VIN timeline. Do not authorize again — check the VIN timeline first."
        : outcome.snapshotFrozen
          ? "Instructions frozen and recorded on the VIN timeline."
          : "Recorded on the VIN timeline, but the instruction snapshot could not be captured — the shop has the emailed work orders.",
      ok: outcome.recorded && outcome.snapshotFrozen,
    },
    {
      label: "Work Dispatched",
      detail: reached.length ? reached.join(", ") : "No work orders were sent.",
      ok: reached.length > 0,
    },
    {
      label: "Documents Released",
      detail: `${outcome.documents.released} released, ${outcome.documents.blocked} blocked` +
        (outcome.documents.blocked > 0 ? " — blocked documents keep their reason in the Print Center." : ""),
      ok: outcome.documents.blocked === 0,
    },
    {
      label: "Notifications Sent",
      detail: outcome.failures.length
        ? `${outcome.failures.map(deptLabel).join(" and ")} ${outcome.failures.length === 1 ? "was" : "were"} not reached — contact them directly with the work order.`
        : "All departments and vendors were notified.",
      ok: outcome.failures.length === 0,
    },
  ];
  return (
    <CommandCard title="Authorization Results" className="mb-4">
      <div className="divide-y divide-border/70">
        {lines.map((l) => (
          <div key={l.label} className="flex items-start gap-2.5 py-2.5">
            {l.ok
              ? <CheckCircle2 className={cn("w-4 h-4 mt-0.5 shrink-0", TONE_TEXT.emerald)} aria-hidden="true" />
              : <AlertTriangle className={cn("w-4 h-4 mt-0.5 shrink-0", TONE_TEXT.amber)} aria-hidden="true" />}
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold text-adm-ink leading-tight">{l.label}</p>
              <p className="text-[11.5px] text-adm-muted mt-0.5">{l.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </CommandCard>
  );
}

// B5 — one department's progress on the post-authorization view.
function DeptProgressCard({ column, worklistHref }: { column: GetReadyColumn; worklistHref?: string }) {
  const pct = column.total > 0 ? Math.round((column.completed / column.total) * 100) : 0;
  const next = column.items.find((i) => i.status !== "complete");
  const tone: Tone = column.total === 0 ? "slate" : column.completed === column.total ? "emerald" : "blue";
  return (
    <CommandCard title={column.title} subtitle={column.total === 0 ? "No work items" : `${column.completed} of ${column.total} complete · ${pct}%`}>
      <div
        className="h-2 rounded-[2px] bg-adm-workspace overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${column.title} completion`}>
        <div className={cn("h-full", TONE_FILL[tone])} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[12.5px] text-adm-ink mt-3">
        {column.total === 0
          ? "Nothing was assigned to this department."
          : next
            ? <>Next: <span className="font-semibold">{next.label}</span></>
            : "All work complete."}
      </p>
      {column.managerNote && (
        <p className="text-[11.5px] text-adm-muted mt-1.5">Manager note: {column.managerNote}</p>
      )}
      <div className="mt-3 pt-3 border-t border-adm-border">
        <CommandAction
          href={worklistHref}
          capability={capabilityForHref(worklistHref)}
          disabledReason={worklistHref ? null : "This department has no worklist for this vehicle."}>
          Open Worklist
        </CommandAction>
      </div>
    </CommandCard>
  );
}

// B5 — a pending additional-work request (INTAKE_SPEC S8). The decision goes
// through decide_service_request; a note here is context, never authorization.
function RepairApprovalRow({ req, canApprove, busy, onDecide }: {
  req: ServiceApprovalRequest;
  canApprove: boolean;
  busy: string | null;
  onDecide: (id: string, decision: "approved" | "declined" | "clarify", note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const running = busy === req.id;
  const reason = !canApprove
    ? "Only a manager with service-approval authority can decide this request."
    : busy ? "A decision is already being recorded." : null;
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-adm-ink leading-tight">{req.workRequested}</p>
          <p className="text-[11.5px] text-adm-muted mt-0.5">
            {[req.requestedByName, formatCommandDate(req.createdAt), req.roNumber ? `RO ${req.roNumber}` : null]
              .filter(Boolean).join(" · ") || "Requested by service"}
          </p>
        </div>
        <div className="shrink-0 text-right space-y-1">
          {req.isSafety && <StatusPill tone="red">Safety</StatusPill>}
          <p className="text-[12.5px] font-bold text-adm-ink">{money(req.estTotal)}</p>
        </div>
      </div>
      {req.reason && <p className="text-[11.5px] text-adm-muted mt-1.5">{req.reason}</p>}
      {req.deliveryImpact && (
        <p className="text-[11.5px] text-adm-muted mt-1">Delivery impact: {req.deliveryImpact}</p>
      )}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note to the technician (optional)"
        aria-label={`Decision note for ${req.workRequested}`}
        className="w-full min-h-[56px] rounded-md border border-adm-border bg-adm-surface p-2.5 text-[14px] leading-[20px] mt-2 focus:outline-none focus:ring-2 focus:ring-adm-primary" />
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <CommandAction
          variant="primary"
          className={COMPACT_ACTION}
          busy={running}
          disabledReason={reason}
          onClick={() => onDecide(req.id, "approved", note)}>
          Approve
        </CommandAction>
        <CommandAction
          className={COMPACT_ACTION}
          busy={running}
          disabledReason={reason}
          onClick={() => onDecide(req.id, "declined", note)}>
          Decline
        </CommandAction>
        <CommandAction
          className={COMPACT_ACTION}
          busy={running}
          disabledReason={reason}
          onClick={() => onDecide(req.id, "clarify", note)}>
          Request Details
        </CommandAction>
      </div>
    </div>
  );
}

export default function GetReadyCommand() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const { isAdmin } = useAuth();
  const { member, loading: entLoading } = useEntitlements();
  const canView = hasDealerCapability(member?.role, "can_view_get_ready", isAdmin);

  // Keep the vehicle in scope while entitlements settle: withholding it until
  // `canView` flips would hand the loader a fresh id after its first commit,
  // and that commit reads as "vehicle not found" for one frame.
  const { data, loading, error, errorDetail, notFound, degraded, reload, saveManagerNote, toggleChecklist,
    authorizeAndDispatch, setDeliveryTarget, setPriority, decideServiceRequest } =
    useGetReadyCommand(entLoading || canView ? vehicleId : undefined);
  const canApproveServiceWork = hasDealerCapability(member?.role, "can_approve_service_work", isAdmin);

  const [checkOverride, setCheckOverride] = useState<Record<string, boolean>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  // The four S6 result lines from THIS session's authorization. They survive the
  // reload that swaps the page to the dispatched view, and only this session's
  // run has them — a later visit shows the dispatched view without the card.
  const [authOutcome, setAuthOutcome] = useState<AuthorizationOutcome | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);

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
    if (!res.ok) toast.error(res.error || "Checklist could not be updated");
  }, [toggleChecklist]);

  const onAuthorize = useCallback(async () => {
    setAuthorizing(true);
    const res = await authorizeAndDispatch();
    setAuthorizing(false);
    // The outcome exists whenever the authorization actually happened — even a
    // partial run (a missed recipient, a blocked document) shows its four
    // honest lines; the toast carries the problem sentence on top.
    if (res.outcome) setAuthOutcome(res.outcome);
    if (!res.ok) { toast.error(res.error || "Authorization could not be completed"); return; }
    toast.success("Get Ready authorized and dispatched");
  }, [authorizeAndDispatch]);

  const onSaveDeliveryTarget = useCallback(async (iso: string | null) => {
    const res = await setDeliveryTarget(iso);
    if (!res.ok) { toast.error(res.error || "Delivery target could not be saved"); return; }
    toast.success("Delivery target saved");
  }, [setDeliveryTarget]);

  const onSavePriority = useCallback(async (p: "high" | "normal" | "low" | null) => {
    const res = await setPriority(p);
    if (!res.ok) { toast.error(res.error || "Priority could not be saved"); return; }
    toast.success("Priority saved");
  }, [setPriority]);

  const onDecide = useCallback(async (id: string, decision: "approved" | "declined" | "clarify", note: string) => {
    setDecidingId(id);
    try {
      const res = await decideServiceRequest(id, decision, note.trim() || undefined);
      if (!res.ok) { toast.error(res.error || "The decision could not be recorded"); return; }
      toast.success(
        decision === "approved" ? "Repair approved — service was notified"
        : decision === "declined" ? "Repair declined — service was notified"
        : "Details requested from service",
      );
    } finally {
      setDecidingId(null);
    }
  }, [decideServiceRequest]);

  const shell = (children: React.ReactNode, header?: React.ReactNode) => (
    <CommandCapabilityProvider role={member?.role} isAdmin={isAdmin}>
      <PageBody width="wide">
        {header ?? (
          <>
            <Crumbs items={[{ label: "Get Ready Command", to: "/get-ready-command" }, { label: "Review vehicle" }]} />
            <PageHeader title="Review vehicle" description="Review the work AutoLabels prepared, then authorize once." />
          </>
        )}
        {children}
      </PageBody>
    </CommandCapabilityProvider>
  );

  // The skeleton mirrors the served layout at every breakpoint so the swap to
  // real content never shifts the page.
  const skeleton = (
    <>
      <LoadingCard rows={2} />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        <LoadingCard rows={6} />
        <div className="w-full min-w-0 space-y-6">
          <LoadingCard rows={4} />
          <LoadingCard rows={5} />
        </div>
      </div>
    </>
  );

  // Empty-state buttons are cross-page CTAs like any other, so they route
  // through CommandAction and are disabled with the same stated reason when the
  // role cannot follow them — a service_advisor holds can_view_get_ready but not
  // can_view_inventory, and reached a live "Go to Inventory" here. "Back to Home"
  // targets the role's OWN home, so the card is never all dead controls.
  const homeAction = (
    <CommandAction href={dealerRoleHome(member?.role, isAdmin)}>Back to Home</CommandAction>
  );

  const pickVehicleAction = (
    <>
      <CommandAction
        variant="primary"
        capability="can_view_inventory"
        href="/inventory"
        TrailingIcon={ArrowRight}>
        Go to Inventory
      </CommandAction>
      {homeAction}
    </>
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
        action={pickVehicleAction} />,
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
        action={pickVehicleAction} />,
    );
  }

  if (!data) {
    return shell(
      <EmptyState Icon={Building2} title="Select a dealership to view this vehicle"
        detail="The Get Ready Command reads records for the dealership you are working in. Choose one to continue."
        action={homeAction} />,
    );
  }

  const { vehicle, columns, summary, checklist, canAuthorize, authorizeBlockedReason,
    priority, deliveryTarget, dispatchFailures, authorizedAt, authorizedByEmail,
    serviceRequests, activity } = data;
  const delivery = formatCommandDate(deliveryTarget);
  const authorizedLabel = formatCommandDateTime(authorizedAt);
  const authorized = !!authorizedAt;

  const deliveryPriorityCard = (
    <DeliveryPriorityCard
      deliveryTarget={deliveryTarget}
      priority={priority}
      canEdit={data.canDispatch}
      onSaveDate={onSaveDeliveryTarget}
      onSavePriority={onSavePriority}
    />
  );

  const worklistHrefFor = (key: GetReadyColumn["key"], column: GetReadyColumn): string | undefined =>
    key === "service"
      ? (vehicle.vin ? `/service/vehicle/${vinKey(vehicle.vin)}` : undefined)
      : column.reportHref;

  const stepTitle = STEPS.find((st) => st.n === data.currentStep)?.title ?? STEPS[0].title;
  const conditionText = conditionLabel(vehicle.condition);

  const authorizeAction = authorized ? null : (
    <CommandAction
      variant="primary"
      Icon={Lock}
      busy={authorizing}
      className={COMPACT_ACTION}
      disabledReason={authorizing ? "Authorization is already running." : canAuthorize ? null : authorizeBlockedReason}
      onClick={onAuthorize}>
      Authorize Get Ready
    </CommandAction>
  );

  const header = (
    <>
      <Crumbs items={[{ label: "Get Ready Command", to: "/get-ready-command" }, { label: vehicle.ymm || "Vehicle" }]} />
      <PageHeader
        title={authorized ? "Get Ready authorized" : "Review vehicle"}
        description={authorized
          ? `Authorized${authorizedLabel ? ` ${authorizedLabel}` : ""}${authorizedByEmail ? ` by ${authorizedByEmail}` : ""}. The instruction snapshot is frozen and work orders cannot be re-sent from here.`
          : `Step ${data.currentStep} of ${STEPS.length}, ${stepTitle}. Review the work AutoLabels prepared, then authorize once.`}
        actions={authorizeAction}
      />
    </>
  );

  const identity = (
    <section aria-label="Vehicle identity" className="flex flex-col gap-4 rounded-[6px] border border-adm-border bg-adm-surface p-4 sm:flex-row sm:items-center">
      <div className="flex h-[88px] w-[132px] shrink-0 items-center justify-center overflow-hidden rounded-[4px] bg-adm-workspace text-[13px] text-adm-muted">
        {vehicle.heroImageUrl ? <img src={vehicle.heroImageUrl} alt={vehicle.ymm} className="h-full w-full object-cover" /> : "No photo"}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[18px] leading-[26px] font-semibold text-adm-ink">{vehicle.ymm}</p>
        <p className="text-[14px] leading-[20px] text-adm-muted">{[vehicle.trim, conditionText].filter(Boolean).join(" | ") || EM_DASH}</p>
        <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-1 text-[14px] leading-[20px]">
          <div className="flex items-center gap-1.5">
            <dt className="text-adm-muted">VIN</dt>
            <dd className="font-mono text-adm-ink">{vehicle.vin}</dd>
            <button type="button" onClick={copyVin} aria-label="Copy VIN" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-adm-muted hover:bg-adm-workspace hover:text-adm-ink">
              <Copy className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="flex gap-1.5"><dt className="text-adm-muted">Stock</dt><dd className="text-adm-ink">{vehicle.stockNumber || EM_DASH}</dd></div>
          <div className="flex items-center gap-1.5">
            <dt className="text-adm-muted">Priority</dt>
            <dd className="inline-flex items-center gap-1.5 text-adm-ink">
              {priority ? (
                <>
                  <span className={cn("h-2 w-2 rounded-full", TONE_FILL[PRIORITY_TONE[priority]])} aria-hidden="true" />
                  {priority.charAt(0).toUpperCase() + priority.slice(1)}
                </>
              ) : EM_DASH}
            </dd>
          </div>
          <div className="flex gap-1.5"><dt className="text-adm-muted">Delivery target</dt><dd className="text-adm-ink">{delivery || EM_DASH}</dd></div>
        </dl>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch">
        <CommandAction className={COMPACT_ACTION} capability="can_view_inventory" href={`/vin-command/${vehicle.id}`}>VIN Command Center</CommandAction>
        <CommandAction className={COMPACT_ACTION} capability="can_view_print_queue" href={`/print-center/${vehicle.id}`}>Print Center</CommandAction>
        <CommandAction className={COMPACT_ACTION} capability="can_view_inventory" href={`/vehicle-file/${vehicle.id}`}>View vehicle details</CommandAction>
      </div>
    </section>
  );

  const summaryRows = authorized
    ? [
        { label: "Work items", value: summary.workItems },
        { label: "Estimated total cost", value: money(summary.estimatedTotal) },
        { label: "Items still open", value: summary.needAttention },
      ]
    : [
        { label: "Work items", value: summary.workItems },
        { label: "Departments", value: summary.departments },
        { label: "Estimated total cost", value: money(summary.estimatedTotal) },
        { label: "Items need attention", value: summary.needAttention },
      ];
  const summaryPanel = (
    <Panel title={authorized ? "Dispatch summary" : "Review summary"} titleSize="sm" inset="sm">
      <SummaryList rows={summaryRows} />
    </Panel>
  );

  const vendorColumn = columns.find((c) => c.key === "vendor");

  return shell(
    <>
      <DegradedNotice degraded={degraded} />

      {/* The authorization is one-shot: a recipient the dispatcher never reached
          can never be re-sent from here, so it has to stay on the page after the
          toast is gone. A manager who reloads had no surface saying service was
          never told to start. */}
      {/* No "Open Ready Board" action here on purpose: the Ready Board cannot
          re-send a single recipient — it re-emails the whole shop — so pointing
          at it was advice that could not work. Same sentence as the dispatch
          toast: contact the missed recipient directly. */}
      {dispatchFailures.length > 0 && (
        <CommandCallout
          tone="red"
          Icon={AlertTriangle}
          title="Some work orders were never sent">
          {dispatchFailures.map(deptLabel).join(" and ")}{" "}
          {dispatchFailures.length === 1 ? "was" : "were"} not reached when Get Ready was authorized
          {authorizedLabel ? ` on ${authorizedLabel}` : ""}. The authorization is recorded and cannot
          be repeated, so contact them directly with the work order — re-sending from the Ready Board
          would email the whole shop again.
        </CommandCallout>
      )}

      {identity}

      {authorized ? (
        <>
          {authOutcome && <AuthorizationResults outcome={authOutcome} />}

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
            <div className="min-w-0 grid grid-cols-1 lg:grid-cols-3 gap-4">
              {columns.map((c) => (
                <DeptProgressCard key={c.key} column={c} worklistHref={worklistHrefFor(c.key, c)} />
              ))}
            </div>

            <div className="w-full min-w-0 flex flex-col gap-6">
              {summaryPanel}
              {deliveryPriorityCard}

              {serviceRequests.length > 0 && (
                <CommandCard
                  title="Repair approvals"
                  subtitle="Additional work service found. A message alone never authorizes repairs.">
                  <div className="divide-y divide-adm-border">
                    {serviceRequests.map((req) => (
                      <RepairApprovalRow
                        key={req.id}
                        req={req}
                        canApprove={canApproveServiceWork}
                        busy={decidingId}
                        onDecide={onDecide}
                      />
                    ))}
                  </div>
                </CommandCard>
              )}

              <CommandCard title="Activity">
                <TimelineRail entries={activity.map((e) => ({ ...e, at: formatCommandDateTime(e.at) }))} />
              </CommandCard>
            </div>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
          <div className="min-w-0 flex flex-col gap-6">
            <ProposedWork columns={columns} />
            <Panel title="Manager notes" titleSize="sm" inset="sm">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {columns.filter((c) => c.key === "service" || c.key === "prep").map((c) => (
                  <DepartmentNote key={c.key} column={c} onSaveNote={onSaveNote} />
                ))}
              </div>
            </Panel>
            {vendorColumn && <VendorAssignments column={vendorColumn} />}
            <p className="text-[13px] leading-[18px] text-adm-muted">
              Third-party items show Pending proof until vendors upload completion proof. Items are due within five (5) business days.
            </p>
          </div>

          <div className="w-full min-w-0 flex flex-col gap-6">
            {summaryPanel}
            {deliveryPriorityCard}
            <CommandCard title="Authorization checklist">
              <div className="space-y-0.5">
                {checklist.map((c) => (
                  <ChecklistRow
                    key={c.key}
                    label={c.label}
                    checked={checkOverride[c.key] ?? c.done}
                    busy={busyKey === c.key}
                    onToggle={(next) => onToggle(c.key, next)}
                  />
                ))}
              </div>
              <p className="mt-3 text-[13px] leading-[18px] text-adm-muted">
                Authorizing creates immutable instructions, sends assignments, and releases eligible print jobs.
              </p>
            </CommandCard>
          </div>
        </div>
      )}
    </>,
    header,
  );
}
