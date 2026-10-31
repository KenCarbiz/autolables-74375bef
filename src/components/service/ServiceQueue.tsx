import { identityFromListing, identityTrim } from "@/lib/factorySticker/vehicleIdentity";
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
import { Button, MetricStrip, FilterSelect, StatusText, Th, Td, WorkTable, type Tone } from "@/components/product";

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
  requestStatus: "pending" | "clarify" | "approved" | null;
  ageHours: number;
  openFailures: number;
  readySince: string | null;
  roNumber: string | null;
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
  { key: "waiting_manager", label: "Waiting for Manager" },
  { key: "authorized", label: "Authorized Work" },
  { key: "returned", label: "Returned" },
  { key: "reinspect", label: "Reinspect" },
  { key: "ready_to_sign", label: "Ready to Sign" },
  { key: "pending_clearance", label: "Pending Clearance" },
  { key: "overdue", label: "Overdue" },
  { key: "done", label: "Completed" },
];

const GR_CHIP: Record<Row["grState"], { label: string; cls: string; tone: Tone; Icon: typeof Circle }> = {
  not_started: { label: "Not started", cls: "text-adm-muted", tone: "neutral", Icon: Circle },
  in_progress: { label: "In progress", cls: "text-adm-primary", tone: "info", Icon: CircleDot },
  complete: { label: "Work complete", cls: "text-adm-success", tone: "success", Icon: CheckCircle2 },
  failed: { label: "Failed items", cls: "text-adm-danger", tone: "danger", Icon: XCircle },
};
const K208_CHIP: Record<Row["k208State"], { label: string; cls: string; tone: Tone; Icon: typeof Circle }> = {
  waiting: { label: "Waiting", cls: "text-adm-muted", tone: "neutral", Icon: Clock },
  ready: { label: "Ready to certify", cls: "text-adm-primary", tone: "info", Icon: Clock },
  blocked: { label: "Blocked", cls: "text-adm-danger", tone: "danger", Icon: AlertTriangle },
  executed: { label: "Executed", cls: "text-adm-success", tone: "success", Icon: CheckCircle2 },
  // "superseded" is deliberately unbuilt: nothing in this repo writes it yet.
  voided: { label: "Voided", cls: "text-adm-muted", tone: "neutral", Icon: XCircle },
};

const PRIORITY_ICON = { High: ArrowUp, Medium: Minus, Low: ArrowDown } as const;
const PRIORITY_CLS = { High: "text-adm-danger", Medium: "text-adm-warning", Low: "text-adm-muted" } as const;

