import { currentDocumentOfType, liveDocuments } from "@/lib/commandCenter/documentSet";
import { docPackageStatus, k208PackageState } from "@/lib/commandCenter/vinPackage";
import { isFinishedState, type PackageItemStatus } from "@/lib/commandCenter/packageState";
import type { SafetyInspectionRow } from "@/lib/commandCenter/inspectionState";

// Documents & Service hub read model. Document and K-208 status come from the
// same pure functions the VIN Command Center package uses (docPackageStatus,
// k208PackageState, currentDocumentOfType); this module only arranges their
// output per vehicle. Nothing here computes a new readiness rule.

export const HUB_VIEWS = ["overview", "library", "readiness", "service", "settings"] as const;
export type HubView = (typeof HUB_VIEWS)[number];
export const HUB_VIEW_LABEL: Record<HubView, string> = {
  overview: "Overview",
  library: "Library",
  readiness: "Vehicle readiness",
  service: "Service requirements",
  settings: "Settings",
};

export const HUB_PAGE_SIZES = [25, 50, 100] as const;
export type HubPageSize = (typeof HUB_PAGE_SIZES)[number];

export const CONDITION_OPTIONS = ["all", "new", "used", "cpo"] as const;
export type HubCondition = (typeof CONDITION_OPTIONS)[number];
export const CONDITION_LABEL: Record<HubCondition, string> = { all: "All conditions", new: "New", used: "Used", cpo: "CPO" };
export const CONDITION_VALUES: Record<Exclude<HubCondition, "all">, string[]> = { new: ["new"], used: ["used"], cpo: ["cpo", "certified"] };

export const DOC_OPTIONS = ["any", "window", "buyers_guide", "k208"] as const;
export type HubDoc = (typeof DOC_OPTIONS)[number];
export const DOC_LABEL: Record<HubDoc, string> = { any: "Any document", window: "Window sticker", buyers_guide: "FTC Buyers Guide", k208: "K-208 inspection" };

export const STATUS_OPTIONS = ["any", "missing", "draft", "pending_approval", "approved", "printed", "published", "rejected"] as const;
export type HubStatus = (typeof STATUS_OPTIONS)[number];
export const STATUS_LABEL: Record<HubStatus, string> = {
  any: "Any status",
  missing: "Missing",
  draft: "Draft",
  pending_approval: "Awaiting approval",
  approved: "Approved",
  printed: "Printed",
  published: "Published",
  rejected: "Rejected",
};

export const BLOCKER_OPTIONS = ["any", "none", "needs_attention", "missing_document", "rejected_document", "awaiting_approval", "k208_pending", "k208_failed", "open_recall"] as const;
export type HubBlocker = (typeof BLOCKER_OPTIONS)[number];
export const BLOCKER_LABEL: Record<HubBlocker, string> = {
  any: "Any blocker",
  none: "No blockers",
  needs_attention: "Needs attention",
  missing_document: "Missing document",
  rejected_document: "Rejected document",
  awaiting_approval: "Awaiting approval",
  k208_pending: "K-208 not signed",
  k208_failed: "K-208 failed",
  open_recall: "Open recall",
};

export interface HubFilters {
  q: string;
  condition: HubCondition;
  doc: HubDoc;
  status: HubStatus;
  blocker: HubBlocker;
  /** 1-based. */
  page: number;
  size: HubPageSize;
}

export const DEFAULT_HUB_FILTERS: HubFilters = { q: "", condition: "all", doc: "any", status: "any", blocker: "any", page: 1, size: 25 };

const pickOne = <T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T => (raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback);

export function parseHubView(params: URLSearchParams): HubView {
  return pickOne(params.get("view"), HUB_VIEWS, "overview");
}

