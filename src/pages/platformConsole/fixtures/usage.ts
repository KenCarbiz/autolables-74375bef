import type { MetricModel } from "@/lib/platformConsole/types";
import type { UsageModel, UsageRow } from "@/lib/platformConsole/live/usage";

// Synthetic data for references D11 and M05.
const prov = { source: "fixture", asOf: "2026-10-31T09:30:00Z", state: "healthy" as const, scope: "Synthetic providers" };

const metrics: MetricModel[] = [
  { key: "cost", icon: "dollar", label: "Measured usage cost", value: "$48.20", tone: "info", helper: "Estimate, not provider invoice", provenance: prov },
  { key: "reserved", icon: "clock", label: "Reserved allowance", value: "$3.00", tone: "info", helper: "In-flight work included", provenance: prov },
  { key: "refusals", icon: "lock", label: "Budget refusals", value: "6", tone: "warn", helper: "No request sent", provenance: prov },
  { key: "unmetered", icon: "warning", label: "Unmetered providers", value: "2", tone: "warn", helper: "Costs unknown, not $0", provenance: prov },
];

const rows: UsageRow[] = [
  { id: "market", provider: "Market data / feed", usage: "125 requests", budget: { label: "Enforced", tone: "good" }, basis: "Configured contract estimate", actionLabel: "Open usage", href: "/platform-console/usage" },
  { id: "renderer", provider: "Renderer / optional", usage: "210 credits", budget: { label: "Enforced", tone: "good" }, basis: "Credit estimate", actionLabel: "Open usage", href: "/platform-console/usage" },
  { id: "email", provider: "Email / transactional", usage: "41 accepted", budget: { label: "Unmetered", tone: "warn" }, basis: "Unknown unit price", actionLabel: "Open setup", href: "/platform-console/connections" },
  { id: "sticker", provider: "Sticker data / optional", usage: "0 requests", budget: { label: "Disabled", tone: "info", plain: true }, basis: "No provider configured", actionLabel: "Open setup", href: "/platform-console/connections" },
];

const phone = {
  metricHelper: "Estimate · not the provider invoice",
  budgetsHelper: "Fail closed; essential / optional separate",
  unmeasuredHelper: "Do not invent costs when metering is missing.",
  unmeasuredLines: ["Unknown unit price requires setup.", "No paid tests from Refresh."],
};

const policyHelper = "Essential inventory and optional enrichment have separate caps.";
const policyText = "Missing or unreadable gate → refuse new paid work. Expiring exceptions require explicit authorization.";

export const USAGE_FIXTURE: UsageModel = {
  title: "Usage & billing",
  subtitle: "Measured usage, cost estimates and invoices are separate records.",
  metrics,
  rows,
  rowsNote: "",
  policyHelper,
  policyText,
  phone,
};

export const USAGE_PHONE_FIXTURE: UsageModel = {
  ...USAGE_FIXTURE,
  title: "Usage & budgets",
  rows: [
    { ...rows[0], phoneName: "Market data / feed" },
    { ...rows[1], phoneName: "Renderer / enrichment" },
    { ...rows[2], phoneName: "Email / delivery" },
  ],
};
