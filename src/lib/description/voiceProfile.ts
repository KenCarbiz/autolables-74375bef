// Client-side entry for the dealership voice profile. The engine lives with
// the edge functions (the orchestrator resolves and versions the profile
// server-side) and is pure TS, so the admin screen reuses it rather than
// keeping a second copy of the claim list that would drift.
export {
  GATED_DEALER_CLAIMS,
  resolveVoiceProfile,
  computeVoiceProfileVersion,
  checkDealerClaims,
  checkLocalityUse,
  voiceInstruction,
} from "../../../supabase/functions/_shared/description-voice";
export type {
  VoiceProfile,
  GatedDealerClaim,
  VoiceFinding,
} from "../../../supabase/functions/_shared/description-voice";

import {
  GATED_DEALER_CLAIMS,
  type VoiceProfile,
} from "../../../supabase/functions/_shared/description-voice";
import { TONE_PROFILES, type ToneKey } from "../../../supabase/functions/_shared/description-tone";

/** The editable shape. Mirrors VoiceProfile minus the server-owned fields. */
export interface VoiceProfileDraft {
  dealerName: string;
  storeReference: string;
  city: string;
  state: string;
  marketArea: string;
  approvedAreas: string[];
  brandPositioning: string;
  defaultTone: ToneKey;
  ctaTemplate: string;
  contactPreference: string;
  approvedClaims: string[];
  differentiators: string[];
  prohibitedPhrases: string[];
  requiredDisclosures: string[];
  certificationTerminology: string;
  warrantyTerminology: string;
  financeTerminology: string;
  tradeTerminology: string;
  deliveryTerminology: string;
}

export const TONE_OPTIONS: { key: ToneKey; label: string; blurb: string }[] =
  (Object.keys(TONE_PROFILES) as ToneKey[]).map((key) => ({
    key,
    label: TONE_PROFILES[key].label,
    blurb: TONE_PROFILES[key].guidance,
  }));

const DRAFT_KEYS: (keyof VoiceProfileDraft)[] = [
  "dealerName", "storeReference", "city", "state", "marketArea", "approvedAreas",
  "brandPositioning", "defaultTone", "ctaTemplate", "contactPreference",
  "approvedClaims", "differentiators", "prohibitedPhrases", "requiredDisclosures",
  "certificationTerminology", "warrantyTerminology", "financeTerminology",
  "tradeTerminology", "deliveryTerminology",
];

const LIST_KEYS = new Set<keyof VoiceProfileDraft>([
  "approvedAreas", "approvedClaims", "differentiators",
  "prohibitedPhrases", "requiredDisclosures",
]);

export function draftFromProfile(v: VoiceProfile): VoiceProfileDraft {
  const out: Record<string, unknown> = {};
  for (const k of DRAFT_KEYS) {
    const value = (v as unknown as Record<string, unknown>)[k];
    out[k] = LIST_KEYS.has(k)
      ? (Array.isArray(value) ? [...value] : [])
      : (value ?? "");
  }
  return out as unknown as VoiceProfileDraft;
}

/** The jsonb the save RPC stores. Trimmed, with empty list entries dropped. */
export function draftToProfileJson(d: VoiceProfileDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of DRAFT_KEYS) {
    const value = d[k];
    if (LIST_KEYS.has(k)) {
      out[k] = (Array.isArray(value) ? value : [])
        .map((x) => String(x).trim()).filter(Boolean);
    } else {
      out[k] = String(value ?? "").trim();
    }
  }
  return out;
}

/**
 * The draft as a VoiceProfile, so the client can compute the SAME version hash
 * the orchestrator will. Without this the page would show a version the server
 * never agrees with, and every generation would look like a profile change.
 */
export function draftAsProfile(d: VoiceProfileDraft, base: VoiceProfile): VoiceProfile {
  return { ...base, ...(draftToProfileJson(d) as unknown as Partial<VoiceProfile>) } as VoiceProfile;
}

export interface VoiceProfileFinding {
  /** Matches the preflight code so the operator sees the same name twice. */
  code: string;
  blocking: boolean;
  message: string;
  field?: keyof VoiceProfileDraft;
}

/**
 * The subset of preflight this screen can actually fix.
 *
 * Deliberately the same codes preflight emits — a dealer who was told
 * "DEALER_IDENTITY_INCOMPLETE" in the Studio should find that exact phrase
 * here, next to the field that clears it.
 */
