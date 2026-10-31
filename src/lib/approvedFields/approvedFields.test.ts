import { describe, it, expect } from "vitest";
import {
  COMPLIANCE_ISSUE_SOURCES,
  certificationIssueKey,
  complianceIssueKey,
  isComplianceIssueKey,
  parseComplianceIssueKey,
  vehicleIssueKey,
} from "./complianceIssueKey";
import {
  UNASSIGNED_LABEL,
  assignComplianceOwner,
  canAssignComplianceOwners,
  complianceOwnerLabel,
  fetchComplianceOwners,
  isEligibleComplianceOwnerRole,
  type DbClient,
} from "./complianceOwners";
import {
  NO_DUE_DATE_LABEL,
  canSetPrepDue,
  effectivePrepDue,
  fetchPrepDefaultDays,
  fetchPrepDueDates,
  formatPrepDue,
  parsePrepDefaultDays,
  prepDefaultDaysFromSettings,
  prepDueState,
} from "./prepDue";
import { DEAL_NUMBER_NOT_ENTERED, displayDealNumber, fetchDealNumbers, normalizeDealNumber, setDealNumber } from "./dealNumber";
import {
  REPAIR_APPROVAL_HELP,
  REPAIR_APPROVAL_LABEL,
  canSetRepairApproval,
  fetchRepairApprovals,
  repairApprovalLabel,
  setRepairApproval,
  toRepairApproval,
} from "./repairApproval";
import { fetchPlatformVehicleCounts, vehicleCountLabel } from "./platformVehicleCounts";
import { derivePrepNextAction } from "./prepNextAction";
import { formatSyncRunId } from "./syncRunId";
import { NOT_AVAILABLE_YET, isSchemaUnavailable, readOptional } from "./optionalSchema";

type Answer = { data: unknown; error: { code?: string; message?: string } | null };

// A stand-in for the Supabase client: every builder method returns the
// builder, and awaiting it yields the scripted answer.
function fakeClient(answer: Answer | (() => never), calls: string[] = []) {
  const builder: Record<string, unknown> = {};
  const settle = () => (typeof answer === "function" ? answer() : answer);
  for (const m of ["select", "eq", "in", "order", "limit", "update"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push(`${m}:${JSON.stringify(args)}`);
      return builder;
    };
  }
  builder.maybeSingle = () => builder;
  builder.then = (resolve: (v: Answer) => unknown, reject: (e: unknown) => unknown) => {
    try {
      return Promise.resolve(settle()).then(resolve, reject);
    } catch (e) {
      return Promise.reject(e).then(resolve, reject);
    }
  };
  return {
    from: (t: string) => {
      calls.push(`from:${t}`);
      return builder;
    },
    rpc: (fn: string, args?: unknown) => {
      calls.push(`rpc:${fn}:${JSON.stringify(args ?? null)}`);
      return builder;
    },
  } as unknown as DbClient;
}

const MISSING = {
  table: { code: "42P01", message: 'relation "public.compliance_issue_owners" does not exist' },
  tableCache: { code: "PGRST205", message: "Could not find the table 'public.compliance_issue_owners' in the schema cache" },
  column: { code: "42703", message: "column addendums.deal_number does not exist" },
  fn: { code: "PGRST202", message: "Could not find the function public.platform_vehicle_counts without parameters in the schema cache" },
};

describe("compliance issue key", () => {
  it("is source:rowId with an optional normalised part", () => {
    expect(complianceIssueKey("vehicle_exceptions", "abc-123")).toBe("vehicle_exceptions:abc-123");
    expect(certificationIssueKey("v1", "Price Verified!")).toBe("ct_mvp_certification_runs:v1:price_verified");
    expect(certificationIssueKey("v1", null)).toBe("ct_mvp_certification_runs:v1:not_ready");
    expect(vehicleIssueKey("9b2f")).toBe("vehicle_listings:9b2f");
  });

  it("covers exactly the seven sources the Compliance Center reads", () => {
    expect([...COMPLIANCE_ISSUE_SOURCES].sort()).toEqual([
      "advertised_prices", "ct_mvp_certification_runs", "recall_service_tasks", "stale_document_flags",
      "vehicle_documents", "vehicle_exceptions", "vehicle_listings",
    ]);
  });

  it("refuses unknown sources, empty or unsafe ids and over-long keys", () => {
    expect(() => complianceIssueKey("leads" as never, "x")).toThrow();
    expect(() => complianceIssueKey("vehicle_listings", " ")).toThrow();
    expect(() => complianceIssueKey("vehicle_listings", "a b")).toThrow();
    expect(() => complianceIssueKey("vehicle_listings", "a".repeat(201))).toThrow();
    expect(isComplianceIssueKey("leads:1")).toBe(false);
  });

  it("round-trips through parse", () => {
    expect(parseComplianceIssueKey("ct_mvp_certification_runs:v1:price_verified")).toEqual({
      source: "ct_mvp_certification_runs", sourceRowId: "v1", part: "price_verified",
    });
    expect(parseComplianceIssueKey("nope")).toBeNull();
  });
});

