import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, EmptyState, InlineNote, KeyValueList, Panel, StatusText, type Tone } from "@/components/product";
import { setControls, type InventoryFeedControls, type StoreOverview } from "@/lib/inventoryNetwork/api";
import { inputClass, mcModeLabel, plural, storeAddress, useAct, useNet, when, humanize, STATUS_TONE } from "./shared";

interface Change { title: string; detail: string; next: Pick<InventoryFeedControls, "ingestion_paused" | "emergency_stop" | "reconcile_enabled">; danger?: boolean; confirmLabel: string }

function ControlsPanel() {
  const { overview } = useNet();
  const { act, busy } = useAct();
  const c = overview.controls;
  const [pending, setPending] = useState<Change | null>(null);
  const [reason, setReason] = useState("");
  if (!c) return <Panel title="Global controls"><EmptyState title="Controls not found" detail="The feed controls row is missing. Apply the inventory network database update." compact /></Panel>;

  const base = { ingestion_paused: c.ingestion_paused, emergency_stop: c.emergency_stop, reconcile_enabled: c.reconcile_enabled };
  const start = (change: Change) => { setPending(change); setReason(""); };
  const confirm = async () => {
    if (!pending) return;
    const r = await act(() => setControls(pending.next, reason.trim()), `${pending.title} done`);
    if (r.ok) setPending(null);
  };
  const reasonOk = reason.trim().length >= 3;

  return (
    <Panel title="Global controls" description="These apply to every store and every dealer group. Each change is logged with your reason.">
      <div className="space-y-4">
        <KeyValueList rows={[
          { label: "Ingestion", value: c.ingestion_paused ? <StatusText tone="warning">Paused</StatusText> : <StatusText tone="success">Running</StatusText> },
          { label: "Reconciliation", value: c.reconcile_enabled ? <StatusText tone="success">On</StatusText> : <StatusText tone="neutral">Off</StatusText> },
          { label: "Emergency stop", value: c.emergency_stop ? <StatusText tone="danger">Engaged</StatusText> : <StatusText tone="neutral">Off</StatusText> },
          { label: "Last reason", value: c.reason ? `${c.reason} (${when(c.updated_at)})` : "None recorded" },
        ]} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || c.emergency_stop} onClick={() => start(c.ingestion_paused
            ? { title: "Resume ingestion", detail: "Feed files will be imported again as they arrive.", next: { ...base, ingestion_paused: false }, confirmLabel: "Resume ingestion" }
            : { title: "Pause ingestion", detail: "New feed files are held in the queue and nothing is imported until you resume.", next: { ...base, ingestion_paused: true }, confirmLabel: "Pause ingestion" })}>
            {c.ingestion_paused ? "Resume ingestion" : "Pause ingestion"}
          </Button>
          <Button disabled={busy} onClick={() => start(c.reconcile_enabled
            ? { title: "Turn reconciliation off", detail: "The scheduled sweep for missed feed files stops. Webhook-driven imports are unaffected.", next: { ...base, reconcile_enabled: false }, confirmLabel: "Turn reconciliation off" }
            : { title: "Turn reconciliation on", detail: "A scheduled sweep will look for feed files that arrived without a webhook and queue them.", next: { ...base, reconcile_enabled: true }, confirmLabel: "Turn reconciliation on" })}>
            {c.reconcile_enabled ? "Turn reconciliation off" : "Turn reconciliation on"}
          </Button>
          {c.emergency_stop ? (
            <Button disabled={busy} onClick={() => start({ title: "Release emergency stop", detail: "Imports stay paused until you also resume ingestion.", next: { ...base, emergency_stop: false }, confirmLabel: "Release emergency stop" })}>Release emergency stop</Button>
          ) : (
            <Button variant="danger" disabled={busy} onClick={() => start({ title: "Emergency stop", detail: "Cancels every queued import job and blocks all imports across all stores until released. Vehicles already imported are not changed.", next: { ...base, emergency_stop: true, ingestion_paused: true }, danger: true, confirmLabel: "Confirm emergency stop" })}>Emergency stop</Button>
          )}
        </div>
        {pending && (
          <div role="group" aria-label={pending.title} className="space-y-3 rounded-[6px] border border-adm-border bg-adm-workspace p-4">
            <p className="text-[14px] font-semibold text-adm-ink">{pending.title}</p>
            <p className="text-[13px] text-adm-muted">{pending.detail}</p>
            <div>
              <label htmlFor="inv-ctl-reason" className="mb-1 block text-[13px] font-semibold text-adm-ink">Reason (required)</label>
              <input id="inv-ctl-reason" className={inputClass} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Why are you making this change?" />
            </div>
            <div className="flex gap-2">
              <Button variant={pending.danger ? "danger" : "primary"} disabled={busy || !reasonOk} onClick={confirm}>{pending.confirmLabel}</Button>
              <Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

const feedHealth = (s: StoreOverview): { label: string; tone: Tone } => {
  if (!s.store.inventory_feed_enabled) return { label: "Feed off", tone: "neutral" };
  if (s.store.feed_import_paused) return { label: "Import paused", tone: "warning" };
  const snap = s.last_snapshot;
  if (!snap) return { label: "No feed yet", tone: "neutral" };
  const label = snap.status === "applied" ? "Feed healthy" : snap.status === "staged" ? "Processing" : snap.status === "superseded" ? "Superseded" : `Last feed ${snap.status}`;
  return { label, tone: STATUS_TONE[snap.status] ?? "neutral" };
};

function StoreCard({ s }: { s: StoreOverview }) {
  const { href } = useNet();
  const health = feedHealth(s);
  const mc = mcModeLabel(s.policy);
  const st = s.store;
  const failedSince = s.state?.last_failure_at && (!s.state.last_applied_at || s.state.last_failure_at > s.state.last_applied_at);
  return (
    <li className="flex flex-col gap-3 rounded-[6px] border border-adm-border bg-adm-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[16px] leading-[22px] font-semibold text-adm-ink">{st.display_name}</h3>
          <p className="truncate text-[13px] text-adm-muted">{storeAddress(st) || "No address on file"}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {st.is_primary_inventory_store && <StatusText tone="info">Primary</StatusText>}
          {st.status === "inactive" && <StatusText tone="neutral">Inactive</StatusText>}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <StatusText tone={health.tone}>{health.label}</StatusText>
        <StatusText tone={STATUS_TONE[st.subscription_status] ?? "neutral"}>{humanize(st.subscription_status)}</StatusText>
        <StatusText tone={mc.tone}>{mc.label}</StatusText>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
        <div><dt className="text-adm-muted">In inventory now</dt><dd className="text-[20px] leading-[26px] font-bold tabular-nums text-adm-ink">{s.counts.present}</dd></div>
        <div><dt className="text-adm-muted">Last successful update</dt><dd className="text-adm-ink">{s.state?.last_applied_at ? when(s.state.last_applied_at) : "Never"}</dd></div>
        <div><dt className="text-adm-muted">Shares to</dt><dd className="text-adm-ink">{plural(s.sharing_out, "store")}</dd></div>
        <div><dt className="text-adm-muted">Receives from</dt><dd className="text-adm-ink">{plural(s.sharing_in, "store")}</dd></div>
      </dl>
      {(s.counts.price_unknown > 0 || s.counts.no_photos > 0) && <p className="text-[12px] text-adm-muted">{s.counts.price_unknown} without a usable price, {s.counts.no_photos} without photos</p>}
      {failedSince && <p className="text-[12px] text-adm-danger">Last failure {when(s.state?.last_failure_at)}: {humanize(s.state?.last_failure_reason) || "unknown reason"}</p>}
      <div className="mt-auto flex flex-wrap gap-3 pt-1 text-[13px] font-semibold">
        <Link className="text-adm-primary hover:underline" to={href("stores", { store: st.id })}>Configure</Link>
        <Link className="text-adm-primary hover:underline" to={href("sharing", { store: st.id })}>Sharing</Link>
        <Link className="text-adm-primary hover:underline" to={href("marketcheck", { store: st.id })}>MarketCheck</Link>
      </div>
    </li>
  );
}

export default function OverviewSection() {
  const { overview, stores, href, go } = useNet();
  const ex = overview.exceptions;
  const items: Array<{ label: string; n: number; to: string }> = [
    { label: "Open VIN conflicts", n: ex.open_conflicts, to: href("runs", { panel: "conflicts" }) },
    { label: "Awaiting retirement review", n: ex.retirement_review, to: href("runs", { panel: "retirement" }) },
    { label: "Quarantined partitions (7 days)", n: ex.quarantined_partitions_7d, to: href("runs", { panel: "timeline", q: "quarantined" }) },
    { label: "Failed jobs", n: ex.failed_jobs, to: href("runs", { panel: "timeline", q: "failed" }) },
    { label: "Pending mappings", n: ex.pending_mappings, to: href("mapping") },
  ];
  const total = items.reduce((a, i) => a + i.n, 0);

  return (
    <div className="space-y-4">
      <Panel title="Exceptions" description="Things that need a person. Select one to open it.">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {items.map((i) => (
            <li key={i.label}>
              <Link to={i.to} className="block rounded-[6px] border border-adm-border bg-adm-surface px-4 py-3 hover:border-adm-primary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary">
                <span className={`block text-[24px] leading-[32px] font-bold tabular-nums ${i.n > 0 ? "text-adm-danger" : "text-adm-ink"}`}>{i.n}</span>
                <span className="block text-[13px] leading-[18px] text-adm-muted">{i.label}</span>
              </Link>
            </li>
          ))}
        </ul>
        {total === 0 && <p className="mt-3 text-[13px] text-adm-muted">Nothing is waiting for review.</p>}
      </Panel>

      <ControlsPanel />

      <section aria-label="Stores" className="space-y-3">
        {stores.length === 0 ? (
          <Panel><EmptyState title="No stores in this group yet" detail="Stores are never created automatically. Add each rooftop yourself, then map its feed." action={<Button variant="primary" onClick={() => go("stores", { store: "new" })}>Add store</Button>} compact /></Panel>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{stores.map((s) => <StoreCard key={s.store.id} s={s} />)}</ul>
        )}
      </section>
      <InlineNote tone="info" title="Showing a store's vehicles to a sibling store's customers never calls MarketCheck.">Only a store's own policy and caps allow paid lookups.</InlineNote>
    </div>
  );
}
