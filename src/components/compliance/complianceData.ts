import { canonicalCondition } from "@/lib/vehicleCondition";
import { vehicleStockNumber } from "@/lib/vehicleStockNumber";

export type ComplianceSectionId =
  | "overview"
  | "issues"
  | "price"
  | "vin-defense"
  | "titles"
  | "audit"
  | "library";

export const COMPLIANCE_SECTIONS: { id: ComplianceSectionId; label: string; blurb: string }[] = [
  { id: "overview", label: "Overview", blurb: "What needs attention right now" },
  { id: "issues", label: "Issues", blurb: "Every open problem, one row per VIN" },
  { id: "price", label: "Price Integrity", blurb: "Confirmed, feed, and website price per VIN" },
  { id: "vin-defense", label: "VIN Defense", blurb: "Assemble the evidence packet for one VIN" },
  { id: "titles", label: "Titles & MCO", blurb: "Ownership documents on in-stock vehicles" },
  { id: "audit", label: "Audit Log", blurb: "The immutable event record" },
  { id: "library", label: "Library", blurb: "Federal and state disclosure reference" },
];

export const isComplianceSection = (v: unknown): v is ComplianceSectionId =>
  COMPLIANCE_SECTIONS.some((s) => s.id === v);

/** A dollar of drift is drift. Matches the tolerance the nightly crawl reconciles against. */
export const PRICE_TOLERANCE = 1;

export interface ListingRow {
  id: string;
  vin: string;
  ymm: string | null;
  trim: string | null;
  condition: string | null;
  status: string;
  price: number | null;
  doc_fee: number | null;
  price_parse_status: string | null;
  price_last_verified_at: string | null;
  price_source_url: string | null;
  source_url: string | null;
  open_recall_count: number | null;
  recall_status: string | null;
  created_at: string;
  mc_attributes: Record<string, unknown> | null;
  sticker_snapshot: Record<string, unknown> | null;
}

export interface CertificationCheck {
  key?: string;
  label?: string;
  status?: "pass" | "fail" | "warning" | "skip";
  detail?: string;
}

export interface CertificationRunRow {
  id: string;
  vehicle_id: string | null;
  vin: string | null;
  stock: string | null;
  vehicle_title: string | null;
  ready: boolean | null;
  checks: CertificationCheck[] | null;
  certified_at: string;
}

export interface ExceptionRow {
  vin: string;
  exception_type: string;
  severity: string;
  title: string;
  status: string;
}

export interface DocumentFlagRow {
  id: string;
  vehicle_id: string;
  severity: string;
  reason: string;
  changed_field: string | null;
  old_value: unknown;
  new_value: unknown;
  status: string;
  created_at: string;
}

export interface PriceSnapshotRow {
  id: string;
  vin: string;
  advertised_price: number;
  source_channel: string;
  source_url: string | null;
  captured_at: string;
  captured_by: string | null;
}

export interface VehicleDocumentRow {
  vin: string;
  doc_type: string;
  created_at: string;
}

export interface RecallTaskRow {
  vin: string;
  status: string;
  open_recall_count: number | null;
}

export const isActiveListing = (l: { status: string }): boolean => l.status !== "archived";

export const vehicleLabel = (l: Pick<ListingRow, "ymm" | "trim">): string =>
  [l.ymm, l.trim].filter((p) => !!p && String(p).trim()).join(" ").trim() || "Vehicle";

export const listingStock = (l: ListingRow): string | null =>
  vehicleStockNumber({ mc_attributes: l.mc_attributes, sticker_snapshot: l.sticker_snapshot });

export const daysSince = (iso: string | null | undefined, now: number = Date.now()): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
};

export const money = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : "$" + Math.round(n).toLocaleString();

// ──────────────────────────────────────────────────────────────
// Titles & MCO
// ──────────────────────────────────────────────────────────────

export type TitleDocKind = "title" | "mco";

export interface TitleRequirement {
  kind: TitleDocKind;
  label: string;
  front: string;
  back: string;
}

export const titleRequirement = (condition: string | null): TitleRequirement => {
  const canon = canonicalCondition(condition);
  return canon === "new"
    ? { kind: "mco", label: "MCO front and back", front: "mco_front", back: "mco_back" }
    : { kind: "title", label: "Title front and back", front: "title_front", back: "title_back" };
};

