import type { DealerGroup, FeedBinding, GroupInventoryData, InvOverview, InventoryFeedControls, InventoryFeedJob, InventoryStoreSnapshot, StoreOverview } from "@/lib/inventoryNetwork/api";
import { mcModeLabel } from "./shared";
import type { View } from "./shared";

export type ChipTone = "green" | "amber" | "red" | "blue" | "neutral";
export interface Chip { label: string; tone: ChipTone }

// A ledger is null when its read failed or has not finished, so the card can
// say Unknown instead of showing a number it does not have.
export interface OverviewInputs {
  now: number;
  stores: StoreOverview[];
  controls: InventoryFeedControls | null;
  jobs: InventoryFeedJob[] | null;
  snapshots: InventoryStoreSnapshot[] | null;
  bindings: FeedBinding[] | null;
  preview: GroupInventoryData | null | undefined;
  heartbeatAt: string | null;
}

export interface Stat { label: string; value: string; sub: string; icon: "store" | "file" | "clock" | "car"; known: boolean }
export interface FlowStep { no: number; title: string; chip: Chip; note: string }
export interface ActionRow { key: string; name: string; chip: Chip; label: string; to: { view: View; params: Record<string, string> } }
export interface OverviewModel {
  banner: { title: string; detail: string } | null;
  stats: Stat[];
  flow: FlowStep[];
  actions: ActionRow[];
  controls: { ingestion: Chip; heartbeat: Chip; lastImport: string; marketCheckMode: string };
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function formatDuration(spanMs: number): string {
  const m = Math.max(0, Math.floor(spanMs / 60_000));
  if (m < 1) return "less than a minute";
  if (m < 60) return plural(m, "minute");
  const h = Math.floor(m / 60);
  if (h < 48) return plural(h, "hour");
  return plural(Math.floor(h / 24), "day");
}

export function formatClock(iso: string | null | undefined, now: number): string {
  const t = ms(iso);
  if (!Number.isFinite(t)) return "Not recorded";
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "shortGeneric" }).format(t);
  if (Math.abs(now - t) < 24 * 3_600_000) return time;
  return `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(t)}, ${time}`;
}

const TRIGGER_LABEL: Record<InventoryFeedJob["trigger"], string> = {
  webhook: "Files.com webhook", reconcile: "Reconciliation sweep", manual: "Manual enqueue", retry: "Retry of an earlier job",
};

const byCreatedDesc = <T extends { created_at: string }>(a: T, b: T) => ms(b.created_at) - ms(a.created_at);

