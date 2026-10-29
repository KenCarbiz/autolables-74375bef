import { hasDealerCapability, type DealerRole } from "@/lib/permissions/dealerRoleCapabilities";
import { navModeForRole } from "@/components/layout/adminNav";

// What the command palette can actually look up for one viewer. The header's
// search box names exactly these, so it never promises a search the palette
// cannot run for that role.

export interface SearchScopeInput {
  role: DealerRole;
  isAdmin: boolean;
  /** Signed in with a dealership membership row. */
  hasMember: boolean;
  /** The real tenant id, or null for the house sentinel. */
  tenantId: string | null;
  /** The current rooftop; leads are stored per rooftop. */
  storeId: string | null;
}

export interface SearchScope {
  vehicles: boolean;
  customers: boolean;
}

export function paletteSearchScope({ role, isAdmin, hasMember, tenantId, storeId }: SearchScopeInput): SearchScope {
  const signedIn = hasMember || isAdmin;
  return {
    vehicles: !!tenantId && signedIn && hasDealerCapability(role, "can_view_inventory", isAdmin),
    customers:
      navModeForRole(role) === "dealer" &&
      !!tenantId &&
      !!storeId &&
      signedIn &&
      hasDealerCapability(role, "can_view_leads", isAdmin),
  };
}

/** The search box's words and accessible name; the visible placeholder adds "...". */
export function searchPrompt(scope: SearchScope): string {
  if (scope.vehicles && scope.customers) return "Search vehicles, customers, or anything";
  if (scope.vehicles) return "Search vehicles or anything";
  if (scope.customers) return "Search customers or anything";
  return "Search commands";
}
