import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, EmptyState, InlineNote, Panel, QueryState, StatusText, Td, Th, WorkTable } from "@/components/product";
import {
  explainError, getDeliveryTimeline, listBulkContracts, resolveBulkException, saveBulkContract, saveTiming,
  type BulkContract, type BulkContractDraft, type BulkDelivery, type BulkException, type BulkSchemaVersion, type IntegrationTiming, type TimelineFilesRun, type TimingDraft,
} from "@/lib/inventoryNetwork/api";
import { CheckField, ConfirmButton, NeedsReview, NumberField, SelectField, STATUS_TONE, TextField, fileName, humanize, inputClass, shortId, useAct, when } from "./shared";

const now = () => Date.now();
const passed = (s: string | null | undefined) => !!s && new Date(s).getTime() < now();

function Stage({ label, at, expected }: { label: string; at: string | null; expected?: string | null }) {
  const late = !at && passed(expected);
  return (
    <div className="min-w-[130px]">
      <dt className="text-[12px] text-adm-muted">{label}</dt>
      <dd className={`text-[13px] ${late ? "font-semibold text-adm-danger" : "text-adm-ink"}`}>
        {at ? when(at) : expected ? (late ? `Late, expected ${when(expected)}` : `Expected ${when(expected)}`) : " "}
      </dd>
    </div>
  );
}

const ENV: Record<BulkDelivery["environment"], { label: string; tone: "success" | "warning" }> = { production: { label: "Production", tone: "success" }, release_test: { label: "Release test, never imported", tone: "warning" } };

