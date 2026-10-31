import type { Tone } from "../types";
import { consolePath } from "../sections";
import { readRows, relativeAge, settle } from "./read";

export interface AccessRow {
  id: string;
  member: string;
  scope: string;
  role: string;
  lastSignIn: string;
  state: { label: string; tone: Tone };
  actionLabel: string;
  href: string;
}

export interface AccessModel {
  rows: AccessRow[];
  rowsNote: string;
  privilegedHelper: string;
  signalsHelper: string;
  signalsLine: string;
  signalsNote: string;
}

interface MemberRow { id: string; tenant_id: string; user_id: string | null; invited_email: string | null; role: string; accepted_at: string | null; invited_at: string }
interface TenantRow { id: string; name: string }
interface StoreRow { id: string; tenant_id: string; display_name: string }

const ROLE = (r: string) => r.charAt(0).toUpperCase() + r.slice(1);

/** Dealer-store memberships. These are not platform permissions, and no sign-in telemetry is read. */
export async function loadAccess(now = Date.now()): Promise<AccessModel> {
  const [members, tenants, stores] = await Promise.all([
    settle(readRows<MemberRow>("tenant_members", "id,tenant_id,user_id,invited_email,role,accepted_at,invited_at", { order: "invited_at", limit: 200 })),
    settle(readRows<TenantRow>("tenants", "id,name", { limit: 500 })),
    settle(readRows<StoreRow>("dealer_stores", "id,tenant_id,display_name", { limit: 1000 })),
  ]);
  const base = {
    privilegedHelper: "Platform permissions are explicit, audited and separate from dealer ownership.",
    signalsHelper: "No raw secrets or unrestricted customer payloads in diagnostics.",
    signalsLine: "Not monitored: cross-store denials, credential failures and session revocations are not recorded yet.",
    signalsNote: "Verify isolation with synthetic tests before relying on this panel.",
  };
  if (!members.ok) {
    return { ...base, rows: [], rowsNote: "Memberships are not readable, so access is unknown. Nothing here is treated as authorized." };
  }
  const tenantName = new Map((tenants.ok ? tenants.value : []).map((t) => [t.id, t.name]));
  const storesByTenant = new Map<string, StoreRow[]>();
  for (const s of stores.ok ? stores.value : []) storesByTenant.set(s.tenant_id, [...(storesByTenant.get(s.tenant_id) ?? []), s]);

  const rows: AccessRow[] = members.value.map((m) => {
    const owned = storesByTenant.get(m.tenant_id) ?? [];
    const scope = owned.length === 1 ? owned[0].display_name : tenantName.get(m.tenant_id) ?? "Unresolved scope";
    // A bare user id is not a name: without an email the identity stays unresolved.
    const resolved = !!m.invited_email;
    const accepted = !!m.accepted_at;
    return {
      id: m.id,
      member: m.invited_email ?? "Unresolved identity",
      scope,
      role: ROLE(m.role),
      lastSignIn: accepted ? `Accepted ${relativeAge(m.accepted_at, now)} ago` : "Unknown",
      state: !resolved ? { label: "Needs review", tone: "warn" } : accepted ? { label: "Active", tone: "good" } : { label: "Invited", tone: "warn" },
      actionLabel: !resolved ? "Inspect identity" : "Open member",
      href: owned.length === 1 ? consolePath.store(owned[0].id) : consolePath.access(),
    };
  });
  return { ...base, rows, rowsNote: "No store memberships are recorded." };
}
