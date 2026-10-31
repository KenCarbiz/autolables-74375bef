import type { TemplatesModel } from "@/lib/platformConsole/live/templates";

// Synthetic data for reference D13.
export const TEMPLATES_FIXTURE: TemplatesModel = {
  rows: [
    { id: "1", name: "Retail addendum", version: "v12", validation: { label: "Passed", tone: "good" }, failures: "0 in measured window", actionLabel: "Open template", href: "/platform-console/templates" },
    { id: "2", name: "Used window sticker", version: "v8", validation: { label: "Passed", tone: "good" }, failures: "0 in measured window", actionLabel: "Open template", href: "/platform-console/templates" },
    { id: "3", name: "Buyer’s Guide", version: "v5", validation: { label: "Review", tone: "warn" }, failures: "1 missing warranty input", actionLabel: "Inspect issue", href: "/platform-console/templates" },
    { id: "4", name: "Passport QR destination", version: "Current", validation: { label: "Degraded", tone: "bad" }, failures: "Download journey failed", actionLabel: "Open incident", href: "/platform-console/incidents/INC-029" },
  ],
  rowsNote: "",
  safeguardsHelper: "Validate a synthetic output before publishing a new version.",
  stages: [
    { key: "draft", label: "Draft", value: "Edit", tone: "info" },
    { key: "validate", label: "Validate", value: "Required fields", tone: "good" },
    { key: "preview", label: "Preview", value: "PDF / QR", tone: "good" },
    { key: "review", label: "Review", value: "Store impact", tone: "info" },
    { key: "publish", label: "Publish", value: "Version retained", tone: "info" },
  ],
};
