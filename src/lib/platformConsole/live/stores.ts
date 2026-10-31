import type { MetricModel, StageModel, Tone } from "../types";
import { consolePath } from "../sections";
import { readRows, settle } from "./read";
import { clockTime, dayTime, plural, provenance, unknownMetric, whenWithAge, type ToneLabel } from "./shared";

export interface StoreRowModel {
  id: string;
  name: string;
  account: ToneLabel;
  health: ToneLabel;
  published: string;
  lastImport: string;
  actionLabel: string;
  href: string;
}

export interface StoresModel {
  metrics: MetricModel[];
  rows: StoreRowModel[];
  rowsNote: string;
}

interface GroupRow { id: string; name: string }
interface StoreRow { id: string; group_id: string | null; display_name: string; status: string; subscription_status: string; feed_import_paused: boolean; inventory_feed_enabled: boolean }
interface StateRow { store_id: string; last_applied_snapshot_id: string | null; last_applied_at: string | null; last_failure_at: string | null; last_failure_reason: string | null }
interface SnapshotRow { id: string; store_id: string | null; status: string; valid_count: number | null; created_at: string; applied_at: string | null; reason: string | null }
interface ConflictRow { id: string; status: string }

const STALE_HOURS = 36;

function accountOf(s: StoreRow): ToneLabel {
  if (s.status !== "active") return { tone: "neutral", label: "Inactive" };
  if (s.subscription_status === "subscribed") return { tone: "good", label: "Active" };
  if (s.subscription_status === "suspended") return { tone: "bad", label: "Suspended" };
  return { tone: "info", label: "Trial" };
}

function healthOf(s: StoreRow, st: StateRow | undefined, now: number): ToneLabel {
  if (s.feed_import_paused) return { tone: "warn", label: "Paused" };
  if (!s.inventory_feed_enabled || !st) return { tone: "warn", label: "Setup" };
  if (st.last_failure_at && (!st.last_applied_at || st.last_failure_at > st.last_applied_at)) return { tone: "bad", label: "Degraded" };
  if (!st.last_applied_at) return { tone: "warn", label: "Setup" };
  if (now - new Date(st.last_applied_at).getTime() > STALE_HOURS * 3_600_000) return { tone: "warn", label: "Stale" };
  return { tone: "good", label: "Healthy" };
}

export async function loadStores(now = Date.now()): Promise<StoresModel> {
  const [groups, stores, states, snaps, conflicts] = await Promise.all([
    settle(readRows<GroupRow>("dealer_groups", "id,name", { limit: 500 })),
    settle(readRows<StoreRow>("dealer_stores", "id,group_id,display_name,status,subscription_status,feed_import_paused,inventory_feed_enabled", { limit: 1000 })),
    settle(readRows<StateRow>("inventory_store_state", "store_id,last_applied_snapshot_id,last_applied_at,last_failure_at,last_failure_reason", { limit: 1000 })),
    settle(readRows<SnapshotRow>("inventory_store_snapshots", "id,store_id,status,valid_count,created_at,applied_at,reason", { order: "created_at", limit: 1000 })),
    settle(readRows<ConflictRow>("inventory_vin_conflicts", "id,status", { filters: [{ col: "status", op: "eq", value: "open" }], limit: 1000 })),
  ]);
  const asOf = new Date(now).toISOString();
  if (!stores.ok) throw new Error(`Stores are not readable: ${stores.error}`);

  const groupName = new Map((groups.ok ? groups.value : []).map((g) => [g.id, g.name]));
  const stateByStore = new Map((states.ok ? states.value : []).map((s) => [s.store_id, s]));
  const snapById = new Map((snaps.ok ? snaps.value : []).map((s) => [s.id, s]));
  const subscribed = stores.value.filter((s) => s.status === "active" && s.subscription_status === "subscribed");

  const rows: StoreRowModel[] = stores.value.map((s) => {
    const st = stateByStore.get(s.id);
    const health = states.ok ? healthOf(s, st, now) : ({ tone: "neutral", label: "Unknown" } as ToneLabel);
    const applied = st?.last_applied_snapshot_id ? snapById.get(st.last_applied_snapshot_id) : undefined;
    const published = !snaps.ok || !states.ok ? "Unknown" : applied?.valid_count != null ? plural(applied.valid_count, "vehicle") : st?.last_applied_at ? "Not recorded" : "Not published";
    const setup = health.label === "Setup";
    return {
      id: s.id,
      name: `${s.display_name}${s.group_id && groupName.get(s.group_id) ? ` / ${groupName.get(s.group_id)}` : ""}`,
      account: accountOf(s),
      health,
      published,
      lastImport: states.ok ? whenWithAge(st?.last_applied_at ?? null, now, "No successful import") : "Unknown",
      actionLabel: setup ? "Open setup" : "Open store",
      href: consolePath.store(s.id),
    };
  });

  const healthy = rows.filter((r) => r.health.label === "Healthy").length;
  const onboarding = rows.filter((r) => r.health.label === "Setup" || r.account.label === "Trial").length;
  const open = conflicts.ok ? conflicts.value.length : 0;
  const metrics: MetricModel[] = [
    { key: "subscribed", icon: "store", label: "Subscribed stores", value: String(subscribed.length), tone: "info", helper: groups.ok ? `Across ${plural(groups.value.length, "dealer group")}` : "Group count is not readable", provenance: provenance("dealer_stores", "healthy", "All stores", asOf) },
    states.ok
      ? { key: "healthy", icon: "check", label: "Operationally healthy", value: String(healthy), tone: healthy === rows.length && rows.length ? "good" : "warn", helper: "Measured health only", provenance: provenance("inventory_store_state", "healthy", "All stores", asOf) }
      : unknownMetric({ key: "healthy", icon: "check", label: "Operationally healthy" }, "inventory_store_state", "All stores", "Store state is not readable yet"),
    { key: "onboarding", icon: "layers", label: "Onboarding", value: String(onboarding), tone: onboarding ? "warn" : "good", helper: "Checklist incomplete", provenance: provenance("dealer_stores", "healthy", "All stores", asOf) },
    conflicts.ok
      ? { key: "sharing", icon: "lock", label: "Data sharing exceptions", value: String(open), tone: open ? "warn" : "good", helper: open ? "Needs scope review" : "No open VIN conflicts", provenance: provenance("inventory_vin_conflicts", "healthy", "All groups", asOf) }
      : unknownMetric({ key: "sharing", icon: "lock", label: "Data sharing exceptions" }, "inventory_vin_conflicts", "All groups", "Conflicts are not readable yet"),
  ];
  return { metrics, rows, rowsNote: rows.length ? "" : "No stores are recorded for your scope." };
}

