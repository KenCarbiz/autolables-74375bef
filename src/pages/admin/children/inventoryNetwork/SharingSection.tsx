import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button, EmptyState, InlineNote, Panel, QueryState, StatusText, Td, Th, WorkTable } from "@/components/product";
import { explainError, listSharingRules, revokeSharingRule, saveSharingRule, type InventorySharingRule, type SharingRuleDraft, type StoreOverview } from "@/lib/inventoryNetwork/api";
import { ConfirmButton, SelectField, inputClass, useAct, useNet } from "./shared";

const defaults: SharingRuleDraft = { connect_card: false, customer_room: false, include_new: true, include_used: true, include_certified: true, priority: 100, show_prices: false, show_details: true };
const draftOf = (r: InventorySharingRule | undefined): SharingRuleDraft => r
  ? { connect_card: r.connect_card, customer_room: r.customer_room, include_new: r.include_new, include_used: r.include_used, include_certified: r.include_certified, priority: r.priority, show_prices: r.show_prices, show_details: r.show_details }
  : defaults;

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <input type="checkbox" aria-label={label} className="h-4 w-4 accent-[hsl(var(--primary))]" checked={checked} onChange={(e) => onChange(e.target.checked)} />;
}

function RuleRow({ source, dest, rule }: { source: StoreOverview; dest: StoreOverview; rule: InventorySharingRule | undefined }) {
  const { act, busy } = useAct();
  const [d, setD] = useState<SharingRuleDraft>(draftOf(rule));
  const base = draftOf(rule);
  const dirty = JSON.stringify(d) !== JSON.stringify(base);
  const set = <K extends keyof SharingRuleDraft>(k: K, v: SharingRuleDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const priorityOk = Number.isInteger(d.priority) && d.priority >= 1 && d.priority <= 1000;
  const channelOk = !!rule || d.connect_card || d.customer_room;
  const name = source.store.display_name;
  const payload: SharingRuleDraft = rule ? { ...d, id: rule.id } : { ...d, source_store_id: source.store.id, destination_store_id: dest.store.id };

  return (
    <tr>
      <Td className="font-semibold">
        {name}
        <span className="block text-[12px] font-normal text-adm-muted">
          {rule ? <StatusText tone="success">Sharing</StatusText> : <StatusText tone="neutral">Not shared</StatusText>}
          {!source.store.inventory_feed_enabled && <span className="ml-2">Feed is off, so nothing appears yet.</span>}
        </span>
      </Td>
      <Td><Toggle label={`${name} to Connect Card`} checked={d.connect_card} onChange={(v) => set("connect_card", v)} /></Td>
      <Td><Toggle label={`${name} to Customer room`} checked={d.customer_room} onChange={(v) => set("customer_room", v)} /></Td>
      <Td><Toggle label={`${name} new vehicles`} checked={d.include_new} onChange={(v) => set("include_new", v)} /></Td>
      <Td><Toggle label={`${name} used vehicles`} checked={d.include_used} onChange={(v) => set("include_used", v)} /></Td>
      <Td><Toggle label={`${name} certified vehicles`} checked={d.include_certified} onChange={(v) => set("include_certified", v)} /></Td>
      <Td><Toggle label={`${name} show prices`} checked={d.show_prices} onChange={(v) => set("show_prices", v)} /></Td>
      <Td><Toggle label={`${name} show details`} checked={d.show_details} onChange={(v) => set("show_details", v)} /></Td>
      <Td><input aria-label={`${name} priority`} type="number" min={1} max={1000} className={`${inputClass} w-20`} value={Number.isFinite(d.priority) ? d.priority : ""} onChange={(e) => set("priority", e.target.value === "" ? NaN : Number(e.target.value))} /></Td>
      <Td align="right">
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="primary" disabled={busy || !dirty || !priorityOk || !channelOk} onClick={() => act(() => saveSharingRule(payload), `Sharing from ${name} saved`)}>{rule ? "Save" : "Share"}</Button>
          {rule && <ConfirmButton label="Revoke" confirmLabel="Revoke sharing" variant="danger" disabled={busy} onConfirm={() => act(() => revokeSharingRule(rule.id), `Sharing from ${name} revoked`)} />}
        </div>
      </Td>
    </tr>
  );
}

export default function SharingSection() {
  const { stores, groupId, href } = useNet();
  const [params, setParams] = useSearchParams();
  const destId = params.get("store") && stores.some((s) => s.store.id === params.get("store")) ? params.get("store")! : stores[0]?.store.id ?? "";
  const dest = stores.find((s) => s.store.id === destId) ?? null;
  const rules = useQuery({ queryKey: ["inv-net", "sharing", groupId], queryFn: () => listSharingRules(groupId) });

  if (stores.length === 0) return <Panel><EmptyState title="No stores yet" detail="Add stores to this group before sharing inventory between them." compact /></Panel>;
  if (stores.length === 1) return <Panel><EmptyState title="Only one store in this group" detail="Sharing connects two or more stores. By default no store shows its vehicles to another store's customers." compact /></Panel>;

  const forDest = (rules.data ?? []).filter((r) => r.destination_store_id === destId);
  const sources = stores.filter((s) => s.store.id !== destId);

  return (
    <div className="space-y-4">
      <Panel title="Who shows whose vehicles" description="Pick the store whose customers will see more inventory. Each row is a store that could share its vehicles with them.">
        <div className="flex flex-wrap items-end gap-4">
          <SelectField id="sh-dest" label="Customers of" value={destId} onChange={(v) => setParams(new URLSearchParams({ view: "sharing", store: v }))} options={stores.map((s) => ({ value: s.store.id, label: s.store.display_name }))} className="min-w-[260px]" />
          {dest && <Link className="pb-2 text-[14px] font-semibold text-adm-primary hover:underline" to={href("preview", { store: dest.store.id })}>What a customer of {dest.store.display_name} sees</Link>}
        </div>
      </Panel>

      {dest && !dest.store.inventory_sharing_enabled && (
        <InlineNote tone="warning" title={`Sharing is switched off for ${dest.store.display_name}`} action={<Link className="text-[13px] font-semibold underline" to={href("stores", { store: dest.store.id })}>Open store settings</Link>}>Rules below have no effect until it is enabled.</InlineNote>
      )}
      {rules.isSuccess && forDest.length === 0 && <InlineNote tone="info" title="Nothing is shared with this store yet.">By default no store shows its vehicles to another store's customers. Turn on a channel and press Share to start.</InlineNote>}

      <Panel title="Sharing rules" description="Lower priority numbers show first. Prices stay hidden unless you allow them." flush>
        <QueryState status={rules.isLoading ? "loading" : rules.isError ? "error" : "ready"} errorTitle="Could not load sharing rules" errorDetail={rules.isError ? explainError(rules.error) : undefined} onRetry={() => rules.refetch()}>
          {dest && (
            <WorkTable caption="Sharing rules" minWidth={1000}>
              <thead><tr><Th>From store</Th><Th>Connect Card</Th><Th>Customer room</Th><Th>New</Th><Th>Used</Th><Th>Certified</Th><Th>Show prices</Th><Th>Show details</Th><Th>Priority</Th><Th align="right">Actions</Th></tr></thead>
              <tbody>{sources.map((s) => {
                const rule = forDest.find((r) => r.source_store_id === s.store.id);
                return <RuleRow key={`${s.store.id}-${rule?.updated_at ?? "none"}`} source={s} dest={dest} rule={rule} />;
              })}</tbody>
            </WorkTable>
          )}
        </QueryState>
      </Panel>
    </div>
  );
}
