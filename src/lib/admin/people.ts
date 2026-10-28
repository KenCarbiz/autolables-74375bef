import {
  ASSIGNABLE_ROLE_GROUPS,
  getDealerCapabilities,
  roleDisplayName,
  type DealerCapability,
  type DealerRole,
} from "@/lib/permissions/dealerRoleCapabilities";

// People & Access: pure derivations over the one identity model the app has,
// tenant_members (read through list_tenant_members). Nothing here stores a
// second employee record; status, department and capabilities are all derived
// from the membership row and the role capability contract.

export interface TeamMemberRow {
  id: string;
  user_id: string | null;
  email: string | null;
  role: string;
  accepted_at: string | null;
  invited_email: string | null;
}

export type MemberStatus = "active" | "invited";

export interface TeamMember {
  id: string;
  userId: string | null;
  email: string;
  role: string;
  roleLabel: string;
  department: string;
  status: MemberStatus;
  acceptedAt: string | null;
  initials: string;
}

const LEGACY_DEPARTMENT: Record<string, string> = {
  manager: "Management",
  staff: "Sales",
  sales: "Sales",
  finance: "Business Office",
  biller: "Business Office",
  compliance: "Business Office",
  detail: "Service",
  third_party_vendor: "Service",
  readonly: "Other",
  viewer: "Other",
};

const GROUP_DEPARTMENT: Record<string, string> = {
  Management: "Management",
  Sales: "Sales",
  Inventory: "Inventory",
  Service: "Service",
  Office: "Business Office",
  Administration: "Management",
};

export const normalizeRole = (role: string | null | undefined): string => `${role || ""}`.trim().toLowerCase();

export function departmentForRole(role: string | null | undefined): string {
  const r = normalizeRole(role);
  for (const g of ASSIGNABLE_ROLE_GROUPS) {
    if (g.roles.some((x) => x.value === r)) return GROUP_DEPARTMENT[g.group] ?? g.group;
  }
  return LEGACY_DEPARTMENT[r] ?? "Other";
}

export const DEPARTMENTS: readonly string[] = ["Management", "Sales", "Inventory", "Service", "Business Office", "Other"];

export function initialsFor(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._\-+ ]+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : local.slice(0, 2);
  return (letters || "?").toUpperCase();
}

export function normalizeMember(row: TeamMemberRow): TeamMember {
  const email = (row.email || row.invited_email || "").trim();
  const role = normalizeRole(row.role);
  return {
    id: row.id,
    userId: row.user_id,
    email,
    role,
    roleLabel: roleDisplayName(role),
    department: departmentForRole(role),
    status: row.accepted_at ? "active" : "invited",
    acceptedAt: row.accepted_at,
    initials: initialsFor(email),
  };
}

// ── Filters, kept in the URL so a child page can restore them on Back ──

export interface TeamFilters {
  q: string;
  dept: string;
  status: "all" | MemberStatus;
  role: string;
  sel: string;
}

export const EMPTY_TEAM_FILTERS: TeamFilters = { q: "", dept: "all", status: "all", role: "all", sel: "" };

export function parseTeamFilters(params: URLSearchParams): TeamFilters {
  const status = params.get("status");
  return {
    q: params.get("q") ?? "",
    dept: params.get("dept") ?? "all",
    status: status === "active" || status === "invited" ? status : "all",
    role: params.get("role") ?? "all",
    sel: params.get("sel") ?? "",
  };
}

/** Only non-default values are written, so a clean filter yields a clean URL. */
export function teamFiltersToParams(filters: TeamFilters, base?: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(base ? base.toString() : "");
  const set = (k: keyof TeamFilters, v: string, def: string) => {
    if (v && v !== def) next.set(k, v);
    else next.delete(k);
  };
  set("q", filters.q.trim(), "");
  set("dept", filters.dept, "all");
  set("status", filters.status, "all");
  set("role", filters.role, "all");
  set("sel", filters.sel, "");
  return next;
}

export function applyTeamFilters(members: TeamMember[], filters: TeamFilters): TeamMember[] {
  const q = filters.q.trim().toLowerCase();
  return members.filter((m) => {
    if (q && !(m.email.toLowerCase().includes(q) || m.roleLabel.toLowerCase().includes(q) || m.department.toLowerCase().includes(q))) return false;
    if (filters.dept !== "all" && m.department !== filters.dept) return false;
    if (filters.status !== "all" && m.status !== filters.status) return false;
    if (filters.role !== "all" && m.role !== filters.role) return false;
    return true;
  });
}

