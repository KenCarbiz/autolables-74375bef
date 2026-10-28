import type { AdminScreenFixture } from "./index";
import { DEFAULT_CONTACT_ROUTING, type CustomerPassportContactSettings, type PassportAgent } from "@/lib/passportRouting";
import type { RoutingFixture } from "@/pages/admin/views/customer/useRoutingDraft";

export const FIXTURE_NOW = Date.parse("2026-10-28T15:00:00Z");

const agent = (id: string, name: string): PassportAgent => ({
  id,
  name,
  title: "Example specialist",
  status: "available",
  manualOverride: "available",
  acceptsPassportLeads: true,
  workingHours: [],
});

const routing: CustomerPassportContactSettings = {
  ...DEFAULT_CONTACT_ROUTING,
  contactMode: "smart_routing",
  showAgentProfile: true,
  salesRotationSettings: { ...DEFAULT_CONTACT_ROUTING.salesRotationSettings, enabled: true, method: "round_robin" },
  escalationRules: { enabled: true, firstResponseSlaMinutes: 5, escalateToBdcAfterMinutes: 5, escalateToManagerAfterMinutes: 10, notifyMethods: ["email"] },
  dealershipDefaultContact: { salesPhone: "", salesEmail: "" },
  bdcSettings: { enabled: true, showBdcAsTeam: true },
  managerFallback: { enabled: true },
  businessHours: [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: "09:00", endTime: "19:00" })),
  timezone: "America/New_York",
};

export const ROUTING_FIXTURE_08: RoutingFixture = {
  routing,
  agents: [agent("example-agent-1", "Example Rivera"), agent("example-agent-2", "Example Chen")],
  stores: [{ id: "example-store-1", name: "Example rooftop" }],
};

export const FIXTURE_08: AdminScreenFixture = {
  tabId: "routing",
  fixture: { label: "08 Customer Contact Routing", now: FIXTURE_NOW, views: { routing: ROUTING_FIXTURE_08 } },
};
