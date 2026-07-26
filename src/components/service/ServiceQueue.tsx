import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { useVinScan } from "@/contexts/VinScanContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { deriveServiceStatus } from "@/lib/service/serviceStatus";
import { deriveServicePriority, compareServicePriority, type ServicePriority } from "@/lib/service/priority";
import { clearanceReasonLabel } from "@/lib/service/workspaceStatus";
import { isFailureResolved } from "@/lib/service/transitions";
import { isFailedInspection } from "@/lib/commandCenter/inspectionState";
import {
  CommandStatCard, EmptyState, ErrorCard, LoadingCard, StatusPill,
  BTN_PRIMARY, BTN_SECONDARY, formatCommandDateTime,
} from "@/components/command/CommandPrimitives";
import {
  ClipboardList, ShieldCheck, AlertTriangle, CheckCircle2, Clock, XCircle,
  Search, QrCode, ChevronRight, CircleDot, Circle, Wrench, ArrowUp, ArrowDown, Minus, FileText, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ──────────────────────────────────────────────────────────────
// Service Desk queue — "Vehicles Requiring Service Action" (desktop comp).
// One row per used/CPO vehicle: deterministic priority with a stored-style
// reason code rendered in plain language, labeled Age, Assigned To, station
// chips, delivery clearance, and ONE next action that opens the shared
// workspace at /service/vehicle/:vin. Row click opens the preview drawer —
// never the inspection form.
// ──────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

interface MemberRow { user_id: string | null; email: string | null; role: string; accepted_at: string | null; }

interface Row {
  id: string; vin: string; ymm: string; trim: string; stock: string; photo: string;
  condition: string;
  grState: "not_started" | "in_progress" | "complete" | "failed";
  k208State: "waiting" | "ready" | "executed" | "blocked" | "voided";
  inspectionState: string | null;
  delivery: string;
  deliveryTarget: string | null;
  clearanceState: string | null;
  clearanceReasons: string[];
  next: { label: string; tone: "primary" | "danger" | "ghost" };
  nextTask: string;
  nextWhy: string | null;
  priority: ServicePriority;
  bucket: "get_ready" | "in_progress" | "failed" | "reinspect" | "ready_to_sign" | "pending_clearance" | "done";
  overdue: boolean;
  overdueDays: number;
  completedToday: boolean;
  awaiting: boolean;
  cleared: boolean;
  sold: boolean;
  assignedTo: string | null;
  assignedName: string | null;
  inspectionId: string | null;
  inspectionStatus: string | null;
  ageHours: number;
  openFailures: number;
  readySince: string | null;
}

const isToday = (iso?: string | null) => {
  if (!iso) return false;
  const d = new Date(iso); const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};

const ageLabel = (hours: number): string => {
  if (hours < 24) return `${Math.max(0, Math.round(hours))}h`;
  return `${Math.floor(hours / 24)}d ${Math.round(hours % 24)}h`;
};

// The operational truth, not a stopwatch: overdue vehicles say how many days
// overdue they are; on-time vehicles say how long they have been in service.
const ageDisplay = (r: Pick<Row, "overdue" | "overdueDays" | "ageHours">): string => {
  if (r.overdue) {
    return r.overdueDays >= 1 ? `${r.overdueDays} ${r.overdueDays === 1 ? "day" : "days"} overdue` : "Overdue";
  }
  const days = Math.floor(r.ageHours / 24);
  return days >= 1 ? `${days}d in service` : `${Math.max(0, Math.round(r.ageHours))}h in service`;
};

const TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  // Cross-bucket view matching the Pending-work KPI exactly: not cleared and
  // not executed. Like Overdue, it filters on row facts, not on the bucket.
  { key: "pending", label: "Pending" },
  { key: "get_ready", label: "Get Ready" },
  { key: "in_progress", label: "In Progress" },
  { key: "failed", label: "Failed" },
  { key: "reinspect", label: "Reinspect" },
  { key: "ready_to_sign", label: "Ready to Sign" },
  { key: "pending_clearance", label: "Pending Clearance" },
  { key: "overdue", label: "Overdue" },
  { key: "done", label: "Completed" },
];

const GR_CHIP: Record<Row["grState"], { label: string; cls: string; Icon: typeof Circle }> = {
  not_started: { label: "Not started", cls: "text-slate-500", Icon: Circle },
  in_progress: { label: "In progress", cls: "text-blue-600", Icon: CircleDot },
  complete: { label: "Work complete", cls: "text-emerald-600", Icon: CheckCircle2 },
  failed: { label: "Failed items", cls: "text-red-600", Icon: XCircle },
};
const K208_CHIP: Record<Row["k208State"], { label: string; cls: string; Icon: typeof Circle }> = {
  waiting: { label: "Waiting", cls: "text-slate-500", Icon: Clock },
  ready: { label: "Ready to certify", cls: "text-blue-600", Icon: Clock },
  blocked: { label: "Blocked", cls: "text-red-600", Icon: AlertTriangle },
  executed: { label: "Executed", cls: "text-emerald-600", Icon: CheckCircle2 },
  // "superseded" is deliberately unbuilt: nothing in this repo writes it yet.
  voided: { label: "Voided", cls: "text-slate-500", Icon: XCircle },
};

