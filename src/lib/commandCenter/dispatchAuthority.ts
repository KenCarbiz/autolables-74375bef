// ──────────────────────────────────────────────────────────────────────
// "May view Get Ready" and "may authorize and dispatch it" are two different
// permissions, and the screen only knew about the first one.
//
// can_view_get_ready is held by service_manager, service_advisor and detail
// (dealerRoleCapabilities.ts:185-194) — none of which is in the MANAGER_ROLES
// set notify-getready enforces (index.ts:32-35, 45-47). So those three ticked
// five checkboxes, pressed a one-shot irreversible button, got a 401, and were
// told "Some work orders may already have gone out — check the VIN timeline
// before authorizing again." Nothing had gone out, and the real reason was
// never stated.
//
// This is the client half of the SAME rule the function enforces. It is a
// courtesy, not a security boundary: the server still decides. Keep it in step
// with MANAGER_ROLES in supabase/functions/notify-getready/index.ts and with the
// accept_addendum SQL guard.
// ──────────────────────────────────────────────────────────────────────

const DISPATCH_ROLES: ReadonlySet<string> = new Set([
  "owner", "general_manager", "gsm", "admin", "manager",
  "sales_manager", "used_car_manager", "inventory_manager",
]);

export function canDispatchGetReady(
  role: string | null | undefined,
  isPlatformAdmin: boolean,
): boolean {
  if (isPlatformAdmin) return true;
  return DISPATCH_ROLES.has(String(role || "").trim().toLowerCase());
}

export const DISPATCH_DENIED_REASON =
  "Only a manager can authorize and dispatch Get Ready. Ask a sales, inventory or general manager to release this vehicle.";
