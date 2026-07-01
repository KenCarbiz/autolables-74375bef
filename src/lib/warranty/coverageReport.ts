// ── OEM warranty coverage tracker ────────────────────────────────────────────
// A running list of which manufacturers have a warranty program loaded, which
// still need one, and what remains unverified — so we always know when to add
// more makes. Derived at call time from the actual seeded programs + the app's
// curated reference, so it stays correct as programs are added.

import { OEM_WARRANTY_PROGRAMS } from "@/data/oemWarrantyPrograms";
import { OEM_WARRANTY_REFERENCE } from "@/data/oemWarrantyReference";
import type { ConfidenceStatus, OemWarrantyProgram } from "@/lib/warranty/types";

export interface MakeCoverageStatus {
  make: string;
  loaded: boolean;
  programCount: number;
  hasModelSpecific: boolean;
  confidence: ConfidenceStatus | "mixed" | null;
}

export interface WarrantyCoverageReport {
  loaded: MakeCoverageStatus[];       // makes with at least one program
  pending: string[];                  // curated-reference makes with no program yet
  needsVerification: string[];        // loaded makes not yet fully "verified"
  totals: { loadedMakes: number; programs: number; verifiedMakes: number; pendingMakes: number };
}

const norm = (s: string) => s.trim().toUpperCase();

export function buildWarrantyCoverageReport(
  programs: OemWarrantyProgram[] = OEM_WARRANTY_PROGRAMS,
  reference: Record<string, unknown> = OEM_WARRANTY_REFERENCE,
): WarrantyCoverageReport {
  const byMake = new Map<string, OemWarrantyProgram[]>();
  for (const p of programs) {
    const key = norm(p.oemMake);
    byMake.set(key, [...(byMake.get(key) ?? []), p]);
  }

  const loaded: MakeCoverageStatus[] = [...byMake.entries()]
    .map(([make, list]) => {
      const statuses = new Set(list.map((p) => p.confidenceStatus));
      const confidence: MakeCoverageStatus["confidence"] =
        statuses.size === 0 ? null : statuses.size > 1 ? "mixed" : [...statuses][0];
      return {
        make,
        loaded: true,
        programCount: list.length,
        hasModelSpecific: list.some((p) => p.model != null),
        confidence,
      };
    })
    .sort((a, b) => a.make.localeCompare(b.make));

  const loadedMakes = new Set(loaded.map((m) => m.make));
  const pending = Object.keys(reference)
    .map(norm)
    .filter((m) => !loadedMakes.has(m))
    .sort();

  const needsVerification = loaded.filter((m) => m.confidence !== "verified").map((m) => m.make);

  return {
    loaded,
    pending,
    needsVerification,
    totals: {
      loadedMakes: loaded.length,
      programs: programs.length,
      verifiedMakes: loaded.filter((m) => m.confidence === "verified").length,
      pendingMakes: pending.length,
    },
  };
}
