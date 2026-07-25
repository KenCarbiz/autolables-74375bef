import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  deriveGetReadyDispatch,
  itemDepartment,
  type GetReadyItem,
} from "@/hooks/useGetReady";
import { generateZpl } from "@/hooks/useZebraPrint";
import {
  allowedActions,
  isPublicDoc,
  STATUS_META,
  transitionDocument,
  type DocumentStatus,
  type GeneratedDocument,
} from "@/lib/stickerStudio/documentWorkflow";
import { packetVisible } from "@/lib/packetModules";

// Data layer for the three command surfaces (VIN Command Center, Get Ready
// Command, Documents & Print Center). Every read is tenant-scoped through
// useTenant(); every count is measured from rows that were actually queried.
// When a source row is absent the item is reported pending / "Not started"
// rather than assumed complete, and every mutation either performs a real
// write or returns { ok: false, error } naming the reason it could not.

// deno-lint-ignore-file no-explicit-any
type Row = Record<string, any>;

export type Tone = "slate" | "blue" | "amber" | "red" | "emerald" | "violet";

export interface Result<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** A vehicle that does not exist in this tenant is its own state, not an error. */
  notFound: boolean;
  reload: () => Promise<void>;
}

export type PackageItemStatus =
  | "draft_created" | "created" | "ready" | "prefilled"
  | "published" | "retry_required" | "blocked" | "pending";

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
  bundle: { label: string; count: number; unit: string }[];
  bundleNote: string | null;
  passportPreview: { label: string; version: string }[];
  passportHref: string | null;
}

// ── shared plumbing ──────────────────────────────────────────────────

const sb = () => supabase as any;

// A missing optional source must degrade to "not started", never to a thrown
// page error — only the vehicle read (below) is allowed to fail the screen.
async function rows(query: any): Promise<Row[]> {
  try {
    const { data, error } = await query;
    if (error) return [];
    return (data as Row[]) || [];
  } catch { return []; }
}

