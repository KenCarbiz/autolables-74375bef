import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { adminTabHref } from "@/lib/admin/sections";
import { ChildPageFrame } from "@/components/admin/v2/AdminShell";
import { Button, EmptyState, InlineNote, LocalTabs, Panel, SkeletonBlock, StatusText } from "@/components/product";
import { getOverview, listGroups, explainError, type StoreDraft } from "@/lib/inventoryNetwork/api";
import { NetIcon, type NetIconName } from "@/components/inventoryNetwork/icons";
import { NetProvider, SelectField, VIEW_PATH, type Notice, type View } from "./inventoryNetwork/shared";
import OverviewSection from "./inventoryNetwork/OverviewSection";
import StoresSection from "./inventoryNetwork/StoresSection";
import SharingSection from "./inventoryNetwork/SharingSection";
import MarketCheckSection from "./inventoryNetwork/MarketCheckSection";
import MappingSection from "./inventoryNetwork/MappingSection";
import RunsSection from "./inventoryNetwork/RunsSection";
import PreviewSection from "./inventoryNetwork/PreviewSection";
import PilotSection from "./inventoryNetwork/PilotSection";
import CatalogSection from "./inventoryNetwork/CatalogSection";
import DeliveriesSection from "./inventoryNetwork/DeliveriesSection";
import DuplicatesSection from "./inventoryNetwork/DuplicatesSection";

const VIEW_ICON: Record<View, NetIconName> = {
  overview: "health", stores: "store", sharing: "sharing", marketcheck: "marketcheck", mapping: "mapping", runs: "audit", preview: "homeStore",
  pilot: "budget", catalog: "spend", deliveries: "schedule", duplicates: "conflict",
};

const VIEWS: Array<{ key: View; label: string }> = [
  { key: "overview", label: "Group overview" },
  { key: "stores", label: "Stores" },
  { key: "sharing", label: "Sharing" },
  { key: "marketcheck", label: "MarketCheck" },
  { key: "mapping", label: "Feed mapping" },
  { key: "runs", label: "Runs and exceptions" },
  { key: "duplicates", label: "Duplicate handling" },
  { key: "preview", label: "Customer preview" },
  { key: "pilot", label: "MarketCheck pilot" },
  { key: "catalog", label: "Provider catalog" },
  { key: "deliveries", label: "Deliveries" },
];

const crumbs = [{ label: "Administration", href: "/admin" }, { label: "Integrations", href: adminTabHref("inventory-feed") }, { label: "Inventory network" }];

