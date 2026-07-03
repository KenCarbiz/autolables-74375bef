import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { useViewTransitionNavigate } from "@/lib/navigation";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useVinQueue } from "@/hooks/useVinQueue";
import { useVinScan } from "@/contexts/VinScanContext";
import { buildSelfAwareWorkItems, createSelfAwareWorkItems, type DealerAutomationSettings, type SelfAwareVehicle } from "@/lib/automation/selfAwareWorkEngine";
import { AlertTriangle, Car, CheckCircle2, ClipboardList, FileText, Filter, PlayCircle, Printer, RefreshCw, RotateCcw, ScanLine, ShieldCheck, Sparkles, Trash2, Wrench } from "lucide-react";
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
  created_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

const statusLabels: Record<string, string> = {
  open: "Open",
  needs_approval: "Needs approval",
  in_progress: "In progress",
  completed: "Done",
  cancelled: "Cancelled",
};

const statusTone = (status: string) => {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "needs_approval") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "in_progress") return "border-blue-200 bg-blue-50 text-blue-800";
  if (status === "cancelled") return "border-slate-200 bg-slate-50 text-slate-500";
  return "border-slate-200 bg-white text-slate-800";
};

const departmentIcon = (department?: string | null) => {
  if (department === "print") return Printer;
  if (department === "service" || department === "detail" || department === "third_party") return Wrench;
  if (department === "compliance" || department === "manager") return ShieldCheck;
  if (department === "passport") return Sparkles;
  return ClipboardList;
};

