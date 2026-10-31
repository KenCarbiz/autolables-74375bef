import type { ActionReviewModel } from "@/lib/platformConsole/live/actions";
import type { ConnectionsModel, FilesComModel, MappingModel } from "@/lib/platformConsole/live/connections";
import type { Provenance } from "@/lib/platformConsole/types";

// Synthetic data for references D04, D05, D18, D17, T02, M02 and M06.
const prov: Provenance = { source: "fixture", asOf: "2026-10-31T09:30:00Z", state: "healthy", scope: "Synthetic stores" };
const configured = { tone: "good", label: "Configured" } as const;

export const CONNECTIONS_FIXTURE: ConnectionsModel = {
  rows: [
    { id: "filescom", name: "Files.com / feeds", configuration: configured, operation: { tone: "warn", label: "Import held" }, scope: "4 groups / 12 stores", lastChecked: "09:14 local", actionLabel: "Open detail", href: "/platform-console/connections/files-com" },
    { id: "marketcheck", name: "MarketCheck / data", configuration: configured, operation: { tone: "info", label: "Paused" }, scope: "8 subscribed stores", lastChecked: "09:10 local", actionLabel: "Open detail", href: "/platform-console/usage" },
    { id: "crawler", name: "Website crawler", configuration: configured, operation: { tone: "info", label: "Paused" }, scope: "Pilot stores only", lastChecked: "09:10 local", actionLabel: "Open detail", href: "/platform-console/reliability/monitoring" },
    { id: "billing", name: "Billing bridge", configuration: configured, operation: { tone: "warn", label: "Mismatch" }, scope: "Platform", lastChecked: "09:10 local", actionLabel: "Inspect access", href: "/platform-console/usage/billing" },
    { id: "email", name: "Email provider", configuration: configured, operation: { tone: "warn", label: "Unmonitored" }, scope: "Transactional", lastChecked: "No measurement", actionLabel: "Open setup", href: "/platform-console/reliability/monitoring" },
    { id: "storage", name: "Object storage", configuration: configured, operation: { tone: "good", label: "Healthy" }, scope: "Platform", lastChecked: "09:12 local", actionLabel: "Open detail", href: "/platform-console/reliability/monitoring" },
    { id: "realtime", name: "Realtime updates", configuration: configured, operation: { tone: "good", label: "Healthy" }, scope: "Authorized sessions", lastChecked: "12 sec ago", actionLabel: "Open detail", href: "/platform-console/reliability/monitoring" },
  ],
  note: "Test connection is a scoped diagnostic; it must disclose provider cost and side effects before running.",
};

export const FILESCOM_FIXTURE: FilesComModel = {
  metrics: [
    { key: "auth", icon: "lock", label: "Authentication", value: "Verified", tone: "good", helper: "Checked 09:10 · secret hidden", provenance: prov },
    { key: "webhook", icon: "plug", label: "Webhook delivery", value: "Receiving", tone: "good", helper: "Last accepted 09:12:04", provenance: prov },
    { key: "pipeline", icon: "warning", label: "Import pipeline", value: "Held", tone: "warn", helper: "Store A · schema change", provenance: prov },
    { key: "lag", icon: "clock", label: "End-to-end lag", value: "18 min", tone: "warn", helper: "Arrival → published inventory", provenance: prov },
  ],
  details: {
    site: "Site: example.files.com · server-side credential · production",
    credential: "Credential: configured · last rotated Oct 20",
    schedule: "Next expected feed: 10:00 local · delivery quiet is normal between feeds",
  },
  controlsNote: "Pause state and actor remain visible.",
  stages: [
    { key: "received", label: "Received", value: "09:12:04", tone: "good" },
    { key: "queued", label: "Queued", value: "09:12:05", tone: "good" },
    { key: "validated", label: "Validated", value: "Held", tone: "warn" },
    { key: "imported", label: "Imported", value: "Not started", tone: "info" },
    { key: "published", label: "Published", value: "Prior data kept", tone: "info" },
  ],
  feeds: [
    { id: "a", folder: "/prod/example/store-a", owner: "Store A", viewers: "Store B: view only", enrichment: "Owner authorization only", href: "/platform-console/connections/mapping" },
    { id: "b", folder: "/prod/example/store-b", owner: "Store B", viewers: "Store A: no access", enrichment: "Separate budget", href: "/platform-console/connections/mapping" },
  ],
  feedsNote: "",
  connectionState: [
    { label: "Authentication", state: { tone: "good", label: "Verified" } },
    { label: "Webhook", state: { tone: "good", label: "Receiving" } },
    { label: "Import pipeline", state: { tone: "warn", label: "Held" } },
  ],
  journey: {
    subtitle: "Store A · inventory.csv",
    importId: "IMP-1042",
    steps: [
      { id: "received", tone: "good", title: "Received 09:12", detail: "Checksum recorded" },
      { id: "queued", tone: "good", title: "Queued 09:12", detail: "Durable event receipt" },
      { id: "validation", tone: "warn", title: "Validation held", detail: "2 columns need review" },
      { id: "publish", tone: "info", title: "Import / publish", detail: "Not started; prior data retained" },
    ],
  },
};

