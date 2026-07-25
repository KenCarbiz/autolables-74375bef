export type DealerRole =
  | "owner"
  | "general_manager"
  | "gsm"
  | "admin"
  | "manager"
  | "sales_manager"
  | "salesperson"
  | "used_car_manager"
  | "inventory_manager"
  | "service_manager"
  | "service_advisor"
  | "detail"
  | "third_party_vendor"
  | "office"
  | "finance"
  | "compliance"
  | "biller"
  | "readonly"
  | string
  | null
  | undefined;

export type DealerCapability =
  | "can_view_dashboard"
  | "can_view_inventory"
  | "can_edit_inventory"
  | "can_view_work_queue"
  | "can_manage_work_queue"
  | "can_view_print_queue"
  | "can_approve_print"
  | "can_print"
  | "can_create_documents"
  | "can_view_get_ready"
  | "can_complete_get_ready"
  | "can_upload_service_proof"
  | "can_view_passport"
  | "can_approve_passport_proof"
  | "can_view_leads"
  | "can_work_leads"
  | "can_view_trade_values"
  | "can_view_deals"
  | "can_manage_deals"
  | "can_manage_addons"
  | "can_view_compliance"
  | "can_manage_compliance"
  | "can_view_reports"
  | "can_manage_settings"
  | "can_manage_team"
  | "can_manage_billing"
  | "can_manage_invoices"
  | "can_view_platform_admin"
  | "can_manage_automation"
  | "manage_source_authority"
  | "resolve_exceptions"
  | "can_conduct_inspection"
  | "can_assign_service_work"
  | "can_approve_service_work"
  | "can_execute_k208"
  | "can_void_inspection"
  | "can_manage_service_settings";

const allDealerCapabilities: DealerCapability[] = [
  "can_view_dashboard",
  "can_view_inventory",
  "can_edit_inventory",
  "can_view_work_queue",
  "can_manage_work_queue",
  "can_view_print_queue",
  "can_approve_print",
  "can_print",
  "can_create_documents",
  "can_view_get_ready",
  "can_complete_get_ready",
  "can_upload_service_proof",
  "can_view_passport",
  "can_approve_passport_proof",
  "can_view_leads",
  "can_work_leads",
  "can_view_trade_values",
  "can_view_deals",
  "can_manage_deals",
  "can_manage_addons",
  "can_view_compliance",
  "can_manage_compliance",
  "can_view_reports",
  "can_manage_settings",
  "can_manage_team",
  "can_manage_billing",
  "can_manage_invoices",
  "can_manage_automation",
  "manage_source_authority",
  "resolve_exceptions",
  // can_execute_k208 is deliberately ABSENT: signing the K-208 is an explicit,
  // per-dealer grant (settings k208_authority_roles / k208_authorized_users,
  // enforced by public.k208_signer_allowed), never job-title-derived — so not
  // even the all-capability roles carry it by default.
  "can_conduct_inspection",
  "can_assign_service_work",
  "can_approve_service_work",
  "can_void_inspection",
  "can_manage_service_settings",
];

const salesBase: DealerCapability[] = [
  "can_view_dashboard",
  "can_view_inventory",
  "can_view_passport",
  "can_view_leads",
  "can_work_leads",
  "can_view_trade_values",
  "can_view_deals",
  "can_create_documents",
];

const inventoryBase: DealerCapability[] = [
  "can_view_dashboard",
  "can_view_inventory",
  "can_edit_inventory",
  "can_view_work_queue",
  "can_manage_work_queue",
  "can_view_print_queue",
  "can_print",
  "can_create_documents",
  "can_view_get_ready",
];

const serviceBase: DealerCapability[] = [
  "can_view_dashboard",
  "can_view_work_queue",
  "can_view_get_ready",
  "can_complete_get_ready",
  "can_upload_service_proof",
  "can_conduct_inspection",
  "can_assign_service_work",
];

const complianceBase: DealerCapability[] = [
  "can_view_dashboard",
  "can_view_inventory",
  "can_view_work_queue",
  "can_view_print_queue",
  "can_view_deals",
  "can_create_documents",
  "can_manage_addons",
  "can_view_compliance",
  "can_manage_compliance",
  "can_view_reports",
  "manage_source_authority",
  "resolve_exceptions",
];

