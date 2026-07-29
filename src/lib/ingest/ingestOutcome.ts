// ──────────────────────────────────────────────────────────────────────
// Per-VIN ingest outcome — the honest reading of "did it auto-generate?".
//
// Three steps matter to a dealer looking at one car: did the window sticker
// publish or park (and why), was the OEM brochure linked, was the owner's
// manual linked. Each resolves to exactly one status plus a reason string,
// and to an evidence level that says how much the status can be trusted:
//
//   recorded — the step itself filed the verdict in vehicle_ingest_ledger,
//              or in its own state machine (factory_sticker_records).
//   derived  — nothing recorded an outcome; the status was inferred from
//              downstream state that happens to be observable.
//   absent   — nothing recorded it and nothing downstream shows it ran.
//              Status is always "not_run". This is the case that used to
//              read as success simply because no exception existed.
//
// The one rule the whole module exists to enforce: a step that did not run
// is never reported as a step that succeeded.
// ──────────────────────────────────────────────────────────────────────

export const INGEST_STEPS = ["factory_sticker", "oem_brochure", "owners_manual"] as const;
export type IngestStep = (typeof INGEST_STEPS)[number];

export type IngestStepStatus =
  | "succeeded"
  | "parked"
  | "failed"
  | "running"
  | "skipped"
  | "not_run";

/**
 * The statuses vehicle_ingest_ledger will store. "not_run" is absent on
 * purpose — a step that never ran has no row, so nothing can file "did not
 * run" as though the step had reported it.
 */
export const RECORDABLE_STATUSES: readonly IngestStepStatus[] = [
  "running", "succeeded", "parked", "failed", "skipped",
];

export type OutcomeEvidence = "recorded" | "derived" | "absent";

export const INGEST_STEP_LABEL: Record<IngestStep, string> = {
  factory_sticker: "Window sticker",
  oem_brochure: "OEM brochure",
  owners_manual: "Owner's manual",
};

export interface IngestStepOutcome {
  step: IngestStep;
  label: string;
  status: IngestStepStatus;
  /** Always non-empty. Why this step is in this status, in operator words. */
  reason: string;
  evidence: OutcomeEvidence;
  attemptCount: number | null;
  lastRunAt: string | null;
}

export interface IngestLedgerRow {
  step?: string | null;
  status?: string | null;
  reason?: string | null;
  attempt_count?: number | null;
  last_run_at?: string | null;
}

export interface StickerRecordRow {
  generation_status?: string | null;
  review_required?: boolean | null;
  review_reason?: string | null;
  last_error?: string | null;
  published_at?: string | null;
  current_document_id?: string | null;
  updated_at?: string | null;
}

export interface OemLinkRow {
  make?: string | null;
  model?: string | null;
  year?: number | null;
  url?: string | null;
  title?: string | null;
  verified_at?: string | null;
}

/**
 * A row of oem_packet_backfill_attempts — the sweep's global negative cache
 * for one (kind, make, model, year) triple. It is not per-VIN, but when no
 * link exists it is the only record of WHY, so it beats guessing.
 */
export interface PacketAttemptRow {
  kind?: string | null;
  make_key?: string | null;
  model_key?: string | null;
  year_key?: number | null;
  outcome?: string | null;
  detail?: string | null;
  attempts?: number | null;
  last_attempt_at?: string | null;
}

export interface IngestOutcomeInput {
  vin: string;
  /** "2026 Toyota Camry XSE" — the shape vehicle_listings.ymm carries. */
  ymm?: string | null;
  ledger?: IngestLedgerRow[] | null;
  sticker?: StickerRecordRow | null;
  brochureLinks?: OemLinkRow[] | null;
  manualLinks?: OemLinkRow[] | null;
  /** The backfill sweep's verdict for this vehicle's brochure triple, if any. */
  brochureAttempt?: PacketAttemptRow | null;
  /** The backfill sweep's verdict for this vehicle's manual triple, if any. */
  manualAttempt?: PacketAttemptRow | null;
  /**
   * source_values.artifacts from this VIN's open artifact_autogen_failed
   * exception — the failure-only record intake-autoprovision writes.
   */
  autogenArtifacts?: Record<string, unknown> | null;
}

const clean = (v: unknown): string => String(v ?? "").trim();
const norm = (v: unknown): string => clean(v).toLowerCase().replace(/\s+/g, " ");