const WorkQueue = () => {
  const { tenant } = useTenant();
  const navigate = useViewTransitionNavigate();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<WorkStatus>("all");
  const [department, setDepartment] = useState<Department>("all");
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

    if (error) {
      toast.error("Could not load Work Queue. The newest migration may still be deploying.");
      setItems([]);
    } else {
      setItems((data || []) as WorkItem[]);
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

  const counts = useMemo(() => ({
    total: items.length,
    open: items.filter((i) => i.status === "open").length,
    approval: items.filter((i) => i.status === "needs_approval").length,
    print: items.filter((i) => i.department === "print" && i.status !== "completed" && i.status !== "cancelled").length,
    service: items.filter((i) => ["service", "detail", "third_party"].includes(i.department || "") && i.status !== "completed" && i.status !== "cancelled").length,
    compliance: items.filter((i) => ["compliance", "manager"].includes(i.department || "") && i.status !== "completed" && i.status !== "cancelled").length,
  }), [items]);

  const updateStatus = async (item: WorkItem, nextStatus: string) => {
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

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-4 lg:p-6">
      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 text-white shadow-sm">
        <div className="relative grid gap-6 p-5 lg:grid-cols-[1fr_auto] lg:items-end lg:p-7">
          <div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-blue-500/20 blur-3xl" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-blue-100">
              <Sparkles className="h-3.5 w-3.5" /> Self-Aware Work Queue
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-5xl">Today&apos;s dealership work, created from inventory.</h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-white/70">
              Scraper and inventory changes should create the work automatically: stickers, Buyers Guides, get-ready, CPO/demo/EV reviews, Passport approval, and price truth checks.
            </p>
          </div>
          <div className="relative flex flex-wrap gap-2">
            <button onClick={load} disabled={loading} className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-black text-white hover:bg-white/15 disabled:opacity-60">
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button onClick={generateFromInventory} disabled={creating} className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-black text-slate-950 shadow-lg shadow-black/20 disabled:opacity-60">
              <PlayCircle className="h-4 w-4" /> {creating ? "Building queue..." : "Build from inventory"}
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <QueueMetric label="Open" value={counts.open} onClick={() => setStatus("open")} />
        <QueueMetric label="Needs Approval" value={counts.approval} tone="amber" onClick={() => setStatus("needs_approval")} />
        <QueueMetric label="Print Queue" value={counts.print} onClick={() => setDepartment("print")} />
        <QueueMetric label="Get-Ready" value={counts.service} onClick={() => setDepartment("service")} />
        <QueueMetric label="Compliance" value={counts.compliance} tone="red" onClick={() => setDepartment("compliance")} />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search VIN, stock, task, department..." className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-400" />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value as WorkStatus)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold">
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="needs_approval">Needs approval</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Done</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select value={department} onChange={(e) => setDepartment(e.target.value as Department)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold">
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
      </section>

      {(department === "all" || department === "print") && <VinPrintQueue />}

      <section className="space-y-3">
        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">Loading work queue...</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
            <h2 className="mt-3 text-xl font-black text-slate-950">No matching work items</h2>
            <p className="mt-1 text-sm text-slate-500">Build from inventory to let the system create sticker, compliance, get-ready, and Passport tasks.</p>
          </div>
        ) : filtered.map((item) => {
          const Icon = departmentIcon(item.department);
          const previews = previewVehicleWork(item);
          return (
            <article key={item.id} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-200 hover:shadow-md">
              <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
                <div className="flex gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${statusTone(item.status)}`}>{statusLabels[item.status] || item.status}</span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-slate-600">{item.department || "inventory"}</span>
                      {item.priority === "urgent" || item.priority === "high" ? <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-black uppercase text-red-700"><AlertTriangle className="h-3 w-3" /> {item.priority}</span> : null}
                    </div>
                    <h2 className="mt-2 text-xl font-black tracking-tight text-slate-950">{item.title}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-slate-600">{item.description || "Self-aware task created from vehicle state."}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
                      {item.stock && <span>Stock {item.stock}</span>}
                      {item.vin && <span>VIN {item.vin}</span>}
                      {item.vehicle_title && <span>{item.vehicle_title}</span>}
                    </div>
                    {previews.length > 0 && item.status !== "completed" && (
                      <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 p-3 text-xs font-semibold text-blue-900">
                        Next-best-action engine sees {previews.length} possible requirement{previews.length === 1 ? "" : "s"} for this vehicle.
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                  {item.vehicle_id && <button onClick={() => navigate(`/vehicle-file/${item.vehicle_id}`)} className="h-10 rounded-xl border border-slate-200 px-3 text-sm font-black text-slate-700 hover:bg-slate-50">Open vehicle</button>}
                  {item.status !== "in_progress" && item.status !== "completed" && <button onClick={() => updateStatus(item, "in_progress")} className="h-10 rounded-xl border border-blue-200 bg-blue-50 px-3 text-sm font-black text-blue-800">Start</button>}
                  {item.department === "print" && <button onClick={() => updateStatus(item, "completed")} className="h-10 rounded-xl bg-slate-950 px-3 text-sm font-black text-white"><Printer className="mr-1 inline h-4 w-4" /> Approve done</button>}
                  {item.status !== "completed" && item.department !== "print" && <button onClick={() => updateStatus(item, "completed")} className="h-10 rounded-xl bg-emerald-600 px-3 text-sm font-black text-white">Mark done</button>}
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
};

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
            <ScanLine className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-foreground">Inventory Print Queue</h2>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Vehicles scanned from the lot. Review, customize, and print stickers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              clearCompleted();
              toast.success("Cleared completed items");
            }}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-xs font-medium hover:bg-muted transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Clear Completed
          </button>
          <button
            onClick={openScan}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90"
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
            <p className="text-sm font-medium text-foreground">No vehicles in queue</p>
            <p className="text-xs text-muted-foreground mt-1">Go to the lot, open the scanner on your phone, and scan VINs to populate this queue.</p>
            <button
              onClick={openScan}
              className="mt-4 inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90"
            >
              <ScanLine className="w-3.5 h-3.5" />
              Open Scanner
            </button>
          </div>
        ) : (
          <div>
            <div className="px-5 py-3 bg-muted/30 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isCompleted ? "bg-emerald-50" : "bg-muted"
                      }`}>
                        {isCompleted ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                        ) : (
                          <Car className="w-5 h-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{ymm}</p>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                          {item.stock_number && <span>Stock: {item.stock_number}</span>}
                          {item.mileage && <span>{parseInt(item.mileage).toLocaleString()} mi</span>}
                          {item.condition && <span className="capitalize">{item.condition}</span>}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{item.vin}</p>
                        {item.notes && <p className="text-[10px] text-muted-foreground mt-0.5 italic">{item.notes}</p>}
                        <p className="text-[10px] text-muted-foreground mt-1">
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
                            className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90"
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
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
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

function QueueMetric({ label, value, tone = "blue", onClick }: { label: string; value: number; tone?: "blue" | "amber" | "red"; onClick: () => void }) {
  const toneClass = tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-900" : tone === "red" ? "border-red-200 bg-red-50 text-red-900" : "border-blue-200 bg-blue-50 text-blue-900";
  return (
    <button onClick={onClick} className={`rounded-3xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${toneClass}`}>
      <div className="text-[10px] font-black uppercase tracking-wider opacity-70">{label}</div>
      <div className="mt-1 text-3xl font-black">{value}</div>
      <div className="mt-1 text-xs font-bold opacity-70">Click to filter</div>
    </button>
  );
}

export default WorkQueue;
