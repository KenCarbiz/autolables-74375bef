import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useOptionalDealerSettings } from "@/components/admin/v3/optionalDealerSettings";
import type { AdminVisibilityContext } from "@/lib/admin/sections";

export function useAdminVisibility(): { ctx: AdminVisibilityContext; ready: boolean } {
  const { isAdmin, loading: authLoading } = useAuth();
  const { member, loading: entitlementsLoading } = useEntitlements();
  // Optional so navigation chrome (Browse settings) can render in a child
  // page tested without the settings provider; the app always mounts it.
  const dealer = useOptionalDealerSettings();
  const settings = dealer?.settings;
  const settingsLoading = dealer?.loading ?? false;
  const ctx = useMemo<AdminVisibilityContext>(() => ({
    role: member?.role,
    isAdmin,
    features: settings
      ? {
          feature_product_rules: settings.feature_product_rules,
          feature_invoicing: settings.feature_invoicing,
          feature_warranty: settings.feature_warranty,
        }
      : undefined,
  }), [member?.role, isAdmin, settings]);
  return { ctx, ready: !authLoading && !entitlementsLoading && !settingsLoading };
}
