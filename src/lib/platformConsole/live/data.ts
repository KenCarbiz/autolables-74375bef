import type { MetricModel, StageModel, Tone } from "../types";
import { consolePath } from "../sections";
import { importLabel } from "./actions";
import { readRows, settle } from "./read";
import { clockTime, dayTime, plural, provenance, unknownMetric, type ToneLabel } from "./shared";

// Feed activity, import detail, data quality, vehicle lineage and ratings.
// Read-only. Where nothing is recorded (rating runs) the model says Not
// monitored instead of inventing a number.

interface RunRow { id: string; path: string; kind: string; status: string; failure_reason: string | null; started_at: string; finished_at: string | null; content_sha256: string | null; binding_status: string | null; report: unknown }
interface SnapRow { id: string; run_id: string | null; path: string; store_id: string | null; status: string; reason: string | null; row_count: number | null; valid_count: number | null; invalid_count: number | null; content_sha256: string | null; created_at: string; applied_at: string | null }
interface StoreName { id: string; display_name: string }

const eq = (col: string, value: unknown) => ({ col, op: "eq" as const, value });
const humanize = (s: string | null | undefined) => (s ? s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "");
const HELD = new Set(["quarantined", "rejected", "failed"]);
const fileName = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

// ── Feed activity ─────────────────────────────────────────────────────────

export interface FeedActivityRow {
  id: string;
  label: string;
  storeId: string | null;
  storeName: string;
  received: string;
  stage: ToneLabel;
  rows: string;
  publication: string;
  href: string;
}
export interface FeedsModel { windowHours: number; rows: FeedActivityRow[]; rowsNote: string; reconciliation: string; stores: { id: string; name: string }[] }

export async function loadFeeds(hours = 24, now = Date.now()): Promise<FeedsModel> {
  const since = new Date(now - hours * 3_600_000).toISOString();
  const [runs, snaps, stores, events] = await Promise.all([
    settle(readRows<RunRow>("inventory_feed_runs", "id,path,kind,status,failure_reason,started_at,finished_at,content_sha256,binding_status,report", { filters: [eq("kind", "import"), { col: "started_at", op: "gte", value: since }], order: "started_at", limit: 200 })),
    settle(readRows<SnapRow>("inventory_store_snapshots", "id,run_id,path,store_id,status,reason,row_count,valid_count,invalid_count,content_sha256,created_at,applied_at", { filters: [{ col: "created_at", op: "gte", value: since }], order: "created_at", limit: 500 })),
    settle(readRows<StoreName>("dealer_stores", "id,display_name", { limit: 1000 })),
    settle(readRows<{ id: string; path: string; received_at: string }>("inventory_feed_events", "id,path,received_at", { filters: [{ col: "received_at", op: "gte", value: since }], order: "received_at", limit: 1000 })),
  ]);
  if (!runs.ok) throw new Error(`Import runs are not readable: ${runs.error}`);
  const names = new Map((stores.ok ? stores.value : []).map((s) => [s.id, s.display_name]));
  const snapByRun = new Map<string, SnapRow>();
  for (const s of snaps.ok ? snaps.value : []) if (s.run_id && !snapByRun.has(s.run_id)) snapByRun.set(s.run_id, s);

  const rows: FeedActivityRow[] = runs.value.map((r) => {
    const s = snapByRun.get(r.id);
    const held = s ? HELD.has(s.status) && s.status !== "failed" : false;
    const failed = r.status === "failed" || r.status === "rejected" || s?.status === "rejected";
    const stage: ToneLabel = r.status === "running" ? { tone: "info", label: "Running" } : failed ? { tone: "bad", label: r.status === "failed" ? "Failed" : "Rejected" } : held ? { tone: "warn", label: "Held" } : s?.status === "applied" || r.status === "applied" || r.status === "passed" ? { tone: "good", label: "Complete" } : { tone: "neutral", label: humanize(r.status) };
    const count = s?.row_count ?? null;
    const complete = stage.label === "Complete";
    return {
      id: r.id,
      label: `${importLabel(r.id)} / ${s?.store_id ? names.get(s.store_id) ?? "Unresolved store" : "Unresolved store"}`,
      storeId: s?.store_id ?? null,
      storeName: s?.store_id ? names.get(s.store_id) ?? "Unresolved store" : "Unresolved store",
      received: dayTime(r.started_at, now),
      stage,
      rows: count === null ? "Not recorded" : complete ? `${(s?.valid_count ?? count).toLocaleString("en-US")} accepted` : `${count.toLocaleString("en-US")} received`,
      publication: complete ? (s?.valid_count != null ? `${s.valid_count.toLocaleString("en-US")} current` : "Current") : stage.tone === "info" ? "In progress" : s?.reason ? humanize(s.reason) : r.failure_reason ? humanize(r.failure_reason) : "Not applied",
      href: consolePath.importRun(r.id),
    };
  });

  let reconciliation: string;
  if (events.ok) {
    const lastRunByPath = new Map<string, string>();
    for (const r of runs.value) if (!lastRunByPath.has(r.path)) lastRunByPath.set(r.path, r.started_at);
    const unmatched = new Set<string>();
    for (const e of events.value) {
      const run = lastRunByPath.get(e.path);
      if (!run || run < e.received_at) unmatched.add(e.path);
    }
    const seen = new Map<string, number>();
    for (const s of snaps.ok ? snaps.value : []) if (s.status === "applied" && s.content_sha256) seen.set(`${s.store_id}:${s.content_sha256}`, (seen.get(`${s.store_id}:${s.content_sha256}`) ?? 0) + 1);
    const dupes = [...seen.values()].filter((n) => n > 1).length;
    reconciliation = `${plural(unmatched.size, "received file")} ${unmatched.size === 1 ? "has" : "have"} no completed import · ${plural(dupes, "duplicate import")} · compared at ${clockTime(new Date(now).toISOString())}`;
  } else {
    reconciliation = "File receipt could not be read, so reconciliation is unknown.";
  }
  const storeOptions = [...new Map(rows.filter((r) => r.storeId).map((r) => [r.storeId as string, r.storeName])).entries()].map(([id, name]) => ({ id, name }));
  return { windowHours: hours, rows, rowsNote: `No import runs in the last ${hours === 24 ? "24 hours" : `${hours / 24} days`}. Quiet between scheduled feeds can be normal.`, reconciliation, stores: storeOptions };
}

