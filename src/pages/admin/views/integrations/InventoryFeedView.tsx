import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Car, CheckCircle2, Clock, Globe, ShieldCheck } from "lucide-react";
import { useViewFixture, useAdminNow } from "@/lib/admin/dataSource";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";
import { countDisplay, RUN_OUTCOME_META, type CountValue } from "@/lib/admin/health";
import { deriveFeedSnapshot, pageSlice, pageWindow, type FeedConfigRow } from "@/lib/admin/integrations/feed";
import { detailsLabel, httpLabel, inventoryChangesLabel, outcomeForRun, type SyncRunRow } from "@/lib/admin/integrations/runs";
import { clearFeedScope, loadFeedConfig, loadInventoryCounts, loadLedgerHeads, loadRunsPage, type InventoryCounts } from "@/lib/admin/integrations/queries";
import { AdminButton, AdminCard, AdminLinkButton, AdminTable, HealthBanner, InlineNote, KeyValueList, SkeletonBlock, StatTile, StatusChip, Td, Th } from "@/components/admin/v2/primitives";
import FeedSettingsCard from "./FeedSettingsCard";
import { BigNumber, Pager, ReadNote, TextValue, useFormatAt, useViewer, type Viewer } from "./common";

// Inventory feed: the health center for the MarketCheck inventory pull.
// Everything on this screen is derived from the sync configuration, the run
// ledger and inventory counts. Opening it calls no provider and writes nothing.

export interface FeedViewFixture {
  config: FeedConfigRow | null;
  configLoadFailed?: boolean;
  latestRun: SyncRunRow | null;
  latestRealRun: SyncRunRow | null;
  lastSuccessAt: string | null;
  runsLoadFailed?: boolean;
  runs: { rows: SyncRunRow[]; total: number | null };
  counts: InventoryCounts;
  viewer?: Partial<Viewer>;
}

const UNKNOWN_COUNTS: InventoryCounts = { active: { kind: "loading" }, new: { kind: "loading" }, used: { kind: "loading" }, cpo: { kind: "loading" } };

