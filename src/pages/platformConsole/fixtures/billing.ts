import type { BillingModel } from "@/lib/platformConsole/live/billing";

// Synthetic data for reference D19.
const prov = { source: "fixture", asOf: "2026-10-31T09:30:00Z", state: "healthy" as const, scope: "Synthetic stores" };

export const BILLING_FIXTURE: BillingModel = {
  metrics: [
    { key: "authority", icon: "lock", label: "Billing authority", value: "AutoCurb", tone: "info", helper: "Read-only mirror here", provenance: prov },
    { key: "effective", icon: "store", label: "Effective stores", value: "12", tone: "info", helper: "Subscribed or authorized trial", provenance: prov },
    { key: "mismatch", icon: "warning", label: "Mismatches", value: "1", tone: "warn", helper: "Store B requires investigation", provenance: prov },
    { key: "webhooks", icon: "layers", label: "Webhook backlog", value: "0", tone: "good", helper: "Measured queue · checked 09:10", provenance: prov },
  ],
  rows: [
    { id: "a", store: "Store A", billing: { label: "Active", tone: "good" }, entitlement: "Compliance plan", override: "None", actionLabel: "Open detail", href: "/platform-console/stores/store-a" },
    { id: "b", store: "Store B", billing: { label: "Active", tone: "good" }, entitlement: "Essential plan", override: "Mismatch to authority", actionLabel: "Inspect mismatch", href: "/platform-console/stores/store-b" },
    { id: "c", store: "Store C", billing: { label: "Trial", tone: "info", plain: true }, entitlement: "Trial features", override: "Expires Nov 7", actionLabel: "Open detail", href: "/platform-console/stores/store-c" },
  ],
  rowsNote: "",
  safeguardsHelper: "No billing authority is changed by this screen.",
  safeguardsText: "Preview entitlement changes before applying; audit override reason and expiration.",
};
