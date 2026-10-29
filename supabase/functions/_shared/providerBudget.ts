// The call gate every paid provider caller passes through: ask the database
// whether this month's budget (the dealership's, then the platform's) admits
// the call, then record what the provider answered. Fails OPEN when the gate is unreachable or not yet migrated, and
// says so, because a gate that is missing must never stop the feed.
import { billingProductForUrl, MC_CALL_PRICE_USD } from "./mcCost.ts";
import { outcomeForAnswer, parseAdmitRow, type AdmitResult, type ProviderCallOutcome } from "./providerBudgetPolicy.ts";

// deno-lint-ignore no-explicit-any
type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };

export interface AdmitArgs {
  url: string;
  caller: string;
  essential?: boolean;
  tenantId?: string | null;
  vin?: string | null;
  provider?: string;
  // For providers other than MarketCheck, whose product is not read from the
  // URL. Without a price the database uses provider_unit_prices.
  product?: string;
  estimatedCostUsd?: number | null;
}

export async function admitProviderCall(admin: RpcClient, a: AdmitArgs): Promise<AdmitResult> {
  const provider = a.provider || "marketcheck";
  const product = a.product || billingProductForUrl(a.url);
  try {
    const { data, error } = await admin.rpc("provider_call_admit", {
      p_provider: provider,
      p_product: product,
      p_caller: a.caller,
      p_essential: a.essential === true,
      p_tenant_id: a.tenantId ?? null,
      p_vin: a.vin ?? null,
      p_estimated_cost_usd: a.estimatedCostUsd !== undefined ? a.estimatedCostUsd : provider === "marketcheck" ? MC_CALL_PRICE_USD[product] ?? null : null,
    });
    if (error) {
      console.warn(`provider budget gate unavailable (${a.caller}): ${String(error.message || error)}`);
      return { admitted: true, eventId: null, monthCalls: null, cap: null, reserve: null, reason: "gate_unavailable" };
    }
    const parsed = parseAdmitRow(data);
    if (!parsed) {
      console.warn(`provider budget gate answered nothing usable (${a.caller})`);
      return { admitted: true, eventId: null, monthCalls: null, cap: null, reserve: null, reason: "gate_unavailable" };
    }
    if (!parsed.admitted) {
      console.warn(`provider budget denied ${provider} ${product} for ${a.caller}: ${parsed.reason} (${parsed.monthCalls}/${parsed.cap}, reserve ${parsed.reserve})`);
    }
    return parsed;
  } catch (err) {
    console.warn(`provider budget gate threw (${a.caller}): ${err instanceof Error ? err.message : String(err)}`);
    return { admitted: true, eventId: null, monthCalls: null, cap: null, reserve: null, reason: "gate_unavailable" };
  }
}

export async function recordProviderCall(
  admin: RpcClient,
  eventId: number | null,
  status: number | null,
  bodyText?: string | null,
  note?: string | null,
): Promise<ProviderCallOutcome> {
  const outcome = outcomeForAnswer(status, bodyText);
  if (eventId == null) return outcome;
  try {
    await admin.rpc("provider_call_record", {
      p_event_id: eventId, p_http_status: status ?? null, p_outcome: outcome, p_note: note ?? null,
    });
  } catch { /* the ledger must never fail a provider call */ }
  return outcome;
}