const PRIORITY_ICON = { High: ArrowUp, Medium: Minus, Low: ArrowDown } as const;
const PRIORITY_CLS = { High: "text-red-600", Medium: "text-amber-600", Low: "text-slate-400" } as const;

export default function ServiceQueue({ mode = "desk" }: { mode?: "my_work" | "desk" }) {
  const { tenant } = useTenant();
  const { user, isAdmin } = useAuth();
  const { member } = useEntitlements();
  const { openScan } = useVinScan();
  const { settings } = useDealerSettings();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [techFilter, setTechFilter] = useState("any");
  const [urgencyFilter, setUrgencyFilter] = useState("any");
  const [drawer, setDrawer] = useState<Row | null>(null);
  const overdueHours = settings.service_overdue_hours || 24;
  const uid = user?.id ?? null;
  const canAssign = isAdmin || hasDealerCapability(member?.role, "can_assign_service_work", isAdmin);

  const load = useCallback(async () => {
    if (!tenant?.id) { setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    try {
      const { data: vehicles, error: vehErr } = await sb().from("vehicle_listings")
        .select("id, vin, ymm, condition, status, mc_attributes, hero_image_url, recall_status, created_at, deal_processed_at")
        .eq("tenant_id", tenant.id)
        .in("condition", ["used", "cpo", "certified"])
        .order("created_at", { ascending: false })
        .limit(300);
      if (vehErr) throw new Error(vehErr.message);
      // deno-lint-ignore no-explicit-any
      const vs = (vehicles as any[]) || [];
      const vins = vs.map((v) => v.vin).filter(Boolean);
      const empty = Promise.resolve({ data: [] });
      const [grRes, siRes, srRes, failRes, clrRes, memRes, vfRes] = await Promise.all([
        vins.length ? sb().from("get_ready_records").select("vin, status, items, get_ready_complete_date, delivery_target").eq("tenant_id", tenant.id).in("vin", vins) : empty,
        // `id` is load-bearing: failure counts are scoped by inspection_id
        // against the newest signed row — without it every failure is skipped.
        vins.length ? sb().from("safety_inspections").select("id, vin, status, result, inspection_state, assigned_to, licensee_certified_at, signed_at, created_at").eq("tenant_id", tenant.id).in("vin", vins).order("created_at", { ascending: false }) : empty,
        // 'clarify' rows are still-open requests (waiting on the requester's
        // answer), not decided ones — they must not vanish from the queue.
        vins.length ? sb().from("service_requests").select("vin").eq("tenant_id", tenant.id).in("status", ["pending", "clarify"]).in("vin", vins) : empty,
        vins.length ? sb().from("safety_inspection_item_failures").select("vin, inspection_id, repair_state").eq("tenant_id", tenant.id).in("vin", vins) : empty,
        vins.length ? sb().from("vehicle_delivery_clearance").select("vin, state, reason_codes").eq("tenant_id", tenant.id).in("vin", vins) : empty,
        sb().rpc("list_tenant_members", { p_tenant_id: tenant.id }),
        // Stock truth: marketcheck-sync writes stock to
        // vehicle_files.stock_number; mc_attributes.stock_no is only a legacy
        // fallback that no ingest path fills anymore.
        vins.length ? sb().from("vehicle_files").select("vin, stock_number").eq("tenant_id", tenant.id).in("vin", vins) : empty,
      ]);

      // deno-lint-ignore no-explicit-any
      const grByVin = new Map<string, any>();
      // deno-lint-ignore no-explicit-any
      for (const g of ((grRes.data as any[]) || [])) if (!grByVin.has(g.vin)) grByVin.set(g.vin, g);

      // Newest SIGNED row (by signed_at), newest non-voided row, and the
      // newest row of ANY status (to render a voided chip) per VIN.
      // deno-lint-ignore no-explicit-any
      const signedByVin = new Map<string, any>();
      // deno-lint-ignore no-explicit-any
      const activeByVin = new Map<string, any>();
      // deno-lint-ignore no-explicit-any
      const newestByVin = new Map<string, any>();
      // deno-lint-ignore no-explicit-any
      for (const s of ((siRes.data as any[]) || [])) {
        if (!newestByVin.has(s.vin)) newestByVin.set(s.vin, s);
        if (s.status !== "voided" && !activeByVin.has(s.vin)) activeByVin.set(s.vin, s);
        if (s.status === "signed") {
          const prev = signedByVin.get(s.vin);
          if (!prev || String(s.signed_at || "") > String(prev.signed_at || "")) signedByVin.set(s.vin, s);
        }
      }

      const awaitingVins = new Set<string>(((srRes.data as { vin: string }[]) || []).map((r) => r.vin));
      // Failure counts are scoped to the NEWEST SIGNED inspection per VIN — a
      // VIN-wide aggregate lets an older inspection's resolved rows turn a
      // fresh signed FAIL (whose per-item filing errored) amber and hide the
      // failed bucket. The stored clearance still carries the VIN-wide block.
      const failuresByVin = new Map<string, { open: number; ready: number; resolved: number }>();
      for (const f of ((failRes.data as { vin: string; inspection_id: string; repair_state: string }[]) || [])) {
        const signed = signedByVin.get(f.vin);
        if (!signed || f.inspection_id !== signed.id) continue;
        const cur = failuresByVin.get(f.vin) || { open: 0, ready: 0, resolved: 0 };
        if (!isFailureResolved(f.repair_state)) {
          cur.open += 1;
          if (f.repair_state === "ready_for_reinspection") cur.ready += 1;
        } else {
          cur.resolved += 1;
        }
        failuresByVin.set(f.vin, cur);
      }
      const stockByVin = new Map<string, string>();
      for (const f of ((vfRes.data as { vin: string; stock_number: string | null }[]) || [])) {
        const s = String(f.stock_number || "").trim();
        if (s) stockByVin.set(String(f.vin || "").toUpperCase(), s);
      }
      const clrByVin = new Map<string, { state: string; reason_codes: string[] }>();
      for (const c of ((clrRes.data as { vin: string; state: string; reason_codes: string[] }[]) || [])) clrByVin.set(c.vin, c);
      const memberById = new Map<string, string>();
      for (const m of ((memRes.data as MemberRow[]) || [])) {
        if (m.user_id && m.email) memberById.set(m.user_id, m.email.split("@")[0]);
      }
      setMembers(((memRes.data as MemberRow[]) || [])
        .filter((m) => m.user_id && m.email && m.accepted_at)
        .map((m) => ({ id: m.user_id as string, name: (m.email as string).split("@")[0] })));

      const now = Date.now();
      const out: Row[] = vs.map((v) => {
        const vin = String(v.vin || "").toUpperCase();
        const gr = grByVin.get(v.vin);
        const signed = signedByVin.get(v.vin);
        const active = activeByVin.get(v.vin);
        const awaiting = awaitingVins.has(v.vin);
        const fails = failuresByVin.get(v.vin) || { open: 0, ready: 0, resolved: 0 };
        const clr = clrByVin.get(v.vin) || null;
        // The stored clearance + open item failures feed the derivation so the
        // queue can never render "Cleared" (or offer Execute K-208) unless the
        // stored facts allow it.
        const inspectionState = (active?.inspection_state as string) || null;
        const s = deriveServiceStatus(v, gr, signed, awaiting, {
          clearanceState: clr?.state ?? null,
          openFailures: fails.open,
          failuresReadyForReinspection: fails.ready,
          resolvedFailures: fails.resolved,
          inspectionState,
          newestVoided: newestByVin.get(v.vin)?.status === "voided",
        });
        const ageHours = v.created_at ? (now - new Date(v.created_at).getTime()) / 36e5 : 0;
        const sold = !!v.deal_processed_at || String(v.status || "") === "sold";
        // Mirrors deriveServiceStatus/deriveWorkspaceStatus: a signed fail
        // whose filed failures ALL passed reinspection is waiting on the
        // reinspection, not stuck in the failed bucket.
        const awaitingReinspection = inspectionState === "ready_for_reinspection"
          || (fails.open > 0 && fails.ready === fails.open)
          || (fails.open === 0 && fails.resolved > 0 && isFailedInspection(signed ?? null));
        const overdue = !s.cleared && s.k208State !== "executed" && ageHours > overdueHours;
        const overdueDays = overdue ? Math.floor((ageHours - overdueHours) / 24) : 0;
        const priority = deriveServicePriority({
          sold,
          deliveryToday: isToday(gr?.delivery_target),
          blocked: !!clr && clr.state !== "cleared_for_delivery",
          failedItemsOpen: s.grState === "failed" || fails.open > 0,
          awaitingReinspection,
          readyForK208: s.k208State === "ready",
          inspectionStarted: inspectionState != null && inspectionState !== "not_started",
          overdue,
          overdueDays,
          assigned: !!active?.assigned_to,
          ageHours,
          cleared: s.cleared,
        });
        // Executed-but-not-cleared is sign-off aftermath, not get-ready work:
        // it sits beside Ready to Sign as "Pending Clearance", never back in
        // the Get Ready bucket.
        const bucket: Row["bucket"] = s.cleared ? "done"
          : awaitingReinspection ? "reinspect"
          : s.k208State === "blocked" ? "failed"
          : s.k208State === "executed" ? "pending_clearance"
          : s.k208State === "ready" ? "ready_to_sign"
          : s.grState === "in_progress" ? "in_progress"
          : "get_ready";
        const ymm = String(v.ymm || "Vehicle");
        const parts = ymm.split(/\s+/);
        return {
          id: v.id, vin, ymm, trim: parts.slice(3).join(" "),
          stock: stockByVin.get(vin) || (v.mc_attributes?.stock_no as string) || "",
          photo: (v.hero_image_url as string) || (Array.isArray(v.mc_attributes?.photo_links) ? v.mc_attributes.photo_links[0] : "") || "",
          condition: String(v.condition || "used").toUpperCase(),
          grState: s.grState, k208State: s.k208State, inspectionState,
          delivery: s.blocked ? "Delivery blocked" : s.cleared ? "Cleared" : v.status === "published" ? "In stock" : "Draft",
          deliveryTarget: (gr?.delivery_target as string) || null,
          clearanceState: clr?.state ?? null,
          clearanceReasons: clr?.reason_codes ?? [],
          next: { label: s.nextLabel, tone: s.nextTone },
          nextTask: s.nextTask, nextWhy: s.nextWhy,
          priority, bucket, overdue, overdueDays,
          completedToday: !!signed?.licensee_certified_at && isToday(signed.licensee_certified_at),
          awaiting, cleared: s.cleared, sold,
          assignedTo: (active?.assigned_to as string) || null,
          assignedName: active?.assigned_to ? memberById.get(active.assigned_to) ?? null : null,
          inspectionId: (active?.id as string) || null,
          inspectionStatus: (active?.status as string) || null,
          ageHours,
          openFailures: fails.open,
          readySince: s.k208State === "ready" ? ((signed?.signed_at as string) || null) : null,
        };
      });
      out.sort(compareServicePriority);
      setRows(out);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Unknown error");
    }
    setLoading(false);
  }, [tenant?.id, overdueHours]);

  useEffect(() => { void load(); }, [load]);

  const openWorkspace = useCallback((r: Row) => navigate(`/service/vehicle/${r.vin}`), [navigate]);

  // KPI sublabels are measured, never invented.
  const stats = useMemo(() => {
    const pending = rows.filter((r) => !r.cleared && r.k208State !== "executed");
    const unassigned = pending.filter((r) => !r.assignedTo).length;
    const mine = uid ? pending.filter((r) => r.assignedTo === uid).length : 0;
    const ready = rows.filter((r) => r.k208State === "ready");
    const oldestReadyH = ready.length
      ? Math.max(...ready.map((r) => (r.readySince ? (Date.now() - new Date(r.readySince).getTime()) / 36e5 : 0)))
      : 0;
    // Counts exactly what its click target (the Failed tab) shows: rows in the
    // "failed" bucket. Awaiting-approval and reinspect rows live in other tabs
    // and must not inflate a KPI whose target cannot show them.
    const blocked = rows.filter((r) => r.bucket === "failed");
    const soldBlocked = blocked.filter((r) => r.sold).length;
    // Counts exactly what the Completed tab shows, restricted to today: a
    // vehicle certified today but still pending clearance is NOT completed.
    const done = rows.filter((r) => r.bucket === "done");
    const doneToday = done.filter((r) => r.completedToday).length;
    return {
      pending: pending.length,
      pendingSub: `${mine} assigned to you · ${unassigned} unassigned`,
      ready: ready.length,
      readySub: ready.length ? `Oldest waiting ${ageLabel(oldestReadyH)}` : "None waiting",
      blocked: blocked.length,
      blockedSub: soldBlocked ? `${soldBlocked} sold and still blocked` : "None sold",
      doneToday,
      doneSub: `of ${done.length} completed`,
    };
  }, [rows]);

  // Needs Attention: true exceptions only. Auto-created tasks sit at
  // inspection_state 'not_started' (never null), so both spellings of
  // "not started" must fire the delivery-today rule.
  const attention = useMemo(() => rows.filter((r) => {
    if (r.cleared) return false;
    if (r.sold && isToday(r.deliveryTarget) && (r.inspectionState == null || r.inspectionState === "not_started")) return true;
    if (r.openFailures > 0 || r.grState === "failed") return true;
    if (r.k208State === "ready" && r.readySince && (Date.now() - new Date(r.readySince).getTime()) / 36e5 >= 18) return true;
    if (r.sold && r.clearanceState && r.clearanceState !== "cleared_for_delivery") return true;
    return false;
  }).slice(0, 4), [rows]);

  const technicians = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) if (r.assignedTo) map.set(r.assignedTo, r.assignedName || "Member");
    return Array.from(map.entries());
  }, [rows]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab === "overdue") { if (!r.overdue) return false; }
      else if (tab === "pending") { if (r.cleared || r.k208State === "executed") return false; }
      else if (tab !== "all" && r.bucket !== tab) return false;
      if (techFilter === "unassigned" && r.assignedTo) return false;
      if (techFilter !== "any" && techFilter !== "unassigned" && r.assignedTo !== techFilter) return false;
      if (urgencyFilter === "today" && !isToday(r.deliveryTarget)) return false;
      if (urgencyFilter === "scheduled" && !r.deliveryTarget) return false;
      if (urgencyFilter === "unscheduled" && r.deliveryTarget) return false;
      if (term && !(`${r.ymm} ${r.vin} ${r.stock}`.toLowerCase().includes(term))) return false;
      return true;
    });
  }, [rows, tab, q, techFilter, urgencyFilter]);

  if (loading) return <div className="space-y-4"><LoadingCard rows={2} /><LoadingCard rows={6} /></div>;
  if (loadError) {
    return <ErrorCard message="We could not load the Service Desk. Your existing inspection work has not been changed." detail={loadError} onRetry={() => void load()} />;
  }

  // My Service Work: the technician's default. Five queues, tablet-sized
  // cards, one context-aware action each — never the 300-row backlog.
  if (mode === "my_work") {
    const active = (r: Row) => !r.cleared && r.k208State !== "executed";
    const term = q.trim().toLowerCase();
    const match = (r: Row) => !term || `${r.ymm} ${r.vin} ${r.stock}`.toLowerCase().includes(term);
    const inProgressMine = rows.filter((r) => match(r) && active(r) && r.assignedTo === uid && r.inspectionState === "in_progress");
    const assignedMine = rows.filter((r) => match(r) && active(r) && r.assignedTo === uid && r.k208State !== "voided" && r.inspectionState !== "in_progress");
    const returnedMine = rows.filter((r) => match(r) && r.assignedTo === uid && r.k208State === "voided");
    const unassigned = rows.filter((r) => match(r) && active(r) && !r.assignedTo && r.k208State === "waiting");
    const doneTodayMine = rows.filter((r) => match(r) && r.completedToday && r.assignedTo === uid);
    const sections: { title: string; hint: string; items: Row[] }[] = [
      { title: "Assigned to me", hint: "Vehicles waiting on you to start", items: assignedMine },
      { title: "In progress", hint: "Inspections you have started", items: inProgressMine },
      { title: "Returned to me", hint: "Voided inspections that must be corrected", items: returnedMine },
      { title: "Unassigned & available", hint: "No technician yet — first to start takes it", items: unassigned },
      { title: "Completed today", hint: "Certified today", items: doneTodayMine },
    ];
    const total = sections.reduce((n, s) => n + s.items.length, 0);
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search VIN or stock #"
              aria-label="Search VIN or stock number"
              className="w-full h-11 pl-9 pr-3 rounded-lg border border-border bg-background text-sm" />
          </div>
          <button onClick={openScan} className="h-11 px-4 rounded-lg border border-border text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted">
            <QrCode className="w-4 h-4" aria-hidden="true" /> Scan Service QR
          </button>
        </div>
        {total === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-6">
            <EmptyState Icon={CheckCircle2} title="No work in your queues"
              detail="Nothing is assigned to you and no unassigned vehicles are waiting. Scan a Service QR or switch to the full desk." />
          </div>
        ) : sections.map((s) => s.items.length > 0 && (
          <section key={s.title} aria-label={s.title}>
            <div className="flex items-baseline gap-2 mb-2.5">
              <h2 className="text-body font-bold text-foreground">{s.title}</h2>
              <span className="text-xs font-semibold text-muted-foreground">{s.items.length}</span>
              <span className="text-[11px] text-muted-foreground hidden sm:inline">· {s.hint}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {s.items.map((r) => (
                <MobileVehicleCard key={r.id} r={r} onOpen={() => setDrawer(r)} onPrimary={() => openWorkspace(r)} />
              ))}
            </div>
          </section>
        ))}
        {drawer && (
          <RowDrawer r={drawer} members={members} canAssign={canAssign} onAssigned={() => void load()}
            onClose={() => setDrawer(null)} onOpenWorkspace={() => { openWorkspace(drawer); setDrawer(null); }} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search VIN or stock #"
            aria-label="Search VIN or stock number"
            className="w-full h-11 pl-9 pr-3 rounded-lg border border-border bg-background text-sm" />
        </div>
        <button onClick={openScan} className="h-11 px-4 rounded-lg border border-border text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted">
          <QrCode className="w-4 h-4" aria-hidden="true" /> Scan Service QR
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CommandStatCard label="Pending work" value={stats.pending} sub={stats.pendingSub} Icon={ClipboardList} tone="blue" onClick={() => setTab("pending")} />
        <CommandStatCard label="Awaiting certification" value={stats.ready} sub={stats.readySub} Icon={ShieldCheck} tone="emerald" onClick={() => setTab("ready_to_sign")} />
        <CommandStatCard label="Blocked / exceptions" value={stats.blocked} sub={stats.blockedSub} Icon={AlertTriangle} tone="red" onClick={() => setTab("failed")} />
        <CommandStatCard label="Completed today" value={stats.doneToday} sub={stats.doneSub} Icon={CheckCircle2} tone="slate" onClick={() => setTab("done")} />
      </div>

      {attention.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Needs attention</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {attention.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                <VehThumb r={r} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-foreground truncate">{r.ymm}</p>
                  <p className="text-xs font-semibold text-red-600">{r.priority.label}</p>
                </div>
                <button onClick={() => openWorkspace(r)} className="min-h-[44px] px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold shrink-0">
                  {r.next.label}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mobile (<lg): stacked vehicle cards under a sticky filter row —
          never the squeezed 1020px table. */}
      <div className="lg:hidden">
        <div className="sticky top-0 z-20 -mx-4 px-4 py-2 bg-background/95 backdrop-blur border-b border-border space-y-2">
          <div className="flex items-center gap-1.5 overflow-x-auto" aria-label="Queue status filters">
            {TABS.map((f) => (
              <button key={f.key} onClick={() => setTab(f.key)} aria-pressed={tab === f.key}
                className={cn("h-11 px-3.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0",
                  tab === f.key ? "bg-primary text-primary-foreground" : "text-muted-foreground bg-muted/60")}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <select value={techFilter} onChange={(e) => setTechFilter(e.target.value)} aria-label="Filter by technician"
              className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-xs">
              <option value="any">Technician: any</option>
              <option value="unassigned">Unassigned</option>
              {technicians.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <select value={urgencyFilter} onChange={(e) => setUrgencyFilter(e.target.value)} aria-label="Filter by delivery urgency"
              className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-xs">
              <option value="any">Delivery: any</option>
              <option value="today">Delivery today</option>
              <option value="scheduled">Delivery scheduled</option>
              <option value="unscheduled">No delivery scheduled</option>
            </select>
          </div>
        </div>
        <div className="mt-3 space-y-3">
          {visible.map((r) => (
            <MobileVehicleCard key={r.id} r={r} onOpen={() => setDrawer(r)} onPrimary={() => openWorkspace(r)} />
          ))}
          {visible.length === 0 && (
            <div className="rounded-2xl border border-border bg-card p-4">
              <EmptyState Icon={CheckCircle2} title="All caught up"
                detail="No vehicles in this view. Change the filters, scan a Service QR, or search a VIN." />
            </div>
          )}
        </div>
      </div>

      <div className="hidden lg:block rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-4 pt-4 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-body font-bold text-foreground">Vehicles requiring service action</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={techFilter} onChange={(e) => setTechFilter(e.target.value)} aria-label="Filter by technician"
              className="h-11 rounded-lg border border-border bg-background px-2 text-xs">
              <option value="any">Technician: any</option>
              <option value="unassigned">Unassigned</option>
              {technicians.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <select value={urgencyFilter} onChange={(e) => setUrgencyFilter(e.target.value)} aria-label="Filter by delivery urgency"
              className="h-11 rounded-lg border border-border bg-background px-2 text-xs">
              <option value="any">Delivery: any</option>
              <option value="today">Delivery today</option>
              <option value="scheduled">Delivery scheduled</option>
              <option value="unscheduled">No delivery scheduled</option>
            </select>
          </div>
        </div>
        <div className="px-4 pt-3 flex items-center gap-1.5 overflow-x-auto">
          {TABS.map((f) => (
            <button key={f.key} onClick={() => setTab(f.key)} aria-pressed={tab === f.key}
              className={cn("h-11 px-3 rounded-full text-xs font-semibold whitespace-nowrap",
                tab === f.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="mt-3 overflow-auto max-h-[600px]">
          <table className="w-full text-sm min-w-[1020px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                {["Priority", "Vehicle", "Stock / VIN", "Age (since intake)", "Assigned to", "Get Ready", "K-208", "Delivery"].map((h) => (
                  <th key={h} className="text-left font-semibold px-4 py-2.5 sticky top-0 bg-card z-10">{h}</th>
                ))}
                <th className="text-right font-semibold px-4 py-2.5 sticky top-0 bg-card z-10">Next action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {visible.map((r) => {
                const G = GR_CHIP[r.grState]; const K = K208_CHIP[r.k208State];
                const P = PRIORITY_ICON[r.priority.level];
                // Never role="button" on the tr: nesting the real action
                // buttons inside an interactive row destroys table semantics.
                // The vehicle-name button is the accessible opener; the row's
                // onClick is a mouse convenience only.
                return (
                  <tr
                    key={r.id}
                    className="hover:bg-muted/40 cursor-pointer"
                    onClick={() => setDrawer(r)}
                  >
                    <td className="px-4 py-2.5">
                      <span className={cn("inline-flex items-center gap-1 text-xs font-bold", PRIORITY_CLS[r.priority.level])}>
                        <P className="w-3.5 h-3.5" aria-hidden="true" /> {r.priority.level}
                      </span>
                      <p className="text-[10.5px] text-muted-foreground">{r.priority.label}</p>
                    </td>
                    <td className="px-4 py-2.5"><div className="flex items-center gap-2.5 min-w-0"><VehThumb r={r} /><div className="min-w-0">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setDrawer(r); }}
                        aria-label={`Open service preview for ${r.ymm}`}
                        className="block max-w-full font-semibold text-foreground truncate text-left hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded-sm"
                      >
                        {r.ymm}
                      </button>
                      <p className="text-[11px] text-muted-foreground">{r.condition}{r.trim ? ` · ${r.trim}` : ""}</p>
                    </div></div></td>
                    <td className="px-4 py-2.5"><p className="font-mono text-[12px] text-foreground">{r.stock || "—"}</p><p className="font-mono text-[11px] text-muted-foreground">…{r.vin.slice(-6)}</p></td>
                    <td className="px-4 py-2.5">
                      <span className={cn("text-xs font-semibold tabular-nums", r.overdue ? "text-red-600" : "text-foreground")}>{ageDisplay(r)}</span>
                      {r.overdue && <p className="text-[10px] text-muted-foreground">{ageLabel(r.ageHours)} since intake</p>}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.assignedName ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
                          <span className="w-6 h-6 rounded-full bg-primary/10 text-primary grid place-items-center text-[10px] font-black">{r.assignedName.slice(0, 2).toUpperCase()}</span>
                          {r.assignedName}
                        </span>
                      ) : <span className="text-xs text-muted-foreground">Unassigned</span>}
                    </td>
                    <td className="px-4 py-2.5">{r.awaiting
                      ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600"><AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> Awaiting approval</span>
                      : <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", G.cls)}><G.Icon className="w-3.5 h-3.5" aria-hidden="true" /> {G.label}{r.openFailures > 0 ? ` (${r.openFailures})` : ""}</span>}</td>
                    <td className="px-4 py-2.5"><span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", K.cls)}><K.Icon className="w-3.5 h-3.5" aria-hidden="true" /> {K.label}</span></td>
                    <td className="px-4 py-2.5">
                      <span className={cn("text-xs font-medium", r.delivery === "Delivery blocked" ? "text-red-600" : r.delivery === "Cleared" ? "text-emerald-600" : "text-muted-foreground")}>{r.delivery}</span>
                      {r.deliveryTarget && <p className="text-[10px] text-muted-foreground">{formatCommandDateTime(r.deliveryTarget)}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={(e) => { e.stopPropagation(); openWorkspace(r); }}
                        className={cn("min-h-[40px] px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1",
                          r.next.tone === "danger" ? "bg-red-600 text-white" : r.next.tone === "ghost" ? "border border-border text-foreground hover:bg-muted" : "bg-primary text-primary-foreground")}>
                        {r.next.tone === "ghost" ? null : <Wrench className="w-3.5 h-3.5" aria-hidden="true" />} {r.next.label} <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-6">
                  <EmptyState Icon={CheckCircle2} title="All caught up"
                    detail="No vehicles in this view. Change the filters, scan a Service QR, or search a VIN." />
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {drawer && (
        <RowDrawer r={drawer} members={members} canAssign={canAssign} onAssigned={() => void load()}
          onClose={() => setDrawer(null)} onOpenWorkspace={() => { openWorkspace(drawer); setDrawer(null); }} />
      )}
    </div>
  );
}

/** Mobile queue card: thumb, YMM, stock, VIN-6, status chips, plain-language
 *  priority reason, ONE full-width primary action plus an explicit Details
 *  button that opens the preview drawer. The card body itself is never
 *  interactive — a role="button" wrapper around real buttons breaks the
 *  buttons for assistive tech. */
function MobileVehicleCard({ r, onOpen, onPrimary }: { r: Row; onOpen: () => void; onPrimary: () => void }) {
  const G = GR_CHIP[r.grState]; const K = K208_CHIP[r.k208State];
  const P = PRIORITY_ICON[r.priority.level];
  return (
    <article className="rounded-2xl border border-border bg-card p-3.5 space-y-2.5">
      <div className="flex items-start gap-3">
        <VehThumb r={r} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground truncate">{r.ymm}</p>
          <p className="font-mono text-[11px] text-muted-foreground">Stock {r.stock || "—"} · …{r.vin.slice(-6)} · {r.condition}</p>
        </div>
        <span className={cn("inline-flex items-center gap-1 text-[11px] font-bold shrink-0", PRIORITY_CLS[r.priority.level])}>
          <P className="w-3.5 h-3.5" aria-hidden="true" /> {r.priority.level}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className={cn("inline-flex items-center gap-1 font-semibold", G.cls)}>
          <G.Icon className="w-3.5 h-3.5" aria-hidden="true" /> {G.label}{r.openFailures > 0 ? ` (${r.openFailures})` : ""}
        </span>
        <span className={cn("inline-flex items-center gap-1 font-semibold", K.cls)}>
          <K.Icon className="w-3.5 h-3.5" aria-hidden="true" /> K-208: {K.label}
        </span>
        <span className={cn("font-medium", r.delivery === "Delivery blocked" ? "text-red-600" : r.delivery === "Cleared" ? "text-emerald-600" : "text-muted-foreground")}>
          {r.delivery}{r.deliveryTarget ? ` · ${formatCommandDateTime(r.deliveryTarget)}` : ""}
        </span>
        <span className={cn("tabular-nums", r.overdue ? "text-red-600 font-semibold" : "text-muted-foreground")}>
          {ageDisplay(r)}
        </span>
        <span className="text-muted-foreground">{r.assignedName ?? "Unassigned"}</span>
        {r.sold && <StatusPill tone="blue">Sold</StatusPill>}
      </div>
      <p className="text-[11.5px] text-muted-foreground">{r.priority.label}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrimary}
          className={cn("flex-1 min-h-[44px] rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-1.5",
            r.next.tone === "danger" ? "bg-red-600 text-white" : r.next.tone === "ghost" ? "border border-border text-foreground" : "bg-primary text-primary-foreground")}
        >
          {r.next.label} <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open service preview for ${r.ymm}`}
          className="min-h-[44px] px-3.5 rounded-xl border border-border text-sm font-semibold text-foreground shrink-0"
        >
          Details
        </button>
      </div>
    </article>
  );
}

/** Preview drawer — the next REQUIRED task, why the vehicle is parked on it,
 *  ONE primary action, and the secondary actions (assign, vehicle file).
 *  A preview, NOT the inspection form. */
function RowDrawer({ r, members, canAssign, onAssigned, onClose, onOpenWorkspace }: {
  r: Row;
  members: { id: string; name: string }[];
  canAssign: boolean;
  onAssigned: () => void;
  onClose: () => void;
  onOpenWorkspace: () => void;
}) {
  const navigate = useNavigate();
  const [assigning, setAssigning] = useState(false);
  const [assignBusy, setAssignBusy] = useState(false);
  const canReassign = canAssign && !!r.inspectionId && r.inspectionStatus === "pending";
  const assign = async (userId: string | null) => {
    if (!r.inspectionId) return;
    setAssignBusy(true);
    const { data, error } = await sb().rpc("assign_safety_inspection", { p_inspection_id: r.inspectionId, p_user_id: userId });
    setAssignBusy(false);
    if (error || (data && data.ok === false)) {
      toast.error("Couldn't assign the technician");
      return;
    }
    toast.success(userId ? "Technician assigned" : "Assignment cleared");
    setAssigning(false);
    onAssigned();
    onClose();
  };
  const G = GR_CHIP[r.grState]; const K = K208_CHIP[r.k208State];
  const asideRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // Modal dialog contract: focus moves into the drawer on open, Tab cycles
  // inside it, Escape closes, and focus returns to the row/card that opened it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !asideRef.current) return;
      const focusables = Array.from(asideRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !asideRef.current.contains(active))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && (active === last || !asideRef.current.contains(active))) {
        e.preventDefault(); first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden />
      <aside ref={asideRef} role="dialog" aria-modal="true" aria-label={`${r.ymm} service preview`}
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[400px] bg-card border-l border-border shadow-xl overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
          <h3 className="text-sm font-bold text-foreground">Service preview</h3>
          <button ref={closeRef} onClick={onClose} aria-label="Close preview" className="w-11 h-11 grid place-items-center text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <VehThumb r={r} />
            <div className="min-w-0">
              <p className="font-bold text-foreground truncate">{r.ymm}</p>
              <p className="font-mono text-[11px] text-muted-foreground">Stock {r.stock || "—"} · …{r.vin.slice(-6)}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill tone={r.priority.level === "High" ? "red" : r.priority.level === "Medium" ? "amber" : "slate"}>{r.priority.label}</StatusPill>
            {r.overdue && <StatusPill tone="red">{ageDisplay(r)}</StatusPill>}
            {r.sold && <StatusPill tone="blue">Sold</StatusPill>}
          </div>

          <div className="rounded-xl border border-border bg-muted/30 p-3.5 space-y-2.5">
            <div>
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Next required task</p>
              <p className="text-sm font-bold text-foreground mt-0.5">{r.nextTask}</p>
            </div>
            {r.nextWhy && (
              <div>
                <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Why it is waiting</p>
                <p className="text-[12.5px] text-foreground mt-0.5">{r.nextWhy}</p>
              </div>
            )}
            <button onClick={onOpenWorkspace} className={cn(BTN_PRIMARY, "w-full")}>
              {r.next.label} <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <dl className="space-y-1.5 text-[12.5px]">
            <DrawerRow label="K-208" value={<span className={cn("inline-flex items-center gap-1 font-semibold", K.cls)}><K.Icon className="w-3.5 h-3.5" aria-hidden="true" /> {K.label}</span>} />
            <DrawerRow label="Get Ready" value={<span className={cn("inline-flex items-center gap-1 font-semibold", G.cls)}><G.Icon className="w-3.5 h-3.5" aria-hidden="true" /> {G.label}</span>} />
            <DrawerRow label="Failed items open" value={<span className={r.openFailures ? "text-red-700 font-semibold" : ""}>{r.openFailures}</span>} />
            <DrawerRow label="Assigned to" value={r.assignedName ?? "Unassigned"} />
            <DrawerRow label="Time in service" value={ageLabel(r.ageHours)} />
            <DrawerRow label="Delivery target" value={r.deliveryTarget ? formatCommandDateTime(r.deliveryTarget) : "Not scheduled"} />
          </dl>
          {r.clearanceReasons.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="text-[11px] font-bold text-red-800 uppercase tracking-wide mb-1">Delivery blockers</p>
              <ul className="text-[11.5px] text-red-700 list-disc pl-4 space-y-0.5">
                {r.clearanceReasons.map((code) => <li key={code}>{clearanceReasonLabel(code)}</li>)}
              </ul>
            </div>
          )}

          <div className="space-y-2">
            {canReassign && !assigning && (
              <button onClick={() => setAssigning(true)} className={cn(BTN_SECONDARY, "w-full")}>
                Assign Technician
              </button>
            )}
            {canReassign && assigning && (
              <div className="rounded-xl border border-border p-3 space-y-2">
                <label className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground" htmlFor="drawer-assign">
                  Assign to
                </label>
                <select
                  id="drawer-assign"
                  defaultValue={r.assignedTo ?? ""}
                  disabled={assignBusy}
                  onChange={(e) => void assign(e.target.value || null)}
                  className="w-full h-11 rounded-lg border border-border bg-background px-2 text-sm"
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            )}
            <button onClick={() => navigate(`/vehicle-file/${r.id}`)} className={cn(BTN_SECONDARY, "w-full")}>
              <FileText className="w-4 h-4" aria-hidden="true" /> Open Vehicle File
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

function DrawerRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

function VehThumb({ r }: { r: Pick<Row, "photo"> }) {
  return r.photo
    ? <img src={r.photo} alt="" className="w-12 h-9 rounded-md object-cover border border-border shrink-0" />
    : <span className="w-12 h-9 rounded-md bg-muted grid place-items-center text-muted-foreground shrink-0"><Wrench className="w-4 h-4" aria-hidden="true" /></span>;
}
