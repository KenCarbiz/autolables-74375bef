// Get Ready, Documents and Compliance: the three sections where the current
// system's answer is not wrong so much as unearned.
//
// Each one exists because a store that LOOKS like evidence is not evidence:
//
//   - Get Ready (§36). Every pilot `get_ready_records` row was minted by the
//     nightly `create_draft_get_ready` sweep (`created_by = ingest_autogen`,
//     143 current + 106 historical_sold + 26 orphaned, `status = pending` on
//     all of them, 0 with a completion stamp). A row that a sweep created is
//     a task list. Only a completion event — a signed inspection, a signed
//     prep sheet, an approved estimate a person approved, a completed work
//     item — is work done, and `fromCompletedWork` says which of the two the
//     caller is looking at.
//   - Documents. `signed_document_archive` is named for signatures and
//     written for drafts: `generate-vehicle-forms` files every rendered PDF
//     into it (`generate-vehicle-forms/index.ts:358-363`), and `created_by`
//     is null on all 355 archive rows covering the 130 active pilot cars. It
//     proves a PDF with that hash is retained; it does not prove anyone
//     signed it. Both stores are therefore reported, with what each said.
//   - Compliance. Recall lives in three columns' worth of stores with three
//     different coverages, and 74 of the 130 active pilot cars carry a
//     payload whose note says the federal lookup returned HTTP 400 while
//     `open_recall_count` still reads 0. A failed lookup presented as "no
//     open recalls" is the single most dangerous value in this file, so a
//     count is emitted only from a check that completed.
//
// Nothing here is persisted and nothing here changes a rendered value; this
// is the shadow read model (directive §50).

import type { Confidence, SourceKind } from "../vehicleTruth/precedence.ts";
import type {
  ComplianceSection,
  DocumentsSection,
  FieldCandidate,
  GetReadySection,
  LicenseClass,
} from "./readModelTypes.ts";
import { emptyField, resolveField } from "./resolveField.ts";
import { arr, bool, iso, latestStamp, num, obj, str, type Row, type VehicleFileSources } from "./sources.ts";

// GetReadySection and DocumentsSection carry no FieldCandidate, so they have
// nowhere to state a licence: everything in them is our own operational and
// document state, which CUSTOMER_DISPLAY_LICENSE_MATRIX row 31 places at
// INTERNAL USE CLEARED. Only the compliance fields below can express one.

/** NHTSA, asserted in code as a free federal source (matrix rows 17 and 18). */
const FEDERAL: LicenseClass = "CUSTOMER_DISPLAY_CLEARED";
/** MarketCheck AutoRecalls and the CARFAX-relayed title flag (matrix rows 14, 17). */
const REVIEW: LicenseClass = "UNKNOWN_REVIEW_REQUIRED";

interface CandidateInput<T> {
  value: T | null;
  source: SourceKind;
  origin: string;
  provider: string;
  observedAt: string | null;
  confidence: Confidence;
  license: LicenseClass;
  note?: string;
}

/**
 * `FieldCandidate.value` is typed `T` and a null-valued candidate is still
 * worth constructing: when EVERY candidate is empty `resolveField` returns
 * them all, so the origins of the stores that had no answer are named in the
 * result rather than vanishing. (When at least one candidate has a value the
 * empty ones are dropped from `candidates`, which is why the recall stores
 * that hold nothing are also named in `blockers` below.) This cast is the
 * single place the two shapes are reconciled, as in `dealerState.ts`.
 */
const candidate = <T>(input: CandidateInput<T>): FieldCandidate<T> =>
  ({ ...input, value: input.value as T });

const lower = (value: unknown): string => (str(value) ?? "").toLowerCase();

/** A table the fetcher could not read at all, so its silence is not an answer. */
const couldNotRead = (sources: VehicleFileSources, table: string): boolean =>
  sources.missing.some((entry) => entry.toLowerCase().includes(table));

// ── Get Ready (directive §36) ───────────────────────────────────────

const TERMINAL_WORK_STATUS = new Set([
  "completed",
  "complete",
  "done",
  "closed",
  "cancelled",
  "canceled",
  "resolved",
  "dismissed",
]);

const USED_LIKE = new Set(["used", "cpo", "certified"]);

/** A clearance state the RPC emits when nothing blocks delivery (`clearance.ts:12`). */
const CLEARED_FOR_DELIVERY = "cleared_for_delivery";

