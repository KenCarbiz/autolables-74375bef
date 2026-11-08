import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AdminLinkButton } from "@/components/admin/v2/primitives";
import { AdminIcon, AdminIconTile, SectionCard, StatusBadge, useIsNarrow, type AdminIconName } from "@/components/admin/v3/editor";
import { ATTENTION_STATUS_META, type AttentionItem } from "@/lib/admin/attention";
import { adminTabHref } from "@/lib/admin/sections";
import { countDisplay, type CountValue } from "@/lib/admin/health";
import { formatDateTime } from "@/lib/admin/integrations/format";
import { cn } from "@/lib/utils";
import { categoryIcon, exceptionsHref, overviewHref, shortcutCategories, shortcutHref, type FeedBannerModel, type PolicyConcept, type SetupProgress } from "./overviewModel";
import type { ActivityEvent } from "./useOverviewData";

const LINK_FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary";
const TEXT_LINK = cn("text-[14px] leading-[20px] font-semibold text-adm-primary hover:underline max-sm:inline-flex max-sm:items-center max-sm:min-h-[44px] rounded-sm", LINK_FOCUS);

export const plural = (n: number, one: string, many: string): string => `${n.toLocaleString()} ${n === 1 ? one : many}`;

const knownValue = (c: CountValue | null | undefined): number | null => (c && c.kind === "known" ? c.value : null);

const SummaryShell = ({ to, icon, label, value, unavailable, children, footer, loading }: { to: string; icon: AdminIconName; label: string; value: ReactNode; unavailable?: boolean; children?: ReactNode; footer: string; loading?: boolean }) => (
  <Link to={to} aria-busy={loading || undefined} className={cn("group flex flex-col h-full min-w-0 rounded-xl border border-adm-divider bg-adm-surface p-4 sm:p-5 hover:border-adm-primary/50 hover:shadow-sm", LINK_FOCUS)}>
    <span className="flex items-center gap-3">
      <AdminIconTile name={icon} />
      <span className="text-[15px] leading-[20px] font-semibold text-adm-ink">{label}</span>
    </span>
    <span data-summary-value className={cn("mt-3 block tabular-nums", unavailable ? "text-[22px] leading-[30px] font-semibold text-adm-muted" : "text-[30px] leading-[36px] font-bold text-adm-ink")}>{value}</span>
    <span className="mt-1 block text-[14px] leading-[20px] text-adm-muted">{children}</span>
    <span className="mt-auto pt-3 inline-flex items-center gap-1 text-[14px] leading-[20px] font-semibold text-adm-primary group-hover:underline">
      {footer}
      <AdminIcon name="chevron-right" size="inline" />
    </span>
  </Link>
);

