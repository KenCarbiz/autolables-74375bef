import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import {
  deriveGetReadyDispatch,
  type GetReadyItem,
} from "@/hooks/useGetReady";
import { generateZpl } from "@/hooks/useZebraPrint";
import {
  STATUS_META,
  transitionDocument,
  type DocumentStatus,
  type GeneratedDocument,
} from "@/lib/stickerStudio/documentWorkflow";
import { realTenantId } from "@/lib/tenant/realTenantId";
import { vinKey, vinKeys } from "@/lib/vinKeys";
import { documentLabel, fmtDate, humanize } from "@/lib/commandCenter/format";
import {
  authorizationHeldBack,
  authorizationReleasable,
  bundleNoteFor,
  printBlockedReason,
  printReleasable,
  printReleaseState,
  printSheetIncludes,
  printSheetNoteFor,
  PRINT_STATE_PILL,
  reprintable,
  reprintCopyNumber,
} from "@/lib/commandCenter/printRelease";
import {
  AUTOGEN_EXCEPTION_TYPE,
  buildAutogenExceptionRows,
  type AutogenExceptionRow,
} from "@/lib/commandCenter/autogenExceptions";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import {
  columnFor,
  getReadyStep,
  isThirdPartyItem,
  sumItemCosts,
} from "@/lib/commandCenter/getReadyColumns";
import {
  assignmentForItem,
  buildVendorAssignments,
} from "@/lib/commandCenter/vendorAssignments";
import {
  isCustomerVisible,
  passportHrefFor,
  passportServesVehicle,
  passportVisibilityState,
  PASSPORT_VISIBILITY_PILL,
  type PassportVisibilityState,
} from "@/lib/commandCenter/passportVisibility";
import {
  currentVersionByType,
  liveDocuments,
} from "@/lib/commandCenter/documentSet";
import { isExecutedSignoff, k208State, type SafetyInspectionRow } from "@/lib/commandCenter/inspectionState";
import { vehicleQrInBundle } from "@/lib/commandCenter/vehicleQrToken";
import { canDispatchGetReady, DISPATCH_DENIED_REASON } from "@/lib/commandCenter/dispatchAuthority";
import { buildVinPackageItems, type PackageItem } from "@/lib/commandCenter/vinPackage";
import {
  countExceptions,
  countFinished,
  countProduced,
  isReadyToMarket,
  type PackageItemStatus,
} from "@/lib/commandCenter/packageState";
import {
  createSourceReader,
  type SourceDegradation,
  type SourceReader,
} from "@/lib/commandCenter/sourceReader";
import {
  createLatestWriteQueue,
  createLoadSequencer,
} from "@/lib/commandCenter/writeSequencing";
import { openPacketPrintSheet, type PacketPrintHandle } from "@/lib/commandCenter/packetPrintSheet";
import type { Tone } from "@/components/command/CommandPrimitives";

// Data layer for the three command surfaces (VIN Command Center, Get Ready
// Command, Documents & Print Center). Every read is tenant-scoped through
// useTenant(); every count is measured from rows that were actually queried.
// When a source row is absent the item is reported pending / "Not started"
// rather than assumed complete, and every mutation either performs a real
// write or returns { ok: false, error } naming the reason it could not.

type Row = Record<string, any>;

// Re-exported so consumers can name the tone of a value this module returns
// without also importing the primitives module. It is the same type.
export type { Tone };

export interface Result<T> {
  data: T | null;
  loading: boolean;
  /** Always a human sentence — a raw Postgres message never reaches the UI. */
  error: string | null;
  /** The underlying driver message behind `error`, for support and debugging. */
  errorDetail: string | null;
  /** A vehicle that does not exist in this tenant is its own state, not an error. */
  notFound: boolean;
  /**
   * No dealership is resolvable for this user — a distinct state from "the
   * vehicle does not exist". Both used to commit the same empty quadruple, so
   * a user with no accepted tenant membership was told the vehicle was missing.
   */
  noTenant: boolean;
  /**
   * Sources that could not be read. An RLS denial and an empty table produce
   * identical data, so a screen built on partial rows must be able to say so
   * rather than under-report counts as if they were measured.
   */
  degraded: SourceDegradation[];
  reload: () => Promise<void>;
}

export type { PackageItemStatus, PackageItem };

/**
 * What every mutation on these hooks answers with. `error` is the sentence the
 * dealer reads; `errorDetail` is the driver message behind it, for support —
 * the same split the load path publishes, and the same rule the contract states
 * for Result<T>. The mutations used to drop the driver message entirely, so a
 * failed write was unsupportable from the UI.
 */
export interface MutationResult { ok: boolean; error?: string; errorDetail?: string }

export interface CommandVehicle {
  id: string; vin: string; ymm: string; trim: string | null;
  stockNumber: string | null; condition: string | null;
  heroImageUrl: string | null; mileage: number | null;
  intakeCompletedAt: string | null;
}

export interface VinCommand {
  vehicle: CommandVehicle;
  counts: { automationDone: number; automationTotal: number;
            /** Artifacts the automation created, finished or not. Always >= automationDone. */
            automationProduced: number;
            awaitingAuthorization: number | null; exceptions: number;
            passportPublished: number };
  packageItems: PackageItem[];
  readiness: { state: string;
               tone: Tone;
               blocking: { title: string; detail: string; href?: string } | null };
  /**
   * Intake automation failures recorded by intake-autoprovision in
   * vehicle_exceptions — one row per failed artifact, retriable where the
   * artifact's draft RPC can be re-invoked from here.
   */
  autogenExceptions: AutogenExceptionRow[];
  timeline: { at: string | null; title: string; detail?: string; pending?: boolean }[];
}

export interface GetReadyColumn {
  key: "service" | "prep" | "vendor";
  title: string;
  completed: number; total: number;
  tone: Tone;
  headline: string;
  items: { id: string; label: string; sublabel?: string;
           status: "complete" | "pending" | "pending_proof";
           dueLabel?: string }[];
  vendors?: { name: string; category: string; email?: string | null }[];
  estimatedCost: number | null;
  reportHref?: string;
  managerNote: string;
}

export type GetReadyPriority = "high" | "normal" | "low";

/** A pending additional-work request from service (INTAKE_SPEC S8). */
export interface ServiceApprovalRequest {
  id: string;
  workRequested: string;
  reason: string | null;
  isSafety: boolean;
  estTotal: number | null;
  requestedByName: string | null;
  roNumber: string | null;
  deliveryImpact: string | null;
  createdAt: string | null;
}

export interface GetReadyCommandData {
  vehicle: CommandVehicle;
  /** get_ready_records.id, for the delivery-target / priority edits. */
  recordId: string | null;
  deliveryTarget: string | null;
  priority: GetReadyPriority | null;
  columns: GetReadyColumn[];
  summary: { workItems: number; departments: number;
             estimatedTotal: number | null; needAttention: number };
  checklist: { key: string; label: string; done: boolean }[];
  canAuthorize: boolean;
  /**
   * The signed-in member holds the dispatch authority notify-getready requires.
   * Distinct from `canAuthorize`, which is also false for a vehicle that is not
   * ready: this one is "may view Get Ready, may not dispatch it", which is a
   * different sentence and a different screen state.
   */
  canDispatch: boolean;
  /** Why `canAuthorize` is false, phrased for the manager. Null when it is true. */
  authorizeBlockedReason: string | null;
  /** When Get Ready was authorized/dispatched for this vehicle, by any screen. */
  authorizedAt: string | null;
  /** Who recorded the authorization, when the marker carries it. */
  authorizedByEmail: string | null;
  /** Pending additional-work requests awaiting a manager's decision. */
  serviceRequests: ServiceApprovalRequest[];
  /** Recent recorded activity for the vehicle — only read once authorized. */
  activity: { at: string | null; title: string; detail?: string }[];
  /**
   * Recipients the dispatcher could not reach on the recorded authorization.
   * The authorization is one-shot, so a work order that never went out has to
   * stay visible after the toast is gone.
   */
  dispatchFailures: string[];
  /** When the shop finished the work — a completion stamp, not a commitment. */
  completedAt: string | null;
  /** Invoiced total for this get-ready, when one has been raised. */
  invoicedTotal: number | null;
  currentStep: number;
}

export interface DocRow {
  id: string; label: string; kind: "doc" | "qr";
  version: string;
  isCurrent: boolean;
  internalStatus: { label: string; tone: Tone };
  passportVisibility: { label: string; tone: Tone };
  printStatus: { label: string; tone: Tone };
  href?: string;
  /** The number the next copy wears — present exactly when Reprint is offered. */
  reprintCopy?: number;
  /** The generate-vehicle-forms kind that can rebuild this row's missing file. */
  generateKind?: "buyers_guide" | "k208";
  /** Why a file-less row has no Generate action. */
  generateBlockedReason?: string;
}

export interface PrintCenterData {
  vehicle: CommandVehicle;
  counts: { ready: number; blocked: number; customerVisible: number; internalOnly: number };
  documents: DocRow[];
  /**
   * `releasedByPacket` marks the lines "Print Complete Vehicle Packet" actually
   * moves. The QR cling and the key tag are physical media the packet button
   * never touches (they live in qr_codes / zebra_print_jobs), so summing every
   * line as if the button released it overstated the packet.
   */
  bundle: { label: string; count: number; unit: string; releasedByPacket: boolean }[];
  bundleNote: string | null;
  /** Why the packet button can release nothing. Null when it can. */
  packetBlockedReason: string | null;
  passportPreview: { label: string; version: string }[];
  passportHref: string | null;
}

// ── shared plumbing ──────────────────────────────────────────────────

const sb = () => supabase as any;

// Raw Postgres / PostgREST text is never shown to a dealer. It is mapped to a
// sentence they can act on; the original travels alongside in `errorDetail`.
function humanizeLoadError(raw: string): string {
  if (/invalid input syntax for type uuid/i.test(raw)) {
    return "That vehicle link is not valid. Open the vehicle from Inventory.";
  }
  if (/row-level security|permission denied|not authorized|insufficient privilege/i.test(raw)) {
    return "You do not have access to this vehicle in this dealership.";
  }
  if (/jwt|token is expired|refresh_token/i.test(raw)) {
    return "Your session expired. Sign in again to continue.";
  }
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(raw)) {
    return "Could not reach the server. Check your connection and retry.";
  }
  if (/timeout|canceling statement/i.test(raw)) {
    return "This vehicle took too long to load. Retry in a moment.";
  }
  return "Could not load this vehicle. Retry, or contact support if it keeps happening.";
}

// Existence of a marker event must be answered by the database, not by
// scanning a capped page of recent activity: passport views and inquiries
// accumulate on any published vehicle, so a windowed .some() eventually
// stops seeing the dispatch marker and re-offers an authorization that
// already happened (a second round of work orders and vendor emails).
async function latestAuditAt(r: SourceReader, tenantId: string, action: string, entityIds: string[]): Promise<string | null> {
  if (entityIds.length === 0) return null;
  const row = await r.oneRow(sb().from("audit_log")
    .select("created_at")
    .eq("store_id", tenantId)
    .eq("action", action)
    .in("entity_id", entityIds)
    .order("created_at", { ascending: false })
    .limit(1), `audit_log(${action})`);
  return (row?.created_at as string) || null;
}

async function latestLifecycleEvent(r: SourceReader, tenantId: string, vehicleId: string, eventType: string): Promise<Row | null> {
  return r.oneRow(sb().from("document_lifecycle_events")
    .select("occurred_at, metadata")
    .eq("tenant_id", tenantId)
    .eq("vehicle_id", vehicleId)
    .eq("event_type", eventType)
    .order("occurred_at", { ascending: false })
    .limit(1), `document_lifecycle_events(${eventType})`);
}

export interface GetReadyAuthorization {
  at: string | null;
  /** Recipients the dispatcher reported as failed on that authorization. */
  failures: string[];
  /** Who recorded it, when the marker carries the identity. */
  byEmail: string | null;
}

