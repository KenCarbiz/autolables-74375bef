// Where each role capability is actually enforced today, as read from the
// live catalog on 2026-10-28 (policies, RPC guards, triggers) and the client
// guards in this repository. The role child renders this beside the
// capability matrix so a green check in the matrix is never mistaken for a
// server guarantee. "Enforced" is claimed only where a server guard exists;
// "Must match role policy" is everything else, including client-side
// filtering, which hides controls but is not permission.

export type EnforcementPoint = "interface" | "direct_url" | "api" | "database";
export type EnforcementStatus = "enforced" | "must_match";
export type PolicyArea = "customers" | "vehicles" | "sharing" | "dealer_policy" | "team";

export interface EnforcementFact {
  area: PolicyArea;
  point: EnforcementPoint;
  status: EnforcementStatus;
  evidence: string;
}

export const ENFORCEMENT_POINT_META: Readonly<Record<EnforcementPoint, { title: string; description: string }>> = {
  interface: { title: "Interface visibility", description: "Pages, navigation and actions must align with this role's permissions." },
  direct_url: { title: "Direct URL", description: "Deep links must be restricted based on this role's permissions." },
  api: { title: "API action", description: "API endpoints must enforce this role's permissions." },
  database: { title: "Database policy", description: "Data access must be restricted based on this role's permissions." },
};

export const ENFORCEMENT_STATUS_META: Readonly<Record<EnforcementStatus, { label: string; tone: "success" | "warning" }>> = {
  enforced: { label: "Enforced on server", tone: "success" },
  must_match: { label: "Must match role policy", tone: "warning" },
};

const INTERFACE = "Navigation rows and Administration tabs are filtered by capability (adminNav, adminTabAccess). Hiding a control is not permission.";
const DIRECT_URL = "RouteCapabilityGuard redirects routes the role cannot hold, but renders children while entitlements load.";

export const ENFORCEMENT_FACTS: readonly EnforcementFact[] = [
  { area: "customers", point: "interface", status: "must_match", evidence: INTERFACE },
  { area: "customers", point: "direct_url", status: "must_match", evidence: DIRECT_URL },
  { area: "customers", point: "api", status: "must_match", evidence: "Lead reads and writes go to the leads table directly; no role-aware procedure sits in front of them." },
  { area: "customers", point: "database", status: "must_match", evidence: "leads policies are tenant-scoped (current_tenant_id), not role-scoped: any accepted member may update any lead." },

  { area: "vehicles", point: "interface", status: "must_match", evidence: INTERFACE },
  { area: "vehicles", point: "direct_url", status: "must_match", evidence: DIRECT_URL },
  { area: "vehicles", point: "api", status: "must_match", evidence: "Listing edits write vehicle_listings directly; price, status and recall override columns have no role-aware procedure." },
  { area: "vehicles", point: "database", status: "must_match", evidence: "vehicle_listings UPDATE is tenant-scoped (current_tenant_id or creator), not role-scoped; the authenticated role holds table UPDATE." },

  { area: "sharing", point: "interface", status: "must_match", evidence: INTERFACE },
  { area: "sharing", point: "direct_url", status: "must_match", evidence: DIRECT_URL },
  { area: "sharing", point: "api", status: "enforced", evidence: "Public Passport and card links are resolved by public-listing-view with the service role; a shopper link never carries dealer authority." },
  { area: "sharing", point: "database", status: "must_match", evidence: "Listing reads are tenant-scoped, not role-scoped; any accepted member can read what this role may share." },

  { area: "dealer_policy", point: "interface", status: "must_match", evidence: INTERFACE },
  { area: "dealer_policy", point: "direct_url", status: "must_match", evidence: DIRECT_URL },
  { area: "dealer_policy", point: "api", status: "must_match", evidence: "merge_dealer_settings checks accepted membership and guards eight service-policy keys; every other settings key, including doc fee and routing, is writable by any accepted member." },
  { area: "dealer_policy", point: "database", status: "must_match", evidence: "dealer_profiles UPDATE and products/product_rules ALL policies allow any accepted member; direct table writes bypass the procedure's key guard." },

  { area: "team", point: "interface", status: "must_match", evidence: "People & Access is shown to roles holding can_manage_team, which is wider than the server's owner, admin and general manager rule." },
  { area: "team", point: "direct_url", status: "must_match", evidence: DIRECT_URL },
  { area: "team", point: "api", status: "enforced", evidence: "set_tenant_member_role, invite_tenant_member and remove_tenant_member require an accepted owner, admin or general manager of the same tenant and protect the last owner; role changes are written to the audit ledger." },
  { area: "team", point: "database", status: "enforced", evidence: "tenant_members UPDATE is platform-admin or self-accept only; a trigger prevents a member from changing their own role." },
];

export const factsFor = (area: PolicyArea): EnforcementFact[] => ENFORCEMENT_FACTS.filter((f) => f.area === area);

const SEVERITY: Record<EnforcementStatus, number> = { enforced: 0, must_match: 1 };

export function worstStatus(statuses: EnforcementStatus[]): EnforcementStatus {
  return statuses.reduce<EnforcementStatus>((w, s) => (SEVERITY[s] > SEVERITY[w] ? s : w), "enforced");
}

export interface EnforcementRow {
  point: EnforcementPoint;
  title: string;
  description: string;
  status: EnforcementStatus;
  /** One line per policy area, most severe first. */
  evidence: Array<{ area: PolicyArea; status: EnforcementStatus; text: string }>;
}

export const AREA_LABEL: Readonly<Record<PolicyArea, string>> = {
  customers: "Customers",
  vehicles: "Vehicles",
  sharing: "Sharing",
  dealer_policy: "Dealer policy",
  team: "Team",
};

/** The four enforcement rows for a role policy covering the given areas. */
export function enforcementRows(areas: PolicyArea[] = ["customers", "vehicles", "sharing", "dealer_policy"]): EnforcementRow[] {
  const points: EnforcementPoint[] = ["interface", "direct_url", "api", "database"];
  return points.map((point) => {
    const facts = ENFORCEMENT_FACTS.filter((f) => f.point === point && areas.includes(f.area));
    const evidence = facts
      .map((f) => ({ area: f.area, status: f.status, text: f.evidence }))
      .sort((a, b) => SEVERITY[b.status] - SEVERITY[a.status]);
    return { point, ...ENFORCEMENT_POINT_META[point], status: worstStatus(facts.map((f) => f.status)), evidence };
  });
}

/** True when every enforcement point is a server guarantee; today it never is for a dealer role. */
export const policyFullyEnforced = (rows: EnforcementRow[]): boolean => rows.every((r) => r.status === "enforced");
