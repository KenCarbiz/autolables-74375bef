// ─────────────────────────────────────────────────────────────────────
// Splitting a "2024 Land Rover Range Rover Sport" string into year, make
// and model.
//
// The obvious implementation — split on whitespace, take one token as the
// make — is wrong for every manufacturer whose name is two words, and it
// fails expensively: the malformed request still counts against a metered
// API quota. In one week it produced 60 HTTP 400s and 30 HTTP 422s, 18% of
// all provider calls, and the sold-stats feature it powers has never once
// been populated as a result.
// ─────────────────────────────────────────────────────────────────────

/**
 * Makes whose name is more than one token.
 *
 * The hyphenated ones already parse correctly as a single token; they are
 * listed so a feed that spells them with a space instead of a hyphen — which
 * happens — does not silently reintroduce the bug.
 */
export const MULTIWORD_MAKES = [
  "Land Rover",
  "Alfa Romeo",
  "Aston Martin",
  "Mercedes Benz",
  "Mercedes-Benz",
  "Rolls Royce",
  "Rolls-Royce",
  "General Motors",
] as const;

export interface Ymm {
  year: string;
  make: string;
  model: string;
}

/**
 * Parse a year/make/model string. Year is optional; when the first token is
 * not a 4-digit year the whole string is treated as make + model.
 *
 * Returns empty strings rather than throwing — callers use the emptiness to
 * decide whether a provider call is worth making at all.
 */
export function parseYmm(ymm: string | null | undefined): Ymm {
  const raw = String(ymm ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return { year: "", make: "", model: "" };

  const parts = raw.split(" ");
  const hasYear = /^\d{4}$/.test(parts[0] ?? "");
  const year = hasYear ? parts[0] : "";
  const rest = (hasYear ? parts.slice(1) : parts).join(" ");
  if (!rest) return { year, make: "", model: "" };

  const hit = MULTIWORD_MAKES.find(
    (m) => rest.toLowerCase() === m.toLowerCase()
      || rest.toLowerCase().startsWith(m.toLowerCase() + " "),
  );
  if (hit) {
    // Echo the feed's own spelling rather than the table's, so a downstream
    // exact-match against the listing still succeeds.
    return { year, make: rest.slice(0, hit.length), model: rest.slice(hit.length).trim() };
  }

  const [make, ...restModel] = rest.split(" ");
  return { year, make, model: restModel.join(" ") };
}

/**
 * Whether a parsed vehicle can support a make+model provider query.
 *
 * Checked before spending a metered call: a request with a blank make or
 * model is rejected by the provider and billed anyway.
 */
export function canQueryMakeModel(v: Ymm): boolean {
  return v.make.trim().length > 0 && v.model.trim().length > 0;
}
