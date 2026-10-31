import type { MetricModel, Tone } from "../types";
import { consolePath } from "../sections";
import { readRows, settle } from "./read";

export interface UsageRow {
  id: string;
  provider: string;
  /** Observed request count text, e.g. "125 requests". Never a cost. */
  usage: string;
  budget: { label: string; tone: Tone; plain?: boolean };
  /** Estimate, provider-confirmed or unknown: says which. */
  basis: string;
  actionLabel: string;
  href: string;
  /** Shorter name used by the phone list. */
  phoneName?: string;
}

export interface UsageModel {
  title: string;
  subtitle: string;
  metrics: MetricModel[];
  rows: UsageRow[];
  rowsNote: string;
  policyHelper: string;
  policyText: string;
  phone: {
    metricHelper: string;
    budgetsHelper: string;
    unmeasuredHelper: string;
    unmeasuredLines: string[];
  };
}

interface AccountRow { account_ref: string; provider: string; plan_name: string | null; monthly_call_quota: number; monthly_usd_cap: number | null; provider_reported_used: number | null; provider_reported_at: string | null }
interface CatalogRow { account_ref: string; product_key: string; rate_status: string }
interface RequestRow { account_ref: string; status: string; estimated_cost_usd: number | null; actual_cost_usd: number | null; quota_units: number }
interface UsageLogRow { provider: string; outcome: string; cost_basis: string }

const usd = (n: number) => `$${n.toFixed(2)}`;
const PRICED = new Set(["verified", "list_price_estimate"]);

