import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { adminTabHref } from "@/lib/admin/sections";
import { ChildPageFrame } from "@/components/admin/v2/AdminShell";
import { Button, EmptyState, InlineNote, LocalTabs, Panel, SkeletonBlock, StatusText } from "@/components/product";
import { getOverview, listGroups, explainError, type StoreDraft } from "@/lib/inventoryNetwork/api";
import { useViewFixture } from "@/lib/admin/dataSource";
import { NetIcon, type NetIconName } from "@/components/inventoryNetwork/icons";
import { NetProvider, SelectField, VIEW_PATH, type Notice, type View } from "./inventoryNetwork/shared";
import OverviewDetail, { OverviewScreen } from "./inventoryNetwork/OverviewSection";
import StoresBoard from "./inventoryNetwork/StoresBoard";
import MappingReview from "./inventoryNetwork/MappingReview";
import JobDetail from "./inventoryNetwork/JobDetail";
import { Al97Frame } from "./inventoryNetwork/al97ui";
import type { InventoryNetworkFixture } from "./inventoryNetwork/overviewModel";

type Al97Screen = "overview" | "stores" | "mapping" | "job";
const AL97_TITLES: Record<Al97Screen, string> = { overview: "Inventory network", stores: "Stores & import readiness", mapping: "Feed mapping review", job: "Import job" };
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
  const auth = useAuth();
  const fx = useViewFixture<InventoryNetworkFixture>("inventory-network");
  const isAdmin = fx ? true : auth.isAdmin;
  const loading = fx ? false : auth.loading;
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { tenant } = useTenant();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [newStoreDraft, setNewStoreDraft] = useState<Partial<StoreDraft> | null>(null);

  const groupsQ = useQuery({ queryKey: ["inv-net", "groups"], queryFn: listGroups, enabled: isAdmin && !fx });
  const groups = fx ? { data: fx.groups, isError: false, isLoading: false, isSuccess: true, error: null, refetch: groupsQ.refetch } : groupsQ;
  // The group follows the URL, then the account the header shows. The first
  // alphabetical group is only a last resort for a platform admin whose
  // active account has no group of its own.
  const groupParam = params.get("group");
  const groupId = (groupParam && groups.data?.some((g) => g.id === groupParam) ? groupParam : null)
    ?? groups.data?.find((g) => g.tenant_id === tenant?.id)?.id
    ?? groups.data?.[0]?.id
    ?? null;
  const overviewQ = useQuery({ queryKey: ["inv-net", "overview", groupId], queryFn: () => getOverview(groupId!), enabled: isAdmin && !!groupId && !fx });
  const overview = fx ? { data: fx.overview, isError: false, isLoading: false, isSuccess: true, error: null, refetch: overviewQ.refetch } : overviewQ;

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

  const al97: Al97Screen | null = view === "overview" ? "overview" : view === "stores" ? "stores" : view === "mapping" && params.get("file") ? "mapping" : view === "runs" && params.get("job") ? "job" : null;

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

  const tabsRow = groupId ? (
    <LocalTabs label="Inventory network sections" tabs={VIEWS.map((v) => ({ key: v.key, label: <span className="inline-flex items-center gap-1.5"><NetIcon name={VIEW_ICON[v.key]} />{v.label}</span>, to: href(v.key), active: view === v.key }))} />
  ) : null;

  const notices = (
    <>
      {notice && <InlineNote tone={notice.tone} title={notice.text} action={<Button size="sm" variant="ghost" onClick={() => setNotice(null)}>Dismiss</Button>} />}
      {groups.isError && <InlineNote tone="danger" title="Could not load dealer groups" action={<Button size="sm" onClick={() => groups.refetch()}>Retry</Button>}>{explainError(groups.error)}</InlineNote>}
      {groups.isLoading && <SkeletonBlock className="h-64 w-full" />}
      {groups.isSuccess && groups.data.length === 0 && <Panel><EmptyState title="No dealer groups yet" detail="Each dealership account gets a dealer group when the inventory network update is applied." compact /></Panel>}
    </>
  );
  const loadStates = groupId && (
    <>
      {overview.isLoading && <SkeletonBlock className="h-64 w-full" />}
      {overview.isError && <InlineNote tone="danger" title="Could not load this group" action={<Button size="sm" onClick={() => overview.refetch()}>Retry</Button>}>{explainError(overview.error)}</InlineNote>}
      {overview.isSuccess && !ctx && <Panel><EmptyState title="Nothing came back for this group" detail="Reload the page. If it keeps happening the group may have been removed." compact /></Panel>}
    </>
  );

  if (al97) {
    const scopePicker = groups.data && groups.data.length > 0 && groupId ? {
      groups: groups.data, groupId, groupName: group?.name ?? "",
      onChange: (v: string) => { setNewStoreDraft(null); setParams(new URLSearchParams({ view, group: v })); },
    } : undefined;
    const more = (
      <div className="mt-4 space-y-4">
        {notices}
        {loadStates}
        {ctx && (
          <>
            <h2 className="pt-2 text-[16px] font-semibold text-adm-ink">More inventory network views</h2>
            {tabsRow}
            {al97 === "overview" && <OverviewDetail />}
            {al97 === "stores" && <StoresSection />}
            {al97 === "mapping" && <MappingSection />}
            {al97 === "job" && <RunsSection />}
          </>
        )}
      </div>
    );
    if (!ctx) {
      const t = AL97_TITLES[al97];
      return <Al97Frame crumb={t} title={t} subtitle="Reading the inventory network ledgers." scope={scopePicker}>{more}</Al97Frame>;
    }
    return (
      <NetProvider value={ctx}>
        {al97 === "overview" && <OverviewScreen scope={scopePicker}>{more}</OverviewScreen>}
        {al97 === "stores" && <StoresBoard scope={scopePicker}>{more}</StoresBoard>}
        {al97 === "mapping" && <MappingReview scope={scopePicker} path={params.get("file")!}>{more}</MappingReview>}
        {al97 === "job" && <JobDetail scope={scopePicker} jobId={params.get("job")!}>{more}</JobDetail>}
      </NetProvider>
    );
  }

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
        {notices}
        {groupId && (
          <>
            {tabsRow}
            {loadStates}
            {ctx && (
              <NetProvider value={ctx}>
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
