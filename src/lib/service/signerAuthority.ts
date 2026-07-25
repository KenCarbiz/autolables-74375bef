// Client mirror of public.k208_signer_allowed (20260726105000): the ONE
// authority answer for "may this user execute the K-208". The SQL is
// authoritative — certify_safety_inspection and the finalize gate call it —
// this mirror only decides what the UI offers, so a signer never taps Execute
// just to be refused, and a non-signer sees the named missing authorization.
// signerAuthority.test.ts pins the compat role set and the legacy 'service'
// expansion against the migration text so the two runtimes cannot drift.

/** The historic manager-level compat rule, used ONLY when the dealer has
 *  configured neither the role list nor the per-user list. */
export const K208_COMPAT_SIGNER_ROLES = [
  "owner",
  "general_manager",
  "gsm",
  "admin",
  "manager",
  "sales_manager",
  "used_car_manager",
  "inventory_manager",
  "service_manager",
] as const;

/** Legacy "service" authority key expands to the real service job roles. */
export const K208_LEGACY_SERVICE_EXPANSION = ["service_manager", "service_advisor"] as const;

export interface SignerAuthorityInput {
  isPlatformAdmin: boolean;
  userId: string | null | undefined;
  /** The user's accepted tenant_members.role; null = not a member. */
  role: string | null | undefined;
  /** dealer settings k208_authorized_users (auth user ids). */
  authorizedUsers: string[];
  /** dealer settings k208_authority_roles. */
  authorityRoles: string[];
}

export function k208SignerAllowedClient(i: SignerAuthorityInput): boolean {
  if (i.isPlatformAdmin) return true;
  if (!i.userId) return false;
  const role = String(i.role ?? "").trim().toLowerCase();
  if (!role) return false; // signer must be an accepted member

  let roles = i.authorityRoles.map((r) => String(r).trim().toLowerCase()).filter(Boolean);
  if (roles.includes("service")) roles = [...roles, ...K208_LEGACY_SERVICE_EXPANSION];
  const users = i.authorizedUsers.filter(Boolean);

  if (users.length > 0 && users.includes(i.userId)) return true;
  if (roles.length > 0 && roles.includes(role)) return true;
  if (users.length === 0 && i.authorityRoles.length === 0) {
    return (K208_COMPAT_SIGNER_ROLES as readonly string[]).includes(role);
  }
  return false;
}

/** The sentence a non-signer sees wherever execution is offered. */
export const K208_SIGNER_DENIAL =
  "Executing the K-208 requires an explicit signer grant. Ask a manager to add you under Service Desk Settings, K-208 Policy.";
