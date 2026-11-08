import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AdminButton, AdminLinkButton } from "@/components/admin/v2/primitives";
import { AdminIcon, AdminIconTile, DetailDrawer, SectionCard, StatusBadge, type AdminIconName } from "@/components/admin/v3/editor";
import { BUDGET_PROVIDERS } from "@/lib/admin/providerBudgets";
import { formatDateTime } from "@/lib/admin/integrations/format";
import { adminTabHref } from "@/lib/admin/sections";
import { cn } from "@/lib/utils";
import { Banner } from "../brand/feeds/bits";
import { FEATURE_STATUS_ORDER, featureCounts, tierColumns, type FeatureGroup, type FeatureRow, type FeatureStatus, type MetricModel, type PlanSummary, type UsageState } from "./planModel";

export const AUTOCURB_BILLING_URL = "https://autocurb.io/settings";
export const PROVIDER_USAGE_HREF = "/admin/integrations/inventory-network?view=marketcheck";

const LINK = "text-[14px] leading-[20px] font-semibold text-adm-primary hover:underline max-sm:inline-flex max-sm:items-center max-sm:min-h-[44px] rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary";

const STATUS_BADGE: Record<PlanSummary["tone"], "enabled" | "setup_required" | "failed" | "unknown" | "preview_only"> = { success: "enabled", info: "preview_only", warning: "setup_required", danger: "failed", neutral: "unknown" };

export function CurrentPlanCard({ plan, unreadable, loading, canManageBilling, canManageInvoices, timeZone, onCompare }: {
  plan: PlanSummary;
  unreadable: boolean;
  loading: boolean;
  canManageBilling: boolean;
  canManageInvoices: boolean;
  timeZone: string;
  onCompare: () => void;
}) {
  return (
    <SectionCard
      title="Current plan"
      icon="credit-card"
      description={<span className="max-sm:hidden">Plan, status and dates come from the entitlement record on this account.</span>}
    >
      {loading ? (
        <p role="status" className="text-[14px] text-adm-muted">Loading the plan.</p>
      ) : unreadable ? (
        <Banner tone="warning" title="The plan could not be read">The entitlement record did not load, so no plan, status or date is shown. This is not the same as having no plan.</Banner>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-start">
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <p data-plan-name className="text-[28px] leading-[34px] font-bold text-adm-ink">{plan.planName}</p>
                <StatusBadge state={STATUS_BADGE[plan.tone]} label={plan.statusLabel} />
              </div>
              <p className="mt-1 text-[14px] leading-[20px] text-adm-muted">{plan.headline}</p>
              {plan.billingName && <p className="mt-1 text-[14px] leading-[20px] text-adm-muted">Billing plan: <span className="text-adm-ink font-medium">{plan.billingName}</span></p>}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[14px] leading-[20px]">
              {plan.lines.map((l) => (<div key={l.label} className="contents"><dt className="text-adm-muted">{l.label}</dt><dd className="text-adm-ink font-medium">{l.value}</dd></div>))}
              <dt className="text-adm-muted">Billing source</dt><dd className="text-adm-ink font-medium">{plan.source}</dd>
              <dt className="text-adm-muted max-sm:hidden">Scope</dt><dd className="text-adm-ink font-medium max-sm:hidden">All rooftops in this account</dd>
              <dt className="text-adm-muted max-sm:hidden">Dates shown in</dt><dd className="text-adm-ink font-medium max-sm:hidden">{timeZone}</dd>
            </dl>
          </div>
          {plan.status === "past_due" && <Banner tone="warning" title="Payment is past due">{plan.headline}</Banner>}
          {plan.status === "paused" && <Banner tone="danger" title="This plan is suspended">{plan.headline} Features marked unavailable below are locked for that reason.</Banner>}
          {(plan.status === "canceled" || plan.status === "expired" || plan.status === "none") && <Banner tone="warning" title={plan.status === "none" ? "No plan on record" : "This plan is not active"}>{plan.headline}</Banner>}
          {plan.status === "trial" && <Banner tone="info" title="This account is on a trial">{plan.headline}</Banner>}
          <div className="flex items-center gap-x-4 gap-y-2 flex-wrap pt-1 max-sm:flex-col max-sm:items-stretch">
            <AdminButton variant="secondary" onClick={onCompare} className="max-sm:w-full justify-center min-h-[44px]">Compare plans</AdminButton>
            {canManageBilling ? (
              <a href={AUTOCURB_BILLING_URL} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-md bg-adm-primary text-white text-[14px] font-semibold hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary max-sm:w-full">
                Manage billing <AdminIcon name="external-link" size="inline" />
                <span className="sr-only">(opens Autocurb in a new tab)</span>
              </a>
            ) : (
              <p className="text-[14px] leading-[20px] text-adm-muted">Billing is changed by an owner or biller. Your role can view the plan only.</p>
            )}
            {canManageInvoices && <Link to="/invoices" className={LINK}>Installer invoices (Get Ready, not subscription billing)</Link>}
          </div>
        </>
      )}
    </SectionCard>
  );
}

