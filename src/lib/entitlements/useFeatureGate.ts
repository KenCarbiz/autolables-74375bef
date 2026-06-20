import { useCallback } from "react";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useAuth } from "@/contexts/AuthContext";
import { FEATURE_TIER, normalizeTier, rankOf, planLabel, type FeatureKey, type PlanTier } from "./features";

// Feature gate hook. Reads the tenant's autolabels entitlement and answers
// canUseFeature(key). Degrades OPEN while entitlements load or on error so a
// transient hiccup never strands a dealer mid-task. Platform features are gated
// by admin role, not tier. Never writes entitlement state.
export interface FeatureGate {
  plan: PlanTier;
  planName: string;
  hasAccess: boolean;
  loading: boolean;
  canUseFeature: (key: FeatureKey) => boolean;
  requiredTier: (key: FeatureKey) => PlanTier;
}

export function useFeatureGate(): FeatureGate {
  const { hasApp, tier, loading, error } = useEntitlements();
  const { isAdmin } = useAuth();
  const hasAccess = hasApp("autolabels");
  const plan = normalizeTier(tier("autolabels"), hasAccess);

  const canUseFeature = useCallback((key: FeatureKey): boolean => {
    // Never hard-block on an unresolved/transient entitlement state.
    if (loading || error) return true;
    const req = FEATURE_TIER[key];
    if (req === "platform") return isAdmin;          // role-gated, not tier
    if (key === "autolabels_access") return hasAccess;
    if (!hasAccess) return false;                    // no app entitlement
    return rankOf(plan) >= rankOf(req);
  }, [loading, error, isAdmin, hasAccess, plan]);

  return {
    plan,
    planName: planLabel(plan),
    hasAccess,
    loading,
    canUseFeature,
    requiredTier: (key) => FEATURE_TIER[key],
  };
}
