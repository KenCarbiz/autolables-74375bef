import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { ScopeLabel } from "@/components/admin/v3/editor";
import { useAdminVisibility } from "@/components/admin/v2/useAdminVisibility";
import { visibleCategories } from "@/lib/admin/categories";
import { formatDateTime } from "@/lib/admin/integrations/format";
import { AttentionQueue, FeedBanner, PolicySummary, RecentActivity, SettingsShortcuts, SummaryCards } from "./overview/OverviewParts";
import { ActivityPanel, ExceptionsPanel, PolicyPanel, SetupPanel } from "./overview/OverviewPanels";
import { feedBanner, parsePanel, policyConcepts } from "./overview/overviewModel";
import { useOverviewData } from "./overview/useOverviewData";
import { publishingSlice } from "./publishing/usePublishingData";

export type { OverviewFixture } from "./overview/useOverviewData";

// Overview: the operational control center. Every number is a read the app
// already makes; opening the page starts no sync, worker or provider call.
// Panels (?panel=) are the child screens: exceptions, setup, policy, activity.

export default function OverviewView() {
  const state = useOverviewData();
  const [params] = useSearchParams();
  const panel = parsePanel(params.get("panel"));
  const { ctx } = useAdminVisibility();
  const { data, settings } = state;
  const timeZone = settings.dealer_timezone || null;

  const concepts = useMemo(
    () => policyConcepts({ settings: { ...publishingSlice(settings), passport_contact_routing: settings.passport_contact_routing, passport_agents: settings.passport_agents }, description: data?.description ?? null }),
    [settings, data?.description],
  );
  const visibleIds = state.fixture ? state.visibleCategoryIds : visibleCategories(ctx).map((c) => c.id);
  const banner = feedBanner(data?.feed ?? null, data?.lastSuccessAt ?? null);

  if (panel === "exceptions") return <ExceptionsPanel stats={data?.exceptions ?? null} failed={state.failed} />;
  if (panel === "setup") return <SetupPanel items={state.setup} progress={state.progress} />;
  if (panel === "policy") return <PolicyPanel concepts={concepts} />;
  if (panel === "activity") {
    const fixtureEvents = state.fixture ? (data?.activityAll ?? data?.activity ?? null) : undefined;
    return <ActivityPanel tenantId={state.tenantId} fixtureEvents={fixtureEvents} timeZone={timeZone} />;
  }

  return (
    <div className="space-y-4 lg:space-y-5">
      <div className="flex items-center justify-between gap-x-4 gap-y-1 flex-wrap">
        <ScopeLabel scope="all_rooftops" />
        <p className="text-[13px] leading-[18px] text-adm-muted">
          {state.rooftopLabel}
          {data?.checkedAt && !state.loading ? <> . Updated {formatDateTime(data.checkedAt, { timeZone, withZone: true })}</> : null}
        </p>
      </div>

      {banner && <FeedBanner model={banner} lastSuccessAt={data?.lastSuccessAt ?? null} timeZone={timeZone} />}
      {state.failed && (
        <p role="status" className="text-[14px] leading-[20px] text-adm-muted">Some figures could not be read for this account. They show as Unavailable rather than zero.</p>
      )}

      <SummaryCards
        inventory={data?.activeInventory ?? null}
        progress={state.progress}
        reviews={data?.policyReviews ?? null}
        exceptions={data ? data.exceptions : null}
        loading={state.loading}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)] gap-4 lg:gap-5 items-start">
        <div className="min-w-0 space-y-4 lg:space-y-5">
          <AttentionQueue items={state.attention} loading={state.loading} failed={state.failed} />
          <SettingsShortcuts visibleIds={visibleIds} />
        </div>
        <div className="min-w-0 space-y-4 lg:space-y-5">
          <PolicySummary concepts={concepts} />
          <RecentActivity events={data?.activity ?? null} loading={state.loading} now={state.now} />
        </div>
      </div>
    </div>
  );
}
