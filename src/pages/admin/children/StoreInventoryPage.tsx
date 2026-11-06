import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { ChildPageFrame } from "@/components/admin/v2/AdminShell";
import { Button, EmptyState, InlineNote, KeyValueList, MetricStrip, Panel, QueryState, StatusText, Td, Th, WorkTable, type Tone } from "@/components/product";
import { adminTabHref } from "@/lib/admin/sections";
import { explainError, saveStore, type StoreEnrichmentPolicy } from "@/lib/inventoryNetwork/api";
import { listScopedListings, listStorePolicies, listStoreUsageThisMonth, listStoreVehicles, listTenantStores, type TenantStore } from "@/lib/inventoryScope/api";
import {
  MC_DEALER_KEY, buildRegistry, resolveListingScope, storeFeedHealth, summarizeScopes, summarizeUsage, type ConditionCounts, type StoreRegistry,
} from "@/lib/inventoryScope/storeScope";
import { DATA_CATEGORIES, categoryState, isSwitchable } from "@/lib/inventoryScope/dataControls";

// AutoLabels Admin > Inventory by store. The primary dealership is the default
// view; every child (sister) store is its own selection and never adds to the
// primary totals. Everything here is a read of data AutoLabels already holds:
// opening this page never calls MarketCheck or any other paid provider.

const NETWORK_PATH = "/admin/integrations/inventory-network";
const REVIEW = "review";

const crumbs = [{ label: "Administration", href: "/admin" }, { label: "Integrations", href: adminTabHref("inventory-feed") }, { label: "Inventory by store" }];

const fmtWhen = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : "Never");
const countsLine = (c: ConditionCounts) => `${c.new} new · ${c.used} used · ${c.cpo} CPO${c.unknown ? ` · ${c.unknown} unclassified` : ""}`;

const STATE_LABEL: Record<string, { label: string; tone: Tone }> = {
  on: { label: "On", tone: "success" },
  off: { label: "Off", tone: "neutral" },
  partial: { label: "Partly on", tone: "warning" },
  unavailable: { label: "Not available", tone: "neutral" },
};
const DEFAULT_LABEL = { on_for_approved: "On for approved stores", configurable: "Configurable", off_until_enabled: "Off until enabled" } as const;

function modeLine(p: StoreEnrichmentPolicy | undefined): { label: string; tone: Tone } {
  if (!p || p.mode === "feed_only") return { label: "No paid enrichment (feed only)", tone: "neutral" };
  if (p.mode === "paused") return { label: "Paid enrichment paused", tone: "warning" };
  if (p.budget_blocked) return { label: "Stopped by a budget limit", tone: "danger" };
  return { label: "Paid enrichment on, within store caps", tone: "info" };
}