function DeliveryCard({ d }: { d: BulkDelivery }) {
  const expectedLate = !d.received_at && passed(d.expected_at);
  return (
    <li id={`delivery-${d.id}`} className={`space-y-3 rounded-[6px] border bg-adm-surface p-4 ${d.environment === "release_test" ? "border-dashed border-[#F1D58A]" : "border-adm-border"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-[15px] font-semibold text-adm-ink">{d.feed_key} <span className="font-normal text-adm-muted">{d.delivery_key}</span></h4>
        <StatusText tone={ENV[d.environment].tone}>{ENV[d.environment].label}</StatusText>
        <StatusText tone={STATUS_TONE[d.status] ?? "neutral"}>{humanize(d.status)}</StatusText>
        {expectedLate && <StatusText tone="danger">Late</StatusText>}
        <span className="text-[12px] text-adm-muted">{humanize(d.scope)}{d.schema_version ? `, schema ${d.schema_version}` : ""}</span>
        {d.replay_of && <a className="text-[12px] font-semibold text-adm-primary underline" href={`#delivery-${d.replay_of}`}>Replay of {shortId(d.replay_of)}</a>}
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-2">
        <Stage label="Expected" at={d.expected_at} />
        <Stage label="Received" at={d.received_at} expected={d.expected_at} />
        <Stage label="Complete" at={d.completed_at} />
        <Stage label="Validated" at={d.validated_at} />
        <Stage label="Imported" at={d.imported_at} />
        <Stage label="Enriched" at={d.enriched_at} />
      </dl>
      <p className="text-[12px] text-adm-muted">
        Parts: {d.received_parts}{d.expected_parts !== null ? ` of ${d.expected_parts}` : ""} received, {d.verified_parts} verified.{" "}
        Completion evidence: {d.completion_evidence === "none" ? <NeedsReview>None</NeedsReview> : humanize(d.completion_evidence)}.{" "}
        {d.row_count !== null && `Rows: ${d.row_count.toLocaleString("en-US")}${d.expected_row_count !== null ? ` of ${d.expected_row_count.toLocaleString("en-US")} expected` : ""}.`}
      </p>
      {d.error && <p className="text-[12px] text-adm-danger">{humanize(d.error)}</p>}
    </li>
  );
}

function FilesRunCard({ r }: { r: TimelineFilesRun }) {
  return (
    <li className="space-y-2 rounded-[6px] border border-adm-border bg-adm-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-[15px] font-semibold text-adm-ink">{fileName(r.path)}</h4>
        <StatusText tone="info">Files.com inventory</StatusText>
        <StatusText tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</StatusText>
        <span className="text-[12px] text-adm-muted">{humanize(r.kind)}, {r.affected_store_ids?.length ?? 0} store{(r.affected_store_ids?.length ?? 0) === 1 ? "" : "s"}</span>
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-2"><Stage label="Started" at={r.started_at} /><Stage label="Finished" at={r.finished_at} /></dl>
      {r.failure_reason && <p className="text-[12px] text-adm-danger">{humanize(r.failure_reason)}</p>}
    </li>
  );
}

function ExceptionRow({ e }: { e: BulkException }) {
  const { act, busy } = useAct();
  const [text, setText] = useState("");
  return (
    <tr>
      <Td>{when(e.opened_at)}</Td>
      <Td><StatusText tone={e.severity === "blocking" ? "danger" : e.severity === "warning" ? "warning" : "info"}>{e.severity}</StatusText></Td>
      <Td>{humanize(e.kind)}</Td>
      <Td className="text-[12px]">{e.feed_key ?? ""}{e.delivery_id ? ` ${shortId(e.delivery_id)}` : ""}</Td>
      <Td className="max-w-[320px] text-[12px]">{e.detail}</Td>
      <Td align="right">
        <div className="flex justify-end gap-2">
          <input aria-label={`Resolution for ${humanize(e.kind)}`} className={`${inputClass} w-48`} placeholder="Reason (required)" value={text} onChange={(ev) => setText(ev.target.value)} />
          <Button size="sm" disabled={busy || text.trim().length < 3} onClick={() => act(() => resolveBulkException(e.id, text.trim()), "Exception resolved")}>Resolve</Button>
        </div>
      </Td>
    </tr>
  );
}

const CRON = /^\S+(\s+\S+){4}$/;

function TimingForm({ t }: { t: IntegrationTiming }) {
  const { act, busy } = useAct();
  const base: TimingDraft = {
    integration_key: t.integration_key, integration: t.integration, expected_delivery_cron: t.expected_delivery_cron ?? "", expected_delivery_tz: t.expected_delivery_tz ?? "",
    delivery_grace_minutes: t.delivery_grace_minutes, import_mode: t.import_mode, import_cron: t.import_cron ?? "", reconciliation_cron: t.reconciliation_cron ?? "",
    enrichment_mode: t.enrichment_mode, enrichment_cron: t.enrichment_cron ?? "", note: t.note ?? "",
  };
  const [d, setD] = useState(base);
  const set = <K extends keyof TimingDraft>(k: K, v: TimingDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const files = t.integration === "filescom_inventory";
  const problems: string[] = [];
  for (const [k, label] of [["expected_delivery_cron", "Delivery schedule"], ["import_cron", "Import schedule"], ["reconciliation_cron", "Reconciliation schedule"], ["enrichment_cron", "Enrichment schedule"]] as const) {
    if (d[k] && !CRON.test(d[k].trim())) problems.push(`${label} must be five cron fields.`);
  }
  if (d.expected_delivery_cron && !d.expected_delivery_tz) problems.push("A delivery schedule needs the time zone the supplier states.");
  if (d.import_mode === "scheduled" && !d.import_cron) problems.push("Scheduled import needs a schedule.");
  if (d.enrichment_mode === "scheduled" && !d.enrichment_cron) problems.push("Scheduled enrichment needs a schedule.");
  const dirty = JSON.stringify(d) !== JSON.stringify(base);
  const save = () => act(() => saveTiming(d), `Timing for ${t.integration_key} saved`);
  const paid = d.enrichment_mode !== "off" && t.enrichment_mode === "off";
  return (
    <Panel title={t.integration_key} description={humanize(t.integration)}>
      <div className="space-y-5">
        <fieldset className="space-y-3"><legend className="text-[14px] font-semibold text-adm-ink">Supplier delivery</legend>
          <p className="text-[12px] text-adm-muted">When the supplier says files arrive. It only detects lateness; arrival, not the clock, starts processing.</p>
          <div className="grid gap-4 md:grid-cols-3">
            <TextField id={`${t.integration_key}-dc`} label="Expected delivery schedule (cron)" value={d.expected_delivery_cron} onChange={(v) => set("expected_delivery_cron", v)} placeholder="0 6 * * *" />
            <TextField id={`${t.integration_key}-tz`} label="Supplier time zone" value={d.expected_delivery_tz} onChange={(v) => set("expected_delivery_tz", v)} placeholder="America/New_York" hint="The zone the supplier states, never guessed." />
            <NumberField id={`${t.integration_key}-gr`} label="Grace (minutes)" value={d.delivery_grace_minutes} onChange={(v) => set("delivery_grace_minutes", v ?? 0)} min={0} max={10080} />
          </div>
        </fieldset>
        <fieldset className="space-y-3"><legend className="text-[14px] font-semibold text-adm-ink">Inventory import</legend>
          <div className="grid gap-4 md:grid-cols-3">
            <SelectField id={`${t.integration_key}-im`} label="Import mode" value={d.import_mode} onChange={(v) => set("import_mode", v)} options={[{ value: "on_completion", label: "When delivery is complete" }, { value: "scheduled", label: "On a schedule" }, { value: "manual", label: "Manual only" }]} />
            <TextField id={`${t.integration_key}-ic`} label="Import schedule (cron)" value={d.import_cron} onChange={(v) => set("import_cron", v)} disabled={d.import_mode !== "scheduled"} />
            <TextField id={`${t.integration_key}-rc`} label="Reconciliation schedule (cron)" value={d.reconciliation_cron} onChange={(v) => set("reconciliation_cron", v)} hint="Backup sweep for missed deliveries." />
          </div>
        </fieldset>
        <fieldset className="space-y-3"><legend className="text-[14px] font-semibold text-adm-ink">Paid enrichment</legend>
          <p className="text-[12px] text-adm-muted">{files ? "Files.com imports never start paid MarketCheck lookups, so this stays off." : "Spends MarketCheck quota. Locked until every enabled catalog product is verified."}</p>
          <div className="grid gap-4 md:grid-cols-3">
            <SelectField id={`${t.integration_key}-em`} label="Enrichment mode" value={d.enrichment_mode} disabled={files} onChange={(v) => set("enrichment_mode", v)} options={[{ value: "off", label: "Off" }, { value: "after_import", label: "After import" }, { value: "scheduled", label: "On a schedule" }]} />
            <TextField id={`${t.integration_key}-ec`} label="Enrichment schedule (cron)" value={d.enrichment_cron} onChange={(v) => set("enrichment_cron", v)} disabled={files || d.enrichment_mode !== "scheduled"} />
          </div>
        </fieldset>
        <TextField id={`${t.integration_key}-note`} label="Note" value={d.note} onChange={(v) => set("note", v)} />
        {problems.length > 0 && <InlineNote tone="warning" title="Fix before saving">{problems.join(" ")}</InlineNote>}
        {paid ? <ConfirmButton size="md" variant="primary" label="Save timing" confirmLabel="Confirm: starts paid lookups" disabled={busy || problems.length > 0} onConfirm={save} /> : <Button variant="primary" disabled={busy || !dirty || problems.length > 0} onClick={save}>Save timing</Button>}
      </div>
    </Panel>
  );
}

const draftOfContract = (c: BulkContract | null): BulkContractDraft => ({
  feed_key: c?.feed_key ?? "", label: c?.label ?? "", format: c?.format ?? "csv", compression: c?.compression ?? "none", delivery_method: c?.delivery_method ?? "sftp", delivery_scope: c?.delivery_scope ?? "full",
  data_refresh_cadence: c?.data_refresh_cadence ?? "", storage_rights: c?.storage_rights ?? "unknown", retention_days: c?.retention_days ?? null, replay_rights: c?.replay_rights ?? "unknown",
  sharing_rights: c?.sharing_rights ?? "unknown", customer_display: c?.customer_display ?? "unknown", webhook_secret_ref: c?.webhook_secret_ref ?? "", enabled: c?.enabled ?? false, mark_contracted: false, contract_evidence: c?.contract_evidence ?? "",
});

function ContractForm({ c, onClose }: { c: BulkContract | null; onClose: () => void }) {
  const { act, busy } = useAct();
  const base = draftOfContract(c);
  const [d, setD] = useState(base);
  const set = <K extends keyof BulkContractDraft>(k: K, v: BulkContractDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const contractedAfter = !!c?.contracted || d.mark_contracted;
  const problems: string[] = [];
  if (!/^[a-z0-9_]{3,60}$/.test(d.feed_key)) problems.push("Feed key is 3 to 60 lowercase letters, numbers or underscores.");
  if (d.mark_contracted && d.contract_evidence.trim().length < 10) problems.push("Marking contracted needs at least 10 characters of evidence.");
  if (d.enabled && !(contractedAfter && d.storage_rights !== "unknown")) problems.push("A feed can only be enabled once it is contracted and storage rights are known.");
  if (d.webhook_secret_ref && !/^MARKETCHECK_BULK_[A-Z0-9_]{1,40}$/.test(d.webhook_secret_ref)) problems.push("Webhook secret name must look like MARKETCHECK_BULK_NAME.");
  const dirty = JSON.stringify(d) !== JSON.stringify(base);
  const save = () => act(async () => { await saveBulkContract(d); onClose(); }, "Bulk feed contract saved");
  const sensitive = d.mark_contracted || (d.enabled && !c?.enabled);
  const rights = [{ value: "unknown", label: "Unknown (needs review)" }, { value: "permitted", label: "Permitted" }, { value: "prohibited", label: "Prohibited" }];
  return (
    <Panel title={c ? `Edit ${c.label}` : "Add bulk feed"} description="Record only what the signed agreement says. Leave a right unknown if it does not.">
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <TextField id="bc-key" label="Feed key" value={d.feed_key} onChange={(v) => set("feed_key", v)} disabled={!!c} />
          <TextField id="bc-label" label="Label" value={d.label} onChange={(v) => set("label", v)} />
          <TextField id="bc-cad" label="Data refresh cadence" value={d.data_refresh_cadence} onChange={(v) => set("data_refresh_cadence", v)} hint="How often the data itself refreshes. Not the schema release cadence." />
          <SelectField id="bc-fmt" label="Format" value={d.format} onChange={(v) => set("format", v)} options={["csv", "jsonl", "parquet"].map((x) => ({ value: x, label: x }))} />
          <SelectField id="bc-comp" label="Compression" value={d.compression} onChange={(v) => set("compression", v)} options={["none", "gzip", "zstd"].map((x) => ({ value: x, label: x }))} />
          <SelectField id="bc-meth" label="Delivery method" value={d.delivery_method} onChange={(v) => set("delivery_method", v)} options={["sftp", "s3", "https", "webhook"].map((x) => ({ value: x, label: x }))} />
          <SelectField id="bc-scope" label="Scope" value={d.delivery_scope} onChange={(v) => set("delivery_scope", v)} options={[{ value: "full", label: "Full" }, { value: "delta", label: "Delta" }]} />
          <SelectField id="bc-store" label="Storage rights" value={d.storage_rights} onChange={(v) => set("storage_rights", v)} options={[{ value: "unknown", label: "Unknown (needs review)" }, { value: "permitted", label: "Permitted" }, { value: "limited", label: "Limited" }, { value: "prohibited", label: "Prohibited" }]} />
          <NumberField id="bc-ret" label="Retention days" value={d.retention_days} onChange={(v) => set("retention_days", v)} min={1} />
          <SelectField id="bc-replay" label="Replay rights" value={d.replay_rights} onChange={(v) => set("replay_rights", v)} options={rights} />
          <SelectField id="bc-share" label="Sharing rights" value={d.sharing_rights} onChange={(v) => set("sharing_rights", v)} options={rights} />
          <SelectField id="bc-disp" label="Customer display" value={d.customer_display} onChange={(v) => set("customer_display", v)} options={rights} />
          <TextField id="bc-hook" label="Webhook secret name" value={d.webhook_secret_ref} onChange={(v) => set("webhook_secret_ref", v)} placeholder="MARKETCHECK_BULK_..." />
        </div>
        <TextField id="bc-ev" label="Contract evidence" value={d.contract_evidence} onChange={(v) => set("contract_evidence", v)} hint="Agreement name, date and clause." />
        <CheckField id="bc-con" label="Mark as contracted" checked={d.mark_contracted || !!c?.contracted} disabled={!!c?.contracted} onChange={(v) => set("mark_contracted", v)} hint="Asserts a signed bulk-feed agreement exists. Requires evidence." />
        <CheckField id="bc-en" label="Enabled" checked={d.enabled} onChange={(v) => set("enabled", v)} hint="Lets deliveries for this feed be accepted." />
        {problems.length > 0 && <InlineNote tone="warning" title="Fix before saving">{problems.join(" ")}</InlineNote>}
        <div className="flex items-center gap-3">
          {sensitive ? <ConfirmButton size="md" variant="primary" label="Save feed" confirmLabel="Confirm: contract or enable" disabled={busy || !dirty || problems.length > 0} onConfirm={save} /> : <Button variant="primary" disabled={busy || !dirty || problems.length > 0} onClick={save}>Save feed</Button>}
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Panel>
  );
}

const SCHEMA_TONE: Record<BulkSchemaVersion["status"], "success" | "info" | "warning" | "neutral"> = { current: "success", upcoming: "info", deprecated: "warning", retired: "neutral" };

export default function DeliveriesSection() {
  const q = useQuery({ queryKey: ["inv-net", "deliveries"], queryFn: () => getDeliveryTimeline(50) });
  const contracts = useQuery({ queryKey: ["inv-net", "bulk-contracts"], queryFn: listBulkContracts });
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const t = q.data ?? null;
  const list = contracts.data ?? [];
  const editingContract = editing && editing !== "new" ? list.find((c) => c.feed_key === editing) ?? null : null;
  const bulk = t?.bulk_deliveries ?? [];
  const runs = t?.filescom_runs ?? [];

  return (
    <div className="space-y-4">
      <QueryState status={q.isLoading ? "loading" : q.isError ? "error" : !t ? "empty" : "ready"} errorTitle="Could not load deliveries" errorDetail={q.isError ? explainError(q.error) : undefined} onRetry={() => q.refetch()} emptyTitle="Nothing came back" emptyDetail="Apply the MarketCheck bulk feed database update, then reload.">
        {t && (
          <div className="space-y-4">
            <Panel title="Exception queue" description="Open problems with deliveries. Resolving needs a reason." flush>
              {t.exceptions.length === 0 ? <EmptyState title="No open exceptions" compact /> : (
                <WorkTable caption="Delivery exceptions" minWidth={960}>
                  <thead><tr><Th>Opened</Th><Th>Severity</Th><Th>Kind</Th><Th>Feed</Th><Th>Detail</Th><Th align="right">Resolve</Th></tr></thead>
                  <tbody>{t.exceptions.map((e) => <ExceptionRow key={e.id} e={e} />)}</tbody>
                </WorkTable>
              )}
            </Panel>

            <Panel title="Delivery timeline" description="Expected, received, complete, validated, imported and enriched are separate steps. A blank step has not happened.">
              {bulk.length === 0 && runs.length === 0 ? <EmptyState title="No deliveries yet" detail="Bulk feed deliveries and Files.com runs appear here as they happen." compact /> : (
                <div className="space-y-5">
                  <section aria-label="Bulk feed deliveries" className="space-y-3">
                    <h4 className="text-[14px] font-semibold text-adm-ink">MarketCheck bulk feeds</h4>
                    {bulk.length === 0 ? <p className="text-[13px] text-adm-muted">No bulk feed deliveries. None is contracted.</p> : <ul className="space-y-3">{bulk.map((d) => <DeliveryCard key={d.id} d={d} />)}</ul>}
                  </section>
                  <section aria-label="Files.com runs" className="space-y-3 border-t border-adm-border pt-4">
                    <h4 className="text-[14px] font-semibold text-adm-ink">Files.com dealer inventory</h4>
                    {runs.length === 0 ? <p className="text-[13px] text-adm-muted">No Files.com runs yet.</p> : <ul className="space-y-3">{runs.map((r) => <FilesRunCard key={r.id} r={r} />)}</ul>}
                  </section>
                </div>
              )}
            </Panel>

            <section aria-label="Integration timing" className="space-y-3">
              <h3 className="text-[17px] leading-[24px] font-semibold text-adm-ink">Integration timing</h3>
              {t.timing.length === 0 ? <Panel><EmptyState title="No integrations configured" compact /></Panel> : t.timing.map((x) => <TimingForm key={`${x.integration_key}-${x.updated_at}`} t={x} />)}
            </section>

            <Panel title="Schema versions" description="Quarterly schema releases change the file layout. They are not the data refresh cadence." flush>
              {t.schemas.length === 0 ? <EmptyState title="No schema versions recorded" compact /> : (
                <WorkTable caption="Schema versions" minWidth={760}>
                  <thead><tr><Th>Feed</Th><Th>Version</Th><Th>Status</Th><Th>Effective</Th><Th>Validation deadline</Th><Th>Deprecated fields</Th></tr></thead>
                  <tbody>{t.schemas.map((s) => (
                    <tr key={`${s.feed_key}-${s.version}`}>
                      <Td>{s.feed_key}</Td><Td>{s.version} <span className="text-[12px] text-adm-muted">{humanize(s.release_kind)}</span></Td>
                      <Td><StatusText tone={SCHEMA_TONE[s.status]}>{s.status}</StatusText></Td><Td>{s.effective_at ?? "Not set"}</Td>
                      <Td className={!s.validated_at && passed(s.validation_deadline) ? "font-semibold text-adm-danger" : undefined}>{s.validation_deadline ?? "None"}{s.validated_at ? ", validated" : !s.validated_at && passed(s.validation_deadline) ? ", overdue" : ""}</Td>
                      <Td className="text-[12px]">{s.deprecated_fields.length ? s.deprecated_fields.join(", ") : "None"}</Td>
                    </tr>
                  ))}</tbody>
                </WorkTable>
              )}
            </Panel>
          </div>
        )}
      </QueryState>

      <section aria-label="Bulk feed contracts" className="space-y-3">
        <h3 className="text-[17px] leading-[24px] font-semibold text-adm-ink">Bulk feed contracts</h3>
        {contracts.isSuccess && !list.some((c) => c.contracted) && <InlineNote tone="warning" title="No MarketCheck bulk feed is contracted. Bulk feeds are a separate agreement from the API plan." />}
        <Panel flush action={<Button size="sm" onClick={() => setEditing("new")}>Add bulk feed</Button>}>
          <QueryState status={contracts.isLoading ? "loading" : contracts.isError ? "error" : list.length === 0 ? "empty" : "ready"} errorTitle="Could not load contracts" errorDetail={contracts.isError ? explainError(contracts.error) : undefined} onRetry={() => contracts.refetch()} emptyTitle="No bulk feeds recorded" emptyDetail="Add one only after a bulk-feed agreement is signed.">
            <WorkTable caption="Bulk feed contracts" minWidth={980}>
              <thead><tr><Th>Feed</Th><Th>Format</Th><Th>Contract</Th><Th>Storage</Th><Th>Replay</Th><Th>Sharing</Th><Th>Customer display</Th><Th align="right">Actions</Th></tr></thead>
              <tbody>{list.map((c) => (
                <tr key={c.feed_key}>
                  <Td className="font-semibold">{c.label}<span className="block text-[12px] font-normal text-adm-muted">{c.feed_key}</span></Td>
                  <Td className="text-[12px]">{c.format}, {c.compression}, {c.delivery_method}, {c.delivery_scope}</Td>
                  <Td>{c.contracted ? <StatusText tone="success">Contracted</StatusText> : <StatusText tone="neutral">Not contracted</StatusText>} {c.enabled ? <StatusText tone="info">Enabled</StatusText> : null}</Td>
                  <Td>{c.storage_rights === "unknown" ? <NeedsReview /> : humanize(c.storage_rights)}</Td>
                  <Td>{c.replay_rights === "unknown" ? <NeedsReview /> : humanize(c.replay_rights)}</Td>
                  <Td>{c.sharing_rights === "unknown" ? <NeedsReview /> : humanize(c.sharing_rights)}</Td>
                  <Td>{c.customer_display === "unknown" ? <NeedsReview /> : humanize(c.customer_display)}</Td>
                  <Td align="right"><Button size="sm" onClick={() => setEditing(c.feed_key)}>Edit</Button></Td>
                </tr>
              ))}</tbody>
            </WorkTable>
          </QueryState>
        </Panel>
        {editing === "new" && <ContractForm key="new" c={null} onClose={() => setEditing(null)} />}
        {editingContract && <ContractForm key={editingContract.feed_key} c={editingContract} onClose={() => setEditing(null)} />}
      </section>
    </div>
  );
}