export default function ServiceQueue({ mode = "desk", onCounts }: { mode?: "my_work" | "desk"; onCounts?: (c: { mine: number; desk: number }) => void }) {
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
        .select("id, vin, ymm, condition, status, mc_attributes, hero_image_url, recall_status, recall_payload, recall_check, recall_checked_at, open_recall_count, created_at, deal_processed_at")
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
        vins.length ? sb().from("get_ready_records").select("vin, status, items, get_ready_complete_date, delivery_target, ro_number").eq("tenant_id", tenant.id).in("vin", vins) : empty,
        // `id` is load-bearing: failure counts are scoped by inspection_id
        // against the newest signed row — without it every failure is skipped.
        vins.length ? sb().from("safety_inspections").select("id, vin, status, result, inspection_state, assigned_to, licensee_certified_at, signed_at, created_at").eq("tenant_id", tenant.id).in("vin", vins).order("created_at", { ascending: false }) : empty,
        // 'clarify' rows are still-open requests (waiting on the requester's
        // answer), not decided ones — they must not vanish from the queue.
        // Approved rows feed the Authorized Work bucket.
        vins.length ? sb().from("service_requests").select("vin, status").eq("tenant_id", tenant.id).in("status", ["pending", "clarify", "approved", "approved_limit"]).in("vin", vins) : empty,
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

      const reqRows = (srRes.data as { vin: string; status: string }[]) || [];
      const awaitingVins = new Set<string>(reqRows.filter((r) => r.status === "pending" || r.status === "clarify").map((r) => r.vin));
      // Newest-wins per VIN by precedence: pending > clarify > approved.
      const reqByVin = new Map<string, "pending" | "clarify" | "approved">();
      for (const r of reqRows) {
        const cur = reqByVin.get(r.vin);
        const next = r.status === "approved_limit" ? "approved" : (r.status as "pending" | "clarify" | "approved");
        if (!cur || next === "pending" || (next === "clarify" && cur === "approved")) reqByVin.set(r.vin, next);
      }
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
        const identity = identityFromListing(v);
        return {
          id: v.id, vin, ymm, trim: identityTrim(v.ymm, identity),
          stock: stockByVin.get(vin) || (v.mc_attributes?.stock_no as string) || "",
          photo: (v.hero_image_url as string) || (Array.isArray(v.mc_attributes?.photo_links) ? v.mc_attributes.photo_links[0] : "") || "",
          condition: String(v.condition || "used").toUpperCase(),
          grState: s.grState, k208State: s.k208State, inspectionState,
          delivery: s.blocked ? "Delivery blocked" : s.cleared ? "Cleared" : v.status === "published" ? "In stock" : "Draft",
          deliveryTarget: (gr?.delivery_target as string) || null,
          roNumber: (gr?.ro_number as string) || null,
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
          requestStatus: reqByVin.get(v.vin) ?? null,
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
      else if (tab === "waiting_manager") { if (r.requestStatus !== "pending") return false; }
      else if (tab === "returned") { if (r.requestStatus !== "clarify") return false; }
      else if (tab === "authorized") { if (r.requestStatus !== "approved" || r.cleared) return false; }
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

  useEffect(() => {
    if (!onCounts || loading) return;
    const live = (r: Row) => !r.cleared && r.k208State !== "executed";
    const mine = rows.filter((r) => (live(r) && r.assignedTo === uid && r.k208State !== "voided") || (r.assignedTo === uid && r.k208State === "voided") || (live(r) && !r.assignedTo && r.k208State === "waiting")).length;
    onCounts({ mine, desk: rows.filter(live).length });
  }, [rows, uid, loading, onCounts]);

  if (loading) return <div className="space-y-4"><LoadingCard rows={2} /><LoadingCard rows={6} /></div>;
  if (loadError) {
    return <ErrorCard message="We could not load the Service Desk. Your existing inspection work has not been changed." detail={loadError} onRetry={() => void load()} />;
  }

  const active = (r: Row) => !r.cleared && r.k208State !== "executed";
  const term = q.trim().toLowerCase();
  const match = (r: Row) => !term || `${r.ymm} ${r.vin} ${r.stock}`.toLowerCase().includes(term);
  const inLoop = (r: Row) => r.requestStatus != null;
  const inProgressMine = rows.filter((r) => match(r) && active(r) && !inLoop(r) && r.assignedTo === uid && r.inspectionState === "in_progress");
  const assignedMine = rows.filter((r) => match(r) && active(r) && !inLoop(r) && r.assignedTo === uid && r.k208State !== "voided" && r.inspectionState !== "in_progress");
  const returnedMine = rows.filter((r) => match(r) && r.assignedTo === uid && r.k208State === "voided");
  const unassigned = rows.filter((r) => match(r) && active(r) && !r.assignedTo && r.k208State === "waiting");
  const doneTodayMine = rows.filter((r) => match(r) && r.completedToday && r.assignedTo === uid);
  const waitingManagerMine = rows.filter((r) => match(r) && r.assignedTo === uid && r.requestStatus === "pending");
  const clarifyMine = rows.filter((r) => match(r) && r.assignedTo === uid && r.requestStatus === "clarify");
  const authorizedMine = rows.filter((r) => match(r) && !r.cleared && r.assignedTo === uid && r.requestStatus === "approved");
  const sections: { title: string; hint: string; items: Row[] }[] = [
    { title: "Assigned to me", hint: "Vehicles waiting on you to start", items: assignedMine },
    { title: "In progress", hint: "Inspections you have started", items: inProgressMine },
    { title: "Waiting for manager", hint: "Your authorization requests awaiting a decision", items: waitingManagerMine },
    { title: "Authorized work", hint: "Approved repairs to complete and verify", items: authorizedMine },
    { title: "Returned for clarification", hint: "The manager needs more information from you", items: clarifyMine },
    { title: "Returned to me", hint: "Voided inspections that must be corrected", items: returnedMine },
    { title: "Unassigned & available", hint: "No technician yet, first to start takes it", items: unassigned },
    { title: "Completed today", hint: "Certified today", items: doneTodayMine },
  ];
  const myWorkRows = Array.from(new Map(sections.filter((x) => x.title !== "Completed today").flatMap((x) => x.items).map((r) => [r.id, r])).values());
  const myTotal = sections.reduce((n, x) => n + x.items.length, 0);
  const tableRows = mode === "my_work" ? myWorkRows : visible;
  const dueToday = tableRows.filter((r) => isToday(r.deliveryTarget)).length;
  const overdueCount = tableRows.filter((r) => r.overdue).length;
  const awaitingCount = tableRows.filter((r) => r.awaiting || r.requestStatus === "pending").length;

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] flex-1">
        <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-adm-muted" aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search VIN or stock #"
          aria-label="Search VIN or stock number"
          className="h-10 w-full rounded-[6px] border border-adm-border bg-adm-surface pl-10 pr-3 text-[14px]" />
      </div>
      {mode === "desk" && (
        <>
          <FilterSelect label="Filter by status" value={tab} onChange={setTab}
            options={TABS.map((f) => ({ value: f.key, label: f.key === "all" ? "Status: all" : f.label }))} />
          <FilterSelect label="Filter by technician" value={techFilter} onChange={setTechFilter}
            options={[{ value: "any", label: "Technician: any" }, { value: "unassigned", label: "Unassigned" }, ...technicians.map(([id, name]) => ({ value: id, label: name }))]} />
          <FilterSelect label="Filter by delivery urgency" value={urgencyFilter} onChange={setUrgencyFilter}
            options={[{ value: "any", label: "Delivery: any" }, { value: "today", label: "Delivery today" }, { value: "scheduled", label: "Delivery scheduled" }, { value: "unscheduled", label: "No delivery scheduled" }]} />
        </>
      )}
      <button onClick={openScan} className="inline-flex h-10 items-center gap-2 rounded-[6px] border border-adm-border bg-adm-surface px-3 text-[14px] font-semibold hover:bg-adm-workspace">
        <QrCode className="h-5 w-5" aria-hidden="true" /> Scan Service QR
      </button>
    </div>
  );

  const strip = mode === "my_work" ? (
    <MetricStrip numberFirst noBars label="My work" metrics={[
      { label: "In my queue", value: myWorkRows.length, hint: "Matches the My work tab" },
      { label: "Due today", value: dueToday, hint: "Delivery target today" },
      { label: "Overdue", value: overdueCount, hint: "Past the service window", tone: overdueCount > 0 ? "danger" : "neutral" },
      { label: "Awaiting approval", value: awaitingCount, hint: "Manager decision needed", tone: awaitingCount > 0 ? "warning" : "neutral" },
    ]} />
  ) : (
    <MetricStrip numberFirst noBars label="Service desk totals" metrics={[
      { label: "Pending work", value: stats.pending, tone: "info", hint: stats.pendingSub },
      { label: "Awaiting certification", value: stats.ready, tone: "success", hint: stats.readySub },
      { label: "Blocked / exceptions", value: stats.blocked, tone: stats.blocked > 0 ? "danger" : "neutral", hint: stats.blockedSub },
      { label: "Completed today", value: stats.doneToday, hint: stats.doneSub },
    ]} />
  );

  const mobileCards = (list: Row[]) => (
    <div className="space-y-3 lg:hidden">
      {mode === "my_work" ? (
        sections.map((x) => x.items.length > 0 && (
          <section key={x.title} aria-label={x.title}>
            <h2 className="mb-2 text-[14px] font-semibold text-adm-ink">{x.title} <span className="text-adm-muted">({x.items.length})</span></h2>
            <div className="space-y-3">
              {x.items.map((r) => <MobileVehicleCard key={r.id} r={r} onOpen={() => setDrawer(r)} onPrimary={() => openWorkspace(r)} />)}
            </div>
          </section>
        ))
      ) : (
        list.map((r) => <MobileVehicleCard key={r.id} r={r} onOpen={() => setDrawer(r)} onPrimary={() => openWorkspace(r)} />)
      )}
    </div>
  );

  const emptyDetail = mode === "my_work"
    ? "Nothing is assigned to you and no unassigned vehicles are waiting. Scan a Service QR or switch to the full desk."
    : "No vehicles in this view. Change the filters, scan a Service QR, or search a VIN.";

  return (
    <div className="space-y-4">
      {strip}
      {toolbar}
      {mobileCards(tableRows)}
      <div className="hidden lg:block overflow-hidden rounded-[6px] border border-adm-border bg-adm-surface">
        <WorkTable className="[&_th]:px-1.5 [&_td]:px-1.5" caption={mode === "my_work" ? "My service work" : "Vehicles requiring service action"}>
          <thead>
            <tr>
              {mode === "my_work" ? <Th>Due</Th> : <Th>Priority</Th>}
              <Th>Status</Th>
              {mode === "my_work" && <Th className="whitespace-nowrap">RO #</Th>}
              <Th>Vehicle</Th>
              <Th>{mode === "my_work" ? "Task" : "Age"}</Th>
              {mode === "desk" && <Th>Assigned to</Th>}
              {mode === "desk" && <Th>K-208</Th>}
              <Th align="right">Next action</Th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((r) => {
              const G = GR_CHIP[r.grState]; const K = K208_CHIP[r.k208State];
              const P = PRIORITY_ICON[r.priority.level];
              return (
                <tr key={r.id} className="cursor-pointer hover:bg-adm-workspace" onClick={() => setDrawer(r)}>
                  <Td className="whitespace-nowrap">
                    {mode === "my_work" ? (
                      <span className={cn("text-[14px]", r.overdue ? "font-semibold text-adm-danger" : "text-adm-muted")}>
                        {r.deliveryTarget ? formatCommandDateTime(r.deliveryTarget) : r.overdue ? "Overdue" : "No date"}
                      </span>
                    ) : (
                      <span className={cn("inline-flex items-center gap-1 text-[14px] font-semibold", PRIORITY_CLS[r.priority.level])}>
                        <P className="h-5 w-5" aria-hidden="true" /> {r.priority.level}
                      </span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {r.awaiting
                      ? <StatusText tone="warning">Awaiting approval</StatusText>
                      : <StatusText tone={G.tone}>{G.label}{r.openFailures > 0 ? ` (${r.openFailures})` : ""}</StatusText>}
                  </Td>
                  {mode === "my_work" && <Td className="whitespace-nowrap tabular-nums text-adm-muted">{r.roNumber || "Unknown"}</Td>}
                  <Td className="max-w-[220px]" title={`${r.stock ? `Stock ${r.stock}` : "No stock number"} - ${r.vin.slice(-6)}`}>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setDrawer(r); }}
                      aria-label={`Open service preview for ${r.ymm}`}
                      className="block max-w-full truncate text-left text-[14px] font-semibold text-adm-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      {r.ymm}
                    </button>
                  </Td>
                  <Td className={cn(mode === "desk" && "whitespace-nowrap")}>
                    {mode === "my_work"
                      ? <span className="block max-w-[100px] truncate" title={r.nextTask}>{r.nextTask}</span>
                      : <span className={cn("tabular-nums", r.overdue ? "font-semibold text-adm-danger" : "text-adm-ink")}>{ageDisplay(r)}</span>}
                  </Td>
                  {mode === "desk" && (
                    <Td className="whitespace-nowrap">{r.assignedName ?? <span className="text-adm-muted">Unassigned</span>}</Td>
                  )}
                  {mode === "desk" && <Td className="whitespace-nowrap"><StatusText tone={K.tone}>{K.label}</StatusText></Td>}
                  <Td align="right" className="whitespace-nowrap">
                    <Button
                      size="sm"
                      variant={r.next.tone === "danger" ? "danger" : "secondary"}
                      onClick={(e) => { e.stopPropagation(); openWorkspace(r); }}
                    >
                      {r.next.label}
                    </Button>
                  </Td>
                </tr>
              );
            })}
            {tableRows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-6">
                <EmptyState Icon={CheckCircle2} title={mode === "my_work" && myTotal === 0 ? "No work in your queues" : "All caught up"} detail={emptyDetail} />
              </td></tr>
            )}
          </tbody>
        </WorkTable>
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
    <article className="rounded-2xl border border-adm-border bg-adm-surface p-3.5 space-y-2.5">
      <div className="flex items-start gap-3">
        <VehThumb r={r} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-adm-ink truncate">{r.ymm}</p>
          <p className="font-mono text-[11px] text-adm-muted">Stock {r.stock || "—"} · …{r.vin.slice(-6)} · {r.condition}</p>
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
        <span className={cn("font-medium", r.delivery === "Delivery blocked" ? "text-adm-danger" : r.delivery === "Cleared" ? "text-adm-success" : "text-adm-muted")}>
          {r.delivery}{r.deliveryTarget ? ` · ${formatCommandDateTime(r.deliveryTarget)}` : ""}
        </span>
        <span className={cn("tabular-nums", r.overdue ? "text-adm-danger font-semibold" : "text-adm-muted")}>
          {ageDisplay(r)}
        </span>
        <span className="text-adm-muted">{r.assignedName ?? "Unassigned"}</span>
        {r.sold && <StatusPill tone="blue">Sold</StatusPill>}
      </div>
      <p className="text-[11.5px] text-adm-muted">{r.priority.label}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrimary}
          className={cn("flex-1 min-h-[44px] rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-1.5",
            r.next.tone === "danger" ? "bg-red-600 text-white" : r.next.tone === "ghost" ? "border border-adm-border text-adm-ink" : "bg-primary text-primary-foreground")}
        >
          {r.next.label} <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open service preview for ${r.ymm}`}
          className="min-h-[44px] px-3.5 rounded-xl border border-adm-border text-sm font-semibold text-adm-ink shrink-0"
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
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[400px] bg-adm-surface border-l border-adm-border shadow-xl overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-adm-border sticky top-0 bg-adm-surface z-10">
          <h3 className="text-sm font-bold text-adm-ink">Service preview</h3>
          <button ref={closeRef} onClick={onClose} aria-label="Close preview" className="w-11 h-11 grid place-items-center text-adm-muted hover:text-adm-ink"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <VehThumb r={r} />
            <div className="min-w-0">
              <p className="font-bold text-adm-ink truncate">{r.ymm}</p>
              <p className="font-mono text-[11px] text-adm-muted">Stock {r.stock || "—"} · …{r.vin.slice(-6)}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill tone={r.priority.level === "High" ? "red" : r.priority.level === "Medium" ? "amber" : "slate"}>{r.priority.label}</StatusPill>
            {r.overdue && <StatusPill tone="red">{ageDisplay(r)}</StatusPill>}
            {r.sold && <StatusPill tone="blue">Sold</StatusPill>}
          </div>

          <div className="rounded-xl border border-adm-border bg-adm-workspace p-3.5 space-y-2.5">
            <div>
              <p className="text-[12px] leading-[18px] font-bold uppercase tracking-wider text-adm-muted">Next required task</p>
              <p className="text-sm font-bold text-adm-ink mt-0.5">{r.nextTask}</p>
            </div>
            {r.nextWhy && (
              <div>
                <p className="text-[12px] leading-[18px] font-bold uppercase tracking-wider text-adm-muted">Why it is waiting</p>
                <p className="text-[12.5px] text-adm-ink mt-0.5">{r.nextWhy}</p>
              </div>
            )}
            <button onClick={onOpenWorkspace} className={cn(BTN_PRIMARY, "w-full")}>
              {r.next.label} <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <dl className="space-y-1.5 text-[12.5px]">
            <DrawerRow label="K-208" value={<span className={cn("inline-flex items-center gap-1 font-semibold", K.cls)}><K.Icon className="w-3.5 h-3.5" aria-hidden="true" /> {K.label}</span>} />
            <DrawerRow label="Get Ready" value={<span className={cn("inline-flex items-center gap-1 font-semibold", G.cls)}><G.Icon className="w-3.5 h-3.5" aria-hidden="true" /> {G.label}</span>} />
            <DrawerRow label="Failed items open" value={<span className={r.openFailures ? "text-adm-danger font-semibold" : ""}>{r.openFailures}</span>} />
            <DrawerRow label="Assigned to" value={r.assignedName ?? "Unassigned"} />
            <DrawerRow label="Time in service" value={ageLabel(r.ageHours)} />
            <DrawerRow label="Delivery target" value={r.deliveryTarget ? formatCommandDateTime(r.deliveryTarget) : "Not scheduled"} />
          </dl>
          {r.clearanceReasons.length > 0 && (
            <div className="rounded-xl border border-adm-border bg-adm-danger-bg p-3">
              <p className="text-[11px] font-bold text-adm-danger uppercase tracking-wide mb-1">Delivery blockers</p>
              <ul className="text-[11.5px] text-adm-danger list-disc pl-4 space-y-0.5">
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
              <div className="rounded-xl border border-adm-border p-3 space-y-2">
                <label className="block text-[12px] leading-[18px] font-bold uppercase tracking-wide text-adm-muted" htmlFor="drawer-assign">
                  Assign to
                </label>
                <select
                  id="drawer-assign"
                  defaultValue={r.assignedTo ?? ""}
                  disabled={assignBusy}
                  onChange={(e) => void assign(e.target.value || null)}
                  className="w-full h-11 rounded-lg border border-adm-border bg-adm-surface px-2 text-sm"
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
      <dt className="text-adm-muted">{label}</dt>
      <dd className="text-adm-ink">{value}</dd>
    </div>
  );
}

function VehThumb({ r }: { r: Pick<Row, "photo"> }) {
  return r.photo
    ? <img src={r.photo} alt="" className="w-12 h-9 rounded-md object-cover border border-adm-border shrink-0" />
    : <span className="w-12 h-9 rounded-md bg-adm-workspace grid place-items-center text-adm-muted shrink-0"><Wrench className="w-4 h-4" aria-hidden="true" /></span>;
}
