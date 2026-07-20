// ── Passport A/B experiment harness ─────────────────────────────────────────
// When a vehicle's passport_version resolves to `experiment_assignment`, we
// split visitors between the existing passport ("current") and the governed V3
// ("v3") and tie their downstream engagement to the variant they saw. The split
// is DETERMINISTIC on the visitor id, so a shopper always sees the same
// experience across sessions and reloads — never a flicker between variants —
// and no server round-trip is needed to assign a bucket.
//
// Enrollment is recorded (localStorage) so trackCustomerEngagement can stamp
// `experiment_id` + `experiment_variant` on every event the visitor emits,
// including conversions (reserve / contact / lead). That ambient tag is what
// makes the funnel readout comparable on real data.

export type PassportVariant = "current" | "v3";

// Versioned id — bump when the experiment definition changes so old and new
// enrollments never pool into one misleading funnel.
export const PASSPORT_EXPERIMENT_ID = "passport_v3_vs_current_v1";

// Default traffic to the governed V3 variant. 0.5 = even split.
export const DEFAULT_V3_SPLIT = 0.5;

export interface PassportEnrollment {
  experimentId: string;
  variant: PassportVariant;
  bucket: number;      // 0..1 — the visitor's stable position in the split
  enrolledAt: string;  // ISO
}

const STORE_KEY = "al_passport_experiment_v1";

// FNV-1a 32-bit — a tiny, stable, dependency-free string hash. Same input always
// yields the same 0..1 bucket, so the assignment is reproducible on the client
// and in tests without any stored state.
function hashUnitInterval(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // >>> 0 forces unsigned; divide by 2^32 for [0,1).
  return (h >>> 0) / 0x100000000;
}

/**
 * Deterministic bucket for a visitor in a given experiment. Pure — no storage,
 * no randomness. `v3Split` is the share of traffic sent to the v3 variant.
 */
export function bucketFor(
  visitorId: string,
  experimentId: string = PASSPORT_EXPERIMENT_ID,
  v3Split: number = DEFAULT_V3_SPLIT,
): { variant: PassportVariant; bucket: number } {
  const split = Math.max(0, Math.min(1, v3Split));
  const bucket = hashUnitInterval(`${experimentId}:${visitorId}`);
  return { variant: bucket < split ? "v3" : "current", bucket };
}

function readEnrollment(): PassportEnrollment | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PassportEnrollment>;
    if (p.experimentId !== PASSPORT_EXPERIMENT_ID) return null; // stale experiment
    if (p.variant !== "current" && p.variant !== "v3") return null;
    return {
      experimentId: p.experimentId,
      variant: p.variant,
      bucket: typeof p.bucket === "number" ? p.bucket : 0,
      enrolledAt: typeof p.enrolledAt === "string" ? p.enrolledAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Assign (and persist) the visitor's variant for the passport experiment. The
 * variant is deterministic on the visitor id; persistence only records WHEN they
 * first enrolled and lets other modules read the active enrollment ambiently.
 * Idempotent: re-calling never flips a visitor to the other arm.
 */
export function enrollPassportVariant(
  visitorId: string,
  v3Split: number = DEFAULT_V3_SPLIT,
): PassportEnrollment {
  const { variant, bucket } = bucketFor(visitorId, PASSPORT_EXPERIMENT_ID, v3Split);
  const existing = readEnrollment();
  // Keep the original enrolledAt; the variant is stable regardless.
  const enrollment: PassportEnrollment = {
    experimentId: PASSPORT_EXPERIMENT_ID,
    variant,
    bucket,
    enrolledAt: existing?.variant === variant ? existing.enrolledAt : new Date().toISOString(),
  };
  if (typeof localStorage !== "undefined") {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(enrollment)); } catch { /* private mode — ambient tag simply won't persist */ }
  }
  return enrollment;
}

/** The active enrollment, if the visitor is currently in the experiment. */
export function getActivePassportExperiment(): PassportEnrollment | null {
  return readEnrollment();
}

/** Clear enrollment — used when a vehicle is no longer in experiment mode, and in tests. */
export function clearPassportExperiment(): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
}

// ── Funnel readout ──────────────────────────────────────────────────────────
// Conversion = a high-intent action. Exposure = a visitor who was rendered a
// variant at all. Both are counted by UNIQUE visitor so a chatty session can't
// inflate a variant's numbers.

export const CONVERSION_EVENT_TYPES = new Set<string>([
  "customer_passport_reserve_clicked",
  "customer_passport_contact_clicked",
  "customer_passport_trade_clicked",
  "customer_passport_call_clicked",
  "lead_submitted",
  "lead_form_opened",
  "call_clicked",
  "text_clicked",
  "finance_clicked",
  "trade_clicked",
  "directions_clicked",
]);

// A cta_clicked only counts as a conversion when its action is a real
// commitment (reserve / lead), not any incidental CTA.
const CONVERTING_CTA_ACTIONS = new Set<string>(["reserve", "lead", "protect", "warranty_question"]);

export interface ExperimentEventRow {
  visitor_id?: string | null;
  event_type?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface VariantFunnel {
  variant: PassportVariant;
  exposures: number;      // unique visitors shown this variant
  conversions: number;    // unique visitors who took a high-intent action
  conversionRate: number; // 0..1, 0 when no exposures
}

export interface PassportExperimentSummary {
  experimentId: string;
  variants: Record<PassportVariant, VariantFunnel>;
  /** v3 rate minus current rate, in points (0..1); null when either arm has no exposure. */
  lift: number | null;
  totalExposures: number;
}

function isConversion(row: ExperimentEventRow): boolean {
  const t = row.event_type || "";
  if (CONVERSION_EVENT_TYPES.has(t)) return true;
  if (t === "cta_clicked") {
    const action = (row.metadata?.cta_action ?? row.metadata?.action);
    return typeof action === "string" && CONVERTING_CTA_ACTIONS.has(action);
  }
  return false;
}

/**
 * Aggregate raw engagement rows into a per-variant funnel. Only rows carrying an
 * `experiment_variant` matching this experiment are considered, so events from
 * outside the experiment never pollute the readout. Deterministic + pure.
 */
export function summarizePassportExperiment(
  rows: ExperimentEventRow[],
  experimentId: string = PASSPORT_EXPERIMENT_ID,
): PassportExperimentSummary {
  const exposed: Record<PassportVariant, Set<string>> = { current: new Set(), v3: new Set() };
  const converted: Record<PassportVariant, Set<string>> = { current: new Set(), v3: new Set() };

  for (const row of rows) {
    const meta = row.metadata || {};
    if (meta.experiment_id !== experimentId) continue;
    const variant = meta.experiment_variant;
    if (variant !== "current" && variant !== "v3") continue;
    const visitor = (row.visitor_id || "").trim();
    if (!visitor) continue;
    exposed[variant].add(visitor);
    if (isConversion(row)) converted[variant].add(visitor);
  }

  const funnel = (v: PassportVariant): VariantFunnel => {
    const exposures = exposed[v].size;
    const conversions = converted[v].size;
    return { variant: v, exposures, conversions, conversionRate: exposures ? conversions / exposures : 0 };
  };

  const current = funnel("current");
  const v3 = funnel("v3");
  const lift = current.exposures && v3.exposures ? v3.conversionRate - current.conversionRate : null;

  return {
    experimentId,
    variants: { current, v3 },
    lift,
    totalExposures: current.exposures + v3.exposures,
  };
}
