import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import type { AdminVisibilityContext } from "@/lib/admin/sections";

export function useAdminVisibility(): { ctx: AdminVisibilityContext; ready: boolean } {
  const { isAdmin, loading: authLoading } = useAuth();
  const { member, loading: entitlementsLoading } = useEntitlements();
  const { settings, loading: settingsLoading } = useDealerSettings();
  const ctx = useMemo<AdminVisibilityContext>(() => ({
    role: member?.role,
    isAdmin,
    features: {
      feature_product_rules: settings.feature_product_rules,
      feature_invoicing: settings.feature_invoicing,
      feature_warranty: settings.feature_warranty,
    },
  }), [member?.role, isAdmin, settings.feature_product_rules, settings.feature_invoicing, settings.feature_warranty]);
  return { ctx, ready: !authLoading && !entitlementsLoading && !settingsLoading };
}