/** Splits vehicle_listings.ymm the same way the harvest callers do. */
export function parseYmm(ymm: string | null | undefined): {
  year: number | null; make: string; model: string;
} {
  const parts = clean(ymm).split(/\s+/).filter(Boolean);
  const year = Number.parseInt(parts[0] || "", 10);
  return {
    year: Number.isFinite(year) ? year : null,
    make: parts[1] || "",
    model: parts.slice(2).join(" "),
  };
}

/**
 * Exact, case-insensitive model comparison — the reader's rule, not a
 * friendlier one. public-listing-view selects the link cache with
 * `.ilike("model", md)` and no wildcards, so "Camry" does NOT answer a
 * "Camry XSE" vehicle on the passport. Matching more loosely here would
 * report a brochure as linked on a car whose shopper page shows nothing,
 * which is the precise failure this module exists to prevent.
 */
export function modelMatches(cached: string | null | undefined, vehicle: string | null | undefined): boolean {
  const a = norm(cached);
  const b = norm(vehicle);
  return !!a && a === b;
}

/**
 * Mirrors public-listing-view's pick step for step, because what the shopper
 * packet resolves IS the answer to "was it linked": exact model year, then the
 * nearest row within two model years, then a year-less row (the harvest
 * legitimately falls back to a make's year-less "Manuals & Guides" portal, and
 * the passport treats that as covering every year).
 */
export function pickOemLink(
  rows: OemLinkRow[] | null | undefined,
  make: string,
  model: string,
  year: number | null,
): OemLinkRow | null {
  const candidates = (rows || [])
    .filter((r) => norm(r.make) === norm(make) && modelMatches(r.model, model) && !!clean(r.url))
    .sort((a, b) => (b.year ?? -1) - (a.year ?? -1));
  if (candidates.length === 0) return null;
  if (year == null) return candidates[0];
  // Newest-first within the two-year window, not closest-first: the reader
  // scans rows already ordered year DESC and takes the first hit.
  return candidates.find((r) => r.year === year)
    ?? candidates.find((r) => r.year != null && Math.abs((r.year as number) - year) <= 2)
    ?? candidates.find((r) => r.year == null)
    ?? null;
}

const STICKER_RUNNING = new Set(["NORMALIZING", "VALIDATING", "GENERATING", "RUNNING_QA"]);

const artifactMessage = (
  artifacts: Record<string, unknown> | null | undefined,
  key: string,
): string | null => {
  const raw = artifacts?.[key];
  if (raw === undefined || raw === null) return null;
  const msg = clean(raw);
  return msg || "no error message was recorded";
};

function fromLedger(row: IngestLedgerRow | undefined): Omit<IngestStepOutcome, "step" | "label"> | null {
  if (!row) return null;
  const status = clean(row.status) as IngestStepStatus;
  const reason = clean(row.reason);
  const attemptCount = typeof row.attempt_count === "number" ? row.attempt_count : null;
  const lastRunAt = clean(row.last_run_at) || null;
  const known = RECORDABLE_STATUSES.includes(status);
  return {
    // An unrecognized status is surfaced, never silently believed. "parked"
    // is the honest landing spot: something happened, and it is not a pass.
    status: known ? status : "parked",
    reason: known
      ? (reason || "The step recorded this outcome without a reason.")
      : `The ledger recorded an unrecognized status "${clean(row.status) || "(empty)"}"${reason ? `: ${reason}` : "."}`,
    evidence: "recorded",
    attemptCount,
    lastRunAt,
  };
}

