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
