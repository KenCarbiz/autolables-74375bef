import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useAudit } from "@/contexts/AuditContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { deriveWorkspaceStatus, clearanceReasonLabel, type WorkspaceStatus, type WorkspaceActionKey } from "@/lib/service/workspaceStatus";
import { k208SignerAllowedClient, K208_SIGNER_DENIAL } from "@/lib/service/signerAuthority";
import { isExecutedSignoff, isFailedInspection } from "@/lib/commandCenter/inspectionState";
import { REPAIR_STATES, isFailureResolved, type RepairState } from "@/lib/service/transitions";
import { notificationDedupeKey } from "@/lib/service/notificationTypes";
import type { GetReadyItem } from "@/hooks/useGetReady";
import K208Checklist, { K208_ITEMS, k208Answered, k208Result, k208Checklist, type K208Mark } from "@/components/service/K208Checklist";
import { K208_CERTIFICATION_TEXT, K208_INSPECTION_RESULTS } from "@/data/ctK208Form";
import SignaturePad from "@/components/addendum/SignaturePad";
import { buildConsentRecord, hashPayload, fetchClientIp } from "@/lib/esign";
import { uploadPhoto } from "@/lib/storage";
import { RequestAdditionalWorkButton, ServiceApprovalsPanel } from "@/components/service/AdditionalWork";
import { ServiceMessagesThread } from "@/components/service/ServiceMessages";
import {
  CommandCard, CommandCapabilityProvider, CommandCallout, VehicleIdentityStrip, StatusPill,
  LoadingCard, ErrorCard, EmptyState, TimelineRail, DisabledReason,
  BTN_PRIMARY, BTN_SECONDARY, ACTION_GROUP, TONE_TEXT,
  formatCommandDateTime, copyWithToast,
} from "@/components/command/CommandPrimitives";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowLeft, Camera, CheckCircle2, ChevronRight, ClipboardList, Clock, Copy,
  FileText, Loader2, QrCode, ShieldCheck, Upload, Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/service/serviceStatus";
import type { AuditLogEntry } from "@/types/tenant";

// ──────────────────────────────────────────────────────────────
// /service/vehicle/:vin — the ONE shared vehicle service workspace
// (SERVICE_DESK_SPEC addendum). Desktop queue rows and the Service QR both
// land here; the banner derives the 8 states from the controlled foundation
// facts and auto-selects the single required action. Mobile-first; desktop
// >=1280 gets the three-region layout (vehicle/assignment · work · summary).
// ──────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

interface Listing {
  id: string; vin: string; ymm: string | null; condition: string | null; status: string | null;
  mileage: number | null; recall_status: string | null; hero_image_url: string | null;
  mc_attributes: Record<string, unknown> | null; created_at: string | null; deal_processed_at: string | null;
}
interface InspRow {
  id: string; status: string | null; result: string | null; inspection_state: string | null;
  assigned_to: string | null; started_at: string | null; signed_at: string | null; created_at: string | null;
  licensee_certified_at: string | null; licensee_name: string | null; inspector_name: string | null;
  checklist: { id?: string; label?: string; result?: string; explanation?: string }[] | null;
  doc_version: number | null; notes: string | null;
}
interface FailureRow {
  id: string; inspection_id: string; item_id: string; explanation: string; photos: string[] | null;
  ro_number: string | null; assignee: string | null; repair_state: string;
  reinspected_by: string | null; reinspected_at: string | null; updated_at: string | null;
}
interface GrRow {
  id: string; status: string | null; items: GetReadyItem[] | null; get_ready_complete_date: string | null;
  get_ready_start_date: string | null; delivery_target: string | null; assigned_technician: string | null;
  ro_number: string | null;
}
interface MemberRow { id: string; user_id: string | null; email: string | null; role: string; accepted_at: string | null; }
interface AuditRow { id: string; action: string; created_at: string; details: Record<string, unknown> | null; }
interface Clearance { state: string; reason_codes: string[]; computed_at?: string | null; }

const TONE_BOX: Record<Tone, string> = {
  slate: "border-slate-200 bg-slate-100",
  amber: "border-amber-200 bg-amber-50",
  red: "border-red-200 bg-red-50",
  blue: "border-blue-200 bg-blue-50",
  emerald: "border-emerald-200 bg-emerald-50",
};

const REPAIR_STATE_LABELS: Record<RepairState, string> = {
  repair_needed: "Repair needed",
  parts_ordered: "Parts ordered",
  repair_in_progress: "Repair in progress",
  repair_completed: "Repair completed",
  ready_for_reinspection: "Ready for reinspection",
  passed_on_reinspection: "Passed on reinspection",
};

const memberName = (m: MemberRow | undefined | null): string =>
  m?.email ? m.email.split("@")[0] : "Unknown member";

const itemLabel = (itemId: string): string =>
  K208_ITEMS.find((i) => i.id === itemId)?.label || itemId;

const draftKey = (tenantId: string, vin: string) => `autolabels.k208draft.${tenantId}.${vin}`;

interface Draft { marks: Record<string, K208Mark>; itemNotes: Record<string, string>; notes: string; savedAt: string; }