export type TitleState = "on_file" | "front_only" | "back_only" | "not_received";

export const TITLE_STATE_LABEL: Record<TitleState, string> = {
  on_file: "On file",
  front_only: "Front only",
  back_only: "Back only",
  not_received: "Not received",
};

export interface TitleRow {
  vehicleId: string;
  vin: string;
  title: string;
  stockNumber: string | null;
  condition: string | null;
  requirement: TitleRequirement;
  state: TitleState;
  ageDays: number | null;
  owner: string | null;
  receivedAt: string | null;
}

export const buildTitleRows = (
  listings: ListingRow[],
  documents: VehicleDocumentRow[],
  ownerEmail: string,
  now: number = Date.now(),
): TitleRow[] => {
  const byVin = new Map<string, Map<string, string>>();
  for (const d of documents) {
    if (!d.vin) continue;
    const key = d.vin.toUpperCase();
    const forVin = byVin.get(key) ?? new Map<string, string>();
    const existing = forVin.get(d.doc_type);
    if (!existing || d.created_at > existing) forVin.set(d.doc_type, d.created_at);
    byVin.set(key, forVin);
  }

  return listings.filter(isActiveListing).map((l) => {
    const requirement = titleRequirement(l.condition);
    const have = byVin.get(l.vin.toUpperCase()) ?? new Map<string, string>();
    const frontAt = have.get(requirement.front) ?? null;
    const backAt = have.get(requirement.back) ?? null;
    const state: TitleState = frontAt && backAt
      ? "on_file"
      : frontAt
        ? "front_only"
        : backAt
          ? "back_only"
          : "not_received";
    const receivedAt = [frontAt, backAt].filter(Boolean).sort().pop() ?? null;
    return {
      vehicleId: l.id,
      vin: l.vin.toUpperCase(),
      title: vehicleLabel(l),
      stockNumber: listingStock(l),
      condition: l.condition,
      requirement,
      state,
      ageDays: daysSince(l.created_at, now),
      owner: ownerEmail.trim() || null,
      receivedAt,
    };
  });
};

// ──────────────────────────────────────────────────────────────
// Price integrity
//
// Three reads of one number live in the schema and they are NOT
// interchangeable:
//   confirmed — a person at the store captured it (source_channel 'manual')
//   feed      — vehicle_listings.price, delivered by the inventory feed
//   website   — the nightly crawl's latest non-zero website snapshot
// A seed row carries advertised_price 0 to mean "no baseline yet"; treating
// it as a real website price paints full-sticker drift on every unscraped car.
// ──────────────────────────────────────────────────────────────

export type PriceState = "matched" | "differs" | "awaiting_snapshot" | "not_monitored" | "no_price";

export const PRICE_STATE_LABEL: Record<PriceState, string> = {
  matched: "Matched",
  differs: "Differs",
  awaiting_snapshot: "Awaiting first snapshot",
  not_monitored: "Not monitored",
  no_price: "No inventory price",
};

export interface PriceEvent {
  id: string;
  at: string;
  kind: "snapshot" | "document_flag";
  label: string;
  detail: string;
  status: string | null;
}

export interface PriceRow {
  vehicleId: string;
  vin: string;
  title: string;
  stockNumber: string | null;
  confirmedPrice: number | null;
  confirmedAt: string | null;
  feedPrice: number | null;
  websitePrice: number | null;
  websiteAt: string | null;
  websiteUrl: string | null;
  referencePrice: number | null;
  referenceLabel: "Dealer-confirmed" | "Feed" | null;
  docFee: number;
  difference: number | null;
  matchedWithDocFee: boolean;
  state: PriceState;
  currentIssue: string | null;
  openFlags: number;
  historicalEvents: number;
  lastCheckedAt: string | null;
  events: PriceEvent[];
}

const isSeedCapture = (s: PriceSnapshotRow): boolean => !s.advertised_price;

/**
 * The lot price may carry the doc fee while the website price may not. Accept
 * either an exact match or an advertised + doc-fee match and report whichever
 * gap is genuinely smaller, so a correctly-priced car is not flagged as drift.
 */
