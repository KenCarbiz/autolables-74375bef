// GENERATED — do not edit.
// Mirror of src/lib/market/certificationTruth.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── Certification truth: source precedence ─────────────────────────────────
//
// The QX50 is a CPO INFINITI. Its stored `market_payload` carries
// `"is_certified": false`, regenerated nightly, and that field is visible to
// the customer packet. A provider that does not know a car is certified is not
// evidence that it is not.
//
// The three-state rule this module enforces:
//
//   • MISSING is not FALSE. A provider that omits the field has said nothing.
//     Reading silence as a denial is how a certified car gets priced, and
//     described, as an ordinary one.
//   • A PROVIDER cannot overturn an AUTHORITATIVE internal record. The dealer
//     and the manufacturer know whether they certified the car; a syndication
//     feed is downstream of them. Where they disagree the disagreement is
//     recorded, not resolved in the provider's favour.
//   • A PROVIDER cannot CONFER certification either. The rule is symmetric on
//     purpose: "certified" is a warranty claim with a manufacturer program
//     behind it, and the cost of inventing one is a compliance problem, not a
//     display bug.
//
// The provider's raw answer is never discarded — it is carried beside the
// resolved value so an operator can see exactly what the provider said and how
// the conflict was decided. Quarantining an attribute means "do not use this,
// and do not forget it".
//
// Nothing here fabricates a program name, coverage term or eligibility. A
// program is reported only when an authoritative record supplied one.

export type CertificationState = "certified" | "not_certified" | "unknown";

/**
 * Who is making the claim.
 *
 * `provider_derived` is deliberately NOT authoritative even when it is stored
 * on our own row: `vehicle_listings.condition` and `mc_raw.is_certified` are
 * both downstream of MarketCheck, so neither can corroborate the other and
 * neither can outrank the dealer.
 */
export type CertificationAuthority =
  | "manufacturer"
  | "dealer_confirmed"
  | "provider_derived"
  | "none";

const AUTHORITATIVE: CertificationAuthority[] = ["manufacturer", "dealer_confirmed"];

export const isAuthoritativeCertificationSource = (a: CertificationAuthority): boolean =>
  AUTHORITATIVE.includes(a);

export interface InternalCertificationRecord {
  state?: CertificationState | null;
  authority?: CertificationAuthority | null;
  /** Only ever echoed, never invented. */
  program?: string | null;
}

export interface ProviderCertificationRead {
  value: boolean | null;
  /** The provider sent SOMETHING and it was not a readable three-state answer. */
  malformed: boolean;
}

export interface CertificationResolution {
  /** The authoritative answer. This is what a surface may state. */
  certified: CertificationState;
  authority: CertificationAuthority;
  program: string | null;
  /** Raw provider evidence, preserved distinctly from the resolved value. */
  providerEcho: boolean | null;
  providerMalformed: boolean;
  /** The provider contradicted an authoritative record. */
  conflict: boolean;
  /** The provider attribute must not be used as a fact. */
  quarantineProviderAttribute: boolean;
  reasons: string[];
}

/**
 * Read a provider's certification field in three states, plus malformed.
 *
 * The accepted spellings match `readCertifiedEcho` in providerAdapter — one
 * vocabulary, so a value cannot mean one thing to the pricing request and
 * another to the truth layer. Anything outside it is malformed and yields
 * null: a value we cannot read is not a denial.
 */
export function readProviderCertification(value: unknown): ProviderCertificationRead {
  if (value === null || value === undefined) return { value: null, malformed: false };
  if (typeof value === "boolean") return { value, malformed: false };
  if (typeof value === "number") {
    if (value === 1) return { value: true, malformed: false };
    if (value === 0) return { value: false, malformed: false };
    return { value: null, malformed: true };
  }
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "true" || s === "1") return { value: true, malformed: false };
    if (s === "false" || s === "0") return { value: false, malformed: false };
    return { value: null, malformed: true };
  }
  return { value: null, malformed: true };
}

const normalizeState = (s: unknown): CertificationState =>
  s === "certified" || s === "not_certified" ? s : "unknown";