export default function ServiceVehicleWorkspace() {
  const { vin: vinParam } = useParams<{ vin: string }>();
  const vin = (vinParam || "").toUpperCase();
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const { user, isAdmin } = useAuth();
  const { member } = useEntitlements();
  const { settings } = useDealerSettings();
  const { log } = useAudit();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const role = member?.role;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [veh, setVeh] = useState<Listing | null>(null);
  const [gr, setGr] = useState<GrRow | null>(null);
  const [inspections, setInspections] = useState<InspRow[]>([]);
  const [failures, setFailures] = useState<FailureRow[]>([]);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [clearance, setClearance] = useState<Clearance | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);

  const load = useCallback(async () => {
    if (!tenantId || !vin) { setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    try {
      const [vehRes, grRes, siRes, srRes, memRes, auditRes] = await Promise.all([
        sb().from("vehicle_listings")
          .select("id, vin, ymm, condition, status, mileage, recall_status, hero_image_url, mc_attributes, created_at, deal_processed_at")
          .eq("tenant_id", tenantId).eq("vin", vin).limit(1).maybeSingle(),
        sb().from("get_ready_records")
          .select("id, status, items, get_ready_complete_date, get_ready_start_date, delivery_target, assigned_technician, ro_number")
          .eq("tenant_id", tenantId).eq("vin", vin)
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
        sb().from("safety_inspections")
          .select("id, status, result, inspection_state, assigned_to, started_at, signed_at, created_at, licensee_certified_at, licensee_name, inspector_name, checklist, doc_version, notes")
          .eq("tenant_id", tenantId).eq("vin", vin).order("created_at", { ascending: false }),
        sb().from("service_requests").select("id").eq("tenant_id", tenantId).eq("vin", vin).eq("status", "pending"),
        sb().rpc("list_tenant_members", { p_tenant_id: tenantId }),
        sb().from("audit_log").select("id, action, created_at, details")
          .eq("store_id", tenantId).eq("entity_id", vin)
          .order("created_at", { ascending: false }).limit(25),
      ]);
      if (vehRes.error) throw new Error(vehRes.error.message);
      const listing = (vehRes.data as Listing) || null;
      setVeh(listing);
      setGr((grRes.data as GrRow) || null);
      const insp = ((siRes.data as InspRow[]) || []);
      setInspections(insp);
      setPendingRequests(((srRes.data as { id: string }[]) || []).length);
      setMembers(((memRes.data as MemberRow[]) || []).filter((m) => m.accepted_at && m.user_id));
      setAuditRows((auditRes.data as AuditRow[]) || []);
      const inspIds = insp.map((r) => r.id);
      if (inspIds.length) {
        const { data: fRows } = await sb().from("safety_inspection_item_failures")
          .select("id, inspection_id, item_id, explanation, photos, ro_number, assignee, repair_state, reinspected_by, reinspected_at, updated_at")
          .eq("tenant_id", tenantId).in("inspection_id", inspIds)
          .order("created_at", { ascending: true });
        setFailures((fRows as FailureRow[]) || []);
      } else {
        setFailures([]);
      }
      // Recompute the stored clearance so what we show is fresh AND stored —
      // the RPC also audits any state change. Falls back to the stored row.
      if (listing) {
        const { data: cRes, error: cErr } = await sb().rpc("recompute_delivery_clearance", { p_tenant_id: tenantId, p_vin: vin });
        if (!cErr && cRes?.ok) {
          setClearance({ state: String(cRes.state), reason_codes: (cRes.reason_codes as string[]) || [] });
        } else {
          const { data: stored } = await sb().from("vehicle_delivery_clearance")
            .select("state, reason_codes, computed_at").eq("tenant_id", tenantId).eq("vin", vin).maybeSingle();
          setClearance((stored as Clearance) || null);
        }
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Unknown error");
    }
    setLoading(false);
  }, [tenantId, vin]);

  useEffect(() => { void load(); }, [load]);

  // ── Derivations: one truth for the banner and the action ──────────────────
  const newestSigned = useMemo(
    () => inspections.filter((r) => r.status === "signed")
      .sort((a, b) => String(b.signed_at || "").localeCompare(String(a.signed_at || "")))[0] ?? null,
    [inspections],
  );
  const newestActive = useMemo(
    () => inspections.filter((r) => r.status !== "voided")[0] ?? null,
    [inspections],
  );
  const openFailures = useMemo(() => failures.filter((f) => !isFailureResolved(f.repair_state)), [failures]);
  const canExecute = isAdmin || hasDealerCapability(role, "can_execute_k208", isAdmin) || k208SignerAllowedClient({
    isPlatformAdmin: isAdmin,
    userId: user?.id ?? null,
    role,
    authorizedUsers: settings.k208_authorized_users || [],
    authorityRoles: settings.k208_authority_roles || [],
  });
  const canConduct = isAdmin || hasDealerCapability(role, "can_conduct_inspection", isAdmin);
  const canAssign = isAdmin || hasDealerCapability(role, "can_assign_service_work", isAdmin);
  const canCompleteWork = isAdmin || hasDealerCapability(role, "can_complete_get_ready", isAdmin);
  const canApprove = isAdmin || hasDealerCapability(role, "can_approve_service_work", isAdmin);
  const canReinspect = canConduct && (!settings.service_reinspection_managers_only || canApprove);

  const grItems: GetReadyItem[] = useMemo(() => (gr?.items || []).filter(Boolean), [gr]);
  const grStarted = !!gr && (gr.status !== "pending" || grItems.some((i) => i.status === "complete"));

  const ws: WorkspaceStatus = useMemo(() => deriveWorkspaceStatus({
    hasSignedNonFail: isExecutedSignoff(newestSigned),
    hasSignedFail: isFailedInspection(newestSigned),
    certified: !!newestSigned?.licensee_certified_at,
    workflowState: newestActive?.inspection_state ?? null,
    openFailures: openFailures.length,
    failuresReadyForReinspection: openFailures.filter((f) => f.repair_state === "ready_for_reinspection").length,
    awaitingApproval: pendingRequests > 0,
    grStarted,
    recallStatus: veh?.recall_status,
    clearanceState: clearance?.state ?? null,
    clearanceReasons: clearance?.reason_codes ?? [],
    canExecute,
  }), [newestSigned, newestActive, openFailures, pendingRequests, grStarted, veh, clearance, canExecute]);

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const startInspection = useCallback(async () => {
    if (newestActive && newestActive.status === "pending" && newestActive.inspection_state === "not_started") {
      const { error } = await sb().rpc("transition_safety_inspection", {
        p_inspection_id: newestActive.id, p_new_state: "in_progress",
      });
      if (error) toast.error("Couldn't record the start on the server; you can still work the checklist.");
      else {
        await sb().rpc("recompute_delivery_clearance", { p_tenant_id: tenantId, p_vin: vin });
        void load();
      }
    }
    scrollTo("inspection");
  }, [newestActive, load, tenantId, vin]);

  const onPrimaryAction = (key: WorkspaceActionKey) => {
    switch (key) {
      case "start_work": void startInspection(); break;
      case "continue_work": scrollTo("inspection"); break;
      case "review_request": scrollTo("approvals"); break;
      case "resolve_failures": scrollTo("failures"); break;
      case "reinspect": scrollTo("inspection"); break;
      case "review_k208":
      case "execute_k208": scrollTo("k208"); break;
      case "review_blockers": scrollTo("summary"); break;
      case "record_recall": navigate(`/vehicle-file/${veh?.id ?? ""}`); break;
      case "view_record": navigate(`/k208/${vin}`); break;
    }
  };

  if (!tenantId) return null;

  if (loading) {
    return (
      <div className="max-w-[1400px] mx-auto p-4 md:p-6 space-y-4">
        <LoadingCard rows={2} />
        <LoadingCard rows={5} />
        <LoadingCard rows={3} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto p-4 md:p-6">
        <ErrorCard
          message="We could not load the Service Desk. Your existing inspection work has not been changed."
          detail={loadError}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  if (!veh) {
    return (
      <div className="max-w-2xl mx-auto p-4 md:p-6">
        <EmptyState
          Icon={Wrench}
          title="No vehicle found for this VIN"
          detail={`Nothing in this store's inventory matches ${vin}. Check the VIN or return to the queue.`}
          action={<Link to="/service" className={BTN_SECONDARY}><ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to Service Desk</Link>}
        />
      </div>
    );
  }

  const stock = String((veh.mc_attributes as Record<string, unknown> | null)?.stock_no || "") || null;
  const ymm = veh.ymm || "Vehicle";
  const trim = ymm.split(/\s+/).slice(3).join(" ") || null;
  const assignedMember = members.find((m) => m.user_id === newestActive?.assigned_to);
  const sold = !!veh.deal_processed_at || String(veh.status || "") === "sold";
  const singleActionSticky = ws.key !== "cleared";

  return (
    <CommandCapabilityProvider role={role} isAdmin={isAdmin}>
      <div className="max-w-[1400px] mx-auto p-4 md:p-6 space-y-4 pb-28 lg:pb-6">
        <div className={ACTION_GROUP}>
          <Link to="/service" className={BTN_SECONDARY}>
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Service Desk
          </Link>
          <Link to={`/vehicle-file/${veh.id}`} className={BTN_SECONDARY}>
            <FileText className="w-4 h-4" aria-hidden="true" /> Vehicle File
          </Link>
        </div>

        <VehicleIdentityStrip
          imageUrl={veh.hero_image_url}
          ymm={ymm.split(/\s+/).slice(0, 3).join(" ") || ymm}
          trim={trim}
          stockNumber={stock}
          vin={vin}
          conditionLabel={veh.condition}
          facts={[
            { label: "Mileage", value: veh.mileage != null ? `${Number(veh.mileage).toLocaleString("en-US")} mi` : null },
            { label: "Assigned to", value: assignedMember ? memberName(assignedMember) : gr?.assigned_technician || null },
            { label: "Sold status", value: sold ? "Sold" : "In stock" },
            { label: "Delivery target", value: gr?.delivery_target ? formatCommandDateTime(gr.delivery_target) : null },
          ]}
          onCopyVin={() => void copyWithToast(vin, "VIN")}
        />

        <StatusBannerCard ws={ws} onAction={onPrimaryAction} />

        <div className="grid grid-cols-1 xl:grid-cols-[300px_minmax(0,1fr)_340px] gap-4 items-start">
          {/* Left region: assignment + progress + vehicle utilities */}
          <div className="space-y-4 order-2 xl:order-1">
            <AssignmentCard
              inspection={newestActive}
              members={members}
              canAssign={canAssign}
              onAssigned={() => void load()}
            />
            <ProgressCard items={grItems} />
            <ServiceQrCard tenantId={tenantId} vin={vin} />
            <TitleMcoUpload tenantId={tenantId} veh={{ id: veh.id, vin }} />
          </div>

          {/* Center region: the work */}
          <div className="space-y-4 order-1 xl:order-2">
            <div id="k208" />
            <div id="inspection">
              <K208Panel
                tenantId={tenantId}
                veh={veh}
                newestSigned={newestSigned}
                newestActive={newestActive}
                openFailureCount={openFailures.length}
                ws={ws}
                canConduct={canConduct}
                canExecute={canExecute}
                members={members}
                passAllEnabled={settings.service_pass_all_enabled !== false}
                failurePhotoRequired={settings.service_failure_photo_required === true}
                signerUsers={settings.k208_authorized_users || []}
                signerRoles={settings.k208_authority_roles || []}
                onChanged={() => void load()}
                logAudit={log}
              />
            </div>

            {(failures.length > 0 || isFailedInspection(newestSigned)) && (
              <div id="failures">
                <FailedItemsPanel
                  tenantId={tenantId}
                  vin={vin}
                  newestSigned={newestSigned}
                  failures={failures}
                  members={members}
                  canReinspect={canReinspect}
                  canConduct={canConduct}
                  onChanged={() => void load()}
                  logAudit={log}
                />
              </div>
            )}

            <div id="approvals" className="space-y-3">
              <CommandCard
                title="Additional work"
                subtitle="Structured request and decision. A chat message alone never authorizes work."
                action={<RequestAdditionalWorkButton tenantId={tenantId} veh={{ id: veh.id, vin, ymm: veh.ymm }} onSubmitted={() => void load()} />}
              >
                <ServiceApprovalsPanel tenantId={tenantId} vin={vin} onDecided={() => void load()} />
                {pendingRequests === 0 && (
                  <p className="text-[11.5px] text-muted-foreground py-2">No additional-work request is pending for this vehicle.</p>
                )}
              </CommandCard>
            </div>

            <WorkSections
              tenantId={tenantId}
              vin={vin}
              gr={gr}
              vehRecall={veh.recall_status}
              canCompleteWork={canCompleteWork}
              userLabel={user?.email?.split("@")[0] || "member"}
              onChanged={() => void load()}
            />
          </div>

          {/* Right region: sticky summary + messages + timeline */}
          <div className="space-y-4 order-3 xl:order-3 xl:sticky xl:top-4">
            <div id="summary">
              <SummaryCard newestSigned={newestSigned} openFailures={openFailures.length} clearance={clearance} items={grItems} />
            </div>
            <ServiceMessagesThread tenantId={tenantId} vin={vin} />
            <CommandCard title="Vehicle timeline" subtitle="Audited events for this VIN, newest first.">
              <TimelineRail
                entries={auditRows.map((a) => ({
                  at: formatCommandDateTime(a.created_at),
                  title: a.action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
                  detail: a.details && (a.details.new_state || a.details.reason)
                    ? [a.details.new_state, a.details.reason].filter(Boolean).join(" · ")
                    : undefined,
                }))}
              />
            </CommandCard>
          </div>
        </div>

        {/* Sticky mobile primary action: exactly ONE action is valid at a time */}
        {singleActionSticky && (
          <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+84px)] z-30 px-4 lg:hidden">
            <button
              type="button"
              onClick={() => onPrimaryAction(ws.action.key)}
              className={cn(
                "w-full min-h-[48px] rounded-xl text-sm font-bold inline-flex items-center justify-center gap-2 shadow-lg",
                ws.tone === "red" ? "bg-red-600 text-white" : "bg-primary text-primary-foreground",
              )}
            >
              {ws.action.label} <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </CommandCapabilityProvider>
  );
}

/* ───────────────────────────── banner ───────────────────────────── */

function StatusBannerCard({ ws, onAction }: { ws: WorkspaceStatus; onAction: (k: WorkspaceActionKey) => void }) {
  const Icon = ws.key === "cleared" ? CheckCircle2
    : ws.tone === "red" ? AlertTriangle
    : ws.key === "ready_for_k208" ? ShieldCheck
    : ws.key === "not_started" ? Clock
    : Wrench;
  return (
    <section
      role="status"
      className={cn("rounded-2xl border p-4 flex items-center justify-between gap-3 flex-wrap", TONE_BOX[ws.tone])}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className={cn("w-11 h-11 rounded-xl bg-white/70 grid place-items-center shrink-0", TONE_TEXT[ws.tone])}>
          <Icon className="w-5 h-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className={cn("text-[15px] font-bold leading-tight", TONE_TEXT[ws.tone])}>{ws.label}</p>
          {ws.blockerLabel
            ? <p className="text-caption text-muted-foreground">{ws.blockerLabel}</p>
            : <p className="text-caption text-muted-foreground">Next: {ws.action.label}</p>}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onAction(ws.action.key)}
        className={cn(
          "min-h-[44px] px-4 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 shrink-0",
          ws.tone === "red" ? "bg-red-600 text-white" : ws.key === "cleared" ? "border border-border bg-card text-foreground" : "bg-primary text-primary-foreground",
        )}
      >
        {ws.action.label} <ChevronRight className="w-4 h-4" aria-hidden="true" />
      </button>
    </section>
  );
}

/* ─────────────────────────── assignment ─────────────────────────── */

function AssignmentCard({ inspection, members, canAssign, onAssigned }: {
  inspection: InspRow | null; members: MemberRow[]; canAssign: boolean;
  onAssigned: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const reason = !inspection
    ? "No inspection row exists for this vehicle yet."
    : !canAssign ? "Your role can't assign service work. Ask a writer or manager." : null;

  // assign_safety_inspection (20260726108000) is the only write path: a direct
  // UPDATE is silently filtered by RLS for service_manager/service_advisor and
  // would toast success over a no-op. The RPC authorizes, writes, and audits.
  const assign = async (userId: string) => {
    if (!inspection) return;
    setBusy(true);
    const { data, error } = await sb().rpc("assign_safety_inspection", {
      p_inspection_id: inspection.id, p_user_id: userId || null,
    });
    setBusy(false);
    if (error) {
      const m = String(error.message || "");
      toast.error(/not_authorized/.test(m)
        ? "The server refused the assignment for your role. Nothing was recorded."
        : /assignee_not_in_tenant/.test(m)
          ? "That member is not part of this store."
          : "Couldn't record the assignment. Nothing was changed.");
      return;
    }
    if (data && data.ok === false) {
      toast.error(data.reason === "not_pending"
        ? "This inspection is already signed; the assignment can no longer change."
        : "The server refused the assignment. Nothing was recorded.");
      return;
    }
    toast.success(userId ? "Technician assigned" : "Assignment cleared");
    onAssigned();
  };

  return (
    <CommandCard title="Assignment" subtitle="Who is working this vehicle.">
      <div className="space-y-2">
        <DisabledReason reason={reason}>
          <select
            aria-label="Assigned technician"
            value={inspection?.assigned_to || ""}
            onChange={(e) => void assign(e.target.value)}
            disabled={!!reason || busy}
            className="w-full h-11 rounded-lg border border-border bg-background px-2 text-sm disabled:opacity-50"
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.user_id ?? m.id} value={m.user_id ?? ""}>{memberName(m)} ({m.role})</option>
            ))}
          </select>
        </DisabledReason>
        {inspection?.started_at && (
          <p className="text-[11.5px] text-muted-foreground">Started {formatCommandDateTime(inspection.started_at)}</p>
        )}
      </div>
    </CommandCard>
  );
}

