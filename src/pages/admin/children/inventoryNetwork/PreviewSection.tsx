import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { EmptyState, InlineNote, Panel, QueryState } from "@/components/product";
import { GroupInventoryBrowser } from "@/components/inventoryNetwork/GroupInventoryBrowser";
import { explainError, getPreviewContext, getPreviewInventory, type Channel } from "@/lib/inventoryNetwork/api";
import { SelectField, useNet } from "./shared";

export default function PreviewSection() {
  const { stores, notify } = useNet();
  const [params, setParams] = useSearchParams();
  const [channel, setChannel] = useState<Channel>("connect_card");
  const [agentChoice, setAgentChoice] = useState<string | null>(null);
  const picked = params.get("store");
  const storeId = picked && stores.some((s) => s.store.id === picked) ? picked : stores[0]?.store.id ?? "";
  const store = stores.find((s) => s.store.id === storeId)?.store ?? null;

  const ctx = useQuery({ queryKey: ["inv-net", "preview-ctx", storeId], queryFn: () => getPreviewContext(storeId), enabled: !!storeId });
  const inv = useQuery({ queryKey: ["inv-net", "preview", storeId, channel], queryFn: () => getPreviewInventory(storeId, channel), enabled: !!storeId });
  const agents = ctx.data?.agents ?? [];
  const agent = agents.find((a) => a.id === agentChoice) ?? agents[0] ?? null;

  if (!store) return <Panel><EmptyState title="No stores yet" detail="Add a store and share inventory to see what its customers would see." compact /></Panel>;

  return (
    <div className="space-y-4">
      <Panel title={`What a customer of ${store.display_name} sees`} description="Choose where the customer started and who they are talking to. This is a read-only preview.">
        <div className="grid gap-4 md:grid-cols-3">
          <SelectField id="pv-store" label="Originating store" value={storeId} onChange={(v) => { setParams(new URLSearchParams({ view: "preview", store: v })); setAgentChoice(null); }} options={stores.map((s) => ({ value: s.store.id, label: s.store.display_name }))} />
          <SelectField id="pv-agent" label="Salesperson" value={agent?.id ?? ""} onChange={setAgentChoice} disabled={agents.length === 0} options={agents.length === 0 ? [{ value: "", label: ctx.isLoading ? "Loading" : "No salespeople on file" }] : agents.map((a) => ({ value: a.id, label: a.title ? `${a.name}, ${a.title}` : a.name }))} />
          <SelectField id="pv-channel" label="Channel" value={channel} onChange={(v) => setChannel(v as Channel)} options={[{ value: "connect_card", label: "Connect Card" }, { value: "customer_room", label: "Customer room" }]} />
        </div>
        {ctx.isError && <p className="mt-3 text-[13px] text-adm-danger">Could not load salespeople: {explainError(ctx.error)}</p>}
      </Panel>

      {!ctx.isLoading && agents.length === 0 && <InlineNote tone="warning" title="No salesperson to credit">Contact buttons show a generic label until this store has salespeople in its dealer profile.</InlineNote>}

      <Panel title="Customer view" flush>
        <div className="p-4">
          <QueryState status={inv.isLoading ? "loading" : inv.isError ? "error" : !inv.data ? "empty" : "ready"} errorTitle="Could not load the preview" errorDetail={inv.isError ? explainError(inv.error) : undefined} onRetry={() => inv.refetch()} emptyTitle="Nothing came back" emptyDetail="The preview returned no data for this store and channel.">
            {inv.data && (
              <GroupInventoryBrowser
                data={inv.data}
                salesperson={agent ? { id: agent.id, name: agent.name } : null}
                onContact={() => notify("info", `Preview only. A customer would be asking ${agent?.name ?? "the originating store"} about this vehicle.`)}
              />
            )}
          </QueryState>
        </div>
      </Panel>
    </div>
  );
}
