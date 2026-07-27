// ─────────────────────────────────────────────────────────────────────
// Schema-constrained parsing of generator output (Phase 7 §12-§13).
//
// Everything that arrives here is UNTRUSTED. A generated candidate is a
// proposal about WORDING and nothing else: it may not carry a database
// identity, an approval, a publication state or its own score. Those are
// decided by the orchestrator against the fact packet, never asserted by
// the thing being judged.
//
// The parse result therefore separates two very different failures:
//   - presentation defects (fenced JSON, wrong shape, a missing field),
//     which a bounded repair pass can legitimately fix
//   - authority defects (a model writing `approvalStatus`), which are not
//     a formatting problem and must never be repaired into acceptance
// ─────────────────────────────────────────────────────────────────────

export const CANDIDATE_SCHEMA_VERSION = "candidate_v1";

export interface DescriptionCandidate {
  schemaVersion: string;
  title: string | null;
  shortSummary: string | null;
  mainDescription: string;
  paragraphs: string[];
  featureHighlights: string[];
  ctaText: string | null;
  disclosureText: string | null;
  primaryKeywordUsed: boolean;
  secondaryKeywordsUsed: string[];
  claimedFeatureIds: string[];
  omittedFeatureIds: string[];
  uncertaintyFlags: string[];
  candidateWarnings: string[];
}

export type CandidateParseCode =
  | "OK"
  | "EMPTY_RESPONSE"
  | "NOT_JSON"
  | "SCHEMA_MISMATCH"
  | "MISSING_REQUIRED_FIELD"
  | "UNKNOWN_SCHEMA_VERSION"
  | "FORBIDDEN_FIELD"
  | "INVALID_FIELD_TYPE";

export interface CandidateParseResult {
  ok: boolean;
  code: CandidateParseCode;
  candidate: DescriptionCandidate | null;
  /** True only when a bounded re-ask can plausibly fix the SAME response. */
  repairable: boolean;
  errors: string[];
  rawLength: number;
}

/**
 * Fields a model must never be allowed to set. Each one, if honored, would let
 * generated text assert a database identity, its own approval, its own
 * publication state or its own quality — the four decisions that exist
 * precisely because the model cannot be trusted to make them.
 */
export const FORBIDDEN_CANDIDATE_FIELDS: string[] = [
  "id",
  "versionId",
  "descriptionId",
  "approvalStatus",
  "approved",
  "published",
  "publicationStatus",
  "score",
  "qualityScore",
  "validationStatus",
  "tenantId",
  "vehicleId",
];

// Models emit camelCase and snake_case interchangeably, so `approval_status`
// has to be caught by the same rule as `approvalStatus`.
const canonicalKey = (k: string): string => k.replace(/[_\-\s]/g, "").toLowerCase();

const FORBIDDEN_KEYS = new Set(FORBIDDEN_CANDIDATE_FIELDS.map(canonicalKey));

// A repairable code means the response was well-intentioned but badly
// presented. FORBIDDEN_FIELD and UNKNOWN_SCHEMA_VERSION are deliberately
// absent: re-asking cannot make an approval assertion or an unrecognized
// contract safe to accept.
const REPAIRABLE_CODES = new Set<CandidateParseCode>([
  "NOT_JSON",
  "SCHEMA_MISMATCH",
  "MISSING_REQUIRED_FIELD",
  "INVALID_FIELD_TYPE",
]);

const FENCE = /^```[a-z0-9_-]*\s*\n?([\s\S]*?)\n?\s*```$/i;

export function stripCodeFences(raw: string): string {
  const text = String(raw ?? "").replace(/\r\n/g, "\n").trim();
  const whole = text.match(FENCE);
  if (whole) return whole[1].trim();
  // A fenced block wrapped in chatter ("Here is the JSON: ```{...}```") is the
  // other common shape; take the first block rather than the surrounding prose.
  const inner = text.match(/```[a-z0-9_-]*\s*\n?([\s\S]*?)\n?\s*```/i);
  return inner ? inner[1].trim() : text;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function readNullableString(
  obj: Record<string, unknown>, keys: string[], errors: string[],
): string | null {
  const v = pick(obj, keys);
  if (v === undefined) return null;
  if (typeof v !== "string") {
    errors.push(`"${keys[0]}" must be a string, received ${Array.isArray(v) ? "array" : typeof v}`);
    return null;
  }
  return v;
}

function readStringArray(
  obj: Record<string, unknown>, keys: string[], errors: string[],
): string[] {
  const v = pick(obj, keys);
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    errors.push(`"${keys[0]}" must be an array of strings, received ${typeof v}`);
    return [];
  }
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") {
      errors.push(`"${keys[0]}" must contain only strings, received ${typeof item}`);
      continue;
    }
    out.push(item);
  }
  return out;
}

