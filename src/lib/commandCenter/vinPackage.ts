import type { GetReadyItem } from "@/hooks/useGetReady";
import { vinKey } from "@/lib/vinKeys";
import { columnFor } from "./getReadyColumns";
import { currentDocumentOfType } from "./documentSet";
import { fmtDate, humanize } from "./format";
import { k208State, type SafetyInspectionRow } from "./inspectionState";
import { vehicleQrPackageState } from "./vehicleQrToken";
import type { PackageItemStatus } from "./packageState";
import type { ReaderRow } from "./sourceReader";

// ──────────────────────────────────────────────────────────────────────
// The Automated Intake Package, built as a pure function of rows that were
// actually read. It is extracted from the loader so the readiness invariant is
// testable end to end: "every artifact finished" has to be a reachable state,
// and the only way to prove that is to build the real ten rows from real
// fixtures and count them.
//
// The rule every row here obeys: a state that means "an artifact EXISTS" is
// never emitted as "the work is FINISHED" — and, just as importantly, every row
// in the denominator has a reachable finished state. Narrowing the numerator
// (countFinished) below a denominator containing a row that can never satisfy
// it makes "Ready to Market" a dead branch for every vehicle, which is exactly
// what happened when Rear Service QR could only ever emit `created`.
// ──────────────────────────────────────────────────────────────────────

export interface PackageItem {
  key: string; label: string; status: PackageItemStatus;
  detail: string; href?: string; docId?: string;
}

type ItemState = { status: PackageItemStatus; detail: string };

export interface VinPackageSources {
  vehicleId: string;
  vin: string;
  used: boolean;
  /** Get Ready has been authorized and dispatched for this vehicle. */
  dispatched: boolean;
  /** generated_documents, already filtered to the live package. */
  liveDocs: ReaderRow[];
  inspection: { latestSigned: SafetyInspectionRow | null; latest: SafetyInspectionRow | null };
  addendum: ReaderRow | null;
  recall: {
    checkedAt: string | null;
    doNotDrive: boolean;
    openCount: number;
    /** recall_service_tasks for this vehicle, newest first. */
    tasks: ReaderRow[];
  };
  /**
   * dept_signoff_tokens for this vehicle (department 'vehicle', purpose
   * 'get_ready') — the artifact /print/vehicle-qr mints, and the ONLY thing
   * either QR row is measured from. See vehicleQrToken.ts.
   */
  qrTokens: ReaderRow[];
  getReady: { record: ReaderRow | null; items: GetReadyItem[] };
  description: { row: ReaderRow | null; channelCount: number };
}