export const reconcileGap = (
  websitePrice: number,
  referencePrice: number,
  docFee: number,
): { difference: number; matchedWithDocFee: boolean } => {
  const raw = websitePrice - referencePrice;
  const withFee = websitePrice + docFee - referencePrice;
  const useFee = docFee > 0 && Math.abs(withFee) < Math.abs(raw);
  return { difference: useFee ? withFee : raw, matchedWithDocFee: useFee };
};

export const buildPriceRows = (args: {
  listings: ListingRow[];
  snapshots: PriceSnapshotRow[];
  flags: DocumentFlagRow[];
  defaultDocFee: number;
}): PriceRow[] => {
  const { listings, snapshots, flags, defaultDocFee } = args;

  const snapsByVin = new Map<string, PriceSnapshotRow[]>();
  for (const s of snapshots) {
    if (!s.vin) continue;
    const key = s.vin.toUpperCase();
    const arr = snapsByVin.get(key) ?? [];
    arr.push(s);
    snapsByVin.set(key, arr);
  }
  for (const arr of snapsByVin.values()) arr.sort((a, b) => (a.captured_at < b.captured_at ? 1 : -1));

  const flagsByVehicle = new Map<string, DocumentFlagRow[]>();
  for (const f of flags) {
    const arr = flagsByVehicle.get(f.vehicle_id) ?? [];
    arr.push(f);
    flagsByVehicle.set(f.vehicle_id, arr);
  }
  for (const arr of flagsByVehicle.values()) arr.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return listings.filter(isActiveListing).map((l) => {
    const vin = l.vin.toUpperCase();
    const snaps = snapsByVin.get(vin) ?? [];
    const vehicleFlags = flagsByVehicle.get(l.id) ?? [];
    const docFee = l.doc_fee != null && l.doc_fee > 0 ? l.doc_fee : defaultDocFee;

    const confirmed = snaps.find((s) => s.source_channel === "manual" && !isSeedCapture(s)) ?? null;
    const website = snaps.find((s) => s.source_channel === "website" && !isSeedCapture(s)) ?? null;
    const feedPrice = l.price != null && l.price > 0 ? l.price : null;
    const referencePrice = confirmed?.advertised_price ?? feedPrice;
    const referenceLabel = confirmed ? "Dealer-confirmed" : feedPrice != null ? "Feed" : null;

    let state: PriceState;
    let difference: number | null = null;
    let matchedWithDocFee = false;
    if (referencePrice == null) {
      state = "no_price";
    } else if (snaps.length === 0) {
      state = "not_monitored";
    } else if (!website) {
      state = "awaiting_snapshot";
    } else {
      const gap = reconcileGap(website.advertised_price, referencePrice, docFee);
      difference = gap.difference;
      matchedWithDocFee = gap.matchedWithDocFee;
      state = Math.abs(gap.difference) >= PRICE_TOLERANCE ? "differs" : "matched";
    }

    const openFlags = vehicleFlags.filter((f) => f.status === "open");
    const blocking = openFlags.find((f) => f.severity === "compliance_block") ?? null;
    let currentIssue: string | null = null;
    if (blocking) currentIssue = blocking.reason;
    else if (state === "differs" && difference != null) {
      currentIssue = `Website price differs by ${money(Math.abs(difference))}`;
    } else if (openFlags.length > 0) currentIssue = openFlags[0].reason;

    const events: PriceEvent[] = [
      ...snaps.map<PriceEvent>((s) => ({
        id: `snap-${s.id}`,
        at: s.captured_at,
        kind: "snapshot",
        label: isSeedCapture(s) ? `${s.source_channel} monitoring started` : `${s.source_channel} snapshot`,
        detail: isSeedCapture(s) ? "Seeded for the nightly crawl, no price captured yet" : money(s.advertised_price),
        status: s.captured_by,
      })),
      ...vehicleFlags.map<PriceEvent>((f) => ({
        id: `flag-${f.id}`,
        at: f.created_at,
        kind: "document_flag",
        label: f.changed_field ? `${f.changed_field} changed` : "Document flagged",
        detail: f.reason,
        status: f.status,
      })),
    ].sort((a, b) => (a.at < b.at ? 1 : -1));

    return {
      vehicleId: l.id,
      vin,
      title: vehicleLabel(l),
      stockNumber: listingStock(l),
      confirmedPrice: confirmed?.advertised_price ?? null,
      confirmedAt: confirmed?.captured_at ?? null,
      feedPrice,
      websitePrice: website?.advertised_price ?? null,
      websiteAt: website?.captured_at ?? null,
      websiteUrl: website?.source_url ?? l.price_source_url ?? l.source_url ?? null,
      referencePrice,
      referenceLabel,
      docFee,
      difference,
      matchedWithDocFee,
      state,
      currentIssue,
      openFlags: openFlags.length,
      historicalEvents: events.length,
      lastCheckedAt: website?.captured_at ?? snaps[0]?.captured_at ?? l.price_last_verified_at ?? null,
      events,
    };
  });
};

