// GENERATED — do not edit.
// Mirror of src/lib/market/similarity.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── Comparability score ────────────────────────────────────────────────────
//
// Price is not an input here, and that is the point. A model that lets price
// decide what counts as similar is circular: cheap listings look most
// comparable, the median follows them down, and every car the dealer owns
// reads as over-market. The old engine leaned on a price band in the search
// itself, so the market it measured was defined by the number it was supposed
// to judge.
//
// So similarity is built only from what the vehicle IS and how well we know
// it. Each component contributes a distance in [0, 1]; the coefficients say
// how much each distance costs; weight decays exponentially with the total:
//
//   D_i        = Σ_k θ_k · d_ik
//   rawWeight_i = DataQuality_i · e^(−D_i)
//
// Every coefficient lives in one versioned table instead of being scattered
// through the app as unexplained constants, and every component is stored per
// comparable so a dealer can be told exactly why a car counted for as little
// as it did. The values below are SHADOW defaults — plausible, not calibrated.
// Section 37 governs promoting them.

export const SIMILARITY_VERSION = "similarity-v1-shadow";

export interface SimilarityCoefficients {
  spec: number;
  mileage: number;
  certification: number;
  equipment: number;
  history: number;
  freshness: number;
  geography: number;
}

export const SIMILARITY_COEFFICIENTS: SimilarityCoefficients = {
  spec: 2.0,
  mileage: 1.5,
  certification: 2.5,
  equipment: 0.75,
  history: 0.75,
  freshness: 0.5,
  geography: 0.5,
};

export interface SimilaritySubject {
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  drivetrain: string | null;
  powertrain: string | null;
  mileage: number | null;
  certified: boolean | null;
  equipmentCodes: string[];
}

export interface SimilarityCandidate extends SimilaritySubject {
  distanceMiles: number | null;
  daysOnMarket: number | null;
  observedAt: string | null;
  historyStatus: "clean" | "adverse" | "unknown";
  conditionStatus: "verified" | "unknown";
  priceBasisStatus: "verified" | "unknown" | "invalid";
  identityConfidence: "stable" | "name_only" | "none";
}

export interface SimilarityResult {
  components: Record<string, number | null>;
  distance: number;
  dataQuality: number;
  rawWeight: number;
}

const norm = (v: unknown): string => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const normDrivetrain = (v: unknown): string => {
  const s = norm(v);
  if (/^(4wd|4x4|fourwheeldrive)$/.test(s)) return "4wd";
  if (/^(awd|allwheeldrive)$/.test(s)) return "awd";
  if (/^(fwd|frontwheeldrive)$/.test(s)) return "fwd";
  if (/^(rwd|rearwheeldrive)$/.test(s)) return "rwd";
  return s;
};

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Unknown on either side is a half-distance: not a match, not a mismatch. */
const textDistance = (a: unknown, b: unknown, normalizer = norm): number => {
  const x = normalizer(a); const y = normalizer(b);
  if (!x || !y) return 0.5;
  return x === y ? 0 : 1;
};

function specDistance(subject: SimilaritySubject, candidate: SimilarityCandidate): number {
  const makeModel = Math.max(textDistance(subject.make, candidate.make), textDistance(subject.model, candidate.model));
  if (makeModel === 1) return 1;
  const yearGap = subject.year != null && candidate.year != null ? Math.abs(subject.year - candidate.year) : null;
  const year = yearGap == null ? 0.5 : yearGap === 0 ? 0 : yearGap === 1 ? 0.5 : 1;
  const trim = textDistance(subject.trim, candidate.trim);
  const drivetrain = textDistance(subject.drivetrain, candidate.drivetrain, normDrivetrain);
  const powertrain = textDistance(subject.powertrain, candidate.powertrain);
  return clamp01(0.35 * makeModel + 0.3 * year + 0.2 * trim + 0.1 * drivetrain + 0.05 * powertrain);
}

/**
 * Mileage distance, saturating at the tier-C ceiling.
 *
 * Not a dollar adjustment — this only decides how much a car's asking price
 * counts as evidence about ours. Converting miles to money needs the trained
 * model in adjustments.ts, which is not on.
 */