function DataControls({ store, policy, isAdmin, primary }: { store: TenantStore; policy: StoreEnrichmentPolicy | undefined; isAdmin: boolean; primary: boolean }) {
  const allowed = policy?.mode === "enrichment" ? policy.allowed_products : [];
  const visible = store.status === "active" && store.inventory_feed_enabled;
  const mode = modeLine(policy);
  return (
    <Panel title="MarketCheck data controls" description="Each store has its own settings. Turning paid data off never hides valid inventory." flush
      action={isAdmin ? <Link className="text-[14px] font-semibold text-adm-primary hover:underline" to={`${NETWORK_PATH}?view=marketcheck&store=${encodeURIComponent(store.id)}`}>Edit store policy</Link> : undefined}>
      <div className="space-y-3 px-4 pt-4">
        <KeyValueList rows={[
          { label: "Paid enrichment", value: <StatusText tone={mode.tone}>{mode.label}</StatusText> },
          { label: "Monthly call allocation", value: policy?.monthly_request_cap ? `${policy.monthly_request_cap.toLocaleString("en-US")} calls` : "None" },
          { label: "Refresh frequency", value: policy?.refresh_cadence_hours ? `Every ${policy.refresh_cadence_hours} hours at most` : "Not scheduled" },
          { label: "Credit priority", value: primary ? "Primary: allocated before child stores" : "Child: uses only what is left after the primary store and the essential reserve" },
        ]} />
      </div>
      <WorkTable caption="Data categories" inset minWidth={640}>
        <thead><tr><Th>Data category</Th><Th>Child-store default</Th><Th>This store</Th></tr></thead>
        <tbody>
          {DATA_CATEGORIES.map((c) => {
            const st = c.id === "inventory_visibility" ? (visible ? "on" : "off") : categoryState(c, allowed);
            const l = STATE_LABEL[st];
            return (
              <tr key={c.id}>
                <Td>{c.label}</Td>
                <Td className="text-adm-muted">{DEFAULT_LABEL[c.childDefault]}</Td>
                <Td>
                  <StatusText tone={l.tone}>{l.label}</StatusText>
                  {!isSwitchable(c) && c.unavailableReason && <p className="mt-1 text-[12px] text-adm-muted">{c.unavailableReason}</p>}
                  {c.id === "inventory_visibility" && <p className="mt-1 text-[12px] text-adm-muted">From the store's feed, not from paid data.</p>}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </WorkTable>
    </Panel>
  );
}

function UsagePanel({ storeId }: { storeId: string }) {
  const q = useQuery({ queryKey: ["store-inventory", "usage", storeId], queryFn: () => listStoreUsageThisMonth(storeId) });
  const u = q.data ? summarizeUsage(q.data) : null;
  return (
    <Panel title="API usage this month" description="Calls recorded against this store only. Estimates use list prices and are not a bill.">
      <QueryState status={q.isLoading ? "loading" : q.isError ? "error" : "ready"} errorTitle="Could not load usage" errorDetail={q.isError ? explainError(q.error) : undefined} onRetry={() => q.refetch()}>
        {u && (
          <KeyValueList rows={[
            { label: "Paid calls admitted", value: u.admitted.toLocaleString("en-US") },
            { label: "Calls refused", value: u.denied ? `${u.denied.toLocaleString("en-US")} (${Object.entries(u.denyReasons).map(([k, n]) => `${k.replace(/_/g, " ")} ${n}`).join(", ")})` : "0" },
            { label: "Estimated cost", value: `$${u.estimatedUsd.toFixed(2)}${u.unpriced ? `, plus ${u.unpriced} unpriced` : ""}` },
          ]} />
        )}
      </QueryState>
    </Panel>
  );
}

function StoreDetail({ store, policy, isAdmin, primary, extraListings }: { store: TenantStore; policy: StoreEnrichmentPolicy | undefined; isAdmin: boolean; primary: boolean; extraListings: ConditionCounts | null }) {
  const q = useQuery({ queryKey: ["store-inventory", "vehicles", store.id], queryFn: () => listStoreVehicles(store.id) });
  const h = q.data ? storeFeedHealth(q.data) : null;
  const present = (q.data ?? []).filter((v) => v.presence === "present");
  return (
    <div className="space-y-4">
      <MetricStrip label={`${store.display_name} inventory`} metrics={[
        { label: "In feed", value: h ? h.counts.total : null, loading: q.isLoading, tone: "info" },
        { label: "New", value: h ? h.counts.new : null, loading: q.isLoading },
        { label: "Used", value: h ? h.counts.used : null, loading: q.isLoading },
        { label: "CPO", value: h ? h.counts.cpo : null, loading: q.isLoading },
      ]} />
      <Panel title="Synchronization" description="Inventory of record is the dealer's vAuto feed delivered through Files.com.">
        <KeyValueList rows={[
          { label: "Feed", value: store.inventory_feed_enabled ? "On" : "Off" },
          { label: "Last feed update", value: h ? fmtWhen(h.lastFeedUpdate) : "Unknown" },
          { label: "Missing data", value: h ? `${h.noStockNumber} without stock number, ${h.noPrice} without a feed price, ${h.missingFromLastFeed} absent from the last feed (kept, not removed)` : "Unknown" },
          { label: "Paid data current", value: h ? `${h.enrichmentFresh} of ${h.counts.total}` : "Unknown" },
          ...(extraListings && extraListings.total ? [{ label: "AutoLabels listings", value: `${extraListings.total} active listings belong to this store (${countsLine(extraListings)})` }] : []),
        ]} />
      </Panel>
      <DataControls store={store} policy={policy} isAdmin={isAdmin} primary={primary} />
      <UsagePanel storeId={store.id} />
      <Panel title="Vehicles" description="This store's vehicles only." flush>
        <QueryState status={q.isLoading ? "loading" : q.isError ? "error" : present.length ? "ready" : "empty"} errorTitle="Could not load vehicles" errorDetail={q.isError ? explainError(q.error) : undefined} onRetry={() => q.refetch()}
          emptyTitle="No vehicles from this store's feed yet" emptyDetail="The feed for this store has not been imported. Nothing is created to fill this view.">
          <WorkTable caption={`${store.display_name} vehicles`} minWidth={760}>
            <thead><tr><Th>Vehicle</Th><Th>VIN</Th><Th>Stock</Th><Th>Condition</Th><Th align="right">Feed price</Th><Th>Paid data</Th></tr></thead>
            <tbody>
              {present.slice(0, 200).map((v) => (
                <tr key={v.id}>
                  <Td>{[v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || "Unknown"}</Td>
                  <Td className="font-mono text-[13px]">{v.vin}</Td>
                  <Td>{v.stock_number || <span className="text-adm-muted">Unavailable</span>}</Td>
                  <Td>{v.condition === "cpo" ? "CPO" : v.condition === "new" ? "New" : "Used"}</Td>
                  <Td align="right">{v.feed_price_status === "known" && v.feed_price ? `$${Number(v.feed_price).toLocaleString("en-US")}` : <span className="text-adm-muted">Unavailable</span>}</Td>
                  <Td>{v.enrichment_status.replace(/_/g, " ")}</Td>
                </tr>
              ))}
            </tbody>
          </WorkTable>
          {present.length > 200 && <p className="px-4 py-3 text-[13px] text-adm-muted">Showing 200 of {present.length}.</p>}
        </QueryState>
      </Panel>
    </div>
  );
}

function ReviewDetail({ reg, rows, stores, isAdmin }: { reg: StoreRegistry; rows: Array<{ id: string; vin: string; ymm: string | null; condition: string | null; mc_dealer_id?: string | number | null; owning_store_id?: string | null }>; stores: TenantStore[]; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = r.mc_dealer_id != null && String(r.mc_dealer_id).trim() ? `MarketCheck dealer ${r.mc_dealer_id}` : `Store ${r.owning_store_id ?? "unknown"}`;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()];
  }, [rows]);
  const map = async (dealerId: string, storeId: string) => {
    const s = stores.find((x) => x.id === storeId);
    if (!s) return;
    const cur = s.provider_ids?.[MC_DEALER_KEY];
    const list = [...(Array.isArray(cur) ? cur : cur ? [cur] : []).map(String), dealerId];
    setErr(null);
    try {
      await saveStore({ id: s.id, provider_ids: { ...(s.provider_ids ?? {}), [MC_DEALER_KEY]: Array.from(new Set(list)) } });
      await qc.invalidateQueries({ queryKey: ["store-inventory"] });
    } catch (e) { setErr(explainError(e)); }
  };
  if (!rows.length) return <Panel><EmptyState title="Nothing needs rooftop review" compact /></Panel>;
  return (
    <div className="space-y-4">
      <InlineNote tone="warning" title="These listings carry a provider dealer id that is not mapped to any of this account's stores">
        They are kept out of the primary dealership's list and totals until the dealer id is mapped, because they may belong to a sister store. Nothing is deleted or hidden from customers by this.
      </InlineNote>
      {err && <InlineNote tone="danger" title="Mapping was not saved">{err}</InlineNote>}
      {groups.map(([key, list]) => {
        const dealerId = key.startsWith("MarketCheck dealer ") ? key.slice("MarketCheck dealer ".length) : null;
        return (
          <Panel key={key} title={key} description={`${list.length} active ${list.length === 1 ? "listing" : "listings"}`} flush
            action={isAdmin && dealerId ? (
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`map-${dealerId}`}>Map dealer {dealerId} to a store</label>
                <select id={`map-${dealerId}`} className="rounded-[4px] border border-adm-border bg-adm-surface px-2 py-1 text-[14px]" value={target[dealerId] ?? ""} onChange={(e) => setTarget((t) => ({ ...t, [dealerId]: e.target.value }))}>
                  <option value="">Choose the verified store</option>
                  {stores.map((s) => <option key={s.id} value={s.id}>{s.display_name}{reg.primary?.id === s.id ? " (primary)" : ""}</option>)}
                </select>
                <Button size="sm" variant="primary" disabled={!target[dealerId]} onClick={() => map(dealerId, target[dealerId])}>Map dealer id</Button>
              </div>
            ) : undefined}>
            <WorkTable caption={key} minWidth={560}>
              <thead><tr><Th>Vehicle</Th><Th>VIN</Th><Th>Condition</Th></tr></thead>
              <tbody>{list.map((r) => <tr key={r.id}><Td>{r.ymm || "Unknown"}</Td><Td className="font-mono text-[13px]">{r.vin}</Td><Td>{r.condition ?? "Unknown"}</Td></tr>)}</tbody>
            </WorkTable>
          </Panel>
        );
      })}
    </div>
  );
}

export default function StoreInventoryPage() {
  const { isAdmin } = useAuth();
  const { tenant } = useTenant();
  const [params, setParams] = useSearchParams();
  const tenantId = tenant?.id ?? null;

  const storesQ = useQuery({ queryKey: ["store-inventory", "stores", tenantId], queryFn: () => listTenantStores(tenantId!), enabled: !!tenantId });
  const stores = useMemo(() => storesQ.data ?? [], [storesQ.data]);
  const reg = useMemo(() => buildRegistry(stores), [stores]);
  const policiesQ = useQuery({ queryKey: ["store-inventory", "policies", stores.map((s) => s.id).join(",")], queryFn: () => listStorePolicies(stores.map((s) => s.id)), enabled: stores.length > 0 });
  const listingsQ = useQuery({ queryKey: ["store-inventory", "listings", tenantId], queryFn: () => listScopedListings(tenantId!), enabled: !!tenantId && stores.length > 0 });
  const summary = useMemo(() => (listingsQ.data ? summarizeScopes(listingsQ.data.rows, reg) : null), [listingsQ.data, reg]);
  const reviewRows = useMemo(() => (listingsQ.data?.rows ?? []).filter((r) => resolveListingScope(r, reg).kind === "rooftop_review"), [listingsQ.data, reg]);
  const policyOf = (id: string) => policiesQ.data?.find((p) => p.store_id === id);

  const sel = params.get("store");
  const selected = sel === REVIEW ? null : (sel && reg.byId.get(sel)) || reg.primary;
  const pick = (id: string) => setParams(new URLSearchParams({ store: id }));

  const nav = (
    <nav aria-label="Stores" className="space-y-4">
      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-adm-muted">Primary dealership</p>
        {reg.primary ? (
          <button type="button" aria-current={selected?.id === reg.primary.id ? "page" : undefined} onClick={() => pick(reg.primary!.id)}
            className={`w-full rounded-[6px] border px-3 py-2 text-left ${selected?.id === reg.primary.id ? "border-adm-primary bg-adm-selected" : "border-adm-border bg-adm-surface"}`}>
            <span className="block text-[14px] font-semibold text-adm-ink">{reg.primary.display_name}</span>
            <span className="block text-[12px] text-adm-muted">Default view</span>
          </button>
        ) : <p className="text-[13px] text-adm-muted">No primary store is designated.</p>}
      </div>
      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-adm-muted">Child stores ({reg.children.length})</p>
        <ul className="space-y-2">
          {reg.children.map((s) => (
            <li key={s.id}>
              <button type="button" aria-current={selected?.id === s.id ? "page" : undefined} onClick={() => pick(s.id)}
                className={`w-full rounded-[6px] border px-3 py-2 text-left ${selected?.id === s.id ? "border-adm-primary bg-adm-selected" : "border-adm-border bg-adm-surface"}`}>
                <span className="block text-[14px] font-semibold text-adm-ink">{s.display_name}</span>
                <span className="block text-[12px] text-adm-muted">{s.status === "active" ? "Active" : "Inactive"}{policyOf(s.id)?.mode === "enrichment" ? " · paid data on" : " · feed only"}</span>
              </button>
            </li>
          ))}
          {!reg.children.length && <li className="text-[13px] text-adm-muted">No child stores.</li>}
        </ul>
      </div>
      {reviewRows.length > 0 && (
        <button type="button" aria-current={sel === REVIEW ? "page" : undefined} onClick={() => pick(REVIEW)}
          className={`w-full rounded-[6px] border px-3 py-2 text-left ${sel === REVIEW ? "border-adm-primary bg-adm-selected" : "border-[#F1D58A] bg-adm-warning-bg"}`}>
          <span className="block text-[14px] font-semibold text-adm-ink">Needs rooftop review</span>
          <span className="block text-[12px] text-adm-muted">{reviewRows.length} active {reviewRows.length === 1 ? "listing" : "listings"}</span>
        </button>
      )}
    </nav>
  );

  const status = !tenantId || storesQ.isLoading ? "loading" : storesQ.isError ? "error" : stores.length ? "ready" : "empty";
  return (
    <ChildPageFrame section="integrations" crumbs={crumbs} title="Inventory by store" subtitle={tenant?.name ?? undefined}>
      <QueryState status={status} errorTitle="Could not load stores" errorDetail={storesQ.isError ? explainError(storesQ.error) : undefined} onRetry={() => storesQ.refetch()}
        emptyTitle="This account has one rooftop" emptyDetail="Inventory has no child stores to separate. The Inventory screen shows everything.">
        {summary && reg.primary && (
          <p className="mb-4 text-[14px] text-adm-muted">
            Primary dealership listings: {summary.primary.total} ({countsLine(summary.primary)}). Child stores never add to these totals.
            {listingsQ.data && !listingsQ.data.dealerIdRead && " Provider dealer ids could not be read, so only feed ownership is used."}
          </p>
        )}
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          {nav}
          <div>
            {sel === REVIEW
              ? <ReviewDetail reg={reg} rows={reviewRows} stores={stores} isAdmin={isAdmin} />
              : selected
                ? <StoreDetail key={selected.id} store={selected as TenantStore} policy={policyOf(selected.id)} isAdmin={isAdmin} primary={selected.id === reg.primary?.id}
                    extraListings={selected.id === reg.primary?.id ? (summary?.primary ?? null) : (summary?.byChild.get(selected.id) ?? null)} />
                : <Panel><EmptyState title="Choose a store" detail="No primary store is designated for this account. A platform administrator sets it in Inventory network." compact /></Panel>}
          </div>
        </div>
      </QueryState>
    </ChildPageFrame>
  );
}
