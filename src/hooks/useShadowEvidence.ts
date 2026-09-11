// ── Shadow evidence, read-only, tenant-scoped ──────────────────────────────
//
// The pilot is observed through this. It is a READ and nothing else: there is
// no mutation, no invoke, no refresh-fleet, no budget control and no
// provider-call control in this file, and a test asserts each absence.
//
// Tenant scoping is belt AND braces. The query filters on `tenant_id`, RLS
// filters again server-side, and `buildShadowReviewRow` refuses to assemble a
// row whose tenant does not match the viewer — so a filter forgotten in any
// one of the three shows nothing rather than someone else's inventory.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buildShadowReviewRow, type ShadowReviewRow } from "@/lib/market/shadowReview";

/** How many evaluations the review surface shows. A pilot is 50 cars. */
export const SHADOW_EVIDENCE_LIMIT = 100;

export function useShadowEvidence(tenantId: string | null | undefined) {
  return useQuery<ShadowReviewRow[]>({
    queryKey: ["shadow-evidence", tenantId],
    enabled: !!tenantId,
    staleTime: 60_000,
    queryFn: async () => {
      if (!tenantId) return [];

      const { data: evaluations, error } = await supabase
        .from("vehicle_market_valuations")
        .select(
          "id, tenant_id, vin, created_at, checked_at, status, algorithm_version, displayed_total_price, vehicle_comparison_price, doc_fee, price_basis_status, certification_match, provider, provider_attempt_status, provider_prediction, raw_candidate_count, eligible_primary_count, effective_sample_size, independent_rooftop_count, confidence_tier, verdict, confidence_reasons, insufficient_market_diversity, data_provenance",
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(SHADOW_EVIDENCE_LIMIT);
      if (error || !evaluations?.length) return [];

      const ids = evaluations.map((e) => e.id as string);
      const { data: comparables } = await supabase
        .from("vehicle_market_comparables")
        .select("valuation_id, comparable_vin, dealer_name, inclusion_status, exclusion_reasons")
        .eq("tenant_id", tenantId)
        .in("valuation_id", ids);

      // The legacy number each evaluation is compared against, for the
      // legacy-versus-V2 column. Read, never written.
      const vins = [...new Set(evaluations.map((e) => e.vin as string))];
      const { data: listings } = await supabase
        .from("vehicle_listings")
        .select("vin, market_value")
        .eq("tenant_id", tenantId)
        .in("vin", vins);
      const legacyByVin = new Map((listings ?? []).map((l) => [l.vin as string, l.market_value]));

      return evaluations
        .map((evaluation) =>
          buildShadowReviewRow({
            evaluation,
            comparables: (comparables ?? []).filter((c) => c.valuation_id === evaluation.id),
            viewerTenantId: tenantId,
            legacyMarketValue: legacyByVin.get(evaluation.vin as string),
          }),
        )
        .filter((r): r is ShadowReviewRow => r !== null);
    },
  });
}
