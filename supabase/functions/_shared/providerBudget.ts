// The call gate every paid provider caller passes through: ask the database
// whether this month's budget admits the call, then record what the provider
// answered. Fails CLOSED (owner decision 2026-10-29): an unreachable gate, an
// error, an answer it cannot read, a provider the database admits only because
// it has no budget ("ungated"), or a caller with no gate at all all mean no
// provider call. The refusal is logged without the URL, which carries keys.
import { billingProductForUrl, MC_CALL_PRICE_USD } from "./mcCost.ts";
import { outcomeForAnswer, parseAdmitRow, settlementForAnswer, type AdmitResult, type ProviderCallOutcome } from "./providerBudgetPolicy.ts";
import { catalogProductForUrl, requestDedupeKey } from "./marketcheck/catalogKeys.ts";
import { readQuotaHeaders } from "./marketcheck/responseSemantics.ts";

export const MARKETCHECK_ACCOUNT_REF = "marketcheck_primary";

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
  // Account coordinator (migration 0007). Priority 1 required work for primary
  // subscribed stores, 2 missing high-value info, 3 approved refreshes,
  // 4 optional enrichment. Default: 1 for essential calls, otherwise 4.
  priority?: 1 | 2 | 3 | 4;
  reason?: string;
  storeId?: string | null;
  freeRefresh?: boolean;
  channel?: "rest" | "mcp" | "staff_ai";
  initiatedBy?: string | null;
  purpose?: string | null;
  toolName?: string | null;
  invocationId?: string | null;
}

export const GATE_UNAVAILABLE: AdmitResult = { admitted: false, eventId: null, monthCalls: null, cap: null, reserve: null, reason: "gate_unavailable" };

export async function admitProviderCall(admin: RpcClient | null | undefined, a: AdmitArgs): Promise<AdmitResult> {
  if (!admin) {
    console.warn(`provider budget gate absent (${a.caller}): refused`);
    return GATE_UNAVAILABLE;
  }
  const provider = a.provider || "marketcheck";
  const product = a.product || billingProductForUrl(a.url);
  if (provider === "marketcheck" && a.tenantId && a.vin) {
    const store = await admitStoreEnrichment(admin, a, product);
    if (!store.admitted) return { admitted: false, eventId: null, monthCalls: null, cap: null, reserve: null, reason: "store_policy" };
  }
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
      return parsed;
    }
    if (provider !== "marketcheck") return parsed;
    // Every MarketCheck request, from any caller, also reserves account quota.
    const account = await reserveAccountQuota(admin, a, parsed.eventId);
    if (!account.reserved) {
      if (parsed.eventId != null) {
        try {
          await admin.rpc("provider_call_record", {
            p_event_id: parsed.eventId, p_http_status: null, p_outcome: "budget_denied",
            p_note: `account coordinator refused: ${account.reason}`.slice(0, 200),
          });
        } catch { /* the call is refused either way */ }
      }
      console.warn(`marketcheck account coordinator refused ${product} for ${a.caller}: ${account.reason}`);
      return { ...parsed, admitted: false, reason: "account_quota", accountReason: account.reason };
    }
    return { ...parsed, accountRequestId: account.requestId };
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
  headers?: { get(name: string): string | null } | null,
): Promise<ProviderCallOutcome> {
  const outcome = outcomeForAnswer(status, bodyText);
  if (eventId == null) return outcome;
  try {
    await admin.rpc("provider_call_record", {
      p_event_id: eventId, p_http_status: status ?? null, p_outcome: outcome, p_note: note ?? null,
    });
  } catch { /* the ledger must never fail a provider call */ }
  const quota = headers ? readQuotaHeaders(headers, new Date()) : null;
  const headerJson = quota && quota.source.length ? { limit: quota.limit, remaining: quota.remaining, used: quota.used, reset_at: quota.resetAt, source: quota.source } : null;
  try {
    await admin.rpc("provider_settle_event", {
      p_event_id: eventId, p_outcome: settlementForAnswer(status), p_http_status: status ?? null, p_headers: headerJson,
    });
    if (headerJson && (quota!.limit != null || quota!.remaining != null || quota!.used != null)) {
      await admin.rpc("provider_reconcile_account", {
        p_account_ref: MARKETCHECK_ACCOUNT_REF, p_limit: quota!.limit, p_used: quota!.used, p_remaining: quota!.remaining, p_reset_at: quota!.resetAt,
      });
    }
  } catch { /* an unsettled reservation expires and stops holding quota */ }
  return outcome;
}

