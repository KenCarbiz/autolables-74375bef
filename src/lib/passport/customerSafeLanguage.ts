export type CustomerSafeLanguageResult = {
  text: string;
  flaggedTerms: string[];
  needsReview: boolean;
};

const INTERNAL_OR_RISKY_TERMS = [
  "shot",
  "bad",
  "junk",
  "leak",
  "leaking",
  "accident",
  "frame",
  "airbag",
  "lawsuit",
  "complain",
  "problem",
  "major",
  "damage",
  "unsafe",
  "cheap",
  "auction",
  "wholesale",
  "as-is issue",
];

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/pads were shot/gi, "front brake pads were replaced during reconditioning"],
  [/brakes were shot/gi, "brake components were replaced during reconditioning"],
  [/tires were bad/gi, "tires were replaced or reviewed during reconditioning"],
  [/battery was bad/gi, "battery condition was reviewed during inspection"],
  [/needed a bunch of work/gi, "reconditioning work was completed before retail presentation"],
  [/problem/gi, "item"],
  [/bad/gi, "reviewed"],
  [/shot/gi, "replaced"],
];

export const makeCustomerSafeLanguage = (input?: string | null): CustomerSafeLanguageResult => {
  const original = (input || "").trim();
  if (!original) return { text: "", flaggedTerms: [], needsReview: false };

  const lower = original.toLowerCase();
  const flaggedTerms = INTERNAL_OR_RISKY_TERMS.filter((term) => lower.includes(term));
  let text = original;
  for (const [pattern, replacement] of REPLACEMENTS) text = text.replace(pattern, replacement);

  return {
    text,
    flaggedTerms,
    needsReview: flaggedTerms.length > 0,
  };
};

export const CUSTOMER_SAFE_NOTE_PLACEHOLDER =
  "Example: Front brake pads and rotors were replaced during reconditioning. Vehicle was road-tested after service.";

export const INTERNAL_NOTE_WARNING =
  "Internal notes are for the dealership only. Customer-visible notes should be plain-language, factual, and manager-approved.";
