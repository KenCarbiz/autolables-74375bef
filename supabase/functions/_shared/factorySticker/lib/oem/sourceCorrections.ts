// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/oem/sourceCorrections.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Recorded, narrowly scoped corrections between what a data source says and
// what the manufacturer publishes, plus decoder metadata that is not
// equipment. Nothing here is a blanket equivalence: a drivetrain rule names
// the exact model year, make, model and grades it covers and the
// manufacturer statement it rests on, and the source value is always kept.

export interface DrivetrainEvidence {
  publisher: string;
  title: string;
  url: string;
  quote: string;
  retrieved: string;
}

export interface DrivetrainRule {
  id: string;
  year: number;
  make: string;
  model: string;
  /** Grades the manufacturer offers with only one drivetrain; "*" when the rule covers every grade of the model. */
  grades: string[] | "*";
  /** Named grades of the model; a trim naming two of them is not one of the covered grades. */
  exclusiveGrades?: string[];
  /** Trim words that put the vehicle outside the rule (another powertrain line sold under the same model name). */
  excludeTrimWords?: string[];
  /** Source spellings this rule may replace. */
  from: RegExp;
  to: string;
  evidence: DrivetrainEvidence;
}

export const DRIVETRAIN_RULES: readonly DrivetrainRule[] = [
  {
    id: "infiniti-qx60-2026-awd-only-grades",
    year: 2026,
    make: "INFINITI",
    model: "QX60",
    grades: ["SPORT", "AUTOGRAPH"],
    exclusiveGrades: ["PURE", "LUXE", "SPORT", "AUTOGRAPH"],
    from: /^(4wd|four[\s-]wheel[\s-]drive|4x4)$/i,
    to: "AWD",
    evidence: {
      publisher: "INFINITI USA newsroom (usa.infinitinews.com)",
      title: "New 2026 INFINITI QX60 is here, on sale from $51,200",
      url: "https://usa.infinitinews.com/en-US/releases/release-6a11c143b6bc57f003adcd88ac0054b8-new-2026-infiniti-qx60-is-hereon-sale-from-51200",
      quote: "QX60 SPORT: $61,700 ... equipped exclusively with Intelligent All-Wheel Drive; QX60 AUTOGRAPH is offered exclusively with AWD",
      retrieved: "2026-11-02",
    },
  },
  {
    // Hyundai sells the gasoline Tucson only as FWD or HTRAC AWD; there is no
    // part-time or low-range 4WD Tucson, so a decoder's "4WD" on this model is
    // the configuration Hyundai labels AWD. The VIN's own EPA match (the EPA
    // "Tucson AWD" model) is checked separately by the EPA conflict gate.
    id: "hyundai-tucson-2026-four-wheel-is-awd",
    year: 2026,
    make: "HYUNDAI",
    model: "TUCSON",
    grades: "*",
    excludeTrimWords: ["HYBRID", "PHEV", "PLUG"],
    from: /^(4wd|four[\s-]wheel[\s-]drive|4x4)$/i,
    to: "AWD",
    evidence: {
      publisher: "Hyundai Motor America (factory window label; pricing release via PR Newswire)",
      title: "2026 Hyundai Tucson SE AWD factory label (VIN 5NMJACDE3TH655783) prints \"2026 TUCSON SE AWD\" and \"HTRAC AWD\"; Hyundai Releases Pricing for Smarter, More Capable 2025 Tucson SUV (July 18, 2024)",
      url: "https://ycharts.com/news/story/PRN-LA64238-20240718",
      quote: "SE | 2.5L GDI + MPI 4-Cyl. | 8-Speed Automatic with SHIFTRONIC | FWD ... SE | ... | AWD; every gasoline Tucson grade is listed as FWD or AWD only",
      retrieved: "2026-11-07",
    },
  },
];

export interface DrivetrainDecision {
  value: string | null;
  sourceValue: string | null;
  ruleId: string | null;
  evidence: DrivetrainEvidence | null;
}

const tokens = (s: string | null | undefined) => String(s ?? "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);

export function decideDrivetrain(input: {
  year: number | string | null | undefined;
  make: string | null | undefined;
  model: string | null | undefined;
  trim: string | null | undefined;
  source: string | null | undefined;
}): DrivetrainDecision {
  const sourceValue = input.source == null ? null : String(input.source).trim() || null;
  const none: DrivetrainDecision = { value: sourceValue, sourceValue, ruleId: null, evidence: null };
  if (!sourceValue) return none;
  const year = Number(input.year);
  const make = String(input.make ?? "").trim().toUpperCase();
  const model = String(input.model ?? "").trim().toUpperCase();
  const trim = tokens(input.trim);
  for (const r of DRIVETRAIN_RULES) {
    if (r.year !== year || r.make !== make || r.model !== model) continue;
    if (r.grades !== "*" && !r.grades.some((g) => trim.includes(g))) continue;
    // A trim naming two grades is not one of the covered grades.
    if (r.exclusiveGrades && r.exclusiveGrades.filter((g) => trim.includes(g)).length !== 1) continue;
    if (r.excludeTrimWords?.some((w) => trim.includes(w))) continue;
    if (!r.from.test(sourceValue)) continue;
    return { value: r.to, sourceValue, ruleId: r.id, evidence: r.evidence };
  }
  return none;
}

// Crash-test rating metadata (NHTSA stars, IIHS results) that VIN decoders
// emit inside the standard-equipment list ("Standard-NHTSA", "Overall-5",
// "Side Impact-5", "Headlights-Good").
// These are not equipment, and a decoder's copy is not a rating source for a
// Monroney safety panel, so they are separated out and never printed as
// equipment or as a rating.
const RATING_METADATA: RegExp[] = [
  /^standard[\s-]+(nhtsa|iihs)$/i,
  /^(nhtsa|iihs)([\s-].*)?$/i,
  /^(overall|overall\s+rating|frontal\s+crash(\s+rating)?|front\s+crash(\s+rating)?|side\s+impact(\s+rating)?|side\s+crash(\s+rating)?|rollover(\s+rating)?|rollover\s+resistance)\s*[-:]\s*[0-5](\s*stars?)?$/i,
  // IIHS test results ("Side Impact-Good", "Small Overlap Front - Driver-Good").
  /^(side\s+impact|moderate\s+overlap\s+front(\s+test)?|small\s+overlap\s+front(\s*-\s*(driver|passenger))?|updated\s+moderate\s+overlap(\s+front)?|headlights|latch|seat\s+belt\s+reminder(s)?|roof\s+strength|rear\s+crash\s+protection|front\s+crash\s+prevention|head\s+restraints\s*&?\s*seats)\s*-\s*(good|acceptable|marginal|poor|superior|advanced|basic|not\s+rated)$/i,
  /^test\s+revision\s*-\s*\w+$/i,
];

export const isRatingMetadata = (s: string): boolean => RATING_METADATA.some((re) => re.test(String(s).trim()));

export function splitRatingMetadata(groups: Record<string, string[]>): { equipment: Record<string, string[]>; ratingMetadata: string[] } {
  const equipment: Record<string, string[]> = {};
  const ratingMetadata: string[] = [];
  for (const [k, items] of Object.entries(groups)) {
    const kept: string[] = [];
    for (const it of items) (isRatingMetadata(it) ? ratingMetadata : kept).push(it);
    if (kept.length) equipment[k] = kept;
  }
  return { equipment, ratingMetadata };
}
