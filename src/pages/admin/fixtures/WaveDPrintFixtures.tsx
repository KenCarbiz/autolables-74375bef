import type { AdminScreenFixture } from "./index";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import type { PrintFixture } from "@/pages/admin/views/documents/print/usePrintProfiles";
import type { CatalogFixture } from "@/pages/admin/views/documents/catalog/useServiceCatalog";
import type { PeopleFixture } from "@/pages/admin/views/people/useTeamMembers";

// Design fixtures for Print & Calibration (profiles and the Set up printer wizard) and the Service catalog.
// Every name is invented and uses reserved example domains; nothing here is written anywhere and no request is
// made. ?state= selects a variant: default, empty, invalid, readonly, error, blocked. The wizard also takes
// ?step=1 to 4.

const NOW = Date.parse("2026-11-07T15:00:00Z");

const print: PrintFixture = {
  tenantName: "Example Auto Group",
  rooftops: [
    { id: "example-rooftop-honda", name: "Example Honda", city: "Example City", state: "ST" },
    { id: "example-rooftop-toyota", name: "Example Toyota", city: "Example City", state: "ST" },
    { id: "example-rooftop-used", name: "Example Used Cars", city: "Example City", state: "ST" },
  ],
  rows: [
    {
      id: "example-profile-default", location_id: null, printer_name: "Example finance office printer", label_mode: "white",
      x_offset_inches: 0.04, y_offset_inches: -0.02, scale_percentage: 100, top_safe_margin_inches: 0.25, left_safe_margin_inches: 0.25,
      show_crop_marks: false, show_safe_area: false, updated_at: "2026-11-03T14:00:00Z",
    },
    {
      id: "example-profile-honda", location_id: "example-rooftop-honda", printer_name: "Example service desk printer", label_mode: "white",
      x_offset_inches: 0, y_offset_inches: 0, scale_percentage: 100, top_safe_margin_inches: 0.25, left_safe_margin_inches: 0.25,
      show_crop_marks: false, show_safe_area: false, updated_at: "2026-10-21T19:40:00Z",
    },
  ],
};

const catalog: CatalogFixture = {
  tenantName: "Example Auto Group",
  photoTasks: "Example mud flaps installed, Example running boards installed",
  services: [
    { name: "Example reconditioning", responsible_name: "Example service department", responsible_email: "service@example.com", cost: "150" },
    { name: "Example emissions check", responsible_name: "Example lot attendant", responsible_email: "", cost: "45.50" },
    { name: "Example mud flaps installed", responsible_name: "Example detail vendor", responsible_email: "vendor@example.com", cost: "85" },
    { name: "Example key cut", responsible_name: "", responsible_email: "", cost: "" },
  ],
};

const people: PeopleFixture = {
  members: [
    { id: "example-member-1", user_id: "example-user-1", email: "service.manager@example.com", role: "service_manager", accepted_at: "2026-01-10T12:00:00Z", invited_email: null },
    { id: "example-member-2", user_id: "example-user-2", email: "general.manager@example.com", role: "general_manager", accepted_at: "2026-01-10T12:00:00Z", invited_email: null },
    { id: "example-member-3", user_id: "example-user-3", email: "detail.lead@example.com", role: "detail", accepted_at: "2026-02-04T12:00:00Z", invited_email: null },
  ],
};

export const WAVE_D_PRINT_FIXTURES: Record<string, AdminScreenFixture> = {
  "v3-print-profiles": { tabId: "print-calibration", fixture: { label: "Print profiles (v3)", now: NOW, views: { "print-profiles": print } } },
  "v3-print-wizard": { childPath: ADMIN_CHILD_ROUTES.printCalibration, fixture: { label: "Set up printer (v3)", now: NOW, views: { "print-profiles": print } } },
  "v3-service-catalog": { childPath: ADMIN_CHILD_ROUTES.serviceCatalog, fixture: { label: "Service catalog (v3)", now: NOW, views: { "service-catalog": catalog, people } } },
};
