import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import {
  isThirdPartyItem, type AccessoryToInstall, type GetReadyItem,
} from "@/hooks/useGetReady";
import {
  BTN_PRIMARY, BTN_SECONDARY, EM_DASH, EmptyState, ErrorCard, LoadingCard, StatusPill,
  formatCommandDate,
} from "@/components/command/CommandPrimitives";
import { Camera, ClipboardList, PackageCheck } from "lucide-react";
import { cn } from "@/lib/utils";

// The third-party vendor's task list, and nothing else. A vendor sees only the
// get-ready lines addressed to their own email: no pricing, no customer, no
// deal, no other vehicles, no dealership totals. Every field on this page comes
// from the assignment itself.

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

// GetReadyItem has no "started" fact, so the vendor's own start is stored as an
// additive key on the item. Unknown keys survive every other reader, which all
// spread the item, and no screen loses a field it already understands.
type VendorItem = GetReadyItem & { startedAt?: string; startedBy?: string };

type TabKey = "assigned" | "in_progress" | "completed";

const TABS: { key: TabKey; label: string }[] = [
  { key: "assigned", label: "Assigned" },
  { key: "in_progress", label: "In progress" },
  { key: "completed", label: "Completed" },
];

const TAB_EMPTY: Record<TabKey, { title: string; detail: string }> = {
  assigned: {
    title: "No work is assigned to you.",
    detail: "A task appears here when the store dispatches a vehicle line to your company.",
  },
  in_progress: {
    title: "You have not started any work.",
    detail: "Start a task from the assigned list and it moves here until you complete it.",
  },
  completed: {
    title: "No completed work yet.",
    detail: "Tasks you finish stay here as the store's record that the work was done.",
  },
};

const WORK_TYPE: Record<GetReadyItem["category"], string> = {
  accessory: "Accessory install",
  inspection: "Inspection",
  detail: "Detail",
  photo: "Photos",
  service: "Service work",
  other: "Vendor work",
};

interface VendorTask {
  key: string;
  recordId: string;
  itemId: string;
  vin: string;
  ymm: string;
  stockNumber: string | null;
  deliveryTarget: string | null;
  workType: string;
  label: string;
  instructions: string | null;
  started: boolean;
  complete: boolean;
  photoRequired: boolean;
  evidenceCount: number;
}