function readBoolean(
  obj: Record<string, unknown>, keys: string[], errors: string[],
): boolean {
  const v = pick(obj, keys);
  if (v === undefined) return false;
  if (typeof v !== "boolean") {
    errors.push(`"${keys[0]}" must be a boolean, received ${typeof v}`);
    return false;
  }
  return v;
}

const splitParagraphs = (text: string): string[] =>
  String(text ?? "").replace(/\r\n/g, "\n").split(/\n\s*\n/)
    .map((p) => p.trim()).filter(Boolean);

function emptyCandidate(): DescriptionCandidate {
  return {
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    title: null,
    shortSummary: null,
    mainDescription: "",
    paragraphs: [],
    featureHighlights: [],
    ctaText: null,
    disclosureText: null,
    primaryKeywordUsed: false,
    secondaryKeywordsUsed: [],
    claimedFeatureIds: [],
    omittedFeatureIds: [],
    uncertaintyFlags: [],
    candidateWarnings: [],
  };
}

/**
 * Wraps unstructured prose in the candidate shape. Only for channels whose
 * prompt does not require structured output — it asserts nothing the model did
 * not write, so every structured field stays empty rather than guessed.
 */
export function coercePlainText(raw: string): DescriptionCandidate {
  const body = stripCodeFences(raw);
  return normalizeCandidate({
    ...emptyCandidate(),
    mainDescription: body,
    paragraphs: splitParagraphs(body),
    candidateWarnings: ["coerced_from_plain_text"],
  });
}

/**
 * Whitespace and formatting only. This function must never change meaning:
 * no rewording, no truncation, no punctuation repair, no case changes. If a
 * candidate needs different words it goes back to the model, not through here.
 */
export function normalizeCandidate(c: DescriptionCandidate): DescriptionCandidate {
  const text = (s: string): string =>
    s.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n").trim();
  const nullable = (s: string | null): string | null => {
    if (s === null) return null;
    const t = text(s);
    return t ? t : null;
  };
  const list = (a: string[]): string[] => a.map((s) => text(s)).filter(Boolean);

  const mainDescription = text(stripCodeFences(c.mainDescription ?? ""));
  const paragraphs = list(c.paragraphs ?? []);

  return {
    schemaVersion: c.schemaVersion || CANDIDATE_SCHEMA_VERSION,
    title: nullable(c.title ?? null),
    shortSummary: nullable(c.shortSummary ?? null),
    mainDescription,
    paragraphs: paragraphs.length ? paragraphs : splitParagraphs(mainDescription),
    featureHighlights: list(c.featureHighlights ?? []),
    ctaText: nullable(c.ctaText ?? null),
    disclosureText: nullable(c.disclosureText ?? null),
    primaryKeywordUsed: c.primaryKeywordUsed === true,
    secondaryKeywordsUsed: list(c.secondaryKeywordsUsed ?? []),
    claimedFeatureIds: list(c.claimedFeatureIds ?? []),
    omittedFeatureIds: list(c.omittedFeatureIds ?? []),
    uncertaintyFlags: list(c.uncertaintyFlags ?? []),
    candidateWarnings: list(c.candidateWarnings ?? []),
  };
}

function failure(
  code: CandidateParseCode, errors: string[], rawLength: number,
): CandidateParseResult {
  return { ok: false, code, candidate: null, repairable: REPAIRABLE_CODES.has(code), errors, rawLength };
}