export function parseHubFilters(params: URLSearchParams): HubFilters {
  const size = Number(params.get("size"));
  const page = Math.floor(Number(params.get("page")));
  return {
    q: (params.get("q") ?? "").slice(0, 64),
    condition: pickOne(params.get("condition"), CONDITION_OPTIONS, "all"),
    doc: pickOne(params.get("doc"), DOC_OPTIONS, "any"),
    status: pickOne(params.get("status"), STATUS_OPTIONS, "any"),
    blocker: pickOne(params.get("blocker"), BLOCKER_OPTIONS, "any"),
    page: Number.isFinite(page) && page >= 1 ? page : 1,
    size: (HUB_PAGE_SIZES as readonly number[]).includes(size) ? (size as HubPageSize) : 25,
  };
}

const FILTER_KEYS = ["q", "condition", "doc", "status", "blocker", "page", "size"] as const;

/** A copy of `params` carrying `filters`: defaults are left out so the URL stays short, and unrelated params are kept. */
export function writeHubFilters(params: URLSearchParams, filters: HubFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const k of FILTER_KEYS) next.delete(k);
  for (const k of FILTER_KEYS) {
    const v = filters[k];
    if (String(v) !== String(DEFAULT_HUB_FILTERS[k])) next.set(k, String(v));
  }
  return next;
}

/** True when the filters cannot be expressed on vehicle_listings alone and need document and inspection rows. */
export const hasDerivedFilter = (f: HubFilters): boolean => f.doc !== "any" || f.status !== "any" || f.blocker !== "any";

export interface HubListing {
  id: string;
  vin: string;
  ymm: string | null;
  condition: string | null;
  status: string;
  open_recall_count: number | null;
  vehicle_file_id: string | null;
  updated_at: string | null;
}

export interface HubDocRow {
  id: string;
  vehicle_id: string | null;
  document_type: string;
  document_status: string;
  version: number | null;
  template_id?: string | null;
  template_version?: number | null;
  created_at?: string | null;
  approved_at?: string | null;
  published_at?: string | null;
  superseded_at?: string | null;
  rejection_reason?: string | null;
}

export interface HubInspectionRow extends SafetyInspectionRow {
  vehicle_listing_id: string | null;
  inspector_name?: string | null;
  form_type?: string | null;
}

export const isUsedCondition = (condition: string | null | undefined): boolean => String(condition ?? "").trim().toLowerCase() !== "new";

export interface HubDocCell {
  key: "window" | "buyers_guide";
  label: string;
  status: PackageItemStatus;
  detail: string;
  doc: HubDocRow | null;
  finished: boolean;
}

export interface HubServiceCell {
  state: "signed" | "failed" | "prefilled" | "not_started";
  label: string;
  detail: string;
  inspectionId: string | null;
  finished: boolean;
}

export type HubReadiness = "ready" | "needs_attention" | "missing" | "in_progress" | "service_incomplete";

export const READINESS_LABEL: Record<HubReadiness, string> = {
  ready: "Ready",
  needs_attention: "Needs attention",
  missing: "Missing documents",
  in_progress: "In progress",
  service_incomplete: "Service incomplete",
};

export type BlockerKey = Exclude<HubBlocker, "any" | "none" | "needs_attention">;

export interface HubVehicleFacts {
  documents: HubDocCell[];
  service: HubServiceCell | null;
  blockers: BlockerKey[];
  readiness: HubReadiness;
  nextAction: string;
}

const docLabel = (type: "window" | "buyers_guide", used: boolean): string => (type === "window" ? (used ? "Used-car sticker" : "Window sticker") : "FTC Buyers Guide");

/**
 * The same slice of the package the VIN Command Center builds. A new vehicle's
 * window sticker is its factory Monroney (`factory_sticker`), a used vehicle's
 * is the `window` family; the Buyers Guide and K-208 are used-car artifacts.
 */
