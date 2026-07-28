// When may a VIN be sent to the provider for a decode?
//
// Provider decodes cost money per VIN. The rule the inventory sweep needs
// is narrow: decode a vehicle once, keep the result for as long as the
// vehicle is in inventory, and never pay again on a later scrape. The two
// ways that goes wrong in practice are both represented here.
//
//   * Testing only the equipment lists marks a vehicle "decoded" when it
//     has options/features but no structured build sheet — which is the
//     one thing the OEM window sticker actually needs. Those vehicles were
//     then skipped forever and their stickers could never be built.
//
//   * Testing only "is it missing" re-pulls, on every single sweep, every
//     VIN the provider simply cannot decode. That is a recurring charge
//     for a result that never changes.

export interface SourceDataState {
  /** mc_attributes.build_sheet — the structured factory record. */
  build_sheet?: unknown;
  options?: unknown;
  features?: unknown;
  specs_attempts?: unknown;
  specs_decoded_at?: unknown;
  /**
   * Whether this VIN has been asked for its OWN build, rather than only for
   * the typical-for-trim fallback. Decodes made before the strict-first
   * request shipped do not carry it.
   */
  specs_strict_attempted?: unknown;
}

export const MAX_SPEC_ATTEMPTS = 3;

export interface DecodeDecision {
  decode: boolean;
  reason:
    | "no_build_sheet"
    | "already_decoded"
    | "attempt_cap_reached"
    | "generic_sheet_never_asked_strictly";
  attempts: number;
}

const isGenericSheet = (sheet: unknown): boolean =>
  !!sheet && typeof sheet === "object"
  && (sheet as Record<string, unknown>).generic === true;

export function shouldDecodeVin(
  mcAttributes: SourceDataState | null | undefined,
  maxAttempts = MAX_SPEC_ATTEMPTS,
): DecodeDecision {
  const mc = mcAttributes ?? {};
  const attempts = Number(mc.specs_attempts) || 0;
  const hasBuildSheet = !!mc.build_sheet;

  if (hasBuildSheet) {
    // A generic sheet is a typical-for-trim substitute, not this vehicle's
    // build: it carries no real base MSRP and no per-vehicle options. Every
    // sheet decoded before the strict-first request shipped is generic
    // because the old code always sent include_generic=true, so those VINs
    // were never actually asked for their own build.
    //
    // They get exactly one strict attempt. `specs_strict_attempted` is what
    // keeps that from becoming a recurring charge — once we have asked
    // properly, a generic answer is the best this VIN has and we stop
    // paying to hear it again.
    const genericAndNeverAskedStrictly =
      isGenericSheet(mc.build_sheet) && mc.specs_strict_attempted !== true;
    if (genericAndNeverAskedStrictly && attempts < maxAttempts) {
      return { decode: true, reason: "generic_sheet_never_asked_strictly", attempts };
    }
    return { decode: false, reason: "already_decoded", attempts };
  }
  if (attempts >= maxAttempts) return { decode: false, reason: "attempt_cap_reached", attempts };
  return { decode: true, reason: "no_build_sheet", attempts };
}

/** Whether the sticker pipeline has everything it needs from the provider. */
export function hasStickerSourceData(mcAttributes: SourceDataState | null | undefined): boolean {
  return !!(mcAttributes ?? {}).build_sheet;
}
