import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { ChildPageFrame } from "@/components/admin/v2/AdminShell";
import { Button, EmptyState, InlineNote, KeyValueList, MetricStrip, Panel, QueryState, StatusText, Td, Th, WorkTable, type Tone } from "@/components/product";
import { adminTabHref } from "@/lib/admin/sections";
import { explainError, type StoreEnrichmentPolicy } from "@/lib/inventoryNetwork/api";
import { getStoreFeedState, listStorePolicies, listStoreUsageThisMonth, listStoreVehicles, listTenantStores, type TenantStore } from "@/lib/inventoryScope/api";
import { loadScopedInventory, scopeFailureOf, type ScopedInventory } from "@/lib/inventoryScope/primaryInventory";
import { CONFLICT_TEXT, MappingUnavailableError, mappedDealerIds, planMapping, saveMapping, type MappingAction, type MappingPlan } from "@/lib/inventoryScope/mapping";
import { resolveListingScope, storeFeedHealth, summarizeUsage, type ConditionCounts, type ScopeBasis } from "@/lib/inventoryScope/storeScope";
import { DATA_CATEGORIES, categoryState, isSwitchable } from "@/lib/inventoryScope/dataControls";

// AutoLabels Admin > Inventory by store. The primary dealership is the default
// view; every child (sister) store is its own selection and never adds to the
// primary totals. Everything here is a read of data AutoLabels already holds:
// opening this page never calls MarketCheck or any other paid provider. The
// only write is a rooftop mapping, made by a platform administrator after an
// explicit review, through a server function that re-checks every rule.

const NETWORK_PATH = "/admin/integrations/inventory-network";
const REVIEW = "review";

const crumbs = [{ label: "Administration", href: "/admin" }, { label: "Integrations", href: adminTabHref("inventory-feed") }, { label: "Inventory by store" }];

const fmtWhen = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : "Never");
const countsLine = (c: ConditionCounts) => `${c.new} new · ${c.used} used · ${c.cpo} CPO${c.unknown ? ` · ${c.unknown} unclassified` : ""}`;
const n = (v: number) => v.toLocaleString("en-US");

interface PageListing {
  id: string; vin: string; ymm: string | null; condition: string | null; status: string; updated_at: string;
  tenant_id?: string | null; owning_store_id?: string | null; mc_dealer_id?: string | null;
  mc_dealer_name?: string | null; mc_dealer_website?: string | null; mc_dealer_street?: string | null; mc_dealer_city?: string | null; mc_dealer_state?: string | null;
}

const LISTING_COLS = "id,vin,ymm,condition,status,updated_at";
const EVIDENCE_COLS = "mc_dealer_name:mc_raw->dealer->>name,mc_dealer_website:mc_raw->dealer->>website,mc_dealer_street:mc_raw->dealer->>street,mc_dealer_city:mc_raw->dealer->>city,mc_dealer_state:mc_raw->dealer->>state";

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

