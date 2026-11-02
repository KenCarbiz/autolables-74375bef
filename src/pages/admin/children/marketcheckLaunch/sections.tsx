import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button, EmptyState, InlineNote, KeyValueList, Panel, StatusText, Td, Th, WorkTable } from "@/components/product";
import { ICON } from "@/components/admin/v2/primitives";
import type { Consumption, LaunchEvent, LaunchStatus, ReadinessCheck } from "@/lib/marketcheckLaunch/types";
import {
  CHECK_STATUS_LABEL, CHECK_STATUS_TONE, STATE_TONE, SQL_FALLBACK, isAttested, mandatoryProgress, num, periodSourceLabel, stateLabel, usd, when,
} from "@/lib/marketcheckLaunch/viewModel";

export const Section = ({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) => (
  <Panel>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[16px] leading-6 font-semibold text-adm-ink">{title}</h2>
        {description && <p className="mt-1 text-[13px] leading-5 text-adm-muted">{description}</p>}
      </div>
      {action}
    </div>
    {children}
  </Panel>
);

const Json = ({ value }: { value: unknown }) => (
  <pre className="max-h-64 overflow-auto rounded-[4px] bg-adm-workspace p-3 text-[12px] leading-5 text-adm-ink">{JSON.stringify(value, null, 2)}</pre>
);

function CheckRow({ check, onRecord }: { check: ReadinessCheck; onRecord: (c: ReadinessCheck) => void }) {
  const [open, setOpen] = useState(false);
  const detail = (check.detail ?? {}) as Record<string, unknown>;
  const evidenceRef = typeof detail.evidence_ref === "string" ? detail.evidence_ref : null;
  const verifiedAt = typeof detail.verified_at === "string" ? detail.verified_at : null;
  const Chevron = open ? ChevronDown : ChevronRight;
  const hasDetail = Object.keys(detail).length > 0;
  return (
    <li className="border-b border-adm-border py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="inline-flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Chevron className={ICON.chevron} aria-hidden="true" />
          <span className="text-[14px] font-semibold text-adm-ink">{check.label}</span>
          {!check.mandatory && <span className="text-[12px] text-adm-muted">Optional</span>}
        </button>
        <StatusText tone={CHECK_STATUS_TONE[check.status]}>{CHECK_STATUS_LABEL[check.status]}</StatusText>
        {isAttested(check.key) && <Button size="sm" variant="outline" onClick={() => onRecord(check)}>Record evidence</Button>}
      </div>
      <p className="mt-1 pl-7 text-[13px] text-adm-muted">{check.summary ?? "No summary reported"}</p>
      {open && (
        <div className="mt-2 space-y-2 pl-7">
          {evidenceRef && <p className="text-[13px] text-adm-ink">Evidence: {evidenceRef}</p>}
          {verifiedAt && <p className="text-[13px] text-adm-ink">Verified: {when(verifiedAt)}</p>}
          {hasDetail ? <Json value={detail} /> : <p className="text-[13px] text-adm-muted">No diagnostic detail reported.</p>}
        </div>
      )}
    </li>
  );
}

export function ReadinessSection({ status, onRecord }: { status: LaunchStatus; onRecord: (c: ReadinessCheck) => void }) {
  const r = status.readiness;
  const p = mandatoryProgress(r?.checks);
  return (
    <Section title="Release readiness" description={r ? `${p.passed} of ${p.total} mandatory checks passed. Evaluated ${when(r.evaluated_at)}.` : undefined}>
      {!r || r.checks.length === 0 ? <EmptyState title="Readiness checks unavailable" detail="Unknown. No checks were returned." compact /> : (
        <ul>{r.checks.map((c) => <CheckRow key={c.key} check={c} onRecord={onRecord} />)}</ul>
      )}
    </Section>
  );
}

const Pairs = ({ title, data }: { title: string; data: Record<string, number> }) => {
  const entries = Object.entries(data);
  return (
    <div>
      <h3 className="mb-1 text-[13px] font-semibold text-adm-ink">{title}</h3>
      {entries.length === 0 ? <p className="text-[13px] text-adm-muted">None this period</p> : (
        <ul className="text-[13px] text-adm-ink">{entries.map(([k, v]) => <li key={k}>{k.replace(/_/g, " ")}: {num(v)}</li>)}</ul>
      )}
    </div>
  );
};

export function ConsumptionSection({ c, onRecord }: { c: Consumption | null; onRecord: () => void }) {
  const action = <Button size="sm" variant="outline" onClick={onRecord}>Record provider figures</Button>;
  if (!c) return <Section title="Account consumption" action={action}><EmptyState title="Consumption unavailable" detail="Unknown. No figures were returned." compact /></Section>;
  const pr = c.provider_reported;
  const notReported = "Not reported by provider";
  return (
    <Section title="Account consumption" description={`Period ${when(c.period_start)} to ${when(c.period_end)}. Source: ${periodSourceLabel(c.period_source)}.`} action={action}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-1 text-[13px] font-semibold text-adm-ink">Provider-reported</h3>
          <KeyValueList divided rows={[
            { label: "Monthly limit", value: pr?.limit != null ? num(pr.limit) : notReported },
            { label: "Used", value: pr?.used != null ? num(pr.used) : notReported },
            { label: "Remaining (provider-reported)", value: pr?.remaining != null ? num(pr.remaining) : notReported },
            { label: "Provider reset", value: pr?.reset_at ? when(pr.reset_at) : notReported },
            { label: "Reported at", value: pr?.reported_at ? when(pr.reported_at) : notReported },
          ]} />
        </div>
        <div>
          <h3 className="mb-1 text-[13px] font-semibold text-adm-ink">Local ledger</h3>
          <KeyValueList divided rows={[
            { label: "Configured quota", value: num(c.quota) },
            { label: "Calls this month", value: num(c.calls_this_month) },
            { label: "Remaining (local ledger)", value: num(c.remaining_local) },
            { label: "Protected reserve", value: num(c.protected_reserve) },
            { label: "Reserved or uncertain", value: `${num(c.local_reserved)} reserved, ${num(c.local_uncertain)} uncertain` },
            { label: "Dollar cap", value: c.usd_cap == null ? "No dollar cap" : usd(c.usd_cap) },
            { label: "Estimated (list price) spent", value: usd(c.usd_spent_estimated) },
            { label: "Estimated (list price) committed", value: usd(c.usd_committed_estimated) },
          ]} />
        </div>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Pairs title="Calls by product" data={c.per_product ?? {}} />
        <div>
          <Pairs title={`Denied requests: ${num(c.denied_this_month)}`} data={c.denials_by_reason ?? {}} />
        </div>
      </div>
      <div className="mt-6">
        <h3 className="mb-1 text-[13px] font-semibold text-adm-ink">Store allocation</h3>
        {c.per_store.length === 0 ? <p className="text-[13px] text-adm-muted">No active stores</p> : (
          <WorkTable caption="Store allocation" minWidth={560}>
            <thead><tr><Th>Store</Th><Th>Mode</Th><Th align="right">Daily limit</Th><Th align="right">Monthly cap</Th><Th align="right">Used this month</Th></tr></thead>
            <tbody>
              {c.per_store.map((s) => (
                <tr key={s.store_id}><Td>{s.name}</Td><Td>{s.mode ?? "No policy"}</Td><Td align="right">{num(s.daily_limit)}</Td><Td align="right">{num(s.monthly_cap)}</Td><Td align="right">{num(s.used_month)}</Td></tr>
              ))}
            </tbody>
          </WorkTable>
        )}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <KeyValueList divided rows={[
          { label: "Last successful call", value: when(c.last_success) },
          { label: "Last provider error", value: c.last_error ? `${when(c.last_error.at)}, ${c.last_error.outcome.replace(/_/g, " ")}${c.last_error.http_status ? ` (HTTP ${c.last_error.http_status})` : ""}${c.last_error.caller ? `, ${c.last_error.caller}` : ""}` : "None recorded" },
        ]} />
        <div>
          <h3 className="mb-1 text-[13px] font-semibold text-adm-ink">MarketCheck cron jobs (active = next approved run)</h3>
          {c.marketcheck_cron.length === 0 ? <p className="text-[13px] text-adm-muted">No MarketCheck cron jobs</p> : (
            <ul className="text-[13px] text-adm-ink">
              {c.marketcheck_cron.map((j) => <li key={String(j.jobid)}>{j.jobname}: <code>{j.schedule}</code>, {j.active ? "active" : "parked"}</li>)}
            </ul>
          )}
        </div>
      </div>
    </Section>
  );
}

export function StateSection({ status, onApprove }: { status: LaunchStatus; onApprove: () => void }) {
  const p = status.plan;
  const ctl = status.control ?? {};
  const activeNames = (p?.rollout_stores ?? []).filter((s) => s.active).map((s) => s.name);
  return (
    <Section title="Launch state">
      <div className="flex flex-wrap items-center gap-3">
        <StatusText tone={STATE_TONE[status.state]} className="!text-[22px] !leading-8 font-bold tracking-wide">{stateLabel(status.state)}</StatusText>
      </div>
      <div className="mt-3">
        <KeyValueList divided rows={[
          ...(ctl.paused_reason ? [{ label: "Paused reason", value: String(ctl.paused_reason).replace(/_/g, " ") }] : []),
          ...(ctl.stop_reason ? [{ label: "Stop reason", value: String(ctl.stop_reason) }] : []),
          { label: "Activated by", value: ctl.activated_by ? String(ctl.activated_by) : "Not activated" },
          { label: "Activated at", value: when(ctl.activated_at as string | null | undefined) },
          { label: "Canary start", value: when(ctl.canary_started_at as string | null | undefined) },
          { label: "Active stores", value: activeNames.length ? activeNames.join(", ") : "None" },
        ]} />
      </div>
      {p ? (
        <div className="mt-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-[14px] font-semibold text-adm-ink">Plan v{p.version}{p.title ? `: ${p.title}` : ""} ({p.status})</h3>
            {p.status === "draft" && <Button size="sm" variant="outline" onClick={onApprove}>Approve plan</Button>}
          </div>
          <PlanSummary plan={p} />
        </div>
      ) : <div className="mt-4"><InlineNote tone="warning" title="No launch plan found" /></div>}
    </Section>
  );
}

export function PlanSummary({ plan: p }: { plan: NonNullable<LaunchStatus["plan"]> }) {
  const list = (a: string[] | null | undefined) => (a && a.length ? a.join(", ") : "None");
  return (
    <>
      <KeyValueList divided rows={[
        { label: "Canary store", value: p.canary_store_name ?? "Unknown" },
        { label: "Canary max calls", value: num(p.canary_max_calls) },
        { label: "Canary window", value: `${num(p.canary_window_hours)} hours` },
        { label: "Hourly call ceiling", value: num(p.hourly_call_ceiling) },
        { label: "Daily call ceiling", value: num(p.daily_call_ceiling) },
        { label: "Error tripwire", value: `${num(p.error_tripwire_per_hour)} per hour` },
        { label: "Uncertain tripwire", value: `${num(p.uncertain_tripwire_per_hour)} per hour` },
        { label: "API products", value: list(p.products) },
        { label: "Allowed callers", value: list(p.allowed_callers) },
        { label: "Cron jobs", value: list(p.cron_jobs) },
      ]} />
      <h4 className="mt-4 mb-1 text-[13px] font-semibold text-adm-ink">Rollout order</h4>
      {p.rollout_stores.length === 0 ? <p className="text-[13px] text-adm-muted">No rollout stores</p> : (
        <ol className="text-[13px] text-adm-ink">
          {p.rollout_stores.map((s) => (
            <li key={s.store_id} className="py-0.5">
              {s.order}. {s.name}: {s.active ? "active" : "not started"}, {s.policy_ready ? "policy ready" : "policy not ready"}, wait {num(s.min_hours_after_previous)} hours after previous
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

export function AuditSection({ events }: { events: LaunchEvent[] }) {
  return (
    <Section title="Audit" description="The last 25 launch control events.">
      {events.length === 0 ? <EmptyState title="No events yet" compact /> : (
        <WorkTable caption="Launch control events" minWidth={720}>
          <thead><tr><Th>Time</Th><Th>Actor</Th><Th>Action</Th><Th>Transition</Th><Th>Result</Th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={String(e.id)}>
                <Td>{when(e.at)}</Td>
                <Td>{e.actor_kind ?? "unknown"}{e.actor ? ` ${String(e.actor).slice(0, 8)}` : ""}</Td>
                <Td>{e.action.replace(/_/g, " ")}</Td>
                <Td>{e.from_state || e.to_state ? `${e.from_state ?? "none"} to ${e.to_state ?? "none"}` : "No change"}</Td>
                <Td>{e.result ?? ""}</Td>
              </tr>
            ))}
          </tbody>
        </WorkTable>
      )}
    </Section>
  );
}

export function SqlFallback() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(SQL_FALLBACK); setCopied(true); } catch { setCopied(false); }
  };
  return (
    <div className="mt-4">
      <p className="mb-1 text-[13px] text-adm-muted">SQL editor fallback. This path works without this screen.</p>
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto rounded-[4px] bg-adm-workspace p-3 text-[12px] leading-5 text-adm-ink"><code>{SQL_FALLBACK}</code></pre>
        <Button size="sm" variant="secondary" onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
      </div>
    </div>
  );
}
