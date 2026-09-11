// ──────────────────────────────────────────────────────────────
// Passport version resolver — shared pure logic.
//
// Single source of truth for deciding which shopper passport
// experience renders for a given vehicle. Zero imports so the same
// file runs in Deno edge functions (public-listing-view) and in the
// Vite client (route wrapper, admin preview) via re-export from
// src/lib/passportVersion.
//
// Semantics (per Build 2a spec):
//   inherit    -> use the tenant default
//   current    -> explicitly force the EXISTING /v/ passport
//   v3         -> explicitly force the new governed /v3/ passport
//   experiment -> controlled experiment (framework is later; for
//                 now behaves like 'inherit' with a distinct reason)
//
// Resolution ORDER:
//   1. Emergency kill switch (tenant OR global) -> 'current',
//      reason 'emergency_kill_switch'.
//   2. Explicit per-vehicle override ('current'|'v3') -> that
//      value, reason 'vehicle_override'.
//   3. 'experiment' override -> tenant default, reason
//      'experiment_assignment' (placeholder for the future
//      controlled-experiment framework).
//   4. 'inherit' (or unset) -> tenant default, reason 'tenant_default'.
//   5. Safety fallback -> 'current', reason 'safety_fallback'.
//
// Never throws. Always resolves to one of ('current','v3').
// ──────────────────────────────────────────────────────────────

export type PassportVersion = "current" | "v3";
export type PassportVersionOverride = "inherit" | "current" | "v3" | "experiment";
export type PassportResolutionReason =
  | "emergency_kill_switch"
  | "vehicle_override"
  | "experiment_assignment"
  | "tenant_default"
  | "safety_fallback";

export interface PassportVersionInput {
  /** per-vehicle passport_version column value (may be null/unset). */
  vehicleOverride?: unknown;
  /** dealer_profiles.settings.passport_version */
  tenantDefault?: unknown;
  /** dealer_profiles.settings.passport_kill_switch (tenant emergency stop) */
  tenantKillSwitch?: unknown;
  /** Global kill switch (env / platform-level). Reserved for future. */
  globalKillSwitch?: unknown;
}

export interface PassportVersionResult {
  effective: PassportVersion;
  reason: PassportResolutionReason;
}

const OVERRIDES = new Set<PassportVersionOverride>(["inherit", "current", "v3", "experiment"]);
const VERSIONS = new Set<PassportVersion>(["current", "v3"]);

const normalizeOverride = (v: unknown): PassportVersionOverride => {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (OVERRIDES.has(s as PassportVersionOverride) ? s : "inherit") as PassportVersionOverride;
};

const normalizeTenantDefault = (v: unknown): PassportVersion => {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (VERSIONS.has(s as PassportVersion) ? s : "current") as PassportVersion;
};

const isTrue = (v: unknown): boolean => v === true || v === "true" || v === 1 || v === "1";

export function resolvePassportVersion(input: PassportVersionInput): PassportVersionResult {
  try {
    if (isTrue(input.globalKillSwitch) || isTrue(input.tenantKillSwitch)) {
      return { effective: "current", reason: "emergency_kill_switch" };
    }
    const override = normalizeOverride(input.vehicleOverride);
    const tenantDefault = normalizeTenantDefault(input.tenantDefault);

    if (override === "current" || override === "v3") {
      return { effective: override, reason: "vehicle_override" };
    }
    if (override === "experiment") {
      return { effective: tenantDefault, reason: "experiment_assignment" };
    }
    // inherit
    return { effective: tenantDefault, reason: "tenant_default" };
  } catch {
    return { effective: "current", reason: "safety_fallback" };
  }
}
