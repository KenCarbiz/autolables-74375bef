export type CanonicalCondition = "new" | "used" | "cpo";

// Maps a dealer's free-form condition label (New, Demo, Used, CPO, Factory CPO,
// Dealer CPO, OEM CPO, Pre-Owned, …) to a canonical bucket.
//   - New + Demo  -> "new"   (no FTC Used Car Rule Buyers Guide)
//   - any CPO     -> "cpo"   (used; needs the FTC warranty disclosure)
//   - Used        -> "used"  (needs the FTC warranty disclosure)
export const canonicalCondition = (label?: string | null): CanonicalCondition | undefined => {
  const v = (label || "").toString().toLowerCase();
  if (!v) return undefined;
  if (v.includes("cpo") || v.includes("certified")) return "cpo";
  if (/\b(new|demo|demonstrator|loaner)\b/.test(v)) return "new";
  if (v.includes("used") || v.includes("pre-owned") || v.includes("pre owned") || v.includes("preowned")) return "used";
  return undefined;
};

// FTC Used Car Rule (16 CFR Part 455) Buyers Guide / warranty disclosure applies
// to USED vehicles (including CPO) — never to new or demo units.
export const needsUsedCarWarranty = (label?: string | null): boolean => {
  const c = canonicalCondition(label);
  return c === "used" || c === "cpo";
};