/**
 * The number a navigation badge may show: VINs with an unresolved problem.
 * NOT the event rows — a VIN with fourteen historical price events and one
 * live discrepancy is one thing to do, not fifteen.
 */
export const countUnresolvedPriceVins = (rows: PriceRow[]): number =>
  rows.filter((r) => r.state === "differs" || r.openFlags > 0).length;

export const priceRowsNeedingReview = (rows: PriceRow[]): PriceRow[] =>
  rows
    .filter((r) => r.state === "differs" || r.openFlags > 0)
    .sort((a, b) => Math.abs(b.difference ?? 0) - Math.abs(a.difference ?? 0));

// ──────────────────────────────────────────────────────────────
// Issues — one row per VIN, every open problem gathered onto it
// ──────────────────────────────────────────────────────────────

export type IssueCategory = "certification" | "exception" | "price" | "documents" | "recall";

export const ISSUE_CATEGORY_LABEL: Record<IssueCategory, string> = {
  certification: "Certification",
  exception: "Exception",
  price: "Price",
  documents: "Documents",
  recall: "Recall",
};

export type IssueSeverity = "critical" | "attention";

export interface VehicleIssue {
  category: IssueCategory;
  severity: IssueSeverity;
  label: string;
  detail: string;
}

export interface IssueRow {
  vehicleId: string;
  vin: string;
  title: string;
  stockNumber: string | null;
  condition: string | null;
  issues: VehicleIssue[];
  critical: number;
  certificationReady: boolean | null;
  certifiedAt: string | null;
  lastCheckedAt: string | null;
}

export const latestRunByVehicle = (runs: CertificationRunRow[]): Map<string, CertificationRunRow> => {
  const sorted = [...runs].sort((a, b) => (a.certified_at < b.certified_at ? 1 : -1));
  const out = new Map<string, CertificationRunRow>();
  for (const r of sorted) {
    const keys = [r.vehicle_id, r.vin ? r.vin.toUpperCase() : null].filter(Boolean) as string[];
    for (const k of keys) if (!out.has(k)) out.set(k, r);
  }
  return out;
};

const openCheck = (c: CertificationCheck): boolean => !!c.status && c.status !== "pass" && c.status !== "skip";