export default function InventoryNetworkPage() {
  const { isAdmin, loading } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { tenant } = useTenant();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [newStoreDraft, setNewStoreDraft] = useState<Partial<StoreDraft> | null>(null);

  const groups = useQuery({ queryKey: ["inv-net", "groups"], queryFn: listGroups, enabled: isAdmin });
  // The group follows the URL, then the account the header shows. The first
  // alphabetical group is only a last resort for a platform admin whose
  // active account has no group of its own.
  const groupParam = params.get("group");
  const groupId = (groupParam && groups.data?.some((g) => g.id === groupParam) ? groupParam : null)
    ?? groups.data?.find((g) => g.tenant_id === tenant?.id)?.id
    ?? groups.data?.[0]?.id
    ?? null;
  const overview = useQuery({ queryKey: ["inv-net", "overview", groupId], queryFn: () => getOverview(groupId!), enabled: isAdmin && !!groupId });

  const view = (VIEWS.find((v) => v.key === params.get("view"))?.key ?? "overview") as View;
  const scope = useMemo<Record<string, string>>(() => (groupParam ? { group: groupParam } : ({} as Record<string, string>)), [groupParam]);
  const href = useCallback((v: View, extra: Record<string, string> = {}) => `${VIEW_PATH}?${new URLSearchParams({ view: v, ...scope, ...extra }).toString()}`, [scope]);
  const go = useCallback((v: View, extra: Record<string, string> = {}) => setParams(new URLSearchParams({ view: v, ...scope, ...extra })), [setParams, scope]);
  const notify = useCallback((tone: Notice["tone"], text: string) => setNotice({ tone, text }), []);
  const refresh = useCallback(() => { qc.invalidateQueries({ queryKey: ["inv-net"] }); }, [qc]);
  const startNewStore = useCallback((prefill: Partial<StoreDraft>) => { setNewStoreDraft(prefill); setParams(new URLSearchParams({ view: "stores", ...scope, store: "new" })); }, [setParams, scope]);
  const clearNewStoreDraft = useCallback(() => setNewStoreDraft(null), []);

  const group = groups.data?.find((g) => g.id === groupId) ?? null;
  const ov = overview.data ?? null;
  const ctx = useMemo(
    () => (group && ov ? { groupId: group.id, group, overview: ov, stores: ov.stores, notify, refresh, href, go, newStoreDraft, startNewStore, clearNewStoreDraft } : null),
    [group, ov, notify, refresh, href, go, newStoreDraft, startNewStore, clearNewStoreDraft],
  );

  const title = "Inventory network";
  if (loading) return <ChildPageFrame section="integrations" crumbs={crumbs} title={title}><SkeletonBlock className="h-64 w-full" /></ChildPageFrame>;
  if (!isAdmin) {
    return (
      <ChildPageFrame section="integrations" crumbs={crumbs} title={title}>
        <Panel><EmptyState title="Platform administrators only" detail="This console controls inventory feeds, sharing and paid lookups across stores, so it is limited to platform administrators." compact /></Panel>
      </ChildPageFrame>
    );
  }

  const controls = ov?.controls ?? null;
  const badge = controls ? (
    controls.emergency_stop ? <StatusText tone="danger">Emergency stop</StatusText> : controls.ingestion_paused ? <StatusText tone="warning">Ingestion paused</StatusText> : <StatusText tone="success">Ingestion running</StatusText>
  ) : undefined;

  return (
    <ChildPageFrame
      section="integrations"
      crumbs={crumbs}
      title={title}
      badge={badge}
      subtitle="Stores, vehicles, sharing and MarketCheck limits for a dealer group. Reading this page never changes inventory or makes a paid lookup."
      actions={groups.data && groups.data.length > 0 ? (
        <SelectField id="inv-group" label="Dealer group" value={groupId ?? ""} onChange={(v) => { setNewStoreDraft(null); setParams(new URLSearchParams({ view, group: v })); }} options={groups.data.map((g) => ({ value: g.id, label: g.name }))} />
      ) : undefined}
    >
      <div className="space-y-4">
        {notice && <InlineNote tone={notice.tone} title={notice.text} action={<Button size="sm" variant="ghost" onClick={() => setNotice(null)}>Dismiss</Button>} />}
        {groups.isError && <InlineNote tone="danger" title="Could not load dealer groups" action={<Button size="sm" onClick={() => groups.refetch()}>Retry</Button>}>{explainError(groups.error)}</InlineNote>}
        {groups.isLoading && <SkeletonBlock className="h-64 w-full" />}
        {groups.isSuccess && groups.data.length === 0 && <Panel><EmptyState title="No dealer groups yet" detail="Each dealership account gets a dealer group when the inventory network update is applied." compact /></Panel>}

        {groupId && (
          <>
            <LocalTabs label="Inventory network sections" tabs={VIEWS.map((v) => ({ key: v.key, label: <span className="inline-flex items-center gap-1.5"><NetIcon name={VIEW_ICON[v.key]} />{v.label}</span>, to: href(v.key), active: view === v.key }))} />
            {overview.isLoading && <SkeletonBlock className="h-64 w-full" />}
            {overview.isError && <InlineNote tone="danger" title="Could not load this group" action={<Button size="sm" onClick={() => overview.refetch()}>Retry</Button>}>{explainError(overview.error)}</InlineNote>}
            {overview.isSuccess && !ctx && <Panel><EmptyState title="Nothing came back for this group" detail="Reload the page. If it keeps happening the group may have been removed." compact /></Panel>}
            {ctx && (
              <NetProvider value={ctx}>
                {view === "overview" && <OverviewSection />}
                {view === "stores" && <StoresSection />}
                {view === "sharing" && <SharingSection />}
                {view === "marketcheck" && <MarketCheckSection />}
                {view === "mapping" && <MappingSection />}
                {view === "runs" && <RunsSection />}
                {view === "preview" && <PreviewSection />}
                {view === "pilot" && <PilotSection />}
                {view === "catalog" && <CatalogSection />}
                {view === "deliveries" && <DeliveriesSection />}
                {view === "duplicates" && <DuplicatesSection />}
              </NetProvider>
            )}
          </>
        )}
      </div>
    </ChildPageFrame>
  );
}
