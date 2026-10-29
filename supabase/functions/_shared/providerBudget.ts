// The call gate every paid provider caller passes through: ask the database
// whether this month's budget admits the call, then record what the provider
// answered. Fails CLOSED (owner decision 2026-10-29): an unreachable gate, an
// error, an answer it cannot read, a provider the database admits only because
// it has no budget ("ungated"), or a caller with no gate at all all mean no
// provider call. The refusal is logged without the URL, which carries keys.
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

export const GATE_UNAVAILABLE: AdmitResult = { admitted: false, eventId: null, monthCalls: null, cap: null, reserve: null, reason: "gate_unavailable" };

export async function admitProviderCall(admin: RpcClient | null | undefined, a: AdmitArgs): Promise<AdmitResult> {
  if (!admin) {
    console.warn(`provider budget gate absent (${a.caller}): refused`);
    return GATE_UNAVAILABLE;
  }
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
      console.warn(`provider budget gate unavailable (${a.caller}): refused: ${String(error.message || error).slice(0, 200)}`);
      return GATE_UNAVAILABLE;
    }
    const parsed = parseAdmitRow(data);
    if (!parsed || parsed.reason === "gate_unavailable") {
      console.warn(`provider budget gate answered nothing usable (${a.caller}): refused`);
      return GATE_UNAVAILABLE;
    }
    // The hosted gate admits a provider that has no budget row ("ungated").
    // Unconfigured providers stay disabled: the reservation it wrote is
    // closed as refused so the ledger does not count it as a call.
    if (parsed.admitted && parsed.reason === "ungated") {
      if (parsed.eventId != null) {
        try {
          await admin.rpc("provider_call_record", {
            p_event_id: parsed.eventId, p_http_status: null, p_outcome: "budget_denied",
            p_note: "unconfigured: refused by the caller (no budget for this provider)",
          });
        } catch { /* the call is refused either way */ }
      }
      console.warn(`provider budget: ${provider} has no budget (${a.caller}): refused`);
      return { ...parsed, admitted: false, reason: "unconfigured" };
    }
    if (!parsed.admitted) {
      console.warn(`provider budget denied ${provider} ${product} for ${a.caller}: ${parsed.reason} (${parsed.monthCalls}/${parsed.cap}, reserve ${parsed.reserve})`);
    }
    return parsed;
  } catch (err) {
    console.warn(`provider budget gate threw (${a.caller}): refused: ${err instanceof Error ? err.message.slice(0, 200) : "error"}`);
    return GATE_UNAVAILABLE;
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