/* ──────────────────────────── progress ──────────────────────────── */

function ProgressCard({ items }: { items: GetReadyItem[] }) {
  const total = items.length;
  const done = items.filter((i) => i.status === "complete").length;
  return (
    <CommandCard title="Get-Ready progress" subtitle={total ? `${done} of ${total} items complete` : "No worklist items yet."}>
      {total > 0 && (
        <div className="h-2 rounded-full bg-muted overflow-hidden" role="img" aria-label={`${done} of ${total} items complete`}>
          <div className="h-full bg-primary" style={{ width: `${Math.round((done / total) * 100)}%` }} />
        </div>
      )}
    </CommandCard>
  );
}

/* ───────────────────────────── summary ──────────────────────────── */

function SummaryCard({ newestSigned, openFailures, clearance, items }: {
  newestSigned: InspRow | null; openFailures: number; clearance: Clearance | null; items: GetReadyItem[];
}) {
  const checklist = newestSigned?.checklist || [];
  const passed = checklist.filter((c) => c.result === "pass").length;
  const failed = checklist.filter((c) => c.result === "fail").length;
  const workDone = items.filter((i) => i.status === "complete").length;
  return (
    <CommandCard title="Status summary" subtitle="Measured from this vehicle's records.">
      <dl className="space-y-1.5 text-[12.5px]">
        <Row label="Inspection items passed" value={newestSigned ? String(passed) : "Not inspected"} />
        <Row label="Inspection items failed" value={newestSigned ? String(failed) : "Not inspected"} />
        <Row label="Open failed items" value={String(openFailures)} tone={openFailures > 0 ? "red" : undefined} />
        <Row label="Work items complete" value={`${workDone} of ${items.length}`} />
        <Row
          label="Delivery clearance"
          value={clearance ? clearance.state.replace(/_/g, " ") : "Not computed"}
          tone={clearance?.state === "cleared_for_delivery" ? "emerald" : clearance ? "red" : undefined}
        />
      </dl>
      {clearance && clearance.reason_codes.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11.5px] text-muted-foreground list-disc pl-4">
          {clearance.reason_codes.map((code) => <li key={code}>{clearanceReasonLabel(code)}</li>)}
        </ul>
      )}
    </CommandCard>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "red" | "emerald" }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("font-semibold text-foreground", tone === "red" && "text-red-700", tone === "emerald" && "text-emerald-700")}>{value}</dd>
    </div>
  );
}

/* ─────────────────────────── K-208 panel ────────────────────────── */

interface K208PanelProps {
  tenantId: string;
  veh: Listing;
  newestSigned: InspRow | null;
  newestActive: InspRow | null;
  openFailureCount: number;
  ws: WorkspaceStatus;
  canConduct: boolean;
  canExecute: boolean;
  members: MemberRow[];
  passAllEnabled: boolean;
  failurePhotoRequired: boolean;
  /** Configured signer lists (dealer settings) — for targeting k208_ready. */
  signerUsers: string[];
  signerRoles: string[];
  onChanged: () => void;
  logAudit: ReturnType<typeof useAudit>["log"];
}