export function parseCandidate(
  raw: string, opts: { allowPlainText?: boolean } = {},
): CandidateParseResult {
  const rawLength = typeof raw === "string" ? raw.length : 0;

  if (typeof raw !== "string" || raw.trim() === "") {
    return failure("EMPTY_RESPONSE", ["the generator returned no content"], rawLength);
  }

  const body = stripCodeFences(raw);
  if (!body) {
    return failure("EMPTY_RESPONSE", ["the response contained only a code fence"], rawLength);
  }

  let parsed: unknown;
  let jsonOk = true;
  try {
    parsed = JSON.parse(body);
  } catch {
    jsonOk = false;
  }

  if (!jsonOk || typeof parsed === "string") {
    if (opts.allowPlainText) {
      const candidate = coercePlainText(typeof parsed === "string" ? parsed : raw);
      if (!candidate.mainDescription) {
        return failure("EMPTY_RESPONSE", ["the response contained no description text"], rawLength);
      }
      return { ok: true, code: "OK", candidate, repairable: false, errors: [], rawLength };
    }
    if (!jsonOk) {
      return failure("NOT_JSON", ["the response is not valid JSON"], rawLength);
    }
  }

  if (!isRecord(parsed)) {
    return failure(
      "SCHEMA_MISMATCH",
      [`expected a JSON object, received ${Array.isArray(parsed) ? "array" : typeof parsed}`],
      rawLength,
    );
  }

  // Checked before anything else is read: a response that tries to assert
  // approval or identity is rejected whole, never partially honored.
  const forbidden = Object.keys(parsed).filter((k) => FORBIDDEN_KEYS.has(canonicalKey(k)));
  if (forbidden.length) {
    return failure(
      "FORBIDDEN_FIELD",
      forbidden.map((k) => `"${k}" is decided by the platform and may not be supplied by the generator`),
      rawLength,
    );
  }

  const declared = parsed.schemaVersion ?? parsed.schema_version;
  if (declared !== undefined && declared !== null) {
    if (typeof declared !== "string") {
      return failure("INVALID_FIELD_TYPE", [`"schemaVersion" must be a string, received ${typeof declared}`], rawLength);
    }
    if (declared.trim() !== CANDIDATE_SCHEMA_VERSION) {
      return failure(
        "UNKNOWN_SCHEMA_VERSION",
        [`schema version "${declared}" is not ${CANDIDATE_SCHEMA_VERSION}; the field meanings are unknown`],
        rawLength,
      );
    }
  }

  const errors: string[] = [];
  // `content` / `seo_title` / `meta_description` are what the existing channel
  // prompt asks for; accepting them here keeps the older generator contract
  // parseable without a repair round-trip.
  const main = pick(parsed, ["mainDescription", "main_description", "content", "description"]);
  if (main === undefined) {
    return failure("MISSING_REQUIRED_FIELD", ['"mainDescription" is required'], rawLength);
  }
  if (typeof main !== "string") {
    return failure("INVALID_FIELD_TYPE", [`"mainDescription" must be a string, received ${Array.isArray(main) ? "array" : typeof main}`], rawLength);
  }

  const candidate: DescriptionCandidate = {
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    title: readNullableString(parsed, ["title", "seo_title", "seoTitle"], errors),
    shortSummary: readNullableString(parsed, ["shortSummary", "short_summary", "meta_description", "metaDescription"], errors),
    mainDescription: main,
    paragraphs: readStringArray(parsed, ["paragraphs"], errors),
    featureHighlights: readStringArray(parsed, ["featureHighlights", "feature_highlights"], errors),
    ctaText: readNullableString(parsed, ["ctaText", "cta_text"], errors),
    disclosureText: readNullableString(parsed, ["disclosureText", "disclosure_text"], errors),
    primaryKeywordUsed: readBoolean(parsed, ["primaryKeywordUsed", "primary_keyword_used"], errors),
    secondaryKeywordsUsed: readStringArray(parsed, ["secondaryKeywordsUsed", "secondary_keywords_used"], errors),
    claimedFeatureIds: readStringArray(parsed, ["claimedFeatureIds", "claimed_feature_ids"], errors),
    omittedFeatureIds: readStringArray(parsed, ["omittedFeatureIds", "omitted_feature_ids"], errors),
    uncertaintyFlags: readStringArray(parsed, ["uncertaintyFlags", "uncertainty_flags"], errors),
    candidateWarnings: readStringArray(parsed, ["candidateWarnings", "candidate_warnings"], errors),
  };

  if (errors.length) return failure("INVALID_FIELD_TYPE", errors, rawLength);

  const normalized = normalizeCandidate(candidate);
  if (!normalized.mainDescription) {
    return failure("EMPTY_RESPONSE", ["the description body is empty"], rawLength);
  }
  if (declared === undefined || declared === null) {
    normalized.candidateWarnings = [...normalized.candidateWarnings, "schema_version_absent"];
  }

  return { ok: true, code: "OK", candidate: normalized, repairable: false, errors: [], rawLength };
}
