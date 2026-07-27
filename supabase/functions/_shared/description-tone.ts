// ─────────────────────────────────────────────────────────────────────
// Tone profiles.
//
// A tone changes WORDING. It never changes a fact, never adds a claim, and
// never licenses a superlative. Each profile therefore carries both what it
// should sound like and the specific exaggeration that tone tends to invite —
// the "sporty" tone's failure mode is invented horsepower, the "value" tone's
// is an invented discount. The banned list is the guardrail for each.
// ─────────────────────────────────────────────────────────────────────

import type { ToneKey } from "./description-features.ts";
import type { FeatureCategory } from "./description-features.ts";

export type { ToneKey };

export interface ToneProfile {
  key: ToneKey;
  label: string;
  /** Model-facing wording guidance. */
  guidance: string;
  /** Categories this tone should lead with when the vehicle has them. */
  emphasis: FeatureCategory[];
  /** Phrases this tone tends to invent. Blocked outright for this tone. */
  banned: string[];
  /** Sentence-length target used by the readability scorer. */
  targetWordsPerSentence: [number, number];
}

export const TONE_PROFILES: Record<ToneKey, ToneProfile> = {
  professional: {
    key: "professional", label: "Professional",
    guidance: "Clear, informative, balanced and restrained. State what the vehicle is and what it is equipped with. No sales pressure, no adjective stacking.",
    emphasis: ["drivetrain", "technology", "safety", "comfort"],
    banned: ["incredible", "amazing", "stunning deal", "unbeatable"],
    targetWordsPerSentence: [12, 24],
  },
  luxury: {
    key: "luxury", label: "Luxury",
    guidance: "Refined and comfort-focused. Emphasize materials, craftsmanship, quiet, and technology that improves the experience of being in the vehicle. Describe what is there; never assert prestige, exclusivity or status.",
    emphasis: ["interior", "comfort", "audio", "technology", "exterior"],
    banned: ["exclusive", "prestigious", "flagship of flagships", "opulent", "the finest", "unrivaled", "unmatched"],
    targetWordsPerSentence: [14, 26],
  },
  sporty: {
    key: "sporty", label: "Sporty",
    guidance: "Performance-oriented and driving-focused. Talk about how the verified powertrain and chassis equipment shape the drive. Never quantify performance that is not in the verified facts.",
    emphasis: ["performance", "drivetrain", "exterior"],
    banned: ["blistering", "neck-snapping", "track-ready", "race-bred", "fastest", "quickest", "beast"],
    targetWordsPerSentence: [10, 20],
  },
  family: {
    key: "family", label: "Family",
    guidance: "Practical and reassuring. Lead with seating, space, comfort and the verified driver-assistance equipment. Describe the equipment; never claim the vehicle is safer than others or assert a safety rating.",
    emphasis: ["seating", "safety", "driver_assistance", "utility", "climate"],
    banned: ["safest", "safest choice", "protect your family", "peace of mind guaranteed", "top safety pick"],
    targetWordsPerSentence: [11, 22],
  },
  value: {
    key: "value", label: "Value",
    guidance: "Practical and ownership-focused. Emphasize the useful equipment the vehicle actually carries and what it means day to day. Never characterize price, savings, discount or market position.",
    emphasis: ["utility", "drivetrain", "technology", "comfort"],
    banned: ["bargain", "steal", "priced to move", "best value", "save thousands", "won't find better",
             "wont find better", "lowest price", "best price"],
    targetWordsPerSentence: [11, 22],
  },
};

export const toneProfile = (t: string | null | undefined): ToneProfile =>
  TONE_PROFILES[(String(t || "professional").toLowerCase() as ToneKey)] ?? TONE_PROFILES.professional;

export const isToneKey = (t: unknown): t is ToneKey =>
  typeof t === "string" && Object.prototype.hasOwnProperty.call(TONE_PROFILES, t);

/** Tone-specific banned wording, checked against generated copy. */
export function checkTone(content: string, tone: ToneKey): Array<{ code: string; message: string; claim: string }> {
  const p = toneProfile(tone);
  const lc = (content || "").toLowerCase();
  const out: Array<{ code: string; message: string; claim: string }> = [];
  // Longest first, so "safest choice" is reported once rather than also
  // firing the "safest" rule nested inside it. One phrase in the copy is one
  // finding for the reviewer to act on.
  const reported: string[] = [];
  for (const phrase of [...p.banned].sort((a, b) => b.length - a.length)) {
    const lowered = phrase.toLowerCase();
    if (!lc.includes(lowered)) continue;
    if (reported.some((r) => r.includes(lowered))) continue;
    reported.push(lowered);
    out.push({ code: "TONE_OVERREACH", claim: phrase,
      message: `"${phrase}" overstates what the verified facts support for the ${p.label.toLowerCase()} tone.` });
  }
  return out;
}

export function toneInstruction(tone: ToneKey): string {
  const p = toneProfile(tone);
  return `TONE — ${p.label}\n- ${p.guidance}\n- Never use: ${p.banned.join("; ")}.\n- Tone controls wording only. It must not change, add or soften a single vehicle fact.`;
}