/** The return address a child page uses so Back restores search, filters and selection. */
export const teamReturnHref = (params: URLSearchParams): string => {
  const p = new URLSearchParams(params.toString());
  p.set("tab", "team");
  return `/admin?${p.toString()}`;
};

// ── Capability matrix: task language over the capability contract ────────

export interface MatrixCellCaps {
  read: DealerCapability;
  act: DealerCapability;
  manage: DealerCapability;
}

export interface MatrixRowSpec {
  id: string;
  label: string;
  detail: string;
  caps: MatrixCellCaps;
}

export interface MatrixGroupSpec {
  group: string;
  rows: MatrixRowSpec[];
}

export const CAPABILITY_MATRIX: readonly MatrixGroupSpec[] = [
  {
    group: "Customers",
    rows: [
      { id: "assigned_customers", label: "Assigned customers", detail: "View and work with assigned customers.", caps: { read: "can_view_leads", act: "can_work_leads", manage: "can_manage_deals" } },
    ],
  },
  {
    group: "Vehicles",
    rows: [
      { id: "inventory", label: "Inventory", detail: "View vehicle details and work with inventory.", caps: { read: "can_view_inventory", act: "can_create_documents", manage: "can_edit_inventory" } },
    ],
  },
  {
    group: "Sharing",
    rows: [
      { id: "connect_card", label: "Connect Card share", detail: "Share vehicle Connect Cards with customers.", caps: { read: "can_view_passport", act: "can_view_passport", manage: "can_approve_passport_proof" } },
      { id: "passport_share", label: "Vehicle Passport share", detail: "Share Vehicle Passports with customers.", caps: { read: "can_view_passport", act: "can_view_passport", manage: "can_approve_passport_proof" } },
    ],
  },
  {
    group: "Dealer policy",
    rows: [
      { id: "price_rules", label: "Price rules", detail: "Create and manage dealer price rules.", caps: { read: "can_manage_addons", act: "can_manage_addons", manage: "can_manage_settings" } },
      { id: "publishing_policy", label: "Publishing policy", detail: "Manage publishing policy and approval rules.", caps: { read: "can_view_compliance", act: "can_manage_compliance", manage: "can_manage_settings" } },
    ],
  },
];

export interface MatrixCell {
  read: boolean;
  act: boolean;
  manage: boolean;
}

export interface MatrixRow extends MatrixCell {
  id: string;
  label: string;
  detail: string;
}

export type CapabilityMatrix = Array<{ group: string; rows: MatrixRow[] }>;

export function capabilityMatrixForRole(role: DealerRole, isPlatformAdmin = false): CapabilityMatrix {
  const caps = new Set(getDealerCapabilities(role, isPlatformAdmin));
  return CAPABILITY_MATRIX.map((g) => ({
    group: g.group,
    rows: g.rows.map((r) => ({ id: r.id, label: r.label, detail: r.detail, read: caps.has(r.caps.read), act: caps.has(r.caps.act), manage: caps.has(r.caps.manage) })),
  }));
}

export interface RoleSummary {
  keyPermissions: string[];
  restricted: string[];
}

const SUMMARY_PERMISSIONS: Array<{ label: string; capability: DealerCapability }> = [
  { label: "View assigned customers", capability: "can_view_leads" },
  { label: "Share employee card", capability: "can_view_passport" },
  { label: "Share vehicle Passport", capability: "can_view_passport" },
  { label: "Create follow-up", capability: "can_work_leads" },
  { label: "Edit inventory", capability: "can_edit_inventory" },
  { label: "Approve print", capability: "can_approve_print" },
  { label: "View reports", capability: "can_view_reports" },
  { label: "Manage team", capability: "can_manage_team" },
];

const SUMMARY_RESTRICTIONS: Array<{ label: string; capabilities: DealerCapability[] }> = [
  { label: "Change dealer pricing", capabilities: ["can_manage_addons", "can_manage_settings"] },
  { label: "Edit publishing policy", capabilities: ["can_manage_settings"] },
  { label: "Manage team", capabilities: ["can_manage_team"] },
  { label: "Edit inventory", capabilities: ["can_edit_inventory"] },
];

/** Four granted task lines and up to two restrictions, in task language. */
export function roleSummary(role: DealerRole, isPlatformAdmin = false): RoleSummary {
  const caps = new Set(getDealerCapabilities(role, isPlatformAdmin));
  const keyPermissions = SUMMARY_PERMISSIONS.filter((p) => caps.has(p.capability)).map((p) => p.label).slice(0, 4);
  const restricted = SUMMARY_RESTRICTIONS.filter((r) => r.capabilities.every((c) => !caps.has(c))).map((r) => r.label).slice(0, 2);
  return { keyPermissions, restricted };
}

