import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
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
import { packetVisible } from "@/lib/packetModules";
import { realTenantId } from "@/lib/tenant/realTenantId";
import {
  bundleNoteFor,
  printBlockedReason,
  printReleasable,
  printReleaseState,
  PRINT_STATE_PILL,
} from "@/lib/commandCenter/printRelease";
import {
  columnFor,
  getReadyStep,
  isThirdPartyItem,
  sumItemCosts,
} from "@/lib/commandCenter/getReadyColumns";
import {
  PASSPORT_VISIBILITY_PILL,
  passportModuleFor,
  passportVisibilityState,
} from "@/lib/commandCenter/passportVisibility";
import {
  currentDocumentOfType,
  currentVersionByType,
  isRetiredDocument,
  liveDocuments,
} from "@/lib/commandCenter/documentSet";
import { k208State, type SafetyInspectionRow } from "@/lib/commandCenter/inspectionState";
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
import { openPacketPrintSheet } from "@/lib/commandCenter/packetPrintSheet";
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

export type { PackageItemStatus };

export interface PackageItem {
  key: string; label: string; status: PackageItemStatus;
  detail: string; href?: string; docId?: string;
}

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

export interface GetReadyCommandData {
  vehicle: CommandVehicle;
  deliveryTarget: string | null;
  priority: "high" | "normal" | "low" | null;
  columns: GetReadyColumn[];
  summary: { workItems: number; departments: number;
             estimatedTotal: number | null; needAttention: number };
  checklist: { key: string; label: string; done: boolean }[];
  canAuthorize: boolean;
  /** Why `canAuthorize` is false, phrased for the manager. Null when it is true. */
  authorizeBlockedReason: string | null;
  /** When Get Ready was authorized/dispatched for this vehicle, by any screen. */
  authorizedAt: string | null;
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

// VIN case is not guaranteed at rest: dms-webhook and autocurb-sync write the
// provider's string verbatim into vehicle_listings, while every in-app writer
// (StartGetReadyModal, the addendum vehicle strip, useWorkEvents) uppercases.
// Keying VIN-scoped reads off the raw listing value therefore missed the very
// get-ready / inspection / addendum rows the screen is about. Only the query key
// is normalised; the displayed VIN stays exactly as the vehicle stores it.
const vinKey = (vin: string): string => vin.trim().toUpperCase();

// Both spellings, for the tables whose writer is not under our control.
const vinKeys = (vin: string): string[] =>
  Array.from(new Set([vin, vinKey(vin)].filter(Boolean)));

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
  };
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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

const DOC_TYPE_LABEL: Record<string, string> = {
  window: "Window Sticker",
  addendum: "Addendum",
  passport: "Vehicle Passport",
  cpo_sheet: "CPO Sheet",
  buyers_guide: "FTC Buyers Guide",
  // generated_documents accepts 'k208' since 20260722180000_k208_ingest_forms_flow.
  k208: "CT K-208 Safety Inspection",
};

const humanize = (s: string) =>
  s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

// generated_documents lifecycle → package-item status. Nothing here invents a
// state: an absent row is "pending / Not started".
function docPackageStatus(d: Row | null): { status: PackageItemStatus; detail: string } {
  if (!d) return { status: "pending", detail: "Not started" };
  const s = String(d.document_status || "");
  const v = `v${d.version ?? 1}`;
  switch (s) {
    case "published": return { status: "published", detail: `${v} published ${fmtDate(d.published_at)}`.trim() };
    case "printed": return { status: "ready", detail: `${v} printed ${fmtDate(d.printed_at)}`.trim() };
    case "approved": return { status: "ready", detail: `${v} approved` };
    case "pending_approval": return { status: "created", detail: `${v} awaiting approval` };
    case "draft": return { status: "draft_created", detail: `${v} draft created` };
    case "rejected": return { status: "retry_required", detail: d.rejection_reason ? `Rejected: ${d.rejection_reason}` : `${v} rejected — regenerate` };
    case "superseded": return { status: "pending", detail: `${v} superseded` };
    case "archived": return { status: "pending", detail: `${v} archived` };
    default: return { status: "pending", detail: s ? humanize(s) : "Not started" };
  }
}

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

// ── screen 1: VIN Command Center ─────────────────────────────────────

