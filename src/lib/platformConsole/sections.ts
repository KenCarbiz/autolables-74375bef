// The nine platform sections and their routes. The console lives at
// /platform-console so the accepted /platform-admin screen and its ?tab= deep
// links keep working unchanged; LEGACY_TAB_ALIASES maps every old tab to the
// section that now carries it, for the cutover redirect.

export type ConsoleSectionId =
  | "overview"
  | "stores"
  | "connections"
  | "data"
  | "usage"
  | "access"
  | "templates"
  | "audit"
  | "reliability";

export interface ConsoleSection {
  id: ConsoleSectionId;
  label: string;
  path: string;
}

export const CONSOLE_BASE = "/platform-console";

export const CONSOLE_SECTIONS: readonly ConsoleSection[] = [
  { id: "overview", label: "Overview", path: CONSOLE_BASE },
  { id: "stores", label: "Stores", path: `${CONSOLE_BASE}/stores` },
  { id: "connections", label: "Connections", path: `${CONSOLE_BASE}/connections` },
  { id: "data", label: "Data & jobs", path: `${CONSOLE_BASE}/data` },
  { id: "usage", label: "Usage & billing", path: `${CONSOLE_BASE}/usage` },
  { id: "access", label: "Access", path: `${CONSOLE_BASE}/access` },
  { id: "templates", label: "Templates", path: `${CONSOLE_BASE}/templates` },
  { id: "audit", label: "Audit", path: `${CONSOLE_BASE}/audit` },
  { id: "reliability", label: "Reliability", path: `${CONSOLE_BASE}/reliability` },
] as const;

export const consolePath = {
  overview: () => CONSOLE_BASE,
  incident: (id: string) => `${CONSOLE_BASE}/incidents/${encodeURIComponent(id)}`,
  stores: () => `${CONSOLE_BASE}/stores`,
  store: (id: string) => `${CONSOLE_BASE}/stores/${encodeURIComponent(id)}`,
  connections: () => `${CONSOLE_BASE}/connections`,
  filesCom: () => `${CONSOLE_BASE}/connections/files-com`,
  mapping: () => `${CONSOLE_BASE}/connections/mapping`,
  action: (id: string) => `${CONSOLE_BASE}/actions/${encodeURIComponent(id)}`,
  feeds: () => `${CONSOLE_BASE}/data`,
  importRun: (id: string) => `${CONSOLE_BASE}/data/imports/${encodeURIComponent(id)}`,
  quality: () => `${CONSOLE_BASE}/data/quality`,
  lineage: (id: string) => `${CONSOLE_BASE}/data/vehicles/${encodeURIComponent(id)}`,
  ratings: () => `${CONSOLE_BASE}/data/ratings`,
  usage: () => `${CONSOLE_BASE}/usage`,
  billing: () => `${CONSOLE_BASE}/usage/billing`,
  access: () => `${CONSOLE_BASE}/access`,
  templates: () => `${CONSOLE_BASE}/templates`,
  audit: () => `${CONSOLE_BASE}/audit`,
  reliability: () => `${CONSOLE_BASE}/reliability`,
  monitoring: () => `${CONSOLE_BASE}/reliability/monitoring`,
};

/** Old /platform-admin?tab= values and where their content lives in the console. */
export const LEGACY_TAB_ALIASES: Record<string, string> = {
  health: consolePath.reliability(),
  tenants: consolePath.stores(),
  members: consolePath.access(),
  entitlements: consolePath.billing(),
  audit: consolePath.audit(),
  recalls: consolePath.feeds(),
  billing: consolePath.billing(),
  stripe: consolePath.billing(),
  templates: consolePath.templates(),
  "passport-engagement": consolePath.reliability(),
  "api-usage": consolePath.usage(),
  budgets: consolePath.usage(),
};

/** Which section tab is active for a console pathname. Child routes keep their parent section. */
export function sectionForPath(pathname: string): ConsoleSectionId {
  const rest = pathname.startsWith(CONSOLE_BASE) ? pathname.slice(CONSOLE_BASE.length) : pathname;
  const head = rest.split("/").filter(Boolean)[0] ?? "";
  switch (head) {
    case "":
    case "incidents":
      return "overview";
    case "stores":
      return "stores";
    case "connections":
    case "actions":
      return "connections";
    case "data":
      return "data";
    case "usage":
      return "usage";
    case "access":
      return "access";
    case "templates":
      return "templates";
    case "audit":
      return "audit";
    case "reliability":
      return "reliability";
    default:
      return "overview";
  }
}