function stickerOutcome(input: IngestOutcomeInput): Omit<IngestStepOutcome, "step" | "label"> {
  const rec = input.sticker;
  const failed = artifactMessage(input.autogenArtifacts, "factory_sticker");

  if (!rec) {
    if (failed) {
      return {
        status: "failed",
        reason: `The sticker orchestrator call failed at ingest and no build record was created: ${failed}`,
        evidence: "recorded",
        attemptCount: null,
        lastRunAt: null,
      };
    }
    return {
      status: "not_run",
      reason: "No factory build record exists for this VIN. Nothing recorded an attempt, so the sticker has not been generated.",
      evidence: "absent",
      attemptCount: null,
      lastRunAt: null,
    };
  }

  const state = clean(rec.generation_status).toUpperCase();
  const lastRunAt = clean(rec.updated_at) || null;
  const base = { evidence: "recorded" as const, attemptCount: null, lastRunAt };
  const reviewReason = clean(rec.review_reason);
  const lastError = clean(rec.last_error);

  if (state === "PUBLISHED") {
    // A published record with nothing attached is the exact shape of the lie
    // this module exists to catch: the state machine says done, the shopper
    // packet has no document.
    if (!clean(rec.current_document_id)) {
      return {
        ...base,
        status: "parked",
        reason: "The build record is marked published but no document is attached to it, so nothing reaches the shopper packet.",
      };
    }
    const at = clean(rec.published_at);
    return { ...base, status: "succeeded", reason: at ? `Published on ${at}.` : "Published." };
  }
  if (state === "APPROVED") {
    return {
      ...base,
      status: "parked",
      reason: "Approved but not published — it stays off the shopper packet until it publishes.",
    };
  }
  if (state === "REVIEW_REQUIRED") {
    return {
      ...base,
      status: "parked",
      reason: reviewReason || "Parked for manager review; the build record does not say why.",
    };
  }
  if (state === "PENDING_DATA") {
    return {
      ...base,
      status: "parked",
      reason: reviewReason || lastError
        || "Parked awaiting factory build data — the VIN decode has not produced a build sheet for this vehicle.",
    };
  }
  if (state === "READY_TO_GENERATE") {
    return {
      ...base,
      status: "parked",
      reason: "Build data is ready; the renderer has not produced the document yet.",
    };
  }
  if (STICKER_RUNNING.has(state)) {
    return { ...base, status: "running", reason: `In progress (${state.toLowerCase().replace(/_/g, " ")}).` };
  }
  if (state === "FAILED_RETRYABLE") {
    return {
      ...base,
      status: "failed",
      reason: lastError || "Failed with no error recorded. It is eligible for retry.",
    };
  }
  if (state === "FAILED_PERMANENT") {
    return {
      ...base,
      status: "failed",
      reason: lastError || "Failed permanently with no error recorded. It will not retry on its own.",
    };
  }
  if (state === "SUPERSEDED") {
    return { ...base, status: "skipped", reason: "Superseded by a newer build record for this vehicle." };
  }
  if (state === "ARCHIVED") {
    return { ...base, status: "skipped", reason: "Archived — the vehicle is no longer in live inventory." };
  }
  return {
    ...base,
    status: "parked",
    reason: `The build record is in an unrecognized state "${clean(rec.generation_status) || "(empty)"}".`,
  };
}

/** Key a packet-backfill attempt row the way the sweep writes it. */
export function attemptMatches(
  attempt: PacketAttemptRow | null | undefined,
  kind: string,
  make: string,
  model: string,
  year: number | null,
): boolean {
  if (!attempt) return false;
  return clean(attempt.kind) === kind
    && norm(attempt.make_key) === norm(make)
    && norm(attempt.model_key) === norm(model)
    && (attempt.year_key ?? 0) === (year ?? 0);
}