// ── Import detail ─────────────────────────────────────────────────────────

export interface FindingRow { id: string; finding: string; field: string; effect: string; phoneTitle?: string; phoneDetail?: string }
export interface ImportModel {
  title: string;
  subtitle: string;
  stages: StageModel[];
  findings: FindingRow[];
  findingsNote: string;
  evidence: string[];
  evidenceNote: string;
  /** Phone wording; falls back to evidence. */
  phoneEvidence?: string[];
  /** Phone chip, e.g. "HELD · NO LISTING CHANGE". */
  banner: { tone: Tone; text: string } | null;
  runId: string;
  canReplay: boolean;
}

interface ReportShape {
  outcome?: string;
  rejectReasons?: string[];
  headers?: { missing?: string[]; extra?: string[] };
  partitions?: { reasons?: string[]; errors?: { code: string; detail?: string }[]; counts?: { rows?: number }; inventoryDiff?: { additions?: number; updates?: number } | null }[];
}

export async function loadImport(runId: string, now = Date.now()): Promise<ImportModel> {
  const runs = await settle(readRows<RunRow>("inventory_feed_runs", "id,path,kind,status,failure_reason,started_at,finished_at,content_sha256,binding_status,report", { filters: [eq("id", runId)], limit: 1 }));
  if (!runs.ok) throw new Error(`The import run is not readable: ${runs.error}`);
  const run = runs.value[0];
  if (!run) throw new Error("This import run was not found in your authorized scope.");
  const [snaps, files] = await Promise.all([
    settle(readRows<SnapRow>("inventory_store_snapshots", "id,run_id,path,store_id,status,reason,row_count,valid_count,invalid_count,content_sha256,created_at,applied_at", { filters: [eq("run_id", runId)], limit: 10 })),
    settle(readRows<{ id: string; status: string }>("inventory_feed_files", "id,status", { filters: [eq("path", run.path)], limit: 1 })),
  ]);
  const snap = snaps.ok ? snaps.value[0] : undefined;
  const store = snap?.store_id ? await settle(readRows<StoreName>("dealer_stores", "id,display_name", { filters: [eq("id", snap.store_id)], limit: 1 })) : null;
  const previous = snap?.store_id ? await settle(readRows<SnapRow>("inventory_store_snapshots", "id,run_id,path,store_id,status,reason,row_count,valid_count,invalid_count,content_sha256,created_at,applied_at", { filters: [eq("store_id", snap.store_id), eq("status", "applied")], order: "created_at", limit: 5 })) : null;
  const prior = previous?.ok ? previous.value.find((p) => p.run_id && p.run_id !== runId && p.created_at < (snap?.created_at ?? run.started_at)) : undefined;
  const storeName = store?.ok && store.value[0] ? store.value[0].display_name : "Unresolved store";
  const report = (run.report ?? {}) as ReportShape;
  const missing = report.headers?.missing ?? [];
  const extra = report.headers?.extra ?? [];
  const held = (snap ? HELD.has(snap.status) : false) || run.status === "rejected" || run.status === "failed";
  const applied = snap?.status === "applied";

  const findings: FindingRow[] = [
    ...missing.map((c) => ({ id: `m-${c}`, finding: "Required column missing", field: c, effect: "Import blocked until the column is mapped" })),
    ...extra.map((c) => ({ id: `x-${c}`, finding: "Unrecognised column", field: c, effect: "Ignored until a mapping is approved" })),
    ...(report.rejectReasons ?? []).map((r) => ({ id: `r-${r}`, finding: humanize(r), field: "Whole file", effect: "Snapshot not applied" })),
    ...(report.partitions ?? []).flatMap((p, i) => (p.errors ?? []).slice(0, 5).map((e, j) => ({ id: `e-${i}-${j}`, finding: humanize(e.code), field: e.detail ?? "Row", effect: "Row excluded from the snapshot" }))),
  ];
  if (!findings.length && (snap?.reason || run.failure_reason)) findings.push({ id: "reason", finding: humanize(snap?.reason ?? run.failure_reason), field: "Whole file", effect: "Snapshot not applied" });

  const stages: StageModel[] = [
    { key: "received", label: "Received", value: files.ok && files.value[0] ? "File retained" : files.ok ? "File not recorded" : "Unknown", tone: files.ok && files.value[0] ? "good" : "neutral" },
    { key: "verified", label: "Verified", value: run.content_sha256 ? "Checksum recorded" : "No checksum recorded", tone: run.content_sha256 ? "good" : "warn" },
    { key: "validated", label: "Validated", value: missing.length ? `${plural(missing.length, "missing column")}` : held ? "Held" : snap ? "Passed" : "Not recorded", tone: missing.length || held ? "warn" : snap ? "good" : "neutral" },
    { key: "imported", label: "Imported", value: applied ? "Complete" : held ? "Blocked" : run.status === "running" ? "Running" : "Not started", tone: applied ? "good" : "info" },
    { key: "published", label: "Published", value: applied ? `${(snap?.valid_count ?? 0).toLocaleString("en-US")} current` : "No change", tone: applied ? "good" : "info" },
  ];

  const sourceRows = snap?.row_count ?? report.partitions?.[0]?.counts?.rows ?? null;
  const diff = report.partitions?.[0]?.inventoryDiff;
  const published = applied ? (diff ? (diff.additions ?? 0) + (diff.updates ?? 0) : snap?.valid_count ?? 0) : 0;
  const evidence = [
    sourceRows === null ? "Source rows not recorded" : `${sourceRows.toLocaleString("en-US")} source rows · ${plural(published, "published change")}`,
    prior?.run_id ? `Previous good snapshot: ${importLabel(prior.run_id)}` : "Previous good snapshot: none recorded",
    `Correlation: ${run.id}`,
  ];

  return {
    title: `Import ${importLabel(runId)}`,
    subtitle: `${storeName} · ${fileName(run.path)} · ${run.content_sha256 ? "checksum recorded" : "no checksum"} · received ${clockTime(run.started_at)} local`,
    stages,
    findings,
    findingsNote: held ? "Never archive inventory from a rejected or incomplete snapshot" : "No validation findings are recorded for this run.",
    evidence,
    evidenceNote: "Immutable attempt ID · sanitized evidence only",
    banner: held ? { tone: "warn", text: "HELD · NO LISTING CHANGE" } : null,
    runId,
    canReplay: true,
  };
}

