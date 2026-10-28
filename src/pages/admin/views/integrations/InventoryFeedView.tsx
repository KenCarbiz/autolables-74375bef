import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CarFront, CircleAlert, CircleCheck, CircleMinus, CircleX, Clock, Database, FileText, Globe, Info, RefreshCw, TriangleAlert } from "lucide-react";
import { useViewFixture, useAdminNow } from "@/lib/admin/dataSource";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";
import { countDisplay, HEALTH_META, needsAttention, RUN_OUTCOME_META, type HealthTone, type HealthVerdict } from "@/lib/admin/health";
import { deriveFeedSnapshot, isProviderErrorOutcome, pageSlice, pageWindow, type FeedConfigRow } from "@/lib/admin/integrations/feed";
import { detailsLabel, httpLabel, inventoryChangesLabel, outcomeForRun, type SyncRunRow } from "@/lib/admin/integrations/runs";
import { clearFeedScope, loadFeedConfig, loadInventoryCounts, loadLedgerHeads, loadRunsPage, type InventoryCounts } from "@/lib/admin/integrations/queries";
import { AdminButton, AdminCard, AdminLinkButton, AdminTable, InlineNote, KeyValueList, SkeletonBlock, StatusChip, Td, Th } from "@/components/admin/v2/primitives";
import { cn } from "@/lib/utils";
import FeedSettingsCard from "./FeedSettingsCard";
import { Pager, ReadNote, useFormatAt, useViewer, type Viewer } from "./common";

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