export async function loadUsage(now = Date.now()): Promise<UsageModel> {
  const d = new Date(now);
  const month = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
  const [accounts, catalog, requests, usage] = await Promise.all([
    settle(readRows<AccountRow>("provider_accounts", "account_ref,provider,plan_name,monthly_call_quota,monthly_usd_cap,provider_reported_used,provider_reported_at", { limit: 100 })),
    settle(readRows<CatalogRow>("provider_product_catalog", "account_ref,product_key,rate_status", { limit: 500 })),
    settle(readRows<RequestRow>("provider_requests", "account_ref,status,estimated_cost_usd,actual_cost_usd,quota_units", { filters: [{ col: "reserved_at", op: "gte", value: month }], order: "reserved_at", limit: 5000 })),
    settle(readRows<UsageLogRow>("store_provider_usage", "provider,outcome,cost_basis", { filters: [{ col: "at", op: "gte", value: month }], order: "at", limit: 5000 })),
  ]);
  const asOf = new Date(now).toISOString();
  const reqs = requests.ok ? requests.value : [];
  const counted = reqs.filter((r) => r.status === "consumed" || r.status === "billing_uncertain" || r.status === "no_charge");
  const refused = reqs.filter((r) => r.status === "refused").length;
  const reserved = reqs.filter((r) => r.status === "reserved");

  const confirmed = counted.filter((r) => r.actual_cost_usd !== null);
  const estimated = counted.filter((r) => r.actual_cost_usd === null && r.estimated_cost_usd !== null);
  const confirmedSum = confirmed.reduce((a, r) => a + (r.actual_cost_usd ?? 0), 0);
  const estimatedSum = estimated.reduce((a, r) => a + (r.estimated_cost_usd ?? 0), 0);
  const unpriced = counted.length - confirmed.length - estimated.length;

  const costMetric: MetricModel = !requests.ok
    ? { key: "cost", icon: "dollar", label: "Measured usage cost", value: "Unknown", tone: "neutral", helper: "Provider requests are not readable yet", provenance: { source: "provider_requests", asOf: null, state: "unknown", scope: "This month" } }
    : confirmed.length + estimated.length === 0
      ? { key: "cost", icon: "dollar", label: "Measured usage cost", value: "Unknown", tone: "neutral", helper: counted.length ? `${counted.length} requests this month, none priced` : "No metered requests this month", provenance: { source: "provider_requests", asOf, state: "unknown", scope: "This month" } }
      : { key: "cost", icon: "dollar", label: "Measured usage cost", value: usd(confirmedSum + estimatedSum), tone: "info", helper: `${confirmed.length ? `${usd(confirmedSum)} provider-confirmed · ` : ""}${estimated.length} estimated${unpriced ? ` · ${unpriced} unpriced` : ""}`, provenance: { source: "provider_requests", asOf, state: "healthy", scope: "This month" } };

  const reservedEstimate = reserved.reduce((a, r) => a + (r.estimated_cost_usd ?? 0), 0);
  const reservedPriced = reserved.some((r) => r.estimated_cost_usd !== null);
  const reservedMetric: MetricModel = !requests.ok
    ? { key: "reserved", icon: "clock", label: "Reserved allowance", value: "Unknown", tone: "neutral", helper: "Provider requests are not readable yet", provenance: { source: "provider_requests", asOf: null, state: "unknown", scope: "In flight" } }
    : { key: "reserved", icon: "clock", label: "Reserved allowance", value: reservedPriced ? usd(reservedEstimate) : String(reserved.length), tone: "info", helper: reservedPriced ? "In-flight work included" : `${reserved.length === 1 ? "request" : "requests"} in flight · no price recorded`, provenance: { source: "provider_requests", asOf, state: "healthy", scope: "In flight" } };

  const refusalMetric: MetricModel = !requests.ok
    ? { key: "refusals", icon: "lock", label: "Budget refusals", value: "Unknown", tone: "neutral", helper: "Provider requests are not readable yet", provenance: { source: "provider_requests", asOf: null, state: "unknown", scope: "This month" } }
    : { key: "refusals", icon: "lock", label: "Budget refusals", value: String(refused), tone: refused ? "warn" : "neutral", helper: "No request sent", provenance: { source: "provider_requests", asOf, state: "healthy", scope: "This month" } };

  const acct = accounts.ok ? accounts.value : [];
  const cat = catalog.ok ? catalog.value : [];
  const priced = (ref: string) => cat.some((c) => c.account_ref === ref && PRICED.has(c.rate_status));
  const unmetered = acct.filter((a) => !priced(a.account_ref));
  const unmeteredMetric: MetricModel = accounts.ok && catalog.ok
    ? { key: "unmetered", icon: "warning", label: "Unmetered providers", value: String(unmetered.length), tone: unmetered.length ? "warn" : "neutral", helper: "Costs unknown, not $0", provenance: { source: "provider_accounts", asOf, state: "healthy", scope: "Configured providers" } }
    : { key: "unmetered", icon: "warning", label: "Unmetered providers", value: "Unknown", tone: "neutral", helper: "Provider catalog is not readable yet", provenance: { source: "provider_accounts", asOf: null, state: "unknown", scope: "Configured providers" } };

  const rows: UsageRow[] = acct.map((a) => {
    const own = counted.filter((r) => r.account_ref === a.account_ref);
    const units = own.reduce((s, r) => s + r.quota_units, 0);
    const meteredPrice = priced(a.account_ref);
    const rates = cat.filter((c) => c.account_ref === a.account_ref).map((c) => c.rate_status);
    const basis = a.provider_reported_used !== null
      ? `Provider-confirmed: ${a.provider_reported_used} used`
      : rates.includes("verified") ? "Provider-confirmed rate" : rates.includes("list_price_estimate") ? "List-price estimate" : "Unknown unit price";
    const name = a.plan_name ? `${a.provider} / ${a.plan_name}` : `${a.provider} / ${a.account_ref}`;
    return {
      id: a.account_ref,
      provider: name,
      usage: requests.ok ? `${own.length} requests${units !== own.length ? ` · ${units} units` : ""} of ${a.monthly_call_quota}` : "Unknown",
      budget: meteredPrice ? { label: "Enforced", tone: "good" } : { label: "Unmetered", tone: "warn" },
      basis,
      actionLabel: meteredPrice ? "Open usage" : "Open setup",
      href: meteredPrice ? consolePath.usage() : consolePath.connections(),
      phoneName: name,
    };
  });

  // Providers with usage log rows but no configured account are unmetered, never zero.
  const known = new Set(acct.map((a) => a.provider));
  const logged = new Map<string, { n: number; unpriced: number }>();
  for (const u of usage.ok ? usage.value : []) {
    if (known.has(u.provider)) continue;
    const e = logged.get(u.provider) ?? { n: 0, unpriced: 0 };
    e.n += u.outcome === "admitted" ? 1 : 0;
    e.unpriced += u.cost_basis === "unpriced" ? 1 : 0;
    logged.set(u.provider, e);
  }
  for (const [provider, e] of logged) {
    rows.push({ id: `log-${provider}`, provider: `${provider} / usage log`, usage: `${e.n} admitted`, budget: { label: "Unmetered", tone: "warn" }, basis: e.unpriced ? "Unknown unit price" : "Estimate", actionLabel: "Open setup", href: consolePath.connections() });
  }

  return {
    title: "Usage & billing",
    subtitle: "Measured usage, cost estimates and invoices are separate records.",
    metrics: [costMetric, reservedMetric, refusalMetric, unmeteredMetric],
    rows,
    rowsNote: accounts.ok ? "No provider accounts are configured, so nothing is metered. That is not $0 of usage." : "Provider accounts are not readable, so usage is unknown.",
    policyHelper: "Essential inventory and optional enrichment have separate caps.",
    policyText: "Missing or unreadable gate → refuse new paid work. Expiring exceptions require explicit authorization.",
    phone: {
      metricHelper: "Estimate · not the provider invoice",
      budgetsHelper: "Fail closed; essential / optional separate",
      unmeasuredHelper: "Do not invent costs when metering is missing.",
      unmeasuredLines: ["Unknown unit price requires setup.", "No paid tests from Refresh."],
    },
  };
}
