import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Button, EmptyState, InlineNote, KeyValueList, Panel, QueryState, StatusText, Td, Th, WorkTable } from "@/components/product";
import { MC_CALL_PRICE_USD } from "../../../../../supabase/functions/_shared/mcCost";
import { ENRICHMENT_PRODUCTS, explainError, getUsage, listCatalog, saveEnrichmentPolicy, PILOT_ACCOUNT, type EnrichmentMode, type EnrichmentPolicyDraft, type StoreOverview } from "@/lib/inventoryNetwork/api";
import { CheckField, NumberField, SelectField, TextField, humanize, mcModeLabel, useAct, useNet, when } from "./shared";

const PRODUCT_INFO: Record<string, string> = {
  basic_vin_decode: "Decodes a VIN into year, make, model and basic specs.",
  neovin: "Detailed factory build data, equipment and packages for a VIN.",
  vin_history: "Past listing history for a VIN: price changes and days on market.",
  price_prediction: "Predicts a market price from comparable vehicles.",
  inventory_search: "Searches nearby active listings for comparison.",
  market_days_supply: "How many days of supply of this model the local market holds.",
  recent_inventory: "Recently sold or expired listings, for pricing context.",
  sales_stats: "Estimated sales volume and average sale price by model.",
  auto_recalls: "Open safety recalls for a VIN.",
  cached_images: "Stock photos for a vehicle when the feed has none.",
};