function K208Panel(props: K208PanelProps) {
  const { newestSigned, ws, openFailureCount } = props;
  const executed = isExecutedSignoff(newestSigned);
  const failedSigned = isFailedInspection(newestSigned);
  const certified = !!newestSigned?.licensee_certified_at;

  if (executed) {
    // Open item failures (from any inspection on this VIN) block execution —
    // a newer signed pass never launders an unresolved failure. The server
    // enforces the same gate in certify_safety_inspection.
    if (!certified && openFailureCount > 0) {
      return (
        <CommandCard title="CT K-208 safety inspection" subtitle="Execution is blocked while failed items are open.">
          <CommandCallout tone="red" Icon={AlertTriangle}
            title={`${openFailureCount} open failed item${openFailureCount === 1 ? "" : "s"} block K-208 execution`}>
            Every failed item must be repaired and pass reinspection by an authorized employee before the
            K-208 can be executed. Resolve them in the failed-items panel below.
          </CommandCallout>
        </CommandCard>
      );
    }
    return <ExecutedOrExecutePanel {...props} signedRow={newestSigned as InspRow} />;
  }

  if (failedSigned && ws.key !== "ready_for_reinspection") {
    return (
      <CommandCard title="CT K-208 safety inspection" subtitle="The signed inspection recorded failures.">
        <CommandCallout tone="red" Icon={AlertTriangle} title="Failed items must be repaired and reinspected">
          The inspection result only changes through a new inspection by an authorized employee after every
          failed item is repaired and marked ready for reinspection below. Marking a repair complete never
          flips this result.
        </CommandCallout>
      </CommandCard>
    );
  }

  // Conduct (or reinspect) — the checklist workflow.
  return <InspectionChecklistPanel {...props} reinspection={failedSigned} />;
}

