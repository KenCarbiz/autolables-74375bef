import type { StoreModel, StoresModel } from "@/lib/platformConsole/live/stores";
import type { Provenance } from "@/lib/platformConsole/types";

// Synthetic data for references D02 and D03. Never a production default.
const prov: Provenance = { source: "fixture", asOf: "2026-10-31T09:30:00Z", state: "healthy", scope: "Synthetic stores" };

export const STORES_FIXTURE: StoresModel = {
  metrics: [
    { key: "subscribed", icon: "store", label: "Subscribed stores", value: "12", tone: "info", helper: "Across 4 dealer groups", provenance: prov },
    { key: "healthy", icon: "check", label: "Operationally healthy", value: "9", tone: "good", helper: "Measured health only", provenance: prov },
    { key: "onboarding", icon: "layers", label: "Onboarding", value: "2", tone: "warn", helper: "Checklist incomplete", provenance: prov },
    { key: "sharing", icon: "lock", label: "Data sharing exceptions", value: "1", tone: "warn", helper: "Needs scope review", provenance: prov },
  ],
  rows: [
    { id: "store-a", name: "Store A / Example Group", account: { tone: "good", label: "Active" }, health: { tone: "warn", label: "Attention" }, published: "128 vehicles", lastImport: "Today 08:14 · 1h ago", actionLabel: "Open store", href: "/platform-console/stores/store-a" },
    { id: "store-b", name: "Store B / Example Group", account: { tone: "good", label: "Active" }, health: { tone: "warn", label: "Attention" }, published: "89 vehicles", lastImport: "Today 08:30 · 45m ago", actionLabel: "Open store", href: "/platform-console/stores/store-b" },
    { id: "store-c", name: "Store C / Demo Group", account: { tone: "good", label: "Active" }, health: { tone: "bad", label: "Degraded" }, published: "204 vehicles", lastImport: "Today 09:00 · 15m ago", actionLabel: "Open store", href: "/platform-console/stores/store-c" },
    { id: "store-d", name: "Store D / Demo Group", account: { tone: "info", label: "Trial" }, health: { tone: "warn", label: "Setup" }, published: "Not published", lastImport: "No successful import", actionLabel: "Open setup", href: "/platform-console/stores/store-d" },
  ],
  rowsNote: "",
};

export const STORE_FIXTURE: StoreModel = {
  title: "Example Motors / Store A",
  subtitle: "Tenant group: Example Auto Group · Store ownership and sharing are explicit.",
  metrics: [
    { key: "account", icon: "store", label: "Account", value: "Active", tone: "good", helper: "Plan and billing checked 09:10", provenance: prov },
    { key: "inventory", icon: "car", label: "Inventory", value: "128", tone: "info", helper: "Published · last success 08:14", provenance: prov },
    { key: "incidents", icon: "warning", label: "Open incidents", value: "1", tone: "warn", helper: "Import held; prior inventory retained", provenance: prov },
    { key: "members", icon: "users", label: "Members", value: "6", tone: "info", helper: "2 managers · 4 staff", provenance: prov },
  ],
  connections: [
    { id: "filescom", name: "Files.com", state: { tone: "warn", label: "Held" }, lastWork: "08:14 inventory import" },
    { id: "market", name: "Market data", state: { tone: "info", label: "Paused" }, lastWork: "Oct 29 · intentional hold" },
    { id: "passport", name: "Public Passport", state: { tone: "good", label: "Healthy" }, lastWork: "Synthetic check 09:12" },
  ],
  sharing: [
    { text: "Owner: Store A", strong: true },
    { text: "Store B: view inventory only" },
    { text: "Store C: no access" },
  ],
  sharingNote: "Default deny · explicitly approved relations only",
  checklist: [
    { key: "identity", label: "Identity", value: "Complete", tone: "good" },
    { key: "feed", label: "Feed", value: "Configured", tone: "good" },
    { key: "checks", label: "Data checks", value: "Attention", tone: "warn" },
    { key: "billing", label: "Billing", value: "Active", tone: "good" },
    { key: "launch", label: "Launch", value: "Pending", tone: "warn" },
  ],
};
