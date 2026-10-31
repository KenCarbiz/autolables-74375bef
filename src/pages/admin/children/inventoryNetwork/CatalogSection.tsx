import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, InlineNote, KeyValueList, Panel, QueryState, StatusText, type Tone } from "@/components/product";
import { explainError, listCatalog, listFieldDefinitions, saveCatalogProduct, PILOT_ACCOUNT, type CatalogProductDraft, type CatalogProductRow, type RateStatus } from "@/lib/inventoryNetwork/api";
import { coverageFor, type CoverProduct } from "@/lib/inventoryNetwork/coverage";
import { CheckField, ConfirmButton, NeedsReview, NumberField, SelectField, TextField, humanize, money, useAct, when } from "./shared";

const RATE_LABEL: Record<RateStatus, { label: string; tone: Tone }> = {
  verified: { label: "Verified", tone: "success" },
  list_price_estimate: { label: "List price estimate", tone: "info" },
  placeholder: { label: "Placeholder", tone: "warning" },
  unknown: { label: "Unknown", tone: "danger" },
};

const right = (v: string, days?: number | null) => v === "unknown" ? <NeedsReview /> : <>{humanize(v)}{v === "limited" && days ? ` (${days} days)` : ""}</>;
const repeatPolicy = (p: CatalogProductRow) => p.repeat_charge_policy === "unknown" ? <NeedsReview>Unknown, treated as charged</NeedsReview> : humanize(p.repeat_charge_policy);
const repeatQuota = (v: string) => (v === "yes" ? "Counts against quota" : v === "no" ? "Does not count against quota" : <NeedsReview>Unknown, counts against quota</NeedsReview>);

function ProductCard({ p, onEdit }: { p: CatalogProductRow; onEdit: () => void }) {
  const rate = RATE_LABEL[p.rate_status];
  return (
    <li className="space-y-3 rounded-[6px] border border-adm-border bg-adm-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-[16px] leading-[22px] font-semibold text-adm-ink">{p.label}</h4>
          <p className="break-all font-mono text-[12px] text-adm-muted">{p.endpoint}</p>
        </div>
        <div className="flex items-center gap-2">
          {!p.enabled && <StatusText tone="neutral">Disabled</StatusText>}
          <StatusText tone={rate.tone}>{rate.label}</StatusText>
          <Button size="sm" onClick={onEdit}>Edit</Button>
        </div>
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label="Bundled fields">{p.bundled_fields.map((f) => <li key={f} className="rounded-full border border-adm-border bg-adm-workspace px-2.5 py-0.5 text-[12px] text-adm-ink">{humanize(f)}</li>)}</ul>
      <KeyValueList className="!grid-cols-[minmax(140px,180px)_1fr]" rows={[
        { label: "Billing unit", value: `${p.billing_unit}, ${p.quota_units} quota unit${p.quota_units === 1 ? "" : "s"}` },
        { label: "Rate", value: <>{money(p.rate_usd, 4)} <span className="text-adm-muted">({rate.label.toLowerCase()})</span></> },
        { label: "Initial charge", value: p.initial_charge_usd === null ? "Same as rate" : money(p.initial_charge_usd, 4) },
        { label: "Repeat policy", value: repeatPolicy(p) },
        { label: "Repeat window", value: p.repeat_window_days ? `${p.repeat_window_days} days${p.repeat_allowance !== null ? `, ${p.repeat_allowance} allowed` : ""}${p.repeat_charge_usd !== null ? `, ${money(p.repeat_charge_usd, 4)} each` : ""}` : "None" },
        { label: "Repeat uses quota", value: repeatQuota(p.repeat_consumes_quota) },
        { label: "Retention", value: right(p.retention_policy, p.retention_days) },
        { label: "Cross-store reuse", value: right(p.cross_store_reuse) },
        { label: "Customer display", value: right(p.customer_display) },
        { label: "Refresh cadence", value: `${humanize(p.update_cadence)}${p.freshness_days ? `, fresh for ${p.freshness_days} days` : ""}` },
        { label: "Evidence", value: p.evidence ? <>{p.evidence}{p.evidence_url && <span className="block break-all text-[12px] text-adm-muted">{p.evidence_url}</span>}</> : "None recorded" },
        { label: "Verified", value: p.verified_at ? when(p.verified_at) : <NeedsReview>Not verified</NeedsReview> },
      ]} />
    </li>
  );
}

