import type { DealerSettings } from "@/contexts/DealerSettingsContext";
import type { IihsAward } from "@/lib/iihsAwards";

// The Passport reads the flat dealer_* strings through public-listing-view, so those stay the source of truth for
// every value. The structured editor adds one key, why_buy_profile, that carries only what the flat strings cannot:
// a retrieval date and source per rating, stable item ids and the award issuer. Everything the Passport shows is
// projected back into the flat strings in the exact format its parser expects.

export interface ReviewItem { id: string; source: string; rating: string; quote: string; asOf: string }
export interface AwardItem { id: string; name: string; issuer: string }
export interface Reputation { googleAsOf: string; bbbAsOf: string; satisfactionSource: string; satisfactionAsOf: string }

export interface WhyBuyProfile { version: 1; reviews: ReviewItem[]; awards: AwardItem[]; reputation: Reputation }

export interface WhyBuyDraft extends Record<string, unknown> {
  dealer_tagline: string;
  why_buy_here: string;
  warranty_programs: string;
  dealer_years_in_business: string;
  dealer_family_owned: string;
  dealer_storefront_url: string;
  dealer_satisfaction: string;
  dealer_google_rating: string;
  dealer_google_count: string;
  dealer_bbb_rating: string;
  dealer_service_location: string;
  dealer_service_address: string;
  dealer_delivery: string;
  dealer_financing: string;
  dealer_advisor_name: string;
  dealer_advisor_title: string;
  dealer_advisor_photo: string;
  dealer_advisor_response: string;
  iihs_awards_enabled: boolean;
  iihs_awards: IihsAward[];
  reviews: ReviewItem[];
  awards: AwardItem[];
  services: string[];
  amenities: string[];
  reputation: Reputation;
}

export const FLAT_KEYS = [
  "dealer_tagline", "why_buy_here", "warranty_programs", "dealer_years_in_business", "dealer_family_owned", "dealer_storefront_url",
  "dealer_satisfaction", "dealer_google_rating", "dealer_google_count", "dealer_bbb_rating", "dealer_service_location", "dealer_service_address",
  "dealer_delivery", "dealer_financing", "dealer_advisor_name", "dealer_advisor_title", "dealer_advisor_photo", "dealer_advisor_response",
] as const;

export const EMPTY_REPUTATION: Reputation = { googleAsOf: "", bbbAsOf: "", satisfactionSource: "", satisfactionAsOf: "" };

type Settings = Pick<DealerSettings, (typeof FLAT_KEYS)[number] | "dealer_review_sources" | "dealer_certifications" | "dealer_amenities" | "dealer_services" | "iihs_awards_enabled" | "iihs_awards"> & { why_buy_profile?: unknown };

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (raw: string): string[] => raw.split(",").map((s) => s.trim()).filter(Boolean);

export const formatReviewLine = (r: Pick<ReviewItem, "source" | "rating" | "quote">): string =>
  `${r.source.trim()} | ${r.rating.trim()} | ${r.quote.replace(/\s*\n\s*/g, " ").trim()}`.trimEnd();

export const projectReviews = (reviews: ReviewItem[]): string => reviews.filter((r) => r.source.trim()).map(formatReviewLine).join("\n");
export const projectChips = (values: string[]): string => values.map((v) => v.trim()).filter(Boolean).join(", ");

function parseReviewLines(raw: string): Array<Pick<ReviewItem, "source" | "rating" | "quote">> {
  return raw.split("\n").map((line) => {
    const [source, rating, ...rest] = line.split("|").map((p) => p.trim());
    return { source: source || "", rating: rating || "", quote: rest.join(" | ") };
  }).filter((r) => r.source);
}

function readProfile(raw: unknown): WhyBuyProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<WhyBuyProfile>;
  if (p.version !== 1) return null;
  const rep = (p.reputation ?? {}) as Partial<Reputation>;
  return {
    version: 1,
    reviews: Array.isArray(p.reviews) ? p.reviews.map((r) => ({ id: str(r?.id), source: str(r?.source), rating: str(r?.rating), quote: str(r?.quote), asOf: str(r?.asOf) })).filter((r) => r.id) : [],
    awards: Array.isArray(p.awards) ? p.awards.map((a) => ({ id: str(a?.id), name: str(a?.name), issuer: str(a?.issuer) })).filter((a) => a.id) : [],
    reputation: { googleAsOf: str(rep.googleAsOf), bbbAsOf: str(rep.bbbAsOf), satisfactionSource: str(rep.satisfactionSource), satisfactionAsOf: str(rep.satisfactionAsOf) },
  };
}

/**
 * Builds the editor draft. The flat strings win whenever they disagree with the stored profile (another editor or
 * the old panel wrote them), and the profile's dates and issuers are carried over by matching on content.
 */