/** Signed non-fail: execution/certification review, then the success record. */
function ExecutedOrExecutePanel({ tenantId, veh, signedRow, canExecute, openFailureCount, logAudit, onChanged }: K208PanelProps & { signedRow: InspRow }) {
  const { user } = useAuth();
  const vin = veh.vin.toUpperCase();
  const certified = !!signedRow.licensee_certified_at;
  const [confirms, setConfirms] = useState([false, false, false, false]);
  const [resultInitial, setResultInitial] = useState<"A" | "B" | "C" | "">("");
  const [signerName, setSignerName] = useState("");
  const [sig, setSig] = useState({ data: "", type: "draw" as "draw" | "type" });
  const [busy, setBusy] = useState(false);

  const checklist = signedRow.checklist || [];
  const passed = checklist.filter((c) => c.result === "pass").length;
  const priorFailures = checklist.filter((c) => c.result === "fail");

  if (certified) {
    return (
      <CommandCard title="CT K-208 safety inspection">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" aria-hidden="true" />
            <p className="font-bold text-emerald-900">K-208 executed</p>
          </div>
          <dl className="text-[12.5px] text-emerald-900 space-y-1">
            <div className="flex justify-between gap-2"><dt>Inspected by</dt><dd className="font-semibold">{signedRow.inspector_name || "Not recorded"}</dd></div>
            <div className="flex justify-between gap-2"><dt>Executed by</dt><dd className="font-semibold">{signedRow.licensee_name || "Authorized signer"}</dd></div>
            <div className="flex justify-between gap-2"><dt>Executed at</dt><dd className="font-semibold">{formatCommandDateTime(signedRow.licensee_certified_at)}</dd></div>
            <div className="flex justify-between gap-2"><dt>Document version</dt><dd className="font-semibold">v{signedRow.doc_version ?? 1}</dd></div>
          </dl>
          <div className={ACTION_GROUP}>
            <Link to={`/k208/${vin}`} className={BTN_PRIMARY}><ShieldCheck className="w-4 h-4" aria-hidden="true" /> View executed K-208</Link>
            <Link to="/service" className={BTN_SECONDARY}>Return to Service Desk</Link>
          </div>
        </div>
      </CommandCard>
    );
  }

  const allConfirmed = confirms.every(Boolean);
  const reason = openFailureCount > 0 ? "Open failed items must pass reinspection before the K-208 can be executed."
    : !canExecute ? K208_SIGNER_DENIAL
    : !allConfirmed ? "Confirm each statement above to enable execution."
    : !resultInitial ? "Choose the A/B/C warranty result."
    : !sig.data ? "Sign to execute."
    : null;

  const execute = async () => {
    if (reason || busy) return;
    setBusy(true);
    const { error } = await sb().rpc("certify_safety_inspection", {
      p_inspection_id: signedRow.id, p_result_initial: resultInitial,
      p_licensee_name: signerName.trim() || user?.email || null, p_signature_data: sig.data,
    });
    setBusy(false);
    if (error) {
      const m = String(error.message || "");
      toast.error(/not_authorized/.test(m)
        ? "The server refused: you are not an authorized K-208 signer."
        : /failed_items/.test(m) ? "The server refused: failed items are open." : "Couldn't execute the K-208.");
      return;
    }
    logAudit({ action: "k208_executed", entity_type: "vehicle", entity_id: vin, store_id: tenantId, user_id: "", details: { inspection_id: signedRow.id, result_initial: resultInitial } });
    // Materialize the stored clearance now, so the queue and Ready Board see
    // the change without anyone re-opening this workspace.
    await sb().rpc("recompute_delivery_clearance", { p_tenant_id: tenantId, p_vin: vin });
    toast.success("K-208 executed");
    onChanged();
  };

  const CONFIRMS = [
    "I am the person signing this K-208.",
    "I reviewed the inspection and its failure-resolution history.",
    "The vehicle and mileage information shown is correct.",
    "I am authorized by this dealership to execute the K-208.",
  ];

  return (
    <CommandCard
      title="Review and execute K-208"
      subtitle={`Completed ${formatCommandDateTime(signedRow.signed_at) ?? "recently"} by ${signedRow.inspector_name || "the technician"}.`}
    >
      <div className="space-y-3">
        <dl className="grid grid-cols-2 gap-2 text-[12.5px]">
          <div><dt className="text-muted-foreground">Items passed</dt><dd className="font-semibold text-foreground">{passed} of {checklist.length || K208_ITEMS.length}</dd></div>
          <div><dt className="text-muted-foreground">Mileage</dt><dd className="font-semibold text-foreground">{veh.mileage != null ? Number(veh.mileage).toLocaleString("en-US") : "Not recorded"}</dd></div>
        </dl>
        {priorFailures.length > 0 && (
          <CommandCallout tone="amber" Icon={AlertTriangle} title="Prior failures on this inspection">
            {priorFailures.map((f) => f.label || f.id).join("; ")}
          </CommandCallout>
        )}
        <Link to={`/k208/${vin}`} className={BTN_SECONDARY}><FileText className="w-4 h-4" aria-hidden="true" /> Preview the K-208 document</Link>
        <fieldset className="space-y-1.5">
          <legend className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Signer confirmations</legend>
          {CONFIRMS.map((c, i) => (
            <label key={c} className="flex items-start gap-2 text-[12.5px] text-foreground min-h-[44px] items-center">
              <input type="checkbox" checked={confirms[i]} onChange={(e) => setConfirms((s) => s.map((v, j) => (j === i ? e.target.checked : v)))} />
              <span>{c}</span>
            </label>
          ))}
        </fieldset>
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Warranty result</span>
          <div className={cn(ACTION_GROUP, "mt-1")}>
            {(["A", "B", "C"] as const).map((code) => (
              <button
                key={code}
                type="button"
                aria-pressed={resultInitial === code}
                onClick={() => setResultInitial(code)}
                className={cn("min-h-[44px] px-4 rounded-lg border text-sm font-bold",
                  resultInitial === code ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border hover:bg-muted")}
              >
                {code}
              </button>
            ))}
          </div>
          <p className="text-[10.5px] text-muted-foreground mt-1">
            {K208_INSPECTION_RESULTS.map((r: { code: string; label: string }) => `${r.code}: ${r.label}`).join(" · ")}
          </p>
        </div>
        <input
          value={signerName}
          onChange={(e) => setSignerName(e.target.value)}
          placeholder="Signer full name"
          aria-label="Signer full name"
          className="w-full h-11 rounded-lg border border-border bg-background px-3 text-sm"
        />
        <SignaturePad label="Signer signature" subtitle="Your own authenticated signature. Never sign as another person."
          value={sig.data} type={sig.type} onChange={(d, t) => setSig({ data: d, type: t })} />
        <p className="text-[10.5px] text-muted-foreground">{K208_CERTIFICATION_TEXT}</p>
        <p className="text-[10.5px] text-muted-foreground">This execution is recorded with your user identity, a timestamp, and the document version, and is fully audited.</p>
        <DisabledReason reason={reason} busyLabel={busy ? "Executing" : ""}>
          <button
            type="button"
            aria-disabled={!!reason || busy || undefined}
            onClick={execute}
            className={cn(BTN_PRIMARY, "w-full", (reason || busy) && "opacity-50 cursor-not-allowed")}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="w-4 h-4" aria-hidden="true" />}
            Review and execute K-208
          </button>
        </DisabledReason>
      </div>
    </CommandCard>
  );
}

/** Conduct the inspection (or the reinspection after repairs). */
function InspectionChecklistPanel({ tenantId, veh, newestActive, canConduct, passAllEnabled, failurePhotoRequired, signerUsers, signerRoles, reinspection, onChanged, logAudit, members }: K208PanelProps & { reinspection: boolean }) {
  const { user } = useAuth();
  const vin = veh.vin.toUpperCase();
  const key = draftKey(tenantId, vin);
  const [marks, setMarks] = useState<Record<string, K208Mark>>({});
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [draftState, setDraftState] = useState<"none" | "saved" | "unsaved">("none");
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [docs, setDocs] = useState<{ url: string; caption?: string; category?: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [inspectorName, setInspectorName] = useState(() => { try { return localStorage.getItem("autolabels.signer.service") || ""; } catch { return ""; } });
  const [sig, setSig] = useState({ data: "", type: "draw" as "draw" | "type" });
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const hydrated = useRef(false);

  // Restore the on-device draft once.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const d = JSON.parse(raw) as Draft;
        setMarks(d.marks || {});
        setItemNotes(d.itemNotes || {});
        setNotes(d.notes || "");
        setDraftSavedAt(d.savedAt || null);
        setDraftState("saved");
      }
    } catch { /* unreadable draft: start clean */ }
  }, [key]);

  // Autosave per material action: the device draft writes immediately (offline
  // fallback), and the pending inspection row's checklist syncs server-side
  // through save_inspection_draft (20260726108000) on a debounce. The RPC
  // never signs — signatures still only move through submit.
  const serverDraftId = newestActive && newestActive.status === "pending" ? newestActive.id : null;
  const [serverSave, setServerSave] = useState<"idle" | "saving" | "saved" | "offline">("idle");
  const [serverSavedAt, setServerSavedAt] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearanceSeeded = useRef(false);

  const scheduleServerSave = useCallback((m: Record<string, K208Mark>, n: Record<string, string>) => {
    if (!serverDraftId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setServerSave("saving");
    saveTimer.current = setTimeout(async () => {
      try {
        const { data, error } = await sb().rpc("save_inspection_draft", {
          p_inspection_id: serverDraftId, p_checklist: k208Checklist(m, n),
        });
        if (error || (data && data.ok === false)) throw new Error(error?.message || "draft_refused");
        setServerSave("saved");
        setServerSavedAt(String(data?.saved_at ?? new Date().toISOString()));
        if (!clearanceSeeded.current) {
          // First server save flips not_started -> in_progress; refresh the
          // stored clearance so the queue sees it without a workspace reload.
          clearanceSeeded.current = true;
          void sb().rpc("recompute_delivery_clearance", { p_tenant_id: tenantId, p_vin: vin });
        }
      } catch {
        setServerSave("offline");
      }
    }, 1200);
  }, [serverDraftId, tenantId, vin]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const persistDraft = useCallback((m: Record<string, K208Mark>, n: Record<string, string>, txt: string) => {
    try {
      const savedAt = new Date().toISOString();
      localStorage.setItem(key, JSON.stringify({ marks: m, itemNotes: n, notes: txt, savedAt } satisfies Draft));
      setDraftSavedAt(savedAt);
      setDraftState("saved");
    } catch {
      setDraftState("unsaved");
    }
    scheduleServerSave(m, n);
  }, [key, scheduleServerSave]);

  const answered = k208Answered(marks);
  const result = k208Result(marks);
  const allAnswered = answered >= K208_ITEMS.length;
  const failIds = K208_ITEMS.filter((i) => marks[i.id] === "fail").map((i) => i.id);
  const failsExplained = failIds.every((id) => (itemNotes[id] || "").trim() !== "");
  const failPhotoOk = !failurePhotoRequired || failIds.length === 0 || docs.length > 0;

  const setMark = (id: string, m: K208Mark) => {
    setReviewed(false);
    setMarks((s) => { const next = { ...s, [id]: m }; persistDraft(next, itemNotes, notes); return next; });
  };
  const setItemNote = (id: string, v: string) => {
    setItemNotes((s) => { const next = { ...s, [id]: v }; persistDraft(marks, next, notes); return next; });
  };
  const setNotesText = (v: string) => { setNotes(v); persistDraft(marks, itemNotes, v); };

  // Complete All Eligible Items: fills only UNMARKED lines with pass — an
  // existing failure (or N/A) is never overwritten — and forces re-review.
  const passAllEligible = () => {
    setReviewed(false);
    setMarks((s) => {
      const next = { ...s };
      for (const item of K208_ITEMS) if (!next[item.id]) next[item.id] = "pass";
      persistDraft(next, itemNotes, notes);
      return next;
    });
    toast.message("Eligible items marked passed. Existing failures were kept. Review before submitting.");
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    for (const f of Array.from(files)) {
      try {
        const up = await uploadPhoto("prep-photos", f, { tenantId, vin });
        if (up?.url) setDocs((d) => [...d, { url: up.url, caption: f.name, category: "inspection" }]);
      } catch { toast.error(`Couldn't upload ${f.name}`); }
    }
    setUploading(false);
  };

  const submitReason = !canConduct ? "Your role can't conduct inspections. Ask a manager for inspection access."
    : !allAnswered ? `${K208_ITEMS.length - answered} items are unmarked.`
    : !failsExplained ? "Every failed item needs an explanation."
    : !failPhotoOk ? "This store requires a photo for failed items. Attach one under Documents."
    : !reviewed ? "Review the inspection summary before signing."
    : !inspectorName.trim() ? "Enter the inspector's full name."
    : !sig.data ? "Sign to certify the inspection."
    : !consent ? "Confirm the certification statement."
    : null;

  const submit = async () => {
    if (submitReason || saving) return;
    setSaving(true);
    try {
      const checklist = k208Checklist(marks, itemNotes);
      const failureNotes = checklist.filter((c) => c.result === "fail")
        .map((c) => `${c.label}: ${c.explanation || "(no explanation)"}`).join("; ");
      const payload = { vin, ymm: veh.ymm, checklist, result, failureNotes, notes, docs, inspectorName };
      const content_hash = await hashPayload(payload);
      const ip = await fetchClientIp();
      const uid = user?.id ?? null;
      const { data: inserted, error } = await sb().from("safety_inspections").insert({
        tenant_id: tenantId, vehicle_listing_id: veh.id, vin, ymm: veh.ymm, form_type: "CT-K208",
        checklist, result, failure_notes: failureNotes || null, notes: notes || null, documents: docs,
        inspector_name: inspectorName.trim(), inspector_role: "service", signature_data: sig.data, signature_type: sig.type,
        content_hash, esign_consent: buildConsentRecord(), customer_ip: ip,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        submitted_via: "app", status: "signed", signed_at: new Date().toISOString(), created_by: uid,
      }).select("id").single();
      if (error) { toast.error(error.message || "Couldn't save the inspection. Your draft is still on this device."); return; }
      const inspId = String((inserted as { id: string }).id);

      if (result === "fail") {
        // File each failed line into the live failure work queue.
        const rows = failIds.map((id) => ({
          tenant_id: tenantId, inspection_id: inspId, vin, item_id: id,
          explanation: (itemNotes[id] || "").trim(), photos: docs.map((d) => d.url),
        }));
        const { error: fErr } = await sb().from("safety_inspection_item_failures").insert(rows);
        if (fErr) toast.error("The inspection saved, but the failed items could not be filed. File them from the failures panel.");
        await notifyMembers(tenantId, vin, members, (m) =>
          hasDealerCapability(m.role, "can_approve_service_work", false),
          "failure_entered", inspId, { failed_items: failIds.length });
      } else {
        // Tell the authorized signers the K-208 is ready to execute — the same
        // authority answer k208_signer_allowed gives server-side.
        await notifyMembers(tenantId, vin, members, (m) => k208SignerAllowedClient({
          isPlatformAdmin: false, userId: m.user_id, role: m.role,
          authorizedUsers: signerUsers, authorityRoles: signerRoles,
        }), "k208_ready", inspId, {});
      }

      try { localStorage.setItem("autolabels.signer.service", inspectorName.trim()); localStorage.removeItem(key); } catch { /* ignore */ }
      logAudit({
        action: reinspection ? "safety_reinspection_signed" : "safety_inspection_signed",
        entity_type: "vehicle", entity_id: vin, store_id: tenantId, user_id: "",
        details: { inspection_id: inspId, result, via: "workspace" },
      });
      await sb().rpc("recompute_delivery_clearance", { p_tenant_id: tenantId, p_vin: vin });
      toast.success(result === "pass" ? "Inspection signed. The K-208 is ready for execution." : "Inspection signed with failures. The failure workflow is open below.");
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const startNeeded = newestActive?.status === "pending" && newestActive.inspection_state === "not_started" && answered === 0;

  return (
    <CommandCard
      title={reinspection ? "Reinspection — CT K-208" : "CT K-208 safety inspection"}
      subtitle={reinspection
        ? "Every required item must be reinspected by an authorized employee. This records a new signed inspection."
        : "Mark each item, explain any failure, review, then sign."}
      action={
        <span className="text-[11px] text-muted-foreground" role="status" aria-live="polite">
          {serverSave === "saving" ? "Saving…"
            : serverSave === "saved" ? `Saved ${formatCommandDateTime(serverSavedAt) ?? ""}`
            : serverSave === "offline"
              ? (draftState === "saved" && draftSavedAt
                ? `Offline — draft saved on this device ${formatCommandDateTime(draftSavedAt) ?? ""}`
                : "Offline — changes are waiting to sync")
            : draftState === "saved" && draftSavedAt ? `Draft saved on this device ${formatCommandDateTime(draftSavedAt) ?? ""}`
            : draftState === "unsaved" ? "Draft NOT saved — this device blocked storage"
            : null}
        </span>
      }
    >
      <div className="space-y-4">
        {startNeeded && (
          <CommandCallout tone="blue" Icon={ClipboardList} title="Inspection not started">
            Marking the first item starts this inspection.
          </CommandCallout>
        )}
        {!canConduct && (
          <CommandCallout tone="amber" Icon={AlertTriangle} title="Read-only">
            Your role can't conduct inspections. Ask a manager for inspection access.
          </CommandCallout>
        )}
        <K208Checklist
          marks={marks}
          onMark={canConduct ? setMark : () => undefined}
          onPassAll={passAllEnabled ? passAllEligible : () => toast.message("Pass All is turned off in this store's K-208 policy.")}
          onClearAll={() => { setMarks({}); setItemNotes({}); persistDraft({}, {}, notes); setReviewed(false); }}
          failureNotes="" onFailureNotes={() => undefined}
          notes={notes} onNotes={setNotesText}
          itemNotes={itemNotes} onItemNote={setItemNote}
          passAllLabel="Complete all eligible items"
        />

        <div className="space-y-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Documents (inspection sheet, defect photos)</span>
          <input type="file" accept="image/*,application/pdf" multiple onChange={(e) => onFiles(e.target.files)} className="hidden" id="k208-files" />
          <div className={ACTION_GROUP}>
            <label htmlFor="k208-files" className={cn(BTN_SECONDARY, "cursor-pointer")}>
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Upload className="w-4 h-4" aria-hidden="true" />} Add file
            </label>
            {docs.length > 0 && <span className="text-xs text-muted-foreground">{docs.length} file(s) attached</span>}
          </div>
        </div>

        {/* Review gate: the summary must be reviewed before signing enables. */}
        <div className="rounded-xl border border-border p-3 space-y-2">
          <p className="text-[12.5px] font-bold text-foreground">Review inspection</p>
          <p className="text-[12.5px] text-muted-foreground">
            {answered} of {K208_ITEMS.length} marked · {K208_ITEMS.filter((i) => marks[i.id] === "pass").length} pass · {failIds.length} fail
          </p>
          {failIds.length > 0 && (
            <ul className="text-[11.5px] text-red-700 list-disc pl-4 space-y-0.5">
              {failIds.map((id) => <li key={id}>{itemLabel(id)}: {(itemNotes[id] || "").trim() || "explanation required"}</li>)}
            </ul>
          )}
          <label className="flex items-center gap-2 text-[12.5px] text-foreground min-h-[44px]">
            <input type="checkbox" checked={reviewed} disabled={!allAnswered || !failsExplained}
              onChange={(e) => setReviewed(e.target.checked)} />
            <span>I reviewed every item mark and failure explanation above.</span>
          </label>
        </div>

        <input value={inspectorName} onChange={(e) => setInspectorName(e.target.value)} placeholder="Inspector full name"
          aria-label="Inspector full name" className="w-full h-11 rounded-lg border border-border bg-background px-3 text-sm" />
        <SignaturePad label="Inspector signature" subtitle="Sign to certify this inspection." value={sig.data} type={sig.type}
          onChange={(d, t) => setSig({ data: d, type: t })} />
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
          <span>{K208_CERTIFICATION_TEXT}</span>
        </label>

        <DisabledReason reason={submitReason} busyLabel={saving ? "Saving" : ""}>
          <button
            type="button"
            aria-disabled={!!submitReason || saving || undefined}
            onClick={submit}
            className={cn(BTN_PRIMARY, "w-full", (submitReason || saving) && "opacity-50 cursor-not-allowed")}
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="w-5 h-5" aria-hidden="true" />}
            Sign inspection ({result.toUpperCase()})
          </button>
        </DisabledReason>
        <p className="text-[10.5px] text-muted-foreground">
          Signing records the technician inspection. K-208 execution is a separate authorized-signer step and is never triggered by Pass All.
        </p>
      </div>
    </CommandCard>
  );
}

/** Deduped, member-targeted bell notifications (user_notifications, S5). */
async function notifyMembers(
  tenantId: string,
  vin: string,
  members: MemberRow[],
  predicate: (m: MemberRow) => boolean,
  type: string,
  qualifier: string,
  payload: Record<string, unknown>,
) {
  const targets = members.filter((m) => m.user_id && predicate(m));
  if (targets.length === 0) return;
  const rows = targets.map((m) => ({
    tenant_id: tenantId, user_id: m.user_id, type,
    dedupe_key: notificationDedupeKey(type, vin, `${qualifier}:${m.user_id}`),
    vin, payload,
  }));
  await sb().from("user_notifications").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
}

/* ─────────────────────── failed-item workflow ───────────────────── */

function FailedItemsPanel({ tenantId, vin, newestSigned, failures, members, canReinspect, canConduct, onChanged, logAudit }: {
  tenantId: string; vin: string; newestSigned: InspRow | null; failures: FailureRow[];
  members: MemberRow[]; canReinspect: boolean; canConduct: boolean;
  onChanged: () => void; logAudit: ReturnType<typeof useAudit>["log"];
}) {
  const { user } = useAuth();
  const { settings } = useDealerSettings();
  const [busyId, setBusyId] = useState<string | null>(null);
  const open = failures.filter((f) => !isFailureResolved(f.repair_state));
  const signedFailNoRows = isFailedInspection(newestSigned) && failures.length === 0;

  // Who gets the ready_for_reinspection bell: members allowed to reinspect
  // under this store's policy (deduped by notifyMembers' key).
  const reinspectorPredicate = (m: MemberRow) =>
    hasDealerCapability(m.role, "can_conduct_inspection", false)
    && (!settings.service_reinspection_managers_only || hasDealerCapability(m.role, "can_approve_service_work", false));

  const fileFromChecklist = async () => {
    if (!newestSigned) return;
    const fails = (newestSigned.checklist || []).filter((c) => c.result === "fail");
    if (fails.length === 0) { toast.message("The signed inspection has no failed lines to file."); return; }
    const rows = fails.map((c) => ({
      tenant_id: tenantId, inspection_id: newestSigned.id, vin,
      item_id: c.id || c.label || "unknown_item",
      explanation: (c.explanation || "").trim() || "Failed on inspection (no explanation recorded)",
    }));
    const { error } = await sb().from("safety_inspection_item_failures").insert(rows);
    if (error) { toast.error("Couldn't file the failed items."); return; }
    toast.success(`${rows.length} failed item(s) filed for repair tracking`);
    onChanged();
  };

  const updateFailure = async (f: FailureRow, patch: Partial<FailureRow>, auditAction: AuditLogEntry["action"]) => {
    setBusyId(f.id);
    const { error } = await sb().from("safety_inspection_item_failures").update(patch).eq("id", f.id);
    setBusyId(null);
    if (error) { toast.error("Couldn't save the change."); return; }
    logAudit({ action: auditAction, entity_type: "vehicle", entity_id: vin, store_id: tenantId, user_id: "", details: { failure_id: f.id, item_id: f.item_id, ...patch } });
    if (patch.repair_state === "ready_for_reinspection"
      && open.filter((o) => o.id !== f.id).every((o) => o.repair_state === "ready_for_reinspection")) {
      // Last open item just reached ready: tell the authorized reinspectors.
      await notifyMembers(tenantId, vin, members, reinspectorPredicate,
        "ready_for_reinspection", f.inspection_id, { failure_id: f.id, item_id: f.item_id });
    }
    await sb().rpc("recompute_delivery_clearance", { p_tenant_id: tenantId, p_vin: vin });
    onChanged();
  };

  const workflowState = newestSigned?.inspection_state ?? null;
  const transition = async (to: string) => {
    if (!newestSigned) return;
    const { error } = await sb().rpc("transition_safety_inspection", { p_inspection_id: newestSigned.id, p_new_state: to });
    if (error) { toast.error("The server refused that transition."); return; }
    if (to === "ready_for_reinspection") {
      await notifyMembers(tenantId, vin, members, reinspectorPredicate,
        "ready_for_reinspection", newestSigned.id, { open_items: open.length });
    }
    await sb().rpc("recompute_delivery_clearance", { p_tenant_id: tenantId, p_vin: vin });
    onChanged();
  };
  const allItemsReady = open.length > 0 && open.every((f) => f.repair_state === "ready_for_reinspection");

  const addFailurePhoto = async (f: FailureRow, files: FileList | null) => {
    if (!files?.length) return;
    const urls: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const up = await uploadPhoto("prep-photos", file, { tenantId, vin });
        if (up?.url) urls.push(up.url);
      } catch { toast.error(`Couldn't upload ${file.name}`); }
    }
    if (urls.length) await updateFailure(f, { photos: [...(f.photos || []), ...urls] }, "failure_photo_added");
  };

  return (
    <CommandCard
      title={`${open.length} item${open.length === 1 ? "" : "s"} require correction before the K-208 can be executed`}
      subtitle="Repair complete never flips the inspection. Required items must be reinspected by an authorized employee."
    >
      <div className="space-y-3">
        {signedFailNoRows && (
          <CommandCallout tone="amber" Icon={AlertTriangle} title="Failures are not yet tracked per item"
            action={<button type="button" onClick={fileFromChecklist} className={BTN_SECONDARY}>File failed items</button>}>
            The signed inspection recorded failures, but no per-item repair rows exist. File them to track repairs and reinspection.
          </CommandCallout>
        )}
        {failures.map((f) => {
          const assignee = members.find((m) => m.user_id === f.assignee);
          const resolved = isFailureResolved(f.repair_state);
          return (
            <div key={f.id} className={cn("rounded-xl border p-3 space-y-2", resolved ? "border-emerald-200 bg-emerald-50/50" : "border-red-200 bg-red-50/40")}>
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-foreground">{itemLabel(f.item_id)}</p>
                  <p className="text-[12px] text-muted-foreground">{f.explanation}</p>
                </div>
                <StatusPill tone={resolved ? "emerald" : f.repair_state === "ready_for_reinspection" ? "amber" : "red"}>
                  {REPAIR_STATE_LABELS[f.repair_state as RepairState] ?? f.repair_state}
                </StatusPill>
              </div>
              {Array.isArray(f.photos) && f.photos.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {f.photos.slice(0, 5).map((u) => (
                    <a key={u} href={u} target="_blank" rel="noreferrer">
                      <img src={u} alt="Failure evidence" className="w-14 h-10 rounded-md object-cover border border-border" />
                    </a>
                  ))}
                </div>
              )}
              {!resolved && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Repair state</span>
                    <select
                      value={f.repair_state}
                      disabled={busyId === f.id || !canConduct}
                      onChange={(e) => void updateFailure(f, { repair_state: e.target.value }, "failure_repair_state_changed")}
                      className="mt-1 w-full h-11 rounded-lg border border-border bg-background px-2 text-sm disabled:opacity-50"
                    >
                      {REPAIR_STATES.filter((s) => s !== "passed_on_reinspection").map((s) => (
                        <option key={s} value={s}>{REPAIR_STATE_LABELS[s]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Assignee</span>
                    <select
                      value={f.assignee || ""}
                      disabled={busyId === f.id || !canConduct}
                      onChange={(e) => void updateFailure(f, { assignee: e.target.value || null }, "failure_assignee_changed")}
                      className="mt-1 w-full h-11 rounded-lg border border-border bg-background px-2 text-sm disabled:opacity-50"
                    >
                      <option value="">Unassigned</option>
                      {members.map((m) => <option key={m.user_id ?? m.id} value={m.user_id ?? ""}>{memberName(m)}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">RO number</span>
                    <input
                      defaultValue={f.ro_number || ""}
                      disabled={!canConduct}
                      onBlur={(e) => { if (e.target.value.trim() !== (f.ro_number || "")) void updateFailure(f, { ro_number: e.target.value.trim() || null }, "failure_ro_changed"); }}
                      placeholder="Repair order"
                      className="mt-1 w-full h-11 rounded-lg border border-border bg-background px-3 text-sm disabled:opacity-50"
                    />
                  </label>
                  <div className="block">
                    <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Evidence</span>
                    <div className="mt-1">
                      <input type="file" accept="image/*" multiple className="hidden" id={`fail-photo-${f.id}`} onChange={(e) => void addFailurePhoto(f, e.target.files)} />
                      <label htmlFor={`fail-photo-${f.id}`} className={cn(BTN_SECONDARY, "cursor-pointer")}>
                        <Camera className="w-4 h-4" aria-hidden="true" /> Add photo
                      </label>
                    </div>
                  </div>
                </div>
              )}
              {!resolved && (
                <DisabledReason reason={!canReinspect
                  ? "Reinspection requires inspection authority under this store's policy."
                  : f.repair_state !== "ready_for_reinspection" ? "Move the repair to Ready for reinspection first." : null}>
                  <button
                    type="button"
                    aria-disabled={!canReinspect || f.repair_state !== "ready_for_reinspection" || busyId === f.id || undefined}
                    onClick={() => {
                      if (!canReinspect || f.repair_state !== "ready_for_reinspection") return;
                      void updateFailure(f, {
                        repair_state: "passed_on_reinspection",
                        reinspected_by: user?.id ?? null,
                        reinspected_at: new Date().toISOString(),
                      }, "failure_passed_on_reinspection");
                    }}
                    className={cn(BTN_SECONDARY, (!canReinspect || f.repair_state !== "ready_for_reinspection") && "opacity-50 cursor-not-allowed")}
                  >
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Passed on reinspection
                  </button>
                </DisabledReason>
              )}
              {resolved && (
                <p className="text-[11.5px] text-emerald-800">
                  Reinspected by {memberName(members.find((m) => m.user_id === f.reinspected_by))} {formatCommandDateTime(f.reinspected_at) ?? ""}
                </p>
              )}
            </div>
          );
        })}

        {/* Workflow transitions on the signed-fail inspection record */}
        {newestSigned && isFailedInspection(newestSigned) && (
          <div className={ACTION_GROUP}>
            {workflowState === "failed_items_open" && (
              <button type="button" onClick={() => void transition("repairs_in_progress")} className={BTN_SECONDARY}>
                <Wrench className="w-4 h-4" aria-hidden="true" /> Start repairs
              </button>
            )}
            {workflowState === "repairs_in_progress" && (
              <DisabledReason reason={allItemsReady ? null : "Every open item must reach Repair completed or Ready for reinspection first."}>
                <button type="button" aria-disabled={!allItemsReady || undefined}
                  onClick={() => { if (allItemsReady) void transition("ready_for_reinspection"); }}
                  className={cn(BTN_SECONDARY, !allItemsReady && "opacity-50 cursor-not-allowed")}>
                  Send to reinspection
                </button>
              </DisabledReason>
            )}
            {workflowState === "ready_for_reinspection" && (
              <button type="button" onClick={() => void transition("repairs_in_progress")} className={BTN_SECONDARY}>
                Back to repairs
              </button>
            )}
          </div>
        )}
      </div>
    </CommandCard>
  );
}

/* ─────────────────────────── work sections ──────────────────────── */

const SECTION_DEFS: { key: string; title: string; categories: string[] }[] = [
  { key: "safety", title: "Safety inspection", categories: ["inspection"] },
  { key: "mechanical", title: "Mechanical & service", categories: ["mechanical", "fluids", "warning_lights", "diagnostics", "oil", "battery", "maintenance", "keys", "fuel", "service", "cpo"] },
  { key: "tires", title: "Tires & brakes", categories: ["tires", "brakes"] },
  { key: "recall", title: "Recall status", categories: ["recall"] },
  { key: "detail", title: "Detail", categories: ["detail", "wash", "decon", "touch_up", "dent", "wheels", "glass"] },
  { key: "accessories", title: "Accessories & installation", categories: ["accessory", "vendor"] },
  { key: "photos", title: "Photos & merchandising", categories: ["photo", "lot"] },
  { key: "documents", title: "Required documents", categories: ["docs"] },
];

function WorkSections({ tenantId, vin, gr, vehRecall, canCompleteWork, userLabel, onChanged }: {
  tenantId: string; vin: string; gr: GrRow | null; vehRecall: string | null;
  canCompleteWork: boolean; userLabel: string; onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const items = (gr?.items || []).filter(Boolean);

  const saveItems = async (next: GetReadyItem[], failMessage: string) => {
    if (!gr) return false;
    const allComplete = next.length > 0 && next.every((i) => i.status === "complete");
    const { error } = await sb().from("get_ready_records").update({
      items: next,
      status: allComplete ? "ready" : "in_progress",
      get_ready_complete_date: allComplete ? new Date().toISOString() : gr.get_ready_complete_date,
    }).eq("id", gr.id);
    if (error) { toast.error(failMessage); return false; }
    onChanged();
    return true;
  };

  const patchItem = async (itemId: string, patch: Partial<GetReadyItem>, failMessage: string) => {
    setBusyId(itemId);
    const next = items.map((i) => (i.id === itemId ? { ...i, ...patch } : i));
    await saveItems(next, failMessage);
    setBusyId(null);
  };

  const addItemPhoto = async (item: GetReadyItem, files: FileList | null) => {
    if (!files?.length) return;
    const urls: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const up = await uploadPhoto("prep-photos", file, { tenantId, vin });
        if (up?.url) urls.push(up.url);
      } catch { toast.error(`Couldn't upload ${file.name}`); }
    }
    if (urls.length) await patchItem(item.id, { photos: [...(item.photos || []), ...urls] }, "Couldn't attach the photo.");
  };

  if (!gr || items.length === 0) {
    return (
      <CommandCard title="Get-Ready work" subtitle="No worklist has been created for this vehicle yet.">
        <p className="text-[11.5px] text-muted-foreground py-2">
          The intake automation seeds the worklist for used and CPO vehicles; nothing to show for this one yet.
        </p>
      </CommandCard>
    );
  }

  const known = new Set(SECTION_DEFS.flatMap((s) => s.categories));
  const sections = SECTION_DEFS
    .map((s) => ({ ...s, items: items.filter((i) => s.categories.includes(String(i.category))) }))
    .filter((s) => s.items.length > 0);
  const other = items.filter((i) => !known.has(String(i.category)));
  if (other.length) sections.push({ key: "other", title: "Other work", categories: [], items: other });

  return (
    <div className="space-y-3">
      {sections.map((section) => (
        <CommandCard
          key={section.key}
          title={section.title}
          subtitle={`${section.items.filter((i) => i.status === "complete").length} of ${section.items.length} complete`}
        >
          {section.key === "recall" && (
            <p className="text-[11.5px] text-muted-foreground mb-2">
              Recorded recall status: <span className="font-semibold text-foreground">{vehRecall || "not checked"}</span>
            </p>
          )}
          <ul className="divide-y divide-border/60">
            {section.items.map((item) => {
              const done = item.status === "complete";
              return (
                <li key={item.id} className="py-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-foreground">{item.label}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {done
                          ? `Complete${item.completedBy ? ` · ${item.completedBy}` : ""}${item.completedAt ? ` · ${formatCommandDateTime(item.completedAt) ?? ""}` : ""}`
                          : "Pending"}
                        {item.roNumber ? ` · RO ${item.roNumber}` : ""}
                        {item.photos?.length ? ` · ${item.photos.length} photo(s)` : ""}
                      </p>
                      {item.notes ? <p className="text-[11px] text-muted-foreground italic">{item.notes}</p> : null}
                    </div>
                    {done ? (
                      <StatusPill tone="emerald" Icon={CheckCircle2}>Complete</StatusPill>
                    ) : (
                      <DisabledReason reason={canCompleteWork ? null : "Your role can't complete get-ready work."}>
                        <button
                          type="button"
                          aria-disabled={!canCompleteWork || busyId === item.id || undefined}
                          onClick={() => {
                            if (!canCompleteWork) return;
                            void patchItem(item.id, { status: "complete", completedAt: new Date().toISOString(), completedBy: userLabel }, "Couldn't mark the item complete.");
                          }}
                          className={cn(BTN_SECONDARY, (!canCompleteWork || busyId === item.id) && "opacity-50 cursor-not-allowed")}
                        >
                          {busyId === item.id ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="w-4 h-4" aria-hidden="true" />}
                          Mark complete
                        </button>
                      </DisabledReason>
                    )}
                  </div>
                  {!done && canCompleteWork && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        defaultValue={item.notes || ""}
                        onBlur={(e) => { if (e.target.value.trim() !== (item.notes || "")) void patchItem(item.id, { notes: e.target.value.trim() }, "Couldn't save the note."); }}
                        placeholder="Note"
                        aria-label={`Note for ${item.label}`}
                        className="flex-1 min-w-[140px] h-10 rounded-lg border border-border bg-background px-2.5 text-xs"
                      />
                      <input
                        defaultValue={item.roNumber || ""}
                        onBlur={(e) => { if (e.target.value.trim() !== (item.roNumber || "")) void patchItem(item.id, { roNumber: e.target.value.trim() }, "Couldn't save the RO."); }}
                        placeholder="RO #"
                        aria-label={`RO number for ${item.label}`}
                        className="w-24 h-10 rounded-lg border border-border bg-background px-2.5 text-xs"
                      />
                      <input type="file" accept="image/*" multiple className="hidden" id={`item-photo-${item.id}`} onChange={(e) => void addItemPhoto(item, e.target.files)} />
                      <label htmlFor={`item-photo-${item.id}`} aria-label={`Add photo for ${item.label}`}
                        className="min-h-[40px] min-w-[40px] grid place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground cursor-pointer">
                        <Camera className="w-4 h-4" aria-hidden="true" />
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </CommandCard>
      ))}
    </div>
  );
}

/* ─────────────── moved from ServiceDesk: QR + Title/MCO ─────────── */

function ServiceQrCard({ tenantId, vin }: { tenantId: string; vin: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const url = token ? `${window.location.origin}/ready/${token}` : "";

  const generate = async () => {
    setBusy(true);
    const { data, error } = await sb().rpc("issue_vehicle_ready_token", { p_tenant_id: tenantId, p_vin: vin });
    setBusy(false);
    if (error || !data) { toast.error("Could not generate QR"); return; }
    setToken(String(data));
  };

  return (
    <CommandCard title="Get-Ready QR (windshield)" leading={<QrCode className="w-4 h-4 text-primary" aria-hidden="true" />}>
      <p className="text-[11.5px] text-muted-foreground mb-3">
        One permanent code for this car. Service, detail, installers, and outside vendors scan it, pick their
        station, and sign. Each station locks once signed.
      </p>
      {!token ? (
        <button onClick={generate} disabled={busy} className={cn(BTN_PRIMARY)}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <QrCode className="w-4 h-4" aria-hidden="true" />} Generate QR
        </button>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <div className="bg-white p-3 rounded-xl border border-border"><QRCodeSVG value={url} size={140} /></div>
          <a href={url} target="_blank" rel="noreferrer" className="block text-xs text-primary break-all underline">{url}</a>
          <button onClick={() => void copyWithToast(url, "Link")} className={BTN_SECONDARY}>
            <Copy className="w-4 h-4" aria-hidden="true" /> Copy link
          </button>
        </div>
      )}
    </CommandCard>
  );
}

const TITLE_SLOTS = [
  { key: "title_front", label: "Title — front" },
  { key: "title_back", label: "Title — back" },
  { key: "mco_front", label: "MCO — front" },
  { key: "mco_back", label: "MCO — back" },
] as const;

function TitleMcoUpload({ tenantId, veh }: { tenantId: string; veh: { id: string; vin: string } }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});

  const upload = async (docType: string, file: File | null) => {
    if (!file) return;
    setBusy(docType);
    try {
      const up = await uploadPhoto("prep-photos", file, { tenantId, vin: veh.vin });
      if (up?.url) {
        const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
        const { error } = await sb().from("vehicle_documents").insert({
          tenant_id: tenantId, vehicle_listing_id: veh.id, vin: veh.vin, doc_type: docType,
          url: up.url, filename: file.name, customer_facing: false, uploaded_by: uid, uploaded_via: "app",
        });
        if (error) throw new Error(error.message);
        setSaved((s) => ({ ...s, [docType]: up.url }));
        toast.success("Uploaded");
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Upload failed"); }
    setBusy(null);
  };

  return (
    <CommandCard title="Title / MCO (dealer-only)" leading={<FileText className="w-4 h-4 text-primary" aria-hidden="true" />}>
      <p className="text-[11.5px] text-muted-foreground mb-3">Front and back of the title, or the new-car MCO. Never shown on the public Passport.</p>
      <div className="grid grid-cols-2 gap-3">
        {TITLE_SLOTS.map((slot) => (
          <div key={slot.key} className="rounded-xl border border-dashed border-border p-3 text-center space-y-2">
            <div className="text-xs font-semibold text-foreground">{slot.label}</div>
            {saved[slot.key] ? (
              <a href={saved[slot.key]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-600 font-semibold min-h-[44px]">
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Uploaded
              </a>
            ) : (
              <>
                <input type="file" accept="image/*,application/pdf" id={`doc-${slot.key}`} className="hidden" onChange={(e) => upload(slot.key, e.target.files?.[0] ?? null)} />
                <label htmlFor={`doc-${slot.key}`} className="min-h-[44px] px-3 rounded-md border border-border text-[11px] font-semibold inline-flex items-center gap-1.5 hover:bg-muted cursor-pointer">
                  {busy === slot.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Upload className="w-3.5 h-3.5" aria-hidden="true" />} Upload
                </label>
              </>
            )}
          </div>
        ))}
      </div>
    </CommandCard>
  );
}