const TH = "px-3 py-[11px] text-[14px] leading-[20px] text-adm-ink";
const TD = "px-3 py-[13px]";
const CARD_TITLE = "text-[18px] leading-[26px] font-semibold text-adm-ink";

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
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">{[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} className="h-[90px]" />)}</div>
        <SkeletonBlock className="h-72 w-full" />
      </div>
    );
  }

  const { tiles, source, refresh } = snapshot;
  const runHref = snapshot.latestRealRunId ? ADMIN_CHILD_ROUTES.syncRun(snapshot.latestRealRunId) : null;
  const lastAttemptValue = tiles.lastAttempt.value ? formatAt(tiles.lastAttempt.value) : "Never";
  const lastSuccessValue = tiles.lastSuccess.value ? formatAt(tiles.lastSuccess.value) : "Never";
  const identityChipTone = source.identity === "verified" ? "success" : source.identity === "needs_review" ? "warning" : source.identity === "unknown" ? "neutral" : "info";
  const banner = needsAttention(snapshot.health.state) ? snapshot.health : null;

  return (
    <div className="space-y-4">
      <h2 className="pb-1 text-[28px] leading-[36px] font-bold text-adm-ink">Integrations &amp; Data</h2>
      {banner && (
        <FeedBanner
          verdict={banner}
          action={runHref ? <AdminLinkButton to={runHref} variant="outline" className="min-h-[43px] sm:min-h-[43px] px-5">Open run details</AdminLinkButton> : undefined}
        />
      )}
      <ReadNote failed={configLoadFailed || runsLoadFailed} />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <FeedTile icon={Clock} iconClassName="w-[30px] h-[30px]" label="Last attempt" value={lastAttemptValue} tone={tiles.lastAttempt.tone} href={runHref ?? undefined} ariaLabel={`Last attempt: ${lastAttemptValue}`} mask="timestamp" />
        <FeedTile icon={CircleCheck} iconClassName="w-[30px] h-[30px]" label="Last successful" value={lastSuccessValue} tone={tiles.lastSuccess.tone} mask="timestamp" />
        <FeedTile icon={CarFront} iconClassName="w-[30px] h-[30px]" label="Active vehicles" value={countDisplay(counts.active)} tone="info" href="/inventory" />
        <FeedTile icon={Database} iconClassName="w-7 h-7" label="Source identity" value={tiles.sourceIdentity.value} tone={tiles.sourceIdentity.tone} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_365px] gap-4 items-start">
        <AdminCard id="recent-attempts" flush className="min-w-0">
          <div className="flex items-center justify-between gap-4 px-6 pt-[14px] pb-3">
            <h3 className={CARD_TITLE}>Recent attempts</h3>
            <Link to={`${adminTabHref("activity")}&kind=provider_job`} className="text-[14px] leading-[20px] font-semibold text-adm-primary hover:underline">View history</Link>
          </div>
          {runsFailed ? (
            <p className="px-6 pb-6 text-[13px] text-adm-muted" role="status">The run ledger could not be read.</p>
          ) : runRows.length === 0 ? (
            <p className="px-6 pb-6 text-[13px] text-adm-muted">No attempts have been recorded for this rooftop yet.</p>
          ) : (
            <>
              <AdminTable caption="Recent inventory feed attempts">
                <colgroup>
                  <col className="w-[156px]" />
                  <col className="w-[195px]" />
                  <col className="w-[106px]" />
                  <col className="w-[200px]" />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <Th className={cn(TH, "pl-[27px]")}>Time</Th>
                    <Th className={TH}>Outcome</Th>
                    <Th className={TH}>HTTP</Th>
                    <Th className={TH}>Inventory changes</Th>
                    <Th className={TH}>Details</Th>
                  </tr>
                </thead>
                <tbody>
                  {slice.rows.map((run) => {
                    const outcome = outcomeForRun(run);
                    const meta = RUN_OUTCOME_META[outcome];
                    const href = ADMIN_CHILD_ROUTES.syncRun(run.id);
                    return (
                      <tr key={run.id} onClick={() => navigate(href)} className="cursor-pointer hover:bg-adm-workspace">
                        <Td className={cn(TD, "pl-[27px]")}><Link to={href} data-parity="timestamp" className="text-adm-ink hover:underline" onClick={(e) => e.stopPropagation()}>{formatAt(run.started_at)}</Link></Td>
                        <Td className={cn(TD, "py-[10px]")}>
                          <span className="flex items-center gap-[18px] text-adm-ink">
                            <OutcomeIcon tone={isProviderErrorOutcome(outcome) ? "danger" : meta.tone} />
                            {meta.label}
                          </span>
                        </Td>
                        <Td className={cn(TD, "tabular-nums")}>{httpLabel(run)}</Td>
                        <Td className={TD}>{inventoryChangesLabel(run, outcome)}</Td>
                        <Td className={cn(TD, "text-adm-muted")}>{detailsLabel(run, outcome)}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </AdminTable>
              <Pager page={slice.page} pages={slice.pages} from={slice.from} to={slice.to} total={runTotal} noun="attempts" size={size} onPage={setPage} onSize={(s) => { setSize(s); setPage(1); }} loaded={slice.rows.length} />
            </>
          )}
        </AdminCard>

        <SourceCard snapshot={snapshot} tenantId={tenantId} onChanged={refetch} identityChipTone={identityChipTone} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <AdminCard bodyClassName="px-6 pt-2 pb-[19px]">
          <h3 className={CARD_TITLE}>Condition coverage <span className="font-normal">(this rooftop)</span></h3>
          <div className="mt-3 grid grid-cols-3 divide-x divide-adm-border">
            <CoverageStat label="New" value={countDisplay(counts.new)} />
            <CoverageStat label="Used" value={countDisplay(counts.used)} />
            <CoverageStat label="CPO" value={countDisplay(counts.cpo)} />
          </div>
        </AdminCard>
        <AdminCard bodyClassName="px-6 pt-2 pb-[19px]">
          <h3 className={cn(CARD_TITLE, "flex items-center gap-[13px]")}>
            <RefreshCw className="w-6 h-6 text-adm-primary flex-shrink-0" aria-hidden="true" />
            Refresh status
          </h3>
          <div className="mt-4 grid grid-cols-1 gap-y-3 divide-adm-border sm:grid-cols-[1fr_auto_1fr] sm:gap-y-0 sm:divide-x">
            <RefreshFact label="Scope" value={refresh.scope} />
            <RefreshFact label="Schedule" value={refresh.schedule} />
            <RefreshFact label="Status" value={refresh.statusLabel} />
          </div>
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

const BANNER_TONE: Record<HealthTone, string> = {
  neutral: "bg-adm-workspace border-adm-border text-adm-ink",
  success: "bg-adm-success-bg border-[#BFE3CF] text-adm-success",
  warning: "bg-adm-warning-bg border-[#F1D58A] text-[#5F3F00]",
  danger: "bg-adm-danger-bg border-[#F3B4AE] text-adm-danger",
  info: "bg-adm-selected border-[#C5D4F7] text-adm-ink",
};
const BANNER_ICON: Record<HealthTone, typeof Info> = { neutral: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleX, info: Info };

/** The feed verdict as a two-line banner; a healthy feed renders none. */
const FeedBanner = ({ verdict, action }: { verdict: HealthVerdict; action?: ReactNode }) => {
  const tone = HEALTH_META[verdict.state].tone;
  const Icon = BANNER_ICON[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex flex-wrap items-center gap-x-[18px] gap-y-3 rounded-[10px] border px-[18px] pt-2.5 pb-[19px]", BANNER_TONE[tone])}>
      <Icon className="w-[34px] h-[34px] flex-shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 basis-[200px]">
        <p className="text-[16px] leading-[22px] font-semibold">{verdict.headline}</p>
        <p className="mt-1 text-[14px] leading-[20px] opacity-90">{verdict.detail}</p>
      </div>
      {action && <div className="flex-shrink-0 max-sm:basis-full">{action}</div>}
    </div>
  );
};

const TILE_ICON: Record<HealthTone, string> = { neutral: "text-adm-ink", success: "text-adm-success", warning: "text-adm-ink", danger: "text-adm-danger", info: "text-adm-ink" };

/** A label over a text value; dates and state names are allowed to be long, so the value is 22px, not a count. */
const FeedTile = ({ icon: Icon, iconClassName, label, value, tone, href, ariaLabel, mask }: { icon: typeof Clock; iconClassName: string; label: string; value: string; tone: HealthTone; href?: string; ariaLabel?: string; mask?: string }) => {
  const body = (
    <>
      <Icon className={cn("flex-shrink-0", iconClassName, TILE_ICON[tone])} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] leading-[20px] text-adm-muted">{label}</span>
        <span data-parity={mask} className="block mt-0.5 text-[22px] leading-[26px] font-bold text-adm-ink tabular-nums truncate">{value}</span>
      </span>
    </>
  );
  const cls = "flex items-center gap-5 rounded-[10px] border border-adm-border bg-adm-surface px-[21px] min-h-[90px]";
  return href ? (
    <Link to={href} data-parity="tile" className={cn(cls, "hover:border-adm-primary/60 focus-visible:outline-2 focus-visible:outline-adm-primary")} aria-label={ariaLabel ?? `${label}: ${value}`}>
      {body}
    </Link>
  ) : (
    <div data-parity="tile" className={cls}>{body}</div>
  );
};

const OUTCOME_ICON: Record<HealthTone, { icon: typeof Info; fill: string }> = {
  success: { icon: CircleCheck, fill: "fill-adm-success" },
  danger: { icon: CircleX, fill: "fill-adm-danger" },
  warning: { icon: CircleAlert, fill: "fill-adm-warning" },
  neutral: { icon: CircleMinus, fill: "fill-adm-muted" },
  info: { icon: Info, fill: "fill-adm-primary" },
};

// Filled marks lose a stroke width of visible fill, so the box is drawn larger than the mark it shows.
const OutcomeIcon = ({ tone }: { tone: HealthTone }) => {
  const { icon: Icon, fill } = OUTCOME_ICON[tone];
  return <Icon className={cn("w-[26px] h-[26px] flex-shrink-0 text-white", fill)} aria-hidden="true" />;
};

const CoverageStat = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0 px-3 first:pl-3 last:pr-0">
    <p className="text-[13px] leading-[18px] text-adm-muted">{label}</p>
    <p className="text-[24px] leading-[30px] font-bold text-adm-ink tabular-nums">{value}</p>
  </div>
);

const RefreshFact = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0 sm:pr-4 sm:[&:not(:first-child)]:pl-5">
    <p className="text-[13px] leading-[18px] text-adm-muted">{label}</p>
    <p className="mt-0.5 text-[16px] leading-[22px] text-adm-ink sm:whitespace-nowrap">{value}</p>
  </div>
);

const SourceCard = ({
  snapshot,
  tenantId,
  onChanged,
  identityChipTone,
}: {
  snapshot: ReturnType<typeof deriveFeedSnapshot>;
  tenantId: string | null;
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
    <AdminCard bodyClassName="px-[19px] pt-[13px] pb-[17px]">
      <div className="flex items-center justify-between gap-3">
        <h3 className={CARD_TITLE}>Source</h3>
        <StatusChip tone={identityChipTone} icon className="h-[27px] px-2.5">{snapshot.tiles.sourceIdentity.value}</StatusChip>
      </div>
      <div className="mt-3 flex items-center gap-[14px]">
        <Globe className="w-6 h-6 text-adm-primary flex-shrink-0" aria-hidden="true" />
        <p data-parity="host" className="text-[16px] leading-[22px] font-semibold text-adm-ink truncate">{source.host ?? "No source configured"}</p>
      </div>
      <p className="mt-[14px] text-[14px] leading-[20px] text-adm-muted">{source.pinLabel}</p>
      {source.pinValue ? (
        <p data-parity="pin" className="mt-0.5 text-[20px] leading-[26px] font-bold text-adm-ink tabular-nums truncate">{source.pinValue}</p>
      ) : (
        <p className="mt-0.5 text-[20px] leading-[26px] font-bold text-adm-muted">Not pinned</p>
      )}
      <p className={cn("mt-2 flex items-center gap-[7px] text-[14px] leading-[20px] font-semibold", source.identity === "needs_review" ? "text-adm-warning" : "text-adm-success")}>
        {source.identity === "needs_review" ? (
          <CircleAlert className="w-[26px] h-[26px] flex-shrink-0 text-white fill-adm-warning" aria-hidden="true" />
        ) : (
          <CircleCheck className="w-[26px] h-[26px] flex-shrink-0 text-white fill-adm-success" aria-hidden="true" />
        )}
        {source.retainedLabel}
      </p>
      <div className="mt-3 flex items-center gap-3 rounded-md border border-adm-border bg-adm-workspace px-4 py-0.5 text-[13px] leading-[18px] text-adm-ink">
        <Info className="w-5 h-5 flex-shrink-0 text-adm-muted" aria-hidden="true" />
        <span>{source.note}</span>
      </div>
      <AdminButton
        variant="secondary"
        disabled={!source.review.enabled}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-describedby="review-source-hint"
        className="mt-[9px] w-full min-h-[43px] sm:min-h-[43px] text-[15px] gap-2.5 disabled:opacity-100 disabled:bg-adm-workspace disabled:text-adm-muted"
      >
        <FileText className="w-5 h-5" aria-hidden="true" />
        {open ? "Close review" : "Review source"}
      </AdminButton>
      <p id="review-source-hint" className="mt-1.5 text-[12px] leading-[18px] text-adm-muted">{source.review.reason}</p>
      {open && source.review.enabled && (
        <div className="mt-4 rounded-[10px] border border-adm-border bg-adm-workspace p-4 space-y-3" aria-label="Source identity review">
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
    </AdminCard>
  );
};
