import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { readOptional, runWrite, type Optional, type WriteResult } from "./optionalSchema";

type DbClient = SupabaseClient<Database>;

// The DMS owns deal numbering. AutoLabels stores what was entered or synced
// and never generates one; the internal addendum id stays the record key.
export const DEAL_NUMBER_NOT_ENTERED = "Not entered";
export const DEAL_NUMBER_MAX_LENGTH = 64;

export function normalizeDealNumber(input: string | null | undefined): { value: string | null; error: string | null } {
  const value = (input ?? "").replace(/\s+/g, " ").trim();
  if (!value) return { value: null, error: null };
  if (value.length > DEAL_NUMBER_MAX_LENGTH) {
    return { value: null, error: `A deal number is at most ${DEAL_NUMBER_MAX_LENGTH} characters.` };
  }
  return { value, error: null };
}

export const displayDealNumber = (value: string | null | undefined): string =>
  normalizeDealNumber(value).value ?? DEAL_NUMBER_NOT_ENTERED;

export const hasDealNumber = (value: string | null | undefined): boolean => normalizeDealNumber(value).value != null;

export function fetchDealNumbers(client: DbClient, addendumIds: string[]): Promise<Optional<Map<string, string | null>>> {
  if (addendumIds.length === 0) return Promise.resolve({ status: "available", data: new Map() });
  return readOptional(
    () => client.from("addendums").select("id, deal_number").in("id", addendumIds),
    (rows) => new Map((rows ?? []).map((r) => [r.id, r.deal_number] as const)),
  );
}

export function setDealNumber(
  client: DbClient,
  addendumId: string,
  input: string | null,
): Promise<WriteResult<{ dealNumber: string | null }>> {
  const { value, error } = normalizeDealNumber(input);
  if (error) return Promise.resolve({ ok: false, reason: "invalid", message: error });
  return runWrite(
    () => client.from("addendums").update({ deal_number: value }).eq("id", addendumId),
    () => ({ dealNumber: value }),
  );
}
