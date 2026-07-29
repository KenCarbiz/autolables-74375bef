// ─────────────────────────────────────────────────────────────────────
// Deterministic repair pass (§15 steps 17-18).
//
// The rule that defines this whole module: REPAIR ONLY REMOVES. It deletes
// the sentence carrying an unsupported claim, trims to a length the channel
// accepts, strips formatting the destination cannot render, or appends a
// disclosure the dealer already approved verbatim.
//
// It never rewrites a claim into a softer one, never substitutes a synonym,
// and never asks a model to "fix" its own output — a repair that generates
// text is a second chance to hallucinate, and it would launder exactly the
// findings this pass exists to remove.
//
// Anything not on the repairable list is returned as unrepairable so the
// version stays blocked and a human decides.
// ─────────────────────────────────────────────────────────────────────

import type { Finding } from "./description-core.ts";
import type { ChannelPolicy } from "./description-channel-policy.ts";

/** Findings a deletion can genuinely resolve. */
const REPAIRABLE_BY_SENTENCE_REMOVAL = new Set([
  "UNAPPROVED_DEALER_CLAIM",
  "UNAPPROVED_SERVICE_AREA",
  "EXCLUDED_CLAIM_PRESENT",
  "UNSUPPORTED_FEATURE_CLAIM",
  "DEALER_ADDED_AS_FACTORY",
  "TONE_OVERREACH",
  "PROHIBITED_PHRASE",
  "CHANNEL_PROHIBITED_PHRASE",
  "CHANNEL_PRICE_NOT_ALLOWED",
  "LOCALITY_STUFFING",
  "CPO_CLAIM",
  "WARRANTY_CLAIM",
  "OWNERSHIP_CLAIM",
  "HISTORY_CLAIM",
  "MARKET_CLAIM",
  "SERVICE_CLAIM",
  "CONDITION_CLAIM",
  "RECALL_CLAIM",
]);

/**
 * Findings that must NEVER be repaired.
 *
 * An identity conflict means the copy describes a different vehicle; deleting
 * the sentence would leave copy that is quietly about nothing. Missing
 * identity data and unresolved source conflicts are upstream truth problems —
 * editing the text hides them without fixing them.
 */
const NEVER_REPAIRABLE = new Set([
  "IDENTITY_YEAR_CONFLICT",
  "REQUIRED_DATA_MISSING",
  "SOURCE_CONFLICT_UNRESOLVED",
  "HIDDEN_TEXT_DETECTED",
]);

export interface RepairAction {
  action: "removed_sentence" | "trimmed_to_limit" | "stripped_formatting"
        | "stripped_emoji" | "appended_disclosure";
  validator_code: string | null;
  /** What was taken out, so the audit trail shows the exact edit. */
  detail: string;
}

export interface RepairResult {
  content: string;
  changed: boolean;
  applied: RepairAction[];
  /** Codes the repair pass deliberately refused to touch. */
  unrepairable: string[];
}