const num = (v: number | string | null) => (v === null ? null : Number(v));

function EditForm({ p, onClose }: { p: CatalogProductRow; onClose: () => void }) {
  const { act, busy } = useAct();
  const base: CatalogProductDraft = {
    account_ref: p.account_ref, product_key: p.product_key, rate_usd: num(p.rate_usd), rate_status: p.rate_status, billing_unit: p.billing_unit, quota_units: p.quota_units,
    initial_charge_usd: num(p.initial_charge_usd), repeat_charge_policy: p.repeat_charge_policy, repeat_charge_usd: num(p.repeat_charge_usd), repeat_window_days: p.repeat_window_days,
    repeat_allowance: p.repeat_allowance, repeat_consumes_quota: p.repeat_consumes_quota, retention_policy: p.retention_policy, retention_days: p.retention_days,
    cross_store_reuse: p.cross_store_reuse, customer_display: p.customer_display, freshness_days: p.freshness_days, enabled: p.enabled,
    evidence: p.evidence ?? "", evidence_url: p.evidence_url ?? "", mark_verified: false,
  };
  const [d, setD] = useState(base);
  const set = <K extends keyof CatalogProductDraft>(k: K, v: CatalogProductDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const verifiedAfter = !!p.verified_at || d.mark_verified;
  const evidenceOk = d.evidence.trim().length >= 10;
  const problems: string[] = [];
  if (d.mark_verified && !evidenceOk) problems.push("Marking verified needs at least 10 characters of evidence.");
  if (d.rate_status === "verified" && !(verifiedAfter && evidenceOk && d.rate_usd !== null)) problems.push("A verified rate needs a rate, evidence and the verified box ticked.");
  if (d.repeat_charge_policy === "free_within_window" && !(verifiedAfter && evidenceOk && d.repeat_window_days)) problems.push("A free repeat needs verification, evidence and a repeat window.");
  const dirty = JSON.stringify(d) !== JSON.stringify(base);
  const save = () => act(async () => { await saveCatalogProduct(d); onClose(); }, `${p.label} saved`);
  const widens = d.mark_verified || (d.enabled && !p.enabled);

  return (
    <Panel title={`Edit ${p.label}`} description="Rates and rights are only ever set from evidence. Anything left unknown is treated as charged and restricted.">
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <NumberField id="cp-rate" label="Rate (USD)" value={d.rate_usd} onChange={(v) => set("rate_usd", v)} min={0} step={0.0001} />
          <SelectField id="cp-rs" label="Rate status" value={d.rate_status} onChange={(v) => set("rate_status", v as RateStatus)} options={Object.entries(RATE_LABEL).map(([k, v]) => ({ value: k, label: v.label }))} />
          <TextField id="cp-unit" label="Billing unit" value={d.billing_unit} onChange={(v) => set("billing_unit", v)} />
          <NumberField id="cp-qu" label="Quota units" value={d.quota_units} onChange={(v) => set("quota_units", v ?? 1)} min={1} step={1} />
          <NumberField id="cp-init" label="Initial charge (USD)" value={d.initial_charge_usd} onChange={(v) => set("initial_charge_usd", v)} min={0} step={0.0001} />
          <NumberField id="cp-fresh" label="Fresh for (days)" value={d.freshness_days} onChange={(v) => set("freshness_days", v)} min={1} />
          <SelectField id="cp-rp" label="Repeat charge" value={d.repeat_charge_policy} onChange={(v) => set("repeat_charge_policy", v as CatalogProductDraft["repeat_charge_policy"])} options={[{ value: "unknown", label: "Unknown (treated as charged)" }, { value: "charged", label: "Charged" }, { value: "discounted", label: "Discounted" }, { value: "free_within_window", label: "Free within window" }]} />
          <NumberField id="cp-rusd" label="Repeat charge (USD)" value={d.repeat_charge_usd} onChange={(v) => set("repeat_charge_usd", v)} min={0} step={0.0001} />
          <NumberField id="cp-rwin" label="Repeat window (days)" value={d.repeat_window_days} onChange={(v) => set("repeat_window_days", v)} min={1} max={365} />
          <NumberField id="cp-rall" label="Repeat allowance" value={d.repeat_allowance} onChange={(v) => set("repeat_allowance", v)} min={0} />
          <SelectField id="cp-rq" label="Repeat uses quota" value={d.repeat_consumes_quota} onChange={(v) => set("repeat_consumes_quota", v)} options={[{ value: "unknown", label: "Unknown (counts)" }, { value: "yes", label: "Yes" }, { value: "no", label: "No" }]} />
          <SelectField id="cp-ret" label="Retention" value={d.retention_policy} onChange={(v) => set("retention_policy", v)} options={[{ value: "unknown", label: "Unknown (needs review)" }, { value: "permitted", label: "Permitted" }, { value: "limited", label: "Limited" }, { value: "prohibited", label: "Prohibited" }]} />
          <NumberField id="cp-retd" label="Retention days" value={d.retention_days} onChange={(v) => set("retention_days", v)} min={1} />
          <SelectField id="cp-xs" label="Cross-store reuse" value={d.cross_store_reuse} onChange={(v) => set("cross_store_reuse", v)} options={[{ value: "unknown", label: "Unknown (needs review)" }, { value: "permitted", label: "Permitted" }, { value: "prohibited", label: "Prohibited" }]} />
          <SelectField id="cp-cd" label="Customer display" value={d.customer_display} onChange={(v) => set("customer_display", v)} options={[{ value: "unknown", label: "Unknown (needs review)" }, { value: "permitted", label: "Permitted" }, { value: "prohibited", label: "Prohibited" }]} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField id="cp-ev" label="Evidence" value={d.evidence} onChange={(v) => set("evidence", v)} hint="Where the rate and rights were confirmed: contract clause, invoice, written reply." />
          <TextField id="cp-evu" label="Evidence link" value={d.evidence_url} onChange={(v) => set("evidence_url", v)} />
        </div>
        <CheckField id="cp-en" label="Enabled" checked={d.enabled} onChange={(v) => set("enabled", v)} hint="Disabled products are never called." />
        <CheckField id="cp-ver" label="Mark verified now" checked={d.mark_verified} onChange={(v) => set("mark_verified", v)} hint="Records that you confirmed this rate and these rights against the evidence above." />
        {problems.length > 0 && <InlineNote tone="warning" title="Fix before saving">{problems.join(" ")}</InlineNote>}
        <div className="flex items-center gap-3">
          {widens ? <ConfirmButton size="md" variant="primary" label="Save product" confirmLabel="Confirm: allows paid use" disabled={busy || !dirty || problems.length > 0} onConfirm={save} /> : <Button variant="primary" disabled={busy || !dirty || problems.length > 0} onClick={save}>Save product</Button>}
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Panel>
  );
}

function CoverageHelper({ catalog }: { catalog: CatalogProductRow[] }) {
  const defs = useQuery({ queryKey: ["inv-net", "field-defs"], queryFn: listFieldDefinitions });
  const [ticked, setTicked] = useState<string[]>([]);
  const products = useMemo<CoverProduct[]>(() => catalog.filter((p) => p.enabled).map((p) => ({ productKey: p.product_key, label: p.label, bundledFields: p.bundled_fields, rateUsd: num(p.rate_usd), quotaUnits: p.quota_units })), [catalog]);
  const result = useMemo(() => {
    try { return { r: coverageFor(ticked, products), err: null }; } catch (e) { return { r: null, err: e instanceof Error ? e.message : "error" }; }
  }, [ticked, products]);
  const toggle = (k: string, on: boolean) => setTicked((t) => (on ? [...t, k] : t.filter((x) => x !== k)));
  const r = result.r;
  return (
    <Panel title="Which products cover the fields I need" description="Tick the information a store needs. This shows the cheapest set of enabled products that supplies it.">
      <QueryState status={defs.isLoading ? "loading" : defs.isError ? "error" : (defs.data ?? []).length === 0 ? "empty" : "ready"} errorTitle="Could not load field definitions" errorDetail={defs.isError ? explainError(defs.error) : undefined} onRetry={() => defs.refetch()} emptyTitle="No field definitions">
        <div className="space-y-4">
          <ul className="grid gap-3 md:grid-cols-2">
            {(defs.data ?? []).map((f) => <li key={f.field_key}><CheckField id={`cov-${f.field_key}`} label={f.label} checked={ticked.includes(f.field_key)} onChange={(v) => toggle(f.field_key, v)} hint={f.description} /></li>)}
          </ul>
          {result.err && <InlineNote tone="warning" title="Too many products to compare">Disable products you do not use, then try again.</InlineNote>}
          {r && ticked.length > 0 && (
            <div className="space-y-2 rounded-[6px] border border-adm-border bg-adm-workspace p-4 text-[13px]">
              {r.products.length === 0 && r.uncoverable.length === 0 ? <p>Everything ticked is calculated locally. No paid request is needed.</p> : (
                <>
                  <p className="font-semibold text-adm-ink">{r.products.length} request{r.products.length === 1 ? "" : "s"}: {r.products.map((p) => p.label).join(", ") || "none"}</p>
                  <p>{r.quotaUnits} quota unit{r.quotaUnits === 1 ? "" : "s"}, {r.usd === null ? "price unknown for at least one product" : `${money(r.usd, 4)} (estimate unless the rate is verified)`}.</p>
                </>
              )}
              {r.uncoverable.length > 0 && <p className="text-adm-danger">No enabled product supplies: {r.uncoverable.map(humanize).join(", ")}.</p>}
              <ul className="list-disc pl-5 text-adm-muted">{r.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </div>
          )}
        </div>
      </QueryState>
    </Panel>
  );
}

export default function CatalogSection() {
  const q = useQuery({ queryKey: ["inv-net", "catalog", PILOT_ACCOUNT], queryFn: () => listCatalog(PILOT_ACCOUNT) });
  const [editing, setEditing] = useState<string | null>(null);
  const items = q.data ?? [];
  const p = items.find((x) => x.product_key === editing) ?? null;
  const review = items.filter((x) => x.rate_status !== "verified" || x.repeat_charge_policy === "unknown" || x.retention_policy === "unknown" || x.cross_store_reuse === "unknown" || x.customer_display === "unknown").length;
  return (
    <div className="space-y-4">
      <InlineNote tone="info" title="Unknown means restricted and charged.">Unverified rates are shown as estimates, unknown repeat billing is treated as charged, and unknown rights block reuse and customer display. Bulk, backfill and scheduled refresh stay refused until every approved product is verified.</InlineNote>
      {review > 0 && <InlineNote tone="warning" title={`${review} of ${items.length} products still need review`} />}
      <QueryState status={q.isLoading ? "loading" : q.isError ? "error" : items.length === 0 ? "empty" : "ready"} errorTitle="Could not load the provider catalog" errorDetail={q.isError ? explainError(q.error) : undefined} onRetry={() => q.refetch()} emptyTitle="The catalog is empty" emptyDetail="Apply the MarketCheck pilot database update to seed it.">
        <ul className="grid gap-4 xl:grid-cols-2">{items.map((x) => <ProductCard key={x.product_key} p={x} onEdit={() => setEditing(x.product_key)} />)}</ul>
      </QueryState>
      {p && <EditForm key={`${p.product_key}-${p.updated_at}`} p={p} onClose={() => setEditing(null)} />}
      {items.length > 0 && <CoverageHelper catalog={items} />}
    </div>
  );
}