// ── Data quality ──────────────────────────────────────────────────────────

export interface QualityIssue { id: string; issue: string; store: string; affected: string; impact: string; actionLabel: string; href: string }
export interface QualityModel { metrics: MetricModel[]; issues: QualityIssue[]; issuesNote: string; footnote: string }

interface InvRow { store_id: string; year: number | null; mileage: number | null; feed_price_status: string; photo_count: number | null; presence: string }

export async function loadQuality(now = Date.now()): Promise<QualityModel> {
  const [inv, stores, snaps] = await Promise.all([
    settle(readRows<InvRow>("store_inventory", "store_id,year,mileage,feed_price_status,photo_count,presence", { filters: [eq("presence", "present")], limit: 5000 })),
    settle(readRows<StoreName>("dealer_stores", "id,display_name", { limit: 1000 })),
    settle(readRows<RunRow>("inventory_feed_runs", "id,path,kind,status,failure_reason,started_at,finished_at,content_sha256,binding_status,report", { order: "started_at", limit: 50 })),
  ]);
  const asOf = new Date(now).toISOString();
  const names = new Map((stores.ok ? stores.value : []).map((s) => [s.id, s.display_name]));
  const scope = "Present inventory";
  const issues: QualityIssue[] = [];
  const metrics: MetricModel[] = [];
  const storeLabel = (ids: string[]) => (ids.length === 1 ? names.get(ids[0]) ?? "Unresolved store" : `${ids.length} stores`);

  if (inv.ok) {
    const rows = inv.value;
    const group = (label: string, impact: string, pred: (r: InvRow) => boolean) => {
      const hit = rows.filter(pred);
      if (!hit.length) return 0;
      const ids = [...new Set(hit.map((r) => r.store_id))];
      issues.push({ id: label, issue: label, store: storeLabel(ids), affected: plural(hit.length, "vehicle"), impact, actionLabel: "Open records", href: ids.length === 1 ? consolePath.store(ids[0]) : consolePath.stores() });
      return hit.length;
    };
    const noYear = group("Missing model year", "Payment and rating unavailable", (r) => r.year === null);
    const noPrice = group("Unknown fee basis", "Price promotion held", (r) => r.feed_price_status === "unknown");
    const noMileage = group("Missing mileage", "Capped terms ineligible", (r) => r.mileage === null);
    group("No photos", "Customer image unavailable", (r) => (r.photo_count ?? 0) === 0);
    const publishable = rows.filter((r) => r.year !== null && r.mileage !== null && r.feed_price_status === "known").length;
    const missingStores = new Set(rows.filter((r) => r.year === null || r.mileage === null).map((r) => r.store_id)).size;
    metrics.push(
      rows.length
        ? { key: "publishable", icon: "check", label: "Publishable records", value: `${((publishable / rows.length) * 100).toFixed(1)}%`, tone: publishable === rows.length ? "good" : "warn", helper: `${publishable.toLocaleString("en-US")} / ${rows.length.toLocaleString("en-US")} present vehicles`, provenance: provenance("store_inventory", "healthy", scope, asOf) }
        : { key: "publishable", icon: "check", label: "Publishable records", value: "No vehicles", tone: "neutral", helper: "No present inventory is recorded", provenance: provenance("store_inventory", "healthy", scope, asOf) },
      { key: "price", icon: "dollar", label: "Unresolved prices", value: String(noPrice), tone: noPrice ? "warn" : "good", helper: noPrice ? "Promotion held" : "No unknown fee basis", provenance: provenance("store_inventory", "healthy", scope, asOf) },
      { key: "missing", icon: "file", label: "Missing required data", value: String(noYear + noMileage), tone: noYear + noMileage ? "warn" : "good", helper: `Across ${plural(missingStores, "store")}`, provenance: provenance("store_inventory", "healthy", scope, asOf) },
    );
  } else {
    metrics.push(
      unknownMetric({ key: "publishable", icon: "check", label: "Publishable records" }, "store_inventory", scope, "Inventory is not readable yet"),
      unknownMetric({ key: "price", icon: "dollar", label: "Unresolved prices" }, "store_inventory", scope, "Inventory is not readable yet"),
      unknownMetric({ key: "missing", icon: "file", label: "Missing required data" }, "store_inventory", scope, "Inventory is not readable yet"),
    );
  }

  const renamed = snaps.ok ? snaps.value.filter((r) => ((r.report ?? {}) as ReportShape).headers?.missing?.length) : [];
  if (renamed.length) {
    const r = renamed[0];
    issues.push({ id: "schema", issue: "Source column missing", store: "Feed", affected: plural(renamed.length, "run"), impact: "Import quarantined", actionLabel: "Open import", href: consolePath.importRun(r.id) });
  }
  metrics.push(
    snaps.ok
      ? { key: "schema", icon: "layers", label: "Schema changes", value: String(renamed.length), tone: renamed.length ? "warn" : "good", helper: renamed.length ? "Mapping review required" : "No missing columns in recent runs", provenance: provenance("inventory_feed_runs", "healthy", "Recent runs", asOf) }
      : unknownMetric({ key: "schema", icon: "layers", label: "Schema changes" }, "inventory_feed_runs", "Recent runs", "Run history is not readable yet"),
  );
  return { metrics, issues, issuesNote: inv.ok ? "No data-quality issues are recorded for present inventory." : "Inventory is not readable, so quality is unknown.", footnote: "Counts can overlap across categories. Every issue includes source, observed time, owner and resolution history." };
}

