import type { OverviewModel } from "@/lib/platformConsole/live/overview";

// Synthetic data for reference D01 / T01 / M01. Never a production default.
const prov = { source: "fixture", asOf: "2026-10-31T09:30:00Z", state: "healthy" as const, scope: "Synthetic stores" };

export const OVERVIEW_FIXTURE: OverviewModel = {
  metrics: [
    { key: "stores", icon: "store", label: "Stores needing attention", value: "3 / 12", tone: "warn", helper: "2 data issues · 1 billing issue", provenance: prov },
    { key: "imports", icon: "file", label: "Imports within target", value: "96.4%", tone: "info", helper: "Last 24h · 53 / 55 eligible runs", provenance: prov },
    { key: "journeys", icon: "activity", label: "Customer journey checks", value: "5 / 6", tone: "bad", helper: "Document download failing", provenance: prov },
    { key: "cost", icon: "dollar", label: "Measured provider cost", value: "$48.20", tone: "info", helper: "Estimate · 2 providers unmetered", provenance: prov },
  ],
  attention: [
    { id: "a", severity: "high", store: "Store A", issue: "Import held: schema changed", age: "18 min", actionLabel: "Inspect run", href: "/platform-console/data/imports/IMP-1042", detail: "Schema change · 18 min" },
    { id: "c", severity: "high", store: "Store C", issue: "Document download failing", age: "7 min", actionLabel: "Open incident", href: "/platform-console/incidents/INC-028", detail: "Customer journey · 7 min" },
    { id: "b", severity: "medium", store: "Store B", issue: "Subscription/access mismatch", age: "1 hr", actionLabel: "Inspect access", href: "/platform-console/usage/billing", detail: "Billing reconciliation · 1 hr" },
  ],
  attentionNote: "",
  operations: [
    { id: "1", tone: "good", title: "Files.com webhook accepted", detail: "Store A · durably queued" },
    { id: "2", tone: "warn", title: "Import held before publication", detail: "2 required columns changed" },
    { id: "3", tone: "good", title: "Rating run complete", detail: "31 eligible · 4 withheld" },
  ],
  operationsNote: "",
  stages: [
    { key: "received", label: "Received", value: "55 files", tone: "good" },
    { key: "validated", label: "Validated", value: "53 passed", tone: "warn" },
    { key: "imported", label: "Imported", value: "53 complete", tone: "good" },
    { key: "calculated", label: "Calculated", value: "4 withheld", tone: "warn" },
    { key: "published", label: "Published", value: "53 updates", tone: "good" },
  ],
  stagesNote: "Illustrative counts · inspect each stage for its source and time window",
  liveChannel: "connected",
};

/** M01: the phone reference words some rows differently from the desktop one. */
export const OVERVIEW_PHONE_FIXTURE: OverviewModel = {
  ...OVERVIEW_FIXTURE,
  phone: {
    metricHelper: "2 data issues · 1 access issue",
    attention: [
      { id: "a", title: "Store A · Import held", detail: "Schema change · 18 min", tone: "warn", href: "/platform-console/data/imports/IMP-1042" },
      { id: "c", title: "Store C · Download failed", detail: "Customer journey · 7 min", tone: "bad", href: "/platform-console/incidents/INC-028" },
      { id: "b", title: "Store B · Access mismatch", detail: "Billing reconciliation · 1 hr", tone: "warn", href: "/platform-console/usage/billing" },
    ],
    operations: [
      { id: "1", tone: "good", title: "File received", detail: "Store A · queued durably" },
      { id: "2", tone: "warn", title: "Validation held publication", detail: "Prior good inventory retained" },
    ],
  },
};
