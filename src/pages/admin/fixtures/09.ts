import type { AdminScreenFixture } from "./index";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import type { EscalationFixture } from "@/pages/admin/children/EscalationPage";
import type { RoutingFixture } from "@/pages/admin/views/customer/useRoutingDraft";
import { FIXTURE_NOW, ROUTING_FIXTURE_08 } from "./08";

const ROUTING_FIXTURE_09: RoutingFixture = {
  ...ROUTING_FIXTURE_08,
  stores: [
    { id: "example-store-1", name: "Example rooftop" },
    { id: "example-store-2", name: "Second rooftop" },
  ],
};

// Two example notifications, as the reference draws: one the sender refused,
// one it accepted. Rows recorded before outcomes were tracked are covered by
// the page test with its own row.
const ESCALATION_FIXTURE_09: EscalationFixture = {
  activity: [
    {
      id: "example-audit-1",
      action: "customer_passport_escalation_failed",
      entity_id: "0a1b2c3d-0000-4000-8000-00000000000a",
      created_at: "2026-10-28T14:14:00Z",
      details: { level: 1, to: "BDC desk", unanswered_minutes: 7, outcome: "failed", method: "email", http_status: 502, store_id: "example-store-1" },
    },
    {
      id: "example-audit-2",
      action: "customer_passport_escalated",
      entity_id: "1b2c3d4e-0000-4000-8000-00000000000b",
      created_at: "2026-10-28T14:03:00Z",
      details: { level: 2, to: "Sales manager", unanswered_minutes: 12, outcome: "accepted", method: "email", http_status: 202, store_id: "example-store-2" },
    },
  ],
};

export const FIXTURE_09: AdminScreenFixture = {
  childPath: ADMIN_CHILD_ROUTES.escalation,
  fixture: {
    label: "09 Escalation Delivery Child",
    now: FIXTURE_NOW,
    views: { routing: ROUTING_FIXTURE_09, escalation: ESCALATION_FIXTURE_09 },
  },
};