const isSignedInspection = (row: Row): boolean =>
  lower(row.status) === "signed" && iso(row.signed_at) != null && iso(row.voided_at) == null;

const completedItems = (record: Row | null): number =>
  arr(record?.items).filter((item) => lower(obj(item).status) === "complete").length;

export function buildGetReady(sources: VehicleFileSources): GetReadySection {
  const record = sources.getReady;
  const listing = sources.listing;
  const clearance = sources.deliveryClearance;
  const condition = lower(listing?.condition);
  const usedLike = USED_LIKE.has(condition);
  const published = lower(listing?.status) === "published";

  const signedInspections = sources.safetyInspections.filter(isSignedInspection);
  const inspectionSigned = signedInspections.length > 0;
  const failedInspection = signedInspections.find((row) => lower(row.result) === "fail") ?? null;
  const liveInspections = sources.safetyInspections.filter((row) => lower(row.status) !== "voided");

  const signedPrep = sources.prepSignOffs.filter(
    (row) => iso(row.signed_at) != null && lower(row.status) !== "rejected",
  );
  const prepSignedOff = signedPrep.length > 0;
  const listingUnlocked = signedPrep.some((row) => bool(row.listing_unlocked) === true);

  // `origin = 'ingest'` marks an estimate the nightly seeder wrote; the one
  // pilot row that reads `status = approved` carries `submitted_by =
  // 'Auto-ingest', submitted_role = 'system'` and no approver column exists on
  // the table, so nothing on that row records a person approving anything.
  const approvedRecon = sources.reconEstimates.filter(
    (row) => lower(row.status) === "approved" && lower(row.origin) !== "ingest",
  );
  const reconApproved = approvedRecon.length > 0;
  const seededApprovedRecon = sources.reconEstimates.filter(
    (row) => lower(row.status) === "approved" && lower(row.origin) === "ingest",
  ).length;

  const openWorkItems = sources.workItems.filter(
    (row) => !TERMINAL_WORK_STATUS.has(lower(row.status)),
  );
  const completedWorkItems = sources.workItems.filter(
    (row) => lower(row.status) === "completed" || iso(row.completed_at) != null,
  );

  const clearanceState = clearance ? str(clearance.state) : null;
  const clearanceReasons = arr(clearance?.reason_codes).map((code) => str(code)).filter(
    (code): code is string => code != null,
  );
  const deliveryCleared = clearanceState === CLEARED_FOR_DELIVERY;

  const recordCompleteAt = record ? iso(record.get_ready_complete_date) : null;
  const recordInspectionComplete = record ? bool(record.inspection_complete) === true : false;
  const itemsComplete = completedItems(record);
  const recordShowsCompletion = recordCompleteAt != null || recordInspectionComplete || itemsComplete > 0;

  const fromCompletedWork = inspectionSigned
    || prepSignedOff
    || reconApproved
    || completedWorkItems.length > 0
    || recordShowsCompletion;

  const blockers: string[] = [];

  if (clearanceState && !deliveryCleared) {
    blockers.push(
      `Delivery clearance is ${clearanceState}`
        + `${clearanceReasons.length ? ` (${clearanceReasons.join(", ")})` : ""}`
        + `${iso(clearance?.computed_at) ? `, computed ${iso(clearance?.computed_at)}` : ""}.`,
    );
  } else if (!clearance) {
    blockers.push(
      couldNotRead(sources, "vehicle_delivery_clearance")
        ? "vehicle_delivery_clearance could not be read, so delivery readiness is unknown, not cleared."
        : "No vehicle_delivery_clearance row exists for this vehicle; recompute_delivery_clearance has "
          + "never run for it, so nothing has evaluated whether it may be delivered.",
    );
  }

  if (published && clearanceState && !deliveryCleared) {
    blockers.push(
      "This vehicle is published to the customer Passport while delivery clearance still blocks it. "
        + "No publish gate reads this store: enforce_prep_gate tests only recall_check->>'do_not_drive' "
        + "and the admin role bypasses it entirely, which is how all 58 used pilot cars went live while "
        + "all 58 read blocked_inspection_not_started.",
    );
  }

  if (usedLike && !inspectionSigned) {
    blockers.push(
      liveInspections.length
        ? `Safety inspection not signed: ${liveInspections.length} live row(s), newest `
          + `${lower(liveInspections[0].status) || "unknown"}`
          + `${str(liveInspections[0].inspection_state) ? ` / ${str(liveInspections[0].inspection_state)}` : ""}. `
          + "A K-208 is only published by trg_autopublish_k208_on_signoff on a signed inspection."
        : "No safety inspection row exists for this used vehicle, so the CT K-208 cannot be executed.",
    );
  }

  if (failedInspection) {
    blockers.push(
      `The signed safety inspection failed${
        str(failedInspection.failure_notes) ? `: ${str(failedInspection.failure_notes)}` : "."
      } trg_autopublish_k208_on_signoff returns the K-208 to draft on a signed fail.`,
    );
  }

  if (!prepSignedOff) {
    blockers.push(
      "No prep sign-off exists (prep_sign_offs has 0 rows tenant-wide). The product rule is that a "
        + "vehicle cannot be listed until the foreman sign-off carries listing_unlocked = true, but the "
        + "live enforce_prep_gate() contains no prep condition, so nothing enforces it.",
    );
  } else if (!listingUnlocked) {
    blockers.push("A prep sign-off is signed but no row carries listing_unlocked = true.");
  }

  if (openWorkItems.length) {
    const types = [...new Set(openWorkItems.map((row) => str(row.work_type) ?? "untyped"))].slice(0, 3);
    blockers.push(
      `${openWorkItems.length} open work item(s) (${types.join(", ")}). Every pilot work item is `
        + "source = 'vehicle_exception', so these are exceptions raised by the feed sync, not tasks a "
        + "person opened.",
    );
  }

  if (!record) {
    blockers.push(
      couldNotRead(sources, "get_ready_records")
        ? "get_ready_records could not be read, so Get Ready state is unknown, not clear."
        : "No get_ready_records row exists for this vehicle.",
    );
  } else if (!fromCompletedWork) {
    blockers.push(
      `Nothing in Get Ready has been executed: the record was created by `
        + `${str(record.created_by) ?? "an untagged writer"}, status ${str(record.status) ?? "unset"}, `
        + `${arr(record.items).length} item(s) with none complete, no completion date and no signed `
        + "inspection. A seeded record is not work done.",
    );
  }

  if (seededApprovedRecon > 0 && !reconApproved) {
    blockers.push(
      `${seededApprovedRecon} recon estimate(s) read status 'approved' but carry origin = 'ingest' `
        + "(submitted_by 'Auto-ingest', submitted_role 'system'). The table has no approver column, so "
        + "no person is recorded as having approved them and they are not counted as approved here.",
    );
  }

  return {
    stage: sources.lifecycle ? str(sources.lifecycle.state) : null,
    status: record ? str(record.status) : null,
    fromCompletedWork,
    inspectionSigned,
    reconApproved,
    prepSignedOff,
    deliveryCleared,
    openWorkItems: openWorkItems.length,
    blockers,
  };
}

