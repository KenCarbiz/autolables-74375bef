// ─────────────────────────────────────────────────────────────────────
// Real scoring for Description V3.
//
// Every number this module produces is CALCULATED from the text and the
// comparison set it was given. Nothing here returns a constant, and nothing
// returns a grade the inputs did not earn — a decorative "98% unique" is
// worse than no number at all, because an operator will act on it.
//
// Three deliberate separations:
//   - Writing quality is scored independently of factual validity. A blocked
//     description can still be well written; the score must not launder it.
//   - Uniqueness is measured against a named comparison set that travels with
//     the result, so "98%" always answers "unique against WHAT".
//   - Keyword usefulness is scored, keyword stuffing is penalized. They are
//     not the same axis and a longer description does not earn points.
// ─────────────────────────────────────────────────────────────────────

import { toneProfile, type ToneKey } from "./description-tone.ts";

export const SCORE_VERSION = "score_v3.1";

// ── Readability ──────────────────────────────────────────────────────

export interface ReadabilityResult {
  method: "flesch_reading_ease";
  score: number;
  grade: string;
  band: "very_easy" | "easy" | "standard" | "fairly_difficult" | "difficult" | "very_difficult";
  words: number;
  sentences: number;
  syllables: number;
  wordsPerSentence: number;
  syllablesPerWord: number;
  longSentences: number;
  passiveHints: number;
}

const VOWELS = /[aeiouy]+/g;

export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  // Standard heuristic: strip silent trailing e / common inflections, then
  // count vowel groups. Good enough to rank copy consistently, which is all a
  // readability band needs to do.
  const stripped = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = stripped.match(VOWELS);
  return Math.max(1, groups ? groups.length : 1);
}

