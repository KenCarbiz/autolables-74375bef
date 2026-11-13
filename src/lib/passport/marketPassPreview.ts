import { buildMarketPassAssessment } from "@/lib/intelligence/marketPass/assessment";
import { toPublicContract } from "@/lib/intelligence/marketPass/publicContract";
import type { MarketPassPublicContract } from "@/lib/intelligence/marketPass/contracts";
import { NOW, legacyUsedRow, newRow, settings, usedRow } from "@/lib/intelligence/marketPass/__fixtures__/rows";

/**
 * Synthetic MarketPass contracts for the /v-next preview only. Built from the
 * test fixture rows (example VINs, a fixed clock) through the same pure
 * builder the edge function runs, so the preview cannot drift from it. The
 * page labels every contract from here as synthetic.
 */
export function previewMarketPassContract(scenario: string | null): MarketPassPublicContract {
  const row = scenario === "new2026" || scenario === "newmsrp" ? newRow()
    : scenario === "sparse" ? legacyUsedRow()
    : scenario === "review" ? usedRow({ mc_attributes: { ...(usedRow().mc_attributes as Record<string, unknown>), title_brand: "Salvage" } })
    : usedRow();
  return toPublicContract(buildMarketPassAssessment({ row, settings: settings(true), nowMs: NOW }));
}