function linkOutcome(
  input: IngestOutcomeInput,
  rows: OemLinkRow[] | null | undefined,
  attempt: PacketAttemptRow | null | undefined,
  artifactKey: string,
  kind: string,
  noun: string,
): Omit<IngestStepOutcome, "step" | "label"> {
  const failed = artifactMessage(input.autogenArtifacts, artifactKey);
  if (failed) {
    return {
      status: "failed",
      reason: `The ${noun} harvest failed at ingest: ${failed}`,
      evidence: "recorded",
      attemptCount: null,
      lastRunAt: null,
    };
  }

  const { year, make, model } = parseYmm(input.ymm);
  if (!make || !model) {
    return {
      status: "not_run",
      reason: `This vehicle has no usable year/make/model (${clean(input.ymm) || "empty"}), so no ${noun} could be looked up.`,
      evidence: "absent",
      attemptCount: null,
      lastRunAt: null,
    };
  }

  const hit = pickOemLink(rows, make, model, year);
  if (hit) {
    const matched = [hit.year ?? "", hit.make ?? "", hit.model ?? ""].map(clean).filter(Boolean).join(" ");
    return {
      status: "succeeded",
      // Deliberately "derived": the shared cache is what the shopper packet
      // reads, so the link does resolve — but nothing recorded that a harvest
      // ran for THIS VIN, so it is inferred, not confirmed.
      reason: `A shared OEM ${noun} link matches this vehicle (${matched || `${make} ${model}`}). No per-VIN harvest outcome was recorded, so this is inferred from the shared cache rather than confirmed for this VIN.`,
      evidence: "derived",
      attemptCount: null,
      lastRunAt: clean(hit.verified_at) || null,
    };
  }

  // No link. The backfill sweep's global negative cache is the only record of
  // why, so use it before falling back to "nothing is known".
  const triple = [year, make, model].filter(Boolean).join(" ");
  if (attemptMatches(attempt, kind, make, model, year)) {
    const outcome = clean(attempt?.outcome);
    const attempts = typeof attempt?.attempts === "number" ? attempt.attempts : null;
    const lastRunAt = clean(attempt?.last_attempt_at) || null;
    const detail = clean(attempt?.detail);
    const shared = { evidence: "derived" as const, attemptCount: attempts, lastRunAt };
    if (outcome === "unsupported") {
      return {
        ...shared,
        status: "skipped",
        reason: `${make} is not in the OEM harvest allow-list, so no ${noun} is searched for this vehicle. Nothing will change without a deploy that adds the make.`,
      };
    }
    if (outcome === "not_found") {
      return {
        ...shared,
        status: "failed",
        reason: `The manufacturer's own site had no ${noun} for ${triple}${attempts ? ` (searched ${attempts} time${attempts === 1 ? "" : "s"})` : ""}${detail ? `: ${detail}` : "."}`,
      };
    }
    if (outcome === "error") {
      return {
        ...shared,
        status: "failed",
        reason: `The ${noun} harvest for ${triple} errored${detail ? `: ${detail}` : " with no detail recorded."} It will be re-tried by the packet backfill sweep.`,
      };
    }
    if (outcome === "found") {
      return {
        ...shared,
        status: "parked",
        reason: `The backfill recorded a ${noun} found for ${triple}, but no cached link matches this vehicle, so the shopper packet still shows nothing.`,
      };
    }
  }

  return {
    status: "not_run",
    reason: `No OEM ${noun} link exists for ${triple} and nothing recorded a harvest attempt for this VIN.`,
    evidence: "absent",
    attemptCount: null,
    lastRunAt: null,
  };
}

/** One outcome per step, in a fixed order, for a single VIN. */
export function buildIngestOutcomes(input: IngestOutcomeInput): IngestStepOutcome[] {
  const byStep = new Map<string, IngestLedgerRow>();
  for (const row of input.ledger || []) {
    const step = clean(row?.step);
    if (step) byStep.set(step, row);
  }

  return INGEST_STEPS.map((step) => {
    const recorded = fromLedger(byStep.get(step));
    const core = recorded
      ?? (step === "factory_sticker"
        ? stickerOutcome(input)
        : step === "oem_brochure"
          ? linkOutcome(input, input.brochureLinks, input.brochureAttempt, "oem_brochure", "brochure", "brochure")
          : linkOutcome(input, input.manualLinks, input.manualAttempt, "owners_manual", "owners_manual", "owner's manual"));
    return { step, label: INGEST_STEP_LABEL[step], ...core };
  });
}

export interface IngestOutcomeSummary {
  /** Succeeded AND the step said so itself. */
  confirmed: number;
  /** Succeeded, but only inferred from downstream state. */
  inferred: number;
  /** failed, parked or not_run — someone has to look. */
  needsAttention: number;
  /** Still in flight. */
  running: number;
  /** Deliberately not applicable. */
  skipped: number;
  headline: string;
}

const ATTENTION = new Set<IngestStepStatus>(["failed", "parked", "not_run"]);

/** A one-line verdict that never rounds "nothing ran" up to "fine". */
export function summarizeIngestOutcomes(outcomes: IngestStepOutcome[]): IngestOutcomeSummary {
  let confirmed = 0, inferred = 0, needsAttention = 0, running = 0, skipped = 0;
  for (const o of outcomes) {
    if (o.status === "succeeded") { if (o.evidence === "recorded") confirmed++; else inferred++; }
    else if (o.status === "running") running++;
    else if (o.status === "skipped") skipped++;
    else if (ATTENTION.has(o.status)) needsAttention++;
  }
  const total = outcomes.length;
  const parts = [`${confirmed} of ${total} confirmed`];
  if (inferred) parts.push(`${inferred} inferred`);
  if (running) parts.push(`${running} in progress`);
  if (skipped) parts.push(`${skipped} not applicable`);
  if (needsAttention) parts.push(`${needsAttention} needing attention`);
  return { confirmed, inferred, needsAttention, running, skipped, headline: `${parts.join(", ")}.` };
}
