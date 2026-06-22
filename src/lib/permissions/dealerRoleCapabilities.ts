export type DealerRole =
  | "owner"
  | "general_manager"
  | "admin"
  | "manager"
  | "sales_manager"
  | "salesperson"
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
  | "can_view_platform_admin"
  | "can_manage_automation";

const allDealerCapabilities: DealerCapability[] = [
  "can_view_dashboard",
  "can_view_inventory",
  "can_edit_inventory",
  "can_view_work_queue",
  "can_manage_work_queue",
  "can_view_print_queue",
  "can_approve_print",
  "can_print",
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
  "can_manage_automation",
];

const salesBase: DealerCapability[] = [
  "can_view_dashboard",
  "can_view_inventory",
  "can_view_passport",
  "can_view_leads",
  "can_work_leads",
  "can_view_trade_values",
  "can_view_deals",
];

const inventoryBase: DealerCapability[] = [
  "can_view_dashboard",
  "can_view_inventory",
  "can_edit_inventory",
  "can_view_work_queue",
  "can_manage_work_queue",
  "can_view_print_queue",
  "can_print",
  "can_view_get_ready",
];

const serviceBase: DealerCapability[] = [
  "can_view_work_queue",
  "can_view_get_ready",
  "can_complete_get_ready",
  "can_upload_service_proof",
];

const complianceBase: DealerCapability[] = [
  "can_view_dashboard",
  "can_view_inventory",
  "can_view_work_queue",
  "can_view_print_queue",
  "can_view_deals",
  "can_manage_addons",
  "can_view_compliance",
  "can_manage_compliance",
  "can_view_reports",
];

export const dealerRoleCapabilityMap: Record<string, DealerCapability[]> = {
  owner: allDealerCapabilities,
  general_manager: allDealerCapabilities,
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
  ],
  salesperson: salesBase,
  inventory_manager: [
    ...inventoryBase,
    "can_approve_print",
    "can_view_passport",
    "can_approve_passport_proof",
    "can_view_compliance",
  ],
  service_manager: [
    ...serviceBase,
    "can_manage_work_queue",
    "can_approve_passport_proof",
    "can_view_inventory",
    "can_view_reports",
  ],
  service_advisor: serviceBase,
  detail: ["can_view_work_queue", "can_view_get_ready", "can_complete_get_ready", "can_upload_service_proof"],
  third_party_vendor: ["can_view_work_queue", "can_complete_get_ready", "can_upload_service_proof"],
  office: complianceBase,
  finance: [
    ...complianceBase,
    "can_view_leads",
    "can_view_trade_values",
    "can_manage_deals",
    "can_manage_addons",
  ],
  compliance: complianceBase,
  biller: ["can_view_dashboard", "can_view_deals", "can_view_reports", "can_manage_billing"],
  readonly: ["can_view_dashboard", "can_view_inventory", "can_view_work_queue", "can_view_reports"],
};

export const safeDefaultCapabilities: DealerCapability[] = [
  "can_view_dashboard",
  "can_view_inventory",
  "can_view_work_queue",
];

export const getDealerCapabilities = (role: DealerRole, isPlatformAdmin = false): DealerCapability[] => {
  if (isPlatformAdmin) return [...allDealerCapabilities, "can_view_platform_admin"];
  const normalized = `${role || ""}`.trim().toLowerCase();
  return dealerRoleCapabilityMap[normalized] || safeDefaultCapabilities;
};

export const hasDealerCapability = (role: DealerRole, capability: DealerCapability, isPlatformAdmin = false) =>
  getDealerCapabilities(role, isPlatformAdmin).includes(capability);

export const hasAnyDealerCapability = (role: DealerRole, capabilities: DealerCapability[] | undefined, isPlatformAdmin = false) => {
  if (!capabilities?.length) return true;
  const allowed = new Set(getDealerCapabilities(role, isPlatformAdmin));
  return capabilities.some((capability) => allowed.has(capability));
};

export const roleDisplayName = (role: DealerRole) => {
  const normalized = `${role || "readonly"}`.trim().toLowerCase();
  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};
