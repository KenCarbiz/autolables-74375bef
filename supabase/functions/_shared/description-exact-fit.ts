// Deterministic wire-text counting and exact-length fitting for destinations
// that require a precise total (vAuto: exactly 3,921 characters including the
// CTA, separators and the approved disclosure). Pure: no network, no provider
// calls. Ported from the DriveSignal kit's engine.mjs (2026-10-31).
//
// The fitter selects whole approved sentences. It never pads, never truncates
// mid-sentence and never alters the disclosure. When no combination reaches
// the exact target it throws EXACT_LENGTH_UNREACHABLE and the variant is held
// for review.

export const EXACT_FIT_COUNTER_VERSION = "exact_fit_1";

export interface WireProfile {
  exactTotal?: number | null;
  localMax?: number | null;
  singleLine?: boolean;
  asciiOnly?: boolean;
  countUnit?: "codePoints" | "utf16" | "utf8Bytes";
  prohibitedPhrases?: string[];
}

export interface ApprovedDisclosure {
  text: string;
  version: string;
  approved: boolean;
}

export interface FitSection {
  id: string;
  required?: boolean;
  variants: Array<{ text: string; utility?: number }>;
}

export interface FitResult {
  text: string;
  counts: TextCounts;
  choices: Array<{ section: string; variant: number }>;
  disclosureVersion: string;
}

export interface TextCounts { codePoints: number; utf16: number; utf8Bytes: number }