export default function InventoryFeedView() {
  const fixture = useViewFixture<FeedViewFixture>("inventory-feed");
  const now = useAdminNow();
  const liveViewer = useViewer();
  const viewer: Viewer = useMemo(() => ({ ...liveViewer, ...(fixture?.viewer ?? {}) }), [liveViewer, fixture]);
  const tenantId = fixture ? null : viewer.tenantId;
  const formatAt = useFormatAt(viewer.timeZone);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [size, setSize] = useState(25);

  const head = useQuery({
    queryKey: ["admin-v2", "feed", tenantId],
    enabled: !fixture && !!tenantId,
    staleTime: 30_000,
    queryFn: async () => {
      const [cfg, heads, counts] = await Promise.all([loadFeedConfig(tenantId as string), loadLedgerHeads(tenantId as string), loadInventoryCounts(tenantId as string)]);
      return { cfg, heads, counts };
    },
  });
  const runs = useQuery({
    queryKey: ["admin-v2", "feed-runs", tenantId, page, size],
    enabled: !fixture && !!tenantId,
    staleTime: 30_000,
    queryFn: () => loadRunsPage(tenantId as string, page, size),
  });

  const loading = !fixture && (head.isLoading || !tenantId);
  const config = fixture ? fixture.config : head.data?.cfg.config ?? null;
  const configLoadFailed = fixture ? !!fixture.configLoadFailed : head.isError || !!head.data?.cfg.failed;
  const runsLoadFailed = fixture ? !!fixture.runsLoadFailed : head.isError || !!head.data?.heads.failed;
  const counts: InventoryCounts = fixture ? fixture.counts : head.data?.counts ?? (head.isError ? { active: { kind: "failed" }, new: { kind: "failed" }, used: { kind: "failed" }, cpo: { kind: "failed" } } : UNKNOWN_COUNTS);

  const snapshot = useMemo(() => deriveFeedSnapshot({
    config,
    configLoadFailed,
    latestRun: fixture ? fixture.latestRun : head.data?.heads.latest ?? null,
    latestRealRun: fixture ? fixture.latestRealRun : head.data?.heads.latestReal ?? null,
    lastSuccessAt: fixture ? fixture.lastSuccessAt : head.data?.heads.lastSuccessAt ?? null,
    runsLoadFailed,
    activeVehicles: counts.active,
    coverage: { new: counts.new, used: counts.used, cpo: counts.cpo },
    actorCanClearScope: viewer.canClearScope,
    now,
  }), [config, configLoadFailed, fixture, head.data, runsLoadFailed, counts, viewer.canClearScope, now]);

  const runRows: SyncRunRow[] = fixture ? fixture.runs.rows : runs.data?.rows ?? [];
  const runTotal = fixture ? fixture.runs.total : runs.data?.total ?? null;
  const slice = fixture ? pageSlice(runRows, page, size) : pageWindow(runRows, page, size, runTotal);
  const runsFailed = fixture ? !!fixture.runsLoadFailed : runs.isError || !!runs.data?.failed;

  const refetch = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-v2", "feed"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-v2", "feed-runs"] });
  };

  const setPage = (p: number) => {
    const next = new URLSearchParams(params);
    if (p <= 1) next.delete("page"); else next.set("page", String(p));
    setParams(next, { replace: true });
  };

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading inventory feed">
        <SkeletonBlock className="h-12 w-full" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">{[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} className="h-[76px]" />)}</div>
        <SkeletonBlock className="h-72 w-full" />
      </div>
    );
  }

  const { tiles, source, refresh } = snapshot;
  const runHref = snapshot.latestRealRunId ? ADMIN_CHILD_ROUTES.syncRun(snapshot.latestRealRunId) : null;
  const lastAttemptValue = tiles.lastAttempt.value ? formatAt(tiles.lastAttempt.value) : "Never";
  const lastSuccessValue = tiles.lastSuccess.value ? formatAt(tiles.lastSuccess.value) : "Never";
  const lastAttemptHint = snapshot.outcome ? RUN_OUTCOME_META[snapshot.outcome].label : tiles.lastAttempt.hint;
  const identityChipTone = source.identity === "verified" ? "success" : source.identity === "needs_review" ? "warning" : source.identity === "unknown" ? "neutral" : "info";

  return (
    <div className="space-y-4">
      <HealthBanner verdict={snapshot.health} action={runHref ? <AdminLinkButton to={runHref} variant="secondary" size="sm">Open run details</AdminLinkButton> : undefined} />
      <ReadNote failed={configLoadFailed || runsLoadFailed} />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatTile icon={Clock} label="Last attempt" value={<TextValue>{lastAttemptValue}</TextValue>} ariaLabel={`Last attempt: ${lastAttemptValue}`} hint={lastAttemptHint} tone={tiles.lastAttempt.tone} href={runHref ?? undefined} />
        <StatTile icon={CheckCircle2} label="Last successful" value={<TextValue>{lastSuccessValue}</TextValue>} hint={tiles.lastSuccess.hint} tone={tiles.lastSuccess.tone} />
        <StatTile icon={Car} label="Active vehicles" value={countDisplay(counts.active)} hint={tiles.activeVehicles.hint} tone="info" href="/inventory" />
        <StatTile icon={ShieldCheck} label="Source identity" value={<TextValue>{tiles.sourceIdentity.value}</TextValue>} hint={tiles.sourceIdentity.hint} tone={tiles.sourceIdentity.tone} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] gap-4 items-start">
        <AdminCard id="recent-attempts" title="Recent attempts" description="Every run the sync recorded for this rooftop, newest first." flush action={<Link to={`${adminTabHref("activity")}&kind=provider_job`} className="text-[13px] font-semibold text-adm-primary hover:underline">View history</Link>}>
          {runsFailed ? (
            <p className="px-6 pb-6 text-[13px] text-adm-muted" role="status">The run ledger could not be read.</p>
          ) : runRows.length === 0 ? (
            <p className="px-6 pb-6 text-[13px] text-adm-muted">No attempts have been recorded for this rooftop yet.</p>
          ) : (
            <>
              <AdminTable caption="Recent inventory feed attempts">
                <thead>
                  <tr>
                    <Th>Time</Th>
                    <Th>Outcome</Th>
                    <Th>HTTP</Th>
                    <Th>Inventory changes</Th>
                    <Th>Details</Th>
                  </tr>
                </thead>
                <tbody>
                  {slice.rows.map((run) => {
                    const outcome = outcomeForRun(run);
                    const meta = RUN_OUTCOME_META[outcome];
                    const href = ADMIN_CHILD_ROUTES.syncRun(run.id);
                    return (
                      <tr key={run.id} onClick={() => navigate(href)} className="cursor-pointer hover:bg-adm-workspace">
                        <Td><Link to={href} className="font-semibold text-adm-ink hover:underline" onClick={(e) => e.stopPropagation()}>{formatAt(run.started_at)}</Link></Td>
                        <Td><StatusChip tone={meta.tone}>{meta.label}</StatusChip></Td>
                        <Td className="tabular-nums">{httpLabel(run)}</Td>
                        <Td>{inventoryChangesLabel(run, outcome)}</Td>
                        <Td className="text-adm-muted">{detailsLabel(run, outcome)}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </AdminTable>
              <Pager page={slice.page} pages={slice.pages} from={slice.from} to={slice.to} total={runTotal} noun="attempts" size={size} onPage={setPage} onSize={(s) => { setSize(s); setPage(1); }} loaded={slice.rows.length} />
            </>
          )}
        </AdminCard>

        <SourceCard snapshot={snapshot} tenantId={tenantId} formatAt={formatAt} onChanged={refetch} identityChipTone={identityChipTone} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] gap-4 items-start">
        <AdminCard title="Condition coverage (this rooftop)" description="Active vehicles by condition. Archived vehicles are excluded.">
          <div className="grid grid-cols-3 gap-4">
            <BigNumber label="New" value={countDisplay(counts.new)} />
            <BigNumber label="Used" value={countDisplay(counts.used)} />
            <BigNumber label="CPO" value={countDisplay(counts.cpo)} />
          </div>
        </AdminCard>
        <AdminCard title="Refresh status">
          <KeyValueList rows={[
            { label: "Scope", value: refresh.scope },
            { label: "Schedule", value: refresh.schedule },
            { label: "Status", value: <StatusChip tone={refresh.tone}>{refresh.statusLabel}</StatusChip> },
          ]} />
        </AdminCard>
      </div>

      <FeedSettingsCard
        key={config ? `${config.updated_at ?? ""}:${config.source ?? ""}:${config.enabled}:${config.frequency}:${config.run_hour}:${config.max_vehicles}` : "none"}
        tenantId={tenantId}
        config={config}
        configLoadFailed={configLoadFailed}
        activeVehicles={counts.active}
        viewer={viewer}
        outcome={snapshot.outcome}
        now={now}
        onChanged={refetch}
      />
    </div>
  );
}

const SourceCard = ({
  snapshot,
  tenantId,
  formatAt,
  onChanged,
  identityChipTone,
}: {
  snapshot: ReturnType<typeof deriveFeedSnapshot>;
  tenantId: string | null;
  formatAt: ReturnType<typeof useFormatAt>;
  onChanged: () => void;
  identityChipTone: "success" | "warning" | "neutral" | "info";
}) => {
  const { source } = snapshot;
  const [open, setOpen] = useState(false);
  const [clearStep, setClearStep] = useState<"idle" | "confirm" | "clearing" | "done">("idle");
  const [clearMessage, setClearMessage] = useState<string | null>(null);

  const clear = async () => {
    if (!tenantId) return;
    setClearStep("clearing");
    const { error } = await clearFeedScope(tenantId);
    setClearStep("done");
    setClearMessage(error ? `The pin was not cleared: ${error}` : "The rooftop pin was cleared. The next run re-probes every feed before pinning again.");
    if (!error) onChanged();
  };

  return (
    <AdminCard title="Source" action={<StatusChip tone={identityChipTone} icon>{snapshot.tiles.sourceIdentity.value}</StatusChip>}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-md bg-adm-workspace text-adm-muted flex items-center justify-center flex-shrink-0" aria-hidden="true"><Globe className="w-4 h-4" /></span>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-adm-ink truncate">{source.host ?? "No source configured"}</p>
            <p className="text-[12px] leading-[18px] text-adm-muted">Inventory feed</p>
          </div>
        </div>
        <KeyValueList rows={[
          { label: source.pinLabel, value: source.pinValue ? <span className="font-mono text-[13px]">{source.pinValue}</span> : <span className="text-adm-muted">Not pinned</span> },
          { label: "Verified", value: source.verifiedAt ? formatAt(source.verifiedAt) : <span className="text-adm-muted">Not recorded</span> },
          { label: "Last good pull", value: source.lastGoodAt ? `${source.lastGoodCount ?? "?"} vehicles, ${formatAt(source.lastGoodAt)}` : <span className="text-adm-muted">Not recorded</span> },
        ]} />
        <p className="flex items-center gap-2 text-[13px] font-semibold text-adm-ink">
          <CheckCircle2 className={`w-4 h-4 ${source.identity === "needs_review" ? "text-adm-warning" : "text-adm-success"}`} aria-hidden="true" />
          {source.retainedLabel}
        </p>
        <InlineNote tone="info">{source.note}</InlineNote>
        <div>
          <AdminButton variant="secondary" disabled={!source.review.enabled} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-describedby="review-source-hint" className="w-full">
            {open ? "Close review" : "Review source"}
          </AdminButton>
          <p id="review-source-hint" className="mt-2 text-[12px] leading-[18px] text-adm-muted">{source.review.reason}</p>
        </div>
        {open && source.review.enabled && (
          <div className="rounded-[10px] border border-adm-border bg-adm-workspace p-4 space-y-3" aria-label="Source identity review">
            <KeyValueList rows={[
              { label: "Rooftop", value: source.rooftop.name ?? <span className="text-adm-muted">Not recorded</span> },
              { label: "Street", value: source.rooftop.street ?? <span className="text-adm-muted">Not recorded</span> },
              { label: "ZIP", value: source.rooftop.zip ?? <span className="text-adm-muted">Not recorded</span> },
            ]} />
            {source.review.allowClearScope ? (
              clearStep === "idle" ? (
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <p className="text-[12px] leading-[18px] text-adm-muted max-w-sm">Clearing the pin makes the next run probe every feed again. Do this only after confirming the provider's answer belonged to another store.</p>
                  <AdminButton variant="danger" size="sm" onClick={() => setClearStep("confirm")}>Clear rooftop pin</AdminButton>
                </div>
              ) : clearStep === "confirm" ? (
                <InlineNote tone="danger" title="Confirm" action={<div className="flex items-center gap-2"><AdminButton variant="ghost" size="sm" onClick={() => setClearStep("idle")}>Cancel</AdminButton><AdminButton variant="danger" size="sm" onClick={clear}>Clear the pin</AdminButton></div>}>
                  The pin is removed immediately and the next run starts over. Inventory is not changed by this action.
                </InlineNote>
              ) : clearStep === "clearing" ? (
                <p role="status" className="text-[13px] text-adm-muted">Clearing…</p>
              ) : (
                <InlineNote tone={clearMessage?.startsWith("The rooftop pin was cleared") ? "success" : "danger"}>{clearMessage}</InlineNote>
              )
            ) : (
              <p className="text-[12px] leading-[18px] text-adm-muted">The pin can only be cleared by an owner or admin, and only when the last answer did not match this rooftop.</p>
            )}
          </div>
        )}
      </div>
    </AdminCard>
  );
};