export function SummaryCards({ inventory, progress, reviews, exceptions, loading }: {
  inventory: CountValue | null;
  progress: SetupProgress;
  reviews: CountValue | null;
  exceptions: { instances: CountValue; vehicles: CountValue } | null;
  loading: boolean;
}) {
  const inv = inventory;
  const rev = reviews;
  const exc = loading ? null : exceptions;
  const excVehicles = exc ? exc.vehicles : null;
  const excInstances = exc ? exc.instances : null;
  const vehiclesKnown = knownValue(excVehicles);
  const issuesKnown = knownValue(excInstances);
  const failedInv = inv?.kind === "failed" || !inv;
  const failedRev = rev?.kind === "failed" || !rev;
  const failedExc = !loading && (!exc || exc.instances.kind === "failed");
  return (
    <section aria-label="Summary" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 lg:gap-4">
      <SummaryShell to="/inventory" icon="car" label="Active inventory" loading={loading} unavailable={failedInv || loading} value={loading ? "Loading" : failedInv ? "Unavailable" : countDisplay(inv)} footer="Open inventory">
        {failedInv && !loading ? "The count could not be read. It is not zero." : "Vehicles not archived, across all rooftops in this account."}
      </SummaryShell>

      <Link to={overviewHref("setup")} className={cn("group flex flex-col h-full min-w-0 rounded-xl border border-adm-divider bg-adm-surface p-4 sm:p-5 hover:border-adm-primary/50 hover:shadow-sm", LINK_FOCUS)}>
        <span className="flex items-center gap-3">
          <AdminIconTile name="checklist" />
          <span className="text-[15px] leading-[20px] font-semibold text-adm-ink">Setup completion</span>
        </span>
        <span data-summary-value className="mt-3 block text-[30px] leading-[36px] font-bold text-adm-ink tabular-nums">{progress.done} of {progress.total}</span>
        <span
          role="progressbar"
          aria-label="Setup completion"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
          aria-valuetext={`${progress.done} of ${progress.total} setup steps complete`}
          className="mt-2 block h-2 rounded-full bg-adm-workspace overflow-hidden"
        >
          <span className={cn("block h-full rounded-full", progress.complete ? "bg-adm-success" : "bg-adm-primary")} style={{ width: `${progress.percent}%` }} />
        </span>
        <span className="mt-2 block text-[14px] leading-[20px] text-adm-muted">
          {progress.complete ? "Every setup step is complete." : `${progress.percent}% complete. ${plural(progress.total - progress.done, "step", "steps")} left.`}
        </span>
        <span className="mt-auto pt-3 inline-flex items-center gap-1 text-[14px] leading-[20px] font-semibold text-adm-primary group-hover:underline">
          {progress.complete ? "Review checklist" : "Finish setup"}
          <AdminIcon name="chevron-right" size="inline" />
        </span>
      </Link>

      <SummaryShell to="/dashboard/document-review" icon="clipboard-check" label="Policy reviews" loading={loading} unavailable={failedRev || loading} value={loading ? "Loading" : failedRev ? "Unavailable" : countDisplay(rev)} footer="Open review queue">
        {failedRev && !loading ? "The count could not be read. It is not zero." : "Open document review flags waiting on a person."}
      </SummaryShell>

      <SummaryShell
        to={exceptionsHref()}
        icon="alert"
        label="Exceptions"
        loading={loading}
        unavailable={failedExc || loading}
        value={loading ? "Loading" : failedExc ? "Unavailable" : `${vehiclesKnown?.toLocaleString() ?? "0"}${excVehicles?.kind === "known" && excVehicles.capped ? "+" : ""} ${vehiclesKnown === 1 ? "vehicle" : "vehicles"}`}
        footer="Open exceptions"
      >
        {failedExc && !loading ? "The queue could not be read. It is not zero." : issuesKnown !== null ? `${plural(issuesKnown, "open issue", "open issues")} in total. One vehicle can have several.` : ""}
      </SummaryShell>
    </section>
  );
}

const BANNER_TONE: Record<FeedBannerModel["tone"], string> = {
  warning: "bg-adm-warning-bg border-adm-warning/30",
  danger: "bg-adm-danger-bg border-adm-danger/30",
  neutral: "bg-adm-workspace border-adm-divider",
};

export function FeedBanner({ model, lastSuccessAt, timeZone }: { model: FeedBannerModel; lastSuccessAt: string | null; timeZone: string | null }) {
  return (
    <div role={model.tone === "danger" ? "alert" : "note"} data-feed-banner className={cn("rounded-xl border px-4 py-3 sm:px-5 flex flex-col sm:flex-row sm:items-center gap-3", BANNER_TONE[model.tone])}>
      <AdminIcon name="refresh" size="card" className={cn("hidden sm:block", model.tone === "danger" ? "text-adm-danger" : model.tone === "warning" ? "text-adm-warning" : "text-adm-muted")} />
      <div className="min-w-0 flex-1">
        <p className="text-[16px] leading-[22px] font-semibold text-adm-ink">{model.title}</p>
        <p className="mt-0.5 text-[14px] leading-[20px] text-adm-ink/80">
          {model.summary} {lastSuccessAt ? <>Last successful sync: <time dateTime={lastSuccessAt} className="font-medium">{formatDateTime(lastSuccessAt, { timeZone, withYear: true, withZone: true })}</time>.</> : "No successful sync is recorded."}
        </p>
      </div>
      <AdminLinkButton to={adminTabHref("inventory-feed")} variant="secondary" className="max-sm:w-full justify-center">Review sync</AdminLinkButton>
    </div>
  );
}