// ── Documents ───────────────────────────────────────────────────────

/** `generated_documents.document_status`, best first. */
const LIVE_STATUS_RANK: Record<string, number> = {
  published: 0,
  printed: 1,
  approved: 2,
  pending_approval: 3,
  draft: 4,
};

const RETIRED_STATUS = new Set(["superseded", "archived", "rejected", "retired"]);

/** The statuses `process-deal` accepts as a filed document (`process-deal/index.ts:94`). */
const DEAL_GATE_STATUS = new Set(["approved", "printed", "published"]);

const statusRank = (row: Row): number => {
  const rank = LIVE_STATUS_RANK[lower(row.document_status)];
  return rank === undefined ? LIVE_STATUS_RANK.draft + 1 : rank;
};

const docStamp = (row: Row): string =>
  latestStamp(row.published_at, row.approved_at, row.printed_at, row.updated_at, row.created_at) ?? "";

const liveDocuments = (rows: Row[], types: string[]): Row[] =>
  rows
    .filter((row) => types.includes(lower(row.document_type)) && !RETIRED_STATUS.has(lower(row.document_status)))
    .sort((a, b) => {
      const byStatus = statusRank(a) - statusRank(b);
      if (byStatus !== 0) return byStatus;
      const byVersion = (num(b.version) ?? 0) - (num(a.version) ?? 0);
      if (byVersion !== 0) return byVersion;
      return docStamp(b).localeCompare(docStamp(a));
    });