export interface StoreConnectionRow { id: string; name: string; state: ToneLabel; lastWork: string }
export interface StoreModel {
  title: string;
  subtitle: string;
  metrics: MetricModel[];
  connections: StoreConnectionRow[];
  /** "Owner: X" first, then one line per relation. */
  sharing: { text: string; strong?: boolean }[];
  sharingNote: string;
  checklist: StageModel[];
}

interface FullStoreRow extends StoreRow { tenant_id: string | null; inventory_sharing_enabled: boolean; listing_sync_enabled: boolean; customer_browser_enabled: boolean; updated_at: string }
interface RuleRow { id: string; source_store_id: string; destination_store_id: string; status: string; show_prices: boolean; show_details: boolean }
interface MemberRow { id: string; role: string }

const toneOf = (ok: boolean, warn: boolean): Tone => (ok ? "good" : warn ? "warn" : "neutral");

export async function loadStore(storeId: string, now = Date.now()): Promise<StoreModel> {
  const eq = (col: string, value: unknown) => ({ col, op: "eq" as const, value });
  const [stores, state, snaps, rules, others, conflicts] = await Promise.all([
    settle(readRows<FullStoreRow>("dealer_stores", "id,group_id,tenant_id,display_name,status,subscription_status,feed_import_paused,inventory_feed_enabled,inventory_sharing_enabled,listing_sync_enabled,customer_browser_enabled,updated_at", { filters: [eq("id", storeId)], limit: 1 })),
    settle(readRows<StateRow>("inventory_store_state", "store_id,last_applied_snapshot_id,last_applied_at,last_failure_at,last_failure_reason", { filters: [eq("store_id", storeId)], limit: 1 })),
    settle(readRows<SnapshotRow>("inventory_store_snapshots", "id,store_id,status,valid_count,created_at,applied_at,reason", { filters: [eq("store_id", storeId)], order: "created_at", limit: 20 })),
    settle(readRows<RuleRow>("inventory_sharing_rules", "id,source_store_id,destination_store_id,status,show_prices,show_details", { limit: 500 })),
    settle(readRows<{ id: string; display_name: string }>("dealer_stores", "id,display_name", { limit: 500 })),
    settle(readRows<ConflictRow>("inventory_vin_conflicts", "id,status", { filters: [eq("claiming_store_id", storeId), eq("status", "open")], limit: 500 })),
  ]);
  if (!stores.ok) throw new Error(`Store is not readable: ${stores.error}`);
  const store = stores.value[0];
  if (!store) throw new Error("This store was not found in your authorized scope.");
  const members = store.tenant_id ? await settle(readRows<MemberRow>("tenant_members", "id,role", { filters: [eq("tenant_id", store.tenant_id)], limit: 500 })) : null;
  const asOf = new Date(now).toISOString();
  const st = state.ok ? state.value[0] : undefined;
  const lastSnap = snaps.ok ? snaps.value[0] : undefined;
  const applied = snaps.ok && st?.last_applied_snapshot_id ? snaps.value.find((s) => s.id === st.last_applied_snapshot_id) : undefined;
  const nameById = new Map((others.ok ? others.value : []).map((s) => [s.id, s.display_name]));
  const account = accountOf(store);
  const health = state.ok ? healthOf(store, st, now) : ({ tone: "neutral", label: "Unknown" } as ToneLabel);
  const openConflicts = conflicts.ok ? conflicts.value.length : 0;
  const held = lastSnap && (lastSnap.status === "quarantined" || lastSnap.status === "rejected") && (!st?.last_applied_at || lastSnap.created_at > st.last_applied_at);

  const metrics: MetricModel[] = [
    { key: "account", icon: "store", label: "Account", value: account.label, tone: account.tone === "info" ? "info" : account.tone, helper: `Plan and billing updated ${clockTime(store.updated_at)}`, provenance: provenance("dealer_stores", "healthy", store.display_name, asOf) },
    state.ok && snaps.ok
      ? { key: "inventory", icon: "car", label: "Inventory", value: applied?.valid_count != null ? applied.valid_count.toLocaleString("en-US") : "Not published", tone: applied?.valid_count != null ? "info" : "neutral", helper: st?.last_applied_at ? `Published · last success ${clockTime(st.last_applied_at)}` : "No successful import recorded", provenance: provenance("inventory_store_snapshots", "healthy", store.display_name, asOf) }
      : unknownMetric({ key: "inventory", icon: "car", label: "Inventory" }, "inventory_store_snapshots", store.display_name, "Snapshots are not readable yet"),
    conflicts.ok
      ? { key: "incidents", icon: "warning", label: held ? "Open incidents" : "Open conflicts", value: String(held ? 1 + openConflicts : openConflicts), tone: held || openConflicts ? "warn" : "good", helper: held ? "Import held; prior inventory retained" : openConflicts ? "VIN ownership conflicts need review" : "None recorded", provenance: provenance("inventory_store_snapshots", "healthy", store.display_name, asOf) }
      : unknownMetric({ key: "incidents", icon: "warning", label: "Open incidents" }, "inventory_vin_conflicts", store.display_name, "Conflicts are not readable yet"),
    members?.ok
      ? (() => {
          const managers = members.value.filter((m) => m.role === "owner" || m.role === "admin" || m.role === "manager").length;
          return { key: "members", icon: "users", label: "Members", value: String(members.value.length), tone: "info" as Tone, helper: `${plural(managers, "manager")} · ${members.value.length - managers} staff`, provenance: provenance("tenant_members", "healthy", "Tenant", asOf) };
        })()
      : unknownMetric({ key: "members", icon: "users", label: "Members" }, "tenant_members", "Tenant", "Membership is not readable yet"),
  ];

  const connections: StoreConnectionRow[] = [
    {
      id: "filescom",
      name: "Files.com",
      state: !state.ok ? { tone: "neutral", label: "Unknown" } : held ? { tone: "warn", label: "Held" } : health,
      lastWork: st?.last_applied_at ? `${clockTime(st.last_applied_at)} inventory import` : state.ok ? "No successful import" : "Unknown",
    },
    { id: "market", name: "Market data", state: store.feed_import_paused ? { tone: "warn", label: "Paused" } : { tone: "neutral", label: "Not monitored" }, lastWork: store.feed_import_paused ? `${dayTime(store.updated_at, now)} · intentional hold` : "No measurement recorded" },
    { id: "passport", name: "Public Passport", state: { tone: "neutral", label: "Not monitored" }, lastWork: "No synthetic check configured" },
  ];

  const rulesOk = rules.ok;
  const outgoing = rulesOk ? rules.value.filter((r) => r.source_store_id === storeId && r.status === "active") : [];
  const incoming = rulesOk ? rules.value.filter((r) => r.destination_store_id === storeId && r.status === "active") : [];
  const sharing: { text: string; strong?: boolean }[] = [{ text: `Owner: ${store.display_name}`, strong: true }];
  for (const r of outgoing) sharing.push({ text: `${nameById.get(r.destination_store_id) ?? "Unresolved store"}: view inventory${r.show_prices ? " and prices" : " only"}` });
  for (const r of incoming) sharing.push({ text: `Receives from ${nameById.get(r.source_store_id) ?? "Unresolved store"}` });
  if (rulesOk && !outgoing.length && !incoming.length) sharing.push({ text: "No other store can view this inventory" });

  const checklist: StageModel[] = [
    { key: "identity", label: "Identity", value: store.status === "active" ? "Complete" : "Inactive", tone: toneOf(store.status === "active", true) },
    { key: "feed", label: "Feed", value: store.inventory_feed_enabled ? "Configured" : "Not configured", tone: toneOf(store.inventory_feed_enabled, true) },
    { key: "checks", label: "Data checks", value: !state.ok ? "Unknown" : health.label === "Healthy" ? "Passing" : health.label === "Setup" ? "Pending" : "Attention", tone: !state.ok ? "neutral" : health.label === "Healthy" ? "good" : "warn" },
    { key: "billing", label: "Billing", value: account.label, tone: account.tone === "good" ? "good" : account.tone === "bad" ? "bad" : "warn" },
    { key: "launch", label: "Launch", value: store.customer_browser_enabled && store.listing_sync_enabled ? "Live" : "Pending", tone: store.customer_browser_enabled && store.listing_sync_enabled ? "good" : "warn" },
  ];

  return {
    title: store.display_name,
    subtitle: "Store ownership and sharing are explicit.",
    metrics,
    connections,
    sharing,
    sharingNote: rulesOk ? "Default deny · explicitly approved relations only" : "Sharing rules are not readable, so access is unknown.",
    checklist,
  };
}

