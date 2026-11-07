import type { AdminFixture } from "@/lib/admin/dataSource";
import type { DealerSettings } from "@/contexts/DealerSettingsContext";
import type { CustomerPassportContactSettings, PassportAgent } from "@/lib/passportRouting";
import { DEFAULT_CONTACT_ROUTING } from "@/lib/passportRouting";
import type { AdminScreenFixture } from "./index";
import { FIXTURE_02 } from "./02";

// Wave C, Customer Experience (Contact & Routing, Passport modules, Calls to action). Every name, phone and address is
// invented, uses reserved example domains and 555-01xx numbers, and is never written anywhere. ?state= selects a
// variant: default, empty, invalid, readonly, error, partial, missing, blocked, none.

const NOW = Date.parse("2026-11-07T15:00:00Z");
const brand = FIXTURE_02.fixture.views.brand as Record<string, unknown>;

const agent = (id: string, name: string, title: string, n: number, extra: Partial<PassportAgent> = {}): PassportAgent => ({
  id, name, title, phone: `(555) 010-01${n}0`, smsNumber: `(555) 010-01${n}0`, email: `${id}@example-motors.example`, status: "available", acceptsPassportLeads: true, workingHours: [], ...extra,
});

const AGENTS: PassportAgent[] = [
  agent("alex", "Alex Example", "Sales Consultant", 1),
  agent("jordan", "Jordan Sample", "Sales Consultant", 2),
  agent("riley", "Riley Placeholder", "Internet Specialist", 3, { status: "away" }),
];

const ROUTING: CustomerPassportContactSettings = {
  ...DEFAULT_CONTACT_ROUTING,
  contactMode: "smart_routing",
  showAgentProfile: true,
  dealershipDefaultContact: { salesPhone: "(555) 010-0100", salesEmail: "sales@example-motors.example" },
  bdcSettings: { enabled: true, showBdcAsTeam: true, bdcPhone: "(555) 010-0140", bdcEmail: "bdc@example-motors.example" },
  managerFallback: { enabled: true, managerEmail: "manager@example-motors.example", managerPhone: "(555) 010-0150" },
  escalationRules: { enabled: true, firstResponseSlaMinutes: 5, escalateToBdcAfterMinutes: 5, escalateToManagerAfterMinutes: 10, notifyMethods: ["email"] },
  businessHours: [1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: "09:00", endTime: "19:00" })),
  timezone: "America/New_York",
};

const BASE_SETTINGS: Partial<DealerSettings> = {
  dealer_name: "Example Motors",
  dealer_phone: "(555) 010-0100",
  dealer_address: "100 Example Way, Anytown, ST 00000",
  dealer_hours: "Mon to Sat 9:00 AM to 7:00 PM, Sun closed",
  dealer_timezone: "America/New_York",
  dealer_financing: "yes",
  passport_contact_routing: ROUTING,
  passport_agents: AGENTS,
  passport_rotation_state: {},
  packet_module_defaults: { videos: false },
  history_report_links_enabled: true,
  ingest_auto_publish: true,
  mobile_slideout_cta_variant: "dealer_availability",
};

const withRouting = (r: Partial<CustomerPassportContactSettings>, agents: PassportAgent[] = AGENTS): Partial<DealerSettings> => ({
  passport_contact_routing: { ...ROUTING, ...r } as CustomerPassportContactSettings,
  passport_agents: agents,
});

const fixture = (label: string, views: Record<string, unknown>): AdminFixture => ({ label, now: NOW, views: { brand: { ...brand, settings: BASE_SETTINGS }, ...views } });

const routingFixture = fixture("Contact & Routing (v3)", {
  routing: {
    seeds: {
      empty: withRouting({ ...DEFAULT_CONTACT_ROUTING, dealershipDefaultContact: { salesPhone: "", salesEmail: "" }, bdcSettings: undefined, managerFallback: undefined, businessHours: [], timezone: undefined }, []),
      invalid: withRouting({
        dealershipDefaultContact: { salesPhone: "(555) 010-0100", salesEmail: "sales-at-example" },
        bdcSettings: { enabled: true, showBdcAsTeam: true, bdcEmail: "bdc@" },
        escalationRules: { ...ROUTING.escalationRules, firstResponseSlaMinutes: 0 },
      }),
      partial: withRouting({ bdcSettings: { enabled: true, showBdcAsTeam: true }, managerFallback: { enabled: true } }, [AGENTS[0]]),
      missing: withRouting({ dealershipDefaultContact: { salesPhone: "", salesEmail: "" } }),
    },
  },
});

const modulesFixture = fixture("Passport modules (v3)", {
  "passport-modules": {
    seeds: {
      empty: { packet_module_defaults: {} },
      partial: { packet_module_defaults: { videos: false, photos: false, brochure: false, ownersManual: false, marketValue: false } },
      blocked: { history_report_links_enabled: false },
      invalid: { packet_module_defaults: { videos: false, legacyBanner: false, insights: "no" as unknown as boolean } },
    },
  },
  oem: {
    franchises: [{ brand: "infiniti" }, { brand: "honda" }],
    blocks: [{ tenant_id: null, brand: "honda", reason: "Manufacturer request" }],
  },
});

const ctasFixture = fixture("Calls to action (v3)", {
  ctas: {
    seeds: {
      empty: { sticky_bottom_buttons: { enabled: true, primary_key: "", buttons: [] } },
      none: { sticky_bottom_buttons: { enabled: false, primary_key: "call", buttons: [{ key: "call", label: "Call", enabled: true, order: 1 }] } },
      invalid: {
        sticky_bottom_buttons: {
          enabled: true,
          primary_key: "missing_primary",
          buttons: [
            { key: "call", label: "Call", enabled: true, order: 1 },
            { key: "text", label: "Text", enabled: true, order: 2 },
            { key: "test_drive", label: "Test Drive", enabled: true, order: 3 },
            { key: "todays_price", label: "Today's Price", enabled: true, order: 4 },
            { key: "reserve", label: "Request Vehicle Hold", enabled: true, order: 5, url: "javascript:alert(1)" },
          ],
        },
      },
      partial: {
        dealer_financing: "",
        sticky_bottom_buttons: {
          enabled: true,
          primary_key: "pre_qualified",
          buttons: [
            { key: "call", label: "Call", enabled: true, order: 1 },
            { key: "pre_qualified", label: "Get Pre-Qualified", enabled: true, order: 2 },
          ],
        },
      },
      missing: { dealer_phone: "", dealer_address: "", ...withRouting({ dealershipDefaultContact: { salesPhone: "", salesEmail: "" } }) },
      variant: { sticky_bottom_buttons: { enabled: true, primary_key: "reserve", buttons: [
        { key: "check_availability", label: "Check Availability Today", enabled: true, order: 1 },
        { key: "payment_options", label: "View Payment Options", enabled: true, order: 2 },
        { key: "trade_appraisal", label: "Trade Appraisal", enabled: true, order: 3 },
        { key: "reserve", label: "Request Vehicle Hold", enabled: true, order: 4 },
      ] } },
    },
  },
});

export const WAVE_C_ROUTING_FIXTURES: Record<string, AdminScreenFixture> = {
  "v3-routing": { tabId: "routing", fixture: routingFixture },
  "v3-passport-modules": { tabId: "passport-modules", fixture: modulesFixture },
  "v3-ctas": { tabId: "calls-to-action", fixture: ctasFixture },
};
