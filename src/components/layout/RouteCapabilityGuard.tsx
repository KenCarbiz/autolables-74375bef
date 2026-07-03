import { type ReactNode } from "react";
import { useLocation, Navigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability, dealerRoleHome, type DealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { canSeeAdminTab, firstPermittedAdminTab, isAdminTab } from "@/lib/permissions/adminTabAccess";

// Deep-link defense for gated routes. The sidebar already hides screens a role
// can't use; this stops someone typing the URL directly. Conservative on
// purpose: only clear role boundaries are guarded, and a denied user is
// REDIRECTED to their own home (never shown a dead end), so it can't lock
// anyone out. Routes not listed are unrestricted (entitlement still applies).
const RULES: { prefix: string; cap: DealerCapability }[] = [
  { prefix: "/admin/", cap: "can_manage_settings" },
  { prefix: "/dashboard/reports", cap: "can_view_reports" },
  { prefix: "/dashboard/qr-analytics", cap: "can_view_reports" },
  { prefix: "/dashboard/document-review", cap: "can_view_compliance" },
  { prefix: "/compliance", cap: "can_view_compliance" },
  { prefix: "/compliance-center", cap: "can_manage_compliance" },
  { prefix: "/recon", cap: "can_view_get_ready" },
  { prefix: "/prep", cap: "can_view_get_ready" },
  { prefix: "/service", cap: "can_view_get_ready" },
  { prefix: "/ready-board", cap: "can_view_get_ready" },
  { prefix: "/add-inventory", cap: "can_edit_inventory" },
  { prefix: "/queue", cap: "can_view_work_queue" },
  { prefix: "/leads", cap: "can_view_leads" },
  { prefix: "/titles", cap: "can_view_compliance" },
];

export default function RouteCapabilityGuard({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  const { member, loading } = useEntitlements();
  const location = useLocation();

  if (loading || isAdmin) return <>{children}</>;

  const path = location.pathname;

  // /admin is gated per ?tab= so roles with a partial admin surface (leads,
  // audit, queue, ...) can reach their tabs without holding can_manage_settings.
  if (path === "/admin") {
    const tabParam = new URLSearchParams(location.search).get("tab");
    const allowed = isAdminTab(tabParam)
      ? canSeeAdminTab(member?.role, tabParam, isAdmin)
      // No (or unknown) tab: Admin falls back to the first permitted tab.
      : firstPermittedAdminTab(member?.role, isAdmin) != null;
    if (!allowed) {
      const home = dealerRoleHome(member?.role, isAdmin);
      if (home !== path) {
        toast.error("You don't have access to that screen.");
        return <Navigate to={home} replace />;
      }
    }
    return <>{children}</>;
  }

  // Longest-prefix match so /service-inspection still matches /service, etc.
  const rule = RULES.filter((r) => path === r.prefix || path.startsWith(r.prefix + "/") || path.startsWith(r.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];

  if (rule && !hasDealerCapability(member?.role, rule.cap, isAdmin)) {
    const home = dealerRoleHome(member?.role, isAdmin);
    if (home !== path) {
      toast.error("You don't have access to that screen.");
      return <Navigate to={home} replace />;
    }
  }
  return <>{children}</>;
}