const archiveRows = (rows: Row[], types: string[]): Row[] =>
  rows
    .filter((row) => types.includes(lower(row.doc_type)))
    .sort((a, b) => (iso(b.created_at) ?? "").localeCompare(iso(a.created_at) ?? ""));

const hasArtifact = (row: Row): boolean => str(row.pdf_url) != null || str(row.online_url) != null;

/**
 * One sentence naming both stores and what each said.
 *
 * `present` answers "is there a retrievable artifact", which is what the
 * section is called; whether the artifact satisfies a compliance requirement
 * is a different question, and it is answered in `ComplianceSection.blockers`
 * — because on the pilot the deal gate says no Buyers Guide for 57 of 58 used
 * cars while 129 archived Buyers Guide PDFs exist over 71 VINs, and a single
 * boolean that tried to mean both would be wrong for one of the two readers.
 */
const describeDocument = (
  label: string,
  live: Row[],
  retired: number,
  archived: Row[],
): string => {
  const best = live[0];
  const parts: string[] = [];
  if (best) {
    parts.push(
      `generated_documents: ${lower(best.document_type)} ${lower(best.document_status) || "status unset"}`
        + `${num(best.version) != null ? ` v${num(best.version)}` : ""}`
        + `${hasArtifact(best) ? " with a PDF" : " with no PDF or online URL"}`
        + `${live.length > 1 ? `, plus ${live.length - 1} other live row(s)` : ""}`
        + `${retired ? `, ${retired} retired` : ""}`,
    );
    parts.push(
      DEAL_GATE_STATUS.has(lower(best.document_status))
        ? "the deal gate (approved/printed/published) counts it as filed"
        : "the deal gate (approved/printed/published) does not count it as filed",
    );
  } else {
    parts.push(
      retired
        ? `generated_documents: no live ${label} row (${retired} retired)`
        : `generated_documents: no ${label} row`,
    );
  }
  if (archived.length) {
    const signers = archived.filter((row) => str(row.created_by) != null).length;
    parts.push(
      `signed_document_archive: ${archived.length} retained PDF(s), newest `
        + `${iso(archived[0].created_at) ?? "unstamped"}, ${signers} with a created_by`
        + (signers === 0
          ? " -- generate-vehicle-forms files every rendered draft here, so this is retention evidence, not a signature"
          : ""),
    );
  } else {
    parts.push("signed_document_archive: no retained PDF");
  }
  return `${parts.join("; ")}.`;
};

