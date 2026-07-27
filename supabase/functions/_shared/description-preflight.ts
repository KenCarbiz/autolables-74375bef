// ─────────────────────────────────────────────────────────────────────
// Preflight (§7) — everything that must be true BEFORE a token is spent.
//
// The point is narrow and financial: a generation request that was always
// going to fail should fail for free. Asking the model to discover that the
// dealership has no city configured costs money and produces a worse answer
// than a one-line rejection.
//
// Every rejection carries an actionable reason. "Generation failed" tells an
// operator nothing; "Voice profile is awaiting approval" tells them exactly
// which screen to open.
// ─────────────────────────────────────────────────────────────────────

import type { FactSnapshot } from "./description-core.ts";
import type { ChannelPolicy } from "./description-channel-policy.ts";
import type { VoiceProfile } from "./description-voice.ts";
import type { SeoTargeting } from "./description-scoring.ts";

export type PreflightCode =
  | "NOT_AUTHENTICATED" | "INSUFFICIENT_PERMISSION"
  | "VEHICLE_NOT_FOUND" | "VEHICLE_TENANT_MISMATCH" | "VEHICLE_ARCHIVED"
  | "TRUTH_SNAPSHOT_MISSING" | "VEHICLE_IDENTITY_INCOMPLETE"
  | "UNRESOLVED_MATERIAL_CONFLICT"
  | "NO_DESCRIPTION_ELIGIBLE_FEATURES" | "INVALID_SELECTED_FEATURE"
  | "CHANNEL_DISABLED" | "CHANNEL_POLICY_MISSING"
  | "VOICE_PROFILE_UNAPPROVED" | "DEALER_IDENTITY_INCOMPLETE"
  | "INVALID_PRIMARY_KEYWORD" | "UNSUPPORTED_KEYWORD_CLAIM"
  | "REQUIRED_DISCLOSURE_UNAVAILABLE"
  | "GENERATION_IN_PROGRESS" | "BUDGET_EXCEEDED" | "PROVIDER_UNAVAILABLE";

export interface PreflightFinding {
  code: PreflightCode;
  /** Blocking stops the request before any provider call. */
  blocking: boolean;
  /** Shown to the operator. Must name the fix, not just the failure. */
  message: string;
  /** Where to go to fix it. */
  remedy?: string;
}

export interface PreflightResult {
  ok: boolean;
  findings: PreflightFinding[];
  /** Codes that blocked, for the audit event and the error taxonomy. */
  blockingCodes: PreflightCode[];
}

export interface PreflightInput {
  authenticated: boolean;
  canGenerate: boolean;
  listing: Record<string, any> | null;
  tenantId: string;
  snapshot: FactSnapshot | null;
  policy: ChannelPolicy | undefined;
  channelEnabled: boolean;
  voice: VoiceProfile;
  targeting: SeoTargeting;
  /** Feature ids the caller asked for, if it named any. */
  requestedFeatureIds?: string[];
  /** A live job for the same idempotency identity. */
  jobInFlight?: boolean;
  budget?: { withinBudget: boolean; reason?: string };
  providerConfigured: boolean;
}

// Keyword phrases that assert something the description engine can never
// support. Blocking these at preflight matters more than blocking them in the
// output: a dealer who types "accident-free QX80" as their target phrase will
// otherwise pay for a generation that is guaranteed to be rejected.
const UNSUPPORTABLE_KEYWORD = [
  { pattern: /\baccident[- ]free\b|\bno\s+accidents\b/i, label: "accident history" },
  { pattern: /\bone[- ]owner\b|\bsingle[- ]owner\b/i, label: "ownership history" },
  { pattern: /\bcertified\b/i, label: "certification" },
  { pattern: /\bwarrant(y|ied)\b/i, label: "warranty coverage" },
  { pattern: /\bcheapest\b|\blowest\s+price\b|\bbest\s+price\b|\bbelow\s+market\b/i, label: "price position" },
  { pattern: /\bguaranteed\b/i, label: "a guarantee" },
  { pattern: /\bmint\b|\bflawless\b|\bperfect\s+condition\b|\blike\s+new\b/i, label: "condition" },
];

