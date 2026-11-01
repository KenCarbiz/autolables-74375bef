import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { retryJob, type InventoryFeedJob } from "@/lib/inventoryNetwork/api";
import { useAdminNow } from "@/lib/admin/dataSource";
import { Al97Frame, Banner, Card, ChipView, Flow, Glyph, KeyVals, Metrics, Savebar, useFixtureCopy, type ScopePicker } from "./al97ui";
import { recordLabel, useLedgers } from "./ledgers";
import type { Chip } from "./overviewModel";
import { fileName, humanize, mcModeLabel, plural, useAct, useNet } from "./shared";

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const clock = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(Date.parse(iso)) : "Not recorded");
const shortAge = (span: number) => {
  const m = Math.max(0, Math.floor(span / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} d`;
};
const TRIGGER_WORD: Record<InventoryFeedJob["trigger"], string> = { webhook: "webhook", reconcile: "reconciliation", manual: "manual", retry: "retry" };
const RECEIVED: Record<InventoryFeedJob["trigger"], string> = { webhook: "Webhook accepted and queued", reconcile: "Found by reconciliation and queued", manual: "Queued by an operator", retry: "Queued as a retry" };
const RETRYABLE = new Set(["failed", "dead", "cancelled"]);

export default function JobDetail({ scope, jobId, children }: { scope?: ScopePicker; jobId: string; children?: ReactNode }) {
  const { stores, href } = useNet();
  const now = useAdminNow();
  const t = useFixtureCopy();
  const { act, busy } = useAct();
  const [armed, setArmed] = useState(false);
  const base = useLedgers({ jobs: true, snapshots: true });
  const job = base.jobs?.find((j) => j.id === jobId) ?? null;
  const snapshot = job ? base.snapshots?.filter((s) => s.job_id === job.id).sort((a, b) => ms(b.created_at) - ms(a.created_at))[0] ?? null : null;
  const storeId = snapshot?.store_id ?? (job ? base.snapshots?.find((s) => s.path === job.path && s.store_id)?.store_id : null) ?? null;
  const store = stores.find((s) => s.store.id === storeId) ?? null;
  const l = useLedgers({ runs: true, usageStoreId: storeId, previewStoreId: job?.status === "succeeded" || job?.status === "partial" ? storeId : null });
  const caption = t("caption", "");

  if (!job) {
    const detail = base.jobs === null ? "The job ledger has not been read yet, or the read failed." : "That job is not in the most recent 100 import jobs.";
    return (
      <Al97Frame crumb="Import job" title="Import job" subtitle={detail} scope={scope} main={<div className="work"><Banner tone="blue" icon="info" title="Job not found" detail={detail} /></div>}>
        {children}
      </Al97Frame>
    );
  }

  const label = recordLabel("IMP", job.id);
  const run = l.runs?.find((r) => r.id === job.run_id) ?? null;
  const since = ms(job.created_at);
  const until = job.finished_at ? ms(job.finished_at) : now;
  const paid = l.usage === null ? null : l.usage.filter((u) => u.outcome === "admitted" && ms(u.at) >= since && ms(u.at) <= until).length;
  const paidStat = { label: "Paid provider calls", value: paid === null ? "Unknown" : String(paid), icon: "shield" as const, known: paid !== null };
  const subtitleBase = `${store?.store.display_name ?? "Store not linked"} · ${fileName(job.path)}`;
  const completed = job.status === "succeeded" || job.status === "partial";

  if (completed) {
    const snapLabel = snapshot ? recordLabel("SNAP", snapshot.id) : "No snapshot";
    const visible = l.preview && l.preview.enabled ? l.preview.total : null;
    const mode = mcModeLabel(store?.policy ?? null);
    const replays = (base.jobs ?? []).filter((j) => j.id !== job.id && j.path === job.path && j.status === "skipped" && ms(j.created_at) > since).length;
    const snapChip: Chip = !snapshot ? { label: "Not recorded", tone: "neutral" } : snapshot.status === "applied" ? { label: "Applied", tone: "green" } : snapshot.status === "held" ? { label: "Held", tone: "amber" } : { label: humanize(snapshot.status), tone: "neutral" };
    const main = (
      <div className="work">
        <Banner tone="blue" icon="info" title={snapshot?.status === "applied" ? "Snapshot applied successfully" : "Job completed"} detail={t("job.bannerDetail", snapshot ? `Job ${label} committed snapshot ${snapLabel}.` : `Job ${label} finished without a linked snapshot.`)} />
        <Metrics label="Import outcome" items={[
          { label: "Rows validated", value: snapshot ? String(snapshot.valid_count) : "Unknown", sub: snapshot ? `${snapshot.invalid_count} invalid · ${plural(snapshot.duplicate_count, "duplicate")}` : "No snapshot linked", icon: "file", known: !!snapshot },
          { label: "Store records applied", value: snapshot ? String(snapshot.status === "applied" ? snapshot.valid_count : 0) : "Unknown", sub: "Single snapshot transaction", icon: "database", known: !!snapshot },
          { label: "Customer visible", value: visible === null ? "Unknown" : String(visible), sub: "Separate visibility rules", icon: "car", known: visible !== null },
          { ...paidStat, label: "Paid enrichment calls", sub: mode.label === "Feed only" ? "Feed-only store" : `${mode.label} store` },
        ]} />
        <div><Card id="inv-exec-h" title="Execution evidence" description="Completed work is evidenced independently of cron request delivery.">
          <Flow steps={[
            { no: 1, title: "Receipt", chip: { label: "Received", tone: "green" }, note: run?.content_sha256 ? "Exact file version" : "File version not recorded" },
            { no: 2, title: "Worker", chip: job.status === "partial" ? { label: "Partly completed", tone: "amber" } : { label: "Completed", tone: "green" }, note: "Job claim + outcome" },
            { no: 3, title: "Snapshot", chip: snapChip, note: snapshot?.applied_at ? "Transaction committed" : "No commit recorded" },
            { no: 4, title: "Customer visibility", chip: visible === null ? { label: "Unknown", tone: "neutral" } : { label: `${visible} visible`, tone: "blue" }, note: "Eligibility resolver" },
          ]} />
        </Card></div>
        <div className="split">
          <div><div><Card id="inv-result-h" title="Recorded result">
            <KeyVals rows={[
              ["Job / snapshot", `${label} / ${snapLabel}`],
              ["File hash", t("job.hash", run?.content_sha256 ? `sha256: ${run.content_sha256.slice(0, 12)}…` : "Not recorded")],
              ["Started / finished", t("job.times", `${clock(job.started_at)} / ${clock(job.finished_at)}`)],
              ["Replayed imports", replays === 0 ? "No additional writes" : `${plural(replays, "replay")} skipped, no additional writes`],
              ["Held rows", t("job.held", snapshot && snapshot.invalid_count > 0 ? `${snapshot.invalid_count} held, reviewable with reasons` : "None held")],
            ]} />
          </Card></div></div>
          <div><div><Card id="inv-unchanged-h" title="What did not change">
            <KeyVals rows={[["Paid-provider policy", mode.label], ["Retirement automation", "Unchanged"], ["Signed records", "Preserved"], ["Store pauses", "Other stores retained"], ["Price promotion", "Separate policy"]]} />
          </Card></div></div>
        </div>
        <Savebar title="Successful import is not universal publication" detail="Show the exact business outcome and any held records." action={snapshot ? <Link className="btn" to={href("runs", { panel: "timeline", q: snapshot.id })}>View snapshot</Link> : <button type="button" className="btn" disabled title="No snapshot is linked to this job.">View snapshot</button>} />
      </div>
    );
    return <Al97Frame crumb="Import job / completed" title="Import job / completed" subtitle={`Successful worker state${caption}`} scope={scope} storeName={store?.store.display_name ?? null} main={main}>{children}</Al97Frame>;
  }

  const due = ms(job.next_attempt_at) <= now;
  const banner = job.status === "queued"
    ? due
      ? job.attempts === 0
        ? { tone: "amber" as const, icon: "warning" as const, title: "Queued beyond the processing target", detail: "No attempt recorded. Preserve the current inventory while the worker is investigated." }
        : { tone: "amber" as const, icon: "warning" as const, title: "Retry is past due", detail: `${plural(job.attempts, "attempt")} recorded.${job.last_error ? ` Last error: ${humanize(job.last_error)}.` : ""}` }
      : { tone: "blue" as const, icon: "info" as const, title: "Waiting for its scheduled start", detail: `Eligible at ${clock(job.next_attempt_at)}. Current inventory is unchanged.` }
    : job.status === "running"
      ? { tone: "blue" as const, icon: "info" as const, title: "Worker is processing this file", detail: `Claimed at ${clock(job.started_at)}. Current inventory is unchanged until a valid snapshot commits.` }
      : job.status === "failed" || job.status === "dead"
        ? { tone: "red" as const, icon: "warning" as const, title: "Import failed", detail: job.last_error ? humanize(job.last_error) : "The job ledger recorded no error text." }
        : { tone: "blue" as const, icon: "info" as const, title: `Job ${humanize(job.status)}`, detail: "No snapshot was committed by this job." };
  const prev = (base.jobs ?? []).filter((j) => j.id !== job.id && j.path === job.path && (j.status === "succeeded" || j.status === "partial") && ms(j.created_at) < since).sort((a, b) => ms(b.created_at) - ms(a.created_at))[0];
  const schedule: Chip = l.workerSchedule === "found" ? { label: "Scheduled", tone: "green" } : l.workerSchedule === "not_found" ? { label: "Not found", tone: "amber" } : { label: "Not verified", tone: "amber" };
  const retryable = RETRYABLE.has(job.status);
  const retryReason = retryable ? undefined : "Only failed, dead or cancelled jobs can be retried.";

  const main = (
    <div className="work">
      <Banner {...banner} />
      <Metrics label="Job facts" items={[
        { label: "Queue age", value: job.status === "queued" ? shortAge(now - since) : job.started_at ? shortAge(ms(job.started_at) - since) : "Unknown", sub: job.status === "queued" ? "Target: configurable" : "Wait before claim", icon: "clock" },
        { label: "Attempts", value: `${job.attempts} / ${job.max_attempts}`, sub: job.attempts === 0 ? "No retry executed" : job.attempts === 1 ? "First attempt" : `${plural(job.attempts - 1, "retry", "retries")}`, icon: "retry" },
        { label: "Current inventory", value: store ? String(store.counts.present) : "Unknown", sub: store ? "Previous snapshot retained" : "Store not linked", icon: "car", known: !!store },
        { ...paidStat, sub: job.provider === "filescom" ? "Files.com ingest path" : humanize(job.provider) },
      ]} />
      <div className="split">
        <div><div><Card id="inv-tl-h" title="Run timeline">
          <ol className="timeline">
            <li><b>{clock(job.created_at)} · File received</b><small>{RECEIVED[job.trigger]}</small></li>
            <li className={due ? undefined : "waiting"}><b>{clock(job.next_attempt_at)} · Eligible to start</b><small>{due ? "Scheduled start time reached" : "Waiting for the scheduled start"}</small></li>
            {job.started_at
              ? <li><b>{clock(job.started_at)} · Claimed by worker</b><small>{`Attempt ${job.attempts} started`}</small></li>
              : <li className="waiting"><b>Waiting for worker claim</b><small>No lock token or heartbeat recorded</small></li>}
            {job.finished_at
              ? <li><b>{clock(job.finished_at)} · {humanize(job.status)}</b><small>{job.last_error ? humanize(job.last_error) : "No snapshot committed"}</small></li>
              : <li className="muted"><b>Validation {"→"} Apply {"→"} Visibility</b><small>{job.started_at ? "In progress" : "Not started for this arrival"}</small></li>}
          </ol>
        </Card></div></div>
        <div><div><Card id="inv-worker-h" title="Worker diagnosis">
          <KeyVals rows={[
            ["Worker schedule", <ChipView key="s" chip={schedule} />],
            ["Worker heartbeat", l.heartbeatAt ? clock(l.heartbeatAt) : "Not recorded"],
            ["Last completed run", prev ? `Earlier ${TRIGGER_WORD[prev.trigger]} import` : "None recorded"],
            ["Last error", job.last_error ? humanize(job.last_error) : job.attempts === 0 ? "None · not attempted" : "None recorded"],
          ]} />
          <Link className="btn" to="/admin/integrations/files-com"><Glyph name="settings" />Review worker setup</Link>
        </Card></div></div>
      </div>
      <div><Card id="inv-recovery-h" title="Recovery rules">
        <KeyVals rows={[["Idempotency", "Same file version is applied once"], ["Current listings", "Preserved until a valid snapshot commits"], ["Retries", "Bounded with backoff; never a retry loop"], ["Operator action", "Recorded with reason and scope"]]} />
      </Card></div>
      <Savebar
        title={retryable ? "Bounded retry" : "Investigation only"}
        detail={retryable ? "Retry queues one more attempt within the job's limit and is recorded." : "Retry does not fix a missing worker schedule."}
        action={armed ? (
          <>
            <button type="button" className="btn primary" disabled={busy} onClick={async () => { setArmed(false); await act(() => retryJob(job.id), "Retry queued"); }}>Confirm retry</button>
            <button type="button" className="btn" onClick={() => setArmed(false)}>Cancel</button>
          </>
        ) : <button type="button" className="btn" disabled={!retryable || busy} title={retryReason} onClick={() => setArmed(true)}>Retry job</button>}
      />
    </div>
  );
  return <Al97Frame crumb={`Import job / ${label}`} title={`Import job / ${label}`} subtitle={`${subtitleBase}${caption}`} scope={scope} storeName={store?.store.display_name ?? null} main={main}>{children}</Al97Frame>;
}
