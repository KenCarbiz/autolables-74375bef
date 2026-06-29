import { type ReactNode } from "react";
import { useLocation, Navigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability, dealerRoleHome, type DealerCapability } from "@/lib/permissions/dealerRoleCapabilities";

// Deep-link defense for gated routes. The sidebar already hides screens a role
// can't use; this stops someone typing the URL directly. Conservative on
// purpose: only clear role boundaries are guarded, and a denied user is
// REDIRECTED to their own home (never shown a dead end), so it can't lock
// anyone out. Routes not listed are unrestricted (entitlement still applies).
const RULES: { prefix: string; cap: DealerCapability }[] = [
  { prefix: "/admin", cap: "can_manage_settings" },
  { prefix: "/setup", cap: "can_manage_settings" },
  { prefix: "/dashboard/reports", cap: "can_view_reports" },
  { prefix: "/dashboard/qr-analytics", cap: "can_view_reports" },
  { prefix: "/recon", cap: "can_view_get_ready" },
  { prefix: "/prep", cap: "can_view_get_ready" },
  { prefix: "/service", cap: "can_view_get_ready" },
  { prefix: "/ready-board", cap: "can_view_get_ready" },
  { prefix: "/add-inventory", cap: "can_edit_inventory" },
];

export default function RouteCapabilityGuard({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  const { member, loading } = useEntitlements();
  const location = useLocation();

  if (loading || isAdmin) return <>{children}</>;

  const path = location.pathname;
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
