import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { formatDateTime } from "@/lib/admin/integrations/format";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { readOptional, runWrite, type Optional, type WriteResult } from "./optionalSchema";

type DbClient = SupabaseClient<Database>;

// Lives in dealer_profiles.settings, written through merge_dealer_settings,
// which already limits an unclassified key to settings-managing roles.
export const PREP_DEFAULT_DUE_DAYS_KEY = "prep_default_due_days";
export const PREP_DEFAULT_DUE_DAYS_MAX = 365;
export const NO_DUE_DATE_LABEL = "No due date";

const DAY_MS = 86_400_000;

export function parsePrepDefaultDays(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n)) return null;
  return n >= 1 && n <= PREP_DEFAULT_DUE_DAYS_MAX ? n : null;
}

export const prepDefaultDaysFromSettings = (settings: unknown): number | null =>
  settings && typeof settings === "object" && !Array.isArray(settings)
    ? parsePrepDefaultDays((settings as Record<string, unknown>)[PREP_DEFAULT_DUE_DAYS_KEY])
    : null;

export type PrepDueSource = "set" | "default" | "none";

export interface EffectivePrepDue {
  dueAt: string | null;
  source: PrepDueSource;
}

export function effectivePrepDue(
  row: { due_at?: string | null; created_at?: string | null },
  defaultDays: number | null,
): EffectivePrepDue {
  if (row.due_at) return { dueAt: row.due_at, source: "set" };
  const created = row.created_at ? Date.parse(row.created_at) : NaN;
  if (defaultDays != null && Number.isFinite(created)) {
    return { dueAt: new Date(created + defaultDays * DAY_MS).toISOString(), source: "default" };
  }
  return { dueAt: null, source: "none" };
}

export function formatPrepDue(dueAt: string | null | undefined, timeZone: string | null | undefined): string {
  if (!dueAt || !Number.isFinite(Date.parse(dueAt))) return NO_DUE_DATE_LABEL;
  return formatDateTime(dueAt, { timeZone, withZone: true });
}

export type PrepDueState = "none" | "on_track" | "due_soon" | "overdue";

export function prepDueState(dueAt: string | null | undefined, now: number = Date.now(), soonMs = DAY_MS): PrepDueState {
  const due = dueAt ? Date.parse(dueAt) : NaN;
  if (!Number.isFinite(due)) return "none";
  if (due < now) return "overdue";
  return due - now <= soonMs ? "due_soon" : "on_track";
}

export const canSetPrepDue = (role: string, isPlatformAdmin = false): boolean =>
  hasDealerCapability(role, "can_manage_work_queue", isPlatformAdmin);

export function fetchPrepDueDates(client: DbClient, prepIds: string[]): Promise<Optional<Map<string, string | null>>> {
  if (prepIds.length === 0) return Promise.resolve({ status: "available", data: new Map() });
  return readOptional(
    () => client.from("prep_sign_offs").select("id, due_at").in("id", prepIds),
    (rows) => new Map((rows ?? []).map((r) => [r.id, r.due_at] as const)),
  );
}

export function setPrepDueAt(client: DbClient, prepId: string, dueAt: string | null): Promise<WriteResult<undefined>> {
  if (dueAt != null && !Number.isFinite(Date.parse(dueAt))) {
    return Promise.resolve({ ok: false, reason: "invalid", message: "Enter a valid due date." });
  }
  return runWrite(
    () => client.from("prep_sign_offs").update({ due_at: dueAt }).eq("id", prepId),
    () => undefined,
  );
}

export function fetchPrepDefaultDays(client: DbClient, tenantId: string): Promise<Optional<number | null>> {
  return readOptional(
    () => client.from("dealer_profiles").select("settings").eq("tenant_id", tenantId).maybeSingle(),
    (row: { settings: Json } | null) => prepDefaultDaysFromSettings(row?.settings ?? null),
  );
}

export function setPrepDefaultDays(client: DbClient, tenantId: string, days: number | null): Promise<WriteResult<undefined>> {
  if (days != null && parsePrepDefaultDays(days) == null) {
    return Promise.resolve({ ok: false, reason: "invalid", message: `Use a whole number of days from 1 to ${PREP_DEFAULT_DUE_DAYS_MAX}.` });
  }
  const patch: Json = { [PREP_DEFAULT_DUE_DAYS_KEY]: days };
  return runWrite(() => client.rpc("merge_dealer_settings", { _tenant_id: tenantId, _patch: patch }), () => undefined);
}
