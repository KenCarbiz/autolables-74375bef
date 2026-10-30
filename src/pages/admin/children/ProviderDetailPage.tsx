import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";
import { HEALTH_META } from "@/lib/admin/health";
import { PROVIDER_CARDS, providerDrillIn, aggregateEvents, type ProviderEventRow } from "@/lib/admin/integrations/providers";
import { ChildPageFrame } from "@/components/admin/v2/AdminShell";
import { EmptyState, KeyValueList, LinkButton, LocalTabs, MetricStrip, Panel, SkeletonBlock, StatusText, Td, Th, WorkTable } from "@/components/product";
import { useProvidersData } from "@/pages/admin/views/integrations/ProvidersView";

// One external provider, read from the same derived card the Providers list
// shows, plus the recorded calls behind it. Nothing here calls the provider.

const ENTITLEMENT_LABEL = { entitled: "Entitled", refused: "Refused by provider", blocked: "Not entitled", unknown: "Unknown", not_applicable: "Not applicable" } as const;
const OUTCOME_TONE = (o: string | null) => (o === "ok" ? "success" : o && o !== "admitted" ? "danger" : "neutral") as "success" | "danger" | "neutral";

export default function ProviderDetailPage() {
  const { providerId } = useParams<{ providerId: string }>();
  const [params] = useSearchParams();
  const { data, cards, formatAt } = useProvidersData();
  const card = cards.find((c) => c.spec.id === providerId) ?? null;
  const spec = PROVIDER_CARDS.find((p) => p.id === providerId) ?? null;
  const tab = params.get("tab") === "attempts" ? "attempts" : "overview";
  const base = ADMIN_CHILD_ROUTES.providerDetail(providerId ?? "");
  const providersHref = adminTabHref("providers");

  const attempts = useMemo<ProviderEventRow[]>(() => {
    if (!data?.events || !spec) return [];
    const wanted = new Set(spec.billingProducts);
    return data.events.filter((e) => e.product && wanted.has(e.product)).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 25);
  }, [data, spec]);

  const crumbs = [{ label: "Administration", href: "/admin" }, { label: "Integrations", href: providersHref }, { label: "Providers", href: providersHref }, { label: spec?.label ?? "Provider" }];

  if (!data) {
    return (
      <ChildPageFrame section="integrations" crumbs={crumbs} title="Provider">
        <div className="space-y-4" aria-busy="true" aria-label="Loading provider">
          <SkeletonBlock className="h-24 w-full" />
          <SkeletonBlock className="h-64 w-full" />
        </div>
      </ChildPageFrame>
    );
  }

  if (!card || !spec) {
    return (
      <ChildPageFrame section="integrations" crumbs={crumbs} title="Provider not found">
        <Panel>
          <EmptyState title="Provider not found" detail="No provider with this id is in the registry." action={<LinkButton to={providersHref}>Back to providers</LinkButton>} compact />
        </Panel>
      </ChildPageFrame>
    );
  }

  const meta = HEALTH_META[card.verdict.state];
  const freshness = card.ttlHours === null ? null : card.ttlHours >= 24 ? `${Math.round(card.ttlHours / 24)} ${Math.round(card.ttlHours / 24) === 1 ? "day" : "days"}` : `${card.ttlHours} hours`;
  const agg = data.events && spec.billingProducts.length ? aggregateEvents(data.events, spec.billingProducts) : null;

  return (
    <ChildPageFrame
      section="integrations"
      crumbs={crumbs}
      title={spec.label}
      subtitle={spec.affectedOutput}
      backHref={providersHref}
      backLabel="Back to providers"
      actions={<LinkButton variant="primary" to={providerDrillIn(spec, data.latestRunId)}>{spec.drillInLabel}</LinkButton>}
      tabs={
        <LocalTabs
          label="Provider sections"
          tabs={[
            { key: "overview", label: "Overview", to: base, active: tab === "overview" },
            { key: "attempts", label: "Attempts", to: `${base}?tab=attempts`, active: tab === "attempts" },
          ]}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <MetricStrip
          label="Provider status"
          metrics={[
            { label: "Entitlement", value: ENTITLEMENT_LABEL[card.entitlement], tone: card.entitlement === "entitled" ? "success" : card.entitlement === "unknown" || card.entitlement === "not_applicable" ? "neutral" : "danger" },
            { label: "Health", value: meta.label, tone: meta.tone },
            { label: "Last success", value: card.lastSuccessAt ? formatAt(card.lastSuccessAt) : "None recorded" },
            { label: "Freshness window", value: freshness ?? "Not set" },
          ]}
        />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px] items-start">
          <div className="flex flex-col gap-4 min-w-0">
            {tab === "overview" && (
              <Panel title="Capability details" titleSize="md" inset="sm">
                <KeyValueList
                  rows={[
                    { label: "Affects", value: spec.affectedOutput },
                    { label: "Last attempt", value: card.lastAttemptAt ? formatAt(card.lastAttemptAt) : <span className="text-adm-muted">None recorded</span> },
                    { label: "Last success", value: card.lastSuccessAt ? formatAt(card.lastSuccessAt) : <span className="text-adm-muted">None recorded</span> },
                    ...(card.attempts !== null ? [{ label: "30-day calls", value: `${card.attempts}${card.refusals ? `, ${card.refusals} refused` : ""}` }] : []),
                    ...(agg?.lastOutcome ? [{ label: "Last outcome", value: agg.lastOutcome.replace(/_/g, " ") }] : []),
                    ...(spec.registryKeys.length ? [{ label: "Registry keys", value: <span className="font-mono text-[13px]">{spec.registryKeys.join(", ")}</span> }] : []),
                    ...(spec.manual ? [{ label: "Mode", value: "Manual, on request" }] : []),
                  ]}
                />
              </Panel>
            )}
            <Panel title="Recent attempts" titleSize="md" inset="sm" flush>
              {attempts.length === 0 ? (
                <EmptyState title={data.events === null ? "Calls could not be read" : "No calls recorded"} detail={data.events === null ? "The call ledger did not answer. Nothing here is current." : "No call to this provider is recorded in the last 30 days."} compact />
              ) : (
                <WorkTable caption="Recent provider calls">
                  <thead>
                    <tr><Th>Date and time</Th><Th>Product</Th><Th>Outcome</Th><Th align="right">HTTP</Th></tr>
                  </thead>
                  <tbody>
                    {(tab === "attempts" ? attempts : attempts.slice(0, 5)).map((e, i) => (
                      <tr key={`${e.at}-${i}`}>
                        <Td className="whitespace-nowrap">{formatAt(e.at)}</Td>
                        <Td className="font-mono text-[13px]">{e.product}</Td>
                        <Td><StatusText tone={OUTCOME_TONE(e.outcome)}>{e.outcome ? e.outcome.replace(/_/g, " ") : "Not recorded"}</StatusText></Td>
                        <Td align="right">{e.http_status ?? <span className="text-adm-muted">None</span>}</Td>
                      </tr>
                    ))}
                  </tbody>
                </WorkTable>
              )}
            </Panel>
          </div>
          <aside aria-label="Guidance">
            <Panel title="Status and guidance" titleSize="md" inset="sm">
              <div className="space-y-3">
                <StatusText tone={meta.tone}>{meta.label}</StatusText>
                <p className="text-[14px] font-semibold text-adm-ink">{card.verdict.headline}</p>
                <p className="text-[13px] leading-[18px] text-adm-muted">{card.verdict.detail}</p>
                <LinkButton to={providerDrillIn(spec, data.latestRunId)}>{spec.drillInLabel}</LinkButton>
              </div>
            </Panel>
          </aside>
        </div>
      </div>
    </ChildPageFrame>
  );
}
