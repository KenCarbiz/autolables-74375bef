import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button, EmptyState, InlineNote, KeyValueList, Panel, QueryState, StatusText, Td, Th, WorkTable } from "@/components/product";
import {
  explainError, getPilotDashboard, getVehicleHistory, listAiTools, resetVehicleState, saveAiTool, saveProviderAccount, PILOT_ACCOUNT,
  type PilotDashboard, type ProviderAccountDraft, type ProviderAiTool, type VehicleProviderState,
} from "@/lib/inventoryNetwork/api";
import { CheckField, ConfirmButton, NumberField, TextField, humanize, inputClass, money, shortId, useAct, useNet, when } from "./shared";

const SEGMENTS = [
  { key: "consumed", label: "Consumed", cls: "bg-adm-primary" },
  { key: "uncertain", label: "Billing uncertain", cls: "bg-[#B45309]" },
  { key: "reserved", label: "Reserved", cls: "bg-[#7C8AA0]" },
  { key: "external", label: "External, unattributed", cls: "bg-adm-danger" },
  { key: "spendable", label: "Spendable", cls: "bg-adm-success" },
  { key: "protected", label: "Protected reserve", cls: "bg-[#C5D4F7]" },
] as const;

function QuotaMeter({ d }: { d: PilotDashboard }) {
  const c = d.calls;
  const avail = Math.max(c.available, 0);
  const protectedShown = Math.min(c.protected, avail);
  const values: Record<(typeof SEGMENTS)[number]["key"], number> = { consumed: c.consumed, uncertain: c.billing_uncertain, reserved: c.reserved, external: c.external_unattributed, spendable: c.spendable, protected: protectedShown };
  const pct = (n: number) => (c.quota > 0 ? Math.max(0, Math.min(100, (n / c.quota) * 100)) : 0);
  return (
    <div className="space-y-3">
      <div role="img" aria-label={`Quota of ${c.quota} calls: ${SEGMENTS.map((s) => `${s.label} ${values[s.key]}`).join(", ")}`} className="flex h-5 w-full overflow-hidden rounded-[4px] border border-adm-border bg-adm-workspace">
        {SEGMENTS.map((s) => values[s.key] > 0 && <div key={s.key} className={s.cls} style={{ width: `${pct(values[s.key])}%` }} />)}
      </div>
      <ul className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
        {SEGMENTS.map((s) => <li key={s.key} className="flex items-center gap-2"><span className={`inline-block h-3 w-3 rounded-[2px] ${s.cls}`} aria-hidden="true" /><span className="text-adm-muted">{s.label}</span><span className="ml-auto font-semibold tabular-nums text-adm-ink">{values[s.key].toLocaleString("en-US")}</span></li>)}
      </ul>
      <p className="text-[12px] text-adm-muted">Quota {c.quota.toLocaleString("en-US")} calls. {c.provider_reported_used !== null ? `MarketCheck last reported ${c.provider_reported_used} used${c.provider_reported_at ? ` on ${when(c.provider_reported_at)}` : ""}.` : "MarketCheck has not reported its own usage yet, so external usage cannot be seen."}</p>
    </div>
  );
}

function Summary({ d }: { d: PilotDashboard }) {
  const o = d.by_outcome;
  const paid = (o.consumed ?? 0) + (o.billing_uncertain ?? 0);
  const tiles: Array<[string, number, string]> = [
    ["Paid calls", paid, "Including billing uncertain"],
    ["Verified free refreshes", d.free_refreshes, "Counted from paid calls"],
    ["Reused", o.reused ?? 0, "Existing answer used"],
    ["Recalculated", o.recalculated ?? 0, "Derived locally"],
    ["Joined", o.joined ?? 0, "Shared an in-flight call"],
    ["Refused", o.refused ?? 0, "Blocked before calling"],
  ];
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      {tiles.map(([k, v, h]) => <li key={k} className="rounded-[6px] border border-adm-border px-3 py-2"><span className="block text-[12px] text-adm-muted">{k}</span><span className="block text-[22px] leading-[28px] font-bold tabular-nums text-adm-ink">{v}</span><span className="block text-[11px] text-adm-muted">{h}</span></li>)}
    </ul>
  );
}