export const buildIssueRows = (args: {
  listings: ListingRow[];
  runs: CertificationRunRow[];
  exceptions: ExceptionRow[];
  priceRows: PriceRow[];
  titleRows: TitleRow[];
  recallTasks: RecallTaskRow[];
}): IssueRow[] => {
  const { listings, runs, exceptions, priceRows, titleRows, recallTasks } = args;
  const runByKey = latestRunByVehicle(runs);
  const priceByVehicle = new Map(priceRows.map((r) => [r.vehicleId, r]));
  const titleByVehicle = new Map(titleRows.map((r) => [r.vehicleId, r]));

  const exByVin = new Map<string, ExceptionRow[]>();
  for (const e of exceptions) {
    if (!e.vin) continue;
    const key = e.vin.toUpperCase();
    const arr = exByVin.get(key) ?? [];
    arr.push(e);
    exByVin.set(key, arr);
  }

  const reviewRecallVins = new Set(
    recallTasks.filter((t) => t.status === "open_review" && t.vin).map((t) => t.vin.toUpperCase()),
  );

  return listings.filter(isActiveListing).map((l) => {
    const vin = l.vin.toUpperCase();
    const run = runByKey.get(l.id) ?? runByKey.get(vin) ?? null;
    const price = priceByVehicle.get(l.id) ?? null;
    const title = titleByVehicle.get(l.id) ?? null;
    const issues: VehicleIssue[] = [];

    if (run && run.ready === false) {
      const failing = (run.checks ?? []).filter(openCheck);
      if (failing.length === 0) {
        issues.push({
          category: "certification",
          severity: "attention",
          label: "Certification not ready",
          detail: "The latest certification run did not clear.",
        });
      }
      for (const c of failing) {
        issues.push({
          category: "certification",
          severity: c.status === "fail" ? "critical" : "attention",
          label: c.label || c.key || "Certification check",
          detail: c.detail || "Open certification check.",
        });
      }
    }

    for (const e of exByVin.get(vin) ?? []) {
      issues.push({
        category: "exception",
        severity: e.severity === "critical" ? "critical" : "attention",
        label: e.title || e.exception_type,
        detail: `${e.severity} exception, ${e.status.replace("_", " ")}`,
      });
    }

    if (price?.currentIssue) {
      issues.push({
        category: "price",
        severity: price.openFlags > 0 && price.state !== "differs" ? "attention" : "critical",
        label: price.currentIssue,
        detail: price.referenceLabel
          ? `${price.referenceLabel} ${money(price.referencePrice)} vs website ${money(price.websitePrice)}`
          : "No reference price on record.",
      });
    }

    if (title && title.state !== "on_file") {
      issues.push({
        category: "documents",
        severity: "attention",
        label: `${title.requirement.label} ${TITLE_STATE_LABEL[title.state].toLowerCase()}`,
        detail: title.owner ? `Owner ${title.owner}` : "No title clerk configured.",
      });
    }

    const openRecalls = l.open_recall_count ?? 0;
    if (openRecalls > 0) {
      issues.push({
        category: "recall",
        severity: "critical",
        label: `${openRecalls} open NHTSA recall${openRecalls === 1 ? "" : "s"}`,
        detail: "Count carried on the vehicle record from the last NHTSA check.",
      });
    } else if (reviewRecallVins.has(vin)) {
      issues.push({
        category: "recall",
        severity: "attention",
        label: "Recall review required",
        detail: "A recall service task is open and awaiting an outcome.",
      });
    }

    return {
      vehicleId: l.id,
      vin,
      title: vehicleLabel(l),
      stockNumber: listingStock(l),
      condition: l.condition,
      issues,
      critical: issues.filter((i) => i.severity === "critical").length,
      certificationReady: run ? run.ready : null,
      certifiedAt: run?.certified_at ?? null,
      lastCheckedAt: price?.lastCheckedAt ?? run?.certified_at ?? null,
    };
  });
};

// ──────────────────────────────────────────────────────────────
// Overview
//
// Every tile below counts a DIFFERENT population. They are not
// reconciled to each other on purpose; each carries the sentence
// that says exactly what it counts.
// ──────────────────────────────────────────────────────────────

export interface OverviewCounts {
  activeInventory: number;
  critical: number;
  needsReview: number;
  missingEvidence: number;
  auditReady: number;
  openRecallVehicles: number;
  recallReviewTasks: number;
  uncertified: number;
}

export const buildOverview = (args: {
  issueRows: IssueRow[];
  titleRows: TitleRow[];
  recallTasks: RecallTaskRow[];
}): OverviewCounts => {
  const { issueRows, titleRows, recallTasks } = args;
  const titleByVehicle = new Map(titleRows.map((r) => [r.vehicleId, r]));
  const critical = issueRows.filter((r) => r.critical > 0).length;
  const needsReview = issueRows.filter((r) => r.certificationReady === false).length;
  const missingEvidence = titleRows.filter((r) => r.state !== "on_file").length;
  const auditReady = issueRows.filter((r) => {
    const title = titleByVehicle.get(r.vehicleId);
    return r.issues.length === 0 && r.certificationReady === true && title?.state === "on_file";
  }).length;
  return {
    activeInventory: issueRows.length,
    critical,
    needsReview,
    missingEvidence,
    auditReady,
    openRecallVehicles: issueRows.filter((r) =>
      r.issues.some((i) => i.category === "recall" && i.severity === "critical"),
    ).length,
    recallReviewTasks: recallTasks.filter((t) => t.status === "open_review").length,
    uncertified: issueRows.filter((r) => r.certificationReady === null).length,
  };
};