export function buildDocuments(sources: VehicleFileSources): DocumentsSection {
  const generated = sources.generatedDocuments;
  const retiredOf = (types: string[]): number =>
    generated.filter(
      (row) => types.includes(lower(row.document_type)) && RETIRED_STATUS.has(lower(row.document_status)),
    ).length;

  const buyersGuideLive = liveDocuments(generated, ["buyers_guide"]);
  const buyersGuideArchive = archiveRows(sources.signedDocuments, ["buyers_guide"]);

  // Both are window stickers: `window` is the sticker AutoLabels prints for
  // the car, `factory_sticker` is the reproduction of the factory Monroney.
  // They are ranked together and the source line names which one answered,
  // because a vehicle can carry either, both, or neither.
  const windowLive = liveDocuments(generated, ["window", "factory_sticker"]);
  const windowArchive = archiveRows(sources.signedDocuments, ["window", "factory_sticker", "sticker"]);

  const addendumLive = liveDocuments(generated, ["addendum"]);
  const addendumArchive = archiveRows(sources.signedDocuments, ["addendum"]);

  // De-duplicated per (document, field). `stale_document_flags` has SELECT,
  // INSERT and UPDATE policies and no DELETE policy, so the client reconcile
  // path's delete matches zero rows under RLS with the error swallowed and its
  // insert then adds one more set on every Documents-tab visit: 7,079 open
  // duplicates of one `price` flag on one document today. A raw count is a
  // count of page visits, not of stale documents.
  const seen = new Map<string, { documentId: string; field: string; since: string | null }>();
  for (const flag of sources.staleFlags) {
    if (lower(flag.status) !== "open") continue;
    const documentId = str(flag.generated_document_id);
    if (!documentId) continue;
    const field = str(flag.changed_field) ?? "unspecified";
    const key = `${documentId}|${field}`;
    const since = iso(flag.created_at);
    const prior = seen.get(key);
    if (!prior) {
      seen.set(key, { documentId, field, since });
    } else if (since && (!prior.since || since < prior.since)) {
      // The oldest open flag is when the document actually went stale; the
      // duplicates behind it are re-inserts of the same finding.
      prior.since = since;
    }
  }
  const staleFlags = [...seen.values()].sort(
    (a, b) =>
      (a.since ?? "").localeCompare(b.since ?? "")
      || a.documentId.localeCompare(b.documentId)
      || a.field.localeCompare(b.field),
  );

  const oemStickerUrl = sources.listing ? str(sources.listing.oem_sticker_url) : null;

  return {
    buyersGuide: {
      present: buyersGuideLive.some(hasArtifact) || buyersGuideArchive.length > 0,
      source: describeDocument("buyers_guide", buyersGuideLive, retiredOf(["buyers_guide"]), buyersGuideArchive),
      documentId: buyersGuideLive[0] ? str(buyersGuideLive[0].id) : null,
    },
    windowSticker: {
      present: windowLive.some(hasArtifact) || windowArchive.length > 0,
      source: describeDocument(
        "window sticker",
        windowLive,
        retiredOf(["window", "factory_sticker"]),
        windowArchive,
      ),
      documentId: windowLive[0] ? str(windowLive[0].id) : null,
    },
    addendum: {
      present: addendumLive.some(hasArtifact) || addendumArchive.length > 0,
      documentId: addendumLive[0] ? str(addendumLive[0].id) : null,
    },
    oemSticker: {
      // `oem_sticker_url` is null on 130/130 pilot rows because
      // `oem-window-sticker` returns not_configured without a VinAudit or
      // MonroneyLabels key. The factory-sticker reproduction is NOT this.
      present: oemStickerUrl != null,
      url: oemStickerUrl,
    },
    staleFlags,
    counts: {
      generated: generated.filter((row) => !RETIRED_STATUS.has(lower(row.document_status))).length,
      signed: sources.signedDocuments.length,
      stale: staleFlags.length,
    },
  };
}

// ── Compliance ──────────────────────────────────────────────────────

/**
 * The do-not-drive test `marketcheck-recalls` uses when it writes
 * `recall_check.do_not_drive` (`marketcheck-recalls/index.ts:170`). It is
 * mirrored rather than trusted, because the boolean it produces is stored on
 * 10 of 130 active pilot rows while a recall payload is stored on all 130 —
 * so on 120 cars the only copy of the answer the publish gate reads does not
 * exist. Applying the writer's own test to the payload text finds 0 more
 * matches on the pilot today, which is the point: it adds no false alarm and
 * closes the gap if a campaign ever arrives on a car with no `recall_check`.
 */
const DO_NOT_DRIVE = /do not drive|stop sale|park outside|fire risk/i;

/** Campaign keys the writer's own test reads, plus the NHTSA payload's `summary`. */
const CAMPAIGN_TEXT_KEYS = ["title", "description", "summary", "consequence"];

/** A `note` that means the lookup did not return a record, not that the car is clean. */
const FAILED_LOOKUP = /(^|_)no_[a-z]*_?record|error|fail|http_\d{3}|rate[_ ]?limit|not_found|unavailable/i;

interface RecallProvider {
  kind: SourceKind;
  name: string;
  license: LicenseClass;
  confidence: Confidence;
}

const providerOf = (payload: Row): RecallProvider => {
  const source = lower(payload.source);
  const raw = lower(payload.rawProvider);
  if (source === "nhtsa") {
    return {
      kind: "other_structured",
      name: "NHTSA recallsByVehicle (federal, model-level)",
      license: FEDERAL,
      confidence: "MEDIUM",
    };
  }
  if (source === "marketcheck" || raw.includes("marketcheck")) {
    return {
      kind: "marketcheck",
      name: "MarketCheck AutoRecalls (VIN-level, licensed product)",
      license: REVIEW,
      confidence: "HIGH",
    };
  }
  return {
    kind: "other_structured",
    name: "Recall check with no provider marker on the record",
    license: REVIEW,
    confidence: "MEDIUM",
  };
};

const campaignsOf = (payload: Row): Row[] => [
  ...arr(payload.campaigns).map(obj),
  ...arr(payload.recalls).map(obj),
];

const openCampaigns = (campaigns: Row[]): number =>
  campaigns.filter((entry) => !lower(entry.status).includes("close")).length;