async function oneRow(query: any): Promise<Row | null> {
  const r = await rows(query);
  return r[0] || null;
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function useLoader<T>(
  vehicleId: string | undefined,
  run: (tenantId: string, vehicleId: string, actorId: string | null) => Promise<T>,
) {
  const { tenant, loading: tenantLoading } = useTenant();
  const { user } = useAuth();
  const [data, setData] = useState<T | null>(null);
  // Starts true whenever there is work to do. Starting false meant the first
  // commit had loading=false, data=null, error=null — which every consumer
  // reads as "vehicle not found", so the wrong state painted on every load.
  const [loading, setLoading] = useState(!!vehicleId);
  const [error, setError] = useState<string | null>(null);
  // A missing vehicle is not a failure — it is its own state. Collapsing it into
  // `error` made all three screens show a red "Something went wrong" card with a
  // Retry that could only re-fail, and left their not-found empty states dead.
  const [notFound, setNotFound] = useState(false);
  const runRef = useRef(run);
  runRef.current = run;
  const actorId = user?.id ?? null;

  const reload = useCallback(async () => {
    if (!vehicleId) { setData(null); setError(null); setNotFound(false); setLoading(false); return; }
    // The tenant resolves independently of entitlements, so hold the loading
    // state rather than reporting a false miss while it is still settling.
    if (!tenant?.id) { setData(null); setError(null); setNotFound(false); setLoading(tenantLoading); return; }
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      setData(await runRef.current(tenant.id, vehicleId, actorId));
    } catch (e) {
      const msg = (e as Error).message || "Could not load this vehicle";
      if (/^vehicle not found/i.test(msg)) setNotFound(true);
      else setError(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [tenant?.id, tenantLoading, vehicleId, actorId]);

  useEffect(() => { reload(); }, [reload]);

  return { data, loading, error, notFound, reload, tenantId: tenant?.id ?? null, actorId };
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

// Which package-item states mean "the automation produced it".
const DONE_STATES = new Set<PackageItemStatus>([
  "draft_created", "created", "ready", "prefilled", "published",
]);
const EXCEPTION_STATES = new Set<PackageItemStatus>(["retry_required", "blocked"]);

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

async function loadVinCommand(tenantId: string, vehicleId: string): Promise<VinCommand> {
  const v = await fetchVehicleRow(tenantId, vehicleId);
  const vehicle = toCommandVehicle(v);
  const vin = vehicle.vin;
  const used = isUsed(vehicle.condition);

  const [docs, inspections, addendums, grRecords, descCase, qrCodes, zebraJobs, recallTasks, auditRows, lifecycle] =
    await Promise.all([
      rows(sb().from("generated_documents")
        .select("id, document_type, document_status, version, pdf_url, png_url, online_url, printed_at, published_at, print_count, rejection_reason, tenant_id, vehicle_id, template_id, created_at")
        .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
        .order("version", { ascending: false })),
      rows(sb().from("safety_inspections")
        .select("id, status, result, form_type, signed_at, created_at")
        .eq("tenant_id", tenantId).eq("vin", vin)
        .order("created_at", { ascending: false }).limit(5)),
      rows(sb().from("addendums")
        .select("id, status, lifecycle_status, accepted_at, customer_signed_at, ready_at, created_at")
        .eq("tenant_id", tenantId).eq("vehicle_vin", vin)
        .order("created_at", { ascending: false }).limit(5)),
      rows(sb().from("get_ready_records")
        .select("id, items, status, get_ready_start_date, get_ready_complete_date, inspection_complete")
        .eq("tenant_id", tenantId).eq("vin", vin)
        .order("created_at", { ascending: false }).limit(1)),
      oneRow(sb().from("description_cases")
        .select("id, status, current_master_version_id, published_master_version_id, open_exception_count, last_error_message")
        .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).limit(1)),
      rows(sb().from("qr_codes").select("*").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)),
      rows(sb().from("zebra_print_jobs")
        .select("id, label_type, status, created_at")
        .eq("tenant_id", tenantId).eq("vin", vin)
        .order("created_at", { ascending: false })),
      rows(sb().from("recall_service_tasks")
        .select("id, status, outcome, open_recall_count, completed_at")
        .eq("tenant_id", tenantId).eq("vehicle_listing_id", vehicleId)
        .order("created_at", { ascending: false }).limit(5)),
      rows(sb().from("audit_log")
        .select("action, entity_type, entity_id, created_at, details")
        .eq("store_id", tenantId).in("entity_id", [vehicleId, vin].filter(Boolean))
        .order("created_at", { ascending: false }).limit(40)),
      rows(sb().from("document_lifecycle_events")
        .select("event_type, metadata, occurred_at")
        .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
        .order("occurred_at", { ascending: false }).limit(100)),
    ]);

  const descChannelCount = descCase?.current_master_version_id
    ? (await rows(sb().from("description_channel_versions")
        .select("id").eq("tenant_id", tenantId)
        .eq("master_version_id", descCase.current_master_version_id))).length
    : 0;

  const latestOfType = (type: string): Row | null =>
    docs.filter((d) => d.document_type === type)[0] || null;

  const grRecord = grRecords[0] || null;
  const grItems: GetReadyItem[] = ((grRecord?.items as GetReadyItem[]) || []).filter(Boolean);
  const dispatched =
    auditRows.some((a) => a.action === "getready_dispatched") ||
    lifecycle.some((e) => e.event_type === EVT_AUTHORIZED);

  const items: PackageItem[] = [];

  // K-208 and the FTC Buyers Guide are used-car artifacts; including them for a
  // new car would report a permanently incomplete automation total.
  if (used) {
    const insp = inspections[0] || null;
    let k208: { status: PackageItemStatus; detail: string };
    if (!insp) k208 = { status: "pending", detail: "Not started" };
    else if (insp.result === "fail") k208 = { status: "blocked", detail: "Inspection failed — vehicle cannot be listed" };
    else if (insp.status === "signed") k208 = { status: "ready", detail: `Signed ${fmtDate(insp.signed_at || insp.created_at)}` };
    else k208 = { status: "prefilled", detail: "Prefilled, awaiting inspection" };
    items.push({ key: "k208", label: "K-208", ...k208, href: vin ? `/k208/${vin}` : undefined });

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
    href: vin ? `/print/vehicle-qr/${vin}` : undefined,
  });

  const keyTagJobs = zebraJobs.filter((j) => j.label_type === "key_tag");
  const keyTagPrinted = keyTagJobs.find((j) => j.status === "printed");
  items.push({
    key: "key_tag_qr", label: "Key-Tag QR",
    status: keyTagJobs.length === 0 ? "pending" : keyTagPrinted ? "ready" : "created",
    detail: keyTagJobs.length === 0
      ? "Not started"
      : keyTagPrinted ? `Printed ${fmtDate(keyTagPrinted.created_at)}` : `Queued ${fmtDate(keyTagJobs[0].created_at)}`,
    href: vin ? `/print/vehicle-qr/${vin}` : undefined,
  });

  const svcItems = grItems.filter((i) => columnFor(i) === "service");
  const prepItems = grItems.filter((i) => columnFor(i) !== "service");
  const countDone = (list: GetReadyItem[]) => list.filter((i) => i.status === "complete").length;
  const grItemState = (list: GetReadyItem[], noneDetail: string): { status: PackageItemStatus; detail: string } => {
    if (!grRecord) return { status: "pending", detail: "Not started" };
    if (list.length === 0) return { status: "pending", detail: noneDetail };
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
    else descState = { status: descChannelCount > 0 ? "created" : "pending", detail: descChannelCount > 0 ? sectionDetail : humanize(s || "not started") };
  }
  items.push({ key: "description", label: "Description", ...descState, href: `/description-intelligence/${vehicleId}` });

  const automationDone = items.filter((i) => DONE_STATES.has(i.status)).length;
  const exceptions = items.filter((i) => EXCEPTION_STATES.has(i.status)).length;
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
  } else if (automationDone === items.length && items.length > 0) {
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
      automationDone, automationTotal: items.length,
      awaitingAuthorization, exceptions, passportPublished,
    },
    packageItems: items,
    readiness,
    timeline,
  };
}