// When Get Ready was authorized for this vehicle, or null if it never was.
//
// The addendum stamp is not optional: accept-and-dispatch from the Vehicle File
// and the Ready Board records the dispatch ONLY as addendums.getready_dispatched_at
// (via mark_addendum_getready_dispatched). Reading just this screen's own marker
// re-offered "Authorize & Dispatch" for a vehicle whose work orders and vendor
// emails had already gone out from the other screen.
async function getReadyAuthorization(r: SourceReader, tenantId: string, vehicleId: string, vin: string): Promise<GetReadyAuthorization> {
  const [authorized, dispatched, addendumStamp] = await Promise.all([
    latestLifecycleEvent(r, tenantId, vehicleId, EVT_AUTHORIZED),
    latestAuditAt(r, tenantId, "getready_dispatched", [vehicleId, ...vinKeys(vin)].filter(Boolean)),
    vin
      ? r.oneRow(sb().from("addendums")
          .select("getready_dispatched_at")
          .eq("tenant_id", tenantId).in("vehicle_vin", vinKeys(vin))
          .not("getready_dispatched_at", "is", null)
          .order("getready_dispatched_at", { ascending: false })
          .limit(1), "addendums(getready_dispatched_at)")
      : Promise.resolve(null),
  ]);
  const meta = (authorized?.metadata || {}) as Row;
  const failures = Array.isArray(meta.failures) ? (meta.failures as unknown[]).map(String) : [];
  return {
    at: (authorized?.occurred_at as string) || dispatched || (addendumStamp?.getready_dispatched_at as string) || null,
    failures,
    byEmail: typeof meta.authorized_by_email === "string" ? meta.authorized_by_email : null,
  };
}

function useLoader<T>(
  vehicleId: string | undefined,
  run: (reader: SourceReader, tenantId: string, vehicleId: string, actorId: string | null) => Promise<T>,
) {
  const { tenant, loading: tenantLoading } = useTenant();
  const { user } = useAuth();
  const [data, setData] = useState<T | null>(null);
  // Starts true whenever there is work to do. Starting false meant the first
  // commit had loading=false, data=null, error=null — which every consumer
  // reads as "vehicle not found", so the wrong state painted on every load.
  const [loading, setLoading] = useState(!!vehicleId);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  // A missing vehicle is not a failure — it is its own state. Collapsing it into
  // `error` made all three screens show a red "Something went wrong" card with a
  // Retry that could only re-fail, and left their not-found empty states dead.
  const [notFound, setNotFound] = useState(false);
  // Nor is "this user has no dealership": that used to commit the SAME empty
  // quadruple as a missing vehicle, so a user without an accepted tenant
  // membership was told the vehicle did not exist.
  const [noTenant, setNoTenant] = useState(false);
  const [degraded, setDegraded] = useState<SourceDegradation[]>([]);
  const runRef = useRef(run);
  runRef.current = run;
  const actorId = user?.id ?? null;
  // The tenant sentinel is a real id-shaped string ("house"), so `tenant?.id`
  // is never falsy and every gate on it fired a query with a non-uuid.
  const tenantId = realTenantId(tenant);

  const sequencer = useRef(createLoadSequencer());
  useEffect(() => {
    const s = sequencer.current;
    s.mount();
    return () => { s.unmount(); };
  }, []);

  const reload = useCallback(async () => {
    const request = sequencer.current.begin();
    const commit = (fn: () => void) => {
      if (!sequencer.current.accepts(request)) return;
      fn();
    };
    const clear = () => {
      setData(null); setError(null); setErrorDetail(null);
      setNotFound(false); setNoTenant(false); setDegraded([]);
    };
    if (!vehicleId) { commit(() => { clear(); setLoading(false); }); return; }
    // The tenant resolves independently of entitlements, so hold the loading
    // state rather than reporting a false miss while it is still settling.
    if (!tenantId) { commit(() => { clear(); setNoTenant(!tenantLoading); setLoading(tenantLoading); }); return; }
    commit(() => {
      setLoading(true); setError(null); setErrorDetail(null);
      setNotFound(false); setNoTenant(false); setDegraded([]);
    });
    const reader = createSourceReader();
    try {
      const next = await runRef.current(reader, tenantId, vehicleId, actorId);
      commit(() => { setData(next); setDegraded(reader.degraded); setLoading(false); });
    } catch (e) {
      const raw = (e as Error)?.message || "Could not load this vehicle";
      commit(() => {
        if (/^vehicle not found/i.test(raw)) {
          setNotFound(true);
        } else {
          console.error("[useCommandCenter] load failed:", raw);
          setError(humanizeLoadError(raw));
          setErrorDetail(raw);
        }
        setData(null);
        setDegraded(reader.degraded);
        setLoading(false);
      });
    }
  }, [tenantId, tenantLoading, vehicleId, actorId]);

  useEffect(() => { reload(); }, [reload]);

  // Async callbacks must read the CURRENT load, not the one captured when the
  // callback was created, or a mutation validates against a stale snapshot.
  const dataRef = useRef<T | null>(data);
  dataRef.current = data;

  return { data, dataRef, loading, error, errorDetail, notFound, noTenant, degraded, reload, tenantId, actorId };
}

const VEHICLE_COLUMNS =
  "id, vin, ymm, trim, condition, mileage, hero_image_url, mc_attributes, created_at, " +
  "slug, status, published_at, packet_modules, recall_check, recall_checked_at, open_recall_count";