async function loadVinCommand(r: SourceReader, tenantId: string, vehicleId: string): Promise<VinCommand> {
  const v = await fetchVehicleRow(tenantId, vehicleId);
  const vehicle = toCommandVehicle(v);
  const vin = vehicle.vin;
  const vk = vinKeys(vin);
  const used = isUsed(vehicle.condition);

  const [allDocs, inspections, signedInspections, addendums, grRecords, descCase, qrCodes, zebraJobs, recallTasks, auditRows, authorization] =
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
      // The executed K-208 is asked for by its own bounded query, not found by
      // paging recent rows: re-inspections are first class, so the newest row is
      // routinely a pending revision that used to mask the signed original.
      r.rows(sb().from("safety_inspections")
        .select("id, status, result, signed_at, created_at")
        .eq("tenant_id", tenantId).in("vin", vk)
        .eq("status", "signed")
        .or("result.is.null,result.neq.fail")
        .order("signed_at", { ascending: false, nullsFirst: false })
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
      r.rows(sb().from("qr_codes").select("*").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId), "qr_codes"),
      r.rows(sb().from("zebra_print_jobs")
        .select("id, label_type, status, created_at")
        .eq("tenant_id", tenantId).in("vin", vk)
        .order("created_at", { ascending: false }), "zebra_print_jobs"),
      r.rows(sb().from("recall_service_tasks")
        .select("id, status, outcome, open_recall_count, completed_at")
        .eq("tenant_id", tenantId).eq("vehicle_listing_id", vehicleId)
        .order("created_at", { ascending: false }).limit(5), "recall_service_tasks"),
      r.rows(sb().from("audit_log")
        .select("action, entity_type, entity_id, created_at, details")
        .eq("store_id", tenantId).in("entity_id", [vehicleId, ...vk].filter(Boolean))
        .order("created_at", { ascending: false }).limit(40), "audit_log"),
      getReadyAuthorization(r, tenantId, vehicleId, vin),
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
  const latestOfType = (type: string): Row | null => currentDocumentOfType(docs, type);

  const grRecord = grRecords[0] || null;
  const grItems: GetReadyItem[] = ((grRecord?.items as GetReadyItem[]) || []).filter(Boolean);
  const authorizedAt = authorization.at;
  const dispatched = !!authorizedAt;

  const items: PackageItem[] = [];

  // K-208 and the FTC Buyers Guide are used-car artifacts; including them for a
  // new car would report a permanently incomplete automation total.
  if (used) {
    const k208 = k208State({
      signed: (signedInspections[0] as SafetyInspectionRow | undefined) || null,
      latest: (inspections[0] as SafetyInspectionRow | undefined) || null,
    });
    const k208Item: { status: PackageItemStatus; detail: string } =
      k208.state === "failed" ? { status: "blocked", detail: "Inspection failed — vehicle cannot be listed" }
      : k208.state === "signed" ? { status: "ready", detail: `Signed ${fmtDate(k208.at)}`.trim() }
      : k208.state === "prefilled" ? { status: "prefilled", detail: "Prefilled, awaiting inspection" }
      : { status: "pending", detail: "Not started" };
    items.push({ key: "k208", label: "K-208", ...k208Item, href: vin ? `/k208/${vinKey(vin)}` : undefined });

    const bg = latestOfType("buyers_guide");
    const bgState = docPackageStatus(bg);
    items.push({
      key: "buyers_guide", label: "FTC Buyers Guide", ...bgState,
      href: bg?.pdf_url || `/vehicle-file/${vehicleId}?tab=documents`,
      docId: bg?.id,
    });
  }

  const add = addendums[0] || null;
  let addState: { status: PackageItemStatus; detail: string };
  if (!add) addState = { status: "pending", detail: "Not started" };
  else if (add.customer_signed_at) addState = { status: "published", detail: `Signed ${fmtDate(add.customer_signed_at)}` };
  else if (add.accepted_at) addState = { status: "ready", detail: `Accepted ${fmtDate(add.accepted_at)}` };
  else if (add.ready_at) addState = { status: "created", detail: `Ready ${fmtDate(add.ready_at)}` };
  else addState = { status: "draft_created", detail: `Draft created ${fmtDate(add.created_at)}` };
  items.push({
    key: "addendum", label: used ? "Used Addendum" : "Addendum", ...addState,
    href: `/vehicle-file/${vehicleId}?tab=addendum`, docId: add?.id,
  });

  const win = latestOfType("window");
  items.push({
    key: "window_sticker", label: used ? "Used-Car Sticker" : "Window Sticker",
    ...docPackageStatus(win),
    href: win?.pdf_url || `${used ? "/used-car-sticker" : "/new-car-sticker"}?vehicleId=${vehicleId}`,
    docId: win?.id,
  });

  const rc = (v.recall_check || {}) as Row;
  const recallCheckedAt: string | null = v.recall_checked_at || rc.checked_at || null;
  const openRecalls: number =
    typeof v.open_recall_count === "number" ? v.open_recall_count
    : typeof rc.open_recall_count === "number" ? rc.open_recall_count
    : Array.isArray(rc.recalls) ? rc.recalls.length : 0;
  const resolvedRecall = recallTasks.some((t) => t.status === "resolved");
  let recallState: { status: PackageItemStatus; detail: string };
  if (!recallCheckedAt) recallState = { status: "pending", detail: "Not started" };
  else if (rc.do_not_drive) recallState = { status: "blocked", detail: "Do-not-drive campaign open — publishing is blocked" };
  else if (openRecalls > 0 && !resolvedRecall) recallState = { status: "retry_required", detail: `${openRecalls} open recall${openRecalls === 1 ? "" : "s"} — service review required` };
  else if (openRecalls > 0) recallState = { status: "ready", detail: `Resolved by service ${fmtDate(recallTasks[0]?.completed_at)}`.trim() };
  else recallState = { status: "ready", detail: `Checked ${fmtDate(recallCheckedAt)} · no open recalls` };
  items.push({ key: "recall", label: "Recall Lookup", ...recallState, href: `/vehicle-file/${vehicleId}?tab=overview` });

  const activeQr = qrCodes.find((q) => q.is_active !== false) || qrCodes[0] || null;
  items.push({
    key: "service_qr", label: "Rear Service QR",
    status: activeQr ? "created" : "pending",
    detail: activeQr
      ? `Tracking QR active${activeQr.surface || activeQr.sticker_type ? ` · ${humanize(String(activeQr.surface || activeQr.sticker_type))}` : ""}`
      : "Not started",
    href: vin ? `/print/vehicle-qr/${vinKey(vin)}` : undefined,
  });

  const keyTagJobs = zebraJobs.filter((j) => j.label_type === "key_tag");
  const keyTagPrinted = keyTagJobs.find((j) => j.status === "printed");
  items.push({
    key: "key_tag_qr", label: "Key-Tag QR",
    status: keyTagJobs.length === 0 ? "pending" : keyTagPrinted ? "ready" : "created",
    detail: keyTagJobs.length === 0
      ? "Not started"
      : keyTagPrinted ? `Printed ${fmtDate(keyTagPrinted.created_at)}` : `Queued ${fmtDate(keyTagJobs[0].created_at)}`,
    href: vin ? `/print/vehicle-qr/${vinKey(vin)}` : undefined,
  });

  const svcItems = grItems.filter((i) => columnFor(i) === "service");
  const prepItems = grItems.filter((i) => columnFor(i) !== "service");
  const countDone = (list: GetReadyItem[]) => list.filter((i) => i.status === "complete").length;
  const grItemState = (list: GetReadyItem[], noneDetail: string): { status: PackageItemStatus; detail: string } => {
    if (!grRecord) return { status: "pending", detail: "Not started" };
    // A record with no line in this half has no outstanding work in it. Calling
    // that "pending" left a vehicle whose get-ready is all service work unable
    // to ever reach 100% or "Ready to Market".
    if (list.length === 0) return { status: "ready", detail: noneDetail };
    const done = countDone(list);
    if (done === list.length) return { status: "ready", detail: `${done} of ${list.length} complete` };
    return { status: dispatched ? "created" : "prefilled", detail: `${done} of ${list.length} complete` };
  };
  items.push({ key: "get_ready_service", label: "Service Get Ready", ...grItemState(svcItems, "No service work items"), href: `/get-ready-command/${vehicleId}` });
  items.push({ key: "get_ready_prep", label: "Prep & Vendors", ...grItemState(prepItems, "No prep or vendor work items"), href: `/get-ready-command/${vehicleId}` });

  let descState: { status: PackageItemStatus; detail: string };
  if (!descCase) descState = { status: "pending", detail: "Not started" };
  else {
    const s = String(descCase.status || "");
    const sectionDetail = descChannelCount > 0 ? `${descChannelCount} section${descChannelCount === 1 ? "" : "s"} generated` : "No sections generated yet";
    if (s === "PUBLISHED") descState = { status: "published", detail: sectionDetail };
    else if (s === "READY") descState = { status: "ready", detail: sectionDetail };
    else if (s === "REVIEW_REQUIRED") descState = { status: "retry_required", detail: `Review required · ${descCase.open_exception_count || 0} open exception${(descCase.open_exception_count || 0) === 1 ? "" : "s"}` };
    else if (s === "FAILED_BLOCKED") descState = { status: "blocked", detail: descCase.last_error_message ? String(descCase.last_error_message) : "Generation blocked" };
    else if (s === "FAILED_RETRYABLE") descState = { status: "retry_required", detail: "Generation failed — retry" };
    else if (s === "STALE") descState = { status: "retry_required", detail: "Source data changed — regenerate" };
    // ARCHIVED is a real CHECK value (20260725000000:67) and means the case was
    // retired — the else-branch below was counting it as an artifact that exists.
    else if (s === "ARCHIVED") descState = { status: "pending", detail: "Archived — no live description" };
    else if (s === "PARTIALLY_PUBLISHED") descState = { status: "created", detail: `Partially published · ${sectionDetail}` };
    else descState = { status: descChannelCount > 0 ? "created" : "pending", detail: descChannelCount > 0 ? sectionDetail : humanize(s || "not started") };
  }
  items.push({ key: "description", label: "Description", ...descState, href: `/description-intelligence/${vehicleId}` });

  // "Automation Complete" counts artifacts that are FINISHED. A draft sticker
  // and a prefilled K-208 exist, but neither is work anyone can stop doing.
  const automationDone = countFinished(items);
  const automationProduced = countProduced(items);
  const exceptions = countExceptions(items);
  const pendingGrItems = grItems.filter((i) => i.status !== "complete").length;
  const awaitingAuthorization = grRecord && !dispatched && pendingGrItems > 0 ? pendingGrItems : null;

  const publishedPassportDocs = docs.filter((d) => d.document_type === "passport" && d.document_status === "published").length;
  const passportPublished = publishedPassportDocs || (v.status === "published" && v.slug ? 1 : 0);

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
    timeline,
  };
}