export function readWhyBuy(settings: Settings): WhyBuyDraft {
  const profile = readProfile(settings.why_buy_profile);
  const parsed = parseReviewLines(str(settings.dealer_review_sources));
  const spent = new Set<string>();
  const reviews: ReviewItem[] = parsed.map((r, i) => {
    const hit = profile?.reviews.find((p) => !spent.has(p.id) && p.source.trim().toLowerCase() === r.source.toLowerCase() && p.quote.trim() === r.quote && p.rating.trim() === r.rating);
    if (hit) spent.add(hit.id);
    return { id: hit?.id ?? `review-${i + 1}`, source: r.source, rating: r.rating, quote: r.quote, asOf: hit?.asOf ?? "" };
  });
  const names = list(str(settings.dealer_certifications));
  const spentA = new Set<string>();
  const awards: AwardItem[] = names.map((name, i) => {
    const hit = profile?.awards.find((p) => !spentA.has(p.id) && p.name.trim().toLowerCase() === name.toLowerCase());
    if (hit) spentA.add(hit.id);
    return { id: hit?.id ?? `award-${i + 1}`, name, issuer: hit?.issuer ?? "" };
  });
  const rep = profile?.reputation ?? EMPTY_REPUTATION;
  const draft = {
    reviews,
    awards,
    services: list(str(settings.dealer_services)),
    amenities: list(str(settings.dealer_amenities)),
    reputation: {
      googleAsOf: str(settings.dealer_google_rating) || str(settings.dealer_google_count) ? rep.googleAsOf : "",
      bbbAsOf: str(settings.dealer_bbb_rating) ? rep.bbbAsOf : "",
      satisfactionSource: str(settings.dealer_satisfaction) ? rep.satisfactionSource : "",
      satisfactionAsOf: str(settings.dealer_satisfaction) ? rep.satisfactionAsOf : "",
    },
    iihs_awards_enabled: !!settings.iihs_awards_enabled,
    iihs_awards: Array.isArray(settings.iihs_awards) ? settings.iihs_awards : [],
  } as Partial<WhyBuyDraft>;
  for (const k of FLAT_KEYS) (draft as Record<string, unknown>)[k] = str(settings[k]);
  return draft as WhyBuyDraft;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Only keys whose value changed: the flat strings the Passport reads, plus the profile when its metadata changed. */
export function buildWhyBuyPatch(draft: WhyBuyDraft, baseline: WhyBuyDraft): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const k of FLAT_KEYS) if (draft[k] !== baseline[k]) patch[k] = draft[k].trim();
  const reviewsText = projectReviews(draft.reviews);
  if (reviewsText !== projectReviews(baseline.reviews)) patch.dealer_review_sources = reviewsText;
  const awardsText = projectChips(draft.awards.map((a) => a.name));
  if (awardsText !== projectChips(baseline.awards.map((a) => a.name))) patch.dealer_certifications = awardsText;
  const services = projectChips(draft.services);
  if (services !== projectChips(baseline.services)) patch.dealer_services = services;
  const amenities = projectChips(draft.amenities);
  if (amenities !== projectChips(baseline.amenities)) patch.dealer_amenities = amenities;
  if (draft.iihs_awards_enabled !== baseline.iihs_awards_enabled) patch.iihs_awards_enabled = draft.iihs_awards_enabled;
  const iihs = draft.iihs_awards.filter((a) => a.year.trim() && a.make.trim() && a.model.trim());
  if (!same(iihs, baseline.iihs_awards)) patch.iihs_awards = iihs;
  if (!same(draft.reviews, baseline.reviews) || !same(draft.awards, baseline.awards) || !same(draft.reputation, baseline.reputation)) {
    const profile: WhyBuyProfile = { version: 1, reviews: draft.reviews.filter((r) => r.source.trim()), awards: draft.awards, reputation: draft.reputation };
    patch.why_buy_profile = profile;
  }
  return patch;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const URLISH = /^https?:\/\/[^\s]+\.[^\s]+$/i;

export function isPastOrToday(iso: string, today: string): boolean {
  return DATE.test(iso) && !Number.isNaN(Date.parse(iso)) && iso <= today;
}

export interface WhyBuyErrors { top: Record<string, string>; reviews: Record<string, string>; awards: Record<string, string>; iihs: Record<number, string> }

/**
 * A rating needs a source and a date. Legacy values saved before dates existed are not blocked until someone edits
 * them: `baseline` is what is already saved.
 */