const mentionsDoNotDrive = (campaigns: Row[]): boolean =>
  campaigns.some((entry) =>
    DO_NOT_DRIVE.test(CAMPAIGN_TEXT_KEYS.map((key) => str(entry[key]) ?? "").join(" ")));

export interface BuildComplianceOptions {
  now?: number;
  configuredOrder?: SourceKind[] | null;
}

export function buildCompliance(
  sources: VehicleFileSources,
  opts: BuildComplianceOptions = {},
): ComplianceSection {
  const now = opts.now ?? Date.now();
  const order = opts.configuredOrder ?? null;
  const listing = sources.listing;

  if (!listing) {
    const why = "No vehicle_listings row was read for this vehicle.";
    return {
      recallStatus: emptyField<string>("recall_status", why),
      openRecallCount: emptyField<number>("open_recall_count", why),
      doNotDrive: false,
      titleStatus: emptyField<string>("title_status", why),
      titleVerification: emptyField<string>(
        "title_verification",
        "vehicle_listings.title_verification does not exist in the live database: the migration that "
          + "would add it was never applied, so the NMVTIS attestation panel's write fails and every "
          + "reader of the column receives undefined. This field is UNKNOWN on every vehicle.",
      ),
      ctMvpStatus: null,
      blockers: [why],
    };
  }

  const payload = obj(listing.recall_payload);
  const check = obj(listing.recall_check);
  const provider = providerOf(payload);

  const payloadCampaigns = campaignsOf(payload);
  const checkCampaigns = arr(check.campaigns).map(obj);
  const taskCampaigns = sources.recallTasks.flatMap((task) => campaignsOf(obj(task.recall_payload)));

  const payloadNote = str(payload.note);
  const payloadFailed = payloadNote != null && FAILED_LOOKUP.test(payloadNote);

  // The greatest of the two stamps, per directive §10 and because they cover
  // different rows: `recall_checked_at` is set on 10 of 130 active pilot cars
  // and `recall_payload.checked_at` on 127. Neither alone can age the answer.
  const payloadCheckedAt = latestStamp(payload.checked_at, payload.checkedAt);
  const columnCheckedAt = latestStamp(listing.recall_checked_at, payloadCheckedAt);
  const checkCheckedAt = iso(check.checked_at);

  const statusColumn = str(listing.recall_status);
  // `persist()` writes recall_status, open_recall_count and recall_payload in
  // one update, so a null status beside a failed-lookup payload means the
  // zero in open_recall_count came from a check that never got an answer. All
  // 74 pilot rows whose payload note reads `no_nhtsa_record_http_400` are in
  // exactly this state, and all 74 carry open_recall_count = 0.
  const checkCompleted = statusColumn != null && !payloadFailed;
  const failureNote = payloadFailed
    ? `The recall lookup did not return a record (recall_payload.note = ${payloadNote}), so neither a `
      + "status nor a count is emitted from this store. A zero here is a failed lookup, not a clean car."
    : undefined;

  const statusCandidates: Array<FieldCandidate<string>> = [
    candidate<string>({
      value: statusColumn,
      source: provider.kind,
      origin: "vehicle_listings.recall_status",
      provider: provider.name,
      observedAt: columnCheckedAt,
      confidence: provider.confidence,
      license: provider.license,
      note: failureNote
        ?? "The column every customer and employee surface reads. Written by marketcheck-recalls and by "
          + "vehicle-enrich; it holds only 'clear' or 'open_recalls', so every do_not_drive substring "
          + "test against it in the clearance and service code is dead.",
    }),
    candidate<string>({
      value: check.has_open === undefined
        ? null
        : (bool(check.has_open) === true ? "open_recalls" : "clear"),
      source: "other_structured",
      origin: "vehicle_listings.recall_check->has_open",
      provider: "Recall check record (marketcheck-recalls, or the client publish path — the store "
        + "carries no writer marker)",
      observedAt: checkCheckedAt,
      confidence: "MEDIUM",
      license: provider.license,
      note: "The store the publish gate, the unpublish guard and the stale-recall worklist read, and the "
        + "only home of do_not_drive. Present on 10 of 130 active pilot rows, so those readers treat 120 "
        + "published cars as never checked.",
    }),
    candidate<string>({
      value: payloadFailed
        ? null
        : (str(payload.recallStatus) ?? (payloadCampaigns.length ? "open_recalls" : (payloadCheckedAt ? "clear" : null))),
      source: provider.kind,
      origin: "vehicle_listings.recall_payload",
      provider: provider.name,
      observedAt: payloadCheckedAt,
      confidence: provider.confidence,
      license: provider.license,
      note: failureNote
        ?? (provider.kind === "other_structured" && lower(payload.source) === "nhtsa"
          ? "NHTSA answers by year/make/model, not by VIN, so this describes the model rather than this "
            + "car; MarketCheck's VIN-level AutoRecalls product is used first and falls through when its "
            + "terms are unaccepted."
          : undefined),
    }),
  ];

  const recallStatus = resolveField<string>("recall_status", statusCandidates, {
    now,
    configuredOrder: order,
  });

  const countCandidates: Array<FieldCandidate<number>> = [
    candidate<number>({
      value: checkCompleted ? num(listing.open_recall_count) : null,
      source: provider.kind,
      origin: "vehicle_listings.open_recall_count",
      provider: provider.name,
      observedAt: columnCheckedAt,
      confidence: provider.confidence,
      license: provider.license,
      note: failureNote,
    }),
    candidate<number>({
      value: check.campaigns === undefined ? null : openCampaigns(checkCampaigns),
      source: "other_structured",
      origin: "vehicle_listings.recall_check->campaigns",
      provider: "Recall check record (writer unmarked)",
      observedAt: checkCheckedAt,
      confidence: "MEDIUM",
      license: provider.license,
    }),
    candidate<number>({
      value: payloadFailed
        ? null
        : (num(payload.openRecallCount) ?? (payloadCheckedAt ? openCampaigns(payloadCampaigns) : null)),
      source: provider.kind,
      origin: "vehicle_listings.recall_payload",
      provider: provider.name,
      observedAt: payloadCheckedAt,
      confidence: provider.confidence,
      license: provider.license,
      note: failureNote,
    }),
  ];

  const openRecallCount = resolveField<number>("open_recall_count", countCandidates, {
    now,
    configuredOrder: order,
  });

  const doNotDrive = bool(check.do_not_drive) === true
    || bool(payload.do_not_drive) === true
    || mentionsDoNotDrive(checkCampaigns)
    || mentionsDoNotDrive(payloadCampaigns)
    || mentionsDoNotDrive(taskCampaigns);

  // Every title candidate is null on the pilot lot, and they are emitted
  // anyway so the gap is named rather than silent. `carfax_clean_title` is
  // present as a KEY on 128 of 130 rows with a JSON null value, which is not
  // the same as false and must never be read as "branded".
  const mc = obj(listing.mc_attributes);
  const cleanTitleFlag = bool(mc.carfax_clean_title);
  const titleStatus = resolveField<string>("title_status", [
    candidate<string>({
      value: str(mc.title_brand),
      source: "marketcheck",
      origin: "vehicle_listings.mc_attributes->title_brand",
      provider: "MarketCheck syndication feed (title brand)",
      observedAt: null,
      confidence: "HIGH",
      license: REVIEW,
      note: "The key is absent on 130 of 130 active pilot rows and nothing stamps when the feed last "
        + "answered this question.",
    }),
    candidate<string>({
      value: str(mc.title_status),
      source: "marketcheck",
      origin: "vehicle_listings.mc_attributes->title_status",
      provider: "MarketCheck syndication feed (title status)",
      observedAt: null,
      confidence: "HIGH",
      license: REVIEW,
      note: "Absent on 130 of 130 active pilot rows.",
    }),
    candidate<string>({
      value: cleanTitleFlag === null ? null : (cleanTitleFlag ? "clean" : "branded"),
      source: "marketcheck",
      origin: "vehicle_listings.mc_attributes->carfax_clean_title",
      provider: "CARFAX clean-title flag relayed by the MarketCheck feed",
      observedAt: null,
      confidence: "HIGH",
      license: REVIEW,
      note: "Present as a key on 128 of 130 active pilot rows with a JSON null value on all of them. A "
        + "null key is the provider declining to answer, not a branded title.",
    }),
  ], { now, configuredOrder: order });

  const titleVerification = emptyField<string>(
    "title_verification",
    "vehicle_listings.title_verification does not exist in the live database (information_schema returns "
      + "no such column on any public table; the migration was never applied). The column is therefore "
      + "never read here. TitleVerificationPanel's update fails against PostgREST, so no NMVTIS "
      + "attestation can be stored, and passportV2Data reads undefined for every vehicle.",
  );

  const blockers: string[] = [];

  if (doNotDrive) {
    const overridden = str(listing.recall_override_by) != null;
    blockers.push(
      "A recall on this vehicle carries do-not-drive language"
        + `${overridden ? ", and an admin override is recorded" : " and no override is recorded"}. `
        + "The publish gate reads only recall_check->>'do_not_drive', which is stored on 10 of 130 "
        + "active pilot rows, so the guard may not fire even when the campaign text says so.",
    );
  }

  if (payloadFailed) {
    blockers.push(
      `The last recall check failed (${payloadNote}`
        + `${payloadCheckedAt ? ` at ${payloadCheckedAt}` : ""}) and left open_recall_count = `
        + `${num(listing.open_recall_count) ?? "null"} behind it. 74 of the 130 active pilot cars are in `
        + "this state and every reader of open_recall_count shows them as having no open recalls.",
    );
  } else if (recallStatus.value === "open_recalls" || (openRecallCount.value ?? 0) > 0) {
    blockers.push(
      `${openRecallCount.value ?? "An unknown number of"} open recall(s) recorded`
        + `${columnCheckedAt ? ` as of ${columnCheckedAt}` : ""}.`,
    );
  } else if (recallStatus.value == null) {
    blockers.push(
      couldNotRead(sources, "vehicle_listings")
        ? "The listing row could not be read, so recall state is unknown."
        : "No recall store holds a status for this vehicle: recall_status, recall_check and "
          + "recall_payload are all empty of an answer.",
    );
  }

  if (recallStatus.freshness === "STALE") {
    blockers.push(`Recall answer is stale: ${recallStatus.reason}`);
  }

  // Coverage, not value, is the recall defect: where two stores both hold an
  // answer they agree on every pilot vehicle, but `recall_check` is stored on
  // 10 of 130 while `recall_payload` is stored on all 130 — and `recall_check`
  // is the only store the publish gate, the unpublish guard and the
  // stale-recall worklist read.
  if (check.checked_at === undefined && recallStatus.value != null) {
    blockers.push(
      "vehicle_listings.recall_check holds no answer for this vehicle, so enforce_prep_gate, "
        + "trg_recall_unpublish_guard and listings_with_stale_recalls all treat it as never checked "
        + "even though a recall answer exists in the columns and the payload.",
    );
  }

  const openTasks = sources.recallTasks.filter((task) => lower(task.status) === "open_review");
  if (openTasks.length) {
    blockers.push(
      `${openTasks.length} recall service task(s) still open_review. Tenant-wide 156 of 157 tasks are `
        + "unreviewed, so the service loop has closed once.",
    );
  }

  if (titleStatus.value == null) {
    blockers.push(
      "No title source answers for this vehicle: the MarketCheck title keys are absent, the CARFAX "
        + "clean-title flag is null, and vehicle_listings.title_verification does not exist, so no "
        + "NMVTIS attestation can be stored. The customer Passport fills this gap with the dealership's "
        + "own blanket no-branded-titles policy statement.",
    );
  }

  // The compliance question the Documents section deliberately does not
  // answer: an archived draft PDF is an artifact, not a filed Buyers Guide.
  const condition = lower(listing.condition);
  if (USED_LIKE.has(condition) && lower(listing.status) === "published") {
    const filed = sources.generatedDocuments.some(
      (row) => lower(row.document_type) === "buyers_guide"
        && DEAL_GATE_STATUS.has(lower(row.document_status)),
    );
    if (!filed) {
      blockers.push(
        "This used vehicle is published with no Buyers Guide in an approved, printed or published "
          + "state. The FTC Used Car Rule requires the Buyers Guide on every used car; a draft PDF and "
          + "a retained copy in signed_document_archive are not a filed document, and on the pilot the "
          + "deal gate answers 'no Buyers Guide' for 57 of 58 used cars.",
      );
    }
  }

  return {
    recallStatus,
    openRecallCount,
    doNotDrive,
    titleStatus,
    titleVerification,
    // `ct_mvp_certification_runs` is not part of VehicleFileSources, so this
    // projection cannot answer it. Null is "not read", never "not certified".
    ctMvpStatus: null,
    blockers,
  };
}