/** Calls this store may still make this month under its own policy; 0 unless paid enrichment is on. */
export function remainingAuthorized(p: StoreEnrichmentPolicy | undefined, admitted: number): number {
  if (!p || p.mode !== "enrichment" || p.budget_blocked) return 0;
  return Math.max(0, Math.floor((p.monthly_request_cap * p.hard_stop_pct) / 100) - admitted);
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
          { label: "Paid enrichment", value: <StatusText tone={mode.tone} className="whitespace-normal">{mode.label}</StatusText> },
          { label: "MarketCheck products enabled", value: allowed.length ? allowed.join(", ").replace(/_/g, " ") : "None" },
          { label: "Refresh frequency", value: policy?.refresh_cadence_hours ? `Every ${policy.refresh_cadence_hours} hours at most` : "Not scheduled" },
          { label: "Credit priority", value: primary ? "Primary: allocated before child stores" : "Child: uses only what is left after the primary store's holdback and the account reserve" },
          { label: "Customer inventory sharing", value: store.inventory_sharing_enabled ? "On (separate from paid data)" : "Off (separate from paid data)" },
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

function UsagePanel({ storeId, policy }: { storeId: string; policy: StoreEnrichmentPolicy | undefined }) {
  const q = useQuery({ queryKey: ["store-inventory", "usage", storeId], queryFn: () => listStoreUsageThisMonth(storeId) });
  const u = q.data ? summarizeUsage(q.data) : null;
  const cap = policy?.mode === "enrichment" ? policy.monthly_request_cap : 0;
  return (
    <Panel title="MarketCheck budget this month" description="Calls recorded against this store only. Estimates use list prices and are not a bill.">
      <QueryState status={q.isLoading ? "loading" : q.isError ? "error" : "ready"} errorTitle="Could not load usage" errorDetail={q.isError ? `${explainError(q.error)} No usage figure is shown.` : undefined} onRetry={() => q.refetch()}>
        {u && (
          <KeyValueList rows={[
            { label: "Monthly call allocation", value: cap ? `${n(cap)} calls` : "None (feed only)" },
            { label: "Calls consumed", value: n(u.admitted) },
            { label: "Calls refused", value: u.denied ? `${n(u.denied)} (${Object.entries(u.denyReasons).map(([k, c]) => `${k.replace(/_/g, " ")} ${c}`).join(", ")})` : "0" },
            { label: "Remaining authorized", value: `${n(remainingAuthorized(policy, u.admitted))} calls` },
            { label: "Estimated cost", value: `$${u.estimatedUsd.toFixed(2)}${u.unpriced ? `, plus ${u.unpriced} unpriced` : ""}` },
          ]} />
        )}
      </QueryState>
    </Panel>
  );
}

function FeedPanel({ store, isAdmin }: { store: TenantStore; isAdmin: boolean }) {
  const q = useQuery({ queryKey: ["store-inventory", "feed-state", store.id], queryFn: () => getStoreFeedState(store.id), enabled: isAdmin });
  if (!isAdmin) return null;
  const st = q.data?.state;
  const mapping = q.data?.mappings ?? [];
  const health: { label: string; tone: Tone } = !st?.last_applied_at
    ? { label: "No feed imported yet", tone: "warning" }
    : st.last_failure_at && st.last_failure_at > st.last_applied_at
      ? { label: "Last import failed", tone: "danger" }
      : { label: "Imported", tone: "success" };
  return (
    <Panel title="Inventory feed health" description="Files.com import state for this store. Visible to platform administrators.">
      <QueryState status={q.isLoading ? "loading" : q.isError ? "error" : "ready"} errorTitle="Could not load feed state" errorDetail={q.isError ? explainError(q.error) : undefined} onRetry={() => q.refetch()}>
        <KeyValueList rows={[
          { label: "Feed health", value: <StatusText tone={health.tone}>{health.label}</StatusText> },
          { label: "Last successful synchronization", value: fmtWhen(st?.last_applied_at) },
          { label: "Last failure", value: st?.last_failure_at ? `${fmtWhen(st.last_failure_at)}${st.last_failure_reason ? ` (${st.last_failure_reason.replace(/_/g, " ")})` : ""}` : "None recorded" },
          { label: "Source data", value: mapping.length ? mapping.map((m) => `vAuto ${m.source_dealer_id}: ${m.status}`).join("; ") : "No vAuto mapping" },
        ]} />
      </QueryState>
    </Panel>
  );
}

function MappedDealers({ store, stores, rows, isAdmin, onDone }: { store: TenantStore; stores: TenantStore[]; rows: PageListing[]; isAdmin: boolean; onDone: () => void }) {
  const ids = mappedDealerIds(store);
  const [plan, setPlan] = useState<MappingPlan | null>(null);
  if (!ids.length) return null;
  return (
    <Panel title="Mapped provider dealer ids" description="MarketCheck listings with these dealer ids count as this store's inventory.">
      <ul className="space-y-2">
        {ids.map((d) => (
          <li key={d} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[14px]">MarketCheck dealer {d}</span>
            {isAdmin && <Button size="sm" onClick={() => setPlan(planMapping(stores, rows, d, store.id, "unmap"))}>Unmap</Button>}
          </li>
        ))}
      </ul>
      {plan && <MappingReview plan={plan} rows={rows} onCancel={() => setPlan(null)} onSaved={() => { setPlan(null); onDone(); }} />}
    </Panel>
  );
}

function StoreDetail({ store, stores, policy, isAdmin, primary, listings, rows, onMapped }: {
  store: TenantStore; stores: TenantStore[]; policy: StoreEnrichmentPolicy | undefined; isAdmin: boolean; primary: boolean;
  listings: ConditionCounts | null; rows: PageListing[]; onMapped: () => void;
}) {
  const q = useQuery({ queryKey: ["store-inventory", "vehicles", store.id], queryFn: () => listStoreVehicles(store.id) });
  const h = q.data ? storeFeedHealth(q.data) : null;
  const present = (q.data ?? []).filter((v) => v.presence === "present");
  const [shown, setShown] = useState(100);
  return (
    <div className="space-y-4">
      {q.isError && <InlineNote tone="danger" title="This store's feed vehicles could not be read">{explainError(q.error)} No feed count is shown.</InlineNote>}
      <MetricStrip label={`${store.display_name} inventory`} metrics={[
        { label: "In feed", value: h ? h.counts.total : null, loading: q.isLoading, tone: "info" },
        { label: "New", value: h ? h.counts.new : null, loading: q.isLoading },
        { label: "Used", value: h ? h.counts.used : null, loading: q.isLoading },
        { label: "CPO", value: h ? h.counts.cpo : null, loading: q.isLoading },
      ]} />
      <Panel title="Synchronization" description="Inventory of record is the dealer's vAuto feed delivered through Files.com.">
        <KeyValueList rows={[
          { label: "Feed", value: store.inventory_feed_enabled ? "On" : "Off" },
          { label: "Last vehicle seen in feed", value: h ? fmtWhen(h.lastFeedUpdate) : q.isError ? "Unavailable" : "Loading" },
          { label: "Missing vehicle information", value: h ? `${h.noStockNumber} without stock number, ${h.noPrice} without a feed price, ${h.missingFromLastFeed} absent from the last feed (kept, not removed)` : "Unavailable" },
          { label: "Paid data current", value: h ? `${h.enrichmentFresh} of ${h.counts.total}` : "Unavailable" },
          { label: "AutoLabels listings", value: listings ? `${n(listings.total)} active (${countsLine(listings)})` : "Unavailable" },
        ]} />
      </Panel>
      <FeedPanel store={store} isAdmin={isAdmin} />
      <DataControls store={store} policy={policy} isAdmin={isAdmin} primary={primary} />
      <UsagePanel storeId={store.id} policy={policy} />
      <MappedDealers store={store} stores={stores} rows={rows} isAdmin={isAdmin} onDone={onMapped} />
      <Panel title="Vehicles" description="This store's feed vehicles only." flush>
        <QueryState status={q.isLoading ? "loading" : q.isError ? "error" : present.length ? "ready" : "empty"} errorTitle="Could not load vehicles" errorDetail={q.isError ? explainError(q.error) : undefined} onRetry={() => q.refetch()}
          emptyTitle="No vehicles from this store's feed yet" emptyDetail="The feed for this store has not been imported. Nothing is created to fill this view.">
          <WorkTable caption={`${store.display_name} vehicles`} minWidth={760}>
            <thead><tr><Th>Vehicle</Th><Th>VIN</Th><Th>Stock</Th><Th>Condition</Th><Th align="right">Feed price</Th><Th>Paid data</Th></tr></thead>
            <tbody>
              {present.slice(0, shown).map((v) => (
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
          {present.length > shown && (
            <div className="flex items-center justify-between gap-3 px-4 py-3 text-[13px] text-adm-muted">
              <span>Showing {n(shown)} of {n(present.length)}</span>
              <Button size="sm" onClick={() => setShown((s) => s + 100)}>Show 100 more</Button>
            </div>
          )}
        </QueryState>
      </Panel>
    </div>
  );
}

const BASIS_TITLE: Partial<Record<ScopeBasis, string>> = {
  no_verified_rooftop: "No rooftop evidence (manual or legacy entry)",
  unknown_store: "Owned by a store this account cannot see",
  ambiguous_provider_dealer: "Dealer id mapped to more than one store",
};

function MappingReview({ plan, rows, onCancel, onSaved }: { plan: MappingPlan; rows: PageListing[]; onCancel: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sample = rows.find((r) => String(r.mc_dealer_id ?? "") === plan.dealerId);
  const feedAtStore = plan.store ? rows.filter((r) => r.owning_store_id === plan.store!.id && String(r.mc_dealer_id ?? "") === plan.dealerId).length : 0;
  const blocked = plan.conflicts.length > 0;
  const submit = async () => {
    if (!plan.store) return;
    setSaving(true); setErr(null);
    try {
      await saveMapping(plan, {
        provider_dealer_name: sample?.mc_dealer_name ?? null,
        provider_dealer_website: sample?.mc_dealer_website ?? null,
        provider_dealer_address: [sample?.mc_dealer_street, sample?.mc_dealer_city, sample?.mc_dealer_state].filter(Boolean).join(", ") || null,
        source: "marketcheck_listing_dealer_record",
        feed_vehicles_at_store: feedAtStore,
        confirmed_destination: plan.store.id,
      }, reason, plan.store.updated_at ?? null);
      onSaved();
    } catch (e) {
      setErr(e instanceof MappingUnavailableError ? e.message : e instanceof Error ? e.message : "The mapping was not saved.");
    } finally { setSaving(false); }
  };
  const verb = plan.action === "map" ? "Map" : "Unmap";
  return (
    <section aria-label="Review mapping" className="mt-4 rounded-[6px] border border-adm-border bg-adm-workspace p-4 space-y-3">
      <h3 className="text-[15px] font-semibold text-adm-ink">{verb} MarketCheck dealer {plan.dealerId} {plan.action === "map" ? "to" : "from"} {plan.store?.display_name ?? "a store"}</h3>
      <KeyValueList rows={[
        { label: "Provider dealer", value: sample ? `${sample.mc_dealer_name ?? "Unknown name"}${sample.mc_dealer_website ? `, ${sample.mc_dealer_website}` : ""}` : "No listing carries this id" },
        { label: "Provider address", value: [sample?.mc_dealer_street, sample?.mc_dealer_city, sample?.mc_dealer_state].filter(Boolean).join(", ") || "Unknown" },
        { label: "Destination rooftop", value: plan.store ? `${plan.store.display_name}${plan.store.street ? `, ${plan.store.street}` : ""}${plan.store.city ? `, ${plan.store.city}` : ""}` : "None" },
        { label: "Feed evidence", value: `${n(feedAtStore)} of this store's own feed vehicles carry this dealer id` },
        { label: "Current mapping", value: plan.previous.length ? plan.previous.join(", ") : "None" },
        { label: "New mapping", value: plan.next.length ? plan.next.join(", ") : "None" },
        { label: "Effect", value: plan.action === "map" ? `${n(plan.affected)} listings move from rooftop review into ${plan.store?.display_name ?? "this store"}` : `${n(plan.affected)} listings move back to rooftop review` },
      ]} />
      {blocked && (
        <InlineNote tone="danger" title="This mapping cannot be saved">
          <ul className="list-disc pl-5">{plan.conflicts.map((c) => <li key={c.code}>{CONFLICT_TEXT(c)}</li>)}</ul>
        </InlineNote>
      )}
      {!blocked && (
        <>
          <label className="block text-[14px]">
            <span className="font-semibold text-adm-ink">Reason and source of verification</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full rounded-[4px] border border-adm-border bg-adm-surface px-2 py-1 text-[14px]" />
          </label>
          <label className="flex items-start gap-2 text-[14px]">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1" />
            <span>I verified that dealer {plan.dealerId} is {plan.action === "map" ? "" : "not "}{plan.store?.display_name}, and I understand this changes which inventory the dealership sees.</span>
          </label>
        </>
      )}
      {err && <InlineNote tone="danger" title="Nothing was changed">{err}</InlineNote>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={blocked || !confirmed || reason.trim().length < 10 || saving} onClick={submit}>{saving ? "Saving" : `${verb} dealer id`}</Button>
        <Button onClick={onCancel} disabled={saving}>Cancel</Button>
      </div>
    </section>
  );
}

function ReviewDetail({ rows, allRows, stores, isAdmin, scoped, onMapped }: { rows: PageListing[]; allRows: PageListing[]; stores: TenantStore[]; isAdmin: boolean; scoped: ScopedInventory<PageListing>; onMapped: () => void }) {
  const [target, setTarget] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<MappingPlan | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, { title: string; dealerId: string | null; list: PageListing[] }>();
    for (const r of rows) {
      const basis = resolveListingScope(r, scoped.registry).basis;
      const dealerId = basis === "unmapped_provider_dealer" ? String(r.mc_dealer_id).trim() : null;
      const key = dealerId ? `d:${dealerId}` : `b:${basis}`;
      const title = dealerId ? `MarketCheck dealer ${dealerId}${r.mc_dealer_name ? ` (${r.mc_dealer_name})` : ""}` : BASIS_TITLE[basis] ?? "Needs review";
      const g = m.get(key) ?? { title, dealerId, list: [] };
      g.list.push(r);
      m.set(key, g);
    }
    return [...m.values()];
  }, [rows, scoped.registry]);
  if (!rows.length) return <Panel><EmptyState title="Nothing needs rooftop review" compact /></Panel>;
  return (
    <div className="space-y-4">
      <InlineNote tone="warning" title="These listings have no verified rooftop">
        They are kept out of the primary dealership's list and totals until a rooftop is verified, because they may belong to a sister store. Nothing is deleted, archived, transferred or repriced, and customers see no change.
      </InlineNote>
      {groups.map((g) => (
        <Panel key={g.title} title={g.title} description={`${g.list.length} active ${g.list.length === 1 ? "listing" : "listings"}`} flush
          action={g.dealerId && !isAdmin ? <span className="text-[13px] text-adm-muted">A platform administrator maps dealer ids</span> : undefined}>
          {g.dealerId && isAdmin && (
            <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
              <label className="sr-only" htmlFor={`map-${g.dealerId}`}>Map dealer {g.dealerId} to a store</label>
              <select id={`map-${g.dealerId}`} className="min-w-0 max-w-full rounded-[4px] border border-adm-border bg-adm-surface px-2 py-1 text-[14px]" value={target[g.dealerId] ?? ""} onChange={(e) => setTarget((t) => ({ ...t, [g.dealerId!]: e.target.value }))}>
                <option value="">Choose the verified store</option>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.display_name}{scoped.registry.primary?.id === s.id ? " (primary)" : ""}</option>)}
              </select>
              <Button size="sm" variant="primary" disabled={!target[g.dealerId]} onClick={() => setPlan(planMapping(stores, allRows, g.dealerId!, target[g.dealerId!], "map"))}>Review mapping</Button>
            </div>
          )}
          {plan && plan.dealerId === g.dealerId && (
            <div className="px-4"><MappingReview plan={plan} rows={allRows} onCancel={() => setPlan(null)} onSaved={() => { setPlan(null); onMapped(); }} /></div>
          )}
          {!g.dealerId && g.title === BASIS_TITLE.no_verified_rooftop && (
            <p className="px-4 pt-3 text-[13px] text-adm-muted">These carry neither a feed owner nor a provider dealer id, so the rooftop cannot be verified from data. They stay here until a rooftop is assigned.</p>
          )}
          <WorkTable caption={g.title} minWidth={560}>
            <thead><tr><Th>Vehicle</Th><Th>VIN</Th><Th>Condition</Th><Th>Status</Th></tr></thead>
            <tbody>{g.list.map((r) => <tr key={r.id}><Td>{r.ymm || "Unknown"}</Td><Td className="font-mono text-[13px]">{r.vin}</Td><Td>{r.condition ?? "Unknown"}</Td><Td>{r.status}</Td></tr>)}</tbody>
          </WorkTable>
        </Panel>
      ))}
    </div>
  );
}

export default function StoreInventoryPage() {
  const { isAdmin } = useAuth();
  const { tenant } = useTenant();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tenantId = tenant?.id ?? null;

  const storesQ = useQuery({ queryKey: ["store-inventory", "stores", tenantId], queryFn: () => listTenantStores(tenantId!), enabled: !!tenantId });
  const stores = useMemo(() => storesQ.data ?? [], [storesQ.data]);
  const policiesQ = useQuery({ queryKey: ["store-inventory", "policies", stores.map((s) => s.id).join(",")], queryFn: () => listStorePolicies(stores.map((s) => s.id)), enabled: stores.length > 0 });
  const scopedQ = useQuery({
    queryKey: ["store-inventory", "scoped", tenantId],
    queryFn: () => loadScopedInventory<PageListing>({ tenantId: tenantId!, includeArchived: false, columnSets: [`${LISTING_COLS},${EVIDENCE_COLS}`, LISTING_COLS] }),
    enabled: !!tenantId && stores.length > 0,
    retry: false,
  });
  const scoped = scopedQ.data ?? null;
  const reg = scoped?.registry ?? null;
  const reviewRows = useMemo(() => (scoped ? scoped.rows.filter((r) => resolveListingScope(r, scoped.registry).kind === "rooftop_review") : []), [scoped]);
  const policyOf = (id: string) => policiesQ.data?.find((p) => p.store_id === id);
  const refresh = () => qc.invalidateQueries({ queryKey: ["store-inventory"] });

  const sel = params.get("store");
  const selected = !reg ? null : sel === REVIEW ? null : (sel && (reg.byId.get(sel) as TenantStore | undefined)) || (reg.primary as TenantStore | null);
  const pick = (id: string) => setParams(new URLSearchParams({ store: id }));
  const listingsOf = (id: string): ConditionCounts | null => !scoped ? null : id === reg?.primary?.id ? scoped.summary.primary : scoped.summary.byChild.get(id) ?? { total: 0, new: 0, used: 0, cpo: 0, unknown: 0 };

  const navButton = (s: TenantStore, sub: string) => (
    <button type="button" aria-current={selected?.id === s.id ? "page" : undefined} onClick={() => pick(s.id)}
      className={`w-full rounded-[6px] border px-3 py-2 text-left ${selected?.id === s.id ? "border-adm-primary bg-adm-selected" : "border-adm-border bg-adm-surface"}`}>
      <span className="block text-[14px] font-semibold text-adm-ink">{s.display_name}</span>
      <span className="block text-[12px] text-adm-muted">{sub}</span>
    </button>
  );

  const nav = reg && (
    <nav aria-label="Stores" className="space-y-4">
      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-adm-muted">Primary dealership</p>
        {reg.primary ? navButton(reg.primary as TenantStore, "Default view") : <p className="text-[13px] text-adm-muted">No primary store is designated.</p>}
      </div>
      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-adm-muted">Child stores ({reg.children.length})</p>
        <ul className="space-y-2">
          {reg.children.map((s) => (
            <li key={s.id}>{navButton(s as TenantStore, `${s.status === "active" ? "Active" : "Inactive"}${policyOf(s.id)?.mode === "enrichment" ? " · paid data on" : " · feed only"}`)}</li>
          ))}
          {!reg.children.length && <li className="text-[13px] text-adm-muted">No child stores.</li>}
        </ul>
      </div>
      <button type="button" aria-current={sel === REVIEW ? "page" : undefined} onClick={() => pick(REVIEW)}
        className={`w-full rounded-[6px] border px-3 py-2 text-left ${sel === REVIEW ? "border-adm-primary bg-adm-selected" : reviewRows.length ? "border-[#F1D58A] bg-adm-warning-bg" : "border-adm-border bg-adm-surface"}`}>
        <span className="block text-[14px] font-semibold text-adm-ink">Needs rooftop review</span>
        <span className="block text-[12px] text-adm-muted">{reviewRows.length} active {reviewRows.length === 1 ? "listing" : "listings"}</span>
      </button>
    </nav>
  );

  const failure = scopedQ.isError ? scopeFailureOf(scopedQ.error) : null;
  const status = !tenantId || storesQ.isLoading || (stores.length > 0 && scopedQ.isLoading) ? "loading" : storesQ.isError ? "error" : stores.length ? "ready" : "empty";
  return (
    <ChildPageFrame section="integrations" crumbs={crumbs} title="Inventory by store" subtitle={tenant?.name ?? undefined}>
      <QueryState status={status} errorTitle="Could not load stores" errorDetail={storesQ.isError ? `${explainError(storesQ.error)} Inventory is not shown without the store list.` : undefined} onRetry={() => storesQ.refetch()}
        emptyTitle="This account has one rooftop" emptyDetail="Inventory has no child stores to separate. The Inventory screen shows everything.">
        {failure && (
          <div role="alert" data-testid="store-scope-error">
            <InlineNote tone="danger" title={failure.title} action={<Button size="sm" onClick={() => scopedQ.refetch()}>Retry</Button>}>
              {failure.detail} No vehicle has been moved, changed or removed.
            </InlineNote>
          </div>
        )}
        {scoped && reg && (
          <>
            <p className="mb-4 text-[14px] text-adm-muted">
              {reg.primary ? <>Primary dealership listings: {n(scoped.summary.primary.total)} ({countsLine(scoped.summary.primary)}). </> : null}
              Rooftop review: {n(scoped.summary.review.total)}. Child stores never add to the primary totals. {n(scoped.totalRead)} active listings read and verified against the database count.
            </p>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
              {nav}
              <div className="min-w-0">
                {sel === REVIEW
                  ? <ReviewDetail rows={reviewRows} allRows={scoped.rows} stores={stores} isAdmin={isAdmin} scoped={scoped} onMapped={refresh} />
                  : selected
                    ? <StoreDetail key={selected.id} store={selected} stores={stores} policy={policyOf(selected.id)} isAdmin={isAdmin} primary={selected.id === reg.primary?.id}
                        listings={listingsOf(selected.id)} rows={scoped.rows} onMapped={refresh} />
                    : <Panel><EmptyState title="Choose a store" detail="No primary store is designated for this account. A platform administrator sets it in Inventory network." compact /></Panel>}
              </div>
            </div>
          </>
        )}
      </QueryState>
    </ChildPageFrame>
  );
}