async function fetchVehicleRow(tenantId: string, vehicleId: string): Promise<Row> {
  const { data, error } = await sb().from("vehicle_listings")
    .select(VEHICLE_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", vehicleId)
    .maybeSingle();
  if (error) throw new Error(error.message || "Could not read the vehicle");
  if (!data) throw new Error("Vehicle not found in this dealership.");
  return data as Row;
}

function toCommandVehicle(v: Row): CommandVehicle {
  const mc = (v.mc_attributes || {}) as Row;
  return {
    id: String(v.id),
    vin: String(v.vin || ""),
    ymm: String(v.ymm || v.vin || "Vehicle"),
    trim: v.trim ?? null,
    stockNumber: (mc.stock_no as string) || null,
    condition: v.condition ?? null,
    heroImageUrl: v.hero_image_url ?? null,
    mileage: typeof v.mileage === "number" ? v.mileage : null,
    intakeCompletedAt: v.created_at ?? null,
  };
}

const isUsed = (condition: string | null) => (condition || "used") !== "new";

// Human titles for the audit actions that land on a vehicle.
const AUDIT_TITLES: Record<string, string> = {
  getready_dispatched: "Get Ready dispatched to the shop",
  document_status_change: "Document status changed",
  addendum_accepted: "Addendum accepted",
  addendum_signed: "Addendum signed by customer",
  addendum_viewed: "Addendum viewed",
  listing_viewed: "Passport viewed",
  vehicle_inquiry: "Customer inquiry",
  buyers_guide_created: "FTC Buyers Guide created",
};

// document_lifecycle_events keys this hook owns. The table is tenant-scoped
// with an authenticated read/write policy, which makes it the durable home for
// the manager's note + authorization checklist (no other table carries them).
const EVT_NOTE = "get_ready_manager_note";
const EVT_CHECKLIST = "get_ready_authorization_checklist";
const EVT_AUTHORIZED = "get_ready_authorized";
const EVT_PACKET_PRINTED = "vehicle_packet_printed";
const EVT_PRINT_BUNDLE = "print_bundle_created";
const EVT_REPRINTED = "document_reprinted";

// ── screen 1: VIN Command Center ─────────────────────────────────────

export async function loadVinCommand(r: SourceReader, tenantId: string, vehicleId: string): Promise<VinCommand> {
  const v = await fetchVehicleRow(tenantId, vehicleId);
  const vehicle = toCommandVehicle(v);
  const vin = vehicle.vin;
  const vk = vinKeys(vin);
  const used = isUsed(vehicle.condition);

  const [allDocs, inspections, signedInspections, addendums, grRecords, descCase, qrTokens, recallTasks, auditRows, authorization, exceptionRows] =
    await Promise.all([
      r.rows(sb().from("generated_documents")
        .select("id, document_type, document_status, version, pdf_url, png_url, online_url, printed_at, published_at, print_count, rejection_reason, tenant_id, vehicle_id, template_id, created_at")
        .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
        .order("version", { ascending: false }), "generated_documents"),
      r.rows(sb().from("safety_inspections")
        .select("id, status, result, form_type, signed_at, created_at")
        .eq("tenant_id", tenantId).in("vin", vk)
        .neq("status", "voided")
        .order("created_at", { ascending: false }).limit(1), "safety_inspections"),
      // The newest SIGNED row, whatever its result. Filtering `result != fail`
      // here asked the failure question of the wrong row: a signed pass in
      // January, a signed failure in February and a prefilled revision in March
      // resolved to the January pass and rendered "Ready · Signed Jan 12" over a
      // failed inspection. k208State decides; the query only supplies the rows.
      // Ordered exactly as the SQL truth (20260726110000): signed_at DESC
      // NULLS LAST, then created_at DESC — the tiebreak keeps same-second
      // re-signings deterministic across every surface.
      r.rows(sb().from("safety_inspections")
        .select("id, status, result, signed_at, created_at")
        .eq("tenant_id", tenantId).in("vin", vk)
        .eq("status", "signed")
        .order("signed_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(1), "safety_inspections(signed)"),
      // An archived addendum is retired paper. Reading the newest row without
      // that filter reported a superseded deal as the vehicle's live addendum.
      r.rows(sb().from("addendums")
        .select("id, status, lifecycle_status, accepted_at, customer_signed_at, ready_at, created_at")
        .eq("tenant_id", tenantId).in("vehicle_vin", vk)
        .neq("lifecycle_status", "archived")
        .order("created_at", { ascending: false }).limit(5), "addendums"),
      r.rows(sb().from("get_ready_records")
        .select("id, items, status, get_ready_start_date, get_ready_complete_date, inspection_complete")
        .eq("tenant_id", tenantId).in("vin", vk)
        .order("created_at", { ascending: false }).limit(1), "get_ready_records"),
      r.oneRow(sb().from("description_cases")
        .select("id, status, current_master_version_id, published_master_version_id, open_exception_count, last_error_message")
        .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).limit(1), "description_cases"),
      // The artifact /print/vehicle-qr actually mints — one token behind both
      // the rear-glass cling and the key-fob tag. qr_codes (sticker tracking
      // codes) and zebra_print_jobs (a queue nothing in this repo ever advances)
      // measured neither of them.
      r.rows(sb().from("dept_signoff_tokens")
        .select("id, department, purpose, status, expires_at, created_at")
        .eq("tenant_id", tenantId).in("vin", vk)
        .eq("department", "vehicle").eq("purpose", "get_ready")
        .order("created_at", { ascending: false }).limit(5), "dept_signoff_tokens"),
      r.rows(sb().from("recall_service_tasks")
        .select("id, status, outcome, open_recall_count, completed_at")
        .eq("tenant_id", tenantId).eq("vehicle_listing_id", vehicleId)
        .order("created_at", { ascending: false }).limit(5), "recall_service_tasks"),
      r.rows(sb().from("audit_log")
        .select("action, entity_type, entity_id, created_at, details")
        .eq("store_id", tenantId).in("entity_id", [vehicleId, ...vk].filter(Boolean))
        .order("created_at", { ascending: false }).limit(40), "audit_log"),
      getReadyAuthorization(r, tenantId, vehicleId, vin),
      r.rows(sb().from("vehicle_exceptions")
        .select("id, exception_type, status, title, explanation, source_values")
        .eq("tenant_id", tenantId).in("vin", vk)
        .eq("exception_type", AUTOGEN_EXCEPTION_TYPE)
        .in("status", ["open", "in_progress"])
        .order("created_at", { ascending: false }).limit(5), "vehicle_exceptions"),
    ]);

  // The section count has to be counted over the master the STATUS refers to.
  // Counting the working master while reporting "published" described a draft
  // the shopper cannot see.
  const publishedDesc = String(descCase?.status || "") === "PUBLISHED";
  const descMasterId: string | null =
    (publishedDesc
      ? descCase?.published_master_version_id ?? descCase?.current_master_version_id
      : descCase?.current_master_version_id) ?? null;
  const descChannelCount = descMasterId
    ? (await r.rows(sb().from("description_channel_versions")
        .select("id").eq("tenant_id", tenantId)
        .eq("master_version_id", descMasterId), "description_channel_versions")).length
    : 0;

  // The live package only. 20260724000000's keeper is the row with a real file,
  // not the highest version, so an unfiltered "newest version" pick handed the
  // VIN screen a superseded row — a dead link and a status the Print Center
  // (which filters) contradicted.
  const docs = liveDocuments(allDocs);

  const grRecord = grRecords[0] || null;
  const grItems: GetReadyItem[] = ((grRecord?.items as GetReadyItem[]) || []).filter(Boolean);
  const authorizedAt = authorization.at;
  const dispatched = !!authorizedAt;

  const rc = (v.recall_check || {}) as Row;
  // Every package row is derived by one pure builder, so "Ready to Market" is a
  // claim about rows that were measured and can be exercised without a browser.
  const items = buildVinPackageItems({
    vehicleId, vin, used, dispatched,
    liveDocs: docs,
    inspection: {
      latestSigned: (signedInspections[0] as SafetyInspectionRow | undefined) || null,
      latest: (inspections[0] as SafetyInspectionRow | undefined) || null,
    },
    addendum: addendums[0] || null,
    recall: {
      checkedAt: v.recall_checked_at || rc.checked_at || null,
      doNotDrive: !!rc.do_not_drive,
      openCount:
        typeof v.open_recall_count === "number" ? v.open_recall_count
        : typeof rc.open_recall_count === "number" ? rc.open_recall_count
        : Array.isArray(rc.recalls) ? rc.recalls.length : 0,
      tasks: recallTasks,
    },
    qrTokens,
    getReady: { record: grRecord, items: grItems },
    description: { row: descCase, channelCount: descChannelCount },
  });

  // "Automation Complete" counts artifacts that are FINISHED. A draft sticker
  // and a prefilled K-208 exist, but neither is work anyone can stop doing.
  const automationDone = countFinished(items);
  const automationProduced = countProduced(items);
  // The intake exception queue is a second source of exceptions with its own
  // rows; the stat card has to count both or the manager reads zero over a
  // recorded automation failure.
  const autogenExceptions = buildAutogenExceptionRows(exceptionRows);
  const exceptions = countExceptions(items) + autogenExceptions.length;
  const pendingGrItems = grItems.filter((i) => i.status !== "complete").length;
  const awaitingAuthorization = grRecord && !dispatched && pendingGrItems > 0 ? pendingGrItems : null;

  // The passport is "Published" when a shopper can reach it, which is the one
  // fact the Print Center's Open Passport link is built from too. A published
  // `passport` document on a draft listing is served to nobody, so counting it
  // here made this card say Published while the same vehicle's Print Center
  // footer read "This vehicle has no published Passport yet".
  const passportPublished = passportServesVehicle(v) ? 1 : 0;

  const blockedItem = items.find((i) => i.status === "blocked") || null;
  const retryItem = items.find((i) => i.status === "retry_required") || null;
  let readiness: VinCommand["readiness"];
  if (blockedItem) {
    readiness = {
      state: "Blocked", tone: "red",
      blocking: { title: blockedItem.label, detail: blockedItem.detail, href: blockedItem.href },
    };
  } else if (retryItem) {
    readiness = {
      state: "Exceptions Need Review", tone: "amber",
      blocking: { title: retryItem.label, detail: retryItem.detail, href: retryItem.href },
    };
  } else if (autogenExceptions.length > 0) {
    // A recorded intake failure (S4: ingest cannot silently finish with a
    // required artifact missing) is an exception even when every package row
    // that DID get created looks healthy.
    readiness = {
      state: "Exceptions Need Review", tone: "amber",
      blocking: {
        title: "Intake automation failed",
        detail: `${autogenExceptions[0].label}: ${autogenExceptions[0].message}`,
        href: "/admin/exceptions",
      },
    };
  } else if (awaitingAuthorization) {
    readiness = {
      state: "Awaiting Manager Authorization", tone: "blue",
      blocking: {
        title: "Get Ready not yet authorized",
        detail: `${awaitingAuthorization} work item${awaitingAuthorization === 1 ? "" : "s"} are waiting to be authorized and dispatched.`,
        href: `/get-ready-command/${vehicleId}`,
      },
    };
  } else if (isReadyToMarket({ items, getReadyStep: getReadyStep({ dispatched, items: grItems }) })) {
    readiness = { state: "Ready to Market", tone: "emerald", blocking: null };
  } else {
    readiness = { state: "Automation In Progress", tone: "slate", blocking: null };
  }

  const timeline: VinCommand["timeline"] = [];
  if (vehicle.intakeCompletedAt) {
    timeline.push({ at: vehicle.intakeCompletedAt, title: "Vehicle intake completed", detail: vehicle.stockNumber ? `Stock ${vehicle.stockNumber}` : undefined });
  }
  for (const a of auditRows) {
    const title = AUDIT_TITLES[String(a.action)] || humanize(String(a.action));
    const det = (a.details || {}) as Row;
    const detail = typeof det.dept === "string" ? `Department: ${det.dept}`
      : typeof det.action === "string" ? humanize(String(det.action))
      : undefined;
    timeline.push({ at: a.created_at, title, detail });
  }
  timeline.sort((x, y) => new Date(y.at || 0).getTime() - new Date(x.at || 0).getTime());
  // Pending rail entries are derived from measured state, never seeded.
  if (awaitingAuthorization) {
    timeline.unshift({ at: null, title: "Get Ready authorization", detail: "Waiting on a manager", pending: true });
  }
  if (!passportPublished) {
    timeline.unshift({ at: null, title: "Passport publish", detail: "Not published yet", pending: true });
  }

  return {
    vehicle,
    counts: {
      automationDone, automationTotal: items.length, automationProduced,
      awaitingAuthorization, exceptions, passportPublished,
    },
    packageItems: items,
    readiness,
    autogenExceptions,
    timeline,
  };
}

// Raw RPC/driver text for a retry, mapped to a sentence the manager can act on.
function humanizeRetryError(raw: string): string {
  if (/row-level security|permission denied|not authorized/i.test(raw)) {
    return "You do not have access to retry this artifact in this dealership.";
  }
  if (/function .* does not exist/i.test(raw)) {
    return "This retry is not available yet — the draft function has not been deployed.";
  }
  return "The retry failed. Try again in a moment, or resolve it from the exception queue.";
}

export function useVinCommand(vehicleId?: string): Result<VinCommand> & {
  /** Re-invoke the failed artifact's draft RPC (VIN-idempotent), then clear it from the exception row. */
  retryAutogenArtifact(exceptionId: string, artifact: string): Promise<MutationResult>;
  /**
   * Dismiss an artifact that no longer applies (the retry's NULL path: the
   * vehicle no longer qualifies). Removes the artifact from the row and, when
   * the row empties, marks it resolved with the dismissal reason recorded —
   * the same resolved_at/resolved_by bookkeeping the retry-clear path writes.
   */
  dismissAutogenArtifact(exceptionId: string, artifact: string): Promise<MutationResult>;
} {
  const { data, dataRef, loading, error, errorDetail, notFound, noTenant, degraded, reload, tenantId, actorId } =
    useLoader<VinCommand>(vehicleId, loadVinCommand);

  const retrying = useRef(false);
  const retryAutogenArtifact = useCallback(async (exceptionId: string, artifact: string): Promise<MutationResult> => {
    if (!tenantId) return { ok: false, error: "No dealership in context." };
    const vin = dataRef.current?.vehicle.vin;
    if (!vin) return { ok: false, error: "This vehicle has no VIN, so the artifact cannot be re-drafted." };
    const row = dataRef.current?.autogenExceptions.find(
      (e) => e.exceptionId === exceptionId && e.artifact === artifact);
    if (!row) return { ok: false, error: "This exception is no longer open. Reload the page." };
    if (!row.retryRpc) {
      // Honest per artifact: only sweep-covered artifacts get a "a background
      // task retries this" answer; edge-only ones say nothing will.
      return { ok: false, error: row.noRetryReason || "This artifact has no in-app retry. Resolve it from the exception queue." };
    }
    if (retrying.current) return { ok: false, error: "A retry is already running." };
    retrying.current = true;
    try {
      const { data: draftId, error: rpcErr } = await sb().rpc(row.retryRpc, { p_tenant_id: tenantId, p_vin: vin });
      if (rpcErr) {
        const detail = rpcErr.message || String(rpcErr);
        console.error("[useCommandCenter] artifact retry failed:", detail);
        return { ok: false, error: humanizeRetryError(detail), errorDetail: detail };
      }
      // Every draft RPC returns the artifact's row id, and NULL when the
      // listing is gone or no longer qualifies (wrong condition, no VIN
      // match). NULL means nothing was created — clearing the exception here
      // would silently bury a still-missing artifact.
      if (draftId == null) {
        return {
          ok: false,
          error: `${row.label} could not be created: the vehicle no longer qualifies for it, or is missing. The exception stays open.`,
        };
      }
      // The draft now exists, so the artifact comes off the exception row —
      // and an emptied row is resolved, exactly as the queue would resolve it.
      // Best-effort ONLY after the retry itself succeeded; a bookkeeping
      // failure never converts a successful retry into a red toast.
      const { data: exRows, error: readErr } = await sb().from("vehicle_exceptions")
        .select("id, source_values")
        .eq("tenant_id", tenantId).eq("id", exceptionId).limit(1);
      if (!readErr) {
        const ex = ((exRows as Row[] | null) || [])[0];
        if (ex) {
          const sv = (ex.source_values || {}) as { artifacts?: Record<string, unknown> };
          const artifacts = { ...(sv.artifacts || {}) };
          delete artifacts[artifact];
          const emptied = Object.keys(artifacts).length === 0;
          const patch: Row = { source_values: { ...sv, artifacts } };
          if (emptied) {
            patch.status = "resolved";
            patch.resolved_at = new Date().toISOString();
            patch.resolved_by = actorId;
          }
          const { error: updErr } = await sb().from("vehicle_exceptions")
            .update(patch).eq("tenant_id", tenantId).eq("id", exceptionId);
          if (updErr) console.error("[useCommandCenter] exception clear failed:", updErr.message || updErr);
        }
      }
      await reload();
      return { ok: true };
    } finally {
      retrying.current = false;
    }
  }, [tenantId, actorId, dataRef, reload]);

  const dismissAutogenArtifact = useCallback(async (exceptionId: string, artifact: string): Promise<MutationResult> => {
    if (!tenantId) return { ok: false, error: "No dealership in context." };
    const row = dataRef.current?.autogenExceptions.find(
      (e) => e.exceptionId === exceptionId && e.artifact === artifact);
    if (!row) return { ok: false, error: "This exception is no longer open. Reload the page." };
    const { data: exRows, error: readErr } = await sb().from("vehicle_exceptions")
      .select("id, source_values")
      .eq("tenant_id", tenantId).eq("id", exceptionId).limit(1);
    if (readErr) {
      const detail = readErr.message || String(readErr);
      return { ok: false, error: "The exception could not be read. Nothing was changed.", errorDetail: detail };
    }
    const ex = ((exRows as Row[] | null) || [])[0];
    if (!ex) return { ok: false, error: "This exception is no longer open. Reload the page." };
    const sv = (ex.source_values || {}) as { artifacts?: Record<string, unknown>; dismissed?: Record<string, unknown> };
    const artifacts = { ...(sv.artifacts || {}) };
    if (artifact) delete artifacts[artifact];
    // The dismissal is recorded on the row (who, when, why), so a resolved
    // exception still says WHY the artifact never materialized.
    const dismissed = {
      ...(sv.dismissed || {}),
      [artifact || "all"]: { reason: "no_longer_applies", at: new Date().toISOString(), by: actorId },
    };
    const patch: Row = { source_values: { ...sv, artifacts, dismissed } };
    if (Object.keys(artifacts).length === 0) {
      patch.status = "resolved";
      patch.resolved_at = new Date().toISOString();
      patch.resolved_by = actorId;
    }
    const { error: updErr } = await sb().from("vehicle_exceptions")
      .update(patch).eq("tenant_id", tenantId).eq("id", exceptionId);
    if (updErr) {
      const detail = updErr.message || String(updErr);
      return { ok: false, error: "The dismissal could not be saved. Nothing was changed.", errorDetail: detail };
    }
    await reload();
    return { ok: true };
  }, [tenantId, actorId, dataRef, reload]);

  return { data, loading, error, errorDetail, notFound, noTenant, degraded, reload, retryAutogenArtifact, dismissAutogenArtifact };
}

// ── screen 2: Get Ready Command ──────────────────────────────────────

const COLUMN_TITLES: Record<GetReadyColumn["key"], string> = {
  service: "Service Get Ready",
  prep: "Prep & Detail",
  vendor: "Vendors & Accessories",
};

const CHECKLIST_ITEMS: { key: string; label: string }[] = [
  { key: "work_items_reviewed", label: "All work items reviewed" },
  { key: "costs_verified", label: "Costs verified and approved" },
  { key: "manager_notes_added", label: "Manager notes added (if needed)" },
  { key: "vendor_assignments_confirmed", label: "Vendor assignments confirmed" },
  { key: "delivery_target_confirmed", label: "Delivery target confirmed" },
];

function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return d;
}

function businessDaysUntil(target: Date): number {
  const now = new Date();
  if (target.getTime() <= now.getTime()) return 0;
  let count = 0;
  const cur = new Date(now.getTime());
  while (cur.getTime() < target.getTime()) {
    cur.setDate(cur.getDate() + 1);
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

// Third-party proof is due within five business days of the dispatch clock.
function proofDueLabel(clockStart: string | null): string | undefined {
  if (!clockStart) return undefined;
  const start = new Date(clockStart);
  if (Number.isNaN(start.getTime())) return undefined;
  const due = addBusinessDays(start, 5);
  const days = businessDaysUntil(due);
  if (days <= 0) return "Overdue";
  return `Due in ${days} day${days === 1 ? "" : "s"}`;
}

/** Role-blind: `canDispatch` is decided by the hook, which knows who is asking. */
export type GetReadyCommandFacts = Omit<GetReadyCommandData, "canDispatch">;

export async function loadGetReadyCommand(r: SourceReader, tenantId: string, vehicleId: string): Promise<GetReadyCommandFacts> {
  const v = await fetchVehicleRow(tenantId, vehicleId);
  const vehicle = toCommandVehicle(v);
  const vin = vehicle.vin;
  const vk = vinKeys(vin);

  // Notes and the checklist are read on their own event_type filters so that
  // neither can crowd the other out of a shared page, and the authorization
  // marker is a separate bounded existence check (see getReadyAuthorization).
  const [grRecords, noteEvents, checklistEvents, authorization, detailSignoffs, pdiSignoffs, serviceRequestRows] = await Promise.all([
    r.rows(sb().from("get_ready_records")
      .select("id, items, status, get_ready_start_date, get_ready_complete_date, inspection_complete, assigned_technician, ro_number, delivery_target, priority")
      .eq("tenant_id", tenantId).in("vin", vk)
      .order("created_at", { ascending: false }).limit(1), "get_ready_records"),
    r.rows(sb().from("document_lifecycle_events")
      .select("event_type, metadata, occurred_at")
      .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
      .eq("event_type", EVT_NOTE)
      .order("occurred_at", { ascending: false }).limit(60), "document_lifecycle_events(note)"),
    r.rows(sb().from("document_lifecycle_events")
      .select("event_type, metadata, occurred_at")
      .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
      .eq("event_type", EVT_CHECKLIST)
      .order("occurred_at", { ascending: false }).limit(60), "document_lifecycle_events(checklist)"),
    getReadyAuthorization(r, tenantId, vehicleId, vin),
    r.rows(sb().from("detail_signoffs")
      .select("id, is_third_party, provider_company, photos, status, signed_at")
      .eq("tenant_id", tenantId).in("vin", vk)
      .eq("is_third_party", true)
      .order("created_at", { ascending: false }).limit(50), "detail_signoffs"),
    r.rows(sb().from("pdi_signoffs")
      .select("id, result, status, signed_at")
      .eq("tenant_id", tenantId).in("vin", vk)
      .order("created_at", { ascending: false }).limit(5), "pdi_signoffs"),
    r.rows(sb().from("service_requests")
      .select("id, work_requested, reason, is_safety, est_total, requested_by_name, ro_number, delivery_impact, status, created_at")
      .eq("tenant_id", tenantId).in("vin", vk)
      .eq("status", "pending")
      .order("created_at", { ascending: false }).limit(10), "service_requests"),
  ]);

  const grRecord = grRecords[0] || null;
  const grItems: GetReadyItem[] = ((grRecord?.items as GetReadyItem[]) || []).filter(Boolean);

  const invoices = grRecord
    ? await r.rows(sb().from("get_ready_invoices")
        .select("total, line_items, status, invoiced_at")
        .eq("tenant_id", tenantId).eq("get_ready_record_id", grRecord.id)
        .order("invoiced_at", { ascending: false }), "get_ready_invoices")
    : [];

  const authorizedAt = authorization.at;
  const dispatched = !!authorizedAt;

  // The activity feed exists only on the post-authorization view, so the rows
  // are read only once a marker says the vehicle got there.
  let activity: GetReadyCommandData["activity"] = [];
  if (dispatched) {
    const [activityAudit, activityEvents] = await Promise.all([
      r.rows(sb().from("audit_log")
        .select("action, entity_id, created_at, details")
        .eq("store_id", tenantId).in("entity_id", [vehicleId, ...vk].filter(Boolean))
        .order("created_at", { ascending: false }).limit(12), "audit_log(activity)"),
      r.rows(sb().from("document_lifecycle_events")
        .select("event_type, occurred_at, metadata")
        .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
        .in("event_type", [EVT_AUTHORIZED, EVT_PRINT_BUNDLE, EVT_PACKET_PRINTED, EVT_REPRINTED])
        .order("occurred_at", { ascending: false }).limit(12), "document_lifecycle_events(activity)"),
    ]);
    const LIFECYCLE_TITLES: Record<string, string> = {
      [EVT_AUTHORIZED]: "Get Ready authorized and dispatched",
      [EVT_PRINT_BUNDLE]: "Print bundle created",
      [EVT_PACKET_PRINTED]: "Vehicle packet printed",
      [EVT_REPRINTED]: "Document reprinted",
    };
    for (const a of activityAudit) {
      const title = AUDIT_TITLES[String(a.action)] || humanize(String(a.action));
      const det = (a.details || {}) as Row;
      activity.push({
        at: (a.created_at as string) || null,
        title,
        detail: typeof det.dept === "string" ? `Department: ${det.dept}` : undefined,
      });
    }
    for (const e of activityEvents) {
      const meta = (e.metadata || {}) as Row;
      const type = String(e.event_type);
      activity.push({
        at: (e.occurred_at as string) || null,
        title: LIFECYCLE_TITLES[type] || humanize(type),
        detail: type === EVT_PRINT_BUNDLE
          ? `${Number(meta.released || 0)} released, ${Number(meta.blocked || 0)} blocked`
          : undefined,
      });
    }
    activity.sort((x, y) => new Date(y.at || 0).getTime() - new Date(x.at || 0).getTime());
    activity = activity.slice(0, 12);
  }

  // Latest event wins per key; the table is append-only by convention.
  const notes: Record<string, string> = {};
  const checks: Record<string, boolean> = {};
  for (const e of noteEvents) {
    const meta = (e.metadata || {}) as Row;
    const col = String(meta.column || "");
    if (col && !(col in notes)) notes[col] = String(meta.note ?? "");
  }
  for (const e of checklistEvents) {
    const meta = (e.metadata || {}) as Row;
    const key = String(meta.key || "");
    if (key && !(key in checks)) checks[key] = meta.done === true;
  }

  // The five-business-day proof clock runs from the vendor's assignment, and a
  // vendor is assigned when the dispatch emails them — which only
  // authorizeAndDispatch does. Falling back to get_ready_start_date ran a due
  // date against a vendor who had not been contacted, so a car that started
  // ten business days ago and was never authorized read "Pending Proof ·
  // Overdue" for work nobody had asked anyone to do.
  const proofClock = authorizedAt;
  // THE vendor set for this vehicle, built ONCE from every get-ready line — the
  // same array deriveGetReadyDispatch reads — so the set shown and the set
  // emailed cannot differ. Built above the column map on purpose: which column
  // a line displays in must not narrow it.
  const vendorAssignments = buildVendorAssignments(grItems, detailSignoffs);

  const columns: GetReadyColumn[] = (["service", "prep", "vendor"] as const).map((key) => {
    const list = grItems.filter((i) => columnFor(i) === key);
    const mapped = list.map((i) => {
      // Third-party lines stay "Pending Proof" until THAT vendor uploads proof.
      // Derived from the row, never from the column it is displayed in.
      const isThirdParty = isThirdPartyItem(i);
      const assignment = assignmentForItem(vendorAssignments, i);
      const proven = assignment?.proven === true;
      const status: "complete" | "pending" | "pending_proof" =
        i.status === "complete" ? "complete"
        : isThirdParty && !proven ? "pending_proof"
        : "pending";
      return {
        id: i.id,
        label: i.label,
        // The name the Vendor Assignments row shows, so one vendor reads the
        // same on the line and in the list.
        sublabel: assignment?.name || i.vendorName || undefined,
        status,
        dueLabel: status === "pending_proof" ? proofDueLabel(proofClock) : undefined,
      };
    });
    const total = mapped.length;
    const completed = mapped.filter((i) => i.status === "complete").length;
    const pendingProof = mapped.filter((i) => i.status === "pending_proof").length;
    const headline =
      total === 0 ? "No work items"
      : completed === total ? `${completed} of ${total} Completed`
      : pendingProof > 0 && completed + pendingProof === total ? `${pendingProof} of ${total} Pending Proof`
      : `${completed} of ${total} Completed`;

    const estimatedCost = sumItemCosts(list);

    // Vendor Assignments renders the whole set, whichever column each line is
    // displayed in. Narrowing it to `vendorsFor(list)` printed nothing at all
    // over an address the authorization was about to email, because
    // isThirdPartyItem and columnFor are not co-extensive.
    const vendorRows = key === "vendor"
      ? vendorAssignments.map((vd) => ({ name: vd.name, category: vd.category, email: vd.email }))
      : undefined;

    // Three columns, three distinct reports. Prep and vendor both resolving to
    // ?tab=prep meant "View Vendor Plan" opened the prep tab; the vendor's
    // completion proof lives on the evidence timeline.
    const reportHref =
      key === "service" ? (vin ? `/k208/${vinKey(vin)}` : `/vehicle-file/${vehicleId}?tab=deal`)
      : key === "vendor" ? `/vehicle-file/${vehicleId}?tab=evidence`
      : `/vehicle-file/${vehicleId}?tab=prep`;

    return {
      key,
      title: COLUMN_TITLES[key],
      completed, total,
      tone: (total > 0 && completed === total ? "emerald" : total === 0 ? "slate" : "amber") as Tone,
      headline,
      items: mapped,
      vendors: vendorRows,
      estimatedCost,
      reportHref,
      managerNote: notes[key] ?? "",
    };
  });

  // The rail's "Estimated Total Cost" is the SAME sum over the SAME rows as the
  // three per-column figures printed beside it — nothing else. Falling back to
  // the invoice when no line carried a cost put "$1,485" on the rail above three
  // columns all reading "—", which is the disagreement the old comment here
  // claimed was impossible. The invoiced figure is a different fact and is
  // reported under its own name.
  const invoicedTotals = invoices
    .map((inv) => Number(inv.total))
    .filter((n) => Number.isFinite(n));
  const invoicedTotal = invoicedTotals.length
    ? invoicedTotals.reduce((s, n) => s + n, 0)
    : null;
  const estimatedTotal = sumItemCosts(grItems);

  const checklist = CHECKLIST_ITEMS.map((c) => ({ ...c, done: checks[c.key] === true }));
  // Authorizing twice sends every work order and vendor email a second time,
  // so a vehicle that has already been dispatched can never be authorized again
  // from this screen — by any of the paths that record a dispatch.
  const unchecked = checklist.filter((c) => !c.done).length;
  const authorizeBlockedReason: string | null =
    dispatched ? "Get Ready was already authorized and dispatched for this vehicle."
    : !grRecord ? "This vehicle has no Get Ready record yet."
    : grItems.length === 0 ? "This Get Ready record has no work items to dispatch."
    : unchecked > 0 ? `Complete the authorization checklist (${unchecked} item${unchecked === 1 ? "" : "s"} left).`
    : null;
  const canAuthorize = authorizeBlockedReason === null;

  const currentStep = getReadyStep({ dispatched, items: grItems });

  // pdi_signoffs is read so a signed PDI counts toward the service column's
  // completion signal even when the record's own line was never ticked.
  //
  // "Signed and not failed" is ONE predicate, shared with the K-208. Spelling it
  // `result === 'pass'` here and `result !== 'fail'` there meant a legacy signed
  // PDI with a NULL result (the column is nullable — 20260629013549:12) was
  // silently dropped on one screen and honoured on the other.
  const pdiSigned = pdiSignoffs.some((p) => isExecutedSignoff(p as SafetyInspectionRow));
  if (pdiSigned) {
    const svc = columns.find((c) => c.key === "service");
    // A signed PDI is a fact about the vehicle at every count, not only at zero.
    // Gating it on `completed === 0` dropped it from a service column at 1 of 6
    // — the case where the manager most needs to know the PDI is already done.
    if (svc && svc.total > 0 && svc.completed < svc.total) {
      svc.headline = `${svc.headline} · PDI signed`;
    }
  }

  // 20260726030000 added the real columns; anything outside the CHECK is
  // reported as unknown rather than invented.
  const rawPriority = String(grRecord?.priority || "");
  const priority: GetReadyPriority | null =
    rawPriority === "high" || rawPriority === "normal" || rawPriority === "low" ? rawPriority : null;

  return {
    vehicle,
    recordId: (grRecord?.id as string) ?? null,
    deliveryTarget: (grRecord?.delivery_target as string) ?? null,
    priority,
    columns,
    summary: {
      workItems: grItems.length,
      departments: columns.filter((c) => c.total > 0).length,
      estimatedTotal,
      needAttention: grItems.filter((i) => i.status !== "complete").length,
    },
    checklist,
    canAuthorize,
    authorizeBlockedReason,
    authorizedAt,
    authorizedByEmail: authorization.byEmail,
    serviceRequests: serviceRequestRows.map((s): ServiceApprovalRequest => ({
      id: String(s.id),
      workRequested: String(s.work_requested || ""),
      reason: (s.reason as string) ?? null,
      isSafety: s.is_safety === true,
      estTotal: typeof s.est_total === "number" ? s.est_total : Number.isFinite(Number(s.est_total)) && s.est_total != null ? Number(s.est_total) : null,
      requestedByName: (s.requested_by_name as string) ?? null,
      roNumber: (s.ro_number as string) ?? null,
      deliveryImpact: (s.delivery_impact as string) ?? null,
      createdAt: (s.created_at as string) ?? null,
    })),
    activity,
    dispatchFailures: authorization.failures,
    completedAt: (grRecord?.get_ready_complete_date as string) ?? null,
    invoicedTotal,
    currentStep,
  };
}

// S6.8 — what an authorization releases to the Print Center: every live
// pre-release document with a printable file, moved draft/pending -> approved
// through the same workflow (and the same compare-and-set) every other
// transition uses. The K-208 and file-less drafts are held back with their
// reasons intact. Read directly, not through the source reader: a degraded
// read must be reported as "could not release", never as "nothing to release".
async function releaseAuthorizedDocuments(args: {
  tenantId: string; vehicleId: string; vin: string | null; stock: string | null; actorId: string | null;
}): Promise<{ released: string[]; blocked: number; error: string | null }> {
  const { tenantId, vehicleId, actorId } = args;
  const { data: rows, error: readErr } = await sb().from("generated_documents")
    .select("id, tenant_id, vehicle_id, template_id, document_type, document_status, version, pdf_url, png_url, online_url, print_count, printed_at, published_at, created_at")
    .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId);
  if (readErr) {
    const detail = readErr.message || String(readErr);
    console.error("[useCommandCenter] release read failed:", detail);
    return { released: [], blocked: 0, error: detail };
  }
  const docs = liveDocuments((rows as Row[]) || []);
  const eligible = docs.filter(authorizationReleasable);
  const held = docs.filter(authorizationHeldBack).length;
  const released: string[] = [];
  let failure: string | null = null;
  for (const d of eligible) {
    const res = await transitionDocument({
      doc: d as unknown as GeneratedDocument,
      action: "approve",
      actorId,
      reason: "get_ready_authorization",
      // The row was read moments ago, but the dispatch window is long enough
      // for another tab to move it; approve only what is still pre-release.
      expectedStatus: String(d.document_status) as DocumentStatus,
    });
    if (res.ok) released.push(String(d.id));
    else if (!failure && res.error !== "stale_status") failure = res.error || "transition_failed";
  }
  const blocked = held + (eligible.length - released.length);
  const { error: eventErr } = await sb().from("document_lifecycle_events").insert({
    tenant_id: tenantId, vehicle_id: vehicleId,
    vin: args.vin, stock: args.stock,
    event_type: EVT_PRINT_BUNDLE, occurred_at: new Date().toISOString(),
    actor_id: actorId, source: "get-ready-command",
    metadata: { document_ids: released, released: released.length, blocked },
  });
  if (eventErr) console.error("[useCommandCenter] print bundle event failed:", eventErr.message || eventErr);
  return { released, blocked, error: failure ?? (eventErr ? eventErr.message || String(eventErr) : null) };
}

/** What the page renders as the four S6 result lines after an authorization. */
export interface AuthorizationOutcome {
  /**
   * The EVT_AUTHORIZED marker actually reached the VIN timeline. Line 1 of the
   * results card renders THIS, not a hardcoded yes — a failed marker write with
   * a green "recorded on the VIN timeline" line was a lie about the one record
   * that prevents a second dispatch.
   */
  recorded: boolean;
  /** The frozen instruction snapshot was captured on that marker. */
  snapshotFrozen: boolean;
  /** Named dispatch targets in send order, each with whether it was reached. */
  targets: { name: string; ok: boolean }[];
  documents: { released: number; blocked: number };
  failures: string[];
}

export type AuthorizeResult = MutationResult & { outcome?: AuthorizationOutcome };

export function useGetReadyCommand(vehicleId?: string): Result<GetReadyCommandData> & {
  saveManagerNote(columnKey: string, note: string): Promise<MutationResult>;
  toggleChecklist(key: string, done: boolean): Promise<MutationResult>;
  authorizeAndDispatch(): Promise<AuthorizeResult>;
  setDeliveryTarget(value: string | null): Promise<MutationResult>;
  setPriority(value: GetReadyPriority | null): Promise<MutationResult>;
  decideServiceRequest(requestId: string, decision: "approved" | "declined" | "clarify", note?: string): Promise<MutationResult>;
} {
  const { data: facts, dataRef, loading, error, errorDetail, notFound, noTenant, degraded, reload, tenantId, actorId } =
    useLoader<GetReadyCommandFacts>(vehicleId, loadGetReadyCommand);
  const { member } = useEntitlements();
  const { isAdmin, user } = useAuth();
  const canDispatch = canDispatchGetReady(member?.role, isAdmin);
  const canDispatchRef = useRef(canDispatch);
  canDispatchRef.current = canDispatch;
  const canApproveServiceWork = hasDealerCapability(member?.role, "can_approve_service_work", isAdmin);
  const canApproveRef = useRef(canApproveServiceWork);
  canApproveRef.current = canApproveServiceWork;
  const actorEmail = user?.email ?? null;
  const actorEmailRef = useRef(actorEmail);
  actorEmailRef.current = actorEmail;

  const data: GetReadyCommandData | null = useMemo(() => {
    if (!facts) return null;
    if (canDispatch) return { ...facts, canDispatch };
    // Viewing is not dispatching. The button is disabled for the reason the
    // server would give, instead of being live and answering with a 401 the
    // screen then described as a possible partial send.
    return { ...facts, canDispatch, canAuthorize: false, authorizeBlockedReason: DISPATCH_DENIED_REASON };
  }, [facts, canDispatch]);

  const writeEvent = useCallback(async (eventType: string, metadata: Row): Promise<MutationResult> => {
    if (!tenantId || !vehicleId) return { ok: false, error: "No dealership or vehicle in context." };
    const current = dataRef.current;
    const { error: err } = await sb().from("document_lifecycle_events").insert({
      tenant_id: tenantId,
      vehicle_id: vehicleId,
      vin: current?.vehicle.vin || null,
      stock: current?.vehicle.stockNumber || null,
      event_type: eventType,
      occurred_at: new Date().toISOString(),
      actor_id: actorId,
      source: "get-ready-command",
      metadata,
    });
    if (err) {
      const detail = err.message || String(err);
      console.error("[useCommandCenter] lifecycle write failed:", detail);
      return { ok: false, error: "Could not save that change. Nothing was recorded — try again.", errorDetail: detail };
    }
    return { ok: true };
  }, [tenantId, vehicleId, actorId, dataRef]);

  // See createLatestWriteQueue: append-only writes must not repeat an unchanged
  // value, and the skip must not be decided from a render-old snapshot.
  const writes = useRef(createLatestWriteQueue());

  const saveManagerNote = useCallback(async (columnKey: string, note: string) => {
    const persisted = dataRef.current?.columns.find((c) => c.key === columnKey)?.managerNote;
    return writes.current.submit({
      key: `note:${columnKey}`, value: note, persisted,
      run: () => writeEvent(EVT_NOTE, { column: columnKey, note }),
      afterWrite: reload,
    });
  }, [writeEvent, dataRef, reload]);

  const toggleChecklist = useCallback(async (key: string, done: boolean) => {
    const current = dataRef.current?.checklist.find((c) => c.key === key);
    const persisted = current ? String(current.done) : undefined;
    return writes.current.submit({
      key: `check:${key}`, value: String(done), persisted,
      run: () => writeEvent(EVT_CHECKLIST, { key, done }),
      afterWrite: reload,
    });
  }, [writeEvent, dataRef, reload]);

  // The delivery commitment and priority live on get_ready_records
  // (20260726030000). Setting them is a manager act — the same authority the
  // dispatch itself requires — and the write is tenant-scoped like every other.
  const patchRecord = useCallback(async (patch: Row, deniedReason: string): Promise<MutationResult> => {
    if (!tenantId) return { ok: false, error: "No dealership or vehicle in context." };
    if (!canDispatchRef.current) return { ok: false, error: deniedReason };
    const recordId = dataRef.current?.recordId;
    if (!recordId) return { ok: false, error: "This vehicle has no Get Ready record yet." };
    const { error: err } = await sb().from("get_ready_records")
      .update(patch).eq("tenant_id", tenantId).eq("id", recordId);
    if (err) {
      const detail = err.message || String(err);
      console.error("[useCommandCenter] get_ready_records patch failed:", detail);
      return { ok: false, error: "Could not save that change. Nothing was recorded — try again.", errorDetail: detail };
    }
    await reload();
    return { ok: true };
  }, [tenantId, dataRef, reload]);

  const setDeliveryTarget = useCallback(async (value: string | null): Promise<MutationResult> => {
    return patchRecord({ delivery_target: value }, "Only a manager can set the delivery target.");
  }, [patchRecord]);

  const setPriority = useCallback(async (value: GetReadyPriority | null): Promise<MutationResult> => {
    if (value !== null && value !== "high" && value !== "normal" && value !== "low") {
      return { ok: false, error: "Priority must be high, normal, or low." };
    }
    return patchRecord({ priority: value }, "Only a manager can set the priority.");
  }, [patchRecord]);

  // S8 — the structured decision. decide_service_request is the ONLY sanctioned
  // path (it writes audit_log and the requester's notification); a chat message
  // can never authorize repairs.
  const deciding = useRef(false);
  const decideServiceRequest = useCallback(async (
    requestId: string,
    decision: "approved" | "declined" | "clarify",
    note?: string,
  ): Promise<MutationResult> => {
    if (!tenantId) return { ok: false, error: "No dealership or vehicle in context." };
    if (!canApproveRef.current) {
      return { ok: false, error: "Only a manager with service-approval authority can decide this request." };
    }
    if (deciding.current) return { ok: false, error: "A decision is already being recorded." };
    deciding.current = true;
    try {
      const { error: rpcErr } = await sb().rpc("decide_service_request", {
        p_request_id: requestId, p_decision: decision, p_note: note || null,
      });
      if (rpcErr) {
        const detail = rpcErr.message || String(rpcErr);
        console.error("[useCommandCenter] service request decision failed:", detail);
        const message = /not_authorized_to_decide/.test(detail)
          ? "Only a manager with service-approval authority can decide this request."
          : /request_not_found/.test(detail)
            ? "This request no longer exists. Reload the page."
            : "The decision could not be recorded. Nothing changed — try again.";
        return { ok: false, error: message, errorDetail: detail };
      }
      await reload();
      return { ok: true };
    } finally {
      deciding.current = false;
    }
  }, [tenantId, reload]);

  // Reuses the existing dispatch path (deriveGetReadyDispatch → notify-getready),
  // the same one ReadyBoard and the Vehicle File call on addendum acceptance.
  const dispatching = useRef(false);
  const authorizeAndDispatch = useCallback(async (): Promise<AuthorizeResult> => {
    if (!tenantId || !vehicleId) return { ok: false, error: "No dealership or vehicle in context." };
    // Asked here as well as on the button, because dataRef carries the loader's
    // role-blind facts and this is a one-shot irreversible send.
    if (!canDispatchRef.current) return { ok: false, error: DISPATCH_DENIED_REASON };
    const current = dataRef.current;
    const vin = current?.vehicle.vin;
    if (!vin) return { ok: false, error: "This vehicle has no VIN, so no work order can be addressed." };
    if (!current?.canAuthorize) {
      return { ok: false, error: current?.authorizeBlockedReason || "Complete the authorization checklist first." };
    }
    // Every work order and vendor email goes out again on a second dispatch, so
    // re-ask the database at submit time rather than trusting a render-old snapshot.
    if (dispatching.current) return { ok: false, error: "A dispatch is already in progress." };
    dispatching.current = true;

    const reader = createSourceReader();
    try {
      const already = await getReadyAuthorization(reader, tenantId, vehicleId, vin);
      // FAIL CLOSED. createSourceReader degrades every driver error to [] / null,
      // so "the markers say this was never authorized" and "the markers could not
      // be read" arrive here as the same answer. In front of an irreversible send
      // they are not the same answer: a statement timeout or a post-migration
      // schema-cache 500 on document_lifecycle_events / audit_log / addendums
      // would let a vehicle authorized yesterday re-send every work order and
      // every vendor email today, and write the second EVT_AUTHORIZED as if it
      // were the first.
      if (reader.degraded.length > 0) {
        console.error("[useCommandCenter] authorization re-check degraded:", reader.degraded);
        return {
          ok: false,
          error: "Could not confirm whether this vehicle was already authorized — nothing was sent. Retry in a moment, or check the VIN timeline.",
        };
      }
      if (already.at) {
        await reload();
        return { ok: false, error: `Get Ready was already authorized on ${fmtDate(already.at)}. Nothing was sent again.` };
      }
      const { depts, vendors } = await deriveGetReadyDispatch(tenantId, vin);
      const res = await sb().functions.invoke("notify-getready", {
        body: {
          tenant_id: tenantId, vin, depts, vendors,
          app_base: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });
      const payload = (res?.data || {}) as Row;
      if (res?.error && !payload.ok) {
        // notify-getready sends per target INSIDE its loop and only then
        // returns 502/200 (index.ts:165-199), so a transport failure after a
        // partial send makes "Nothing was sent" a claim this side cannot make.
        // What IS known: the authorization was not recorded here, and every
        // work order that did go out wrote its own audit_log row (:176), which
        // the pre-dispatch re-check above reads before allowing a retry.
        return {
          ok: false,
          error: "Could not confirm the dispatch with the Get-Ready service. Some work orders may already have gone out — check the VIN timeline before authorizing again.",
        };
      }
      if (!payload.ok) {
        if (payload.error === "no_recipient") {
          return { ok: false, error: "No shop email is configured. Add a detail or service email in Settings, then authorize." };
        }
        if (payload.error === "no_token") {
          return { ok: false, error: "This vehicle has no Get-Ready link yet. It is minted at intake — re-run intake, then authorize." };
        }
        return { ok: false, error: String(payload.error || "Dispatch was rejected.") };
      }
      // notify-getready answers ok:anySent (index.ts:199) — one department
      // succeeding reports success for all of them. Authorization is one-shot,
      // so a recipient that was never reached has to be named here and kept on
      // the record; otherwise the failure disappears with the toast and the
      // work order can never be re-sent.
      const dispatchedTargets = Array.isArray(payload.dispatched)
        ? (payload.dispatched as Row[])
        : [];
      // notify-getready labels EVERY vendor target `dept:"vendor"` (index.ts:131)
      // and carries no other identity, so "vendor was not reached" left a manager
      // with three vendors no way to learn which one. The function pushes one
      // vendor target per entry of `vendors`, in order (:130-138, :179), so the
      // nth vendor result is the nth vendor we sent — but only claim that when
      // the counts line up.
      const vendorResults = dispatchedTargets.filter((t) => String(t.dept || "") === "vendor");
      const canNameVendors = vendorResults.length === vendors.length;
      let vendorIdx = 0;
      const failedTargets: string[] = [];
      const namedTargets: { name: string; ok: boolean }[] = [];
      for (const t of dispatchedTargets) {
        const isVendor = String(t.dept || "") === "vendor";
        const named = isVendor && canNameVendors
          ? (vendors[vendorIdx]?.name || vendors[vendorIdx]?.email || "vendor")
          : String(t.dept || "recipient");
        if (isVendor) vendorIdx += 1;
        namedTargets.push({ name: named, ok: t.ok === true });
        if (t.ok !== true) failedTargets.push(named);
      }
      // A department with no email configured never becomes a target at all, so
      // it is absent from `dispatched` rather than present-and-failed.
      const attempted = new Set(dispatchedTargets.map((t) => String(t.dept || "")));
      const neverAttempted: string[] = depts.filter((d) => !attempted.has(d));
      if (vendors.length > 0 && vendorResults.length === 0) {
        for (const vd of vendors) neverAttempted.push(vd.name || vd.email);
      }
      for (const name of neverAttempted) namedTargets.push({ name, ok: false });
      const failures = Array.from(new Set([...failedTargets, ...neverAttempted]));

      // S6.1 — freeze the immutable instruction version: the exact work items
      // as the shop will receive them, the manager's notes, the checklist that
      // authorized them, and the delivery commitment. Items AND notes are read
      // fresh at dispatch time so the frozen list is the one
      // deriveGetReadyDispatch just emailed, not a render-old view of it. A
      // failed read must NOT freeze an empty snapshot as if the shop had no
      // instructions — the freeze is aborted and said so; the authorization
      // has already happened and is still recorded.
      const currentFacts = dataRef.current;
      const [recRes, noteRes] = await Promise.all([
        sb().from("get_ready_records")
          .select("id, items, delivery_target, priority")
          .eq("tenant_id", tenantId).in("vin", vinKeys(vin))
          .order("created_at", { ascending: false }).limit(1),
        sb().from("document_lifecycle_events")
          .select("metadata, occurred_at")
          .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
          .eq("event_type", EVT_NOTE)
          .order("occurred_at", { ascending: false }).limit(60),
      ]);
      const snapshotError: string | null =
        recRes.error ? (recRes.error.message || String(recRes.error))
        : noteRes.error ? (noteRes.error.message || String(noteRes.error))
        : null;
      let snapshot: Row | null = null;
      if (snapshotError) {
        console.error("[useCommandCenter] instruction snapshot read failed:", snapshotError);
      } else {
        const rec = ((recRes.data as Row[] | null) || [])[0] || null;
        // Latest event wins per column — the same rule the loader applies —
        // read from the DB rather than dataRef so the frozen note is the one
        // that was saved, not a render-old textarea.
        const freshNotes: Record<string, string> = {};
        for (const e of ((noteRes.data as Row[] | null) || [])) {
          const meta = ((e as Row).metadata || {}) as Row;
          const col = String(meta.column || "");
          if (col && !(col in freshNotes)) freshNotes[col] = String(meta.note ?? "");
        }
        snapshot = {
          items: ((rec?.items as Row[]) || []).filter(Boolean),
          notes: freshNotes,
          checklist: (currentFacts?.checklist || []).map((c) => ({ key: c.key, label: c.label, done: c.done })),
          delivery_target: (rec?.delivery_target as string) ?? null,
          priority: (rec?.priority as string) ?? null,
        };
      }

      // The dispatch is the authorization: record it only after the server
      // confirmed at least one work order actually went out. If that record
      // fails the work orders are already out, so the caller must be told —
      // authorizing a second time would send them all again.
      const recorded = await writeEvent(EVT_AUTHORIZED, {
        dispatched: payload.dispatched ?? null, depts, vendors: vendors.length, failures,
        authorized_by_email: actorEmailRef.current, snapshot, snapshot_error: snapshotError,
      });

      // S6.8/9 — release the eligible documents to the Print Center and file
      // the print bundle. The work orders are already out, so this runs whether
      // or not the marker write above succeeded; each blocked document keeps
      // its exact reason (printBlockedReason / the bundle note state it).
      const release = await releaseAuthorizedDocuments({
        tenantId, vehicleId, vin,
        stock: currentFacts?.vehicle.stockNumber ?? null,
        actorId,
      });
      // Stamp the marker the Ready Board and the Vehicle File read, so those
      // screens stop offering a dispatch that has already happened. This is NOT
      // best-effort: mark_addendum_getready_dispatched raises for a member whose
      // tenant_members.accepted_at is null (20260722140000:84-91), and when it
      // does the other surfaces never show "Get-Ready sent" — so the employee
      // clicks Accept & Dispatch there and every work order and vendor email
      // goes out a second time. Swallowing it caused the exact outcome the stamp
      // exists to prevent.
      //
      // The LOOKUP that feeds the stamp is read directly, not through the source
      // reader: that helper degrades any driver error to null, which read as
      // "there is no addendum to stamp" — so a denied or dropped SELECT skipped
      // the RPC, reported ok:true, and left both other screens still offering
      // Accept & Dispatch. A8 was fixed for the RPC and left open for its input.
      let stampError: string | null = null;
      const { data: addnRows, error: addnErr } = await sb().from("addendums")
        .select("id")
        .eq("tenant_id", tenantId).in("vehicle_vin", vinKeys(vin))
        .neq("lifecycle_status", "archived")
        .is("getready_dispatched_at", null)
        .order("created_at", { ascending: false }).limit(1);
      if (addnErr) {
        stampError = addnErr.message || String(addnErr);
        console.error("[useCommandCenter] dispatch stamp lookup failed:", stampError);
      } else {
        const addn = ((addnRows as Row[] | null) || [])[0] || null;
        if (addn?.id) {
          const { error: stampErr } = await sb().rpc("mark_addendum_getready_dispatched", { _addendum_id: addn.id });
          if (stampErr) {
            stampError = stampErr.message || String(stampErr);
            console.error("[useCommandCenter] dispatch stamp failed:", stampError);
          }
        }
      }
      await reload();
      const outcome: AuthorizationOutcome = {
        recorded: recorded.ok,
        snapshotFrozen: recorded.ok && snapshot !== null,
        targets: namedTargets,
        documents: { released: release.released.length, blocked: release.blocked },
        failures,
      };
      if (!recorded.ok) {
        return {
          ok: false,
          error: `Work orders were dispatched, but the authorization could not be recorded: ${recorded.error || "unknown error"}. Do not authorize again — check the VIN timeline.`,
          errorDetail: recorded.errorDetail,
          outcome,
        };
      }
      // Both problems are reported, not just the first. A run that BOTH missed a
      // recipient AND failed the addendum stamp used to report only the missed
      // recipient — and then send the manager to the Ready Board, where the
      // missing stamp still offers Accept & Dispatch and re-sends everything.
      const notes: string[] = [];
      if (failures.length) {
        // Ready Board's sendGetReady posts { tenant_id, vin } only, which
        // notify-getready defaults to ["detail"] with no vendors — so it cannot
        // re-send a vendor work order, and pointing a manager there for one was
        // advice that could not work. No surface in this app re-sends a single
        // recipient; say what is true instead.
        notes.push(
          `Get Ready was authorized, but ${failures.join(" and ")} ${failures.length === 1 ? "was" : "were"} not reached. ` +
          "The authorization is recorded and cannot be repeated, so contact them directly with the work order — " +
          "re-sending from the Ready Board would email the whole shop again.",
        );
      }
      if (snapshotError) {
        notes.push(
          "The instruction snapshot could not be recorded — the work items and notes could not be re-read at dispatch time. " +
          "The authorization stands and the work orders are out; do not authorize again.",
        );
      }
      if (stampError) {
        notes.push(
          "The Ready Board and Vehicle File could not be marked as dispatched. Do NOT use Accept & Dispatch there — it would send everything a second time.",
        );
      }
      if (release.error) {
        notes.push(
          "Some documents could not be released to the Print Center. The authorization stands — release them from the document list there.",
        );
      }
      if (notes.length) {
        return { ok: false, error: notes.join(" "), errorDetail: stampError ?? release.error ?? snapshotError ?? undefined, outcome };
      }
      return { ok: true, outcome };
    } catch (e) {
      const raw = (e as Error)?.message || "Dispatch failed.";
      console.error("[useCommandCenter] dispatch failed:", raw);
      return { ok: false, error: "The dispatch could not be completed. Check the VIN timeline before authorizing again.", errorDetail: raw };
    } finally {
      dispatching.current = false;
    }
  }, [tenantId, vehicleId, actorId, dataRef, writeEvent, reload]);

  return {
    data, loading, error, errorDetail, notFound, noTenant, degraded, reload,
    saveManagerNote, toggleChecklist, authorizeAndDispatch,
    setDeliveryTarget, setPriority, decideServiceRequest,
  };
}

// ── screen 3: Documents & Print Center ───────────────────────────────

const toneFromMeta = (tone: string): Tone => (tone === "rose" ? "red" : (tone as Tone));

async function loadPrintCenter(r: SourceReader, tenantId: string, vehicleId: string): Promise<PrintCenterData> {
  const v = await fetchVehicleRow(tenantId, vehicleId);
  const vehicle = toCommandVehicle(v);
  const vin = vehicle.vin;
  const vk = vinKeys(vin);

  const [allDocs, qrCodes, qrTokens, signedInspections, latestInspections] = await Promise.all([
    r.rows(sb().from("generated_documents")
      .select("id, tenant_id, vehicle_id, template_id, document_type, document_status, version, pdf_url, png_url, online_url, print_count, printed_at, published_at, created_at")
      .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
      .order("version", { ascending: false }), "generated_documents"),
    r.rows(sb().from("qr_codes").select("*").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId), "qr_codes"),
    // Asked exactly as screen 1 asks it, so the physical QR media cannot be one
    // count here and another there.
    r.rows(sb().from("dept_signoff_tokens")
      .select("id, department, purpose, status, expires_at, created_at")
      .eq("tenant_id", tenantId).in("vin", vk)
      .eq("department", "vehicle").eq("purpose", "get_ready")
      .order("created_at", { ascending: false }).limit(5), "dept_signoff_tokens"),
    // Both halves of the K-208 question, asked exactly as screen 1 asks them,
    // so the bundle note and the package row cannot disagree about the same car.
    r.rows(sb().from("safety_inspections")
      .select("id, status, result, signed_at, created_at")
      .eq("tenant_id", tenantId).in("vin", vk)
      .eq("status", "signed")
      .order("signed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1), "safety_inspections(signed)"),
    r.rows(sb().from("safety_inspections")
      .select("id, status, result, signed_at, created_at")
      .eq("tenant_id", tenantId).in("vin", vk)
      .neq("status", "voided")
      .order("created_at", { ascending: false }).limit(1), "safety_inspections"),
  ]);

  // Superseded and archived rows are retired paper, not part of the package.
  // 20260724000000 mass-superseded the duplicate drafts every nightly sync had
  // piled up, so leaving them in flooded the table and reported each of them as
  // one more "Blocked" document on the stat card.
  const docs = liveDocuments(allDocs);

  const k208 = k208State({
    latestSigned: (signedInspections[0] as SafetyInspectionRow | undefined) || null,
    latest: (latestInspections[0] as SafetyInspectionRow | undefined) || null,
  });

  // "Current" is the highest live version within each document type.
  const currentByType = currentVersionByType(allDocs);

  // Every row carries the state its pills were derived from, so the stat cards,
  // the Passport Preview and the packet button are counted from the states
  // rather than re-matched against the display strings.
  const rows: { row: DocRow; visibility: PassportVisibilityState; onPaper: boolean; blocked: boolean }[] = [];

  for (const d of docs) {
    const status = String(d.document_status) as DocumentStatus;
    const meta = STATUS_META[status] || { label: humanize(String(d.document_status)), tone: "slate" as const };
    // Customer visibility is the document's lifecycle AND the vehicle's own —
    // there is no shopper for a car whose listing is not published.
    const visibility = passportVisibilityState(d, v);
    // The Print Status pill, the Ready/Blocked stat cards, the bundle lines and
    // the packet button all read the same predicate, so the rail cannot promise
    // a sheet the button does not put on paper.
    const printState = printReleaseState(d);

    // Row actions, derived from the same state as the pill so the offer and
    // the pill cannot disagree. Generate covers exactly the forms
    // generate-vehicle-forms can fill (buyers_guide, k208); every other
    // file-less row states why it has no button.
    const docType = String(d.document_type || "");
    const canGenerate = printState === "no_file" && (docType === "buyers_guide" || docType === "k208");

    rows.push({
      visibility,
      onPaper: printSheetIncludes(d),
      blocked: PRINT_STATE_PILL[printState].label === "Blocked",
      row: {
        id: String(d.id),
        label: documentLabel(d.document_type as string | null),
        kind: "doc",
        version: `v${d.version ?? 1}`,
        isCurrent: currentByType.get(String(d.document_type)) === Number(d.version ?? 1),
        internalStatus: { label: meta.label, tone: toneFromMeta(meta.tone) },
        passportVisibility: PASSPORT_VISIBILITY_PILL[visibility],
        printStatus: PRINT_STATE_PILL[printState],
        href: d.pdf_url || d.online_url || undefined,
        reprintCopy: reprintable(d) ? reprintCopyNumber(d) : undefined,
        generateKind: canGenerate ? (docType as "buyers_guide" | "k208") : undefined,
        generateBlockedReason: printState === "no_file" && !canGenerate
          ? "This document is not filled by the forms service — regenerate it from its own studio."
          : undefined,
      },
    });
  }

  // A QR cling is media pointing AT the packet, not a document served IN it:
  // get_published_documents_public reads generated_documents only, so no QR row
  // is ever on a Passport. Giving them a visibility pill counted physical media
  // as customer-visible documents and listed them in Passport Preview, and
  // "Published" is a generated_documents word qr_codes has no state for.
  for (const q of qrCodes) {
    const active = q.is_active !== false;
    const surface = String(q.surface || q.sticker_type || "");
    rows.push({
      visibility: "not_in_passport",
      onPaper: false,
      blocked: false,
      row: {
        id: String(q.id),
        label: q.label ? String(q.label) : surface ? `${humanize(surface)} QR` : "Vehicle QR",
        kind: "qr",
        version: "v1",
        isCurrent: active,
        internalStatus: active ? { label: "Active", tone: "emerald" } : { label: "Archived", tone: "slate" },
        passportVisibility: PASSPORT_VISIBILITY_PILL.not_in_passport,
        printStatus: { label: "Digital", tone: "blue" },
        href: q.target_url || q.destination_url || (q.token ? `/q/${q.token}` : undefined),
      },
    });
  }

  const documents = rows.map((x) => x.row);

  const counts = {
    ready: rows.filter((x) => x.onPaper).length,
    blocked: rows.filter((x) => x.blocked).length,
    customerVisible: rows.filter((x) => isCustomerVisible(x.visibility)).length,
    // Exactly the documents wearing the "Internal Only" pill. Counting every
    // non-customer-visible document put the `vehicle_unpublished` rows in here
    // too — they wear "Vehicle Not Published" — so the card could read
    // "Internal Only 1" with zero rows carrying that pill. A new pill state was
    // added without reconciling the counter it feeds.
    internalOnly: rows.filter((x) => x.visibility === "internal_only").length,
  };

  // The three PAPER lines partition the documents the packet button puts on
  // paper, counted with the same predicate the button filters on, so their sum
  // is exactly counts.ready. The QR cling and the key tag are physical media
  // printCompletePacket never touches — they live in qr_codes and
  // zebra_print_jobs — so they are flagged rather than added to that sum.
  const sheetDocs = docs.filter(printSheetIncludes);
  const windowDocs = sheetDocs.filter((d) => String(d.document_type) === "window").length;
  const addendumDocs = sheetDocs.filter((d) => String(d.document_type) === "addendum").length;
  const letterDocs = sheetDocs.length - windowDocs - addendumDocs;
  const k208Docs = docs.filter((d) => String(d.document_type) === "k208");
  // One vehicle QR sheet, two cut-outs: the rear-glass cling and the key-fob
  // tag, both printed from ONE dept_signoff_tokens row. Counting active
  // qr_codes rows instead reported "3 items" of physical cling for one vehicle,
  // because a window, an addendum and a passport sticker each carry their own
  // tracking code — none of which is a cling.
  const qrSheet = vehicleQrInBundle(qrTokens) ? 1 : 0;
  const bundle = [
    { label: "Letter Paper", count: letterDocs, unit: letterDocs === 1 ? "doc" : "docs", releasedByPacket: true },
    { label: "Window Sticker Stock", count: windowDocs, unit: windowDocs === 1 ? "doc" : "docs", releasedByPacket: true },
    { label: "Addendum Label", count: addendumDocs, unit: addendumDocs === 1 ? "doc" : "docs", releasedByPacket: true },
    { label: "4×4 QR Cling", count: qrSheet, unit: "item", releasedByPacket: false },
    { label: "Key Tag", count: qrSheet, unit: "item", releasedByPacket: false },
  ];
  const bundleNote = bundleNoteFor({
    used: isUsed(vehicle.condition),
    signedInspection: k208.state === "signed",
    k208Docs,
  });
  const packetBlockedReason = sheetDocs.length === 0 ? printBlockedReason(docs) : null;

  const passportPreview = rows
    .filter((x) => isCustomerVisible(x.visibility))
    .map((x) => ({ label: x.row.label, version: x.row.version }));

  return {
    vehicle, counts, documents, bundle, bundleNote, packetBlockedReason, passportPreview,
    passportHref: passportHrefFor(v),
  };
}

export function usePrintCenter(vehicleId?: string): Result<PrintCenterData> & {
  printCompletePacket(): Promise<MutationResult>;
  printByStock(): Promise<MutationResult>;
  /** Put an already-released document back on paper as copy N — no status transition. */
  reprintDocument(docId: string): Promise<MutationResult>;
  /** Rebuild a missing form file through generate-vehicle-forms. */
  generateDocument(docId: string): Promise<MutationResult>;
} {
  const { data, dataRef, loading, error, errorDetail, notFound, noTenant, degraded, reload, tenantId, actorId } =
    useLoader<PrintCenterData>(vehicleId, loadPrintCenter);

  // Puts the packet on paper, then records that it went.
  //
  // Two different sets, on purpose. What goes ON THE SHEET is
  // printSheetIncludes() — the same predicate the bundle counts, the Print
  // Status pills and the Ready stat card are built from — which includes the
  // published K-208 that 20260724010000 auto-publishes on every used car.
  // What gets STAMPED is printReleasable(), a strict subset: mark_printed from
  // `published` would rewrite the status and pull the document off the Passport.
  //
  // The lifecycle stamp is NOT the print. printed_at / print_count are the
  // evidence a regulator reads as what was posted on the car, and `printed` has
  // no mark_printed transition, so a false stamp is permanent. Opening a window
  // is not printing: nothing is stamped until a human confirms in the sheet that
  // the packet is on paper.
  const printing = useRef(false);
  // A release in flight when the screen unmounts must not keep the guard, the
  // poll interval and the message listener alive for the rest of the session.
  const activeSheet = useRef<PacketPrintHandle | null>(null);
  useEffect(() => () => { activeSheet.current?.cancel(); }, []);
  const printCompletePacket = useCallback(async (): Promise<MutationResult> => {
    if (!tenantId || !vehicleId) return { ok: false, error: "No dealership or vehicle in context." };
    if (printing.current) return { ok: false, error: "A packet release is already in progress." };
    // Opened before the first await so the browser still counts the click as
    // user activation; closed again on every path that does not print.
    const sheet = typeof window !== "undefined" ? window.open("", "_blank") : null;
    const abandon = <T,>(result: T): T => { try { sheet?.close(); } catch { /* already gone */ } return result; };
    printing.current = true;
    try {
      // Read directly rather than through the source reader: that helper
      // degrades the error to [], which would tell the employee no document
      // exists when the truth is that the read was denied or the network dropped.
      const { data: docRows, error: readErr } = await sb().from("generated_documents")
        .select("id, tenant_id, vehicle_id, template_id, document_type, document_status, version, pdf_url, png_url, online_url, print_count, printed_at")
        .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId);
      if (readErr) {
        const detail = readErr.message || String(readErr);
        console.error("[useCommandCenter] packet read failed:", detail);
        return abandon({ ok: false, error: "Could not read this vehicle's documents, so nothing was printed. Retry in a moment.", errorDetail: detail });
      }
      const docs = liveDocuments((docRows as Row[]) || []);
      const onSheet = docs.filter(printSheetIncludes);
      if (onSheet.length === 0) return abandon({ ok: false, error: printBlockedReason(docs) });

      const current = dataRef.current;
      const opened = openPacketPrintSheet(
        sheet,
        {
          ymm: current?.vehicle.ymm || "",
          vin: current?.vehicle.vin || "",
          stockNumber: current?.vehicle.stockNumber ?? null,
        },
        onSheet.map((d) => ({
          id: String(d.id),
          label: documentLabel(d.document_type as string | null),
          version: `v${d.version ?? 1}`,
          url: String(d.pdf_url || d.png_url || ""),
          // The unexecuted K-208 goes on the paper only as a labelled working
          // copy — the label travels with the sheet, not just the screen.
          note: printSheetNoteFor(d),
        })),
      );
      // Three causes, three things for the employee to do. They used to share
      // one sentence about pop-ups, which is advice for exactly one of them.
      if (!opened.ok) {
        return abandon({
          ok: false,
          error:
            opened.reason === "window_blocked"
              ? "The print window could not be opened, so nothing was marked printed. Allow pop-ups for this site, then release the packet again."
              : opened.reason === "window_unwritable"
              ? "This browser would not let AutoLabels write the print sheet, so nothing was marked printed. Try again in a normal (non-private) window."
              : "None of this vehicle's documents has a web address a printer can open, so nothing was marked printed. Regenerate them from the document list.",
        });
      }
      const handle = opened.handle;
      activeSheet.current = handle;

      // Nothing is filed until the sheet reports back. Closing the tab, leaving
      // it open, or navigating away all leave the documents exactly as they
      // were: a reprint is impossible once print_count is stamped.
      const outcome = await handle.printed;
      if (outcome !== "printed") {
        return {
          ok: false,
          error: outcome === "abandoned"
            ? "The print sheet was left open without a confirmation, so no print record was filed. Nothing changed — release the packet again when you are at the printer."
            : "The packet was not confirmed as printed, so no print record was filed. Nothing changed.",
        };
      }

      // The stamped set is the set that REACHED THE PAPER — handle.documents,
      // after the URL allowlist — narrowed to the documents mark_printed is a
      // legal transition for. Filtering `onSheet` here instead stamped documents
      // the sheet had already dropped, permanently, because allowedActions
      // ("printed") has no mark_printed.
      const onPaper = new Set(handle.documents.map((d) => d.id));
      const eligible = onSheet.filter((d) => onPaper.has(String(d.id)) && printReleasable(d));
      const releasedIds: string[] = [];
      const failures: string[] = [];
      let stale = 0;
      for (const d of eligible) {
        const res = await transitionDocument({
          doc: d as unknown as GeneratedDocument,
          action: "mark_printed",
          actorId,
          reason: "print_complete_packet",
          // The rows were read before an unbounded human wait. Write only while
          // the row is still what was read.
          expectedStatus: String(d.document_status) as DocumentStatus,
        });
        if (res.ok) releasedIds.push(String(d.id));
        else if (res.error === "stale_status") stale += 1;
        else failures.push(res.error || "transition_failed");
      }
      if (stale > 0 && releasedIds.length === 0) {
        const message = "These documents were replaced while the packet was printing, so no print record was filed against them. Reload and print the current versions.";
        handle.acknowledge({ ok: false, detail: message });
        await reload();
        return { ok: false, error: message };
      }
      if (eligible.length > 0 && releasedIds.length === 0) {
        console.error("[useCommandCenter] packet release failed:", failures[0]);
        const message = "The packet printed, but no document could be marked printed. Retry, then check the document list.";
        handle.acknowledge({ ok: false, detail: message });
        return { ok: false, error: message, errorDetail: failures[0] };
      }
      // The ledger records only the documents that actually moved: listing the
      // whole eligible set would file a print record for sheets nobody released.
      const { error: ledgerErr } = await sb().from("document_lifecycle_events").insert({
        tenant_id: tenantId, vehicle_id: vehicleId,
        vin: current?.vehicle.vin || null, stock: current?.vehicle.stockNumber || null,
        event_type: EVT_PACKET_PRINTED, occurred_at: new Date().toISOString(),
        actor_id: actorId, source: "documents-print-center",
        metadata: {
          document_ids: releasedIds, released: releasedIds.length,
          failed: failures.length, stale, on_sheet: handle.documents.length,
        },
      });
      await reload();
      // Both halves of a partial run are reported. Returning on `failures`
      // first meant a run that BOTH missed a document and failed to write the
      // ledger reported only the document.
      const partial = failures.length || stale
        ? `${releasedIds.length} of ${eligible.length} documents were released.${failures.length ? ` ${failures.length} could not be — retry, then check the document list.` : ""}${stale ? ` ${stale} had already been replaced and were left alone.` : ""}`
        : null;
      const ledgerNote = ledgerErr
        ? "The print record could not be saved — note the time before printing again."
        : null;
      if (ledgerErr) console.error("[useCommandCenter] print ledger insert failed:", ledgerErr.message || ledgerErr);
      if (partial || ledgerNote) {
        if (partial) console.error("[useCommandCenter] partial packet release:", failures[0] || "stale");
        const message = [partial, ledgerNote].filter(Boolean).join(" ");
        handle.acknowledge({ ok: false, detail: message });
        return { ok: false, error: message, errorDetail: failures[0] || ledgerErr?.message || undefined };
      }
      handle.acknowledge({ ok: true });
      return { ok: true };
    } finally {
      printing.current = false;
      activeSheet.current = null;
    }
  }, [tenantId, vehicleId, actorId, dataRef, reload]);

  // A reprint is the SAME released document going back on paper. It follows the
  // packet's human-confirmation pattern exactly — nothing is recorded until a
  // person confirms the paper — and then it increments print_count ONLY.
  // document_status and printed_at are the record of the FIRST release;
  // rewriting either would rewrite the evidence a regulator reads.
  const reprintDocument = useCallback(async (docId: string): Promise<MutationResult> => {
    if (!tenantId || !vehicleId) return { ok: false, error: "No dealership or vehicle in context." };
    if (printing.current) return { ok: false, error: "A print job is already running." };
    const sheet = typeof window !== "undefined" ? window.open("", "_blank") : null;
    const abandon = <T,>(result: T): T => { try { sheet?.close(); } catch { /* already gone */ } return result; };
    printing.current = true;
    try {
      const { data: docRows, error: readErr } = await sb().from("generated_documents")
        .select("id, tenant_id, vehicle_id, template_id, document_type, document_status, version, pdf_url, png_url, online_url, print_count, printed_at")
        .eq("tenant_id", tenantId).eq("id", docId).limit(1);
      if (readErr) {
        const detail = readErr.message || String(readErr);
        console.error("[useCommandCenter] reprint read failed:", detail);
        return abandon({ ok: false, error: "Could not read this document, so nothing was printed. Retry in a moment.", errorDetail: detail });
      }
      const doc = ((docRows as Row[] | null) || [])[0] || null;
      if (!doc) return abandon({ ok: false, error: "This document no longer exists. Reload the page." });
      if (!reprintable(doc)) {
        return abandon({
          ok: false,
          error: printReleaseState(doc) === "already_printed"
            ? "This document's file is missing, so a copy cannot be printed. Regenerate it first."
            : "This document has not been printed yet — release it with the packet first.",
        });
      }
      const copy = reprintCopyNumber(doc);
      const current = dataRef.current;
      const opened = openPacketPrintSheet(
        sheet,
        {
          ymm: current?.vehicle.ymm || "",
          vin: current?.vehicle.vin || "",
          stockNumber: current?.vehicle.stockNumber ?? null,
        },
        [{
          id: String(doc.id),
          label: documentLabel(doc.document_type as string | null),
          version: `v${doc.version ?? 1}`,
          url: String(doc.pdf_url || doc.png_url || ""),
          note: `Copy ${copy}`,
        }],
      );
      if (!opened.ok) {
        return abandon({
          ok: false,
          error: opened.reason === "window_blocked"
            ? "The print window could not be opened, so no copy was recorded. Allow pop-ups for this site, then reprint."
            : opened.reason === "window_unwritable"
              ? "This browser would not let AutoLabels write the print sheet, so no copy was recorded. Try again in a normal (non-private) window."
              : "This document has no web address a printer can open, so no copy was recorded. Regenerate it first.",
        });
      }
      const handle = opened.handle;
      activeSheet.current = handle;
      const outcome = await handle.printed;
      if (outcome !== "printed") {
        return {
          ok: false,
          error: "The copy was not confirmed as printed, so nothing was recorded. Reprint when you are at the printer.",
        };
      }
      // Compare-and-set on the copy count so two tabs reprinting at once
      // record two copies, not one count written twice.
      const priorCount = doc.print_count;
      let q = sb().from("generated_documents")
        .update({ print_count: Number(priorCount || 0) + 1 })
        .eq("id", docId);
      q = priorCount == null ? q.is("print_count", null) : q.eq("print_count", priorCount);
      const { data: updated, error: updErr } = await q.select("id");
      if (updErr) {
        const detail = updErr.message || String(updErr);
        console.error("[useCommandCenter] reprint count failed:", detail);
        const message = "The copy printed, but the copy count could not be recorded. Note the time and tell your manager.";
        handle.acknowledge({ ok: false, detail: message });
        return { ok: false, error: message, errorDetail: detail };
      }
      if (!Array.isArray(updated) || updated.length === 0) {
        const message = "The copy count changed while you were printing, so this copy was not recorded. Reload and check the document row.";
        handle.acknowledge({ ok: false, detail: message });
        await reload();
        return { ok: false, error: message };
      }
      const { error: ledgerErr } = await sb().from("document_lifecycle_events").insert({
        tenant_id: tenantId, vehicle_id: vehicleId,
        vin: current?.vehicle.vin || null, stock: current?.vehicle.stockNumber || null,
        event_type: EVT_REPRINTED, occurred_at: new Date().toISOString(),
        actor_id: actorId, source: "documents-print-center",
        metadata: { document_id: String(doc.id), copy },
      });
      if (ledgerErr) console.error("[useCommandCenter] reprint ledger failed:", ledgerErr.message || ledgerErr);
      await reload();
      if (ledgerErr) {
        const message = "The copy was recorded, but the reprint could not be added to the VIN timeline.";
        handle.acknowledge({ ok: false, detail: message });
        return { ok: false, error: message, errorDetail: ledgerErr.message || String(ledgerErr) };
      }
      handle.acknowledge({ ok: true });
      return { ok: true };
    } finally {
      printing.current = false;
      activeSheet.current = null;
    }
  }, [tenantId, vehicleId, actorId, dataRef, reload]);

  // Rebuild a missing form file — the same generate-vehicle-forms invoke the
  // Vehicle File's DealFlowPanel uses, scoped to this one document's kind.
  const generating = useRef(false);
  const generateDocument = useCallback(async (docId: string): Promise<MutationResult> => {
    if (!tenantId || !vehicleId) return { ok: false, error: "No dealership or vehicle in context." };
    const current = dataRef.current;
    if (!current?.vehicle.vin) return { ok: false, error: "This vehicle has no VIN, so its forms cannot be filled." };
    if (generating.current) return { ok: false, error: "A form is already being generated." };
    const row = current.documents.find((d) => d.id === docId);
    if (!row) return { ok: false, error: "This document no longer exists. Reload the page." };
    if (!row.generateKind) {
      return { ok: false, error: row.generateBlockedReason || "This document does not need regenerating." };
    }
    generating.current = true;
    try {
      const res = await sb().functions.invoke("generate-vehicle-forms", {
        body: {
          tenant_id: tenantId, vin: current.vehicle.vin, kinds: [row.generateKind],
          app_base: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });
      const payload = (res?.data || {}) as Row;
      if (res?.error || payload.ok !== true) {
        const detail = res?.error?.message || String(payload.error || "generate failed");
        console.error("[useCommandCenter] form generate failed:", detail);
        return { ok: false, error: "The form could not be generated. Nothing changed — retry in a moment.", errorDetail: detail };
      }
      await reload();
      return { ok: true };
    } finally {
      generating.current = false;
    }
  }, [tenantId, vehicleId, dataRef, reload]);

  // Queues a real stock-number label into public.zebra_print_jobs — the same
  // queue useZebraPrint writes, using the same ZPL builder.
  const printByStock = useCallback(async (): Promise<MutationResult> => {
    const current = dataRef.current;
    if (!tenantId || !current) return { ok: false, error: "No dealership or vehicle in context." };
    const stock = current.vehicle.stockNumber;
    if (!stock) return { ok: false, error: "This vehicle has no stock number, so a stock label cannot be printed." };
    if (!current.vehicle.vin) return { ok: false, error: "This vehicle has no VIN, so a stock label cannot be printed." };
    const { error: err } = await sb().from("zebra_print_jobs").insert({
      tenant_id: tenantId,
      vin: vinKey(current.vehicle.vin),
      stock_number: stock,
      ymm: current.vehicle.ymm,
      label_type: "stock_number",
      printer_name: "Default",
      status: "queued",
      zpl_content: generateZpl(stock, current.vehicle.vin, current.vehicle.ymm, "stock_number"),
    });
    if (err) {
      const detail = err.message || String(err);
      console.error("[useCommandCenter] stock label queue failed:", detail);
      return { ok: false, error: "Could not queue the stock label. Nothing was sent to the printer — retry in a moment.", errorDetail: detail };
    }
    await reload();
    return { ok: true };
  }, [tenantId, dataRef, reload]);

  return { data, loading, error, errorDetail, notFound, noTenant, degraded, reload, printCompletePacket, printByStock, reprintDocument, generateDocument };
}