export function useVinCommand(vehicleId?: string): Result<VinCommand> {
  const { data, loading, error, errorDetail, notFound, noTenant, degraded, reload } =
    useLoader<VinCommand>(vehicleId, loadVinCommand);
  return { data, loading, error, errorDetail, notFound, noTenant, degraded, reload };
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

async function loadGetReadyCommand(r: SourceReader, tenantId: string, vehicleId: string): Promise<GetReadyCommandData> {
  const v = await fetchVehicleRow(tenantId, vehicleId);
  const vehicle = toCommandVehicle(v);
  const vin = vehicle.vin;
  const vk = vinKeys(vin);

  // Notes and the checklist are read on their own event_type filters so that
  // neither can crowd the other out of a shared page, and the authorization
  // marker is a separate bounded existence check (see getReadyAuthorization).
  const [grRecords, noteEvents, checklistEvents, authorization, detailSignoffs, pdiSignoffs] = await Promise.all([
    r.rows(sb().from("get_ready_records")
      .select("id, items, status, get_ready_start_date, get_ready_complete_date, inspection_complete, assigned_technician, ro_number")
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

  const proofClock = authorizedAt || grRecord?.get_ready_start_date || null;
  // Proof is per vendor: one vendor uploading photos says nothing about the
  // others, so match each line against the companies that actually signed off.
  const provenVendors = new Set<string>();
  for (const s of detailSignoffs) {
    const name = String(s.provider_company || "").trim().toLowerCase();
    if (!name) continue;
    if (s.status === "signed" && Array.isArray(s.photos) && s.photos.length > 0) provenVendors.add(name);
  }

  const columns: GetReadyColumn[] = (["service", "prep", "vendor"] as const).map((key) => {
    const list = grItems.filter((i) => columnFor(i) === key);
    const mapped = list.map((i) => {
      // Third-party lines stay "Pending Proof" until THAT vendor uploads proof.
      // Derived from the row, never from the column it is displayed in.
      const isThirdParty = isThirdPartyItem(i);
      const vendorKey = (i.vendorName || "").trim().toLowerCase();
      const proven = !!vendorKey && provenVendors.has(vendorKey);
      const status: "complete" | "pending" | "pending_proof" =
        i.status === "complete" ? "complete"
        : isThirdParty && !proven ? "pending_proof"
        : "pending";
      return {
        id: i.id,
        label: i.label,
        sublabel: i.vendorName || undefined,
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

    const vendorMap = new Map<string, { name: string; category: string; email?: string | null }>();
    if (key === "vendor") {
      for (const i of list) {
        const name = (i.vendorName || "").trim();
        if (!name || !isThirdPartyItem(i)) continue;
        if (!vendorMap.has(name)) vendorMap.set(name, { name, category: humanize(i.category), email: i.vendorEmail || null });
      }
      for (const s of detailSignoffs) {
        const name = String(s.provider_company || "").trim();
        if (s.is_third_party && name && !vendorMap.has(name)) {
          vendorMap.set(name, { name, category: "Third-party detail", email: null });
        }
      }
    }

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
      vendors: key === "vendor" ? Array.from(vendorMap.values()) : undefined,
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
  // signed_at is NOT NULL DEFAULT now() (20260629130000:28), so `|| !!signed_at`
  // re-admitted every row the status test had just excluded — including a PDI
  // whose result is 'fail'. A failed pre-delivery inspection is not a sign-off.
  const pdiSigned = pdiSignoffs.some((p) => p.status === "signed" && p.result === "pass");
  if (pdiSigned) {
    const svc = columns.find((c) => c.key === "service");
    if (svc && svc.total > 0 && svc.completed === 0) {
      svc.headline = `${svc.completed} of ${svc.total} Completed · PDI signed`;
    }
  }

  return {
    vehicle,
    // get_ready_complete_date is the COMPLETION stamp — useGetReady writes it
    // only once every item is done, and serviceStatus reads it as "done". Every
    // in-progress vehicle therefore had a blank Delivery Target and every
    // finished one had a past date labelled as a forward commitment. No column,
    // JSONB key or setting in this schema carries a delivery target, so it is
    // reported as unknown rather than invented; the completion stamp keeps its
    // own name below.
    deliveryTarget: null,
    // No column, JSONB key, or setting in this schema carries a get-ready
    // priority, so it is reported as unknown rather than invented.
    priority: null,
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
    dispatchFailures: authorization.failures,
    completedAt: (grRecord?.get_ready_complete_date as string) ?? null,
    invoicedTotal,
    currentStep,
  };
}

export function useGetReadyCommand(vehicleId?: string): Result<GetReadyCommandData> & {
  saveManagerNote(columnKey: string, note: string): Promise<{ ok: boolean; error?: string }>;
  toggleChecklist(key: string, done: boolean): Promise<{ ok: boolean; error?: string }>;
  authorizeAndDispatch(): Promise<{ ok: boolean; error?: string }>;
} {
  const { data, dataRef, loading, error, errorDetail, notFound, noTenant, degraded, reload, tenantId, actorId } =
    useLoader<GetReadyCommandData>(vehicleId, loadGetReadyCommand);

  const writeEvent = useCallback(async (eventType: string, metadata: Row) => {
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
      console.error("[useCommandCenter] lifecycle write failed:", err.message || err);
      return { ok: false, error: "Could not save that change. Nothing was recorded — try again." };
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

  // Reuses the existing dispatch path (deriveGetReadyDispatch → notify-getready),
  // the same one ReadyBoard and the Vehicle File call on addendum acceptance.
  const dispatching = useRef(false);
  const authorizeAndDispatch = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!tenantId || !vehicleId) return { ok: false, error: "No dealership or vehicle in context." };
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
        return { ok: false, error: "Could not reach the Get-Ready dispatcher. Nothing was sent." };
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
      const failedTargets = dispatchedTargets.filter((t) => t.ok !== true).map((t) => String(t.dept || "recipient"));
      // A department with no email configured never becomes a target at all, so
      // it is absent from `dispatched` rather than present-and-failed.
      const attempted = new Set(dispatchedTargets.map((t) => String(t.dept || "")));
      const neverAttempted = depts.filter((d) => !attempted.has(d));
      if (vendors.length > 0 && !attempted.has("vendor")) neverAttempted.push("vendor");
      const failures = Array.from(new Set([...failedTargets, ...neverAttempted]));

      // The dispatch is the authorization: record it only after the server
      // confirmed at least one work order actually went out. If that record
      // fails the work orders are already out, so the caller must be told —
      // authorizing a second time would send them all again.
      const recorded = await writeEvent(EVT_AUTHORIZED, {
        dispatched: payload.dispatched ?? null, depts, vendors: vendors.length, failures,
      });
      // Stamp the marker the Ready Board and the Vehicle File read, so those
      // screens stop offering a dispatch that has already happened. This is NOT
      // best-effort: mark_addendum_getready_dispatched raises for a member whose
      // tenant_members.accepted_at is null (20260722140000:84-91), and when it
      // does the other surfaces never show "Get-Ready sent" — so the employee
      // clicks Accept & Dispatch there and every work order and vendor email
      // goes out a second time. Swallowing it caused the exact outcome the stamp
      // exists to prevent.
      const addn = await reader.oneRow(sb().from("addendums")
        .select("id")
        .eq("tenant_id", tenantId).in("vehicle_vin", vinKeys(vin))
        .neq("lifecycle_status", "archived")
        .is("getready_dispatched_at", null)
        .order("created_at", { ascending: false }).limit(1), "addendums(dispatch stamp)");
      let stampError: string | null = null;
      if (addn?.id) {
        const { error: stampErr } = await sb().rpc("mark_addendum_getready_dispatched", { _addendum_id: addn.id });
        if (stampErr) {
          stampError = stampErr.message || String(stampErr);
          console.error("[useCommandCenter] dispatch stamp failed:", stampError);
        }
      }
      await reload();
      if (!recorded.ok) {
        return {
          ok: false,
          error: `Work orders were dispatched, but the authorization could not be recorded: ${recorded.error || "unknown error"}. Do not authorize again — check the VIN timeline.`,
        };
      }
      if (failures.length) {
        return {
          ok: false,
          error: `Get Ready was authorized, but ${failures.join(" and ")} ${failures.length === 1 ? "was" : "were"} not reached. The authorization is recorded and cannot be repeated — send those work orders from the Ready Board.`,
        };
      }
      if (stampError) {
        return {
          ok: false,
          error: "Get Ready was authorized and the work orders went out, but the Ready Board and Vehicle File could not be marked as dispatched. Do NOT use Accept & Dispatch there — it would send everything a second time.",
        };
      }
      return { ok: true };
    } catch (e) {
      const raw = (e as Error)?.message || "Dispatch failed.";
      console.error("[useCommandCenter] dispatch failed:", raw);
      return { ok: false, error: "The dispatch could not be completed. Check the VIN timeline before authorizing again." };
    } finally {
      dispatching.current = false;
    }
  }, [tenantId, vehicleId, dataRef, writeEvent, reload]);

  return {
    data, loading, error, errorDetail, notFound, noTenant, degraded, reload,
    saveManagerNote, toggleChecklist, authorizeAndDispatch,
  };
}

// ── screen 3: Documents & Print Center ───────────────────────────────

const toneFromMeta = (tone: string): Tone => (tone === "rose" ? "red" : (tone as Tone));

async function loadPrintCenter(r: SourceReader, tenantId: string, vehicleId: string): Promise<PrintCenterData> {
  const v = await fetchVehicleRow(tenantId, vehicleId);
  const vehicle = toCommandVehicle(v);
  const vin = vehicle.vin;
  const vk = vinKeys(vin);

  const [allDocs, qrCodes, zebraJobs, signedInspections, latestInspections, dealerProfile] = await Promise.all([
    r.rows(sb().from("generated_documents")
      .select("id, tenant_id, vehicle_id, template_id, document_type, document_status, version, pdf_url, png_url, online_url, print_count, printed_at, published_at, created_at")
      .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
      .order("version", { ascending: false }), "generated_documents"),
    r.rows(sb().from("qr_codes").select("*").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId), "qr_codes"),
    r.rows(sb().from("zebra_print_jobs")
      .select("id, label_type, status, created_at")
      .eq("tenant_id", tenantId).in("vin", vk), "zebra_print_jobs"),
    // Both halves of the K-208 question, asked exactly as screen 1 asks them,
    // so the bundle note and the package row cannot disagree about the same car.
    r.rows(sb().from("safety_inspections")
      .select("id, status, result, signed_at, created_at")
      .eq("tenant_id", tenantId).in("vin", vk)
      .eq("status", "signed")
      .or("result.is.null,result.neq.fail")
      .order("signed_at", { ascending: false, nullsFirst: false })
      .limit(1), "safety_inspections(signed)"),
    r.rows(sb().from("safety_inspections")
      .select("id, status, result, signed_at, created_at")
      .eq("tenant_id", tenantId).in("vin", vk)
      .neq("status", "voided")
      .order("created_at", { ascending: false }).limit(1), "safety_inspections"),
    // The store-wide packet template is half of packetVisible()'s answer.
    // Passing only the per-vehicle overrides reported a module the dealer had
    // switched off store-wide as "Customer Visible" on this screen while the
    // Passport itself hid it.
    r.oneRow(sb().from("dealer_profiles")
      .select("settings").eq("tenant_id", tenantId).limit(1), "dealer_profiles"),
  ]);

  // Superseded and archived rows are retired paper, not part of the package.
  // 20260724000000 mass-superseded the duplicate drafts every nightly sync had
  // piled up, so leaving them in flooded the table and reported each of them as
  // one more "Blocked" document on the stat card.
  const docs = liveDocuments(allDocs);

  const k208 = k208State({
    signed: (signedInspections[0] as SafetyInspectionRow | undefined) || null,
    latest: (latestInspections[0] as SafetyInspectionRow | undefined) || null,
  });

  const packetSource = {
    packet_modules: (v.packet_modules || null) as Record<string, boolean> | null,
    packet_defaults: ((dealerProfile?.settings as Row | null)?.packet_module_defaults || null) as Record<string, boolean> | null,
  };

  // "Current" is the highest live version within each document type.
  const currentByType = currentVersionByType(allDocs);

  const documents: DocRow[] = [];

  for (const d of docs) {
    const status = String(d.document_status) as DocumentStatus;
    const meta = STATUS_META[status] || { label: humanize(String(d.document_status)), tone: "slate" as const };
    // Customer visibility is the document's own lifecycle AND the vehicle's
    // packet-module curation; a served doc inside a hidden module is "Hidden".
    const moduleOn = packetVisible(packetSource, passportModuleFor(d.document_type as string | null));
    const passportVisibility = PASSPORT_VISIBILITY_PILL[passportVisibilityState(d, moduleOn)];
    // The Print Status pill, the Ready/Blocked stat cards and the packet button
    // all read the same predicate, so the rail cannot promise a sheet the
    // button refuses to release.
    const printStatus = PRINT_STATE_PILL[printReleaseState(d)];

    documents.push({
      id: String(d.id),
      label: DOC_TYPE_LABEL[String(d.document_type)] || humanize(String(d.document_type)),
      kind: "doc",
      version: `v${d.version ?? 1}`,
      isCurrent: currentByType.get(String(d.document_type)) === Number(d.version ?? 1),
      internalStatus: { label: meta.label, tone: toneFromMeta(meta.tone) },
      passportVisibility,
      printStatus,
      href: d.pdf_url || d.online_url || undefined,
    });
  }

  // A QR cling points the customer at the packet, so it follows the same
  // visibility rule as every other row: live AND its packet module enabled.
  const qrModuleOn = packetVisible(packetSource, "documents");
  for (const q of qrCodes) {
    const active = q.is_active !== false;
    const surface = String(q.surface || q.sticker_type || "");
    const passportVisibility =
      PASSPORT_VISIBILITY_PILL[active ? (qrModuleOn ? "customer_visible" : "hidden") : "internal_only"];
    documents.push({
      id: String(q.id),
      label: q.label ? String(q.label) : surface ? `${humanize(surface)} QR` : "Vehicle QR",
      kind: "qr",
      version: "v1",
      isCurrent: active,
      internalStatus: active ? { label: "Published", tone: "violet" } : { label: "Archived", tone: "slate" },
      passportVisibility,
      printStatus: { label: "Digital", tone: "blue" },
      href: q.target_url || q.destination_url || (q.token ? `/q/${q.token}` : undefined),
    });
  }

  const counts = {
    ready: documents.filter((d) => d.printStatus.label === "Ready").length,
    blocked: documents.filter((d) => d.printStatus.label === "Blocked").length,
    customerVisible: documents.filter((d) => d.passportVisibility.label === "Customer Visible").length,
    internalOnly: documents.filter((d) => d.passportVisibility.label === "Internal Only").length,
  };

  // The three PAPER lines partition the documents the packet button will move,
  // counted with the same predicate the button filters on, so their sum is
  // exactly counts.ready. The old set left releasable `passport` sheets out of
  // every line while still counting them Ready, and the comment here claimed
  // each line was what the button moves — which the QR cling and key tag never
  // were: they live in qr_codes and zebra_print_jobs and printCompletePacket
  // does not touch either. Those two are now flagged as media the packet does
  // not release rather than silently added to the same list.
  const releasableDocs = docs.filter(printReleasable);
  const windowDocs = releasableDocs.filter((d) => String(d.document_type) === "window").length;
  const addendumDocs = releasableDocs.filter((d) => String(d.document_type) === "addendum").length;
  const letterDocs = releasableDocs.length - windowDocs - addendumDocs;
  const k208Docs = docs.filter((d) => String(d.document_type) === "k208");
  const activeQrCount = qrCodes.filter((q) => q.is_active !== false).length;
  // One key tag per vehicle. Counting every queued job made a label reprinted
  // three times read as three tags in the packet.
  const keyTagCount = zebraJobs.some((j) => j.label_type === "key_tag" && j.status !== "failed") ? 1 : 0;
  const bundle = [
    { label: "Letter Paper", count: letterDocs, unit: letterDocs === 1 ? "doc" : "docs", releasedByPacket: true },
    { label: "Window Sticker Stock", count: windowDocs, unit: windowDocs === 1 ? "doc" : "docs", releasedByPacket: true },
    { label: "Addendum Label", count: addendumDocs, unit: addendumDocs === 1 ? "doc" : "docs", releasedByPacket: true },
    { label: "4×4 QR Cling", count: activeQrCount, unit: activeQrCount === 1 ? "item" : "items", releasedByPacket: false },
    { label: "Key Tag", count: keyTagCount, unit: keyTagCount === 1 ? "item" : "items", releasedByPacket: false },
  ];
  const bundleNote = bundleNoteFor({
    used: isUsed(vehicle.condition),
    signedInspection: k208.state === "signed",
    k208Docs,
  });
  const packetBlockedReason = releasableDocs.length === 0 ? printBlockedReason(docs) : null;

  const passportPreview = documents
    .filter((d) => d.passportVisibility.label === "Customer Visible")
    .map((d) => ({ label: d.label, version: d.version }));

  const passportHref = v.slug && v.status === "published" ? `/v/${v.slug}` : null;

  return { vehicle, counts, documents, bundle, bundleNote, packetBlockedReason, passportPreview, passportHref };
}

export function usePrintCenter(vehicleId?: string): Result<PrintCenterData> & {
  printCompletePacket(): Promise<{ ok: boolean; error?: string }>;
  printByStock(): Promise<{ ok: boolean; error?: string }>;
} {
  const { data, dataRef, loading, error, errorDetail, notFound, noTenant, degraded, reload, tenantId, actorId } =
    useLoader<PrintCenterData>(vehicleId, loadPrintCenter);

  // Puts the packet on paper, then records that it went. The eligible set is
  // printReleasable() — the same predicate the bundle counts, the Print Status
  // pills and the Ready stat card are built from.
  //
  // The lifecycle stamp is NOT the print. printed_at / print_count are the
  // evidence a regulator reads as what was posted on the car, and `printed` has
  // no mark_printed transition, so stamping them without producing paper filed
  // that evidence for documents nobody could ever print afterwards. The
  // documents are handed to the browser's print path first; if that handoff does
  // not happen, nothing is stamped.
  const printing = useRef(false);
  const printCompletePacket = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
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
        console.error("[useCommandCenter] packet read failed:", readErr.message || readErr);
        return abandon({ ok: false, error: "Could not read this vehicle's documents, so nothing was printed. Retry in a moment." });
      }
      const docs = liveDocuments((docRows as Row[]) || []);
      const eligible = docs.filter(printReleasable);
      if (eligible.length === 0) return abandon({ ok: false, error: printBlockedReason(docs) });

      const current = dataRef.current;
      const handedOff = openPacketPrintSheet(
        sheet,
        {
          ymm: current?.vehicle.ymm || "",
          vin: current?.vehicle.vin || "",
          stockNumber: current?.vehicle.stockNumber ?? null,
        },
        eligible.map((d) => ({
          label: DOC_TYPE_LABEL[String(d.document_type)] || humanize(String(d.document_type)),
          version: `v${d.version ?? 1}`,
          url: String(d.pdf_url || d.png_url || d.online_url || ""),
        })).filter((d) => !!d.url),
      );
      if (!handedOff) {
        return abandon({
          ok: false,
          error: "The print window could not be opened, so nothing was marked printed. Allow pop-ups for this site, then release the packet again.",
        });
      }

      const releasedIds: string[] = [];
      const failures: string[] = [];
      for (const d of eligible) {
        const res = await transitionDocument({
          doc: d as unknown as GeneratedDocument,
          action: "mark_printed",
          actorId,
          reason: "print_complete_packet",
        });
        if (res.ok) releasedIds.push(String(d.id));
        else failures.push(res.error || "transition_failed");
      }
      if (releasedIds.length === 0) {
        console.error("[useCommandCenter] packet release failed:", failures[0]);
        return { ok: false, error: "Could not release the packet. No document was marked printed — retry in a moment." };
      }
      // The ledger records only the documents that actually moved: listing the
      // whole eligible set would file a print record for sheets nobody released.
      const { error: ledgerErr } = await sb().from("document_lifecycle_events").insert({
        tenant_id: tenantId, vehicle_id: vehicleId,
        vin: current?.vehicle.vin || null, stock: current?.vehicle.stockNumber || null,
        event_type: EVT_PACKET_PRINTED, occurred_at: new Date().toISOString(),
        actor_id: actorId, source: "documents-print-center",
        metadata: { document_ids: releasedIds, released: releasedIds.length, failed: failures.length },
      });
      await reload();
      if (failures.length) {
        console.error("[useCommandCenter] partial packet release:", failures[0]);
        return { ok: false, error: `${releasedIds.length} of ${eligible.length} documents were released. ${failures.length} could not be — retry, then check the document list.` };
      }
      if (ledgerErr) {
        console.error("[useCommandCenter] print ledger insert failed:", ledgerErr.message || ledgerErr);
        return { ok: false, error: "The documents were released, but the print record could not be saved. Note the time before printing again." };
      }
      return { ok: true };
    } finally {
      printing.current = false;
    }
  }, [tenantId, vehicleId, actorId, dataRef, reload]);

  // Queues a real stock-number label into public.zebra_print_jobs — the same
  // queue useZebraPrint writes, using the same ZPL builder.
  const printByStock = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
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
      console.error("[useCommandCenter] stock label queue failed:", err.message || err);
      return { ok: false, error: "Could not queue the stock label. Nothing was sent to the printer — retry in a moment." };
    }
    await reload();
    return { ok: true };
  }, [tenantId, dataRef, reload]);

  return { data, loading, error, errorDetail, notFound, noTenant, degraded, reload, printCompletePacket, printByStock };
}