export function validateWhyBuy(draft: WhyBuyDraft, baseline: WhyBuyDraft, today: string): WhyBuyErrors {
  const top: Record<string, string> = {};
  const out: WhyBuyErrors = { top, reviews: {}, awards: {}, iihs: {} };
  const rating = (v: string) => v.trim() !== "" && !(Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 5);
  const dateProblem = (asOf: string) => (!asOf ? "Enter the date this was retrieved or entered." : !isPastOrToday(asOf, today) ? "Use a date that is not in the future." : null);

  const gChanged = draft.dealer_google_rating !== baseline.dealer_google_rating || draft.dealer_google_count !== baseline.dealer_google_count || draft.reputation.googleAsOf !== baseline.reputation.googleAsOf;
  if (rating(draft.dealer_google_rating)) top.dealer_google_rating = "Use a rating from 0 to 5, such as 4.8.";
  if (draft.dealer_google_count.trim() && !/^\d+$/.test(draft.dealer_google_count.trim())) top.dealer_google_count = "Use digits only.";
  if (!top.dealer_google_rating && !top.dealer_google_count && (draft.dealer_google_rating.trim() || draft.dealer_google_count.trim()) && gChanged) {
    const p = dateProblem(draft.reputation.googleAsOf);
    if (p) top.googleAsOf = p;
  }
  const bChanged = draft.dealer_bbb_rating !== baseline.dealer_bbb_rating || draft.reputation.bbbAsOf !== baseline.reputation.bbbAsOf;
  if (draft.dealer_bbb_rating.trim() && bChanged) {
    const p = dateProblem(draft.reputation.bbbAsOf);
    if (p) top.bbbAsOf = p;
  }
  const sChanged = draft.dealer_satisfaction !== baseline.dealer_satisfaction || draft.reputation.satisfactionSource !== baseline.reputation.satisfactionSource || draft.reputation.satisfactionAsOf !== baseline.reputation.satisfactionAsOf;
  if (draft.dealer_satisfaction.trim() && sChanged) {
    if (!draft.reputation.satisfactionSource.trim()) top.satisfactionSource = "Name where this figure comes from.";
    const p = dateProblem(draft.reputation.satisfactionAsOf);
    if (p) top.satisfactionAsOf = p;
  }
  if (draft.dealer_years_in_business.trim() && !/^\d{1,3}$/.test(draft.dealer_years_in_business.trim())) top.dealer_years_in_business = "Use a whole number of years.";
  for (const k of ["dealer_storefront_url", "dealer_advisor_photo"] as const) {
    const v = draft[k].trim();
    if (v && !URLISH.test(v)) top[k] = "Use a full web address starting with https://.";
  }
  if (draft.dealer_tagline.length > 140) top.dealer_tagline = "Use 140 characters or fewer.";

  const baseById = new Map(baseline.reviews.map((r) => [r.id, r]));
  for (const r of draft.reviews) {
    const b = baseById.get(r.id);
    const changed = !b || !same(b, r);
    const hasRating = r.rating.trim() !== "";
    if (!r.source.trim()) out.reviews[r.id] = "Name the review source, such as Google or Edmunds.";
    else if (/[|\n]/.test(r.source)) out.reviews[r.id] = "The source cannot contain a vertical bar.";
    else if (rating(r.rating)) out.reviews[r.id] = "Use a rating from 0 to 5.";
    else if (r.quote.length > 400) out.reviews[r.id] = "Use 400 characters or fewer for the quote.";
    else if (changed && hasRating) {
      const p = dateProblem(r.asOf);
      if (p) out.reviews[r.id] = p;
    }
  }
  const seen = new Set<string>();
  for (const a of draft.awards) {
    const key = a.name.trim().toLowerCase();
    if (!key) out.awards[a.id] = "Name the award.";
    else if (a.name.includes(",")) out.awards[a.id] = "Leave out commas.";
    else if (seen.has(key)) out.awards[a.id] = "This award is already listed.";
    seen.add(key);
  }
  draft.iihs_awards.forEach((a, i) => {
    const any = a.year.trim() || a.make.trim() || a.model.trim();
    if (any && !(a.year.trim() && a.make.trim() && a.model.trim())) out.iihs[i] = "Year, make and model are all required, or remove the row.";
    else if (a.year.trim() && !/^\d{4}$/.test(a.year.trim())) out.iihs[i] = "Use a four-digit year.";
  });
  return out;
}

export const hasWhyBuyErrors = (e: WhyBuyErrors): boolean => Object.keys(e.top).length + Object.keys(e.reviews).length + Object.keys(e.awards).length + Object.keys(e.iihs).length > 0;

export const firstWhyBuyError = (e: WhyBuyErrors): string | undefined =>
  Object.values(e.top)[0] ?? Object.values(e.reviews)[0] ?? Object.values(e.awards)[0] ?? Object.values(e.iihs)[0];