/**
 * Resolve certification from an internal record and a provider's answer.
 *
 * The provider never wins and never breaks a tie. It can only corroborate, or
 * be recorded as disagreeing.
 */
export function resolveCertification(input: {
  internal?: InternalCertificationRecord | null;
  providerValue?: unknown;
}): CertificationResolution {
  const reasons: string[] = [];
  const internalState = normalizeState(input.internal?.state);
  const internalAuthority: CertificationAuthority = input.internal?.authority ?? "none";
  const authoritative = internalState !== "unknown" && isAuthoritativeCertificationSource(internalAuthority);

  const read = readProviderCertification(input.providerValue);
  if (read.malformed) reasons.push("provider_certification_malformed");
  else if (read.value === null) reasons.push("provider_certification_missing");
  else reasons.push(`provider_certification_${read.value}`);

  // The program is echoed from the authoritative record or it is absent. A
  // provider boolean says nothing about which program, what it covers, or
  // whether this car qualifies.
  const program = authoritative && internalState === "certified"
    ? (typeof input.internal?.program === "string" && input.internal.program.trim() !== ""
        ? input.internal.program.trim()
        : null)
    : null;

  if (!authoritative) {
    // Nothing authoritative to protect, and nothing authoritative to promote.
    // A provider's answer alone never becomes the resolved state — in either
    // direction — so the honest result is the internal state, which for an
    // absent or provider-derived record is unknown.
    if (internalState !== "unknown") {
      reasons.push(`internal_certification_${internalState}_not_authoritative`);
    } else {
      reasons.push("internal_certification_unknown");
    }
    if (read.value !== null) reasons.push("provider_certification_recorded_as_claim_only");
    return {
      certified: internalState !== "unknown" && internalAuthority === "provider_derived"
        ? "unknown"
        : internalState,
      authority: internalAuthority,
      program: null,
      providerEcho: read.value,
      providerMalformed: read.malformed,
      conflict: false,
      quarantineProviderAttribute: read.malformed,
      reasons,
    };
  }

  reasons.push(`internal_certification_${internalState}_by_${internalAuthority}`);

  const contradicts =
    read.value !== null
    && ((internalState === "certified" && read.value === false)
      || (internalState === "not_certified" && read.value === true));

  if (contradicts) {
    reasons.push("provider_certification_conflicts_with_authoritative_record");
    reasons.push("provider_certification_quarantined");
  } else if (read.value !== null) {
    reasons.push("provider_certification_corroborates");
  }

  return {
    certified: internalState,
    authority: internalAuthority,
    program,
    providerEcho: read.value,
    providerMalformed: read.malformed,
    conflict: contradicts,
    quarantineProviderAttribute: contradicts || read.malformed,
    reasons,
  };
}

/**
 * A write that would turn a known-certified vehicle into a non-certified one.
 *
 * The nightly enrichment guard: a sweep may add knowledge, and it may leave a
 * car unknown, but it may not demote a car the dealer certified.
 */
export function isCertificationRegression(
  before: CertificationState,
  after: CertificationState,
): boolean {
  return before === "certified" && after !== "certified";
}

// ── Reading and writing the stored certification record ────────────────────
//
// `vehicle_listings.certification` is the column that already holds this:
//
//   { certified: true, source: "dealer_vdp", verified_at: "..." }
//
// written today by `crawl-advertised-prices` when it reads a CPO badge off
// the dealer's own VDP, and deliberately gap-fill only — it never overwrites a
// record that already has a source.
//
// `vehicle_listings.condition` is NOT a peer of that record. `marketcheck-sync`
// derives it with `classifyCondition({ inventoryType, certified: is_certified })`,
// so `condition === "cpo"` is MarketCheck's answer wearing our column name.
// Treating it as authoritative would let the provider corroborate itself, and
// then a provider `false` would be arguing with its own earlier `true`.

export interface StoredCertification {
  certified?: unknown;
  source?: unknown;
  program_name?: unknown;
  verified_at?: unknown;
  provider_echo?: unknown;
  provider_conflict?: unknown;
  provider_quarantined?: unknown;
  resolved_at?: unknown;
  [key: string]: unknown;
}

