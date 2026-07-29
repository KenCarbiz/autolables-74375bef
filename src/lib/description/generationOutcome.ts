// ─────────────────────────────────────────────────────────────────────
// Translating what the orchestrator actually did into what to tell the
// operator.
//
// The orchestrator distinguishes eight reasons a run produces no new
// version, and only two of them mean "nothing needed doing". The others are
// refusals with a fix attached. Reporting all of them as "inputs were
// unchanged" tells a blocked dealer their work is done when it is not.
// ─────────────────────────────────────────────────────────────────────

export type OutcomeTone = "success" | "info" | "error";

export interface GenerationResult {
  generated?: boolean;
  skipped?: string | null;
  blocking_codes?: string[] | null;
  reason?: string | null;
  cost_incurred?: boolean;
}

export interface RemedyLink {
  label: string;
  href: string;
}

export interface GenerationOutcome {
  tone: OutcomeTone;
  message: string;
  /** Preflight codes, surfaced verbatim so they match the audit record. */
  codes: string[];
  remedy?: RemedyLink;
  /**
   * True only when the server explicitly reported no cost. A refusal we do
   * not recognize leaves this false — telling an operator nothing was charged
   * is a claim about their bill, and it needs the server to have said it.
   */
  costFree: boolean;
}

const VOICE_PAGE: RemedyLink = {
  label: "Open Description Voice & SEO",
  href: "/admin/description-voice",
};

/**
 * Which screen clears each blocking code.
 *
 * Only codes with a screen that genuinely fixes them get a link. A code
 * without one shows its message alone — sending an operator to a page that
 * cannot resolve their problem is worse than sending them nowhere.
 */
const REMEDY_BY_CODE: Record<string, RemedyLink> = {
  VOICE_PROFILE_UNAPPROVED: VOICE_PAGE,
  DEALER_IDENTITY_INCOMPLETE: VOICE_PAGE,
  REQUIRED_DISCLOSURE_UNAVAILABLE: VOICE_PAGE,
};

const SKIP_COPY: Record<string, { tone: OutcomeTone; message: string }> = {
  unchanged: {
    tone: "info",
    message: "Inputs were unchanged — the existing version was reused. No AI request was made.",
  },
  equivalent_output_reused: {
    tone: "info",
    message: "An identical request was already paid for — that version was reused rather than billed again.",
  },
  preflight_rejected: {
    tone: "error",
    message: "Generation was refused before any AI cost.",
  },
  listing_not_found: {
    tone: "error",
    message: "This vehicle is not in your inventory.",
  },
  tenant_mismatch: {
    // Same wording as not-found on purpose: a cross-tenant probe must not
    // learn that the VIN exists somewhere else.
    tone: "error",
    message: "This vehicle is not in your inventory.",
  },
  archived: {
    tone: "error",
    message: "This vehicle is archived. Return it to active inventory before generating.",
  },
  case_not_initialized: {
    tone: "error",
    message: "This vehicle has no description record yet. Run enrichment for the VIN, then retry.",
  },
  already_claimed: {
    tone: "info",
    message: "A generation for this vehicle is already running. It will appear here when it finishes.",
  },
};

/** Refusals that happen before the orchestrator can reach a provider. */
const PRE_PROVIDER_SKIPS = new Set([
  "preflight_rejected", "listing_not_found", "tenant_mismatch", "archived",
  "case_not_initialized", "unchanged", "equivalent_output_reused",
]);

export function describeGenerationOutcome(result: GenerationResult | null | undefined): GenerationOutcome {
  const r = result || {};
  const codes = (r.blocking_codes || []).map(String).filter(Boolean);
  const skipped = String(r.skipped || "").trim();
  const costFree = r.cost_incurred === false || PRE_PROVIDER_SKIPS.has(skipped);

  if (r.generated) {
    return { tone: "success", message: "A new draft version was created.", codes: [], costFree: false };
  }

  const base = SKIP_COPY[skipped];

  if (skipped === "preflight_rejected") {
    // The server's own summary already names the fix per finding, so prefer it
    // over the generic line and keep the codes for the operator to quote.
    const detail = String(r.reason || "").trim();
    return {
      tone: "error",
      message: detail ? `Generation refused: ${detail}` : base.message,
      codes,
      remedy: codes.map((c) => REMEDY_BY_CODE[c]).find(Boolean),
      costFree,
    };
  }

  if (base) return { tone: base.tone, message: base.message, codes, costFree };

  // An unrecognized skip reason is reported as itself rather than smoothed
  // into "unchanged" — a new server-side refusal must not read as success.
  if (skipped) {
    return {
      tone: "error",
      message: `Generation did not produce a version (${skipped}).`,
      codes,
      costFree,
    };
  }
  return {
    tone: "info",
    message: "No new version was produced.",
    codes,
    costFree,
  };
}