// Used-Car Director / GSM: full operating visibility, short of owner-only
// billing. Used Car Manager: runs the used desk — inventory + recon + deals +
// merchandising + reports, but not store-wide settings/team/billing.
const gsmCapabilities = allDealerCapabilities.filter((c) => c !== "can_manage_billing");
const usedCarManagerCapabilities: DealerCapability[] = [
  ...salesBase,
  "can_edit_inventory",
  "can_view_work_queue",
  "can_manage_work_queue",
  "can_view_print_queue",
  "can_approve_print",
  "can_print",
  "can_view_get_ready",
  "can_approve_passport_proof",
  "can_manage_deals",
  "can_manage_addons",
  "can_view_compliance",
  "can_view_reports",
  "can_approve_service_work",
];

export const dealerRoleCapabilityMap: Record<string, DealerCapability[]> = {
  owner: allDealerCapabilities,
  general_manager: allDealerCapabilities,
  gsm: gsmCapabilities,
  admin: allDealerCapabilities,
  manager: allDealerCapabilities,
  sales_manager: [
    ...salesBase,
    "can_view_work_queue",
    "can_manage_work_queue",
    "can_view_print_queue",
    "can_approve_print",
    "can_print",
    "can_approve_passport_proof",
    "can_manage_deals",
    "can_manage_addons",
    "can_view_compliance",
    "can_view_reports",
    "can_approve_service_work",
  ],
  salesperson: salesBase,
  used_car_manager: usedCarManagerCapabilities,
  inventory_manager: [
    ...inventoryBase,
    "can_approve_print",
    "can_view_passport",
    "can_approve_passport_proof",
    "can_view_compliance",
    "can_view_reports",
  ],
  service_manager: [
    ...serviceBase,
    "can_manage_work_queue",
    "can_approve_passport_proof",
    "can_view_inventory",
    "can_view_compliance",
    "can_view_reports",
    "can_approve_service_work",
    "can_void_inspection",
    "can_manage_service_settings",
  ],
  service_advisor: serviceBase,
  // The technician job maps onto detail/service_advisor in this role system.
  detail: ["can_view_dashboard", "can_view_work_queue", "can_view_get_ready", "can_complete_get_ready", "can_upload_service_proof", "can_conduct_inspection"],
  third_party_vendor: ["can_view_work_queue", "can_complete_get_ready", "can_upload_service_proof"],
  office: [...complianceBase, "can_manage_invoices"],
  finance: [
    ...complianceBase,
    "can_view_leads",
    "can_view_trade_values",
    "can_manage_deals",
    "can_manage_addons",
    "can_manage_invoices",
  ],
  compliance: complianceBase,
  biller: ["can_view_dashboard", "can_view_deals", "can_view_reports", "can_manage_billing", "can_manage_invoices"],
  readonly: ["can_view_dashboard", "can_view_inventory", "can_view_work_queue", "can_view_reports"],
};

export const safeDefaultCapabilities: DealerCapability[] = [
  "can_view_dashboard",
  "can_view_inventory",
  "can_view_work_queue",
];

// Legacy DB role values (pre-job-roles) map onto a job role so existing
// members keep a sensible access level until they're reassigned.
const LEGACY_ROLE_ALIAS: Record<string, string> = {
  staff: "salesperson",
  sales: "salesperson",
  viewer: "readonly",
  // "manager", "finance", "compliance", "biller", etc. already exist in the map.
};

export const getDealerCapabilities = (role: DealerRole, isPlatformAdmin = false): DealerCapability[] => {
  if (isPlatformAdmin) return [...allDealerCapabilities, "can_view_platform_admin"];
  const normalized = `${role || ""}`.trim().toLowerCase();
  return dealerRoleCapabilityMap[normalized]
    || dealerRoleCapabilityMap[LEGACY_ROLE_ALIAS[normalized]]
    || safeDefaultCapabilities;
};

export const hasDealerCapability = (role: DealerRole, capability: DealerCapability, isPlatformAdmin = false) =>
  getDealerCapabilities(role, isPlatformAdmin).includes(capability);