const money = (n: number, digits = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const price = (p: string) => MC_CALL_PRICE_USD[p] ?? 0;

const draftFor = (s: StoreOverview): EnrichmentPolicyDraft => {
  const p = s.policy;
  return {
    store_id: s.store.id, mode: p?.mode ?? "feed_only", budget_blocked: p?.budget_blocked ?? false, credential_ref: p?.credential_ref ?? "",
    mc_rooftop_id: p?.mc_rooftop_id ?? "", mc_rooftop_verified: !!p?.mc_rooftop_verified_at, allowed_products: p?.allowed_products ?? [],
    refresh_cadence_hours: p?.refresh_cadence_hours ?? null, freshness_hours: p?.freshness_hours ?? null, backfill_limit: p?.backfill_limit ?? 0, per_run_limit: p?.per_run_limit ?? 0,
    daily_request_limit: p?.daily_request_limit ?? 0, monthly_request_cap: p?.monthly_request_cap ?? 0, monthly_usd_cap: p?.monthly_usd_cap ?? null,
    warn_pct: p?.warn_pct ?? 80, hard_stop_pct: p?.hard_stop_pct ?? 100, manual_refresh_allowed: p?.manual_refresh_allowed ?? false, enrich_shared_inventory: p?.enrich_shared_inventory ?? false,
  };
};

function missingForEnrichment(d: EnrichmentPolicyDraft): string[] {
  const m: string[] = [];
  if (!d.credential_ref) m.push("a credential");
  if (!d.mc_rooftop_id.trim()) m.push("a MarketCheck rooftop ID");
  if (!d.mc_rooftop_verified) m.push("the rooftop marked verified");
  if (d.allowed_products.length === 0) m.push("at least one product");
  if (!(d.daily_request_limit > 0)) m.push("a daily request cap");
  if (!(d.monthly_request_cap > 0)) m.push("a monthly request cap");
  return m;
}

interface ProductRow { key: string; label: string; info: string; price: number | null; basis: string }

function PolicyForm({ s, products }: { s: StoreOverview; products: ProductRow[] }) {
  const { act, busy } = useAct();
  const base = useMemo(() => draftFor(s), [s]);
  const [d, setD] = useState<EnrichmentPolicyDraft>(base);
  const [ack, setAck] = useState(false);
  const set = <K extends keyof EnrichmentPolicyDraft>(k: K, v: EnrichmentPolicyDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(d) !== JSON.stringify(base);
  const enabling = d.mode === "enrichment" && s.policy?.mode !== "enrichment";
  const missing = d.mode === "enrichment" ? missingForEnrichment(d) : [];
  const pctOk = d.warn_pct >= 1 && d.warn_pct <= 100 && d.hard_stop_pct >= 1 && d.hard_stop_pct <= 100 && d.warn_pct <= d.hard_stop_pct;
  const canSave = dirty && missing.length === 0 && pctOk && (!enabling || ack);
  const toggleProduct = (p: string, on: boolean) => set("allowed_products", on ? [...d.allowed_products, p] : d.allowed_products.filter((x) => x !== p));
  const priceOf = (k: string) => products.find((p) => p.key === k)?.price ?? 0;
  const topPrice = Math.max(0, ...d.allowed_products.map(priceOf));
  const worst = d.monthly_request_cap * topPrice;
  const state = mcModeLabel(s.policy);

  return (
    <Panel
      title="Policy"
      description="Missing policy means Feed only: the feed supplies vehicles and no paid lookup is ever made."
      action={<div className="flex items-center gap-3">{dirty && <StatusText tone="warning">Unsaved changes</StatusText>}<Button variant="primary" disabled={busy || !canSave} onClick={() => act(() => saveEnrichmentPolicy(d), "MarketCheck policy saved")}>Save policy</Button></div>}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13px] text-adm-muted">Current state</span>
          <StatusText tone={state.tone} className="text-[14px]">{state.label}</StatusText>
          {s.policy?.budget_blocked && <span className="text-[13px] text-adm-danger">A budget limit stopped paid lookups for this store.</span>}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <SelectField id="mc-mode" label="Mode" value={d.mode} onChange={(v) => { set("mode", v as EnrichmentMode); setAck(false); }} options={[{ value: "feed_only", label: "Feed only (no paid lookups)" }, { value: "enrichment", label: "Enrichment enabled (paid lookups)" }, { value: "paused", label: "Paused (keep settings, no lookups)" }]} />
          <SelectField id="mc-cred" label="Credential" value={d.credential_ref} onChange={(v) => set("credential_ref", v)} options={[{ value: "", label: "None" }, { value: "MARKETCHECK_API_KEY", label: "MARKETCHECK_API_KEY" }]} hint="The name of a saved server secret. The key itself is never shown." />
          <TextField id="mc-roof" label="MarketCheck rooftop ID" value={d.mc_rooftop_id} onChange={(v) => set("mc_rooftop_id", v)} hint="Letters, numbers and . _ : - only. Changing it clears verification unless you tick it again." />
          <div className="self-end pb-2"><CheckField id="mc-ver" label="Rooftop verified" checked={d.mc_rooftop_verified} onChange={(v) => set("mc_rooftop_verified", v)} hint={s.policy?.mc_rooftop_verified_at ? `Verified ${when(s.policy.mc_rooftop_verified_at)}` : "Confirm this rooftop ID belongs to this store."} /></div>
        </div>

        <fieldset>
          <legend className="mb-2 text-[14px] font-semibold text-adm-ink">Approved products</legend>
          <ul className="grid gap-3 md:grid-cols-2">
            {products.map((p) => (
              <li key={p.key}>
                <CheckField id={`mc-p-${p.key}`} checked={d.allowed_products.includes(p.key)} onChange={(v) => toggleProduct(p.key, v)} label={<>{p.label} <span className="font-normal text-adm-muted">{p.basis} {p.price === null ? "unknown" : money(p.price, 4)} per call</span></>} hint={p.info} />
              </li>
            ))}
          </ul>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-[14px] font-semibold text-adm-ink">Limits</legend>
          <div className="grid gap-4 md:grid-cols-3">
            <NumberField id="mc-cad" label="Refresh cadence (hours)" value={d.refresh_cadence_hours} onChange={(v) => set("refresh_cadence_hours", v)} min={1} max={8760} hint="How often a vehicle may be refreshed." />
            <NumberField id="mc-fresh" label="Freshness (hours)" value={d.freshness_hours} onChange={(v) => set("freshness_hours", v)} min={1} max={8760} hint="Data newer than this is not fetched again." />
            <NumberField id="mc-back" label="Backfill limit" value={d.backfill_limit} onChange={(v) => set("backfill_limit", v ?? 0)} min={0} max={5000} hint="Vehicles enriched when enrichment first starts." />
            <NumberField id="mc-run" label="Per-run limit" value={d.per_run_limit} onChange={(v) => set("per_run_limit", v ?? 0)} min={0} max={5000} hint="Most vehicles looked up in one pass." />
            <NumberField id="mc-day" label="Daily request cap" value={d.daily_request_limit} onChange={(v) => set("daily_request_limit", v ?? 0)} min={0} max={100000} />
            <NumberField id="mc-month" label="Monthly request cap" value={d.monthly_request_cap} onChange={(v) => set("monthly_request_cap", v ?? 0)} min={0} max={1000000} />
            <NumberField id="mc-usd" label="Monthly USD cap" value={d.monthly_usd_cap} onChange={(v) => set("monthly_usd_cap", v)} min={0} step={0.01} hint="Leave empty for no dollar cap." />
            <NumberField id="mc-warn" label="Warn at (%)" value={d.warn_pct} onChange={(v) => set("warn_pct", v ?? 0)} min={1} max={100} error={pctOk ? null : "Warn must be 1 to 100 and not above hard stop."} />
            <NumberField id="mc-hard" label="Hard stop at (%)" value={d.hard_stop_pct} onChange={(v) => set("hard_stop_pct", v ?? 0)} min={1} max={100} />
          </div>
          <div className="mt-4 space-y-3">
            <CheckField id="mc-manual" label="Manual refresh allowed" checked={d.manual_refresh_allowed} onChange={(v) => set("manual_refresh_allowed", v)} hint="Store staff may ask for a refresh of one vehicle. It still counts against the caps." />
            <CheckField id="mc-shared" label="Enrich shared inventory" checked={d.enrich_shared_inventory} onChange={(v) => set("enrich_shared_inventory", v)} hint="Also look up vehicles this store receives from siblings. Leave off: showing a sibling's vehicles never triggers a lookup." />
            <CheckField id="mc-budget" label="Budget blocked" checked={d.budget_blocked} onChange={(v) => set("budget_blocked", v)} hint="Stops all paid lookups for this store until cleared." />
          </div>
        </fieldset>

        <InlineNote tone="info" title="Bulk, backfill and scheduled refresh are refused by the database until every approved product is verified.">Setting a backfill limit, per-run limit or refresh cadence fails with a message listing the products still unverified. Verify them in Provider catalog.</InlineNote>
        {d.mode === "enrichment" && missing.length > 0 && <InlineNote tone="warning" title="Enrichment is not ready to save">Add {missing.join(", ")}.</InlineNote>}
        {enabling && missing.length === 0 && (
          <div role="group" aria-label="Enrichment consequences" className="space-y-3 rounded-[6px] border border-[#F1D58A] bg-adm-warning-bg p-4">
            <p className="text-[14px] font-semibold text-[#5F3F00]">Switching on enrichment makes paid MarketCheck calls</p>
            <ul className="list-disc space-y-1 pl-5 text-[13px] text-[#5F3F00]">
              <li>Products: {d.allowed_products.map((k) => products.find((p) => p.key === k)?.label ?? humanize(k)).join(", ")}.</li>
              <li>Caps: {d.daily_request_limit.toLocaleString("en-US")} requests a day and {d.monthly_request_cap.toLocaleString("en-US")} a month{d.monthly_usd_cap !== null ? `, and ${money(d.monthly_usd_cap)} a month` : ", with no dollar cap"}.</li>
              <li>At most about {money(d.monthly_usd_cap !== null ? Math.min(worst, d.monthly_usd_cap) : worst)} a month at list price estimate, using the dearest approved product for every call. Actual billing follows your MarketCheck contract.</li>
            </ul>
            <CheckField id="mc-ack" label="I understand this store can make paid calls up to these caps" checked={ack} onChange={setAck} />
          </div>
        )}
      </div>
    </Panel>
  );
}

function UsagePanel({ storeId }: { storeId: string }) {
  const q = useQuery({ queryKey: ["inv-net", "usage", storeId], queryFn: () => getUsage(storeId) });
  const u = q.data ?? null;
  return (
    <Panel title="Usage this month" description="Estimates use public list prices and are not a bill." flush>
      <QueryState status={q.isLoading ? "loading" : q.isError ? "error" : !u ? "empty" : "ready"} errorTitle="Could not load usage" errorDetail={q.isError ? explainError(q.error) : undefined} onRetry={() => q.refetch()} emptyTitle="No usage recorded">
        {u && (
          <div className="space-y-4 p-4">
            <KeyValueList rows={[
              { label: "Today", value: `${u.today.admitted} admitted, ${u.today.denied} denied` },
              { label: "This month", value: `${u.month.admitted} admitted, ${u.month.denied} denied` },
              { label: "Estimated cost", value: `${money(Number(u.month.estimated_usd))} (list price estimate)` },
              { label: "Actual cost", value: u.month.actual_usd === null || u.month.actual_usd === undefined ? "Not reported" : money(Number(u.month.actual_usd)) },
              { label: "Calls without a price", value: String(u.month.unpriced_calls) },
              { label: "Queued refreshes", value: String(u.queued_requests) },
            ]} />
            {u.by_product.length === 0 ? <EmptyState title="No paid lookups this month" compact /> : (
              <WorkTable caption="Usage by product" inset={false} minWidth={620}>
                <thead><tr><Th>Product</Th><Th>Reason</Th><Th>Outcome</Th><Th align="right">Calls</Th><Th align="right">Estimated</Th></tr></thead>
                <tbody>{u.by_product.map((r, i) => (
                  <tr key={i}><Td>{humanize(r.product)}</Td><Td>{humanize(r.reason)}</Td><Td><StatusText tone={r.outcome === "admitted" ? "success" : "warning"}>{r.outcome}</StatusText>{r.deny_reason && <span className="ml-1 text-[12px] text-adm-muted">{humanize(r.deny_reason)}</span>}</Td><Td align="right">{r.calls}</Td><Td align="right">{money(Number(r.estimated_usd))}</Td></tr>
                ))}</tbody>
              </WorkTable>
            )}
          </div>
        )}
      </QueryState>
    </Panel>
  );
}

export default function MarketCheckSection() {
  const { stores } = useNet();
  const [params, setParams] = useSearchParams();
  const picked = params.get("store");
  const storeId = picked && stores.some((s) => s.store.id === picked) ? picked : stores[0]?.store.id ?? "";
  const s = stores.find((x) => x.store.id === storeId) ?? null;
  const catalog = useQuery({ queryKey: ["inv-net", "catalog", PILOT_ACCOUNT], queryFn: () => listCatalog(PILOT_ACCOUNT) });
  const products = useMemo<ProductRow[]>(() => {
    if (catalog.data && catalog.data.length > 0) return catalog.data.map((p) => ({ key: p.product_key, label: p.label, info: p.endpoint, price: p.rate_usd === null ? null : Number(p.rate_usd), basis: p.rate_status === "verified" ? "verified rate" : p.rate_status === "list_price_estimate" ? "list price estimate" : p.rate_status }));
    return ENRICHMENT_PRODUCTS.map((p) => ({ key: p, label: humanize(p), info: PRODUCT_INFO[p], price: price(p), basis: "list price estimate" }));
  }, [catalog.data]);
  if (!s) return <Panel><EmptyState title="No stores yet" detail="MarketCheck policy is set per store. Add a store first." compact /></Panel>;

  return (
    <div className="space-y-4">
      <Panel>
        <SelectField id="mc-store" label="Store" value={storeId} onChange={(v) => setParams(new URLSearchParams({ view: "marketcheck", store: v }))} options={stores.map((x) => ({ value: x.store.id, label: `${x.store.display_name} (${mcModeLabel(x.policy).label})` }))} className="max-w-md" />
      </Panel>
      <InlineNote tone="info" title="Showing a store's vehicles to sibling-store customers never triggers enrichment.">Paid lookups happen only for a store's own vehicles, under its own policy and caps.</InlineNote>
      <PolicyForm key={`${s.store.id}-${s.policy?.updated_at ?? "none"}-${products.length}`} s={s} products={products} />
      <UsagePanel storeId={s.store.id} />
    </div>
  );
}