// generated_documents lifecycle → package-item status. Nothing here invents a
// state: an absent row is "pending / Not started".
export function docPackageStatus(d: ReaderRow | null): ItemState {
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

export function k208PackageState(sources: VinPackageSources["inspection"]): ItemState {
  const k208 = k208State(sources);
  if (k208.state === "failed") return { status: "blocked", detail: "Inspection failed — vehicle cannot be listed" };
  if (k208.state === "signed") return { status: "ready", detail: `Signed ${fmtDate(k208.at)}`.trim() };
  if (k208.state === "prefilled") return { status: "prefilled", detail: "Prefilled, awaiting inspection" };
  return { status: "pending", detail: "Not started" };
}

export function addendumPackageState(add: ReaderRow | null): ItemState {
  if (!add) return { status: "pending", detail: "Not started" };
  if (add.customer_signed_at) return { status: "published", detail: `Signed ${fmtDate(add.customer_signed_at)}` };
  if (add.accepted_at) return { status: "ready", detail: `Accepted ${fmtDate(add.accepted_at)}` };
  if (add.ready_at) return { status: "created", detail: `Ready ${fmtDate(add.ready_at)}` };
  return { status: "draft_created", detail: `Draft created ${fmtDate(add.created_at)}` };
}

/**
 * The recall row answers ONE question: will the database let this vehicle be
 * published? 20260627070000:56-63 blocks publish while ANY recall_service_task
 * is `open_review`, and 20260627060000:126-135 raises a NEW task whenever the
 * campaign signature changes — so a resolved May task and an open July task
 * coexisting is normal, not contradictory. Reading "some task is resolved" as
 * "the recall is handled" rendered a green "Ready · Resolved by service" with
 * no date, dropped the vehicle out of both the exception count and the blocking
 * panel, and left the manager staring at a publish the database refuses.
 */
export function recallPackageState(r: VinPackageSources["recall"]): ItemState {
  const openTask = r.tasks.find((t) => String(t.status || "") === "open_review") || null;
  const resolvedTask = r.tasks.find((t) => String(t.status || "") === "resolved") || null;
  const openCount = openTask && typeof openTask.open_recall_count === "number"
    ? Math.max(r.openCount, openTask.open_recall_count as number)
    : r.openCount;
  const plural = (n: number) => `${n} open recall${n === 1 ? "" : "s"}`;
  if (!r.checkedAt) return { status: "pending", detail: "Not started" };
  if (r.doNotDrive) return { status: "blocked", detail: "Do-not-drive campaign open — publishing is blocked" };
  if (openTask) {
    return { status: "retry_required", detail: `${plural(Math.max(openCount, 1))} — service review required` };
  }
  if (r.openCount > 0 && resolvedTask) {
    return { status: "ready", detail: `Resolved by service ${fmtDate(resolvedTask.completed_at as string | null)}`.trim() };
  }
  if (r.openCount > 0) {
    return { status: "retry_required", detail: `${plural(r.openCount)} — service review required` };
  }
  return { status: "ready", detail: `Checked ${fmtDate(r.checkedAt)} · no open recalls` };
}

export function getReadyHalfState(args: {
  record: ReaderRow | null;
  list: GetReadyItem[];
  dispatched: boolean;
  noneDetail: string;
}): ItemState {
  const { record, list, dispatched, noneDetail } = args;
  if (!record) return { status: "pending", detail: "Not started" };
  // A record with no line in this half has no outstanding work in it. Calling
  // that "pending" left a vehicle whose get-ready is all service work unable to
  // ever reach 100% or "Ready to Market".
  if (list.length === 0) return { status: "ready", detail: noneDetail };
  const done = list.filter((i) => i.status === "complete").length;
  if (done === list.length) return { status: "ready", detail: `${done} of ${list.length} complete` };
  return { status: dispatched ? "created" : "prefilled", detail: `${done} of ${list.length} complete` };
}

export function descriptionPackageState(d: VinPackageSources["description"]): ItemState {
  const { row, channelCount } = d;
  if (!row) return { status: "pending", detail: "Not started" };
  const s = String(row.status || "");
  const sectionDetail = channelCount > 0
    ? `${channelCount} section${channelCount === 1 ? "" : "s"} generated`
    : "No sections generated yet";
  if (s === "PUBLISHED") return { status: "published", detail: sectionDetail };
  if (s === "READY") return { status: "ready", detail: sectionDetail };
  if (s === "REVIEW_REQUIRED") {
    const n = Number(row.open_exception_count || 0);
    return { status: "retry_required", detail: `Review required · ${n} open exception${n === 1 ? "" : "s"}` };
  }
  if (s === "FAILED_BLOCKED") return { status: "blocked", detail: row.last_error_message ? String(row.last_error_message) : "Generation blocked" };
  if (s === "FAILED_RETRYABLE") return { status: "retry_required", detail: "Generation failed — retry" };
  if (s === "STALE") return { status: "retry_required", detail: "Source data changed — regenerate" };
  // ARCHIVED is a real CHECK value (20260725000000:67) and means the case was
  // retired — the fallback below was counting it as an artifact that exists.
  if (s === "ARCHIVED") return { status: "pending", detail: "Archived — no live description" };
  if (s === "PARTIALLY_PUBLISHED") return { status: "created", detail: `Partially published · ${sectionDetail}` };
  return channelCount > 0
    ? { status: "created", detail: sectionDetail }
    : { status: "pending", detail: humanize(s || "not started") };
}

export function buildVinPackageItems(s: VinPackageSources): PackageItem[] {
  const { vehicleId, vin, used } = s;
  const items: PackageItem[] = [];
  const latestOfType = (type: string): ReaderRow | null => currentDocumentOfType(s.liveDocs, type);

  // K-208 and the FTC Buyers Guide are used-car artifacts; including them for a
  // new car would report a permanently incomplete automation total.
  if (used) {
    items.push({
      key: "k208", label: "K-208", ...k208PackageState(s.inspection),
      href: vin ? `/k208/${vinKey(vin)}` : undefined,
    });
    const bg = latestOfType("buyers_guide");
    items.push({
      key: "buyers_guide", label: "FTC Buyers Guide", ...docPackageStatus(bg),
      href: (bg?.pdf_url as string) || `/vehicle-file/${vehicleId}?tab=documents`,
      docId: bg?.id as string | undefined,
    });
  }

  items.push({
    key: "addendum", label: used ? "Used Addendum" : "Addendum",
    ...addendumPackageState(s.addendum),
    href: `/vehicle-file/${vehicleId}?tab=addendum`,
    docId: s.addendum?.id as string | undefined,
  });

  const win = latestOfType("window");
  items.push({
    key: "window_sticker", label: used ? "Used-Car Sticker" : "Window Sticker",
    ...docPackageStatus(win),
    href: (win?.pdf_url as string) || `${used ? "/used-car-sticker" : "/new-car-sticker"}?vehicleId=${vehicleId}`,
    docId: win?.id as string | undefined,
  });

  items.push({
    key: "recall", label: "Recall Lookup", ...recallPackageState(s.recall),
    href: `/vehicle-file/${vehicleId}?tab=overview`,
  });

  // Both rows link to /print/vehicle-qr and both are now measured from what that
  // page mints, so a row's link and a row's status can no longer describe
  // different artifacts.
  items.push({
    key: "service_qr", label: "Rear Service QR",
    ...vehicleQrPackageState(s.qrTokens, "Rear-glass cling"),
    href: vin ? `/print/vehicle-qr/${vinKey(vin)}` : undefined,
  });

  items.push({
    key: "key_tag_qr", label: "Key-Tag QR",
    ...vehicleQrPackageState(s.qrTokens, "Key-fob tag"),
    href: vin ? `/print/vehicle-qr/${vinKey(vin)}` : undefined,
  });

  const svcItems = s.getReady.items.filter((i) => columnFor(i) === "service");
  const prepItems = s.getReady.items.filter((i) => columnFor(i) !== "service");
  items.push({
    key: "get_ready_service", label: "Service Get Ready",
    ...getReadyHalfState({ record: s.getReady.record, list: svcItems, dispatched: s.dispatched, noneDetail: "No service work items" }),
    href: `/get-ready-command/${vehicleId}`,
  });
  items.push({
    key: "get_ready_prep", label: "Prep & Vendors",
    ...getReadyHalfState({ record: s.getReady.record, list: prepItems, dispatched: s.dispatched, noneDetail: "No prep or vendor work items" }),
    href: `/get-ready-command/${vehicleId}`,
  });

  items.push({
    key: "description", label: "Description", ...descriptionPackageState(s.description),
    href: `/description-intelligence/${vehicleId}`,
  });

  return items;
}
