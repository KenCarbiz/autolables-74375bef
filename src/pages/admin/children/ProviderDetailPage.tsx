import { useMemo } from "react";
import { MoreVertical } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";
import { HEALTH_META, describeAge } from "@/lib/admin/health";
import { PROVIDER_CARDS, providerDrillIn, aggregateEvents, type ProviderEventRow } from "@/lib/admin/integrations/providers";
import { ChildPageFrame } from "@/components/admin/v2/AdminShell";
import { EmptyState, KeyValueList, LinkButton, LocalTabs, MetricStrip, Panel, SkeletonBlock, StatusText, Td, Th, WorkTable } from "@/components/product";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ICON } from "@/components/admin/v2/primitives";
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
  const requested = params.get("tab");
  const tab = (["configuration", "attempts", "data", "quota"] as const).find((t) => t === requested) ?? "overview";
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
  const state = card.verdict.state;
  const configuration = state === "unknown" ? "Unknown" : state === "not_configured" ? "Not configured" : state === "disabled" ? "Disabled" : "Configured";
  const enabled = state === "unknown" ? "Unknown" : state === "disabled" || state === "not_applicable" ? "No" : "Yes";
  const ageH = card.lastSuccessAt ? (Date.now() - new Date(card.lastSuccessAt).getTime()) / 36e5 : null;
  const cacheState = ageH === null || card.ttlHours === null ? "Unknown" : ageH > card.ttlHours ? "Stale" : "Fresh";
  const cacheTone = cacheState === "Stale" ? "warning" : cacheState === "Fresh" ? "success" : "neutral";
  const lastOutcomeLabel = agg?.lastOutcome ? agg.lastOutcome.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "None";

  return (
    <ChildPageFrame
      section="integrations"
      crumbs={crumbs}
      title={spec.label}
      subtitle={spec.affectedOutput}
      actions={
        <>
          <LinkButton variant="primary" to={`${base}?tab=configuration`}>Edit configuration</LinkButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="More provider actions" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-adm-border bg-white text-adm-ink hover:bg-adm-workspace">
                <MoreVertical className={ICON.statusTight} aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[200px]">
              <DropdownMenuItem asChild><Link to={providerDrillIn(spec, data.latestRunId)}>{spec.drillInLabel}</Link></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
      tabs={
        <LocalTabs
          label="Provider sections"
          tabs={[
            { key: "overview", label: "Overview", to: base, active: tab === "overview" },
            { key: "configuration", label: "Configuration", to: `${base}?tab=configuration`, active: tab === "configuration" },
            { key: "attempts", label: "Attempts", to: `${base}?tab=attempts`, active: tab === "attempts" },
            { key: "data", label: "Data & Cache", to: `${base}?tab=data`, active: tab === "data" },
            { key: "quota", label: "Quota", to: `${base}?tab=quota`, active: tab === "quota" },
          ]}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <MetricStrip
          allBars
          label="Provider status"
          metrics={[
            { label: "Entitlement", value: ENTITLEMENT_LABEL[card.entitlement], tone: card.entitlement === "entitled" ? "success" : card.entitlement === "unknown" || card.entitlement === "not_applicable" ? "neutral" : "danger" },
            { label: "Configuration", value: configuration, tone: configuration === "Configured" ? "success" : "neutral" },
            { label: "Enabled", value: enabled, tone: enabled === "Yes" ? "success" : "neutral" },
            { label: "Last outcome", value: lastOutcomeLabel, tone: agg?.lastOutcome && agg.lastOutcome !== "ok" ? "danger" : "neutral" },
            { label: "Cache status", value: cacheState, tone: cacheTone, hint: card.lastSuccessAt ? `Last good ${formatAt(card.lastSuccessAt)}` : "No successful call" },
            { label: "Data freshness", value: card.lastSuccessAt ? describeAge(card.lastSuccessAt, Date.now()) : "No data", hint: freshness ? `Window ${freshness}` : "Window not set" },
          ]}
        />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_320px] items-stretch">
          {(tab === "overview" || tab === "configuration" || tab === "data") && (
            <Panel title={tab === "data" ? "Data and cache" : tab === "configuration" ? "Configuration" : "Capability details"} titleSize="md" inset="sm" className="h-full">
              <KeyValueList
                className="grid-cols-[124px_1fr] gap-x-3"
                rows={[
                  ...(tab === "data" ? [{ label: "Affects", value: spec.affectedOutput }] : []),
                  ...(tab === "overview" ? [{ label: "Output", value: spec.affectedOutput }] : []),
                  ...(tab !== "data" && spec.registryKeys.length ? [{ label: "Capabilities", value: spec.registryKeys.map((k) => { const w = k.replace(/_/g, " "); return w.charAt(0).toUpperCase() + w.slice(1); }).join(", ") }] : []),
                  ...(tab !== "data" ? [{ label: "Mode", value: spec.manual ? "Manual, on request" : "Automatic" }] : []),
                  { label: "Last attempt", value: card.lastAttemptAt ? formatAt(card.lastAttemptAt) : <span className="text-adm-muted">None recorded</span> },
                  { label: "Last success", value: card.lastSuccessAt ? formatAt(card.lastSuccessAt) : <span className="text-adm-muted">None recorded</span> },
                  ...(tab !== "configuration" ? [{ label: "Freshness window", value: freshness ?? "Not set" }, { label: "Cache status", value: cacheState }] : []),
                  ...(tab === "overview" && agg?.lastOutcome ? [{ label: "Last outcome", value: lastOutcomeLabel }] : []),
                ]}
              />
            </Panel>
          )}
          {(tab === "overview" || tab === "attempts") && (
            <Panel title="Recent attempts" titleSize="md" inset="sm" flush className="h-full" action={tab === "overview" ? <Link to={`${base}?tab=attempts`} className="text-[13px] font-medium text-adm-primary hover:underline">View all attempts</Link> : undefined}>
              <WorkTable caption="Recent provider calls">
                <thead>
                  <tr><Th>Date and time</Th><Th>Product</Th><Th>Outcome</Th><Th align="right">HTTP</Th></tr>
                </thead>
                <tbody>
                  {attempts.length === 0 ? (
                    <tr>
                      <Td colSpan={4} className="text-adm-muted">{data.events === null ? "The call ledger did not answer. Nothing here is current." : "No call to this provider is recorded in the last 30 days."}</Td>
                    </tr>
                  ) : (
                    (tab === "attempts" ? attempts : attempts.slice(0, 5)).map((e, i) => (
                      <tr key={`${e.at}-${i}`}>
                        <Td className="whitespace-nowrap">{formatAt(e.at)}</Td>
                        <Td className="font-mono text-[13px]">{e.product}</Td>
                        <Td><StatusText tone={OUTCOME_TONE(e.outcome)}>{e.outcome ? e.outcome.replace(/_/g, " ") : "Not recorded"}</StatusText></Td>
                        <Td align="right">{e.http_status ?? <span className="text-adm-muted">None</span>}</Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </WorkTable>
            </Panel>
          )}
          {(tab === "overview" || tab === "quota") && (
            <aside aria-label="Guidance" className={tab === "quota" ? "xl:col-span-3" : undefined}>
              <Panel title="Quota and guidance" titleSize="md" inset="sm" className="h-full">
                <div className="space-y-3">
                  <StatusText tone={meta.tone}>{meta.label}</StatusText>
                  <p className="text-[14px] font-semibold text-adm-ink">{card.verdict.headline}</p>
                  <p className="text-[13px] leading-[18px] text-adm-muted">{card.verdict.detail}</p>
                  {(cacheState === "Stale" || state === "unknown" || state === "not_configured") && (
                    <p className="rounded-md bg-adm-warning-bg px-3 py-2 text-[13px] leading-[18px] text-adm-ink">{cacheState === "Stale" ? "Data is currently stale. Review quota and back off before the next call to avoid rate-limited responses." : "No successful call is on record. Confirm the configuration before relying on this source."}</p>
                  )}
                  {card.attempts !== null && <p className="text-[13px] leading-[18px] text-adm-muted">{`${card.attempts} calls in the last 30 days${card.refusals ? `, ${card.refusals} refused` : ""}.`}</p>}
                </div>
              </Panel>
            </aside>
          )}
        </div>
      </div>
    </ChildPageFrame>
  );
}