// ── Vehicle lineage ───────────────────────────────────────────────────────

export interface LineageRow { id: string; field: string; observation: string; effective: string; basis: string; actionLabel: string; href: string }
export interface LineageModel { title: string; subtitle: string; stages: StageModel[]; rows: LineageRow[]; traceNote: string }

interface VehicleRow { id: string; store_id: string; vin: string; stock_number: string | null; year: number | null; make: string | null; mileage: number | null; condition: string | null; certified: boolean | null; feed_price: number | null; feed_price_status: string; feed_price_observed_at: string | null; last_seen_at: string | null; last_snapshot_id: string | null; listing_id: string | null; presence: string }

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

export async function loadLineage(vehicleId: string, now = Date.now()): Promise<LineageModel> {
  const v = await settle(readRows<VehicleRow>("store_inventory", "id,store_id,vin,stock_number,year,make,mileage,condition,certified,feed_price,feed_price_status,feed_price_observed_at,last_seen_at,last_snapshot_id,listing_id,presence", { filters: [eq("id", vehicleId)], limit: 1 }));
  if (!v.ok) throw new Error(`The vehicle is not readable: ${v.error}`);
  const car = v.value[0];
  if (!car) throw new Error("This vehicle was not found in your authorized scope.");
  const [store, snap] = await Promise.all([
    settle(readRows<StoreName>("dealer_stores", "id,display_name", { filters: [eq("id", car.store_id)], limit: 1 })),
    car.last_snapshot_id ? settle(readRows<SnapRow>("inventory_store_snapshots", "id,run_id,path,store_id,status,reason,row_count,valid_count,invalid_count,content_sha256,created_at,applied_at", { filters: [eq("id", car.last_snapshot_id)], limit: 1 })) : Promise.resolve(null),
  ]);
  const storeName = store.ok && store.value[0] ? store.value[0].display_name : "Unresolved store";
  const s = snap?.ok ? snap.value[0] : undefined;
  const ago = (iso: string | null) => (iso ? dayTime(iso, now) : "time not recorded");
  const priceKnown = car.feed_price_status === "known" && car.feed_price !== null;
  const stages: StageModel[] = [
    { key: "source", label: "Source file", value: s?.run_id ? importLabel(s.run_id) : "Not recorded", tone: s?.run_id ? "good" : "neutral" },
    { key: "observation", label: "Observation", value: `OBS-${car.id.replace(/-/g, "").slice(0, 6).toUpperCase()}`, tone: "good" },
    { key: "normalized", label: "Normalized", value: car.last_seen_at ? `Seen ${ago(car.last_seen_at)}` : "Not recorded", tone: car.last_seen_at ? "good" : "neutral" },
    { key: "calculation", label: "Calculation", value: "Not monitored", tone: "neutral" },
    { key: "passport", label: "Passport", value: car.listing_id ? "Listing linked" : "No listing", tone: car.listing_id ? "good" : "neutral" },
  ];
  const fresh = car.feed_price_observed_at ? dayTime(car.feed_price_observed_at, now) : "time not recorded";
  const rows: LineageRow[] = [
    { id: "price", field: "Selling price", observation: priceKnown ? `${usd(car.feed_price as number)} / feed` : "No price in feed", effective: priceKnown ? usd(car.feed_price as number) : "Not promoted", basis: priceKnown ? `Fee basis confirmed · ${fresh}` : `Fee basis ${car.feed_price_status} · held`, actionLabel: "Inspect evidence", href: s?.run_id ? consolePath.importRun(s.run_id) : consolePath.feeds() },
    { id: "web", field: "Website price", observation: "Not recorded", effective: "Not promoted", basis: "No website observation is recorded", actionLabel: "Inspect evidence", href: consolePath.quality() },
    { id: "mileage", field: "Mileage", observation: car.mileage === null ? "Missing in feed" : `${car.mileage.toLocaleString("en-US")} / feed`, effective: car.mileage === null ? "Unknown" : `${car.mileage.toLocaleString("en-US")} mi`, basis: `Timestamped source · ${ago(car.last_seen_at)}`, actionLabel: "Inspect history", href: consolePath.quality() },
    { id: "condition", field: "Condition", observation: car.condition ? `${humanize(car.condition)} / feed` : "Missing in feed", effective: car.condition ? humanize(car.condition) : "Unknown", basis: car.certified ? "Certified flag supplied by feed" : "No inferred CPO status", actionLabel: "Inspect source", href: consolePath.quality() },
    { id: "rating", field: "Market rating", observation: "Not monitored", effective: "Withheld", basis: "No rating run is recorded", actionLabel: "Open calculation", href: consolePath.ratings() },
  ];
  return {
    title: "Vehicle data inspection",
    subtitle: `${[car.year, car.make].filter(Boolean).join(" ") || "Vehicle"} · ${storeName} · VIN ending ${car.vin.slice(-6)}`,
    stages,
    rows,
    traceNote: "Current published price is independent of a newer held observation. No silent overwrite.",
  };
}