export function resolveVehicleFacts(listing: Pick<HubListing, "condition" | "open_recall_count">, docs: HubDocRow[], inspections: HubInspectionRow[]): HubVehicleFacts {
  const used = isUsedCondition(listing.condition);
  const live = liveDocuments(docs);
  const windowDoc = used ? currentDocumentOfType(live, "window") : currentDocumentOfType(live, "factory_sticker") ?? currentDocumentOfType(live, "window");
  const cell = (key: "window" | "buyers_guide", doc: HubDocRow | null): HubDocCell => {
    const s = docPackageStatus(doc as never);
    return { key, label: docLabel(key, used), status: s.status, detail: s.detail, doc, finished: isFinishedState(s.status) };
  };
  const documents: HubDocCell[] = [cell("window", windowDoc)];
  if (used) documents.push(cell("buyers_guide", currentDocumentOfType(live, "buyers_guide")));

  let service: HubServiceCell | null = null;
  if (used) {
    const signed = inspections.filter((r) => String(r.status ?? "") === "signed").sort(newerFirst)[0] ?? null;
    const latest = [...inspections].sort(newerFirst)[0] ?? null;
    const pkg = k208PackageState({ latestSigned: signed, latest });
    const state: HubServiceCell["state"] = pkg.status === "blocked" ? "failed" : pkg.status === "ready" ? "signed" : pkg.status === "prefilled" ? "prefilled" : "not_started";
    const shown = state === "signed" ? signed : state === "failed" ? signed : latest;
    service = { state, label: state === "signed" ? "Signed" : state === "failed" ? "Failed" : state === "prefilled" ? "Awaiting inspection" : "Not started", detail: pkg.detail, inspectionId: (shown?.id as string | null | undefined) ?? null, finished: state === "signed" };
  }

  const blockers: BlockerKey[] = [];
  const statuses = documents.map((d) => d.doc?.document_status ?? "");
  if (documents.some((d) => !d.doc)) blockers.push("missing_document");
  if (statuses.includes("rejected")) blockers.push("rejected_document");
  if (statuses.includes("pending_approval")) blockers.push("awaiting_approval");
  if (service?.state === "failed") blockers.push("k208_failed");
  if (service && (service.state === "not_started" || service.state === "prefilled")) blockers.push("k208_pending");
  if ((listing.open_recall_count ?? 0) > 0) blockers.push("open_recall");

  const attention = blockers.some((b) => b === "rejected_document" || b === "k208_failed" || b === "open_recall");
  const unfinishedDoc = documents.some((d) => !d.finished);
  const readiness: HubReadiness = attention
    ? "needs_attention"
    : blockers.includes("missing_document")
      ? "missing"
      : unfinishedDoc
        ? "in_progress"
        : service && !service.finished
          ? "service_incomplete"
          : "ready";

  return { documents, service, blockers, readiness, nextAction: nextActionFor(documents, service, blockers) };
}

function newerFirst(a: SafetyInspectionRow, b: SafetyInspectionRow): number {
  const as = a.signed_at ?? "";
  const bs = b.signed_at ?? "";
  if (as !== bs) return as < bs ? 1 : -1;
  const ac = a.created_at ?? "";
  const bc = b.created_at ?? "";
  return ac < bc ? 1 : ac > bc ? -1 : 0;
}

function nextActionFor(documents: HubDocCell[], service: HubServiceCell | null, blockers: BlockerKey[]): string {
  const rejected = documents.find((d) => d.doc?.document_status === "rejected");
  if (rejected) return `Review the rejected ${rejected.label}`;
  if (service?.state === "failed") return "Resolve the failed K-208";
  if (blockers.includes("open_recall")) return "Review the open recall";
  const missing = documents.find((d) => !d.doc);
  if (missing) return `Generate the ${missing.label}`;
  const pending = documents.find((d) => d.doc?.document_status === "pending_approval");
  if (pending) return `Approve the ${pending.label}`;
  const draft = documents.find((d) => !d.finished);
  if (draft) return `Finish the ${draft.label}`;
  if (service && !service.finished) return service.state === "prefilled" ? "Complete the K-208 inspection" : "Start the K-208 inspection";
  return "Nothing to do";
}

export interface HubRowLike {
  listing: HubListing;
  stock: string | null;
  facts: HubVehicleFacts;
}