export function useVinCommand(vehicleId?: string): Result<VinCommand> {
  const { data, loading, error, notFound, reload } = useLoader<VinCommand>(vehicleId, loadVinCommand);
  return { data, loading, error, notFound, reload };
}

// ── screen 2: Get Ready Command ──────────────────────────────────────

// Column routing, exactly as specified: vendor first (department or accessory
// category), then service (inspection/service), then prep (detail/photo).
// Anything else falls back to its routed department so no line is dropped.
function columnFor(item: GetReadyItem): "service" | "prep" | "vendor" {
  if (itemDepartment(item) === "vendor" || item.category === "accessory") return "vendor";
  if (item.category === "inspection" || item.category === "service") return "service";
  if (item.category === "detail" || item.category === "photo") return "prep";
  return itemDepartment(item) === "service" ? "service" : "prep";
}

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

async function loadGetReadyCommand(tenantId: string, vehicleId: string): Promise<GetReadyCommandData> {
  const v = await fetchVehicleRow(tenantId, vehicleId);
  const vehicle = toCommandVehicle(v);
  const vin = vehicle.vin;

  const [grRecords, lifecycle, auditRows, detailSignoffs, pdiSignoffs] = await Promise.all([
    rows(sb().from("get_ready_records")
      .select("id, items, status, get_ready_start_date, get_ready_complete_date, inspection_complete, assigned_technician, ro_number")
      .eq("tenant_id", tenantId).eq("vin", vin)
      .order("created_at", { ascending: false }).limit(1)),
    rows(sb().from("document_lifecycle_events")
      .select("event_type, metadata, occurred_at")
      .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
      .in("event_type", [EVT_NOTE, EVT_CHECKLIST, EVT_AUTHORIZED])
      .order("occurred_at", { ascending: false }).limit(200)),
    rows(sb().from("audit_log")
      .select("action, created_at")
      .eq("store_id", tenantId).in("entity_id", [vehicleId, vin].filter(Boolean))
      .order("created_at", { ascending: false }).limit(40)),
    rows(sb().from("detail_signoffs")
      .select("id, is_third_party, provider_company, photos, status, signed_at")
      .eq("tenant_id", tenantId).eq("vin", vin)
      .order("created_at", { ascending: false }).limit(10)),
    rows(sb().from("pdi_signoffs")
      .select("id, result, status, signed_at")
      .eq("tenant_id", tenantId).eq("vin", vin)
      .order("created_at", { ascending: false }).limit(5)),
  ]);

  const grRecord = grRecords[0] || null;
  const grItems: GetReadyItem[] = ((grRecord?.items as GetReadyItem[]) || []).filter(Boolean);

  const invoice = grRecord
    ? await oneRow(sb().from("get_ready_invoices")
        .select("total, line_items, status")
        .eq("tenant_id", tenantId).eq("get_ready_record_id", grRecord.id).limit(1))
    : null;

  const authorizedAt =
    lifecycle.find((e) => e.event_type === EVT_AUTHORIZED)?.occurred_at ||
    auditRows.find((a) => a.action === "getready_dispatched")?.created_at ||
    null;
  const dispatched = !!authorizedAt;

  // Latest event wins per key; the table is append-only by convention.
  const notes: Record<string, string> = {};
  const checks: Record<string, boolean> = {};
  for (const e of lifecycle) {
    const meta = (e.metadata || {}) as Row;
    if (e.event_type === EVT_NOTE) {
      const col = String(meta.column || "");
      if (col && !(col in notes)) notes[col] = String(meta.note ?? "");
    } else if (e.event_type === EVT_CHECKLIST) {
      const key = String(meta.key || "");
      if (key && !(key in checks)) checks[key] = meta.done === true;
    }
  }

  const proofClock = authorizedAt || grRecord?.get_ready_start_date || null;
  const thirdPartyProven = detailSignoffs.some(
    (s) => s.is_third_party && s.status === "signed" && Array.isArray(s.photos) && s.photos.length > 0,
  );

  const columns: GetReadyColumn[] = (["service", "prep", "vendor"] as const).map((key) => {
    const list = grItems.filter((i) => columnFor(i) === key);
    const mapped = list.map((i) => {
      // Third-party lines stay "Pending Proof" until the vendor uploads proof.
      const isThirdParty = key === "vendor" || itemDepartment(i) === "vendor";
      const status: "complete" | "pending" | "pending_proof" =
        i.status === "complete" ? "complete"
        : isThirdParty && !thirdPartyProven ? "pending_proof"
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

    const costed = list.filter((i) => typeof i.cost === "number");
    const estimatedCost = costed.length ? costed.reduce((s, i) => s + (i.cost || 0), 0) : null;

    const vendorMap = new Map<string, { name: string; category: string; email?: string | null }>();
    if (key === "vendor") {
      for (const i of list) {
        const name = (i.vendorName || "").trim();
        if (!name) continue;
        if (!vendorMap.has(name)) vendorMap.set(name, { name, category: humanize(i.category), email: i.vendorEmail || null });
      }
      for (const s of detailSignoffs) {
        const name = String(s.provider_company || "").trim();
        if (s.is_third_party && name && !vendorMap.has(name)) {
          vendorMap.set(name, { name, category: "Third-party detail", email: null });
        }
      }
    }

    const reportHref =
      key === "service" && vin ? `/k208/${vin}` : `/vehicle-file/${vehicleId}?tab=prep`;

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

  const itemCostTotal = grItems
    .filter((i) => typeof i.cost === "number")
    .reduce((s, i) => s + (i.cost || 0), 0);
  const invoiceTotal = invoice && invoice.total != null ? Number(invoice.total) : null;
  const estimatedTotal =
    invoiceTotal != null && !Number.isNaN(invoiceTotal) ? invoiceTotal
    : itemCostTotal > 0 ? itemCostTotal
    : null;

  const checklist = CHECKLIST_ITEMS.map((c) => ({ ...c, done: checks[c.key] === true }));
  const canAuthorize = !!grRecord && grItems.length > 0 && checklist.every((c) => c.done);

  const allComplete = grItems.length > 0 && grItems.every((i) => i.status === "complete");
  const currentStep = !dispatched ? 1 : allComplete ? 4 : 3;

  // pdi_signoffs is read so a signed PDI counts toward the service column's
  // completion signal even when the record's own line was never ticked.
  const pdiSigned = pdiSignoffs.some((p) => p.status === "signed" || !!p.signed_at);
  if (pdiSigned) {
    const svc = columns.find((c) => c.key === "service");
    if (svc && svc.total > 0 && svc.completed === 0) {
      svc.headline = `${svc.completed} of ${svc.total} Completed · PDI signed`;
    }
  }

  return {
    vehicle,
    deliveryTarget: grRecord?.get_ready_complete_date ?? null,
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
    currentStep,
  };
}

export function useGetReadyCommand(vehicleId?: string): Result<GetReadyCommandData> & {
  saveManagerNote(columnKey: string, note: string): Promise<{ ok: boolean; error?: string }>;
  toggleChecklist(key: string, done: boolean): Promise<{ ok: boolean; error?: string }>;
  authorizeAndDispatch(): Promise<{ ok: boolean; error?: string }>;
} {
  const { data, loading, error, notFound, reload, tenantId, actorId } =
    useLoader<GetReadyCommandData>(vehicleId, loadGetReadyCommand);

  const writeEvent = useCallback(async (eventType: string, metadata: Row) => {
    if (!tenantId || !vehicleId) return { ok: false, error: "No dealership or vehicle in context." };
    const { error: err } = await sb().from("document_lifecycle_events").insert({
      tenant_id: tenantId,
      vehicle_id: vehicleId,
      vin: data?.vehicle.vin || null,
      stock: data?.vehicle.stockNumber || null,
      event_type: eventType,
      occurred_at: new Date().toISOString(),
      actor_id: actorId,
      source: "get-ready-command",
      metadata,
    });
    if (err) return { ok: false, error: err.message || "Could not save" };
    return { ok: true };
  }, [tenantId, vehicleId, actorId, data?.vehicle.vin, data?.vehicle.stockNumber]);

  const saveManagerNote = useCallback(async (columnKey: string, note: string) => {
    const res = await writeEvent(EVT_NOTE, { column: columnKey, note });
    if (res.ok) await reload();
    return res;
  }, [writeEvent, reload]);

  const toggleChecklist = useCallback(async (key: string, done: boolean) => {
    const res = await writeEvent(EVT_CHECKLIST, { key, done });
    if (res.ok) await reload();
    return res;
  }, [writeEvent, reload]);

  // Reuses the existing dispatch path (deriveGetReadyDispatch → notify-getready),
  // the same one ReadyBoard and the Vehicle File call on addendum acceptance.
  const authorizeAndDispatch = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!tenantId || !vehicleId) return { ok: false, error: "No dealership or vehicle in context." };
    const vin = data?.vehicle.vin;
    if (!vin) return { ok: false, error: "This vehicle has no VIN, so no work order can be addressed." };
    if (!data?.canAuthorize) return { ok: false, error: "Complete the authorization checklist first." };

    try {
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
      // The dispatch is the authorization: record it only after the server
      // confirmed at least one work order actually went out.
      await writeEvent(EVT_AUTHORIZED, { dispatched: payload.dispatched ?? null, depts, vendors: vendors.length });
      await reload();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message || "Dispatch failed." };
    }
  }, [tenantId, vehicleId, data?.vehicle.vin, data?.canAuthorize, writeEvent, reload]);

  return { data, loading, error, notFound, reload, saveManagerNote, toggleChecklist, authorizeAndDispatch };
}