export default function VendorHome() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const { settings } = useDealerSettings();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const vendorEmail = (user?.email ?? "").trim().toLowerCase();

  const [tasks, setTasks] = useState<VendorTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("assigned");

  const photoTaskLabels = useMemo(
    () => (settings.prep_service_photo_tasks || "").split(",").map((s) => s.trim()).filter(Boolean),
    [settings.prep_service_photo_tasks],
  );

  const load = useCallback(async () => {
    if (!tenantId || !vendorEmail) { setLoading(false); return; }
    setLoading(true); setLoadError(null);
    try {
      // Server-side scoping. Reading get_ready_records directly and matching
      // the vendor's email in the browser would ship every VIN, stock number,
      // delivery target and work item in the shop to a third party, to show
      // them one line of it. The RPC returns only lines addressed to the
      // caller, and takes the address from their JWT rather than a parameter.
      const { data, error } = await sb().rpc("vendor_assigned_lines", { p_tenant_id: tenantId });
      if (error) throw new Error(error.message);

      const out: VendorTask[] = [];
      for (const row of (((data as Record<string, unknown>[]) || []))) {
        const item = row.item as VendorItem | null;
        if (!item || !isThirdPartyItem(item)) continue;
        const accessory = (row.accessory as AccessoryToInstall | null) || null;
        const evidence = (item.photos?.length ?? 0) + (accessory?.install_photos?.length ?? 0);
        out.push({
          key: `${String(row.record_id || "")}:${item.id}`,
          recordId: String(row.record_id || ""),
          itemId: item.id,
          vin: String(row.vin || "").toUpperCase(),
          ymm: String(row.ymm || "Vehicle"),
          stockNumber: (row.stock_number as string) || null,
          deliveryTarget: (row.delivery_target as string) ?? null,
          workType: WORK_TYPE[item.category] ?? WORK_TYPE.other,
          label: item.label,
          instructions: (item.notes || "").trim() || null,
          started: !!item.startedAt,
          complete: item.status === "complete",
          photoRequired: item.category === "accessory" || photoTaskLabels.includes(item.label),
          evidenceCount: evidence,
        });
      }
      setTasks(out);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Unknown error");
    }
    setLoading(false);
  }, [tenantId, vendorEmail, photoTaskLabels]);

  useEffect(() => { void load(); }, [load]);

  const patchItem = useCallback(async (task: VendorTask, patch: Partial<VendorItem>) => {
    setBusyKey(task.key);
    try {
      // Server-side, for the same reason the read is. Pulling the items array
      // into a vendor's browser to change one line leaked every other vendor's
      // assignment on that car, dropped any edit the shop made in between, and
      // let a third party stamp the dealership's completion. The RPC patches
      // only the caller's own line, under a row lock.
      const { error } = await sb().rpc("vendor_update_assigned_line", {
        p_record_id: task.recordId,
        p_item_id: task.itemId,
        p_patch: patch,
      });
      if (error) throw new Error(error.message);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "We could not save that.");
    }
    setBusyKey(null);
  }, [load]);

  const startTask = useCallback((task: VendorTask) => {
    void patchItem(task, { startedAt: new Date().toISOString(), startedBy: vendorEmail });
  }, [patchItem, vendorEmail]);

  const completeTask = useCallback((task: VendorTask) => {
    void patchItem(task, { status: "complete", completedAt: new Date().toISOString(), completedBy: vendorEmail });
  }, [patchItem, vendorEmail]);

  const inTab = useCallback((t: VendorTask, key: TabKey): boolean => {
    if (key === "completed") return t.complete;
    if (key === "in_progress") return !t.complete && t.started;
    return !t.complete && !t.started;
  }, []);

  const counts = useMemo(() => {
    const c = {} as Record<TabKey, number>;
    for (const t of TABS) c[t.key] = tasks.filter((task) => inTab(task, t.key)).length;
    return c;
  }, [tasks, inTab]);

  const visible = useMemo(() => tasks.filter((t) => inTab(t, tab)), [tasks, tab, inTab]);

  if (!tenantId) return null;

  if (loading) {
    return (
      <div className="max-w-[900px] mx-auto p-4 md:p-6 space-y-4">
        <LoadingCard rows={2} />
        <LoadingCard rows={3} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-[900px] mx-auto p-4 md:p-6">
        <ErrorCard message="We could not load your work." detail={loadError} onRetry={() => { void load(); }} />
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto p-4 md:p-6 space-y-5">
      <header>
        <div className="flex items-center gap-2">
          <PackageCheck className="w-5 h-5 text-primary" aria-hidden="true" />
          <h1 className="text-al-page font-display text-foreground">My work orders</h1>
        </div>
        <p className="text-al-body text-muted-foreground mt-0.5">
          Only the vehicle lines assigned to {vendorEmail || "your company"}.
        </p>
      </header>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "min-h-[44px] shrink-0 rounded-xl border px-4 text-al-meta font-bold uppercase tracking-[0.08em] transition-colors",
              tab === t.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            {t.label}
            <span className="ml-2 tabular-nums">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState Icon={ClipboardList} title={TAB_EMPTY[tab].title} detail={TAB_EMPTY[tab].detail} />
      ) : (
        <div className="space-y-3">
          {visible.map((t) => {
            const evidenceMissing = t.photoRequired && t.evidenceCount === 0;
            const busy = busyKey === t.key;
            return (
              <article key={t.key} className="rounded-2xl border border-border bg-card p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-al-card text-foreground">{t.ymm}</h2>
                    <p className="text-al-meta text-muted-foreground font-mono">&hellip;{t.vin.slice(-8)}</p>
                    <p className="text-al-meta text-muted-foreground">Stock {t.stockNumber || EM_DASH}</p>
                  </div>
                  <StatusPill tone={t.complete ? "emerald" : t.started ? "blue" : "slate"}>
                    {t.complete ? "COMPLETED" : t.started ? "IN PROGRESS" : "ASSIGNED"}
                  </StatusPill>
                </div>

                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                  <div>
                    <dt className="text-al-meta text-muted-foreground">Work type</dt>
                    <dd className="text-al-body text-foreground">{t.workType}</dd>
                  </div>
                  <div>
                    <dt className="text-al-meta text-muted-foreground">Due</dt>
                    <dd className="text-al-body text-foreground">{formatCommandDate(t.deliveryTarget) ?? EM_DASH}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-al-meta text-muted-foreground">Instructions</dt>
                    <dd className="text-al-body text-foreground">{t.instructions ?? t.label}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-al-meta text-muted-foreground">Required evidence</dt>
                    <dd className="text-al-body text-foreground flex items-center gap-2">
                      {t.photoRequired ? (
                        <>
                          <Camera className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                          <span>
                            Photo proof of the finished work
                            {t.evidenceCount > 0
                              ? ` — ${t.evidenceCount} ${t.evidenceCount === 1 ? "photo" : "photos"} on file`
                              : " — none on file yet"}
                          </span>
                        </>
                      ) : (
                        <span>The store asks for no photo proof on this line.</span>
                      )}
                    </dd>
                  </div>
                </dl>

                {t.complete ? null : (
                  <div className="flex flex-col sm:flex-row gap-2">
                    {t.started ? null : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => startTask(t)}
                        className={cn(BTN_SECONDARY, "w-full sm:w-auto")}
                      >
                        Start
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy || evidenceMissing}
                      onClick={() => completeTask(t)}
                      className={cn(BTN_PRIMARY, "w-full sm:w-auto")}
                    >
                      Complete
                    </button>
                  </div>
                )}

                {!t.complete && evidenceMissing ? (
                  <p className="text-al-meta text-muted-foreground">
                    This line needs photo proof before it can be completed. Submit it through the proof link the store
                    sent you, then mark it complete here.
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
