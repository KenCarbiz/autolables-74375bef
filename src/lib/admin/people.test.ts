import { describe, it, expect } from "vitest";
import {
  applyTeamFilters,
  canWriteTeamOnServer,
  capabilityMatrixForRole,
  departmentForRole,
  describeAccessEvent,
  initialsFor,
  invitableRoles,
  isAccessAuditRow,
  normalizeMember,
  parseTeamFilters,
  roleCatalog,
  roleChangeImpact,
  roleSummary,
  teamFiltersToParams,
  teamReturnHref,
} from "./people";

const row = (over: Partial<Parameters<typeof normalizeMember>[0]> = {}) => normalizeMember({
  id: "m1",
  user_id: "u1",
  email: "example.sales@example.test",
  role: "salesperson",
  accepted_at: "2026-10-01T00:00:00Z",
  invited_email: null,
  ...over,
});

describe("member normalization", () => {
  it("derives status from acceptance, never from a stored flag", () => {
    expect(row().status).toBe("active");
    expect(row({ accepted_at: null, user_id: null, email: null, invited_email: "pending@example.test" })).toMatchObject({ status: "invited", email: "pending@example.test" });
  });

  it("derives department from the role group and keeps legacy roles sensible", () => {
    expect(departmentForRole("salesperson")).toBe("Sales");
    expect(departmentForRole("service_advisor")).toBe("Service");
    expect(departmentForRole("office")).toBe("Business Office");
    expect(departmentForRole("general_manager")).toBe("Management");
    expect(departmentForRole("admin")).toBe("Management");
    expect(departmentForRole("staff")).toBe("Sales");
    expect(departmentForRole("viewer")).toBe("Other");
  });

  it("builds initials from the address, never from an invented name", () => {
    expect(initialsFor("example.sales@example.test")).toBe("ES");
    expect(initialsFor("gm@example.test")).toBe("GM");
    expect(initialsFor("")).toBe("?");
  });
});

describe("team filters", () => {
  it("round-trips through the URL and writes only non-default values", () => {
    const f = parseTeamFilters(new URLSearchParams("tab=team&q=sales&dept=Sales&status=invited&sel=m2"));
    expect(f).toEqual({ q: "sales", dept: "Sales", status: "invited", role: "all", sel: "m2" });
    const params = teamFiltersToParams(f, new URLSearchParams("tab=team"));
    expect(params.get("tab")).toBe("team");
    expect(params.get("role")).toBeNull();
    expect(params.get("status")).toBe("invited");
    const clean = teamFiltersToParams({ q: "", dept: "all", status: "all", role: "all", sel: "" }, params);
    expect(clean.toString()).toBe("tab=team");
  });

  it("ignores an unknown status value", () => {
    expect(parseTeamFilters(new URLSearchParams("status=bogus")).status).toBe("all");
  });

  it("filters by search, department, status and role", () => {
    const members = [
      row(),
      row({ id: "m2", email: "svc@example.test", role: "service_advisor" }),
      row({ id: "m3", email: "pending@example.test", role: "office", accepted_at: null }),
    ];
    expect(applyTeamFilters(members, { q: "service", dept: "all", status: "all", role: "all", sel: "" }).map((m) => m.id)).toEqual(["m2"]);
    expect(applyTeamFilters(members, { q: "", dept: "Business Office", status: "all", role: "all", sel: "" }).map((m) => m.id)).toEqual(["m3"]);
    expect(applyTeamFilters(members, { q: "", dept: "all", status: "invited", role: "all", sel: "" }).map((m) => m.id)).toEqual(["m3"]);
    expect(applyTeamFilters(members, { q: "", dept: "all", status: "all", role: "salesperson", sel: "" }).map((m) => m.id)).toEqual(["m1"]);
  });

  it("builds a return address that restores the team tab with its filters", () => {
    expect(teamReturnHref(new URLSearchParams("tab=roles&q=x&sel=m1"))).toBe("/admin?tab=team&q=x&sel=m1");
  });
});