function AccountForm({ a }: { a: PilotDashboard["account"] }) {
  const { act, busy } = useAct();
  const base: ProviderAccountDraft = {
    account_ref: a.account_ref, plan_name: a.plan_name ?? "", pilot_mode: a.pilot_mode, monthly_call_quota: a.monthly_call_quota, protected_reserve: a.protected_reserve,
    priority_floors: { "1": 0, "2": 0, "3": 0, "4": 0, ...a.priority_floors }, monthly_usd_cap: a.monthly_usd_cap === null ? null : Number(a.monthly_usd_cap),
    rate_limit_per_minute: a.rate_limit_per_minute, uncertain_retry_hold_hours: a.uncertain_retry_hold_hours,
  };
  const [d, setD] = useState(base);
  const set = <K extends keyof ProviderAccountDraft>(k: K, v: ProviderAccountDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const floor = (k: string, v: number | null) => setD((x) => ({ ...x, priority_floors: { ...x.priority_floors, [k]: v ?? 0 } }));
  const errors: string[] = [];
  if (!(d.monthly_call_quota > 0)) errors.push("The monthly quota must be above zero.");
  if (d.protected_reserve < 0 || d.protected_reserve >= d.monthly_call_quota) errors.push("The protected reserve must be below the quota.");
  if (!(d.rate_limit_per_minute >= 1 && d.rate_limit_per_minute <= 1000)) errors.push("Rate limit is 1 to 1000 a minute.");
  if (!(d.uncertain_retry_hold_hours >= 1 && d.uncertain_retry_hold_hours <= 720)) errors.push("Retry hold is 1 to 720 hours.");
  const dirty = JSON.stringify(d) !== JSON.stringify(base);
  const spend = d.monthly_call_quota > base.monthly_call_quota || d.protected_reserve < base.protected_reserve || (d.monthly_usd_cap === null ? base.monthly_usd_cap !== null : base.monthly_usd_cap !== null && d.monthly_usd_cap > base.monthly_usd_cap)
    || ["1", "2", "3", "4"].some((k) => d.priority_floors[k] < base.priority_floors[k]);
  const save = () => act(() => saveProviderAccount(d), "Account settings saved");

  return (
    <Panel title="Account settings" description="Limits that apply to every store sharing this MarketCheck account.">
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <TextField id="pa-plan" label="Plan name" value={d.plan_name} onChange={(v) => set("plan_name", v)} />
          <NumberField id="pa-quota" label="Monthly call quota" value={d.monthly_call_quota} onChange={(v) => set("monthly_call_quota", v ?? 0)} min={1} />
          <NumberField id="pa-res" label="Protected reserve" value={d.protected_reserve} onChange={(v) => set("protected_reserve", v ?? 0)} min={0} hint="Calls never spent on optional work." />
          <NumberField id="pa-usd" label="Monthly USD cap" value={d.monthly_usd_cap} onChange={(v) => set("monthly_usd_cap", v)} min={0} step={0.01} hint="Leave empty for no dollar cap." />
          <NumberField id="pa-rate" label="Rate limit per minute" value={d.rate_limit_per_minute} onChange={(v) => set("rate_limit_per_minute", v ?? 0)} min={1} max={1000} />
          <NumberField id="pa-hold" label="Uncertain retry hold (hours)" value={d.uncertain_retry_hold_hours} onChange={(v) => set("uncertain_retry_hold_hours", v ?? 0)} min={1} max={720} hint="Wait this long before retrying a call whose billing is unknown." />
        </div>
        <CheckField id="pa-pilot" label="Pilot mode" checked={d.pilot_mode} onChange={(v) => set("pilot_mode", v)} />
        <fieldset>
          <legend className="mb-1 text-[14px] font-semibold text-adm-ink">Priority floors</legend>
          <p className="mb-3 text-[13px] text-adm-muted">Calls that must still remain, after the protected reserve, before work of each priority may run. Higher numbers wait sooner.</p>
          <div className="grid gap-4 md:grid-cols-4">
            <NumberField id="pf-1" label="1 Required work" value={d.priority_floors["1"]} onChange={(v) => floor("1", v)} min={0} hint="Required work for primary subscribed stores." />
            <NumberField id="pf-2" label="2 Missing information" value={d.priority_floors["2"]} onChange={(v) => floor("2", v)} min={0} hint="Missing high-value information." />
            <NumberField id="pf-3" label="3 Approved refreshes" value={d.priority_floors["3"]} onChange={(v) => floor("3", v)} min={0} hint="Refreshes a store has approved." />
            <NumberField id="pf-4" label="4 Optional enrichment" value={d.priority_floors["4"]} onChange={(v) => floor("4", v)} min={0} hint="Optional enrichment of additional inventory." />
          </div>
        </fieldset>
        {errors.length > 0 && <InlineNote tone="warning" title="Fix before saving">{errors.join(" ")}</InlineNote>}
        <div className="flex items-center gap-3">
          {spend ? <ConfirmButton size="md" variant="primary" label="Save settings" confirmLabel="Confirm: this allows more spending" disabled={busy || !dirty || errors.length > 0} onConfirm={save} /> : <Button variant="primary" disabled={busy || !dirty || errors.length > 0} onClick={save}>Save settings</Button>}
          {dirty && <StatusText tone="warning">Unsaved changes</StatusText>}
        </div>
      </div>
    </Panel>
  );
}

function AiToolRow({ t }: { t: ProviderAiTool }) {
  const { act, busy } = useAct();
  const [max, setMax] = useState<number | null>(t.max_requests_per_invocation);
  const maxOk = max !== null && max >= 1 && max <= 20;
  return (
    <tr>
      <Td className="font-semibold">{t.label}<span className="block text-[12px] font-normal text-adm-muted">{t.tool_name}{t.note ? `. ${t.note}` : ""}</span></Td>
      <Td className="text-[12px]">{t.product_keys.map(humanize).join(", ")}</Td>
      <Td><input aria-label={`${t.label} max requests`} type="number" min={1} max={20} className={`${inputClass} w-20`} value={max ?? ""} onChange={(e) => setMax(e.target.value === "" ? null : Number(e.target.value))} /></Td>
      <Td><StatusText tone={t.staff_enabled ? "warning" : "neutral"}>{t.staff_enabled ? "On for staff" : "Off"}</StatusText></Td>
      <Td align="right">
        <div className="flex flex-wrap justify-end gap-2">
          {t.staff_enabled
            ? <Button size="sm" disabled={busy} onClick={() => act(() => saveAiTool(t.tool_name, false, maxOk ? max : null), `${t.label} turned off`)}>Turn off</Button>
            : <ConfirmButton label="Turn on" confirmLabel="Allow paid staff lookups" disabled={busy || !maxOk} onConfirm={() => act(() => saveAiTool(t.tool_name, true, max), `${t.label} turned on`)} />}
          {t.staff_enabled && maxOk && max !== t.max_requests_per_invocation && <ConfirmButton label="Save limit" confirmLabel="Save limit" disabled={busy} onConfirm={() => act(() => saveAiTool(t.tool_name, true, max), "Limit saved")} />}
        </div>
      </Td>
    </tr>
  );
}

function AiTools() {
  const q = useQuery({ queryKey: ["inv-net", "ai-tools"], queryFn: listAiTools });
  return (
    <Panel title="Staff AI tools" description="Off by default. Anything they call counts against the same monthly quota, and they never drive automated enrichment." flush>
      <QueryState status={q.isLoading ? "loading" : q.isError ? "error" : (q.data ?? []).length === 0 ? "empty" : "ready"} errorTitle="Could not load AI tools" errorDetail={q.isError ? explainError(q.error) : undefined} onRetry={() => q.refetch()} emptyTitle="No AI tools registered">
        <WorkTable caption="Staff AI tools" minWidth={820}>
          <thead><tr><Th>Tool</Th><Th>Products it can call</Th><Th>Max requests per use</Th><Th>Status</Th><Th align="right">Actions</Th></tr></thead>
          <tbody>{(q.data ?? []).map((t) => <AiToolRow key={`${t.tool_name}-${t.staff_enabled}-${t.max_requests_per_invocation}`} t={t} />)}</tbody>
        </WorkTable>
      </QueryState>
    </Panel>
  );
}

const confidenceText = (s: VehicleProviderState) => {
  if (s.confidence === null || s.confidence === undefined) return "Not reported";
  const n = Number(s.confidence);
  if (s.confidence_scale === "fraction") return `${Math.round(n * 100)}% (fraction scale)`;
  if (s.confidence_scale === "percent") return `${n}% (percent scale)`;
  return `${n} (scale unknown)`;
};

function VinLookup({ account }: { account: string }) {
  const { act, busy } = useAct();
  const [vin, setVin] = useState("");
  const [asked, setAsked] = useState("");
  const q = useQuery({ queryKey: ["inv-net", "vin-history", asked], queryFn: () => getVehicleHistory(asked), enabled: asked.length === 17 });
  const clean = vin.trim().toUpperCase();
  const h = q.data ?? null;
  return (
    <Panel title="Look up a VIN" description="Every paid, reused and refused request for one vehicle, and what MarketCheck last answered.">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <TextField id="pv-vin" label="VIN" value={vin} onChange={setVin} className="w-72" placeholder="17 characters" />
          <Button variant="primary" disabled={clean.length !== 17} onClick={() => setAsked(clean)}>Look up</Button>
        </div>
        {asked && (
          <QueryState status={q.isLoading ? "loading" : q.isError ? "error" : !h ? "empty" : "ready"} errorTitle="Could not load this VIN" errorDetail={q.isError ? explainError(q.error) : undefined} onRetry={() => q.refetch()} emptyTitle="Nothing recorded for this VIN">
            {h && (
              <div className="space-y-4">
                <h4 className="text-[14px] font-semibold text-adm-ink">Request history</h4>
                {h.requests.length === 0 ? <EmptyState title="No requests recorded for this VIN" compact /> : (
                  <WorkTable caption="Request history" inset minWidth={900}>
                    <thead><tr><Th>Time</Th><Th>Product</Th><Th>Caller</Th><Th>Channel</Th><Th>Priority</Th><Th>Status</Th><Th>Refusal reason</Th><Th>Free refresh</Th><Th align="right">Cost</Th></tr></thead>
                    <tbody>{h.requests.map((r) => (
                      <tr key={r.id}>
                        <Td>{when(r.at)}</Td><Td>{humanize(r.product_key)}</Td><Td>{humanize(r.caller)}</Td><Td>{r.channel ? humanize(r.channel) : "Not recorded"}</Td><Td>{r.priority}</Td>
                        <Td><StatusText tone={r.status === "refused" ? "warning" : r.status === "consumed" ? "info" : r.status === "billing_uncertain" ? "danger" : "neutral"}>{humanize(r.status)}</StatusText></Td>
                        <Td className="text-[12px]">{humanize(r.refusal_reason)}</Td><Td>{r.free_refresh ? "Yes" : "No"}</Td>
                        <Td align="right">{r.actual_cost_usd !== null ? money(r.actual_cost_usd, 4) : r.estimated_cost_usd !== null ? `${money(r.estimated_cost_usd, 4)} est.` : "Unknown"}</Td>
                      </tr>
                    ))}</tbody>
                  </WorkTable>
                )}
                <h4 className="text-[14px] font-semibold text-adm-ink">Provider state per product</h4>
                {h.states.length === 0 ? <EmptyState title="No provider state recorded for this VIN" compact /> : (
                  <WorkTable caption="Vehicle provider states" inset minWidth={900}>
                    <thead><tr><Th>Product</Th><Th>State</Th><Th align="right">Attempts</Th><Th>Next eligible</Th><Th>Partial fields</Th><Th>Confidence</Th><Th>Data delivered</Th><Th align="right">Actions</Th></tr></thead>
                    <tbody>{h.states.map((s) => (
                      <tr key={s.product_key}>
                        <Td>{humanize(s.product_key)}</Td><Td><StatusText tone={s.state === "complete" ? "success" : s.state === "partial" ? "warning" : "neutral"}>{humanize(s.state)}</StatusText></Td>
                        <Td align="right">{s.attempts}</Td><Td>{s.next_eligible_at ? when(s.next_eligible_at) : "Any time"}</Td><Td className="text-[12px]">{s.partial_fields.length ? s.partial_fields.map(humanize).join(", ") : "None"}</Td>
                        <Td>{confidenceText(s)}</Td><Td>{s.data_delivery_date ?? "Not reported"}</Td>
                        <Td align="right"><ConfirmButton label="Reset" confirmLabel="Reset state" variant="danger" disabled={busy} onConfirm={() => act(() => resetVehicleState(account, asked, s.product_key), "State reset. The next request for this product can run.")} /></Td>
                      </tr>
                    ))}</tbody>
                  </WorkTable>
                )}
                <p className="text-[12px] text-adm-muted">Data delivered is when the provider's data was delivered, not when the vehicle was delivered. Resetting clears the cooldown and attempt count; it does not make a call.</p>
              </div>
            )}
          </QueryState>
        )}
      </div>
    </Panel>
  );
}

export default function PilotSection() {
  const { href } = useNet();
  const q = useQuery({ queryKey: ["inv-net", "pilot", PILOT_ACCOUNT], queryFn: () => getPilotDashboard(PILOT_ACCOUNT) });
  const d = q.data ?? null;
  return (
    <div className="space-y-4">
      <QueryState status={q.isLoading ? "loading" : q.isError ? "error" : !d ? "empty" : "ready"} errorTitle="Could not load the MarketCheck pilot" errorDetail={q.isError ? explainError(q.error) : undefined} onRetry={() => q.refetch()} emptyTitle="No MarketCheck account found" emptyDetail="The shared account record is missing. Apply the MarketCheck pilot database update.">
        {d && (
          <div className="space-y-4">
            <Panel title="Quota this period" description={d.period.source === "assumed_utc_month" ? `Assumed UTC month, ${new Date(d.period.start).toLocaleDateString()} to ${new Date(d.period.end).toLocaleDateString()}. MarketCheck has not told us its reset date.` : `Billing period reported by MarketCheck, ${new Date(d.period.start).toLocaleDateString()} to ${new Date(d.period.end).toLocaleDateString()}.`}>
              <QuotaMeter d={d} />
            </Panel>
            {d.projection.exhausts_before_period_end && <InlineNote tone="warning" title="At this pace the spendable calls run out before the period ends">{d.projection.exhausts_spendable_at ? `Projected ${when(d.projection.exhausts_spendable_at)}.` : ""} Optional work will be refused first.</InlineNote>}
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Money" description="Estimates unless a verified rate or actual cost was recorded.">
                <KeyValueList rows={[
                  { label: "Spent", value: money(d.usd.spent) },
                  { label: "Committed (in flight)", value: money(d.usd.committed) },
                  { label: "Monthly cap", value: d.usd.cap === null ? "No dollar cap" : money(d.usd.cap) },
                  { label: "Basis", value: d.usd.basis },
                ]} />
              </Panel>
              <Panel title="Pace">
                <KeyValueList rows={[
                  { label: "Calls per day", value: String(d.projection.calls_per_day) },
                  { label: "Spendable runs out", value: d.projection.exhausts_spendable_at ? <>{when(d.projection.exhausts_spendable_at)} {d.projection.exhausts_before_period_end ? <StatusText tone="warning">before period end</StatusText> : <StatusText tone="success">after period end</StatusText>}</> : "Not projected (no usage yet)" },
                  { label: "By channel", value: ["rest", "mcp", "staff_ai"].map((k) => `${humanize(k)} ${d.by_channel[k] ?? 0}`).join(", ") },
                ]} />
              </Panel>
            </div>
            <Panel title="What the calls were" description="Paid calls against calls avoided."><Summary d={d} /></Panel>

            {d.catalog_review.length > 0 && <InlineNote tone="warning" title={`${d.catalog_review.length} catalog ${d.catalog_review.length === 1 ? "product needs" : "products need"} review`} action={<Link className="text-[13px] font-semibold underline" to={href("catalog")}>Open Provider catalog</Link>}>Unverified rates or unknown rights are treated as the costly, restrictive case.</InlineNote>}

            <Panel title="Usage by store and product" flush>
              {d.by_store_product.length === 0 ? <EmptyState title="No requests this period" compact /> : (
                <WorkTable caption="Usage by store and product" minWidth={720}>
                  <thead><tr><Th>Store</Th><Th>Product</Th><Th align="right">Paid calls</Th><Th align="right">Refused</Th><Th align="right">Avoided</Th><Th align="right">Spend</Th></tr></thead>
                  <tbody>{d.by_store_product.map((r, i) => <tr key={i}><Td>{r.store_name ?? "No store"}</Td><Td>{humanize(r.product_key)}</Td><Td align="right">{r.calls}</Td><Td align="right">{r.refused}</Td><Td align="right">{r.avoided}</Td><Td align="right">{money(r.usd, 4)}</Td></tr>)}</tbody>
                </WorkTable>
              )}
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Refusal reasons" flush>
                {Object.keys(d.refusals).length === 0 ? <EmptyState title="Nothing refused this period" compact /> : (
                  <WorkTable caption="Refusal reasons" minWidth={320}><thead><tr><Th>Reason</Th><Th align="right">Requests</Th></tr></thead>
                    <tbody>{Object.entries(d.refusals).map(([k, n]) => <tr key={k}><Td>{humanize(k)}</Td><Td align="right">{n}</Td></tr>)}</tbody></WorkTable>
                )}
              </Panel>
              <Panel title="Repeat pulls of the same VIN" description="Paid more than once this period." flush>
                {d.repeat_pulls.length === 0 ? <EmptyState title="No repeat pulls" compact /> : (
                  <WorkTable caption="Repeat pulls" minWidth={420}><thead><tr><Th>VIN</Th><Th>Product</Th><Th align="right">Paid calls</Th><Th>Last</Th></tr></thead>
                    <tbody>{d.repeat_pulls.map((r) => <tr key={`${r.vin}-${r.product_key}`}><Td className="font-mono text-[12px]">{r.vin}</Td><Td>{humanize(r.product_key)}</Td><Td align="right">{r.paid_calls}</Td><Td>{when(r.last_at)}</Td></tr>)}</tbody></WorkTable>
                )}
              </Panel>
            </div>

            <Panel title="Pending" description="Reserved calls and queued store requests that have not finished." flush>
              {d.pending.length === 0 ? <EmptyState title="Nothing pending" compact /> : (
                <WorkTable caption="Pending jobs" minWidth={760}>
                  <thead><tr><Th>Kind</Th><Th>Product</Th><Th>Reason</Th><Th>Scope</Th><Th align="right">Estimated cost</Th></tr></thead>
                  <tbody>{d.pending.map((p) => (
                    <tr key={`${p.kind}-${p.id}`}><Td>{humanize(p.kind)}</Td><Td>{humanize(p.product_key)}</Td><Td>{humanize(p.reason)}</Td>
                      <Td className="text-[12px]">{p.vin ? `VIN ${p.vin}` : p.store_id ? `Store ${shortId(p.store_id)}` : "Account"}{p.vin && p.store_id ? `, store ${shortId(p.store_id)}` : ""}</Td>
                      <Td align="right">{p.estimated_cost_usd === null ? "Unknown" : `${money(p.estimated_cost_usd, 4)} est.`}</Td></tr>
                  ))}</tbody>
                </WorkTable>
              )}
            </Panel>

            <VinLookup account={d.account.account_ref} />
            <AccountForm key={`${d.account.account_ref}-${JSON.stringify(d.account)}`} a={d.account} />
          </div>
        )}
      </QueryState>
      <AiTools />
    </div>
  );
}