const BLOCKER_MATCH: Record<Exclude<HubBlocker, "any">, (f: HubVehicleFacts) => boolean> = {
  none: (f) => f.readiness === "ready",
  needs_attention: (f) => f.readiness === "needs_attention",
  missing_document: (f) => f.blockers.includes("missing_document"),
  rejected_document: (f) => f.blockers.includes("rejected_document"),
  awaiting_approval: (f) => f.blockers.includes("awaiting_approval"),
  k208_pending: (f) => f.blockers.includes("k208_pending"),
  k208_failed: (f) => f.blockers.includes("k208_failed"),
  open_recall: (f) => f.blockers.includes("open_recall"),
};

/** Document, status and blocker filters over resolved rows. `doc` and `status` together mean "this document is in this status". */
export function matchesDerivedFilters(row: HubRowLike, f: HubFilters): boolean {
  const facts = row.facts;
  if (f.blocker !== "any" && !BLOCKER_MATCH[f.blocker](facts)) return false;
  if (f.doc === "k208") {
    if (!facts.service) return false;
    if (f.status === "any") return true;
    const map: Partial<Record<HubStatus, HubServiceCell["state"][]>> = { missing: ["not_started"], draft: ["prefilled"], approved: ["signed"], published: ["signed"], rejected: ["failed"] };
    return (map[f.status] ?? []).includes(facts.service.state);
  }
  const cells = f.doc === "any" ? facts.documents : facts.documents.filter((d) => d.key === f.doc);
  if (f.doc !== "any" && cells.length === 0) return false;
  if (f.status === "any") return true;
  if (f.status === "missing") return cells.some((c) => !c.doc);
  return cells.some((c) => c.doc?.document_status === f.status);
}

export interface OverviewCounts {
  totalActive: number;
  needsAttention: number;
  missingDocuments: number;
  serviceIncomplete: number;
  ready: number;
  /** Vehicles counted in more than one of the first three cards. */
  overlapping: number;
}

export function overviewCounts(rows: HubRowLike[]): OverviewCounts {
  let needs = 0;
  let missing = 0;
  let service = 0;
  let ready = 0;
  let overlapping = 0;
  for (const r of rows) {
    const inNeeds = BLOCKER_MATCH.needs_attention(r.facts);
    const inMissing = BLOCKER_MATCH.missing_document(r.facts);
    const inService = BLOCKER_MATCH.k208_pending(r.facts);
    if (inNeeds) needs += 1;
    if (inMissing) missing += 1;
    if (inService) service += 1;
    if (BLOCKER_MATCH.none(r.facts)) ready += 1;
    if ([inNeeds, inMissing, inService].filter(Boolean).length > 1) overlapping += 1;
  }
  return { totalActive: rows.length, needsAttention: needs, missingDocuments: missing, serviceIncomplete: service, ready, overlapping };
}

export type OverviewCardKey = "needs_attention" | "missing_documents" | "service_incomplete" | "ready";

export const OVERVIEW_CARD_FILTER: Record<OverviewCardKey, Partial<HubFilters>> = {
  needs_attention: { blocker: "needs_attention" },
  missing_documents: { blocker: "missing_document" },
  service_incomplete: { blocker: "k208_pending" },
  ready: { blocker: "none" },
};

export function overlapStatement(c: OverviewCounts): string {
  const base = "Cards count vehicles, not issues. A vehicle can be in Needs attention, Missing documents and Service incomplete at once; Ready never overlaps the others.";
  if (c.overlapping === 0) return `${base} No vehicle is in more than one of the first three cards right now.`;
  return `${base} ${c.overlapping} ${c.overlapping === 1 ? "vehicle is" : "vehicles are"} in more than one of the first three cards right now.`;
}

export const pageCount = (total: number, size: number): number => Math.max(1, Math.ceil(total / size));
export const clampPage = (page: number, total: number, size: number): number => Math.min(Math.max(1, page), pageCount(total, size));
export const rangeFor = (page: number, size: number): { from: number; to: number } => ({ from: (page - 1) * size, to: page * size - 1 });