const SEVERITY_ICON: Record<AttentionItem["status"], AdminIconName> = { blocked: "ban", needs_review: "alert", review_required: "alert", incomplete: "info", unknown: "help" };
const SEVERITY_TONE: Record<"danger" | "warning" | "neutral" | "info", string> = {
  danger: "bg-adm-danger-bg text-adm-danger",
  warning: "bg-adm-warning-bg text-adm-warning",
  neutral: "bg-adm-workspace text-adm-ink border border-adm-divider",
  info: "bg-adm-selected text-adm-primary",
};

const SeverityChip = ({ status }: { status: AttentionItem["status"] }) => {
  const meta = ATTENTION_STATUS_META[status];
  return (
    <span data-severity={status} className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-[3px] text-[13px] leading-[18px] font-semibold whitespace-nowrap", SEVERITY_TONE[meta.tone])}>
      <AdminIcon name={SEVERITY_ICON[status]} size="inline" />
      {meta.label}
    </span>
  );
};

const countText = (c: AttentionItem["count"]): string => (c ? plural(c.value, c.unit, `${c.unit}s`) : "");

export function AttentionQueue({ items, loading, failed }: { items: AttentionItem[]; loading: boolean; failed: boolean }) {
  const narrow = useIsNarrow();
  return (
    <SectionCard title="What needs attention" description="Ranked by what a manager should act on first." icon="alert">
      {loading ? (
        <p role="status" className="text-[14px] text-adm-muted">Checking this account.</p>
      ) : items.length === 0 ? (
        <p className="text-[14px] leading-[20px] text-adm-muted">{failed ? "Attention items could not be checked, so none are shown. That is not the same as nothing needing attention." : "Nothing needs attention right now."}</p>
      ) : narrow ? (
        <ul aria-label="Attention queue" className="-my-2 divide-y divide-adm-divider">
          {items.map((item) => (
            <li key={item.id} className="py-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[15px] leading-[21px] font-semibold text-adm-ink">{item.title}</p>
                <SeverityChip status={item.status} />
              </div>
              <p className="text-[14px] leading-[20px] text-adm-muted">{item.detail}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[14px] leading-[20px]">
                {item.count && (<><dt className="text-adm-muted">Count</dt><dd>{countText(item.count)}</dd></>)}
                <dt className="text-adm-muted">Owner</dt><dd>{item.owner ?? "Not assigned"}</dd>
              </dl>
              <Link to={item.action.href} className={TEXT_LINK}>{item.action.label}</Link>
            </li>
          ))}
        </ul>
      ) : (
        <table className="w-full -my-1 text-left text-[14px] leading-[20px]">
          <caption className="sr-only">Attention queue</caption>
          <thead>
            <tr className="text-[13px] leading-[18px] text-adm-muted">
              <th scope="col" className="py-2 pr-3 font-semibold">Issue</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Severity</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Count</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Owner</th>
              <th scope="col" className="py-2 font-semibold">Next action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-adm-divider align-top">
                <td className="py-3 pr-3 max-w-[420px]">
                  <p className="font-semibold text-adm-ink">{item.title}</p>
                  <p className="mt-0.5 text-adm-muted">{item.detail}</p>
                </td>
                <td className="py-3 pr-3"><SeverityChip status={item.status} /></td>
                <td className="py-3 pr-3 whitespace-nowrap tabular-nums">{countText(item.count) || <span className="text-adm-muted">Not counted</span>}</td>
                <td className="py-3 pr-3">{item.owner ?? <span className="text-adm-muted">Not assigned</span>}</td>
                <td className="py-3 whitespace-nowrap"><Link to={item.action.href} className={TEXT_LINK}>{item.action.label}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

const CONCEPT_ICON: Record<PolicyConcept["key"], AdminIconName> = { listing_visibility: "eye", document_publication: "file", retail_readiness: "shield-check", routing: "route" };

export function PolicySummary({ concepts }: { concepts: PolicyConcept[] }) {
  return (
    <SectionCard title="Current policy" description="Four separate rules. None is inferred from another." icon="shield" actions={<Link to={overviewHref("policy")} className={TEXT_LINK}>Full detail</Link>}>
      <ul className="-my-2 divide-y divide-adm-divider">
        {concepts.map((c) => (
          <li key={c.key} className="py-3 flex items-start gap-3">
            <AdminIconTile name={CONCEPT_ICON[c.key]} tone="neutral" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-[18px] text-adm-muted">{c.title}</p>
              <p className="text-[15px] leading-[21px] font-semibold text-adm-ink">{c.value}</p>
              <div className="mt-1 flex items-center gap-3 flex-wrap">
                <StatusBadge state={c.state === "unknown" ? "unknown" : c.state === "attention" ? "setup_required" : c.stateLabel === "Differs by class" ? "overridden" : "enabled"} label={c.stateLabel} />
                <Link to={`${overviewHref("policy")}&concept=${c.key}`} aria-label={`View details: ${c.title}`} className={TEXT_LINK}>View details</Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

export function SettingsShortcuts({ visibleIds }: { visibleIds: readonly string[] | null }) {
  const categories = shortcutCategories(visibleIds);
  return (
    <SectionCard title="Administration settings" description={`${categories.length} settings areas.`} icon="settings">
      <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-2 min-[1500px]:grid-cols-3 gap-2">
        {categories.map((c) => (
          <li key={c.id}>
            <Link to={shortcutHref(c)} className={cn("flex items-center gap-3 rounded-lg border border-adm-divider px-3 py-3 min-h-[64px] hover:border-adm-primary/50 hover:bg-adm-workspace", LINK_FOCUS)}>
              <AdminIconTile name={categoryIcon(c)} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] leading-[20px] font-semibold text-adm-ink">{c.label}</span>
                <span className="block text-[13px] leading-[18px] text-adm-muted">{c.description}</span>
              </span>
              <AdminIcon name="chevron-right" className="text-adm-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

export const compactAge = (iso: string, now: number): string => {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return formatDateTime(iso);
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
};

const TONE_ICON: Record<ActivityEvent["tone"], AdminIconName> = { warning: "alert", success: "check-circle", neutral: "activity" };

export function RecentActivity({ events, loading, now }: { events: ActivityEvent[] | null; loading: boolean; now: number }) {
  return (
    <SectionCard title="Recent activity" description="Administration changes and system events." icon="history" actions={<Link to={overviewHref("activity")} className={TEXT_LINK}>View all</Link>}>
      {loading ? (
        <p role="status" className="text-[14px] text-adm-muted">Loading recent activity.</p>
      ) : events === null ? (
        <p className="text-[14px] leading-[20px] text-adm-muted">Activity is unavailable right now. That is not the same as no activity.</p>
      ) : events.length === 0 ? (
        <p className="text-[14px] leading-[20px] text-adm-muted">No administration activity has been recorded yet.</p>
      ) : (
        <ul className="-my-2 divide-y divide-adm-divider">
          {events.slice(0, 5).map((e) => (
            <li key={e.id} className="py-3 flex items-start gap-3">
              <AdminIcon name={TONE_ICON[e.tone]} size="card" className={cn("mt-0.5", e.tone === "warning" ? "text-adm-warning" : e.tone === "success" ? "text-adm-success" : "text-adm-muted")} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] leading-[20px] font-semibold text-adm-ink break-words">{e.action}</p>
                <p className="text-[13px] leading-[18px] text-adm-muted break-words">{e.kind} by {e.actor}</p>
              </div>
              <time dateTime={e.at} className="text-[13px] leading-[18px] text-adm-muted whitespace-nowrap">{compactAge(e.at, now)}</time>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