describe("capability matrix", () => {
  it("matches the reference for a salesperson: customers and vehicles read and act, no manage, no dealer policy", () => {
    const m = capabilityMatrixForRole("salesperson");
    const cell = (group: string, id: string) => m.find((g) => g.group === group)!.rows.find((r) => r.id === id)!;
    expect(cell("Customers", "assigned_customers")).toMatchObject({ read: true, act: true, manage: false });
    expect(cell("Vehicles", "inventory")).toMatchObject({ read: true, act: true, manage: false });
    expect(cell("Sharing", "connect_card")).toMatchObject({ read: true, act: true, manage: false });
    expect(cell("Sharing", "passport_share")).toMatchObject({ read: true, act: true, manage: false });
    expect(cell("Dealer policy", "price_rules")).toMatchObject({ read: false, act: false, manage: false });
    expect(cell("Dealer policy", "publishing_policy")).toMatchObject({ read: false, act: false, manage: false });
  });

  it("gives a general manager every cell and a vendor none of the customer cells", () => {
    expect(capabilityMatrixForRole("general_manager").every((g) => g.rows.every((r) => r.read && r.act && r.manage))).toBe(true);
    const vendor = capabilityMatrixForRole("third_party_vendor");
    expect(vendor.find((g) => g.group === "Customers")!.rows[0]).toMatchObject({ read: false, act: false, manage: false });
  });

  it("summarises a salesperson in task language with the two reference restrictions", () => {
    expect(roleSummary("salesperson")).toEqual({
      keyPermissions: ["View assigned customers", "Share employee card", "Share vehicle Passport", "Create follow-up"],
      restricted: ["Change dealer pricing", "Edit publishing policy"],
    });
    expect(roleSummary("general_manager").restricted).toEqual([]);
  });

  it("describes a role change as gained and lost cells", () => {
    const impact = roleChangeImpact("salesperson", "sales_manager");
    expect(impact.lost).toEqual([]);
    expect(impact.gained).toContain("Assigned customers: manage");
    expect(impact.cellsChanged).toBe(impact.gained.length);
    expect(roleChangeImpact("salesperson", "salesperson").cellsChanged).toBe(0);
  });
});

describe("server authority", () => {
  it("mirrors the RPC guard: only owner, admin and general manager write the team", () => {
    expect(canWriteTeamOnServer("owner")).toBe(true);
    expect(canWriteTeamOnServer("general_manager")).toBe(true);
    expect(canWriteTeamOnServer("gsm")).toBe(false);
    expect(canWriteTeamOnServer("manager")).toBe(false);
    expect(canWriteTeamOnServer("salesperson")).toBe(false);
    expect(canWriteTeamOnServer(null, true)).toBe(true);
  });

  it("never offers owner as an invitable role", () => {
    expect(invitableRoles().flatMap((g) => g.roles.map((r) => r.value))).not.toContain("owner");
  });

  it("counts members per catalog role", () => {
    const members = [row(), row({ id: "m2" }), row({ id: "m3", role: "office" })];
    const catalog = roleCatalog(members);
    expect(catalog.find((r) => r.value === "salesperson")?.memberCount).toBe(2);
    expect(catalog.find((r) => r.value === "office")?.memberCount).toBe(1);
    expect(catalog.find((r) => r.value === "gsm")?.memberCount).toBe(0);
  });
});

describe("access activity", () => {
  it("keeps only the server role event and the review reason note", () => {
    expect(isAccessAuditRow({ id: "a", action: "member_role_changed", entity_type: "tenant_member", entity_id: "m1", details: {}, created_at: "2026-10-01T00:00:00Z" })).toBe(true);
    expect(isAccessAuditRow({ id: "b", action: "settings_updated", entity_type: "tenant_member_role", entity_id: "m1", details: {}, created_at: "2026-10-01T00:00:00Z" })).toBe(true);
    expect(isAccessAuditRow({ id: "c", action: "settings_updated", entity_type: "dealer_profile", entity_id: "x", details: {}, created_at: "2026-10-01T00:00:00Z" })).toBe(false);
  });

  it("describes a role change in role labels and a reason note by its reason", () => {
    const change = describeAccessEvent({ id: "a", action: "member_role_changed", entity_type: "tenant_member", entity_id: "m1", user_email: "example.owner@example.test", details: { prev_role: "salesperson", new_role: "sales_manager" }, created_at: "2026-10-01T00:00:00Z" });
    expect(change).toMatchObject({ title: "Role changed", change: "Salesperson to Sales Manager", memberId: "m1", actor: "example.owner@example.test", source: "server" });
    const note = describeAccessEvent({ id: "b", action: "settings_updated", entity_type: "tenant_member_role", entity_id: "m1", details: { reason: "Promoted after review" }, created_at: "2026-10-01T00:00:00Z" });
    expect(note).toMatchObject({ title: "Change reason recorded", change: "Promoted after review", source: "note" });
    expect(describeAccessEvent({ id: "c", action: "member_role_changed", entity_type: null, entity_id: null, details: null, created_at: "2026-10-01T00:00:00Z" }).change).toBeNull();
  });
});