// Sentence splitting has to keep the delimiter so reassembly does not silently
// restructure clean copy while removing one bad sentence.
function splitWithDelimiters(text: string): string[] {
  return String(text || "").match(/[^.!?\n]+[.!?]*\n*|\n+/g) ?? [];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function repairContent(
  text: string,
  findings: Finding[],
  policy?: ChannelPolicy,
  requiredDisclosures: string[] = [],
): RepairResult {
  let content = String(text || "");
  const applied: RepairAction[] = [];
  const unrepairable: string[] = [];

  // 1 ── Remove sentences carrying an unsupported claim.
  const blocking = findings.filter((f) => f.blocking);
  for (const f of blocking) {
    if (NEVER_REPAIRABLE.has(f.validator_code)) {
      unrepairable.push(f.validator_code);
      continue;
    }
    if (!REPAIRABLE_BY_SENTENCE_REMOVAL.has(f.validator_code)) {
      unrepairable.push(f.validator_code);
      continue;
    }
    const claim = norm(String(f.claim_text || ""));
    if (!claim) { unrepairable.push(f.validator_code); continue; }

    const sentences = splitWithDelimiters(content);
    const kept = sentences.filter((s) => !norm(s).includes(claim));
    if (kept.length === sentences.length) {
      // The claim did not localize to a sentence — a partial edit would be a
      // guess, so leave it blocked.
      unrepairable.push(f.validator_code);
      continue;
    }
    // Refusing to empty the description: removing everything is not a repair.
    const candidate = kept.join("").replace(/\n{3,}/g, "\n\n").trim();
    if (candidate.length < 120) {
      unrepairable.push(f.validator_code);
      continue;
    }
    content = candidate;
    applied.push({
      action: "removed_sentence", validator_code: f.validator_code,
      detail: `Removed the sentence containing "${String(f.claim_text).slice(0, 60)}".`,
    });
  }

  // 2 ── Strip formatting the destination cannot render.
  if (policy && !policy.htmlAllowed && /<[a-z][^>]*>/i.test(content)) {
    content = content.replace(/<[^>]*>/g, "").replace(/[ \t]{2,}/g, " ").trim();
    applied.push({ action: "stripped_formatting", validator_code: "CHANNEL_FORMAT_INVALID",
      detail: `Removed HTML tags for ${policy.label}.` });
  }
  if (policy && !policy.markdownAllowed && /\*\*|__|(^|\n)\s*[#>]\s/.test(content)) {
    content = content.replace(/\*\*|__/g, "").replace(/(^|\n)\s*[#>]+\s*/g, "$1").trim();
    applied.push({ action: "stripped_formatting", validator_code: "CHANNEL_FORMAT_INVALID",
      detail: `Removed markdown for ${policy.label}.` });
  }
  if (policy && !policy.emojiAllowed && /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(content)) {
    content = content.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").replace(/\s{2,}/g, " ").trim();
    applied.push({ action: "stripped_emoji", validator_code: "CHANNEL_EMOJI_NOT_ALLOWED",
      detail: `Removed emoji for ${policy.label}.` });
  }

  // 3 ── Append a disclosure the dealer already approved, verbatim.
  // Safe because the text is the dealer's own and is copied exactly; the
  // validator requires its presence, not its position.
  for (const d of requiredDisclosures) {
    if (!d || content.toLowerCase().includes(d.toLowerCase())) continue;
    content = `${content.trim()}\n\n${d}`;
    applied.push({ action: "appended_disclosure", validator_code: "REQUIRED_DISCLOSURE_MISSING",
      detail: "Appended the tenant's required disclosure verbatim." });
  }

  // 4 ── Trim to the channel limit, last so earlier edits are accounted for.
  // Cut at a sentence boundary: a mid-word truncation can change meaning, and
  // an ellipsis on a marketplace listing reads as a defect.
  if (policy && content.length > policy.characterLimit) {
    const sentences = splitWithDelimiters(content);
    let out = "";
    for (const s of sentences) {
      if ((out + s).length > policy.characterLimit) break;
      out += s;
    }
    const trimmed = out.trim();
    if (trimmed.length >= Math.min(200, policy.recommendedMin)) {
      applied.push({ action: "trimmed_to_limit", validator_code: "CHANNEL_LENGTH_EXCEEDED",
        detail: `Trimmed from ${content.length} to ${trimmed.length} characters for ${policy.label}.` });
      content = trimmed;
    } else {
      // Trimming would gut the copy — regeneration is the honest answer.
      unrepairable.push("CHANNEL_LENGTH_EXCEEDED");
    }
  }

  return {
    content,
    changed: applied.length > 0 && content !== text,
    applied,
    unrepairable: [...new Set(unrepairable)],
  };
}

/** True when repairing is worth a revalidation pass at all. */
export function hasRepairableFindings(findings: Finding[]): boolean {
  return findings.some((f) =>
    f.blocking && REPAIRABLE_BY_SENTENCE_REMOVAL.has(f.validator_code));
}
