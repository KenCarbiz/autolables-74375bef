import { useEffect, useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { useViewTransitionNavigate } from "@/lib/navigation";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useVinQueue } from "@/hooks/useVinQueue";
import { useVinScan } from "@/contexts/VinScanContext";
import { buildSelfAwareWorkItems, createSelfAwareWorkItems, type DealerAutomationSettings, type SelfAwareVehicle } from "@/lib/automation/selfAwareWorkEngine";
import {
  classifyWorkItem,
  exceptionCopy,
  isLiveException,
  isSystemException,
  WORK_LANES,
  type WorkLane,
} from "@/lib/work/workClassification";
import { AlertTriangle, Car, CheckCircle2, ClipboardList, Filter, Inbox, PlayCircle, Printer, RefreshCw, RotateCcw, ScanLine, ShieldCheck, Sparkles, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";

type WorkStatus = "all" | "open" | "needs_approval" | "in_progress" | "completed" | "cancelled";
type Department = "all" | "inventory" | "print" | "service" | "detail" | "compliance" | "manager" | "passport" | "finance" | "third_party";

type WorkItem = {
  id: string;
  vehicle_id?: string | null;
  vin?: string | null;
  stock?: string | null;
  vehicle_title?: string | null;
  condition?: string | null;
  work_type: string;
  title: string;
  description?: string | null;
  status: string;
  priority?: string | null;
  department?: string | null;
  source?: string | null;
  assigned_to?: string | null;
  due_at?: string | null;
  created_at?: string | null;
  metadata?: Record<string, unknown> | null;
  vehicleActive?: boolean;
};

const statusLabels: Record<string, string> = {
  open: "Open",
  needs_approval: "Needs approval",
  in_progress: "In progress",
  completed: "Done",
  cancelled: "Cancelled",
};

const laneCopy: Record<WorkLane, string> = {
  needs_me: "New work lands here the moment it carries your name.",
  team: "Tasks owned by someone else on the team show up here.",
  waiting: "Human work with no owner yet waits here for someone to take it.",
  system_exception: "Records the sync wrote about vehicles still on the lot.",
  completed: "Finished and cancelled work stays here for the audit trail.",
};

const departmentIcon = (department?: string | null) => {
  if (department === "print") return Printer;
  if (department === "service" || department === "detail" || department === "third_party") return Wrench;
  if (department === "compliance" || department === "manager") return ShieldCheck;
  if (department === "passport") return Sparkles;
  return ClipboardList;
};

const deepLinkOf = (item: WorkItem) => {
  const link = item.metadata?.deep_link;
  if (typeof link === "string" && link) return link;
  if (item.vehicle_id) return `/vehicle-file/${item.vehicle_id}`;
  return null;
};

const vehicleLabel = (item: WorkItem) => {
  const customer = item.metadata?.customer_name;
  if (typeof customer === "string" && customer.trim()) return customer.trim();
  if (item.vehicle_title) return item.vehicle_title;
  if (item.stock) return `Stock ${item.stock}`;
  if (item.vin) return item.vin;
  return "No vehicle on file";
};

const dueLabel = (item: WorkItem) => {
  if (!item.due_at) return { text: "No due date", overdue: false };
  const due = new Date(item.due_at);
  if (Number.isNaN(due.getTime())) return { text: "No due date", overdue: false };
  const overdue = due.getTime() < Date.now() && item.status !== "completed" && item.status !== "cancelled";
  return { text: `${overdue ? "Overdue " : ""}${format(due, "MMM d, yyyy")}`, overdue };
};

const WorkQueue = () => {
  const { tenant } = useTenant();
  const { user } = useAuth();
  const navigate = useViewTransitionNavigate();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [lane, setLane] = useState<WorkLane>("needs_me");
  const [status, setStatus] = useState<WorkStatus>("all");
  const [department, setDepartment] = useState<Department>("all");
  const [includeDeparted, setIncludeDeparted] = useState(false);
  const [q, setQ] = useState("");

  const load = async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("dealer_work_items")
      .select("*")
      .or(`tenant_id.eq.${tenant.id},store_id.eq.${tenant.id}`)
      .order("created_at", { ascending: false })
      .limit(250);

    // Open description exceptions are system records too, not owned tasks, so
    // they carry an exception_ work_type and land in the exceptions lane.
    const { data: descExc } = await (supabase as any)
      .from("description_exceptions")
      .select("id, vehicle_id, exception_type, severity, blocking, title, summary, created_at, description_case_id")
      .eq("tenant_id", tenant.id).in("status", ["open", "in_progress"])
      .order("created_at", { ascending: false }).limit(100);
    const descItems: WorkItem[] = ((descExc || []) as any[]).map((e) => ({
      id: `desc-exc-${e.id}`,
      vehicle_id: e.vehicle_id,
      work_type: "exception_description_review",
      title: e.title || "Description exception",
      description: e.summary || "A vehicle description needs review before it can publish.",
      status: "open",
      priority: e.blocking ? "high" : e.severity === "critical" ? "urgent" : "normal",
      department: "passport",
      source: "description_exception",
      created_at: e.created_at,
      metadata: { deep_link: `/description-intelligence/${e.vehicle_id}`, exception_type: e.exception_type },
    }));

    // Active inventory drives `vehicleActive`. When this read fails we mark
    // everything active: a silent miss would hide every live exception behind
    // the departed-vehicle filter, which is worse than showing a few extras.
    const { data: activeRows, error: activeErr } = await (supabase as any)
      .from("vehicle_listings")
      .select("id, vin")
      .or(`tenant_id.eq.${tenant.id},tenant_id.is.null`)
      .neq("status", "archived")
      .limit(2000);
    const activeIds = new Set<string>();
    const activeVins = new Set<string>();
    for (const row of ((activeRows || []) as { id?: string | null; vin?: string | null }[])) {
      if (row.id) activeIds.add(row.id);
      if (row.vin) activeVins.add(row.vin.toUpperCase());
    }
    const inventoryKnown = !activeErr && (activeRows || []).length > 0;
    const withActivity = (rows: WorkItem[]) => rows.map((row) => ({
      ...row,
      vehicleActive: inventoryKnown
        ? Boolean((row.vehicle_id && activeIds.has(row.vehicle_id)) || (row.vin && activeVins.has(row.vin.toUpperCase())))
        : true,
    }));

    if (error) {
      toast.error("Could not load Work Queue. The newest migration may still be deploying.");
      setItems(withActivity(descItems));
    } else {
      setItems(withActivity([...((data || []) as WorkItem[]), ...descItems]));
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenant?.id]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((item) => {
      if (status !== "all" && item.status !== status) return false;
      if (department !== "all" && item.department !== department) return false;
      if (!needle) return true;
      return [item.title, item.description, item.vin, item.stock, item.vehicle_title, item.work_type, item.department]
        .filter(Boolean)
        .some((value) => `${value}`.toLowerCase().includes(needle));
    });
  }, [items, status, department, q]);

  const byLane = useMemo(() => {
    const buckets: Record<WorkLane, WorkItem[]> = {
      needs_me: [], team: [], waiting: [], system_exception: [], completed: [],
    };
    for (const item of filtered) buckets[classifyWorkItem(item, user?.id)].push(item);
    return buckets;
  }, [filtered, user?.id]);

  // isLiveException gates on open/needs_approval; an exception someone already
  // started must not vanish from the lane while it is being worked.
  const liveExceptions = useMemo(
    () => byLane.system_exception.filter(
      (item) => isLiveException(item) || (item.vehicleActive === true && item.status === "in_progress"),
    ),
    [byLane.system_exception],
  );
  const departedCount = byLane.system_exception.length - liveExceptions.length;
  const visibleExceptions = includeDeparted ? byLane.system_exception : liveExceptions;

  const laneCount = (key: WorkLane) => key === "system_exception" ? visibleExceptions.length : byLane[key].length;
  const laneItems = lane === "system_exception" ? visibleExceptions : byLane[lane];

  const updateStatus = async (item: WorkItem, nextStatus: string) => {
    // Description exceptions are not dealer_work_items rows — they can only be
    // resolved on the description record, where the decision is audited.
    if (item.source === "description_exception") {
      toast.info("Open the description record to resolve this exception.");
      return;
    }
    const patch: Record<string, unknown> = { status: nextStatus, updated_at: new Date().toISOString() };
    if (nextStatus === "completed") patch.completed_at = new Date().toISOString();
    const { error } = await (supabase as any).from("dealer_work_items").update(patch).eq("id", item.id);
    if (error) return toast.error("Could not update work item");
    setItems((prev) => prev.map((row) => row.id === item.id ? { ...row, status: nextStatus } : row));
    toast.success(nextStatus === "completed" ? "Marked done" : "Work item updated");
  };

  const generateFromInventory = async () => {
    if (!tenant?.id) return toast.error("No active dealership");
    setCreating(true);
    try {
      const { data: settingsRow } = await (supabase as any)
        .from("dealer_automation_settings")
        .select("*")
        .eq("tenant_id", tenant.id)
        .maybeSingle();

      const settings: DealerAutomationSettings = settingsRow || {
        auto_create_work_from_scraper: true,
        auto_create_print_tasks: true,
        auto_send_used_to_get_ready: false,
        auto_send_new_to_get_ready: false,
        auto_check_standard_prep: true,
        require_manager_approval_before_print: false,
        require_manager_approval_before_passport_publish: true,
      };

      const { data: vehicles, error } = await (supabase as any)
        .from("vehicle_listings")
        .select("id,tenant_id,vin,stock_number,ymm,year,make,model,trim,condition,mileage,price,fuel_type,title_status,cpo_status,is_demo")
        .or(`tenant_id.eq.${tenant.id},tenant_id.is.null`)
        // Retired cars keep their row for the customer passport; they are not
        // work.
        .neq("status", "archived")
        .order("updated_at", { ascending: false })
        .limit(150);

      if (error) throw error;
      let created = 0;
      for (const vehicle of (vehicles || []) as SelfAwareVehicle[]) {
        const result = await createSelfAwareWorkItems({ ...vehicle, tenant_id: vehicle.tenant_id || tenant.id, store_id: tenant.id }, settings);
        created += result.created;
      }
      toast.success(created ? `Created ${created} self-aware work item${created === 1 ? "" : "s"}` : "Queue already looks current");
      load();
    } catch (err) {
      console.error(err);
      toast.error("Could not generate work from inventory");
    } finally {
      setCreating(false);
    }
  };

  const previewVehicleWork = (item: WorkItem) => {
    if (!item.vehicle_id) return [];
    return buildSelfAwareWorkItems({ id: item.vehicle_id, vin: item.vin, stock: item.stock, ymm: item.vehicle_title, condition: item.condition }, {});
  };

  const filtersActive = status !== "all" || department !== "all" || q.trim().length > 0;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-4 lg:p-6">
      <section className="rounded-2xl border border-border bg-card px-5 py-5 shadow-sm lg:px-6 lg:py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-al-meta font-bold uppercase tracking-[0.18em] text-muted-foreground">Work</p>
            <h1 className="font-display text-al-page text-foreground mt-1">What needs a person today.</h1>
            <p className="text-al-body text-muted-foreground mt-2 max-w-2xl">
              Tasks people own come first. Everything the sync recorded about a vehicle sits in its own lane, so a feed
              event never counts as somebody&apos;s job.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={load} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-4 text-al-button text-foreground transition-colors hover:bg-muted disabled:opacity-60">
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button onClick={generateFromInventory} disabled={creating} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-al-button text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60">
              <PlayCircle className="h-4 w-4" /> {creating ? "Building queue..." : "Build from inventory"}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-2 shadow-sm">
        <div className="flex gap-1 overflow-x-auto">
          {WORK_LANES.map((l) => {
            const active = l.key === lane;
            const count = laneCount(l.key);
            return (
              <button
                key={l.key}
                onClick={() => setLane(l.key)}
                aria-current={active ? "page" : undefined}
                className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-al-button transition-colors ${active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
              >
                {l.label}
                <span className={`rounded-full px-2 py-0.5 text-al-meta ${active ? "bg-card text-foreground" : "bg-muted text-muted-foreground"}`}>{count}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search VIN, stock, task, department..." className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-al-body text-foreground outline-none focus:border-primary" />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value as WorkStatus)} className="h-10 rounded-xl border border-border bg-card px-3 text-al-button text-foreground">
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="needs_approval">Needs approval</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Done</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select value={department} onChange={(e) => setDepartment(e.target.value as Department)} className="h-10 rounded-xl border border-border bg-card px-3 text-al-button text-foreground">
            <option value="all">All departments</option>
            <option value="inventory">Inventory</option>
            <option value="print">Print</option>
            <option value="service">Service</option>
            <option value="detail">Detail</option>
            <option value="third_party">Third party</option>
            <option value="compliance">Compliance</option>
            <option value="manager">Manager</option>
            <option value="passport">Passport</option>
            <option value="finance">Finance</option>
          </select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <QuickFilter label="Needs approval" onClick={() => { setStatus("needs_approval"); setDepartment("all"); }} />
          <QuickFilter label="Print queue" onClick={() => { setDepartment("print"); setStatus("all"); }} />
          <QuickFilter label="Get-ready" onClick={() => { setDepartment("service"); setStatus("all"); }} />
          <QuickFilter label="Compliance" onClick={() => { setDepartment("compliance"); setStatus("all"); }} />
          {filtersActive && (
            <button onClick={() => { setStatus("all"); setDepartment("all"); setQ(""); }} className="inline-flex h-8 items-center rounded-full border border-border bg-card px-3 text-al-meta text-muted-foreground transition-colors hover:bg-muted">
              Clear filters
            </button>
          )}
        </div>
      </section>

      {lane === "system_exception" && (
        <section className="rounded-2xl border border-border bg-muted/40 px-4 py-3">
          <label className="flex flex-wrap items-center gap-2 text-al-body text-muted-foreground">
            <input
              type="checkbox"
              checked={includeDeparted}
              onChange={(e) => setIncludeDeparted(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-current"
            />
            Include exceptions about vehicles that have left the lot
            {departedCount > 0 ? ` (${departedCount} hidden)` : ""}
          </label>
          <p className="text-al-meta text-muted-foreground mt-1">
            Off by default: a sold car&apos;s exception is a record of what happened, not work anybody can do.
          </p>
        </section>
      )}

      {(department === "all" || department === "print") && <VinPrintQueue />}

      <section className="space-y-3">
        {loading ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center text-al-body text-muted-foreground">Loading work...</div>
        ) : laneItems.length === 0 ? (
          filtersActive ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
              <Filter className="mx-auto h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
              <h2 className="text-al-section text-foreground mt-3">Nothing matches these filters</h2>
              <p className="text-al-body text-muted-foreground mt-1">Clear the search, status, or department filter to see this lane again.</p>
            </div>
          ) : (
            <LaneEmpty lane={lane} departedCount={lane === "system_exception" ? departedCount : 0} onShowDeparted={() => setIncludeDeparted(true)} />
          )
        ) : laneItems.map((item) => isSystemException(item) ? (
          <ExceptionRow key={item.id} item={item} onOpen={navigate} onDismiss={updateStatus} />
        ) : (
          <HumanTaskRow
            key={item.id}
            item={item}
            currentUserId={user?.id}
            previews={previewVehicleWork(item).length}
            onOpen={navigate}
            onUpdate={updateStatus}
          />
        ))}
      </section>
    </div>
  );
};

function QuickFilter({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex h-8 items-center rounded-full border border-border bg-card px-3 text-al-meta text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-al-meta uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <div className="text-al-body text-foreground mt-0.5 truncate">{children}</div>
    </div>
  );
}

function LaneEmpty({ lane, departedCount, onShowDeparted }: { lane: WorkLane; departedCount: number; onShowDeparted: () => void }) {
  const copy = WORK_LANES.find((l) => l.key === lane);
  const Icon = lane === "completed" ? ClipboardList : lane === "system_exception" ? Inbox : CheckCircle2;
  return (
    <div className="rounded-2xl border border-border bg-card p-10 text-center shadow-sm">
      <Icon className="mx-auto h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
      <h2 className="text-al-section text-foreground mt-4">{copy?.empty || "You're caught up."}</h2>
      <p className="text-al-body text-muted-foreground mt-2 mx-auto max-w-md">{laneCopy[lane]}</p>
      {lane === "system_exception" && departedCount > 0 && (
        <button onClick={onShowDeparted} className="mt-4 inline-flex h-9 items-center rounded-xl border border-border bg-card px-4 text-al-button text-foreground transition-colors hover:bg-muted">
          Show {departedCount} about vehicles that left
        </button>
      )}
    </div>
  );
}

function HumanTaskRow({ item, currentUserId, previews, onOpen, onUpdate }: {
  item: WorkItem;
  currentUserId?: string | null;
  previews: number;
  onOpen: (to: string) => void;
  onUpdate: (item: WorkItem, nextStatus: string) => void;
}) {
  const Icon = departmentIcon(item.department);
  const urgent = item.priority === "urgent" || item.priority === "high";
  const due = dueLabel(item);
  const owner = item.assigned_to
    ? (currentUserId && item.assigned_to === currentUserId ? "You" : "A teammate")
    : "Unassigned";
  const link = deepLinkOf(item);
  const external = item.source === "description_exception";

  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-al-meta uppercase tracking-[0.14em] ${urgent ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border bg-muted text-muted-foreground"}`}>
                {urgent && <AlertTriangle className="h-3 w-3" />}
                {item.priority || "normal"}
              </span>
              <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-al-meta uppercase tracking-[0.14em] text-muted-foreground">
                {statusLabels[item.status] || item.status}
              </span>
              <span className="rounded-full border border-border bg-card px-2.5 py-0.5 text-al-meta uppercase tracking-[0.14em] text-muted-foreground">
                {item.department || "inventory"}
              </span>
            </div>
            <h2 className="text-al-card text-foreground mt-2">{item.title}</h2>
            <p className="text-al-meta uppercase tracking-[0.14em] text-muted-foreground mt-2">Why</p>
            <p className="text-al-body text-muted-foreground mt-0.5">
              {item.description || "Created from this vehicle's state during the last inventory sync."}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {link && (
            <button onClick={() => onOpen(link)} className="h-9 rounded-xl border border-border bg-card px-3 text-al-button text-foreground transition-colors hover:bg-muted">
              Open record
            </button>
          )}
          {/* A description exception is not a dealer_work_items row, so Start /
              Mark done cannot act on it — rendering them made the primary
              button on the card a permanent no-op. */}
          {!external && (
            <>
              {item.status !== "in_progress" && item.status !== "completed" && (
                <button onClick={() => onUpdate(item, "in_progress")} className="h-9 rounded-xl border border-border bg-muted px-3 text-al-button text-foreground transition-colors hover:bg-card">
                  Start
                </button>
              )}
              {item.department === "print" && (
                <button onClick={() => onUpdate(item, "completed")} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-al-button text-primary-foreground transition-opacity hover:opacity-90">
                  <Printer className="h-4 w-4" /> Approve done
                </button>
              )}
              {item.status !== "completed" && item.department !== "print" && (
                <button onClick={() => onUpdate(item, "completed")} className="h-9 rounded-xl bg-primary px-3 text-al-button text-primary-foreground transition-opacity hover:opacity-90">
                  Mark done
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Vehicle or customer">{vehicleLabel(item)}</Field>
        <Field label="Owner">{owner}</Field>
        <Field label="Due">
          <span className={due.overdue ? "text-destructive" : undefined}>{due.text}</span>
        </Field>
        <Field label="Next action">
          {external ? "Open the description record" : item.status === "in_progress" ? "Finish and mark done" : "Start this task"}
        </Field>
      </div>

      {previews > 0 && item.status !== "completed" && (
        <p className="text-al-meta text-muted-foreground mt-3">
          Next-best-action engine sees {previews} possible requirement{previews === 1 ? "" : "s"} for this vehicle.
        </p>
      )}
    </article>
  );
}

function ExceptionRow({ item, onOpen, onDismiss }: {
  item: WorkItem;
  onOpen: (to: string) => void;
  onDismiss: (item: WorkItem, nextStatus: string) => void;
}) {
  const copy = exceptionCopy(item.work_type);
  const link = deepLinkOf(item);
  const detail = (item.description || "").trim();
  const showDetail = detail && detail.toLowerCase() !== copy.why.toLowerCase();
  const external = item.source === "description_exception";
  const departed = item.vehicleActive === false;

  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Inbox className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-al-card text-foreground">{copy.label}</h2>
            <p className="text-al-body text-muted-foreground mt-1">{copy.why}</p>
            {showDetail && <p className="text-al-body text-muted-foreground mt-1">{detail}</p>}
            <div className="text-al-meta text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1">
              <span>{vehicleLabel(item)}</span>
              {item.vin && <span>VIN {item.vin}</span>}
              {item.created_at && <span>Recorded {format(new Date(item.created_at), "MMM d, yyyy")}</span>}
              {departed && <span>Vehicle no longer in inventory</span>}
            </div>
            <details className="mt-2">
              <summary className="text-al-meta cursor-pointer text-muted-foreground">Diagnostics</summary>
              <p className="text-al-meta text-muted-foreground mt-1 break-all font-mono">
                {item.work_type} · {item.source || "unknown source"} · {item.status} · {item.id}
              </p>
            </details>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {copy.nextAction && link && (
            <button onClick={() => onOpen(link)} className="h-9 rounded-xl bg-primary px-3 text-al-button text-primary-foreground transition-opacity hover:opacity-90">
              {copy.nextAction}
            </button>
          )}
          {!external && item.status !== "completed" && (
            <button onClick={() => onDismiss(item, "completed")} className="h-9 rounded-xl border border-border bg-card px-3 text-al-button text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              Dismiss
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

// Scanned-VIN print queue (moved from /admin?tab=queue) — the print
// department's worklist of lot-scanned vehicles awaiting stickers.
function VinPrintQueue() {
  const navigate = useViewTransitionNavigate();
  const { openScan } = useVinScan();
  const { queue: vinQueue, updateItem: updateQueueItem, removeItem: removeQueueItem, clearCompleted } = useVinQueue();

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <ScanLine className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-al-card text-foreground">Inventory Print Queue</h2>
          </div>
          <p className="text-al-meta text-muted-foreground mt-0.5">
            Vehicles scanned from the lot. Review, customize, and print stickers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              clearCompleted();
              toast.success("Cleared completed items");
            }}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-al-meta font-medium hover:bg-muted transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Clear Completed
          </button>
          <button
            onClick={openScan}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-al-meta font-medium hover:opacity-90"
          >
            <ScanLine className="w-3.5 h-3.5" />
            Scan More
          </button>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-premium overflow-hidden">
        {vinQueue.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <ScanLine className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-al-card text-foreground">No vehicles in queue</p>
            <p className="text-al-meta text-muted-foreground mt-1">Go to the lot, open the scanner on your phone, and scan VINs to populate this queue.</p>
            <button
              onClick={openScan}
              className="mt-4 inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-al-meta font-medium hover:opacity-90"
            >
              <ScanLine className="w-3.5 h-3.5" />
              Open Scanner
            </button>
          </div>
        ) : (
          <div>
            <div className="px-5 py-3 bg-muted/30 flex items-center justify-between text-al-meta font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <span>{vinQueue.length} vehicle{vinQueue.length !== 1 ? "s" : ""} in queue</span>
              <span>{vinQueue.filter(q => q.status === "queued").length} awaiting print</span>
            </div>

            {vinQueue.map(item => {
              const decoded = (item.decoded_data as { decoded?: { ymm?: string } } | undefined)?.decoded;
              const ymm = decoded?.ymm || `VIN: ${item.vin}`;
              const isQueued = item.status === "queued";
              const isCompleted = item.status === "completed";

              return (
                <div
                  key={item.id}
                  className={`px-5 py-4 border-b border-border last:border-0 ${isCompleted ? "opacity-50" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-muted">
                        {isCompleted ? (
                          <CheckCircle2 className="w-5 h-5 text-muted-foreground" />
                        ) : (
                          <Car className="w-5 h-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-al-card text-foreground truncate">{ymm}</p>
                        <div className="flex items-center gap-3 mt-0.5 text-al-meta text-muted-foreground">
                          {item.stock_number && <span>Stock: {item.stock_number}</span>}
                          {item.mileage && <span>{parseInt(item.mileage).toLocaleString()} mi</span>}
                          {item.condition && <span className="capitalize">{item.condition}</span>}
                        </div>
                        <p className="text-al-meta text-muted-foreground mt-0.5 font-mono">{item.vin}</p>
                        {item.notes && <p className="text-al-meta text-muted-foreground mt-0.5 italic">{item.notes}</p>}
                        <p className="text-al-meta text-muted-foreground mt-1">
                          Scanned {format(new Date(item.scanned_at), "M/d/yy h:mm a")}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {isQueued && (
                        <>
                          <button
                            onClick={() => {
                              const params = new URLSearchParams();
                              params.set("vin", item.vin);
                              params.set("stock", item.stock_number || "");
                              params.set("ymm", decoded?.ymm || "");
                              navigate(`/?${params.toString()}`);
                              updateQueueItem(item.id, { status: "processing" });
                            }}
                            className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-primary text-primary-foreground text-al-meta font-medium hover:opacity-90"
                          >
                            <Printer className="w-3 h-3" />
                            Print
                          </button>
                          <button
                            onClick={() => {
                              updateQueueItem(item.id, { status: "completed" });
                              toast.success("Marked complete");
                            }}
                            className="h-8 w-8 rounded-md border border-border flex items-center justify-center hover:bg-muted"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => {
                          removeQueueItem(item.id);
                          toast.success("Removed from queue");
                        }}
                        className="h-8 w-8 rounded-md border border-border flex items-center justify-center hover:bg-destructive/5"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export default WorkQueue;
