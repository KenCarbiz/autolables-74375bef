import type { AdminScreenFixture } from "./index";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import { MEMBER_ROLE_AUDIT_ACTION } from "@/lib/admin/people";
import type { PeopleFixture } from "@/pages/admin/views/people/useTeamMembers";
import type { RoutingFixture } from "@/pages/admin/views/customer/useRoutingDraft";
import { DEFAULT_CONTACT_ROUTING } from "@/lib/passportRouting";
import type { AccessActivityFixture } from "@/pages/admin/children/AccessActivityPage";
import type { PermissionVerificationFixture } from "@/pages/admin/children/PermissionVerificationPage";
import type { LegacyAssignmentsFixture } from "@/pages/admin/children/LegacyAssignmentsPage";
import type { ConnectionsFixture } from "@/pages/admin/children/ConnectionsBillingPage";
import type { WorkerSetupFixture } from "@/pages/admin/children/WorkerSetupPage";

// AL97 screens 11, 12, 15, 16, 18, 19 and 20. Synthetic design fixtures only:
// names, events, counts and times are invented for the parity harness, are
// labelled synthetic on screen, and are never written anywhere.

const NOW = Date.parse("2026-10-31T18:00:00Z");
const ACCOUNT = "Harte Auto Group";
const STORE = "Harte INFINITI";
const label = (id: string) => ({ "fixture.label": "PROPOSED TARGET · SYNTHETIC DESIGN FIXTURE · NOT A LIVE SCREENSHOT", "fixture.id": `AL97 / ${id}` });
const screen = (childPath: string, label: string, views: Record<string, unknown>): AdminScreenFixture => ({ childPath, fixture: { label, now: NOW, views } });

const people: PeopleFixture = {
  members: [],
  activity: [{ id: "ev-1", action: MEMBER_ROLE_AUDIT_ACTION, entity_type: "tenant_member", entity_id: "m-1", user_email: "Platform admin", details: { prev_role: "sales", new_role: "manager" }, created_at: "2026-10-31T13:12:00Z" }],
};

export const AL97_11 = screen(ADMIN_CHILD_ROUTES.accessActivity, "AL97 11 Access activity", {
  people,
  "al97-access": {
    account: ACCOUNT, store: STORE, scope: "Store A",
    targets: [
      { id: "t1", at: "2026-10-31T13:20:00Z", action: "Invitation created", actor: "Store owner" },
      { id: "t2", at: "2026-10-31T13:25:00Z", action: "Invitation revoked", actor: "Store owner" },
      { id: "t3", at: "2026-10-31T13:30:00Z", action: "Member removed", actor: "Platform admin" },
    ],
  } satisfies AccessActivityFixture,
  "al97-copy": { "access.target": "Target event", "access.note": "Synthetic event examples; target events are not represented as existing production history." },
});

export const AL97_19 = screen(ADMIN_CHILD_ROUTES.permissionVerification, "AL97 19 Permission verification", {
  "al97-permissions": { account: ACCOUNT, store: STORE } satisfies PermissionVerificationFixture,
  "al97-copy": { "permissions.restricted": "Not run" },
});

export const AL97_12 = screen(ADMIN_CHILD_ROUTES.contactRouting, "AL97 12 Contact and routing", {
  routing: {
    account: ACCOUNT, store: STORE,
    routing: {
      ...DEFAULT_CONTACT_ROUTING,
      contactMode: "smart_routing",
      salesRotationSettings: { ...DEFAULT_CONTACT_ROUTING.salesRotationSettings, respectCrmOwnership: true },
      dealershipDefaultContact: { salesPhone: "", salesEmail: "" },
      managerFallback: { enabled: false },
      escalationRules: { ...DEFAULT_CONTACT_ROUTING.escalationRules, enabled: true, firstResponseSlaMinutes: 5 },
      businessHours: [],
      timezone: "America/New_York",
    },
    agents: [],
    stores: [{ id: "st-1", name: STORE }],
  } satisfies RoutingFixture & { account: string; store: string },
  "al97-copy": { "routing.noAgent": "No synthetic person selected" },
});

export const AL97_15 = screen(ADMIN_CHILD_ROUTES.legacyAssignments, "AL97 15 Review legacy store assignments", {
  "al97-assignments": {
    account: ACCOUNT, store: STORE, tenantTotal: 330,
    sets: [
      { id: "a", set: "Legacy set A", candidate: "Harte INFINITI", evidence: "Matching owned listing + source history", outcome: { label: "Proposed", tone: "blue" } },
      { id: "b", set: "Legacy set B", candidate: "Unresolved", evidence: "VIN appears in multiple ownership episodes", outcome: { label: "Manual review", tone: "amber" } },
      { id: "signed", set: "Signed history", candidate: "Original seller retained", evidence: "Signed legal identity", outcome: { label: "Never rewritten", tone: "neutral" } },
    ],
    reviewed: ["Store identity validated", "Tenant boundary checked"],
  } satisfies LegacyAssignmentsFixture,
  "al97-copy": { "assign.note": "Illustrative sets only; do not claim an actual eligible count until computed." },
});

export const AL97_16 = screen(ADMIN_CHILD_ROUTES.connections, "AL97 16 Connections and billing", {
  "al97-connections": {
    account: ACCOUNT, store: STORE,
    files: { arrivals: true, importMode: "manual", lastImport: "succeeded" },
    marketcheck: { scheduled: true, paused: true, lastOutcome: "refused_quota" },
    billing: { entitlement: { status: "active", planTier: "compliance_pro", override: true }, events: 0, lastSync: null },
    crawl: "paused",
  } satisfies ConnectionsFixture,
  "al97-copy": { "billing.entitlementLabel": "Harte entitlement" },
});

export const AL97_18 = screen(ADMIN_CHILD_ROUTES.workerSetup, "AL97 18 Worker setup change review", {
  "al97-worker": { account: ACCOUNT, store: STORE, workerSchedule: "not_found" } satisfies WorkerSetupFixture,
  "al97-copy": { "worker.subtitle": "Proposed operation · not authorized by this handoff", "worker.none": "None found in inspection", ...label("18") },
});