export function preflight(input: PreflightInput): PreflightResult {
  const f: PreflightFinding[] = [];
  const block = (code: PreflightCode, message: string, remedy?: string) =>
    f.push({ code, blocking: true, message, remedy });
  const warn = (code: PreflightCode, message: string, remedy?: string) =>
    f.push({ code, blocking: false, message, remedy });

  // ── Identity and authority ───────────────────────────────────────
  if (!input.authenticated) {
    block("NOT_AUTHENTICATED", "Your session has expired.", "Sign in and retry.");
    return done(f);
  }
  if (!input.canGenerate) {
    block("INSUFFICIENT_PERMISSION",
      "Your role cannot run description generation.",
      "Ask a manager or admin to generate, or to change your role.");
    return done(f);
  }

  // ── The vehicle ──────────────────────────────────────────────────
  const listing = input.listing;
  if (!listing) {
    block("VEHICLE_NOT_FOUND", "This vehicle is not in your inventory.");
    return done(f);
  }
  if (listing.tenant_id !== input.tenantId) {
    // Deliberately the same wording as not-found: a cross-tenant probe must
    // not learn that the VIN exists somewhere else.
    block("VEHICLE_TENANT_MISMATCH", "This vehicle is not in your inventory.");
    return done(f);
  }
  if (listing.status === "archived") {
    block("VEHICLE_ARCHIVED", "This vehicle is archived.",
      "Return it to active inventory before generating a description.");
    return done(f);
  }

  // ── Truth ────────────────────────────────────────────────────────
  const snap = input.snapshot;
  if (!snap) {
    block("TRUTH_SNAPSHOT_MISSING", "No vehicle truth snapshot exists yet.",
      "Run enrichment for this VIN, then retry.");
    return done(f);
  }
  if (!snap.facts?.vin || !snap.facts?.ymm) {
    block("VEHICLE_IDENTITY_INCOMPLETE",
      "Vehicle identity is incomplete — year, make and model are required.",
      "Open the vehicle truth record and resolve the missing identity fields.");
  }
  const materialConflicts = (snap.conflicts || []).filter((c) => c.material);
  if (materialConflicts.length) {
    // Not blocking: the packet already excludes the disputed claim, so the
    // copy is safe. The operator should know the vehicle will read thinner.
    warn("UNRESOLVED_MATERIAL_CONFLICT",
      `${materialConflicts.length} unresolved source conflict(s); the disputed equipment will be left out.`,
      "Resolve them in the vehicle truth record to include that equipment.");
  }
  const eligible = (snap.features || []).filter((x) => x.description_eligible);
  if (!eligible.length) {
    warn("NO_DESCRIPTION_ELIGIBLE_FEATURES",
      "No description-eligible equipment is verified for this vehicle.",
      "The copy will cover identity and powertrain only.");
  }
  if (input.requestedFeatureIds?.length) {
    const known = new Set((snap.features || []).map((x) => x.canonical_id));
    const bogus = input.requestedFeatureIds.filter((id) => !known.has(id));
    if (bogus.length) {
      // A feature the snapshot does not carry cannot be "selected" — that is
      // the browser asserting a vehicle fact, which is exactly the bypass the
      // truth layer exists to prevent.
      block("INVALID_SELECTED_FEATURE",
        `${bogus.length} selected feature(s) are not supported by the current truth snapshot.`,
        "Submit a dealer correction through the vehicle truth workflow instead.");
    }
  }

  // ── Channel ──────────────────────────────────────────────────────
  if (!input.channelEnabled) {
    block("CHANNEL_DISABLED", "This channel is not enabled for your dealership.",
      "Enable it in channel settings first.");
  }
  if (!input.policy) {
    block("CHANNEL_POLICY_MISSING", "No active policy exists for this channel.",
      "A platform administrator must publish a channel policy.");
  } else if (!input.policy.active) {
    block("CHANNEL_POLICY_MISSING", `The ${input.policy.label} policy is not active.`);
  }

  // ── Voice and dealership identity ────────────────────────────────
  if (input.voice.status === "draft") {
    block("VOICE_PROFILE_UNAPPROVED",
      "The dealership voice profile is still a draft.",
      "Approve the voice profile before generating customer-facing copy.");
  }
  if (!input.voice.dealerName) {
    block("DEALER_IDENTITY_INCOMPLETE", "The dealership name is not configured.",
      "Set it in Branding & Setup.");
  }
  if (!input.voice.city || !input.voice.state) {
    // Local relevance is scored, and a missing city silently costs points on
    // every generation. Warn rather than block — the copy is still valid.
    warn("DEALER_IDENTITY_INCOMPLETE",
      "The dealership city or state is not configured; local relevance will score low.",
      "Set them in Branding & Setup.");
  }
  for (const d of input.voice.requiredDisclosures) {
    if (!d || !d.trim()) {
      block("REQUIRED_DISCLOSURE_UNAVAILABLE",
        "A required disclosure is configured but has no text.",
        "Fix the disclosure text before generating.");
    }
  }

  // ── Keyword ──────────────────────────────────────────────────────
  const kw = String(input.targeting.primaryKeyword || "");
  if (kw) {
    if (/<[^>]|javascript:|[\u0000-\u001f]/i.test(kw)) {
      block("INVALID_PRIMARY_KEYWORD", "The primary keyword contains markup or control characters.");
    }
    if (kw.length > 90) {
      block("INVALID_PRIMARY_KEYWORD", "The primary keyword is too long to use naturally.");
    }
    for (const rule of UNSUPPORTABLE_KEYWORD) {
      if (rule.pattern.test(kw)) {
        block("UNSUPPORTED_KEYWORD_CLAIM",
          `The primary keyword asserts ${rule.label}, which cannot be supported for this vehicle.`,
          "Choose a phrase describing the vehicle rather than a claim about it.");
        break;
      }
    }
  }

  // ── Cost and concurrency ─────────────────────────────────────────
  if (input.jobInFlight) {
    block("GENERATION_IN_PROGRESS", "A generation for this vehicle is already running.",
      "Wait for it to finish — it will appear here automatically.");
  }
  if (input.budget && !input.budget.withinBudget) {
    block("BUDGET_EXCEEDED", input.budget.reason || "This dealership has reached its generation budget.",
      "An owner or compliance user can raise the limit or approve an override.");
  }
  if (!input.providerConfigured) {
    block("PROVIDER_UNAVAILABLE", "The AI provider is not configured.",
      "A platform administrator must configure provider credentials.");
  }

  return done(f);
}

function done(findings: PreflightFinding[]): PreflightResult {
  const blockingCodes = findings.filter((x) => x.blocking).map((x) => x.code);
  return { ok: blockingCodes.length === 0, findings, blockingCodes };
}

/** One line for the job record and the audit event. */
export function preflightSummary(r: PreflightResult): string {
  if (r.ok) return "preflight passed";
  return r.findings.filter((x) => x.blocking).map((x) => x.message).join(" · ").slice(0, 400);
}
