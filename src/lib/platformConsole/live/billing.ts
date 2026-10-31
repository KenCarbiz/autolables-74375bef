import type { MetricModel, Tone } from "../types";
import { consolePath } from "../sections";
import { readRows, settle } from "./read";

export interface BillingRow {
  id: string;
  store: string;
  billing: { label: string; tone: Tone; plain?: boolean };
  entitlement: string;
  override: string;
  actionLabel: string;
  href: string;
}

export interface BillingModel {
  metrics: MetricModel[];
  rows: BillingRow[];
  rowsNote: string;
  safeguardsHelper: string;
  safeguardsText: string;
}

interface StoreRow { id: string; display_name: string; tenant_id: string; status: string; subscription_status: string }
interface EntitlementRow { tenant_id: string; app_slug: string; plan_tier: string; status: string; trial_ends_at: string | null; expires_at: string | null }

const PLAN = (tier: string) => `${tier.charAt(0).toUpperCase()}${tier.slice(1)} plan`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Subscription state mirrored from the billing authority, compared with what the app actually grants. */
export async function loadBilling(now = Date.now()): Promise<BillingModel> {
  const [stores, ents] = await Promise.all([
    settle(readRows<StoreRow>("dealer_stores", "id,display_name,tenant_id,status,subscription_status", { limit: 1000 })),
    settle(readRows<EntitlementRow>("app_entitlements", "tenant_id,app_slug,plan_tier,status,trial_ends_at,expires_at", { limit: 2000 })),
  ]);
  const asOf = new Date(now).toISOString();
  const authority: MetricModel = { key: "authority", icon: "lock", label: "Billing authority", value: "AutoCurb", tone: "info", helper: "Read-only mirror here", provenance: { source: "configuration", asOf: null, state: "healthy", scope: "Platform" } };
  const webhook: MetricModel = { key: "webhooks", icon: "layers", label: "Webhook backlog", value: "Not monitored", tone: "neutral", helper: "No billing webhook queue is recorded", provenance: { source: "none", asOf: null, state: "not_monitored", scope: "Billing webhooks" } };

  if (!stores.ok || !ents.ok) {
    const unknown = (key: string, icon: MetricModel["icon"], label: string): MetricModel => ({ key, icon, label, value: "Unknown", tone: "neutral", helper: "Stores or entitlements are not readable yet", provenance: { source: "app_entitlements", asOf: null, state: "unknown", scope: "All stores" } });
    return {
      metrics: [authority, unknown("effective", "store", "Effective stores"), unknown("mismatch", "warning", "Mismatches"), webhook],
      rows: [],
      rowsNote: "Stores or entitlements are not readable, so billing state is unknown. Nothing here is treated as active.",
      safeguardsHelper: "No billing authority is changed by this screen.",
      safeguardsText: "Preview entitlement changes before applying; audit override reason and expiration.",
    };
  }

  const entFor = (tenant: string) => ents.value.find((e) => e.tenant_id === tenant && e.app_slug === "autolabels");
  const rows: BillingRow[] = stores.value.filter((s) => s.status === "active").map((s) => {
    const e = entFor(s.tenant_id);
    const granted = e ? e.status === "active" || e.status === "trial" : false;
    const mismatch = s.subscription_status === "subscribed" ? !granted : s.subscription_status === "unsubscribed" ? e?.status === "active" : granted && s.subscription_status === "suspended";
    const billing: BillingRow["billing"] = s.subscription_status === "subscribed" ? { label: "Active", tone: "good" } : s.subscription_status === "suspended" ? { label: "Suspended", tone: "bad" } : { label: "Unsubscribed", tone: "neutral" };
    const ends = e?.status === "trial" ? e.trial_ends_at : e?.expires_at ?? null;
    const override = mismatch ? "Mismatch to authority" : ends ? `${e?.status === "trial" ? "Trial ends" : "Expires"} ${fmtDate(ends)}` : "None recorded";
    return {
      id: s.id,
      store: s.display_name,
      billing: e?.status === "trial" && !mismatch ? { label: "Trial", tone: "info", plain: true } : billing,
      entitlement: e ? `${PLAN(e.plan_tier)} · ${e.status}` : "No entitlement record",
      override,
      actionLabel: mismatch ? "Inspect mismatch" : "Open detail",
      href: consolePath.store(s.id),
    };
  });
  const mismatches = rows.filter((r) => r.override === "Mismatch to authority");
  const effective = stores.value.filter((s) => s.status === "active" && (() => { const e = entFor(s.tenant_id); return !!e && (e.status === "active" || e.status === "trial"); })()).length;
  return {
    metrics: [
      authority,
      { key: "effective", icon: "store", label: "Effective stores", value: String(effective), tone: "info", helper: "Subscribed or authorized trial", provenance: { source: "app_entitlements", asOf, state: "healthy", scope: "Active stores" } },
      { key: "mismatch", icon: "warning", label: "Mismatches", value: String(mismatches.length), tone: mismatches.length ? "warn" : "good", helper: mismatches.length ? `${mismatches[0].store}${mismatches.length > 1 ? ` and ${mismatches.length - 1} more` : ""} requires investigation` : "Subscription state matches access", provenance: { source: "dealer_stores + app_entitlements", asOf, state: "healthy", scope: "Active stores" } },
      webhook,
    ],
    rows,
    rowsNote: "No active stores are recorded.",
    safeguardsHelper: "No billing authority is changed by this screen.",
    safeguardsText: "Preview entitlement changes before applying; audit override reason and expiration.",
  };
}
