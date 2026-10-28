import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useViewFixture, useAdminNow } from "@/lib/admin/dataSource";
import { needsAttention } from "@/lib/admin/health";
import { deriveProviderCard, PROVIDER_CARDS, providerDrillIn, type CrawlFacts, type ProviderEventRow } from "@/lib/admin/integrations/providers";
import { loadCrawlFacts, loadLedgerHeads, loadProviderEvents } from "@/lib/admin/integrations/queries";
import { AdminCard, HealthChip, KeyValueList, SectionTitle, SkeletonBlock } from "@/components/admin/v2/primitives";
import { ReadNote, useFormatAt, useViewer } from "./common";

// Providers: one card per external system, with health derived from recorded
// calls, the crawl ledger and the registry's entitlement knowledge. Opening
// this page makes no provider request.

export interface ProvidersViewFixture {
  events: ProviderEventRow[] | null;
  crawl: CrawlFacts | null;
  backendOk: boolean | null;
  latestRunId: string | null;
  blackbook?: boolean;
}

const DAY_MS = 86_400_000;

export default function ProvidersView() {
  const fixture = useViewFixture<ProvidersViewFixture>("providers");
  const now = useAdminNow();
  const viewer = useViewer();
  const tenantId = fixture ? null : viewer.tenantId;
  const formatAt = useFormatAt(viewer.timeZone);

  const live = useQuery({
    queryKey: ["admin-v2", "providers", tenantId],
    enabled: !fixture && !!tenantId,
    staleTime: 60_000,
    queryFn: async () => {
      const [events, crawl, heads] = await Promise.all([
        loadProviderEvents(tenantId as string, new Date(now - 30 * DAY_MS).toISOString()),
        loadCrawlFacts(tenantId as string),
        loadLedgerHeads(tenantId as string),
      ]);
      return { events, crawl, latestRunId: heads.latestReal?.id ?? null, backendOk: events !== null && crawl !== null && !heads.failed };
    },
  });

  const data: ProvidersViewFixture | null = fixture ?? (live.data ? { ...live.data, blackbook: viewer.blackbook } : live.isError ? { events: null, crawl: null, backendOk: false, latestRunId: null, blackbook: viewer.blackbook } : null);

  const cards = useMemo(() => {
    if (!data) return [];
    return PROVIDER_CARDS.map((spec) => deriveProviderCard({ spec, events: data.events, crawl: data.crawl, flags: { blackbook: data.blackbook ?? viewer.blackbook }, backendOk: data.backendOk, now }));
  }, [data, viewer.blackbook, now]);

  if (!data) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading providers">
        <SkeletonBlock className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{[0, 1, 2, 3, 4, 5].map((i) => <SkeletonBlock key={i} className="h-44" />)}</div>
      </div>
    );
  }

  const attention = cards.filter((c) => needsAttention(c.verdict.state) && c.verdict.state !== "unknown").length;
  const unknown = cards.filter((c) => c.verdict.state === "unknown").length;

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Providers"
        description={`${cards.length} systems. ${attention} need attention, ${unknown} unknown. Health is derived from recorded calls and ledgers; opening this page makes no provider request.`}
      />
      <ReadNote failed={data.events === null || data.crawl === null} />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {cards.map((card) => (
          <AdminCard key={card.spec.id} title={card.spec.label} action={<HealthChip state={card.verdict.state} />}>
            <div className="space-y-3">
              <div>
                <p className="text-[14px] font-semibold text-adm-ink">{card.verdict.headline}</p>
                <p className="text-[13px] leading-[18px] text-adm-muted">{card.verdict.detail}</p>
              </div>
              <KeyValueList rows={[
                { label: "Affects", value: card.spec.affectedOutput },
                { label: "Last attempt", value: card.lastAttemptAt ? formatAt(card.lastAttemptAt) : <span className="text-adm-muted">None recorded</span> },
                { label: "Last success", value: card.lastSuccessAt ? formatAt(card.lastSuccessAt) : <span className="text-adm-muted">None recorded</span> },
                ...(card.attempts !== null ? [{ label: "30-day calls", value: `${card.attempts}${card.refusals ? `, ${card.refusals} refused` : ""}` }] : []),
                ...(card.ttlHours !== null ? [{ label: "Freshness window", value: card.ttlHours >= 24 ? `${Math.round(card.ttlHours / 24)} ${Math.round(card.ttlHours / 24) === 1 ? "day" : "days"}` : `${card.ttlHours} h` }] : []),
              ]} />
              <Link to={providerDrillIn(card.spec, data.latestRunId)} className="inline-block text-[13px] font-semibold text-adm-primary hover:underline">{card.spec.drillInLabel}</Link>
            </div>
          </AdminCard>
        ))}
      </div>
    </div>
  );
}