// ── Calculations and ratings ──────────────────────────────────────────────

export interface RatingsModel {
  metrics: MetricModel[];
  reasons: { id: string; reason: string; vehicles: string; next: string; href?: string }[];
  reasonsNote: string;
  release: { text: string; strong?: boolean }[];
  releaseNote: string;
  footnote: string;
}

export async function loadRatings(): Promise<RatingsModel> {
  const none = (key: string, icon: MetricModel["icon"], label: string): MetricModel => ({ key, icon, label, value: "Not monitored", tone: "neutral", helper: "No rating run history is recorded", provenance: provenance("none", "not_monitored", "Rating runs", null) });
  return {
    metrics: [none("eligible", "activity", "Eligible for rating"), none("withheld", "warning", "Withheld"), none("failures", "check", "Calculation failures"), none("algorithm", "layers", "Published algorithm")],
    reasons: [],
    reasonsNote: "No rating runs are recorded, so withheld reasons are not available. Input gaps are listed under data quality.",
    release: [{ text: "Algorithm version: not recorded", strong: true }, { text: "Drift comparison: not monitored" }, { text: "Rollout: not monitored" }],
    releaseNote: "Version, validation and rollback",
    footnote: "Vehicle condition evidence is not a price score. Keep provenance and meaning separate.",
  };
}