describe("schema fallback", () => {
  it("recognises a database without the migration", () => {
    for (const e of Object.values(MISSING)) expect(isSchemaUnavailable(e)).toBe(true);
    expect(isSchemaUnavailable({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isSchemaUnavailable(null)).toBe(false);
  });

  it("degrades each new read to unavailable without throwing", async () => {
    expect(await fetchComplianceOwners(fakeClient({ data: null, error: MISSING.table }), "t1")).toEqual({ status: "unavailable" });
    expect(await fetchComplianceOwners(fakeClient({ data: null, error: MISSING.tableCache }), "t1")).toEqual({ status: "unavailable" });
    expect(await fetchDealNumbers(fakeClient({ data: null, error: MISSING.column }), ["a1"])).toEqual({ status: "unavailable" });
    expect(await fetchPrepDueDates(fakeClient({ data: null, error: { code: "42703", message: "column prep_sign_offs.due_at does not exist" } }), ["p1"])).toEqual({ status: "unavailable" });
    expect(await fetchRepairApprovals(fakeClient({ data: null, error: { code: "42703", message: "column safety_inspection_item_failures.repair_approval does not exist" } }), ["f1"])).toEqual({ status: "unavailable" });
    expect(await fetchPlatformVehicleCounts(fakeClient({ data: null, error: MISSING.fn }))).toEqual({ status: "unavailable" });
  });

  it("keeps a real error distinct from a missing schema, and survives a thrown transport error", async () => {
    expect(await fetchPlatformVehicleCounts(fakeClient({ data: null, error: { code: "42501", message: "platform admin required" } }))).toEqual({
      status: "error", code: "42501", message: "platform admin required",
    });
    const thrown = await readOptional(() => { throw new Error("network down"); }, (d) => d);
    expect(thrown).toEqual({ status: "error", code: null, message: "network down" });
  });

  it("reads only the new column in its own query, never alongside existing columns", async () => {
    const calls: string[] = [];
    await fetchDealNumbers(fakeClient({ data: [], error: null }, calls), ["a1"]);
    await fetchPrepDueDates(fakeClient({ data: [], error: null }, calls), ["p1"]);
    expect(calls.filter((c) => c.startsWith("select:"))).toEqual(['select:["id, deal_number"]', 'select:["id, due_at"]']);
  });

  it("skips the network for an empty id list", async () => {
    const calls: string[] = [];
    expect(await fetchDealNumbers(fakeClient({ data: [], error: null }, calls), [])).toEqual({ status: "available", data: new Map() });
    expect(calls).toEqual([]);
  });

  it("reports a write against a missing schema as not available yet", async () => {
    const r = await setDealNumber(fakeClient({ data: null, error: MISSING.column }), "a1", "D-1");
    expect(r).toEqual({ ok: false, reason: "unavailable", message: NOT_AVAILABLE_YET });
  });
});

describe("compliance owner", () => {
  it("defaults to Unassigned and names a former member honestly", () => {
    expect(complianceOwnerLabel(undefined, () => "x")).toBe(UNASSIGNED_LABEL);
    expect(complianceOwnerLabel({ ownerUserId: null }, () => "x")).toBe("Unassigned");
    expect(complianceOwnerLabel({ ownerUserId: "u1" }, () => "Dana Reyes")).toBe("Dana Reyes");
    expect(complianceOwnerLabel({ ownerUserId: "u1" }, () => null)).toBe("Former team member");
  });

  it("follows the capability map for who may assign and who may own", () => {
    expect(canAssignComplianceOwners("compliance")).toBe(true);
    expect(canAssignComplianceOwners("general_manager")).toBe(true);
    expect(canAssignComplianceOwners("salesperson")).toBe(false);
    expect(canAssignComplianceOwners("service_manager")).toBe(false);
    expect(isEligibleComplianceOwnerRole("service_manager")).toBe(true);
    expect(isEligibleComplianceOwnerRole("salesperson")).toBe(false);
  });

  it("maps current rows by issue key", async () => {
    const r = await fetchComplianceOwners(
      fakeClient({ data: [{ issue_key: "vehicle_listings:v1", owner_user_id: "u1", assigned_by: "m1", assigned_at: "2026-10-31T12:00:00Z" }], error: null }),
      "t1",
    );
    expect(r.status === "available" && r.data.get("vehicle_listings:v1")?.ownerUserId).toBe("u1");
  });

  it("assigns through the RPC, including unassign, and maps refusals", async () => {
    const calls: string[] = [];
    const ok = await assignComplianceOwner(fakeClient({ data: { ok: true, changed: true }, error: null }, calls), {
      tenantId: "t1", issueKey: "vehicle_listings:v1", ownerUserId: null,
    });
    expect(ok).toEqual({ ok: true, data: { changed: true } });
    expect(calls).toContain('rpc:assign_compliance_issue_owner:{"p_tenant_id":"t1","p_issue_key":"vehicle_listings:v1","p_owner_user_id":null}');
    const denied = await assignComplianceOwner(fakeClient({ data: null, error: { code: "42501", message: "not authorized to assign compliance owners" } }), {
      tenantId: "t1", issueKey: "vehicle_listings:v1", ownerUserId: "u2",
    });
    expect(denied).toMatchObject({ ok: false, reason: "not_authorized" });
    const ineligible = await assignComplianceOwner(fakeClient({ data: null, error: { code: "23514", message: "owner must be an accepted member" } }), {
      tenantId: "t1", issueKey: "vehicle_listings:v1", ownerUserId: "u3",
    });
    expect(ineligible).toMatchObject({ ok: false, reason: "invalid" });
    expect(await assignComplianceOwner(fakeClient({ data: null, error: null }), { tenantId: "t1", issueKey: "bad", ownerUserId: null })).toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("prep due date", () => {
  it("renders in the dealership's time zone, not the viewer's", () => {
    const iso = "2026-11-02T03:30:00Z";
    expect(formatPrepDue(iso, "America/New_York")).toBe("Nov 1, 10:30 PM EST");
    expect(formatPrepDue(iso, "America/Los_Angeles")).toBe("Nov 1, 7:30 PM PST");
    expect(formatPrepDue(iso, "UTC")).toBe("Nov 2, 3:30 AM UTC");
    expect(formatPrepDue(null, "UTC")).toBe(NO_DUE_DATE_LABEL);
    expect(formatPrepDue(iso, "Not/AZone")).toMatch(/^Nov [12], /);
  });

  it("uses a set due date first, then the settings default, else none", () => {
    expect(effectivePrepDue({ due_at: "2026-11-05T00:00:00Z", created_at: "2026-11-01T00:00:00Z" }, 2)).toEqual({ dueAt: "2026-11-05T00:00:00Z", source: "set" });
    expect(effectivePrepDue({ due_at: null, created_at: "2026-11-01T00:00:00.000Z" }, 2)).toEqual({ dueAt: "2026-11-03T00:00:00.000Z", source: "default" });
    expect(effectivePrepDue({ due_at: null, created_at: "2026-11-01T00:00:00Z" }, null)).toEqual({ dueAt: null, source: "none" });
  });

  it("reads the optional default from dealer settings", () => {
    expect(prepDefaultDaysFromSettings({ prep_default_due_days: 3 })).toBe(3);
    expect(prepDefaultDaysFromSettings({ prep_default_due_days: "5" })).toBe(5);
    expect(prepDefaultDaysFromSettings({})).toBeNull();
    expect(parsePrepDefaultDays(0)).toBeNull();
    expect(parsePrepDefaultDays(1.5)).toBeNull();
    expect(parsePrepDefaultDays(366)).toBeNull();
  });

  it("degrades the settings default read like any other", async () => {
    expect(await fetchPrepDefaultDays(fakeClient({ data: { settings: { prep_default_due_days: 4 } }, error: null }), "t1")).toEqual({ status: "available", data: 4 });
    expect(await fetchPrepDefaultDays(fakeClient({ data: null, error: null }), "t1")).toEqual({ status: "available", data: null });
  });

  it("classifies due state and gates edits to work-queue managers", () => {
    const now = Date.parse("2026-11-01T12:00:00Z");
    expect(prepDueState("2026-11-01T11:00:00Z", now)).toBe("overdue");
    expect(prepDueState("2026-11-02T06:00:00Z", now)).toBe("due_soon");
    expect(prepDueState("2026-11-05T06:00:00Z", now)).toBe("on_track");
    expect(prepDueState(null, now)).toBe("none");
    expect(canSetPrepDue("service_manager")).toBe(true);
    expect(canSetPrepDue("detail")).toBe(false);
  });
});

describe("prep next action", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  it("derives one next step from the existing status fields", () => {
    expect(derivePrepNextAction({ status: "pending", inspection_passed: false }).key).toBe("complete_inspection");
    expect(derivePrepNextAction({ status: "pending", inspection_passed: true }).label).toBe("Foreman sign-off");
    expect(derivePrepNextAction({ status: "rejected", rejection_reason: "Missing mats" }).label).toBe("Resolve rejection: Missing mats");
    expect(derivePrepNextAction({ status: "rejected" }).label).toBe("Resolve rejection");
    expect(derivePrepNextAction({ status: "signed", listing_unlocked: false }).key).toBe("unlock_listing");
    expect(derivePrepNextAction({ status: "signed", listing_unlocked: true })).toEqual({ key: "none", label: "No action needed", overdue: false });
    expect(derivePrepNextAction({ status: "overridden", listing_unlocked: true }).key).toBe("none");
  });

  it("flags overdue only while work remains", () => {
    expect(derivePrepNextAction({ status: "pending" }, { dueAt: "2026-11-01T00:00:00Z", now }).overdue).toBe(true);
    expect(derivePrepNextAction({ status: "signed", listing_unlocked: true }, { dueAt: "2026-11-01T00:00:00Z", now }).overdue).toBe(false);
    expect(derivePrepNextAction({ status: "pending" }, { dueAt: null, now }).overdue).toBe(false);
  });
});

describe("deal number", () => {
  it("shows Not entered when there is no DMS number and never invents one", () => {
    expect(displayDealNumber(null)).toBe(DEAL_NUMBER_NOT_ENTERED);
    expect(displayDealNumber("   ")).toBe("Not entered");
    expect(displayDealNumber(" D-1042 ")).toBe("D-1042");
  });

  it("normalises input and caps the length", () => {
    expect(normalizeDealNumber("  12  34 ")).toEqual({ value: "12 34", error: null });
    expect(normalizeDealNumber("")).toEqual({ value: null, error: null });
    expect(normalizeDealNumber("x".repeat(65)).error).toMatch(/64/);
  });

  it("writes the normalised value, or null to clear", async () => {
    const calls: string[] = [];
    expect(await setDealNumber(fakeClient({ data: null, error: null }, calls), "a1", "  D-9 ")).toEqual({ ok: true, data: { dealNumber: "D-9" } });
    expect(calls).toContain('update:[{"deal_number":"D-9"}]');
    expect(await setDealNumber(fakeClient({ data: null, error: null }), "a1", "")).toEqual({ ok: true, data: { dealNumber: null } });
  });
});

describe("repair approval", () => {
  it("labels the three explicit states and says what it is not", () => {
    expect(REPAIR_APPROVAL_LABEL).toEqual({ pending: "Pending", approved: "Approved", not_approved: "Not approved" });
    expect(REPAIR_APPROVAL_HELP).toBe("Internal service-manager authorization, not customer consent");
    expect(toRepairApproval(undefined)).toBe("pending");
    expect(repairApprovalLabel("garbage")).toBe("Pending");
  });

  it("follows can_approve_service_work", () => {
    expect(canSetRepairApproval("service_manager")).toBe(true);
    expect(canSetRepairApproval("service_advisor")).toBe(false);
    expect(canSetRepairApproval("detail")).toBe(false);
  });

  it("reads who decided and when, and sets through the RPC", async () => {
    const r = await fetchRepairApprovals(
      fakeClient({ data: [{ id: "f1", repair_approval: "approved", repair_approval_by: "m1", repair_approval_at: "2026-10-31T10:00:00Z" }], error: null }),
      ["f1"],
    );
    expect(r.status === "available" && r.data.get("f1")).toEqual({ approval: "approved", decidedBy: "m1", decidedAt: "2026-10-31T10:00:00Z" });
    const calls: string[] = [];
    const set = await setRepairApproval(fakeClient({ data: { ok: true, repair_approval: "not_approved", repair_approval_by: "m1", repair_approval_at: "2026-10-31T11:00:00Z" }, error: null }, calls), "f1", "not_approved");
    expect(set).toEqual({ ok: true, data: { approval: "not_approved", decidedBy: "m1", decidedAt: "2026-10-31T11:00:00Z" } });
    expect(calls).toContain('rpc:set_repair_approval:{"p_failure_id":"f1","p_decision":"not_approved"}');
    expect(await setRepairApproval(fakeClient({ data: null, error: null }), "f1", "maybe" as never)).toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("platform vehicle counts", () => {
  it("maps aggregate rows per dealership", async () => {
    const r = await fetchPlatformVehicleCounts(fakeClient({ data: [{ tenant_id: "t1", active_vehicles: 1340 }, { tenant_id: "t2", active_vehicles: 0 }], error: null }));
    expect(r.status === "available" && [...r.data.entries()]).toEqual([["t1", 1340], ["t2", 0]]);
    expect(vehicleCountLabel(r, "t1")).toBe("1,340 active");
    expect(vehicleCountLabel({ status: "unavailable" }, "t1")).toBe("—");
  });
});

describe("sync run id", () => {
  it("shows the first eight hex digits of the run uuid", () => {
    expect(formatSyncRunId("3f2a9c1b-0d4e-4b7a-9e21-55aa00bb11cc")).toBe("Run 3F2A9C1B");
    expect(formatSyncRunId(null)).toBe("—");
    expect(formatSyncRunId("")).toBe("—");
  });
});