export function splitSentences(text: string): string[] {
  return String(text || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function splitWords(text: string): string[] {
  return String(text || "").split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9'-]/g, "")).filter(Boolean);
}

export function analyzeReadability(text: string): ReadabilityResult {
  const sentences = splitSentences(text).filter((s) => splitWords(s).length > 0);
  const words = splitWords(text);
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0);
  const sCount = Math.max(1, sentences.length);
  const wCount = Math.max(1, words.length);
  const wps = wCount / sCount;
  const spw = syllables / wCount;
  const score = Math.round((206.835 - 1.015 * wps - 84.6 * spw) * 10) / 10;

  const band: ReadabilityResult["band"] =
    score >= 80 ? "very_easy" : score >= 70 ? "easy" : score >= 60 ? "standard"
    : score >= 50 ? "fairly_difficult" : score >= 30 ? "difficult" : "very_difficult";
  const grade =
    score >= 90 ? "5th grade" : score >= 80 ? "6th grade" : score >= 70 ? "7th grade"
    : score >= 60 ? "8th-9th grade" : score >= 50 ? "10th-12th grade"
    : score >= 30 ? "College" : "College graduate";

  return {
    method: "flesch_reading_ease", score, grade, band,
    words: words.length, sentences: sentences.length, syllables,
    wordsPerSentence: Math.round(wps * 10) / 10,
    syllablesPerWord: Math.round(spw * 100) / 100,
    longSentences: sentences.filter((s) => splitWords(s).length > 34).length,
    passiveHints: (String(text || "").match(/\b(is|are|was|were|been|being)\s+\w+(ed|en)\b/gi) || []).length,
  };
}

// ── Uniqueness / duplication ─────────────────────────────────────────

export interface ComparisonDoc {
  id: string;
  label: string;
  /** What this document is, so a score can explain itself. */
  scope: "same_vin_prior_version" | "same_model_inventory" | "tenant_inventory" | "tenant_boilerplate" | "same_batch" | "cross_channel";
  content: string;
}

export interface UniquenessResult {
  method: "shingle_jaccard_w5";
  /** 0-100. 100 = shares no 5-word sequence with anything in the set. */
  score: number;
  comparisonCount: number;
  comparisonScopes: string[];
  highestMatch: { id: string; label: string; scope: string; similarity: number } | null;
  /** Percentage of this text's shingles that appear anywhere in the set. */
  boilerplatePercent: number;
  repeatedPhrases: string[];
  /** Phrases repeated inside this one document. */
  internalRepeats: string[];
  duplicationRisk: "low" | "medium" | "high";
  thresholdVersion: string;
}

const SHINGLE_W = 5;

export function shingles(text: string, w = SHINGLE_W): Set<string> {
  const words = splitWords(String(text || "").toLowerCase());
  const out = new Set<string>();
  for (let i = 0; i + w <= words.length; i++) out.add(words.slice(i, i + w).join(" "));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const s of small) if (large.has(s)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function analyzeUniqueness(text: string, comparisons: ComparisonDoc[]): UniquenessResult {
  const mine = shingles(text);
  let highest: UniquenessResult["highestMatch"] = null;
  const sharedShingles = new Set<string>();

  for (const doc of comparisons) {
    const theirs = shingles(doc.content);
    const sim = jaccard(mine, theirs);
    for (const s of mine) if (theirs.has(s)) sharedShingles.add(s);
    if (!highest || sim > highest.similarity) {
      highest = { id: doc.id, label: doc.label, scope: doc.scope, similarity: Math.round(sim * 1000) / 1000 };
    }
  }

  const boilerplatePercent = mine.size ? Math.round((sharedShingles.size / mine.size) * 1000) / 10 : 0;
  // Uniqueness is driven by the WORST match, not the average: sharing 70% with
  // one sibling listing is a duplication problem even if the other forty
  // comparisons are clean.
  const worst = highest?.similarity ?? 0;
  const score = comparisons.length === 0 ? 100 : Math.round(Math.max(0, 100 - worst * 100) * 10) / 10;

  const risk: UniquenessResult["duplicationRisk"] =
    worst >= 0.45 || boilerplatePercent >= 50 ? "high"
    : worst >= 0.2 || boilerplatePercent >= 25 ? "medium" : "low";

  return {
    method: "shingle_jaccard_w5",
    score,
    comparisonCount: comparisons.length,
    comparisonScopes: [...new Set(comparisons.map((c) => c.scope))],
    highestMatch: comparisons.length ? highest : null,
    boilerplatePercent,
    repeatedPhrases: [...sharedShingles].slice(0, 8),
    internalRepeats: findInternalRepeats(text),
    duplicationRisk: risk,
    thresholdVersion: SCORE_VERSION,
  };
}

function findInternalRepeats(text: string): string[] {
  const counts = new Map<string, number>();
  for (const s of shingles(text, 6)) counts.set(s, (counts.get(s) || 0) + 1);
  // A shingle set is deduplicated, so repetition has to be counted over the
  // raw sequence rather than the set.
  const words = splitWords(String(text || "").toLowerCase());
  const seq = new Map<string, number>();
  for (let i = 0; i + 6 <= words.length; i++) {
    const k = words.slice(i, i + 6).join(" ");
    seq.set(k, (seq.get(k) || 0) + 1);
  }
  return [...seq.entries()].filter(([, n]) => n > 1).map(([k]) => k).slice(0, 5);
}

// ── Keyword usefulness and stuffing ──────────────────────────────────

export interface SeoTargeting {
  primaryKeyword: string;
  secondaryKeywords: string[];
  city: string;
  state: string;
  marketArea: string;
  dealerName: string;
  searchIntent: "inventory" | "model_research" | "local_dealer" | "generic";
}

export interface KeywordResult {
  primaryPresent: boolean;
  primaryNatural: boolean;
  primaryOccurrences: number;
  secondaryPresent: string[];
  secondaryMissing: string[];
  /** Occurrences per 100 words for the highest-density target phrase. */
  peakDensity: number;
  stuffing: boolean;
  stuffedTerms: string[];
  localityMentions: number;
  hiddenTextDetected: boolean;
}

const STUFFING_DENSITY = 2.2; // occurrences per 100 words

export function analyzeKeywords(text: string, t: SeoTargeting): KeywordResult {
  const body = String(text || "");
  const words = splitWords(body);
  const per100 = (n: number) => (words.length ? (n / words.length) * 100 : 0);

  const primary = String(t.primaryKeyword || "").trim();
  const primaryOccurrences = primary ? countPhrase(body, primary) : 0;
  const primaryDensity = per100(primaryOccurrences);

  const targets = [primary, ...(t.secondaryKeywords || [])].filter(Boolean);
  const stuffed: string[] = [];
  let peak = 0;
  for (const phrase of targets) {
    const d = per100(countPhrase(body, phrase));
    peak = Math.max(peak, d);
    if (d > STUFFING_DENSITY) stuffed.push(phrase);
  }
  // A single word repeated far above natural frequency is stuffing even when
  // it is not one of the configured targets.
  const freq = new Map<string, number>();
  for (const w of words.map((x) => x.toLowerCase())) {
    if (w.length < 4 || STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  for (const [w, n] of freq) {
    if (words.length >= 80 && per100(n) > 4) stuffed.push(w);
  }

  const secondaryPresent = (t.secondaryKeywords || []).filter((k) => countPhrase(body, k) > 0);
  const localityMentions = t.city ? countPhrase(body, t.city) : 0;

  return {
    primaryPresent: primaryOccurrences > 0,
    // Natural means present but not hammered: once or twice in a real sentence.
    primaryNatural: primaryOccurrences > 0 && primaryDensity <= STUFFING_DENSITY && primaryOccurrences <= 3,
    primaryOccurrences,
    secondaryPresent,
    secondaryMissing: (t.secondaryKeywords || []).filter((k) => !secondaryPresent.includes(k)),
    peakDensity: Math.round(peak * 100) / 100,
    stuffing: stuffed.length > 0,
    stuffedTerms: [...new Set(stuffed)].slice(0, 6),
    localityMentions,
    // Invisible keyword blocks arrive as markup, not as prose.
    hiddenTextDetected: /<[^>]*(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0)/i.test(body)
      || /<!--[\s\S]{40,}?-->/.test(body),
  };
}

function countPhrase(text: string, phrase: string): number {
  const p = String(phrase || "").trim();
  if (!p) return 0;
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return (String(text || "").match(new RegExp(`\\b${esc}\\b`, "gi")) || []).length;
}

const STOPWORDS = new Set([
  "this", "that", "with", "from", "your", "will", "have", "here", "when", "what",
  "into", "also", "more", "than", "then", "them", "they", "been", "over", "very",
  "both", "each", "such", "only", "same", "some", "just", "like", "make", "made",
]);

// ── Composite score ──────────────────────────────────────────────────

export type ScoreCategory =
  | "fact_completeness" | "feature_relevance" | "keyword_usefulness" | "local_relevance"
  | "readability" | "uniqueness" | "channel_compliance" | "cta_quality" | "claim_safety";

export const SCORE_WEIGHTS: Record<ScoreCategory, number> = {
  fact_completeness: 14,
  feature_relevance: 14,
  keyword_usefulness: 10,
  local_relevance: 6,
  readability: 14,
  uniqueness: 14,
  channel_compliance: 10,
  cta_quality: 6,
  claim_safety: 12,
};

export interface ScoreBreakdown {
  version: string;
  total: number;
  band: "excellent" | "good" | "fair" | "poor";
  categories: Array<{ category: ScoreCategory; score: number; weight: number; detail: string }>;
  weights: Record<ScoreCategory, number>;
  warnings: string[];
  recommendations: string[];
  readability: ReadabilityResult;
  uniqueness: UniquenessResult;
  keywords: KeywordResult;
  calculatedAt: string;
  /** True when a truth blocker exists. The band is NEVER upgraded past this. */
  blockedByValidation: boolean;
}

export interface ScoreInput {
  text: string;
  tone: ToneKey;
  targeting: SeoTargeting;
  comparisons: ComparisonDoc[];
  /** Facts the packet offered vs. facts the copy actually used. */
  factsOffered: number;
  factsUsed: number;
  /** Features the prioritizer selected vs. how many appear in the copy. */
  featuresSelected: string[];
  /** Channel-policy findings for this exact variant. */
  policyFindings: Array<{ code: string; severity: "info" | "warning" | "blocking" }>;
  /** Blocking validation findings from the fact validator. */
  blockingFindings: number;
  warningFindings: number;
  ctaExpected: boolean;
  /** Timestamp is injected so the function stays pure and testable. */
  now?: string;
}

export function scoreDescription(input: ScoreInput): ScoreBreakdown {
  const text = input.text || "";
  const readability = analyzeReadability(text);
  const uniqueness = analyzeUniqueness(text, input.comparisons);
  const keywords = analyzeKeywords(text, input.targeting);
  const tone = toneProfile(input.tone);

  const warnings: string[] = [];
  const recommendations: string[] = [];
  const cat = (category: ScoreCategory, score: number, detail: string) =>
    ({ category, score: Math.round(clamp(score, 0, 100)), weight: SCORE_WEIGHTS[category], detail });

  // 1. Fact completeness — did the copy use what the packet gave it?
  const factRatio = input.factsOffered > 0 ? input.factsUsed / input.factsOffered : 0;
  const factCompleteness = factRatio * 100;
  if (factRatio < 0.5 && input.factsOffered > 4) {
    recommendations.push("More than half of the verified facts went unused; the copy is thinner than the data supports.");
  }

  // 2. Feature relevance — selected features that actually appear, capped so
  //    listing every feature earns nothing extra. Feature dumping is not quality.
  const lc = text.toLowerCase();
  const mentioned = input.featuresSelected.filter((f) => {
    const head = f.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").filter((w) => w.length > 3)[0];
    return head ? lc.includes(head) : false;
  }).length;
  const featureTarget = Math.min(input.featuresSelected.length, 8);
  const featureRelevance = featureTarget === 0 ? 50 : (Math.min(mentioned, featureTarget) / featureTarget) * 100;
  if (input.featuresSelected.length > 12 && mentioned > 12) {
    warnings.push("The copy reads as a feature list. Group related equipment instead of enumerating it.");
  }

  // 3. Keyword usefulness — present and natural scores; stuffing is punished
  //    harder than absence, because stuffing actively harms the listing.
  let keywordScore = 40;
  if (keywords.primaryPresent) keywordScore += 30;
  if (keywords.primaryNatural) keywordScore += 20;
  if (keywords.secondaryPresent.length) keywordScore += Math.min(10, keywords.secondaryPresent.length * 5);
  if (keywords.stuffing) { keywordScore -= 55; warnings.push(`Keyword stuffing detected: ${keywords.stuffedTerms.join(", ")}.`); }
  if (keywords.hiddenTextDetected) { keywordScore = 0; warnings.push("Hidden text or markup detected in the description body."); }
  if (!keywords.primaryPresent && input.targeting.primaryKeyword) {
    recommendations.push(`The primary phrase "${input.targeting.primaryKeyword}" does not appear. Work it into a real sentence rather than appending it.`);
  }

  // 4. Local relevance — one or two genuine mentions. Zero and five both lose.
  const localMentions = keywords.localityMentions;
  const localRelevance = localMentions === 0 ? 35 : localMentions <= 2 ? 100 : Math.max(0, 100 - (localMentions - 2) * 35);
  if (localMentions > 2) warnings.push(`The market area is named ${localMentions} times. Once or twice reads naturally.`);

  // 5. Readability — banded around the tone's target sentence length.
  const [tMin, tMax] = tone.targetWordsPerSentence;
  let readabilityScore = readability.score >= 60 ? 100
    : readability.score >= 50 ? 82 : readability.score >= 40 ? 64 : readability.score >= 30 ? 45 : 25;
  if (readability.wordsPerSentence > tMax + 6) { readabilityScore -= 18; recommendations.push(`Sentences average ${readability.wordsPerSentence} words; the ${tone.label.toLowerCase()} tone reads best at ${tMin}-${tMax}.`); }
  if (readability.longSentences > 0) readabilityScore -= readability.longSentences * 6;

  // 6. Uniqueness — the calculated score, straight through.
  const uniquenessScore = uniqueness.score;
  if (uniqueness.duplicationRisk === "high") {
    warnings.push(`High duplication risk against ${uniqueness.highestMatch?.label || "the comparison set"} (${Math.round((uniqueness.highestMatch?.similarity || 0) * 100)}% shared phrasing).`);
  }

  // 7. Channel compliance.
  const blockingPolicy = input.policyFindings.filter((f) => f.severity === "blocking").length;
  const warningPolicy = input.policyFindings.filter((f) => f.severity === "warning").length;
  const channelCompliance = Math.max(0, 100 - blockingPolicy * 45 - warningPolicy * 12);

  // 8. CTA quality.
  const hasCta = /\b(contact|call|visit|schedule|stop by|reach out|message|test drive)\b/i.test(text);
  const ctaSpecific = /\b(test drive|schedule|visit)\b/i.test(text);
  const ctaQuality = !input.ctaExpected ? 100 : hasCta ? (ctaSpecific ? 100 : 72) : 20;
  if (input.ctaExpected && !hasCta) recommendations.push("Add a clear next step for the shopper.");

  // 9. Claim safety — the writing-quality mirror of the fact validator. A
  //    blocking finding drives this to zero; it must never be smoothed over.
  const claimSafety = input.blockingFindings > 0 ? 0 : Math.max(0, 100 - input.warningFindings * 8);

  const categories = [
    cat("fact_completeness", factCompleteness, `${input.factsUsed} of ${input.factsOffered} verified facts used`),
    cat("feature_relevance", featureRelevance, `${mentioned} of ${featureTarget} prioritized features present`),
    cat("keyword_usefulness", keywordScore, keywords.stuffing ? `stuffing: ${keywords.stuffedTerms.join(", ")}` : `primary keyword ${keywords.primaryPresent ? `used ${keywords.primaryOccurrences}x` : "absent"}`),
    cat("local_relevance", localRelevance, `${localMentions} market-area mention(s)`),
    cat("readability", readabilityScore, `Flesch ${readability.score} (${readability.grade}), ${readability.wordsPerSentence} words/sentence`),
    cat("uniqueness", uniquenessScore, uniqueness.comparisonCount ? `vs ${uniqueness.comparisonCount} document(s); worst match ${Math.round((uniqueness.highestMatch?.similarity || 0) * 100)}%` : "no comparison set available"),
    cat("channel_compliance", channelCompliance, `${blockingPolicy} blocking, ${warningPolicy} warning policy finding(s)`),
    cat("cta_quality", ctaQuality, hasCta ? (ctaSpecific ? "specific next step" : "generic next step") : "no call to action"),
    cat("claim_safety", claimSafety, `${input.blockingFindings} blocking, ${input.warningFindings} warning validation finding(s)`),
  ];

  const totalWeight = categories.reduce((n, c) => n + c.weight, 0);
  const total = Math.round(categories.reduce((n, c) => n + c.score * c.weight, 0) / totalWeight);

  // A truth blocker caps the band at "poor" no matter how well the copy reads.
  // Labeling blocked copy "Excellent" is exactly how an operator publishes it.
  const blockedByValidation = input.blockingFindings > 0 || blockingPolicy > 0;
  const band: ScoreBreakdown["band"] = blockedByValidation ? "poor"
    : total >= 85 ? "excellent" : total >= 70 ? "good" : total >= 55 ? "fair" : "poor";

  if (uniqueness.comparisonCount === 0) {
    warnings.push("Uniqueness was scored with an empty comparison set; treat it as unmeasured, not as proof of originality.");
  }

  return {
    version: SCORE_VERSION, total, band, categories, weights: SCORE_WEIGHTS,
    warnings, recommendations, readability, uniqueness, keywords,
    calculatedAt: input.now || new Date().toISOString(),
    blockedByValidation,
  };
}

/** How many usable facts the copy actually references. */
export function countFactsUsed(text: string, factValues: Array<string | number | boolean | null>): number {
  const lc = String(text || "").toLowerCase();
  let n = 0;
  for (const v of factValues) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim().toLowerCase();
    if (!s || s.length < 2) continue;
    // Multi-item facts (an equipment list) count as used if any item lands.
    const parts = s.split(",").map((x) => x.trim()).filter((x) => x.length > 2);
    if (parts.some((p) => lc.includes(p))) n++;
  }
  return n;
}

const clamp = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