function mileageDistance(subject: SimilaritySubject, candidate: SimilarityCandidate): number {
  const s = subject.mileage; const c = candidate.mileage;
  if (s == null || c == null || s <= 0) return 0.5;
  const gap = Math.abs(c - s);
  const tolerance = Math.max(s * 0.2, 5000);
  return clamp01(gap / (tolerance * 2));
}

/** Unknown certification is a half-distance. It is never read as "not certified". */
function certificationDistance(subject: SimilaritySubject, candidate: SimilarityCandidate): number {
  if (subject.certified == null || candidate.certified == null) return 0.5;
  return subject.certified === candidate.certified ? 0 : 1;
}

function equipmentDistance(subject: SimilaritySubject, candidate: SimilarityCandidate): number {
  const a = new Set(subject.equipmentCodes.map(norm).filter(Boolean));
  const b = new Set(candidate.equipmentCodes.map(norm).filter(Boolean));
  if (!a.size || !b.size) return 0.5;
  let shared = 0;
  for (const code of a) if (b.has(code)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0.5 : clamp01(1 - shared / union);
}

function historyDistance(candidate: SimilarityCandidate): number {
  const history = candidate.historyStatus === "clean" ? 0 : candidate.historyStatus === "adverse" ? 1 : 0.5;
  const condition = candidate.conditionStatus === "verified" ? 0 : 0.5;
  return clamp01(0.7 * history + 0.3 * condition);
}

function freshnessDistance(candidate: SimilarityCandidate, nowMs: number): number {
  if (!candidate.observedAt) return 0.5;
  const t = Date.parse(candidate.observedAt);
  if (!Number.isFinite(t)) return 0.5;
  const ageDays = (nowMs - t) / 86_400_000;
  if (ageDays <= 1) return 0;
  return clamp01(ageDays / 30);
}

function geographyDistance(candidate: SimilarityCandidate): number {
  const d = candidate.distanceMiles;
  if (d == null || d < 0) return 0.5;
  return clamp01(d / 200);
}

/**
 * How much of this listing we actually know. A car whose price basis, seller
 * and certification are all unknown is still evidence, but it is thinner
 * evidence than one we can account for, and the weight has to say so.
 */
function dataQuality(candidate: SimilarityCandidate): number {
  let q = 1;
  if (candidate.priceBasisStatus === "unknown") q *= 0.85;
  if (candidate.priceBasisStatus === "invalid") return 0;
  if (candidate.certified == null) q *= 0.85;
  if (candidate.historyStatus === "unknown") q *= 0.9;
  if (candidate.conditionStatus === "unknown") q *= 0.95;
  if (candidate.identityConfidence === "name_only") q *= 0.9;
  if (candidate.identityConfidence === "none") q *= 0.8;
  if (candidate.mileage == null) q *= 0.8;
  return q;
}

export function scoreSimilarity(
  subject: SimilaritySubject,
  candidate: SimilarityCandidate,
  nowMs: number,
  coefficients: SimilarityCoefficients = SIMILARITY_COEFFICIENTS,
): SimilarityResult {
  const d = {
    spec: specDistance(subject, candidate),
    mileage: mileageDistance(subject, candidate),
    certification: certificationDistance(subject, candidate),
    equipment: equipmentDistance(subject, candidate),
    history: historyDistance(candidate),
    freshness: freshnessDistance(candidate, nowMs),
    geography: geographyDistance(candidate),
  };

  const distance =
    coefficients.spec * d.spec
    + coefficients.mileage * d.mileage
    + coefficients.certification * d.certification
    + coefficients.equipment * d.equipment
    + coefficients.history * d.history
    + coefficients.freshness * d.freshness
    + coefficients.geography * d.geography;

  const quality = dataQuality(candidate);

  return {
    // Stored as SIMILARITY per component (1 − distance) so a dealer reads
    // "trim 0%" as "this is not the same trim", not as a distance to decode.
    components: {
      spec: 1 - d.spec,
      mileage: 1 - d.mileage,
      certification: 1 - d.certification,
      equipment: 1 - d.equipment,
      history: 1 - d.history,
      freshness: 1 - d.freshness,
      geography: 1 - d.geography,
      dataQuality: quality,
    },
    distance,
    dataQuality: quality,
    rawWeight: quality * Math.exp(-distance),
  };
}
