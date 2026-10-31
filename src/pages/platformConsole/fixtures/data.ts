import type { FeedsModel, ImportModel, LineageModel, QualityModel, RatingsModel } from "@/lib/platformConsole/live/data";
import type { Provenance } from "@/lib/platformConsole/types";

// Synthetic data for references D06 to D10 and M03.
const prov: Provenance = { source: "fixture", asOf: "2026-10-31T09:30:00Z", state: "healthy", scope: "Synthetic stores" };
const imp = (id: string) => `/platform-console/data/imports/${id}`;

export const FEEDS_FIXTURE: FeedsModel = {
  windowHours: 24,
  stores: [
    { id: "a", name: "Store A" },
    { id: "b", name: "Store B" },
  ],
  rows: [
    { id: "IMP-1042", label: "IMP-1042 / Store A", storeId: "a", storeName: "Store A", received: "Today 09:12", stage: { tone: "warn", label: "Held" }, rows: "130 received", publication: "Not applied", href: imp("IMP-1042") },
    { id: "IMP-1041", label: "IMP-1041 / Store B", storeId: "b", storeName: "Store B", received: "Today 08:30", stage: { tone: "good", label: "Complete" }, rows: "89 accepted", publication: "89 current", href: imp("IMP-1041") },
    { id: "IMP-1040", label: "IMP-1040 / Store A", storeId: "a", storeName: "Store A", received: "Today 08:14", stage: { tone: "good", label: "Complete" }, rows: "128 accepted", publication: "128 current", href: imp("IMP-1040") },
    { id: "IMP-1039", label: "IMP-1039 / Store D", storeId: "d", storeName: "Store D", received: "Yesterday 22:00", stage: { tone: "bad", label: "Rejected" }, rows: "2,100 received", publication: "Wrong store ID", href: imp("IMP-1039") },
    { id: "IMP-1038", label: "IMP-1038 / Store C", storeId: "c", storeName: "Store C", received: "Yesterday 20:10", stage: { tone: "good", label: "Complete" }, rows: "204 accepted", publication: "204 current", href: imp("IMP-1038") },
  ],
  rowsNote: "",
  reconciliation: "1 received file has no completed import · 0 unexplained duplicate imports · last comparison 09:14",
};

export const IMPORT_FIXTURE: ImportModel = {
  title: "Import IMP-1042",
  subtitle: "Store A · inventory.csv · checksum verified · received 09:12 local",
  stages: [
    { key: "received", label: "Received", value: "File retained", tone: "good" },
    { key: "verified", label: "Verified", value: "Checksum recorded", tone: "good" },
    { key: "validated", label: "Validated", value: "2 missing columns", tone: "warn" },
    { key: "imported", label: "Imported", value: "Blocked", tone: "info" },
    { key: "published", label: "Published", value: "No change", tone: "info" },
  ],
  findings: [
    { id: "odometer", finding: "Required column missing", field: "odometer", effect: "Mileage eligibility unavailable", phoneTitle: "Required field missing", phoneDetail: "odometer → mileage" },
    { id: "renamed", finding: "Renamed column detected", field: "selling_price → price", effect: "Mapping review required", phoneTitle: "Source column renamed", phoneDetail: "selling_price → price" },
  ],
  findingsNote: "Never archive inventory from a rejected or incomplete snapshot",
  evidence: ["130 source rows · 0 published changes", "Previous good snapshot: IMP-1040", "Correlation: SYN-TRACE-1042"],
  evidenceNote: "Immutable attempt ID · synthetic payload",
  phoneEvidence: ["130 received · 0 published changes", "Prior snapshot: IMP-1040", "Trace: SYN-TRACE-1042"],
  banner: { tone: "warn", text: "HELD · NO LISTING CHANGE" },
  runId: "IMP-1042",
  canReplay: true,
};