export const MAPPING_FIXTURE: MappingModel = {
  ownership: [
    { key: "folder", label: "Folder", value: "/prod/example/a", tone: "info" },
    { key: "source", label: "Feed source", value: "SRC-A", tone: "info" },
    { key: "owner", label: "Owner", value: "Store A", tone: "good" },
    { key: "viewers", label: "Viewers", value: "Store B only", tone: "info" },
    { key: "enrichment", label: "Enrichment", value: "Store A budget", tone: "info" },
  ],
  rules: [
    { id: "vin", source: "vin", normalized: "vehicle VIN", transform: "Exact normalized identity", required: "Yes" },
    { id: "price", source: "selling_price", normalized: "price observation", transform: "Currency / basis retained", required: "Yes" },
    { id: "odometer", source: "odometer", normalized: "mileage", transform: "Miles · finite nonnegative", required: "For capped rules" },
    { id: "rooftop", source: "rooftop_id", normalized: "inventory owner", transform: "Explicit configured allowlist", required: "Yes" },
  ],
  rulesNote: "",
};

export const ACTION_FIXTURE: ActionReviewModel = {
  kind: "replay_import",
  actionId: "replay-import.IMP-1042",
  title: "Review operational action",
  phoneTitle: "Review replay",
  heading: "Review: replay retained import",
  subtitle: "Store A · IMP-1042 · this is a mutating action, not a refresh",
  rows: [
    { label: "Scope", value: "1 retained file · Store A only" },
    { label: "Expected changes", value: "12 additions · 4 updates · 0 removals" },
    { label: "Provider calls", value: "None; retained file only" },
    { label: "Preconditions", value: "Mapping validated · latest inventory version checked" },
    { label: "Duplicate protection", value: "Operation key required; already-applied run refused" },
  ],
  executeLabel: "Execute replay",
  reasonDraft: "Corrected source mapping after schema change",
  scope: "Store A · IMP-1042",
  previewVersion: "preview-1042",
  backHref: "/platform-console/data/imports/IMP-1042",
  phone: {
    heading: "Replay retained import",
    subtitle: "Store A only · no provider calls",
    rows: [
      { label: "Retained file", value: "IMP-1042" },
      { label: "Expected changes", value: "12 added · 4 updated · 0 removed" },
      { label: "Preconditions", value: "Validated mapping / current version" },
      { label: "Duplicate protection", value: "Idempotency key required" },
    ],
    reasonPlaceholder: "Why is this needed?",
    note: "Recheck scope before applying.",
  },
  recognised: true,
};

export const ACTION_PHONE_FIXTURE: ActionReviewModel = {
  ...ACTION_FIXTURE,
  reasonDraft: "Corrected source mapping",
};
