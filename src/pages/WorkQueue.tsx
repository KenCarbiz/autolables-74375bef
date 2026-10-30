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
import { MoreHorizontal, AlertTriangle, Car, CheckCircle2, ClipboardList, Filter, Inbox, PlayCircle, Printer, RefreshCw, RotateCcw, ScanLine, ShieldCheck, Sparkles, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSearchParams } from "react-router-dom";
import { PageBody, PageHeader, LocalTabs, QueryState, Panel, WorkTable, Th, Td, Button, StatusText, InlineNote, FilterSelect, type LocalTab } from "@/components/product";

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
  return { text: `${overdue ? "Overdue " : ""}${format(due, "MMM d")}`, overdue };
};

const LANE_LABEL: Record<WorkLane, string> = {
  needs_me: "My work",
  team: "Team",
  waiting: "Waiting",
  system_exception: "System exceptions",
  completed: "Completed",
};

const WorkQueue = () => {
  const { tenant } = useTenant();
  const { user } = useAuth();
  const navigate = useViewTransitionNavigate();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  // The selected tab lives in the URL so reload and back return to it.
  const [searchParams] = useSearchParams();
  const rawTab = searchParams.get("lane");
  const tabKey: WorkLane | "print" =
    rawTab === "print" ? "print" : (WORK_LANES.find((l) => l.key === rawTab)?.key ?? "needs_me");
  const lane: WorkLane = tabKey === "print" ? "needs_me" : tabKey;
  const [status, setStatus] = useState<WorkStatus>("all");
  const [department, setDepartment] = useState<Department>("all");
  const [includeDeparted, setIncludeDeparted] = useState(false);
  const [q, setQ] = useState("");
  const [age, setAge] = useState("all");
  const [owner, setOwner] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
      if (age !== "all") {
        const days = item.created_at ? Math.floor((Date.now() - new Date(item.created_at).getTime()) / 86400000) : null;
        if (days === null || (age === "today" ? days > 0 : age === "week" ? days < 1 || days > 7 : days <= 7)) return false;
      }
      if (owner !== "all") {
        const mine = !!item.assigned_to && item.assigned_to === user?.id;
        if (owner === "me" ? !mine : owner === "unassigned" ? !!item.assigned_to : !item.assigned_to || mine) return false;
      }
      if (department !== "all" && item.department !== department) return false;
      if (!needle) return true;
      return [item.title, item.description, item.vin, item.stock, item.vehicle_title, item.work_type, item.department]
        .filter(Boolean)
        .some((value) => `${value}`.toLowerCase().includes(needle));
    });
  }, [items, status, department, age, owner, q, user?.id]);

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

  const filtersActive = status !== "all" || department !== "all" || age !== "all" || owner !== "all" || q.trim().length > 0;
  const selectable = laneItems.filter((i) => !isSystemException(i) && i.source !== "description_exception" && i.status !== "completed");
  const allSelected = selectable.length > 0 && selectable.every((i) => selected.has(i.id));
  const completeSelected = async () => {
    for (const item of selectable.filter((i) => selected.has(i.id))) await updateStatus(item, "completed");
    setSelected(new Set());
  };

  const myWorkEmptyNote = (() => {
    const others = laneCount("team") + laneCount("waiting") + laneCount("system_exception");
    return others > 0
      ? `${laneCount("team")} team, ${laneCount("waiting")} waiting and ${laneCount("system_exception")} system exception items remain in the other tabs.`
      : undefined;
  })();

  const queueTabs: LocalTab[] = [
    ...WORK_LANES.map((l) => ({
      key: l.key,
      label: LANE_LABEL[l.key],
      to: l.key === "needs_me" ? "/queue" : `/queue?lane=${l.key}`,
      count: loading ? null : laneCount(l.key),
      active: tabKey === l.key,
    })),
    { key: "print", label: "Print queue", to: "/queue?lane=print", active: tabKey === "print" },
  ];

  const confirmBuild = () => {
    if (typeof window !== "undefined" && !window.confirm("Build work items from up to 150 current inventory vehicles? This creates queue items for the gaps it finds.")) return;
    void generateFromInventory();
  };

  return (
    <PageBody width="wide">
      <PageHeader
        title="Work Queue"
        description="Your tasks and items across the team."
      />

      <LocalTabs tabs={queueTabs} label="Work queue" />

      {tabKey !== "print" && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 max-w-md">
            <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-adm-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search work" placeholder="Search VIN, stock, task, department" className="h-9 w-full rounded-[6px] border border-adm-border bg-adm-surface pl-9 pr-3 text-[14px] text-adm-ink" />
          </div>
          <FilterSelect label="Filter by type" value={department} onChange={(v) => setDepartment(v as Department)}
            options={[{ value: "all", label: "All types" }, ...(["inventory", "print", "service", "detail", "third_party", "compliance", "manager", "passport", "finance"] as const).map((d) => ({ value: d, label: d === "third_party" ? "Third party" : d.charAt(0).toUpperCase() + d.slice(1) }))]} />
          <FilterSelect label="Filter by age" value={age} onChange={setAge}
            options={[{ value: "all", label: "All ages" }, { value: "today", label: "Today" }, { value: "week", label: "1 to 7 days" }, { value: "older", label: "Over 7 days" }]} />
          <FilterSelect label="Filter by owner" value={owner} onChange={setOwner}
            options={[{ value: "all", label: "All owners" }, { value: "me", label: "Me" }, { value: "team", label: "Teammates" }, { value: "unassigned", label: "Unassigned" }]} />
          <FilterSelect label="Filter by status" value={status} onChange={(v) => setStatus(v as WorkStatus)}
            options={[{ value: "all", label: "All statuses" }, { value: "open", label: "Open" }, { value: "needs_approval", label: "Needs approval" }, { value: "in_progress", label: "In progress" }, { value: "completed", label: "Done" }, { value: "cancelled", label: "Cancelled" }]} />
          {filtersActive && (
            <Button size="sm" variant="ghost" onClick={() => { setStatus("all"); setDepartment("all"); setAge("all"); setOwner("all"); setQ(""); }}>Clear filters</Button>
          )}
          {selected.size > 0 && <Button size="sm" onClick={() => void completeSelected()}>Mark {selected.size} done</Button>}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={confirmBuild} disabled={creating}>
            {creating ? "Building queue..." : "Review and build from inventory"}
          </Button>
        </div>
      )}

      {tabKey === "system_exception" && (
        <InlineNote tone="info" title="Exceptions on current inventory">
          <label className="inline-flex flex-wrap items-center gap-2">
            <input
              type="checkbox"
              checked={includeDeparted}
              onChange={(e) => setIncludeDeparted(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-current"
            />
            Include exceptions about vehicles that have left the lot{departedCount > 0 ? ` (${departedCount} hidden)` : ""}.
            A sold car&apos;s exception is a record of what happened, not work anybody can do.
          </label>
        </InlineNote>
      )}

      {tabKey === "print" ? (
        <VinPrintQueue />
      ) : (
        <div>
          <QueryState
            status={loading ? "loading" : laneItems.length === 0 ? "empty" : "ready"}
            emptyTitle={
              filtersActive
                ? "Nothing matches these filters"
                : lane === "needs_me" ? "No items in My work" : (WORK_LANES.find((l) => l.key === lane)?.empty ?? "No items")
            }
            emptyDetail={
              filtersActive
                ? "Clear the search, status or department filter to see this tab again."
                : lane === "needs_me" ? (myWorkEmptyNote ?? laneCopy[lane]) : laneCopy[lane]
            }
            emptyAction={
              !filtersActive && lane === "system_exception" && departedCount > 0
                ? <Button size="sm" onClick={() => setIncludeDeparted(true)}>Show {departedCount} about vehicles that left</Button>
                : undefined
            }
          >
            <div className="overflow-hidden rounded-[6px] border border-adm-border bg-adm-surface">
              <WorkTable className="[&_th]:px-2 [&_td]:px-2" caption="Work items" minWidth={760}>
                <thead>
                  <tr>
                    <Th className="w-8">
                      <input type="checkbox" aria-label="Select all" checked={allSelected} disabled={selectable.length === 0}
                        onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((i) => i.id)) : new Set())} className="h-4 w-4 accent-[#2457D6]" />
                    </Th>
                    <Th>Age</Th>
                    <Th>Vehicle</Th>
                    <Th>Task</Th>
                    <Th>Owner</Th>
                    <Th>Type</Th>
                    <Th>Due</Th>
                    <Th>Status</Th>
                    <Th align="right"><span className="sr-only">Actions</span></Th>
                  </tr>
                </thead>
                <tbody>
                  {laneItems.map((item) => isSystemException(item) ? (
                    <ExceptionRow key={item.id} item={item} onOpen={navigate} onDismiss={updateStatus} />
                  ) : (
                    <HumanTaskRow
                      key={item.id}
                      item={item}
                      currentUserId={user?.id}
                      previews={previewVehicleWork(item).length}
                      selected={selected.has(item.id)}
                      onSelect={(on) => setSelected((prev) => { const n = new Set(prev); if (on) n.add(item.id); else n.delete(item.id); return n; })}
                      onOpen={navigate}
                      onUpdate={updateStatus}
                    />
                  ))}
                </tbody>
              </WorkTable>
            </div>
          </QueryState>
        </div>
      )}
    </PageBody>
  );
};