export const QUALITY_FIXTURE: QualityModel = {
  metrics: [
    { key: "publishable", icon: "check", label: "Publishable records", value: "94.6%", tone: "good", helper: "Current sampled window", provenance: prov },
    { key: "price", icon: "dollar", label: "Price conflicts", value: "7", tone: "warn", helper: "Promotion held", provenance: prov },
    { key: "missing", icon: "file", label: "Missing required data", value: "12", tone: "warn", helper: "Across 3 stores", provenance: prov },
    { key: "schema", icon: "layers", label: "Schema changes", value: "1", tone: "warn", helper: "Mapping review required", provenance: prov },
  ],
  issues: [
    { id: "year", issue: "Missing model year", store: "Store A", affected: "3 vehicles", impact: "Payment / rating unavailable", actionLabel: "Open records", href: "/platform-console/stores/store-a" },
    { id: "fee", issue: "Unknown fee basis", store: "Store B", affected: "7 vehicles", impact: "Price promotion held", actionLabel: "Open records", href: "/platform-console/stores/store-b" },
    { id: "mileage", issue: "Missing mileage", store: "Store A", affected: "9 vehicles", impact: "Capped terms ineligible", actionLabel: "Open records", href: "/platform-console/stores/store-a" },
    { id: "photo", issue: "Photo URL failure", store: "Store C", affected: "4 vehicles", impact: "Customer image unavailable", actionLabel: "Open records", href: "/platform-console/stores/store-c" },
    { id: "schema", issue: "Source field renamed", store: "Store A", affected: "1 feed", impact: "Import quarantined", actionLabel: "Open import", href: imp("IMP-1042") },
  ],
  issuesNote: "",
  footnote: "Counts can overlap across categories. Every issue includes source, observed time, owner and resolution history.",
};

export const LINEAGE_FIXTURE: LineageModel = {
  title: "Vehicle data inspection",
  subtitle: "Example vehicle EX-001 · Store A · synthetic record; not an actual VIN",
  stages: [
    { key: "source", label: "Source file", value: "IMP-1040", tone: "good" },
    { key: "observation", label: "Observation", value: "OBS-EX-001", tone: "good" },
    { key: "normalized", label: "Normalized", value: "Version 18", tone: "good" },
    { key: "calculation", label: "Calculation", value: "RATING-v3", tone: "warn" },
    { key: "passport", label: "Passport", value: "Published v18", tone: "good" },
  ],
  rows: [
    { id: "price", field: "Selling price", observation: "$30,000 / feed", effective: "$30,000", basis: "Fee basis confirmed · 1h ago", actionLabel: "Inspect evidence", href: imp("IMP-1040") },
    { id: "web", field: "Website price", observation: "$29,105 / observation", effective: "Not promoted", basis: "Fee basis unknown · held", actionLabel: "Inspect evidence", href: "/platform-console/data/quality" },
    { id: "mileage", field: "Mileage", observation: "24,500 / feed", effective: "24,500 mi", basis: "Timestamped source · 1h ago", actionLabel: "Inspect history", href: "/platform-console/data/quality" },
    { id: "condition", field: "Condition", observation: "Used / feed", effective: "Used", basis: "No inferred CPO status", actionLabel: "Inspect source", href: "/platform-console/data/quality" },
    { id: "rating", field: "Market rating", observation: "Insufficient fresh comps", effective: "Withheld", basis: "3 comparisons stale", actionLabel: "Open calculation", href: "/platform-console/data/ratings" },
  ],
  traceNote: "Current published price is independent of a newer held observation. No silent overwrite.",
};

export const RATINGS_FIXTURE: RatingsModel = {
  metrics: [
    { key: "eligible", icon: "activity", label: "Eligible for rating", value: "114 / 128", tone: "info", helper: "Current inputs only", provenance: prov },
    { key: "withheld", icon: "warning", label: "Withheld", value: "14", tone: "warn", helper: "Insufficient or stale inputs", provenance: prov },
    { key: "failures", icon: "check", label: "Calculation failures", value: "0", tone: "good", helper: "Measured completed attempts", provenance: prov },
    { key: "algorithm", icon: "layers", label: "Published algorithm", value: "v3", tone: "info", helper: "Inputs and output versioned", provenance: prov },
  ],
  reasons: [
    { id: "stale", reason: "Stale comparable listings", vehicles: "8", next: "Refresh only within approved budget" },
    { id: "trim", reason: "Missing mileage or trim", vehicles: "4", next: "Review source data" },
    { id: "basis", reason: "Unresolved price basis", vehicles: "2", next: "Inspect price observations", href: "/platform-console/data/vehicles/EX-001" },
  ],
  reasonsNote: "",
  release: [{ text: "Active: v3 · previous: v2", strong: true }, { text: "Drift comparison: available" }, { text: "Rollout: controlled cohort" }],
  releaseNote: "Version, validation and rollback",
  footnote: "Vehicle condition evidence is not a price score. Keep provenance and meaning separate.",
};
