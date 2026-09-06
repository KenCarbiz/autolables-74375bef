// What a description is allowed to say about coverage, decided by the
// vehicle's own documents rather than by a switch.
//
// A boolean cannot express this. The FTC Buyers Guide is a document the
// customer signs, and copy that implies coverage while the Guide reads AS-IS
// puts the dealership in contradiction with its own paperwork — the single
// warranty failure that actually reaches a regulator. Equally, a tenant flag
// set to false silenced a CPO car with 44 verified months remaining.
//
// So the ladder is ordered by what is documented, strongest evidence first,
// and the Buyers Guide is the ceiling on all of it.

export type WarrantyDisposition =
  | "PROHIBITED"        // documents forbid coverage language
  | "CPO_PERMITTED"     // verified manufacturer certification
  | "FACTORY_PERMITTED" // verified remaining factory coverage
  | "OMIT";             // nothing documented; say nothing

export interface WarrantyDecision {
  disposition: WarrantyDisposition;
  /** Copy-ready statement of exactly what is known. Null when nothing may be said. */
  statement: string | null;
  /** Why, in terms an auditor can follow six months later. */
  reason: string;
  /** Which inputs decided it. */
  evidence: string[];
}

export interface WarrantyInputs {
  /** decisionCode from the FTC Buyers Guide engine, when one has been decided. */
  buyersGuideDecision?: string | null;
  /** Verified manufacturer certification, not a feed's cpo flag. */
  cpoVerified?: boolean;
  cpoProgram?: string | null;
  warranty?: {
    program?: string | null;
    months_remaining?: number | null;
    miles_remaining?: number | null;
  } | null;
  /** A dealership's deliberate choice never to discuss coverage. */
  suppressedExplicitly?: boolean;
  /** When CPO language is switched off, certification cannot carry the statement. */
  cpoLanguageAllowed?: boolean;
}

const AS_IS = new Set(["as_is", "as_is_no_dealer_warranty", "no_dealer_warranty"]);

/** The filed Buyers Guide records its box under one of two keys depending on
 *  which template version produced it, and one of them hyphenates. */
export function buyersGuideDisposition(
  dataSnapshot: Record<string, unknown> | null | undefined,
): string | null {
  const raw = dataSnapshot?.["box"] ?? dataSnapshot?.["default_ftc_warranty"];
  const v = String(raw ?? "").toLowerCase().trim().replace(/-/g, "_");
  return v || null;
}

function terms(months: number, miles: number): string {
  return [
    months > 0 ? `${months} months remaining` : "",
    miles > 0 ? `${miles.toLocaleString("en-US")} miles remaining` : "",
  ].filter(Boolean).join(", ");
}

export function decideWarrantyLanguage(input: WarrantyInputs): WarrantyDecision {
  const guide = String(input.buyersGuideDecision || "").toLowerCase().trim();
  const months = Number(input.warranty?.months_remaining) || 0;
  const miles = Number(input.warranty?.miles_remaining) || 0;
  const program = String(input.warranty?.program || "").trim();

  // 1. The dealership's own choice.
  if (input.suppressedExplicitly) {
    return { disposition: "PROHIBITED", statement: null,
      reason: "The dealership has chosen not to discuss coverage in customer copy.",
      evidence: ["settings.warranty_language_suppressed_explicitly"] };
  }

  // 2. The Buyers Guide is the ceiling. A car genuinely carrying factory
  // coverage should not be sold on an AS-IS Guide in the first place; when it
  // is, the fix belongs on the Guide, not in copy written around it.
  if (AS_IS.has(guide)) {
    return { disposition: "PROHIBITED", statement: null,
      reason: "The FTC Buyers Guide for this vehicle is AS-IS, so customer copy may not imply coverage.",
      evidence: [`buyers_guide:${guide}`] };
  }

  // 3. Verified certification outranks a bare remaining-months figure: it is
  // a program with defined terms rather than an inference from an in-service
  // date. A feed's cpo flag is not verification and never reaches here.
  if (input.cpoVerified && input.cpoLanguageAllowed !== false) {
    const name = String(input.cpoProgram || "").trim();
    const t = terms(months, miles);
    return { disposition: "CPO_PERMITTED",
      statement: [name || "Manufacturer certified pre-owned", t].filter(Boolean).join(" — "),
      reason: "Manufacturer certification is verified for this VIN.",
      evidence: ["cpo_verified", ...(name ? [`cpo_program:${name}`] : []),
                 ...(t ? ["warranty_remaining"] : [])] };
  }

  // 4. Verified remaining factory coverage, stated only as precisely as known.
  if (months > 0 || miles > 0 || program) {
    const t = terms(months, miles);
    return { disposition: "FACTORY_PERMITTED",
      statement: [program, t].filter(Boolean).join(" — ") || "remaining factory coverage",
      reason: "Remaining factory coverage is recorded for this VIN.",
      evidence: ["warranty_info"] };
  }

  // 5. Nothing documented. Silence, not an exception.
  return { disposition: "OMIT", statement: null,
    reason: "No coverage is documented for this vehicle.", evidence: [] };
}