export function buildOverviewModel(i: OverviewInputs): OverviewModel {
  const { now, stores } = i;
  const jobs = i.jobs ? [...i.jobs].sort(byCreatedDesc) : null;
  const snaps = i.snapshots ? [...i.snapshots].sort(byCreatedDesc) : null;
  const primary = stores.find((s) => s.store.is_primary_inventory_store) ?? stores[0] ?? null;
  const storeName = (id: string | null) => stores.find((s) => s.store.id === id)?.store.display_name ?? null;

  const queued = jobs ? jobs.filter((j) => j.status === "queued").sort((a, b) => ms(a.created_at) - ms(b.created_at)) : null;
  const overdue = queued ? queued.filter((j) => ms(j.next_attempt_at) <= now) : null;
  const oldest = overdue?.[0] ?? queued?.[0] ?? null;

  const primaryApplied = !!primary?.state?.last_applied_at;
  let banner: OverviewModel["banner"] = null;
  if (overdue && overdue.length > 0) {
    const waited = formatDuration(now - ms(overdue[0].created_at));
    const lead = overdue.length === 1 ? `Import queued for ${waited}.` : `${overdue.length} imports are past due. The oldest has been queued for ${waited}.`;
    banner = {
      title: "Latest arrival has not been processed",
      detail: `${lead} ${primary ? (primaryApplied ? "The primary store still shows its previous successful snapshot." : "The primary store has no successful snapshot recorded.") : ""}`.trim(),
    };
  }

  const importing = stores.filter((s) => s.store.inventory_feed_enabled && !s.store.feed_import_paused).length;
  const paused = stores.filter((s) => s.store.feed_import_paused).length;
  const feedOff = stores.filter((s) => !s.store.inventory_feed_enabled && !s.store.feed_import_paused).length;
  const storeSub = [`${importing} importing`, `${paused} paused`, ...(feedOff > 0 ? [`${feedOff} feed off`] : [])].join(" · ");

  const applied = snaps ? snaps.filter((s) => s.status === "applied").sort((a, b) => ms(b.applied_at ?? b.created_at) - ms(a.applied_at ?? a.created_at))[0] ?? null : null;
  const snapStat: Stat = snaps === null
    ? { label: "Last applied snapshot", value: "Unknown", sub: "Snapshot ledger not read", icon: "file", known: false }
    : applied
      ? { label: "Last applied snapshot", value: String(applied.valid_count), sub: `${storeName(applied.store_id) ?? "Unassigned store"} · ${formatClock(applied.applied_at ?? applied.created_at, now)}`, icon: "file", known: true }
      : { label: "Last applied snapshot", value: "None", sub: "No applied snapshot recorded", icon: "file", known: true };

  const queueStat: Stat = queued === null
    ? { label: "Awaiting worker", value: "Unknown", sub: "Job ledger not read", icon: "clock", known: false }
    : oldest
      ? {
        label: "Awaiting worker", value: String(queued.length), icon: "clock", known: true,
        sub: `${ms(oldest.next_attempt_at) <= now ? "Due now" : `Due in ${formatDuration(ms(oldest.next_attempt_at) - now)}`} · ${plural(oldest.attempts, "attempt")}`,
      }
      : { label: "Awaiting worker", value: "0", sub: "Nothing queued", icon: "clock", known: true };

  let readyStat: Stat;
  if (i.preview === undefined || i.preview === null) readyStat = { label: "Ready for customers", value: "Unknown", sub: primary ? "Preview not read" : "No store to preview", icon: "car", known: false };
  else if (!i.preview.enabled) readyStat = { label: "Ready for customers", value: "Unknown", sub: "Customer preview is not enabled", icon: "car", known: false };
  else {
    const vehicles = i.preview.vehicles;
    const additional = vehicles.length >= i.preview.total ? vehicles.filter((v) => v.inventory_group === "additional").length : null;
    readyStat = { label: "Ready for customers", value: String(i.preview.total), sub: `Preview result · additional ${additional ?? "Unknown"}`, icon: "car", known: true };
  }

  const latestJob = jobs?.[0] ?? null;
  const latestSnap = snaps?.[0] ?? null;
  const heartbeatMissing = !i.heartbeatAt;

  const receipt: FlowStep = jobs === null
    ? { no: 1, title: "Receipt", chip: { label: "Unknown", tone: "neutral" }, note: "Job ledger not read" }
    : latestJob
      ? { no: 1, title: "Receipt", chip: { label: "Received", tone: "green" }, note: TRIGGER_LABEL[latestJob.trigger] }
      : { no: 1, title: "Receipt", chip: { label: "None recorded", tone: "neutral" }, note: "No arrival in the job ledger" };

  let validation: FlowStep;
  if (snaps === null) validation = { no: 2, title: "Validation", chip: { label: "Unknown", tone: "neutral" }, note: "Snapshot ledger not read" };
  else if (!latestSnap) validation = { no: 2, title: "Validation", chip: { label: "None recorded", tone: "neutral" }, note: "No file has been checked" };
  else {
    const chip: Chip = latestSnap.status === "applied" || latestSnap.status === "superseded" ? { label: "Last file valid", tone: "green" }
      : latestSnap.status === "held" ? { label: "Held for review", tone: "amber" }
      : latestSnap.status === "staged" ? { label: "Checking", tone: "blue" }
      : latestSnap.status === "quarantined" ? { label: "Last file quarantined", tone: "amber" }
      : { label: `Last file ${latestSnap.status}`, tone: "red" };
    const newerArrival = !!latestJob && ms(latestJob.created_at) > ms(latestSnap.created_at) && !latestJob.run_id;
    validation = { no: 2, title: "Validation", chip, note: newerArrival ? "Latest arrival not checked" : `Checked ${formatClock(latestSnap.created_at, now)}` };
  }

  let imp: FlowStep;
  if (jobs === null) imp = { no: 3, title: "Import", chip: { label: "Unknown", tone: "neutral" }, note: "Job ledger not read" };
  else if (!latestJob) imp = { no: 3, title: "Import", chip: { label: "None recorded", tone: "neutral" }, note: "No import job recorded" };
  else {
    const late = latestJob.status === "queued" && ms(latestJob.next_attempt_at) <= now;
    const chip: Chip = latestJob.status === "queued" ? { label: "Queued", tone: late ? "amber" : "blue" }
      : latestJob.status === "running" ? { label: "Running", tone: "blue" }
      : latestJob.status === "succeeded" ? { label: "Applied", tone: "green" }
      : latestJob.status === "partial" ? { label: "Partly applied", tone: "amber" }
      : latestJob.status === "failed" || latestJob.status === "dead" ? { label: "Failed", tone: "red" }
      : { label: latestJob.status === "skipped" ? "Skipped" : "Cancelled", tone: "neutral" };
    const note = late && heartbeatMissing ? "Worker heartbeat missing"
      : latestJob.status === "queued" ? "Waiting for its scheduled time"
      : latestJob.finished_at ? `Finished ${formatClock(latestJob.finished_at, now)}`
      : latestJob.started_at ? `Started ${formatClock(latestJob.started_at, now)}` : "Not started";
    imp = { no: 3, title: "Import", chip, note };
  }

  let customer: FlowStep;
  if (jobs === null || snaps === null) customer = { no: 4, title: "Customer view", chip: { label: "Unknown", tone: "neutral" }, note: "A ledger was not read" };
  else if (latestJob && (latestJob.status === "queued" || latestJob.status === "running") && applied) customer = { no: 4, title: "Customer view", chip: { label: "Previous data", tone: "neutral" }, note: "No new publication yet" };
  else if (applied) customer = { no: 4, title: "Customer view", chip: { label: "Current data", tone: "green" }, note: `Applied ${formatClock(applied.applied_at ?? applied.created_at, now)}` };
  else customer = { no: 4, title: "Customer view", chip: { label: "No data", tone: "neutral" }, note: "Nothing applied yet" };

  const pathStore = (path: string) => snaps?.find((s) => s.path === path && s.store_id)?.store_id ?? null;
  const overdueStores = new Set<string>();
  let unattributed = 0;
  for (const j of overdue ?? []) {
    const sid = pathStore(j.path);
    if (sid) overdueStores.add(sid); else unattributed += 1;
  }

  const rows: ActionRow[] = [];
  const consider = (s: StoreOverview): ActionRow | null => {
    const st = s.store;
    const base = { key: st.id, name: st.display_name };
    if (overdueStores.has(st.id)) return { ...base, chip: { label: "Worker not verified", tone: "amber" }, label: "Inspect queued import", to: { view: "runs", params: { panel: "timeline", store: st.id } } };
    if (st.status === "inactive") return null;
    if (!st.inventory_feed_enabled && !st.feed_import_paused) return { ...base, chip: { label: "Feed off", tone: "neutral" }, label: "Review setup", to: { view: "stores", params: { store: st.id } } };
    const approved = s.mappings.some((m) => m.status === "approved");
    if (!approved) {
      const pending = s.mappings.some((m) => m.status === "pending") || !!i.bindings?.some((b) => b.status === "pending" && b.tenant_id === st.tenant_id);
      return pending
        ? { ...base, chip: { label: "Binding pending", tone: "amber" }, label: "Approve file binding", to: { view: "mapping", params: {} } }
        : { ...base, chip: { label: "Binding missing", tone: "amber" }, label: "Review setup", to: { view: "stores", params: { store: st.id } } };
    }
    const last = s.last_snapshot?.status;
    if (last === "quarantined" || last === "rejected" || last === "failed") return { ...base, chip: { label: `Last file ${last}`, tone: last === "quarantined" ? "amber" : "red" }, label: "Open run", to: { view: "runs", params: { panel: "timeline", store: st.id } } };
    if (st.feed_import_paused) return { ...base, chip: { label: "Import paused", tone: "neutral" }, label: "Review setup", to: { view: "stores", params: { store: st.id } } };
    return null;
  };
  const needing = stores.map(consider).filter((r): r is ActionRow => r !== null).sort((a, b) => Number(overdueStores.has(b.key)) - Number(overdueStores.has(a.key)));
  if (unattributed > 0) rows.push({ key: "unattributed", name: "Feed file with no store", chip: { label: "Worker not verified", tone: "amber" }, label: "Inspect queued import", to: { view: "runs", params: { panel: "timeline" } } });
  rows.push(...needing);
  let actions = rows;
  if (rows.length > 4) {
    const rest = rows.slice(3);
    const first = (n: string) => n.split(" ")[0];
    const brand = rest.every((r) => first(r.name) === first(rest[0].name)) ? `${first(rest[0].name)} ` : "";
    const same = rest.every((r) => r.chip.label === rest[0].chip.label);
    actions = [...rows.slice(0, 3), { key: "rest", name: `${rest.length} other ${brand}stores`, chip: same ? rest[0].chip : { label: "Needs review", tone: "amber" }, label: "Review all stores", to: { view: "stores", params: {} } }];
  }

  const c = i.controls;
  const ingestion: Chip = !c ? { label: "Unknown", tone: "neutral" } : c.emergency_stop ? { label: "Emergency stop", tone: "red" } : c.ingestion_paused ? { label: "Paused", tone: "amber" } : { label: "On", tone: "green" };
  const finished = jobs?.filter((j) => (j.status === "succeeded" || j.status === "partial") && j.finished_at).sort((a, b) => ms(b.finished_at) - ms(a.finished_at))[0];
  const lastImportIso = finished?.finished_at ?? applied?.applied_at ?? null;

  return {
    banner,
    stats: [
      { label: "Stores connected", value: String(stores.length), sub: storeSub, icon: "store", known: true },
      snapStat, queueStat, readyStat,
    ],
    flow: [receipt, validation, imp, customer],
    actions,
    controls: {
      ingestion,
      heartbeat: heartbeatMissing ? { label: "Not recorded", tone: "amber" } : { label: formatClock(i.heartbeatAt, now), tone: "green" },
      lastImport: formatClock(lastImportIso, now),
      marketCheckMode: primary ? mcModeLabel(primary.policy).label : "Unknown",
    },
  };
}

export interface InventoryNetworkFixture {
  groups: DealerGroup[];
  overview: InvOverview;
  jobs: InventoryFeedJob[];
  snapshots: InventoryStoreSnapshot[];
  bindings: FeedBinding[];
  preview: GroupInventoryData;
  heartbeatAt: string | null;
}