export function validateVoiceProfile(d: VoiceProfileDraft): VoiceProfileFinding[] {
  const f: VoiceProfileFinding[] = [];

  if (!String(d.dealerName || "").trim()) {
    f.push({
      code: "DEALER_IDENTITY_INCOMPLETE", blocking: true, field: "dealerName",
      message: "The dealership name is required. Generation is blocked until it is set.",
    });
  }
  if (!String(d.city || "").trim() || !String(d.state || "").trim()) {
    f.push({
      code: "DEALER_IDENTITY_INCOMPLETE", blocking: false, field: "city",
      message: "City and state are unset. Copy still generates, but local relevance scores low on every vehicle.",
    });
  }
  // An empty-string disclosure is worse than none: the orchestrator treats a
  // configured-but-blank disclosure as a hard stop, because it cannot tell
  // whether the text was lost or never written.
  if ((d.requiredDisclosures || []).some((x) => !String(x).trim())) {
    f.push({
      code: "REQUIRED_DISCLOSURE_UNAVAILABLE", blocking: true, field: "requiredDisclosures",
      message: "A required disclosure has no text. Remove the empty row or write the disclosure.",
    });
  }
  const known = new Set(GATED_DEALER_CLAIMS.map((c) => c.key));
  const unknown = (d.approvedClaims || []).filter((k) => !known.has(k));
  if (unknown.length) {
    f.push({
      code: "UNKNOWN_APPROVED_CLAIM", blocking: true, field: "approvedClaims",
      message: `${unknown.length} approved claim(s) are not in the claim registry and will be ignored: ${unknown.join(", ")}.`,
    });
  }
  // A prohibited phrase that also appears in an approved differentiator is a
  // rule that contradicts itself; the validator would strike the dealer's own
  // approved wording out of every description.
  for (const p of d.prohibitedPhrases || []) {
    const needle = String(p).trim().toLowerCase();
    if (!needle) continue;
    const clash = (d.differentiators || []).find((x) => String(x).toLowerCase().includes(needle));
    if (clash) {
      f.push({
        code: "VOICE_RULE_CONFLICT", blocking: true, field: "prohibitedPhrases",
        message: `"${p}" is banned but also appears in the approved differentiator "${clash}". One of the two has to go.`,
      });
    }
  }
  return f;
}

/** Field labels for the change summary shown before approval. */
const FIELD_LABEL: Record<keyof VoiceProfileDraft, string> = {
  dealerName: "Dealership name", storeReference: "How to refer to the store",
  city: "City", state: "State", marketArea: "Market area",
  approvedAreas: "Approved market areas", brandPositioning: "Positioning",
  defaultTone: "Default tone", ctaTemplate: "Closing call to action",
  contactPreference: "Contact preference", approvedClaims: "Approved dealership claims",
  differentiators: "Approved differentiators", prohibitedPhrases: "Never use",
  requiredDisclosures: "Required disclosures",
  certificationTerminology: "Certification wording", warrantyTerminology: "Warranty wording",
  financeTerminology: "Finance wording", tradeTerminology: "Trade wording",
  deliveryTerminology: "Delivery wording",
};

export interface VoiceProfileChange {
  field: keyof VoiceProfileDraft;
  label: string;
  /** Approving this change widens what the store may claim. */
  widensClaims: boolean;
}

/**
 * What approving would change. Claim-widening edits are called out separately
 * because they are the only ones that let new statements into customer copy.
 */
export function diffVoiceProfiles(
  before: VoiceProfileDraft, after: VoiceProfileDraft,
): VoiceProfileChange[] {
  const out: VoiceProfileChange[] = [];
  for (const k of DRAFT_KEYS) {
    const a = LIST_KEYS.has(k)
      ? JSON.stringify([...((before[k] as string[]) || [])].map(String).sort())
      : String(before[k] ?? "").trim();
    const b = LIST_KEYS.has(k)
      ? JSON.stringify([...((after[k] as string[]) || [])].map(String).sort())
      : String(after[k] ?? "").trim();
    if (a === b) continue;

    let widensClaims = false;
    if (k === "approvedClaims" || k === "differentiators" || k === "approvedAreas") {
      const prev = new Set(((before[k] as string[]) || []).map(String));
      widensClaims = ((after[k] as string[]) || []).some((x) => !prev.has(String(x)));
    }
    out.push({ field: k, label: FIELD_LABEL[k], widensClaims });
  }
  return out;
}

/** Claim keys that were switched on, for the approval confirmation. */
export function newlyApprovedClaims(
  before: VoiceProfileDraft, after: VoiceProfileDraft,
): string[] {
  const prev = new Set((before.approvedClaims || []).map(String));
  return (after.approvedClaims || []).map(String).filter((k) => !prev.has(k));
}
