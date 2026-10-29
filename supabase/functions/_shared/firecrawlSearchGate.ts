// The paid Firecrawl search behind oem-brochure and oem-owners-manual, passed
// through the provider budget for the dealership the lookup is made for. A
// refusal throws SearchBudgetRefused before anything is sent; the handler
// answers { error: "budget_refused" } so packet-backfill neither charges nor
// caches it.
import { admitProviderCall, recordProviderCall } from "./providerBudget.ts";

export const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v1/search";

export class SearchBudgetRefused extends Error {
  constructor(public reason: string) {
    super(`provider budget refused the search (${reason})`);
  }
}

export interface SearchGate {
  // deno-lint-ignore no-explicit-any
  admin: any;
  tenantId: string | null;
  caller: string;
}

export async function gatedSearchFetch(gate: SearchGate, key: string, query: string): Promise<Response> {
  const admit = await admitProviderCall(gate.admin, {
    url: FIRECRAWL_SEARCH_URL, caller: gate.caller, provider: "firecrawl", product: "search", tenantId: gate.tenantId,
  });
  if (!admit.admitted) throw new SearchBudgetRefused(admit.reason);
  try {
    const res = await fetch(FIRECRAWL_SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, limit: 8 }),
      signal: AbortSignal.timeout(25000),
    });
    await recordProviderCall(gate.admin, admit.eventId, res.status, res.ok ? null : await res.clone().text().catch(() => null));
    return res;
  } catch (err) {
    await recordProviderCall(gate.admin, admit.eventId, null, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

// The dealership a lookup is charged to: the one named in the body, when the
// caller is the platform (service role or cron) or a member of it. A signed-in
// user cannot charge another dealership's budget.
export async function searchTenant(
  // deno-lint-ignore no-explicit-any
  admin: any,
  privileged: boolean,
  userId: string | null,
  requested: unknown,
): Promise<string | null> {
  const tenantId = typeof requested === "string" && /^[0-9a-f-]{36}$/i.test(requested) ? requested : null;
  if (!tenantId || privileged) return tenantId;
  if (!userId) return null;
  const { data } = await admin.from("tenant_members").select("tenant_id")
    .eq("user_id", userId).eq("tenant_id", tenantId).maybeSingle();
  return data ? tenantId : null;
}