const QUOTA_TEXT: Record<string, string> = { near: "Close to the monthly limit", over_soft: "Over the recommended monthly amount", blocked: "Monthly limit reached" };

export function MetricCards({ metrics, usage, plan, onOpen }: { metrics: MetricModel[]; usage: UsageState; plan: PlanSummary; onOpen: (key: string) => void }) {
  const ready = usage.kind === "ready" ? usage.snapshot : null;
  return (
    <SectionCard
      title="Usage this month"
      icon="chart"
      description={<span className="max-sm:hidden">What this account used under its plan. Provider quotas are separate and listed below.</span>}
    >
      <dl className="flex flex-wrap gap-x-5 gap-y-0.5 text-[14px] leading-[20px]" data-usage-meta>
        <div className="flex gap-1.5"><dt className="text-adm-muted">Period</dt><dd className="font-medium text-adm-ink">{ready ? `${ready.monthLabel} (${ready.timeZone})` : "Not available"}</dd></div>
        <div className="flex gap-1.5"><dt className="text-adm-muted">Scope</dt><dd className="font-medium text-adm-ink">{ready ? ready.scope : "All rooftops in this account"}</dd></div>
        <div className="flex gap-1.5"><dt className="text-adm-muted">Updated</dt><dd className="font-medium text-adm-ink">{ready ? formatDateTime(ready.updatedAt, { timeZone: ready.timeZone, withZone: true }) : "Not available"}</dd></div>
      </dl>
      {ready && !plan.accessActive && <Banner tone="neutral" title={`Shown for reference; the plan is ${plan.status === "paused" ? "suspended" : "not active"}.`} />}
      {usage.kind === "failed" && <Banner tone="warning" title="Usage is unavailable">{usage.reason}</Banner>}
      <ul className="grid grid-cols-2 lg:grid-cols-3 min-[1500px]:grid-cols-5 gap-2.5 sm:gap-3">
        {metrics.map((m) => (
          <li key={m.spec.key} data-metric={m.spec.key} data-metric-state={m.value === null ? "unavailable" : "value"} className="rounded-xl border border-adm-divider bg-adm-surface p-3 sm:p-4 flex flex-col min-w-0">
            <span className="flex items-center gap-3">
              <AdminIconTile name={m.spec.icon} className="max-sm:hidden" />
              <span className="text-[15px] leading-[20px] font-semibold text-adm-ink">{m.spec.label}</span>
            </span>
            {m.value === null ? (
              <>
                <p className="mt-2 text-[20px] leading-[28px] font-semibold text-adm-muted">{usage.kind === "loading" && !m.spec.unmetered ? "Loading" : "Unavailable"}</p>
                {m.reason && !(usage.kind === "loading" && !m.spec.unmetered) ? <p className="mt-1 text-[14px] leading-[20px] text-adm-muted">{m.reason}</p> : null}
              </>
            ) : (
              <p className="mt-2 text-[28px] leading-[34px] font-bold text-adm-ink tabular-nums">{m.value.toLocaleString()}</p>
            )}
            <div className="mt-2 text-[14px] leading-[20px] text-adm-muted">
              {m.limit.kind === "unknown" && <p>Plan limit: Unknown</p>}
              {m.limit.kind === "unlimited" && <p>Unlimited on this plan.</p>}
              {m.limit.kind === "undefined" && <p>No monthly limit is set for this activity.</p>}
              {m.limit.kind === "limited" && (
                <>
                  <p>Plan limit: {m.limit.hard.toLocaleString()} per month</p>
                  {m.percent !== null && (
                    <>
                      <span role="progressbar" aria-label={`${m.spec.label} against the monthly limit`} aria-valuemin={0} aria-valuemax={m.limit.hard} aria-valuenow={Math.min(m.value ?? 0, m.limit.hard)} aria-valuetext={`${m.value?.toLocaleString()} of ${m.limit.hard.toLocaleString()}`} className="mt-1.5 block h-2 rounded-full bg-adm-workspace overflow-hidden">
                        <span className={cn("block h-full rounded-full", m.quota === "blocked" ? "bg-adm-danger" : m.quota === "over_soft" || m.quota === "near" ? "bg-adm-warning" : "bg-adm-primary")} style={{ width: `${m.percent}%` }} />
                      </span>
                      <p className="mt-1">{m.percent}% of the limit used{m.quota && QUOTA_TEXT[m.quota] ? `. ${QUOTA_TEXT[m.quota]}.` : ""}</p>
                    </>
                  )}
                </>
              )}
            </div>
            <button type="button" onClick={() => onOpen(m.spec.key)} aria-label={`Details for ${m.spec.label}`} className={cn(LINK, "mt-auto pt-3 self-start inline-flex items-center gap-1")}>
              Details <AdminIcon name="chevron-right" size="inline" />
            </button>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

const limitText = (m: MetricModel): string => (m.limit.kind === "unknown" ? "Unknown" : m.limit.kind === "unlimited" ? "Unlimited" : m.limit.kind === "limited" ? `${m.limit.hard.toLocaleString()} per month` : "No limit set");

export function LimitsAndQuotas({ metrics }: { metrics: MetricModel[] }) {
  const providers = BUDGET_PROVIDERS.filter((p) => p.id !== "*");
  return (
    <SectionCard title="Plan limits and provider quotas" icon="sliders" description={<span className="max-sm:hidden">Plan limits are set by your tier. Paid providers meter and bill separately and are not part of those allowances.</span>}>
      <div className="grid gap-5 lg:grid-cols-2 items-start">
        <section aria-labelledby="pl-limits" className="min-w-0 max-sm:hidden">
          <h3 id="pl-limits" className="text-[16px] leading-[22px] font-semibold text-adm-ink pb-1 border-b border-adm-divider">App plan limits</h3>
          <ul className="divide-y divide-adm-divider">
            {metrics.map((m) => (
              <li key={m.spec.key} className="py-2.5 flex items-center justify-between gap-3 text-[14px] leading-[20px]">
                <span className="font-medium text-adm-ink">{m.spec.label}</span>
                <span className="text-adm-muted text-right">{limitText(m)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="pl-quotas" className="min-w-0">
          <h3 id="pl-quotas" className="text-[16px] leading-[22px] font-semibold text-adm-ink pb-1 border-b border-adm-divider">Provider quotas</h3>
          <ul className="divide-y divide-adm-divider">
            {providers.map((p) => {
              const label = p.label.replace(/ \(.*\)$/, "");
              return (
                <li key={p.id} className="py-2.5 flex items-center justify-between gap-3 text-[14px] leading-[20px]">
                  <span className="min-w-0"><span className="font-medium text-adm-ink">{label}</span> <span className="text-adm-muted max-sm:hidden">Metered by the provider</span></span>
                  <Link to={p.id === "marketcheck" ? PROVIDER_USAGE_HREF : adminTabHref("providers")} aria-label={`${p.id === "marketcheck" ? "Usage" : "Provider settings"} for ${label}`} className={cn(LINK, "whitespace-nowrap")}>{p.id === "marketcheck" ? "Usage and budgets" : "Providers"}</Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </SectionCard>
  );
}

const STATUS_COPY: Record<FeatureStatus, { label: string; blurb: string }> = {
  included: { label: "Included", blurb: "In your plan and ready to use." },
  setup_required: { label: "Setup required", blurb: "In your plan but a setting needs attention first." },
  requires_upgrade: { label: "Requires upgrade", blurb: "Not in your current plan." },
  unavailable: { label: "Unavailable", blurb: "Not offered while the plan is not active." },
  platform_only: { label: "Platform only", blurb: "For platform staff, not a dealer plan." },
};

const FeatureMark = ({ status }: { status: FeatureStatus }) =>
  status === "included" ? <AdminIcon name="check-circle" size="card" className="text-adm-success" label="Included" />
    : status === "setup_required" ? <AdminIcon name="wrench" size="card" className="text-adm-warning" label="Setup required" />
    : status === "requires_upgrade" ? <AdminIcon name="lock" size="card" className="text-adm-muted" label="Requires upgrade" />
    : status === "platform_only" ? <AdminIcon name="key" size="card" className="text-adm-muted" label="Platform only" />
    : <AdminIcon name="ban" size="card" className="text-adm-muted" label="Unavailable" />;

const FeatureLine = ({ row }: { row: FeatureRow }) => (
  <li data-feature={row.key} data-feature-status={row.status} className="py-2.5 sm:py-3 flex items-start gap-3">
    <span className="mt-0.5"><FeatureMark status={row.status} /></span>
    <div className="min-w-0 flex-1">
      <p className={cn("text-[15px] leading-[21px] font-semibold", row.status === "requires_upgrade" || row.status === "unavailable" || row.status === "platform_only" ? "text-adm-muted" : "text-adm-ink")}>{row.label}</p>
      {row.status !== "included" && <p className={cn("text-[14px] leading-[20px] text-adm-muted", row.status === "platform_only" && "max-sm:hidden")}>{row.detail}</p>}
    </div>
    {row.link && <Link to={row.link.to} aria-label={`${row.link.label} for ${row.label}`} className={cn(LINK, "whitespace-nowrap")}>{row.link.label}</Link>}
  </li>
);

export function FeatureGroups({ groups, planUnknown = false }: { groups: FeatureGroup[]; planUnknown?: boolean }) {
  const counts = featureCounts(groups);
  return (
    <SectionCard title="Features" icon="list" description={<span className="max-sm:hidden">Included, setup required, requires upgrade and unavailable are four different things.</span>}>
      <ul className="grid grid-cols-2 xl:grid-cols-5 gap-2 max-sm:hidden" aria-label="Feature status summary">
        {FEATURE_STATUS_ORDER.map((s) => (
          <li key={s} className="rounded-lg border border-adm-divider px-3 py-2.5 flex items-start gap-2.5">
            <FeatureMark status={s} />
            <span className="min-w-0">
              <span className="block text-[14px] leading-[20px] font-semibold text-adm-ink">{STATUS_COPY[s].label}: {counts[s]}</span>
              <span className="block text-[13px] leading-[18px] text-adm-muted max-sm:hidden">{s === "unavailable" && planUnknown ? "Plan could not be loaded." : STATUS_COPY[s].blurb}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.id} aria-labelledby={`fg-${g.id}`} className="min-w-0">
            <h3 id={`fg-${g.id}`} className="text-[16px] leading-[22px] font-semibold text-adm-ink pb-1 border-b border-adm-divider">{g.label}</h3>
            <ul className="grid lg:grid-cols-2 lg:gap-x-8 divide-y divide-adm-divider lg:divide-y-0 [&>li]:lg:border-b [&>li]:lg:border-adm-divider">{g.rows.map((r) => <FeatureLine key={r.key} row={r} />)}</ul>
          </section>
        ))}
      </div>
    </SectionCard>
  );
}

export function CompareDrawer({ open, onClose, current }: { open: boolean; onClose: () => void; current: PlanSummary }) {
  const cols = tierColumns();
  return (
    <DetailDrawer open={open} onClose={onClose} title="Compare plans" description="Each tier includes everything in the tier before it. Access is read from your plan, not from this table.">
      <ol className="space-y-4">
        {cols.map((c, i) => (
          <li key={c.tier} data-tier={c.tier} className={cn("rounded-xl border p-4 space-y-3", current.tier === c.tier && current.accessActive ? "border-adm-primary bg-adm-selected" : "border-adm-divider")}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-[18px] leading-[24px] font-semibold text-adm-ink">{c.label}</h3>
              {current.tier === c.tier && current.accessActive && <StatusBadge state="enabled" label="Your plan" />}
            </div>
            {c.billingPlans.length > 0 && <p className="text-[14px] leading-[20px] text-adm-muted">Billing plans on this tier: {c.billingPlans.join(", ")}</p>}
            <div>
              <p className="text-[14px] font-semibold text-adm-ink">{i === 0 ? "Includes" : `Everything in ${cols[i - 1].label}, plus`}</p>
              <ul className="mt-1 space-y-1">
                {c.features.map((f) => (<li key={f} className="flex items-start gap-2 text-[14px] leading-[20px]"><AdminIcon name="check" size="inline" className={cn("mt-0.5", current.tier === c.tier && current.accessActive ? "text-adm-success" : "text-adm-muted")} />{f}</li>))}
              </ul>
            </div>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[14px] leading-[20px] border-t border-adm-divider pt-3">
              {c.limits.map((l) => (<div key={l.metric} className="contents"><dt className="text-adm-muted">{l.metric}</dt><dd className="font-medium text-adm-ink text-right">{l.value}</dd></div>))}
            </dl>
          </li>
        ))}
      </ol>
      <p className="text-[14px] leading-[20px] text-adm-muted">Platform features are for platform staff and are not part of any dealer tier.</p>
      <a href="mailto:support@autolabels.io" className={LINK}>Contact support about a different plan</a>
    </DetailDrawer>
  );
}

export function MetricDrawer({ metric, usage, onClose }: { metric: MetricModel | null; usage: UsageState; onClose: () => void }) {
  const snap = usage.kind === "ready" ? usage.snapshot : null;
  const rows: Array<[string, ReactNode]> = metric
    ? [
        ["Reporting month", snap ? `${snap.monthLabel} (${snap.timeZone})` : "Not available"],
        ["Scope", snap ? snap.scope : "All rooftops in this account"],
        ["How it is counted", "The month follows the dealer time zone. Plan-limit enforcement uses the browser month, so counts near a month boundary can differ. A recorded quantity of zero counts as 0."],
        ["Count", metric.value === null ? "Unavailable" : metric.value.toLocaleString()],
        ["Recorded events", metric.reading ? metric.reading.events.toLocaleString() : "Unavailable"],
        ["Latest event", metric.reading ? (metric.reading.lastEventAt ? formatDateTime(metric.reading.lastEventAt, { timeZone: snap?.timeZone, withYear: true, withZone: true }) : "None this month") : "Unavailable"],
        ["Plan limit", metric.limit.kind === "unknown" ? "Unknown" : metric.limit.kind === "unlimited" ? "Unlimited" : metric.limit.kind === "limited" ? `${metric.limit.hard.toLocaleString()} per month (recommended ${metric.limit.soft.toLocaleString()})` : "No limit set"],
        ["Source", metric.spec.unmetered ? "No source records this activity yet" : "Usage events recorded by the app (autolabels_usage_events)"],
        ["Last updated", snap ? formatDateTime(snap.updatedAt, { timeZone: snap.timeZone, withYear: true, withZone: true }) : "Not available"],
      ]
    : [];
  return (
    <DetailDrawer open={!!metric} onClose={onClose} title={metric?.spec.label ?? "Metric"} description="How this number is counted.">
      {metric && (
        <>
          {metric.reason && metric.value === null && <Banner tone="neutral" title="No count to show">{metric.reason}</Banner>}
          <dl className="divide-y divide-adm-divider border border-adm-divider rounded-lg">
            {rows.map(([k, v]) => (<div key={k} className="px-3 py-3 grid sm:grid-cols-[150px_1fr] gap-x-4 gap-y-0.5 text-[14px] leading-[20px]"><dt className="text-adm-muted">{k}</dt><dd className="text-adm-ink font-medium break-words">{v}</dd></div>))}
          </dl>
          <AdminLinkButton to={adminTabHref("activity")} variant="secondary" className="max-sm:w-full justify-center">Open activity</AdminLinkButton>
        </>
      )}
    </DetailDrawer>
  );
}

export type { AdminIconName };