export const hasAnyDealerCapability = (role: DealerRole, capabilities: DealerCapability[] | undefined, isPlatformAdmin = false) => {
  if (!capabilities?.length) return true;
  const allowed = new Set(getDealerCapabilities(role, isPlatformAdmin));
  return capabilities.some((capability) => allowed.has(capability));
};

// Where each role lands after login — straight into their worklist, not a menu.
const ROLE_HOME: Record<string, string> = {
  owner: "/dashboard",
  admin: "/dashboard",
  general_manager: "/dashboard",
  gsm: "/dashboard",
  manager: "/dashboard",
  sales_manager: "/dashboard",
  salesperson: "/saved",
  used_car_manager: "/inventory",
  inventory_manager: "/inventory",
  service_manager: "/ready-board",
  service_advisor: "/service",
  detail: "/service",
  office: "/titles",
  finance: "/saved",
  compliance: "/compliance",
  biller: "/dashboard",
  readonly: "/dashboard",
  // third_party_vendor holds neither can_view_dashboard nor can_view_inventory;
  // the work queue is the only listed screen its capability set admits.
  third_party_vendor: "/queue",
};

// Fallback for a role with no ROLE_HOME entry — an unrecognised DB value, or a
// role added to the capability map before this one. "/dashboard" was returned
// unconditionally, which sent any role lacking can_view_dashboard to a screen it
// cannot load: RouteCapabilityGuard redirects there, and the three command
// surfaces offer it as the one control on their permission-denied card. The
// fallback is now chosen by capability, so the destination is always reachable.
const HOME_FALLBACK: { path: string; capability: DealerCapability }[] = [
  { path: "/dashboard", capability: "can_view_dashboard" },
  { path: "/inventory", capability: "can_view_inventory" },
  { path: "/queue", capability: "can_view_work_queue" },
];

export const dealerRoleHome = (role: DealerRole, isPlatformAdmin = false): string => {
  if (isPlatformAdmin) return "/dashboard";
  const mapped = ROLE_HOME[`${role || ""}`.trim().toLowerCase()];
  if (mapped) return mapped;
  const allowed = new Set(getDealerCapabilities(role, isPlatformAdmin));
  return HOME_FALLBACK.find((f) => allowed.has(f.capability))?.path ?? "/dashboard";
};

// The job roles a tenant admin can assign in the Team panel, grouped for the
// picker. Legacy roles (manager/staff/sales/finance/viewer/etc.) stay valid in
// the DB for back-compat but are not offered as new assignments.
export const ASSIGNABLE_ROLE_GROUPS: { group: string; roles: { value: string; label: string }[] }[] = [
  { group: "Management", roles: [
    { value: "general_manager", label: "General Manager (GM)" },
    { value: "gsm", label: "Used-Car Director / GSM" },
    { value: "sales_manager", label: "Sales Manager" },
    { value: "used_car_manager", label: "Used Car Manager" },
    { value: "service_manager", label: "Service Manager" },
  ] },
  { group: "Sales", roles: [
    { value: "salesperson", label: "Salesperson" },
  ] },
  { group: "Inventory", roles: [
    { value: "inventory_manager", label: "Inventory Manager" },
  ] },
  { group: "Service", roles: [
    { value: "service_advisor", label: "Service Writer / Advisor" },
  ] },
  { group: "Office", roles: [
    { value: "office", label: "Title Clerk / Office Manager" },
  ] },
  { group: "Administration", roles: [
    { value: "admin", label: "Admin" },
    { value: "owner", label: "Owner" },
  ] },
];

export const roleDisplayName = (role: DealerRole) => {
  const normalized = `${role || "readonly"}`.trim().toLowerCase();
  const labels: Record<string, string> = {
    general_manager: "General Manager",
    gsm: "Used-Car Director / GSM",
    sales_manager: "Sales Manager",
    used_car_manager: "Used Car Manager",
    inventory_manager: "Inventory Manager",
    service_manager: "Service Manager",
    service_advisor: "Service Writer",
    office: "Title Clerk / Office Mgr",
  };
  if (labels[normalized]) return labels[normalized];
  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};
