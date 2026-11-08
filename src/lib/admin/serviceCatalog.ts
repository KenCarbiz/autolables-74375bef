import type { GetReadyService } from "@/contexts/DealerSettingsContext";

export const CATALOG_CURRENCY = "USD";
export const COST_MAX = 100000;
export const NAME_MAX = 80;

export interface ServiceDraft {
  name: string;
  responsible_name: string;
  responsible_email: string;
  cost: string;
}

export type ServiceErrors = Partial<Record<keyof ServiceDraft, string>>;

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const COST = /^\d{1,6}(\.\d{1,2})?$/;

export const emptyServiceDraft = (): ServiceDraft => ({ name: "", responsible_name: "", responsible_email: "", cost: "" });

export const normalizeCost = (raw: string): string => raw.trim().replace(/^\$/, "").replace(/,/g, "").trim();

export const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Validates one catalog entry against the others. `editingName` is the entry being edited, excluded from the duplicate check. */
export function validateService(draft: ServiceDraft, all: readonly GetReadyService[], editingName: string | null): ServiceErrors {
  const errors: ServiceErrors = {};
  const name = draft.name.trim();
  if (!name) errors.name = "Enter the service name.";
  else if (name.length > NAME_MAX) errors.name = `Use ${NAME_MAX} characters or fewer.`;
  else if (all.some((s) => sameName(s.name, name) && !(editingName !== null && sameName(s.name, editingName)))) errors.name = "A service with this name already exists.";

  const cost = normalizeCost(draft.cost);
  if (cost) {
    if (!COST.test(cost)) errors.cost = `Enter an amount in ${CATALOG_CURRENCY} with up to two decimals, for example 150 or 149.95.`;
    else if (Number(cost) > COST_MAX) errors.cost = `Keep the cost at or under ${COST_MAX.toLocaleString("en-US")} ${CATALOG_CURRENCY}.`;
  }

  const email = draft.responsible_email.trim();
  if (email && !EMAIL.test(email)) errors.responsible_email = "Enter one valid email address.";
  if (draft.responsible_name.trim().length > NAME_MAX) errors.responsible_name = `Use ${NAME_MAX} characters or fewer.`;
  return errors;
}

export const toEntry = (d: ServiceDraft): GetReadyService => ({
  name: d.name.trim(),
  responsible_name: d.responsible_name.trim(),
  responsible_email: d.responsible_email.trim(),
  cost: normalizeCost(d.cost),
});

export const toDraft = (s: GetReadyService): ServiceDraft => ({ name: s.name ?? "", responsible_name: s.responsible_name ?? "", responsible_email: s.responsible_email ?? "", cost: s.cost ?? "" });

export const formatCost = (cost: string): string => {
  const c = normalizeCost(cost ?? "");
  if (!c || !Number.isFinite(Number(c))) return "Not set";
  return Number(c).toLocaleString("en-US", { style: "currency", currency: CATALOG_CURRENCY });
};

/** Task labels the technician flow requires a photo for. These are labels, not ids: the schema keeps no task id. */
export const photoTaskLabels = (raw: string | undefined): string[] => (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export const requiresPhotoProof = (service: Pick<GetReadyService, "name">, raw: string | undefined): boolean => photoTaskLabels(raw).some((l) => sameName(l, service.name));

export const isUnassigned = (s: GetReadyService): boolean => !s.responsible_name?.trim() && !s.responsible_email?.trim();

export const addService = (all: readonly GetReadyService[], entry: GetReadyService): GetReadyService[] => [...all, entry];

/** Replaces the entry named `name`; every other entry is returned untouched. */
export const replaceService = (all: readonly GetReadyService[], name: string, entry: GetReadyService): GetReadyService[] => all.map((s) => (sameName(s.name, name) ? entry : s));

export const removeService = (all: readonly GetReadyService[], name: string): GetReadyService[] => all.filter((s) => !sameName(s.name, name));

/** Roles merge_dealer_settings accepts for settings keys such as get_ready_services (a platform admin is also accepted). */
export const CATALOG_WRITE_ROLES = ["owner", "admin", "general_manager", "gsm", "manager"] as const;

export const canWriteCatalog = (role: string | null | undefined, isPlatformAdmin: boolean): boolean =>
  isPlatformAdmin || CATALOG_WRITE_ROLES.includes(`${role ?? ""}`.trim().toLowerCase() as (typeof CATALOG_WRITE_ROLES)[number]);
