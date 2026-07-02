// IIHS Top Safety Pick awards — dealer-verified, permission-gated.
//
// IIHS ratings are copyrighted; commercial display requires IIHS's written
// permission (their published logo/advertising guidelines invite use for
// award-winning vehicles, granted case-by-case). The passport therefore only
// renders an award when BOTH are true:
//   1. iihs_awards_enabled — the dealer flips this on after IIHS grants
//      written permission (kept off by default).
//   2. The listing's year/make/model matches an award entry the dealer
//      verified against iihs.org/ratings/top-safety-picks. Awards can hinge
//      on trim/headlights/build date, so entries are dealer-confirmed per
//      model, never auto-asserted.
// Text-only statements ("2026 IIHS TOP SAFETY PICK+"), no IIHS logo assets.

export interface IihsAward {
  year: string;   // model year, e.g. "2026"
  make: string;
  model: string;
  award: "tsp" | "tsp_plus";
  note?: string;  // qualifier the dealer wants shown, e.g. "Built after 11/25"
}

export interface MatchedIihsAward extends IihsAward {
  label: string;
}

export const iihsAwardLabel = (a: Pick<IihsAward, "year" | "award">): string =>
  `${a.year} IIHS Top Safety Pick${a.award === "tsp_plus" ? "+" : ""}`;

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");

// Matches a listing's "YYYY Make Model[ ...]" string against the dealer's
// verified award list. Make/model must appear in order in the ymm; the model
// match is whole-word so "QX6" never matches "QX60".
export const matchIihsAward = (
  awards: IihsAward[] | null | undefined,
  ymm: string | null | undefined,
): MatchedIihsAward | null => {
  const y = norm(String(ymm || ""));
  if (!y || !Array.isArray(awards)) return null;
  for (const a of awards) {
    if (!a?.year || !a?.make || !a?.model) continue;
    if (!y.startsWith(norm(a.year))) continue;
    const rest = y.slice(norm(a.year).length).trim();
    const make = norm(a.make);
    if (!rest.startsWith(make)) continue;
    const afterMake = rest.slice(make.length).trim();
    const model = norm(a.model);
    if (afterMake !== model && !afterMake.startsWith(`${model} `)) continue;
    return { ...a, label: iihsAwardLabel(a) };
  }
  return null;
};