// The account-wide coordinator (migration 0007): one atomic reservation per
// request across every key on the account, with the protected reserve,
// priority floors, dollar cap, rate limit, deduplication and the
// billing-uncertain hold. Fails closed: a missing coordinator refuses the
// call like any other failure, so no request can bypass the protected reserve
// by running against a database where the coordinator was never installed.
export async function reserveAccountQuota(admin: RpcClient, a: AdmitArgs, eventId: number | null): Promise<{ reserved: boolean; requestId?: string; reason?: string }> {
  try {
    const dedupe = await requestDedupeKey(a.url, a.vin);
    const { data, error } = await admin.rpc("provider_reserve", {
      p_account_ref: MARKETCHECK_ACCOUNT_REF,
      p_product_key: catalogProductForUrl(a.url),
      p_caller: a.caller,
      p_reason: a.reason ?? (a.essential ? "essential_sync" : "provider_call"),
      p_priority: a.priority ?? (a.essential ? 1 : 4),
      p_tenant_id: a.tenantId ?? null,
      p_store_id: a.storeId ?? null,
      p_vin: a.vin ?? null,
      p_dedupe_key: dedupe,
      p_estimated_cost_usd: a.estimatedCostUsd !== undefined ? a.estimatedCostUsd : null,
      p_free_refresh: a.freeRefresh === true,
      p_provider_event_id: eventId,
      p_ttl_seconds: 300,
      p_context: {
        channel: a.channel ?? "rest", initiated_by: a.initiatedBy ?? null, purpose: a.purpose ?? null,
        tool_name: a.toolName ?? null, invocation_id: a.invocationId ?? null,
      },
    });
    if (error) {
      const code = String((error as { code?: string }).code ?? "");
      if (code === "PGRST202" || code === "42883") return { reserved: false, reason: "coordinator_not_installed" };
      return { reserved: false, reason: "coordinator_unavailable" };
    }
    const d = (data ?? {}) as { reserved?: unknown; request_id?: unknown; reason?: unknown };
    if (d.reserved === true && typeof d.request_id === "string") return { reserved: true, requestId: d.request_id };
    return { reserved: false, reason: typeof d.reason === "string" ? d.reason : "refused" };
  } catch {
    return { reserved: false, reason: "coordinator_unavailable" };
  }
}

// Per-store MarketCheck policy (migration 0006). A VIN that belongs to a
// store's Files.com inventory is admitted only under that store's approved
// policy: feed-only, paused, budget-blocked, unapproved products and exhausted
// limits all refuse. A VIN with no store record is legacy tenant inventory and
// is unaffected. The one tolerated failure is the gate not existing yet (the
// migration that creates it also creates every store record, so nothing can
// be store-owned without it); any other failure refuses the call.
export async function admitStoreEnrichment(admin: RpcClient, a: AdmitArgs, product: string): Promise<{ admitted: boolean; reason?: string }> {
  try {
    const { data, error } = await admin.rpc("store_enrichment_admit", {
      p_tenant_id: a.tenantId, p_vin: a.vin, p_product: product, p_caller: a.caller,
      p_reason: a.essential ? "essential_sync" : "provider_call",
      p_estimated_cost_usd: a.estimatedCostUsd !== undefined ? a.estimatedCostUsd : MC_CALL_PRICE_USD[product] ?? null,
    });
    if (error) {
      const code = String((error as { code?: string }).code ?? "");
      if (code === "PGRST202" || code === "42883") return { admitted: true, reason: "store_gate_not_installed" };
      console.warn(`store enrichment gate unavailable (${a.caller}): refused`);
      return { admitted: false, reason: "gate_unavailable" };
    }
    const d = (data ?? {}) as { admitted?: unknown; reason?: unknown };
    if (d.admitted === true) return { admitted: true };
    console.warn(`store policy refused marketcheck ${product} for ${a.caller}: ${String(d.reason ?? "unknown")}`);
    return { admitted: false, reason: typeof d.reason === "string" ? d.reason : "refused" };
  } catch {
    return { admitted: false, reason: "gate_unavailable" };
  }
}