/** What a stored `certification.source` is worth. */
export function authorityForStoredSource(source: unknown): CertificationAuthority {
  const s = typeof source === "string" ? source.trim().toLowerCase() : "";
  if (s === "manufacturer" || s === "oem") return "manufacturer";
  if (s === "dealer_vdp" || s === "dealer" || s === "dealer_confirmed") return "dealer_confirmed";
  if (s === "marketcheck" || s === "feed" || s === "provider") return "provider_derived";
  return "none";
}

/**
 * Build the internal record from the columns a listing row actually carries.
 *
 * The stored record wins when it has one. Otherwise `condition` supplies a
 * state with `provider_derived` authority, which `resolveCertification` will
 * decline to promote — an honest "unknown" rather than a laundered feed value.
 */
export function internalCertificationFromRow(row: {
  certification?: StoredCertification | null;
  condition?: unknown;
}): InternalCertificationRecord {
  const stored = row.certification ?? null;
  const storedFlag = stored ? readProviderCertification(stored.certified) : { value: null, malformed: false };
  if (stored && storedFlag.value !== null) {
    return {
      state: storedFlag.value ? "certified" : "not_certified",
      authority: authorityForStoredSource(stored.source),
      program: typeof stored.program_name === "string" ? stored.program_name : null,
    };
  }

  const condition = typeof row.condition === "string" ? row.condition.trim().toLowerCase() : "";
  if (condition === "cpo") return { state: "certified", authority: "provider_derived", program: null };
  if (condition === "new" || condition === "used") {
    return { state: "not_certified", authority: "provider_derived", program: null };
  }
  return { state: "unknown", authority: "none", program: null };
}

const sameValue = (a: unknown, b: unknown): boolean => (a ?? null) === (b ?? null);

/**
 * The record to store, or null when nothing should be written.
 *
 * Three rules, in order:
 *
 *   1. NEVER DOWNGRADE. A sweep that would move a stored `certified: true` to
 *      false or unknown writes nothing at all. This is the nightly regression
 *      the QX50 suffered, refused at the last place it could be.
 *   2. NEVER INVENT. With no stored record and nothing authoritative to say,
 *      there is no row to write — an empty record asserting "unknown" is still
 *      a claim that someone looked and decided.
 *   3. NEVER CHURN. An unchanged answer returns null, so a nightly sweep does
 *      not rewrite the same row 365 times and bury the day it did change.
 *
 * The provider's raw answer is recorded beside the resolved one, never in
 * place of it, so `certified` and `provider_echo` can disagree on the row and
 * an operator can see that they do.
 */
export function mergeResolvedCertification(
  prior: StoredCertification | null | undefined,
  resolution: CertificationResolution,
  now: string,
): StoredCertification | null {
  const before = prior ?? null;
  const priorFlag = before ? readProviderCertification(before.certified) : { value: null, malformed: false };
  const priorState: CertificationState = priorFlag.value === null
    ? "unknown"
    : priorFlag.value ? "certified" : "not_certified";

  // Rule 1.
  if (isCertificationRegression(priorState, resolution.certified)) return null;

  // Rule 2.
  if (!before && resolution.certified === "unknown" && resolution.providerEcho === null) return null;

  const next: StoredCertification = {
    ...(before ?? {}),
    certified: resolution.certified === "unknown" ? (before?.certified ?? null) : resolution.certified === "certified",
    provider_echo: resolution.providerEcho,
    provider_conflict: resolution.conflict,
    provider_quarantined: resolution.quarantineProviderAttribute,
    resolved_at: now,
  };

  // An authoritative record keeps its own provenance. Resolution does not
  // reattribute who said the car was certified.
  if (before?.source) next.source = before.source;
  else if (resolution.authority !== "none") next.source = resolution.authority;
  if (resolution.program && !before?.program_name) next.program_name = resolution.program;

  // Rule 3: compare everything except the timestamp.
  if (before && ["certified", "provider_echo", "provider_conflict", "provider_quarantined", "source", "program_name"]
    .every((k) => sameValue(before[k], next[k]))) {
    return null;
  }

  return next;
}
