import { supabase } from "@/integrations/supabase/client";

// ──────────────────────────────────────────────────────────────
// A signed-in user can belong to more than one dealer tenant (e.g. an
// owner who also has a legacy/demo "house" tenant). The active tenant
// MUST be chosen deterministically: a bare `.limit(1)` on tenant_members
// returns an arbitrary row, which silently flipped an owner onto an empty
// tenant and blanked their whole inventory. Precedence:
//   1. an explicit saved choice, if it is still a membership;
//   2. else the tenant carrying the most inventory (the dealership the
//      user actually operates), tie-broken by id for stability.
// Single-membership users short-circuit with no extra query.
// ──────────────────────────────────────────────────────────────

export const ACTIVE_TENANT_KEY = "wl_active_tenant";

export async function pickActiveTenantId(tenantIds: string[]): Promise<string | null> {
  const ids = Array.from(new Set(tenantIds.filter(Boolean)));
  if (ids.length === 0) return null;
  if (ids.length === 1) return ids[0];

  let saved: string | null = null;
  try { saved = localStorage.getItem(ACTIVE_TENANT_KEY); } catch { /* no storage */ }
  if (saved && ids.includes(saved)) return saved;

  const ordered = [...ids].sort();
  try {
    const counts = await Promise.all(
      ordered.map((id) =>
        (supabase as any)
          .from("vehicle_listings")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", id)
          .then((r: { count: number | null }) => ({ id, n: r.count || 0 })),
      ),
    );
    let best = ordered[0];
    let bestN = -1;
    for (const c of counts) if (c.n > bestN) { bestN = c.n; best = c.id; }
    return best;
  } catch {
    return ordered[0];
  }
}

export function saveActiveTenantId(id: string) {
  try { localStorage.setItem(ACTIVE_TENANT_KEY, id); } catch { /* ignore */ }
}