export interface RoleChangeImpact {
  fromRole: string;
  toRole: string;
  gained: string[];
  lost: string[];
  cellsChanged: number;
}

const cellLabel = (row: MatrixRow, key: keyof MatrixCell): string =>
  `${row.label}: ${key === "read" ? "read" : key === "act" ? "create or act" : "manage"}`;

export function roleChangeImpact(fromRole: DealerRole, toRole: DealerRole): RoleChangeImpact {
  const before = capabilityMatrixForRole(fromRole);
  const after = capabilityMatrixForRole(toRole);
  const gained: string[] = [];
  const lost: string[] = [];
  before.forEach((g, gi) => {
    g.rows.forEach((row, ri) => {
      const next = after[gi].rows[ri];
      (["read", "act", "manage"] as const).forEach((k) => {
        if (!row[k] && next[k]) gained.push(cellLabel(row, k));
        if (row[k] && !next[k]) lost.push(cellLabel(row, k));
      });
    });
  });
  return { fromRole: normalizeRole(fromRole), toRole: normalizeRole(toRole), gained, lost, cellsChanged: gained.length + lost.length };
}

// ── Server authority, stated as the server enforces it ───────────────────

/** set_tenant_member_role, invite_tenant_member and remove_tenant_member accept only these accepted roles. */
export const TEAM_WRITER_ROLES: readonly string[] = ["owner", "admin", "general_manager"];

export const canWriteTeamOnServer = (role: DealerRole, isPlatformAdmin = false): boolean =>
  isPlatformAdmin || TEAM_WRITER_ROLES.includes(normalizeRole(role));

export const TEAM_WRITE_DENIED_REASON = "Only an owner, admin or general manager can change roles or invitations. The server enforces this; the interface mirrors it.";

/** Roles the invite RPC accepts: every assignable role except owner. */
export const invitableRoles = (): Array<{ group: string; roles: Array<{ value: string; label: string }> }> =>
  ASSIGNABLE_ROLE_GROUPS.map((g) => ({ group: g.group, roles: g.roles.filter((r) => r.value !== "owner") })).filter((g) => g.roles.length > 0);

export const assignableRoleValues = (): string[] => ASSIGNABLE_ROLE_GROUPS.flatMap((g) => g.roles.map((r) => r.value));

export interface RoleCatalogEntry {
  value: string;
  label: string;
  group: string;
  department: string;
  memberCount: number;
  summary: RoleSummary;
}

export function roleCatalog(members: TeamMember[]): RoleCatalogEntry[] {
  return ASSIGNABLE_ROLE_GROUPS.flatMap((g) =>
    g.roles.map((r) => ({
      value: r.value,
      label: r.label,
      group: g.group,
      department: departmentForRole(r.value),
      memberCount: members.filter((m) => m.role === r.value).length,
      summary: roleSummary(r.value),
    })),
  );
}

// ── Access activity: the ledger rows that describe team changes ──────────

/** Written by set_tenant_member_role itself; the only team event the server records today. */
export const MEMBER_ROLE_AUDIT_ACTION = "member_role_changed";
/** The optional operator reason from Review & Apply, kept as a note beside the server row. */
export const ROLE_REASON_ENTITY = "tenant_member_role";
export const ACCESS_AUDIT_ACTIONS: readonly string[] = [MEMBER_ROLE_AUDIT_ACTION, "settings_updated"];

export interface AccessAuditRow {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  user_email?: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export const isAccessAuditRow = (row: AccessAuditRow): boolean =>
  row.action === MEMBER_ROLE_AUDIT_ACTION || (row.action === "settings_updated" && row.entity_type === ROLE_REASON_ENTITY);

export interface AccessEvent {
  id: string;
  at: string;
  title: string;
  change: string | null;
  memberId: string | null;
  actor: string | null;
  source: "server" | "note";
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export function describeAccessEvent(row: AccessAuditRow): AccessEvent {
  const d = row.details ?? {};
  const prev = str(d.prev_role);
  const next = str(d.new_role);
  const change = prev || next ? `${prev ? roleDisplayName(prev) : "Unknown"} to ${next ? roleDisplayName(next) : "Unknown"}` : null;
  if (row.action === MEMBER_ROLE_AUDIT_ACTION) {
    return { id: row.id, at: row.created_at, title: "Role changed", change, memberId: row.entity_id, actor: row.user_email ?? null, source: "server" };
  }
  return { id: row.id, at: row.created_at, title: "Change reason recorded", change: str(d.reason) ?? change, memberId: row.entity_id, actor: row.user_email ?? null, source: "note" };
}