export class DescriptionFitError extends Error {
  code: string;
  details: Record<string, unknown>;
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const fail = (code: string, message: string, details?: Record<string, unknown>): never => {
  throw new DescriptionFitError(code, message, details);
};

export const countText = (text: string): TextCounts => ({
  codePoints: [...text].length,
  utf16: text.length,
  utf8Bytes: new TextEncoder().encode(text).length,
});

export function wireText(text: string, profile: WireProfile): string {
  if (typeof text !== "string") fail("INVALID_TEXT", "Text must be a string.");
  // deno-lint-ignore no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)) fail("CONTROL_CHARACTERS", "Control characters are not permitted.");
  if (/[<>]/u.test(text)) fail("MARKUP_NOT_ALLOWED", "Plain text only.");
  if (/[​-‏‪-‮⁠-⁯﻿]/u.test(text)) fail("INVISIBLE_CHARACTERS", "Invisible or directional controls require review.");
  let result = text.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  if (profile.singleLine) result = result.replace(/\s+/gu, " ");
  if (profile.asciiOnly && /[^\x20-\x7E]/u.test(result)) {
    fail("NON_ASCII_REVIEW", "Use reviewed ASCII text for this counting contract. Disclosures are never transliterated.");
  }
  return result;
}

const lengthOf = (text: string, profile: WireProfile) => countText(text)[profile.countUnit ?? "codePoints"];

function disclosureSuffix(disclosure: ApprovedDisclosure | null | undefined, profile: WireProfile): string {
  if (!disclosure?.approved || typeof disclosure.text !== "string" || !disclosure.version) {
    fail("DISCLOSURE_NOT_APPROVED", "An approved, versioned disclosure decision is required; an explicitly approved empty string is allowed.");
  }
  const canonical = wireText(disclosure!.text, profile);
  if (canonical !== disclosure!.text) fail("DISCLOSURE_NORMALIZATION", "Approve the exact wire-format disclosure before generation.");
  return canonical;
}

/**
 * Bounded dynamic programming over whole-text variants in fixed section order.
 * Returns the highest-utility combination whose final serialized length,
 * disclosure included, equals the target exactly.
 */
export function fitExact(args: { sections: FitSection[]; disclosure: ApprovedDisclosure; profile: WireProfile }): FitResult {
  const { sections, disclosure, profile } = args;
  const target = profile.exactTotal;
  if (!Number.isSafeInteger(target) || (target as number) < 1 || (target as number) > 20000
      || !Number.isSafeInteger(profile.localMax) || (target as number) > (profile.localMax as number)) {
    fail("INVALID_TARGET", "Exact target must be an integer within the configured local maximum.");
  }
  const goal = target as number;
  if (!Array.isArray(sections) || !sections.length || sections.length > 40) fail("INVALID_SECTIONS", "Supply between 1 and 40 sections.");
  const suffix = disclosureSuffix(disclosure, profile);
  const joiner = profile.singleLine ? " " : "\n\n";
  const joinLen = lengthOf(joiner, profile);
  // Lengths are additive across NFC pieces joined by whitespace, so the DP
  // tracks sizes and back-pointers instead of building strings per state.
  type Cell = { score: number; prev: number; variant: number };
  const layers: Array<Map<number, Cell>> = [];
  const texts: string[][] = [];
  let frontier = new Map<number, Cell>([[0, { score: 0, prev: -1, variant: -1 }]]);
  for (const section of sections) {
    if (!section.id || !Array.isArray(section.variants) || !section.variants.length || section.variants.length > 24) {
      fail("INVALID_VARIANTS", "Each section needs an ID and between 1 and 24 candidates.");
    }
    const candidates = section.variants.map((v, index) => {
      const text = wireText(v.text, profile);
      if (section.required && !text) fail("REQUIRED_SECTION_EMPTY", `Section ${section.id} cannot be omitted.`);
      return { text, len: lengthOf(text, profile), utility: Number.isFinite(v.utility) ? (v.utility as number) : 0, index };
    });
    texts.push(candidates.map((c) => c.text));
    const next = new Map<number, Cell>();
    for (const [size, cell] of frontier) {
      for (const variant of candidates) {
        const nextSize = size + (size > 0 && variant.len > 0 ? joinLen : 0) + variant.len;
        if (nextSize > goal) continue;
        const score = cell.score + variant.utility;
        const prior = next.get(nextSize);
        if (!prior || prior.score < score) next.set(nextSize, { score, prev: size, variant: variant.index });
      }
    }
    layers.push(next);
    frontier = next;
  }
  const suffixLen = lengthOf(suffix, profile);
  const ranked = [...frontier.entries()].sort((a, b) => b[1].score - a[1].score);
  for (const [size] of ranked) {
    const total = size + (size > 0 && suffixLen > 0 ? joinLen : 0) + suffixLen;
    if (total !== goal) continue;
    const picks: number[] = new Array(sections.length);
    let at = size;
    for (let k = sections.length - 1; k >= 0; k--) {
      const cell = layers[k].get(at)!;
      picks[k] = cell.variant;
      at = cell.prev;
    }
    const body = picks.map((v, k) => texts[k][v]).filter(Boolean).join(joiner);
    const text = body + (body && suffix ? joiner : "") + suffix;
    if (lengthOf(text, profile) !== goal) fail("COUNTER_MISMATCH", "Additive count disagreed with the serialized text.");
    return { text, counts: countText(text), disclosureVersion: disclosure.version,
      choices: picks.map((v, k) => ({ section: sections[k].id, variant: v })) };
  }
  return fail("EXACT_LENGTH_UNREACHABLE",
    "No approved combination reaches the exact total. Request additional meaningful variants or hold for review. Never add padding or cut the disclosure.",
    { target: goal, candidateLengths: [...frontier.keys()].sort((a, b) => a - b).slice(-12) });
}

export interface EvidenceFact {
  id: string;
  source?: string;
  status?: string;
  conflict?: boolean;
  kind?: string;
  vehicleId?: string;
  storeId?: string;
  marketContextId?: string;
  observedAt?: string;
  expiresAt?: string;
  dynamic?: boolean;
  equipment?: boolean;
  installationStatus?: string;
}

/** Scope, freshness and installation filter. Eligibility, not entailment. */
export function eligibleFacts<T extends EvidenceFact>(
  facts: T[], scope: { vehicleId: string; storeId: string; marketContextId?: string }, now = Date.now(),
): T[] {
  return facts.filter((f) => {
    if (!f.id || !f.source || !["verified", "confirmed"].includes(String(f.status)) || f.conflict) return false;
    if (f.kind === "vehicle" && f.vehicleId !== scope.vehicleId) return false;
    if (f.kind === "store" && f.storeId !== scope.storeId) return false;
    if (f.kind === "market" && f.marketContextId !== scope.marketContextId) return false;
    if (!["vehicle", "store", "market"].includes(String(f.kind))) return false;
    const observed = Date.parse(String(f.observedAt));
    if (!Number.isFinite(observed) || observed > now) return false;
    if (f.expiresAt && (!Number.isFinite(Date.parse(f.expiresAt)) || Date.parse(f.expiresAt) <= now)) return false;
    if (f.dynamic && (!f.expiresAt || !Number.isFinite(Date.parse(f.expiresAt)))) return false;
    if (f.equipment && !["confirmed_installed", "verified_standard_for_exact_configuration"].includes(String(f.installationStatus))) return false;
    return true;
  });
}

// ── Narrative → exact-length variant ────────────────────────────────

// Typographic punctuation a writer routinely emits. Narrative drafts are not
// yet approved wording, so mapping these to ASCII before review is safe. The
// disclosure is never passed through this.
const ASCII_PUNCTUATION: Array<[RegExp, string]> = [
  [/[‘’‚′]/g, "'"],
  [/[“”„″]/g, '"'],
  [/[–—−]/g, "-"],
  [/…/g, "..."],
  [/ /g, " "],
];

export function asciiPunctuation(text: string): string {
  let out = text;
  for (const [re, rep] of ASCII_PUNCTUATION) out = out.replace(re, rep);
  return out;
}

/** Sentence units. A decimal ("2.0L") has no following space, so it never splits. */
export function splitSentences(text: string): string[] {
  return text.replace(/\s+/g, " ").trim()
    .split(/(?<=[.!?])\s+(?=["'(A-Z0-9])/)
    .map((s) => s.trim()).filter(Boolean);
}

export interface ExactChannelFit {
  ok: boolean;
  text: string | null;
  code: string | null;
  message: string | null;
  meta: Record<string, unknown>;
}

/**
 * Fits a generated channel narrative to an exact total by dropping whole
 * optional sentences. The first sentence (vehicle identity) and the approved
 * CTA are required; the approved disclosure is appended verbatim last.
 */
export function fitNarrativeExact(args: {
  narrative: string;
  cta: string | null;
  disclosure: ApprovedDisclosure;
  profile: WireProfile;
}): ExactChannelFit {
  const { profile } = args;
  const base = { target: profile.exactTotal ?? null, counterVersion: EXACT_FIT_COUNTER_VERSION,
    countUnit: profile.countUnit ?? "codePoints", disclosureVersion: args.disclosure.version };
  try {
    const legal = args.disclosure.text.trim();
    let narrative = asciiPunctuation(args.narrative);
    // The writer must never restate the disclosure; strip a stray copy so it
    // is not counted twice.
    if (legal && narrative.includes(legal)) narrative = narrative.split(legal).join(" ");
    let units = splitSentences(narrative);
    if (!units.length) return { ok: false, text: null, code: "REQUIRED_SECTION_EMPTY", message: "The narrative is empty.", meta: base };
    const cta = args.cta ? asciiPunctuation(args.cta).trim() : "";
    if (cta && units.length && units[units.length - 1] === cta) units = units.slice(0, -1);
    // Keep within the fitter's 40-section bound by joining the shortest
    // adjacent pair each time; the opening identity sentence stays on its own.
    const room = 40 - (cta ? 1 : 0);
    while (units.length > room) {
      let best = 1;
      for (let i = 2; i < units.length - 1; i++) {
        if (units[i].length + units[i + 1].length < units[best].length + units[best + 1].length) best = i;
      }
      units = [...units.slice(0, best), `${units[best]} ${units[best + 1]}`, ...units.slice(best + 2)];
    }
    const sections: FitSection[] = units.map((u, i) => i === 0
      ? { id: "s0", required: true, variants: [{ text: u, utility: 1000 }] }
      // Keeping a sentence is worth its length: the fitter prefers the most
      // verified content that still lands exactly on target.
      : { id: `s${i}`, variants: [{ text: u, utility: u.length }, { text: "", utility: 0 }] });
    if (cta) sections.push({ id: "cta", required: true, variants: [{ text: cta, utility: 0 }] });
    const result = fitExact({ sections, disclosure: { ...args.disclosure, text: legal }, profile });
    const dropped = result.choices
      .filter((c) => c.section !== "s0" && c.section !== "cta" && c.variant === 1)
      .map((c) => units[Number(c.section.slice(1))]);
    return { ok: true, text: result.text, code: null, message: null,
      meta: { ...base, counts: result.counts, ctaIncluded: Boolean(cta), sentencesKept: units.length - dropped.length,
        sentencesDropped: dropped.length, droppedSentences: dropped } };
  } catch (e) {
    const err = e as DescriptionFitError;
    return { ok: false, text: null, code: err.code || "EXACT_FIT_FAILED", message: err.message,
      meta: { ...base, ...(err.details || {}) } };
  }
}

/**
 * The approved disclosure decision for an exact-length export. The stored
 * dealer legal text is used verbatim; its version is a content hash, so any
 * edit invalidates a prior exact-length approval.
 */
export async function disclosureDecision(settings: Record<string, unknown>): Promise<ApprovedDisclosure> {
  const text = String(settings?.required_legal_text ?? "").trim();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const hex = Array.from(new Uint8Array(digest)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
  return { text, version: `disc_${hex}`, approved: true };
}