// ── screen 3: Documents & Print Center ───────────────────────────────

const toneFromMeta = (tone: string): Tone => (tone === "rose" ? "red" : (tone as Tone));

async function loadPrintCenter(tenantId: string, vehicleId: string): Promise<PrintCenterData> {
  const v = await fetchVehicleRow(tenantId, vehicleId);
  const vehicle = toCommandVehicle(v);
  const vin = vehicle.vin;

  const [docs, qrCodes, zebraJobs, inspections] = await Promise.all([
    rows(sb().from("generated_documents")
      .select("id, tenant_id, vehicle_id, template_id, document_type, document_status, version, pdf_url, png_url, online_url, print_count, printed_at, published_at, created_at")
      .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
      .order("version", { ascending: false })),
    rows(sb().from("qr_codes").select("*").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)),
    rows(sb().from("zebra_print_jobs")
      .select("id, label_type, status, created_at")
      .eq("tenant_id", tenantId).eq("vin", vin)),
    rows(sb().from("safety_inspections")
      .select("id, status, result, signed_at")
      .eq("tenant_id", tenantId).eq("vin", vin)
      .order("created_at", { ascending: false }).limit(5)),
  ]);

  // "Current" is the highest live version within each document type.
  const currentByType = new Map<string, number>();
  for (const d of docs) {
    const s = String(d.document_status);
    if (s === "superseded" || s === "archived") continue;
    const t = String(d.document_type);
    const ver = Number(d.version ?? 1);
    if (!currentByType.has(t) || ver > (currentByType.get(t) as number)) currentByType.set(t, ver);
  }

  const documents: DocRow[] = [];

  for (const d of docs) {
    const status = String(d.document_status) as DocumentStatus;
    const meta = STATUS_META[status] || { label: humanize(String(d.document_status)), tone: "slate" as const };
    const publicDoc = isPublicDoc(status);
    // Customer visibility is the document's own lifecycle AND the vehicle's
    // packet-module curation; a public doc inside a hidden module is "Hidden".
    const moduleOn = packetVisible(
      { packet_modules: (v.packet_modules || null) as Record<string, boolean> | null },
      d.document_type === "window" ? "oemSticker" : "documents",
    );
    const passportVisibility: { label: string; tone: Tone } =
      publicDoc && moduleOn ? { label: "Customer Visible", tone: "blue" }
      : publicDoc ? { label: "Hidden", tone: "slate" }
      : { label: "Internal Only", tone: "violet" };
    const hasFile = !!(d.pdf_url || d.png_url);
    const printStatus: { label: string; tone: Tone } =
      publicDoc && hasFile ? { label: "Ready", tone: "emerald" } : { label: "Blocked", tone: "red" };

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

  for (const q of qrCodes) {
    const active = q.is_active !== false;
    const surface = String(q.surface || q.sticker_type || "");
    documents.push({
      id: String(q.id),
      label: q.label ? String(q.label) : surface ? `${humanize(surface)} QR` : "Vehicle QR",
      kind: "qr",
      version: "v1",
      isCurrent: active,
      internalStatus: active ? { label: "Published", tone: "violet" } : { label: "Archived", tone: "slate" },
      passportVisibility: { label: "Customer Visible", tone: "blue" },
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

  const signedInspection = inspections.find((i) => i.status === "signed" && i.result !== "fail") || null;
  const letterDocs = docs.filter((d) => d.document_type === "buyers_guide" || d.document_type === "cpo_sheet").length
    + (signedInspection ? 1 : 0);
  const keyTagCount = zebraJobs.filter((j) => j.label_type === "key_tag").length;
  const bundle = [
    { label: "Letter Paper", count: letterDocs, unit: letterDocs === 1 ? "doc" : "docs" },
    { label: "Window Sticker Stock", count: docs.filter((d) => d.document_type === "window").length, unit: "docs" },
    { label: "Addendum Label", count: docs.filter((d) => d.document_type === "addendum").length, unit: "docs" },
    { label: "4×4 QR Cling", count: qrCodes.length, unit: qrCodes.length === 1 ? "item" : "items" },
    { label: "Key Tag", count: keyTagCount, unit: keyTagCount === 1 ? "item" : "items" },
  ];
  const bundleNote =
    isUsed(vehicle.condition) && !signedInspection
      ? "K-208 excluded until executed and signed."
      : null;

  const passportPreview = documents
    .filter((d) => d.passportVisibility.label === "Customer Visible")
    .map((d) => ({ label: d.label, version: d.version }));

  const passportHref = v.slug && v.status === "published" ? `/v/${v.slug}` : null;

  return { vehicle, counts, documents, bundle, bundleNote, passportPreview, passportHref };
}

export function usePrintCenter(vehicleId?: string): Result<PrintCenterData> & {
  printCompletePacket(): Promise<{ ok: boolean; error?: string }>;
  printByStock(): Promise<{ ok: boolean; error?: string }>;
} {
  const { data, loading, error, notFound, reload, tenantId, actorId } =
    useLoader<PrintCenterData>(vehicleId, loadPrintCenter);

  // Releases the packet through the existing generated-document lifecycle
  // (mark_printed → document_status/printed_at/print_count + audit row). Only
  // documents that hold a real file and are legally in the printable state move.
  const printCompletePacket = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!tenantId || !vehicleId) return { ok: false, error: "No dealership or vehicle in context." };
    const docs = await rows(sb().from("generated_documents")
      .select("id, tenant_id, vehicle_id, template_id, document_type, document_status, version, pdf_url, png_url, online_url, print_count")
      .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId));
    const eligible = docs.filter((d) =>
      allowedActions(String(d.document_status) as DocumentStatus, true).includes("mark_printed")
      && (d.pdf_url || d.png_url));
    if (eligible.length === 0) {
      return {
        ok: false,
        error: docs.length === 0
          ? "No documents have been generated for this vehicle yet."
          : "No approved document has a print-ready file. Approve the packet documents first.",
      };
    }
    const failures: string[] = [];
    for (const d of eligible) {
      const res = await transitionDocument({
        doc: d as unknown as GeneratedDocument,
        action: "mark_printed",
        actorId,
        reason: "print_complete_packet",
      });
      if (!res.ok) failures.push(res.error || "transition_failed");
    }
    if (failures.length === eligible.length) {
      return { ok: false, error: `Could not release the packet: ${failures[0]}` };
    }
    await sb().from("document_lifecycle_events").insert({
      tenant_id: tenantId, vehicle_id: vehicleId,
      vin: data?.vehicle.vin || null, stock: data?.vehicle.stockNumber || null,
      event_type: EVT_PACKET_PRINTED, occurred_at: new Date().toISOString(),
      actor_id: actorId, source: "documents-print-center",
      metadata: { document_ids: eligible.map((d) => d.id), released: eligible.length - failures.length },
    });
    await reload();
    if (failures.length) {
      return { ok: false, error: `${failures.length} of ${eligible.length} documents could not be released: ${failures[0]}` };
    }
    return { ok: true };
  }, [tenantId, vehicleId, actorId, data?.vehicle.vin, data?.vehicle.stockNumber, reload]);

  // Queues a real stock-number label into public.zebra_print_jobs — the same
  // queue useZebraPrint writes, using the same ZPL builder.
  const printByStock = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!tenantId || !data) return { ok: false, error: "No dealership or vehicle in context." };
    const stock = data.vehicle.stockNumber;
    if (!stock) return { ok: false, error: "This vehicle has no stock number, so a stock label cannot be printed." };
    if (!data.vehicle.vin) return { ok: false, error: "This vehicle has no VIN, so a stock label cannot be printed." };
    const { error: err } = await sb().from("zebra_print_jobs").insert({
      tenant_id: tenantId,
      vin: data.vehicle.vin,
      stock_number: stock,
      ymm: data.vehicle.ymm,
      label_type: "stock_number",
      printer_name: "Default",
      status: "queued",
      zpl_content: generateZpl(stock, data.vehicle.vin, data.vehicle.ymm, "stock_number"),
    });
    if (err) return { ok: false, error: err.message || "Could not queue the stock label." };
    await reload();
    return { ok: true };
  }, [tenantId, data, reload]);

  return { data, loading, error, notFound, reload, printCompletePacket, printByStock };
}