const ageLabel = (iso?: string | null): string => {
  if (!iso) return "Unknown";
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  return days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`;
};

function RowMenu({ children, label }: { children: ReactNode; label: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={label} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-adm-muted hover:bg-adm-workspace">
        <MoreHorizontal className="h-5 w-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

function HumanTaskRow({ item, currentUserId, previews, onOpen, onUpdate, selected, onSelect }: {
  item: WorkItem;
  selected: boolean;
  onSelect: (on: boolean) => void;
  currentUserId?: string | null;
  previews: number;
  onOpen: (to: string) => void;
  onUpdate: (item: WorkItem, nextStatus: string) => void;
}) {
  const urgent = item.priority === "urgent" || item.priority === "high";
  const due = dueLabel(item);
  const owner = item.assigned_to
    ? (currentUserId && item.assigned_to === currentUserId ? "You" : "A teammate")
    : "Unassigned";
  const link = deepLinkOf(item);
  const external = item.source === "description_exception";

  return (
    <tr className="h-12 hover:bg-adm-workspace">
      <Td className="w-8">
        <input type="checkbox" aria-label={`Select ${item.title}`} checked={selected} disabled={external || item.status === "completed"} onChange={(e) => onSelect(e.target.checked)} className="h-4 w-4 accent-[#2457D6]" />
      </Td>
      <Td className="whitespace-nowrap text-adm-muted">{ageLabel(item.created_at)}</Td>
      <Td className="max-w-[220px] truncate"><span title={vehicleLabel(item)}>{vehicleLabel(item)}</span></Td>
      <Td className="max-w-[270px]">
        <p className="truncate font-medium text-adm-ink" title={item.title}>
          {item.title}
          {urgent && item.priority && <StatusText tone="warning" className="ml-2">{item.priority.charAt(0).toUpperCase() + item.priority.slice(1)}</StatusText>}
        </p>
      </Td>
      <Td className="text-adm-muted">{owner}</Td>
      <Td className="whitespace-nowrap capitalize text-adm-muted">{(item.department || "inventory").replace(/_/g, " ")}</Td>
      <Td className="whitespace-nowrap">
        <span className={due.overdue ? "text-adm-danger" : "text-adm-muted"}>{due.text}</span>
      </Td>
      <Td className="whitespace-nowrap">{statusLabels[item.status] || item.status}</Td>
      <Td align="right">
        <div className="flex items-center justify-end gap-2">
          {link && <button type="button" onClick={() => onOpen(link)} className="text-[14px] font-semibold text-adm-primary hover:underline">Open</button>}
          {!external && item.status !== "completed" && (
            <RowMenu label={`More actions for ${item.title}`}>
              {item.status !== "in_progress" && <DropdownMenuItem onSelect={() => onUpdate(item, "in_progress")}>Start</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => onUpdate(item, "completed")}>{item.department === "print" ? "Approve done" : "Mark done"}</DropdownMenuItem>
            </RowMenu>
          )}
        </div>
      </Td>
    </tr>
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
    <tr className="h-12 hover:bg-adm-workspace" title={[copy.why, showDetail ? detail : ""].filter(Boolean).join(" ")}>
      <Td className="w-8"><input type="checkbox" aria-label="Exception rows are resolved from the vehicle" disabled className="h-4 w-4 accent-[#2457D6]" /></Td>
      <Td className="whitespace-nowrap text-adm-muted">{ageLabel(item.created_at)}</Td>
      <Td className="max-w-[260px] truncate">{vehicleLabel(item)}{departed ? " (left the lot)" : ""}</Td>
      <Td className="max-w-[300px]">
        <p className="truncate font-medium text-adm-ink" title={copy.label}>{copy.label}</p>
      </Td>
      <Td className="text-adm-muted">System</Td>
      <Td className="whitespace-nowrap text-adm-muted">System</Td>
      <Td className="whitespace-nowrap text-adm-muted">
        {item.created_at ? format(new Date(item.created_at), "MMM d") : "Unknown"}
      </Td>
      <Td className="whitespace-nowrap">{statusLabels[item.status] || item.status}</Td>
      <Td align="right">
        <div className="flex items-center justify-end gap-2">
          {copy.nextAction && link && <button type="button" onClick={() => onOpen(link)} className="text-[14px] font-semibold text-adm-primary hover:underline">{copy.nextAction}</button>}
          {!external && item.status !== "completed" && (
            <RowMenu label={`More actions for ${copy.label}`}>
              <DropdownMenuItem onSelect={() => onDismiss(item, "completed")}>Dismiss</DropdownMenuItem>
            </RowMenu>
          )}
        </div>
      </Td>
    </tr>
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
