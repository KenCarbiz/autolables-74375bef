import { useMemo, useState, type ReactNode } from "react";
import { useAdminNow } from "@/lib/admin/dataSource";
import { Link } from "react-router-dom";
import { Button, EmptyState, InlineNote, KeyValueList, Panel, StatusText, type Tone } from "@/components/product";
import { setControls, type InventoryFeedControls, type StoreOverview } from "@/lib/inventoryNetwork/api";
import { NetIcon } from "@/components/inventoryNetwork/icons";
import { inputClass, mcModeLabel, plural, storeAddress, useAct, useNet, when, humanize, STATUS_TONE } from "./shared";
import { buildOverviewModel, type OverviewModel } from "./overviewModel";
import { Al97Frame, ChipView, Glyph, type ScopePicker } from "./al97ui";
import { useLedgers } from "./ledgers";
import connectionStages from "@/assets/inventoryNetwork/connection-stages.svg";

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
          {st.is_primary_inventory_store && <span className="inline-flex items-center gap-1"><NetIcon name="homeStore" className="text-adm-muted" /><StatusText tone="info">Primary</StatusText></span>}
          {st.status === "inactive" && <StatusText tone="neutral">Inactive</StatusText>}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1"><NetIcon name={st.feed_import_paused ? "paused" : "health"} className="text-adm-muted" /><StatusText tone={health.tone}>{health.label}</StatusText></span>
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
        <Link className="inline-flex items-center gap-1 text-adm-primary hover:underline" to={href("stores", { store: st.id })}><NetIcon name="store" />Configure</Link>
        <Link className="inline-flex items-center gap-1 text-adm-primary hover:underline" to={href("sharing", { store: st.id })}><NetIcon name="sharing" />Sharing</Link>
        <Link className="inline-flex items-center gap-1 text-adm-primary hover:underline" to={href("marketcheck", { store: st.id })}><NetIcon name="budget" />MarketCheck</Link>
      </div>
    </li>
  );
}

export default function OverviewDetail() {
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

export function OverviewMain({ model }: { model: OverviewModel }) {
  const { href } = useNet();
  return (
    <div className="work">
      {model.banner && (
        <div role="status" className="banner amber">
          <Glyph name="warning" className="icon" />
          <div><strong>{model.banner.title}</strong><p>{model.banner.detail}</p></div>
        </div>
      )}
      <ul className="stats" aria-label="Pipeline counts" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {model.stats.map((s) => (
          <li key={s.label} className="metric">
            <Glyph name={s.icon} />
            <p>{s.label}</p>
            <b className={s.known ? undefined : "unknown"}>{s.value}</b>
            <small>{s.sub}</small>
          </li>
        ))}
      </ul>
      <section className="card" aria-labelledby="inv-flow-h">
        <div className="card-head"><div><h2 id="inv-flow-h">From file to customer</h2><p>Each stage has its own timestamp and outcome.</p></div></div>
        <ol className="flow" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {model.flow.map((f) => (
            <li key={f.no} className="step">
              <span className="step-no">{f.no}</span>
              <strong>{f.title}</strong>
              <ChipView chip={f.chip} />
              <small>{f.note}</small>
            </li>
          ))}
        </ol>
      </section>
      <div className="split">
        <div>
          <div><section className="card" aria-labelledby="inv-act-h">
            <div className="card-head"><div><h2 id="inv-act-h">Stores requiring action</h2></div></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">Store</th><th scope="col">Readiness</th><th scope="col">Next step</th></tr></thead>
                <tbody>
                  {model.actions.length === 0 && <tr><td colSpan={3}>No store needs action.</td></tr>}
                  {model.actions.map((r) => (
                    <tr key={r.key}>
                      <td>{r.name}</td>
                      <td><ChipView chip={r.chip} /></td>
                      <td><Link to={href(r.to.view, r.to.params)}>{r.label} {"\u2192"}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section></div>
        </div>
        <div>
          <div><section className="card" aria-labelledby="inv-ctl-h">
            <div className="card-head"><div><h2 id="inv-ctl-h">Connection controls</h2><p>Permission to run is separate from proof of execution.</p></div></div>
            <dl className="keyvals">
              <div><dt>Ingestion permitted</dt><dd><ChipView chip={model.controls.ingestion} /></dd></div>
              <div><dt>Worker heartbeat</dt><dd><ChipView chip={model.controls.heartbeat} /></dd></div>
              <div><dt>Last completed import</dt><dd>{model.controls.lastImport}</dd></div>
              <div><dt>MarketCheck store mode</dt><dd>{model.controls.marketCheckMode}</dd></div>
            </dl>
            <img className="art" src={connectionStages} alt="" />
          </section></div>
        </div>
      </div>
      <div className="savebar">
        <Glyph name="shield" />
        <div><strong>No settings changed</strong><p>Reading this page never imports inventory or calls a paid provider.</p></div>
        <div className="push"><Link className="btn" to={href("runs")}><Glyph name="history" className="icon" />View runs</Link></div>
      </div>
    </div>
  );
}

export function OverviewScreen({ scope, children }: { scope?: ScopePicker; children?: ReactNode }) {
  const { overview, stores } = useNet();
  const now = useAdminNow();
  const primary = stores.find((s) => s.store.is_primary_inventory_store) ?? stores[0] ?? null;
  const l = useLedgers({ jobs: true, snapshots: true, bindings: true, previewStoreId: primary?.store.id ?? null });
  const model = useMemo(() => buildOverviewModel({
    now, stores, controls: overview.controls, jobs: l.jobs, snapshots: l.snapshots, bindings: l.bindings, preview: l.preview, heartbeatAt: l.heartbeatAt,
  }), [now, stores, overview.controls, l.jobs, l.snapshots, l.bindings, l.preview, l.heartbeatAt]);
  return (
    <Al97Frame crumb="Inventory network" title="Inventory network" subtitle="Know what arrived, what applied, and what shoppers can see." scope={scope} storeName={primary?.store.display_name ?? null} main={<OverviewMain model={model} />}>
      {children}
    </Al97Frame>
  );
}
