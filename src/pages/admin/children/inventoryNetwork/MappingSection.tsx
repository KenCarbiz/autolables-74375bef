import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Button, EmptyState, InlineNote, KeyValueList, Panel, QueryState, StatusText, Td, Th, WorkTable } from "@/components/product";
import {
  approveBinding, decideMapping, disableBinding, discoverFiles, explainError, importNow, isPartitionReport, listSourceMappings,
  partitionDryRun, proposeBinding, proposeMapping, type DealerStore, type FeedFile, type FieldVerdict, type ImportNowResult, type InventorySourceMapping, type PartitionReportItem,
} from "@/lib/inventoryNetwork/api";
import { MappingReviewBoard, boardQueries } from "@/components/inventoryNetwork/MappingReviewBoard";
import { CheckField, ConfirmButton, SelectField, STATUS_TONE, fileName, humanize, plural, storeAddress, useAct, useNet, when } from "./shared";

const doNotMap = (f: FeedFile) => /test/i.test(fileName(f.path)) || (f.status === "quarantined" && !!f.quarantine_reason && f.quarantine_reason !== "unmapped");

function MappingActions({ mapping }: { mapping: InventorySourceMapping }) {
  const { act, busy } = useAct();
  const [ack, setAck] = useState(false);
  const server = mapping.evidence?.computed_by === "server";
  const verdict = server ? mapping.evidence?.verdict ?? "incomplete" : null;
  const blocked = !server ? "Proposed before server review: reject and propose again." : verdict === "mismatch" ? "Address mismatch: never approvable." : verdict === "incomplete" ? "Identity incomplete: fix the store first." : null;
  if (mapping.status === "pending") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        {verdict === "name_review" && <CheckField id={`ack-${mapping.id}`} label="Address matches; I confirm the dealer name belongs to this store" checked={ack} onChange={setAck} />}
        {blocked && <span className="text-[12px] text-adm-danger">{blocked}</span>}
        <Button size="sm" variant="primary" disabled={busy || !!blocked || (verdict === "name_review" && !ack)} onClick={() => act(() => decideMapping(mapping.id, "approve", verdict === "name_review" && ack), "Mapping approved")}>Approve</Button>
        <Button size="sm" variant="danger" disabled={busy} onClick={() => act(() => decideMapping(mapping.id, "reject"), "Mapping rejected")}>Reject</Button>
      </div>
    );
  }
  if (mapping.status === "approved") return <ConfirmButton label="Revoke" confirmLabel="Revoke mapping" variant="danger" disabled={busy} onConfirm={() => act(() => decideMapping(mapping.id, "revoke"), "Mapping revoked. Existing vehicles stay with their store.")} />;
  return null;
}

const FIELD_ROWS: Array<[string, "name" | "address" | "city" | "postal" | "region"]> = [["Dealer name", "name"], ["Address", "address"], ["City", "city"], ["Postal code", "postal"], ["Region", "region"]];
const FIELD_TONE: Record<FieldVerdict, "success" | "danger" | "neutral"> = { match: "success", mismatch: "danger", unknown: "neutral" };

function PartitionCard({ p, mappings, stores, runId }: { p: PartitionReportItem; mappings: InventorySourceMapping[]; stores: DealerStore[]; runId: string | null }) {
  const { act, busy } = useAct();
  const { startNewStore } = useNet();
  const [target, setTarget] = useState("");
  const live = mappings.find((m) => m.source_dealer_id === p.sourceDealerId && (m.status === "pending" || m.status === "approved")) ?? null;
  const mappedStore = stores.find((s) => s.id === (live?.store_id ?? p.mapping?.storeId)) ?? null;
  const changedSinceRun = (live?.status ?? null) !== (p.mapping?.status ?? null) || (live?.store_id ?? null) !== (p.mapping?.storeId ?? null);
  const cmp = p.comparison;
  const sourceValue = (k: (typeof FIELD_ROWS)[number][1]) => ({ name: p.identity.dealerName, address: p.identity.address, city: p.identity.city, postal: p.identity.postal, region: p.identity.region })[k];
  const storeValue = (k: (typeof FIELD_ROWS)[number][1]) => mappedStore ? ({ name: [mappedStore.display_name, mappedStore.legal_name].filter(Boolean).join(" / "), address: mappedStore.street, city: mappedStore.city, postal: mappedStore.zip, region: mappedStore.state })[k] : null;
  const c = p.counts;
  const counts: Array<[string, number]> = [["Rows", c.rows], ["Valid", c.valid], ["Invalid", c.invalid], ["Duplicates", c.duplicateIdentical + c.duplicateConflicts], ["Missing price", c.priceMissing], ["Zero price", c.priceZero], ["Missing photos", c.photoMissing]];
  const issues = (label: string, list: PartitionReportItem["errors"]) => list.length > 0 && (
    <div>
      <p className="text-[13px] font-semibold text-adm-ink">{label} ({list.length})</p>
      <ul className="mt-1 space-y-0.5 text-[12px] text-adm-muted">
        {list.slice(0, 5).map((e, i) => <li key={i}>Row {e.row}{e.vin ? ` (${e.vin})` : ""}: {humanize(e.code)}{e.detail ? `, ${e.detail}` : ""}</li>)}
        {list.length > 5 && <li>and {list.length - 5} more in the saved report</li>}
      </ul>
    </div>
  );

  return (
    <li className="space-y-4 rounded-[6px] border border-adm-border bg-adm-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[16px] leading-[22px] font-semibold text-adm-ink">DealerId {p.sourceDealerId} <span className="font-normal text-adm-muted">{p.identity.dealerName}</span></h4>
        <StatusText tone={STATUS_TONE[p.outcome] ?? "neutral"}>{p.outcome === "ready" ? "Ready" : humanize(p.outcome)}</StatusText>
      </div>
      {p.reasons.length > 0 && <p className="text-[13px] text-adm-muted">{p.reasons.map(humanize).join(", ")}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-1 text-[13px] font-semibold text-adm-ink">In the file</p>
          <KeyValueList rows={[
            { label: "Dealer", value: p.identity.dealerName || "Missing" },
            { label: "Address", value: [p.identity.address, p.identity.city, p.identity.region, p.identity.postal].filter(Boolean).join(", ") || "Missing" },
            { label: "Identity variants", value: p.identityVariants > 1 ? <StatusText tone="warning">{p.identityVariants} different identities share this DealerId</StatusText> : "1" },
          ]} />
        </div>
        <div>
          <p className="mb-1 text-[13px] font-semibold text-adm-ink">{live?.status === "approved" ? "Mapped store" : live ? "Proposed store" : "No store chosen"}</p>
          {mappedStore ? (
            <KeyValueList rows={[
              { label: "Store", value: mappedStore.display_name },
              { label: "Address", value: storeAddress(mappedStore) || "Not on record" },
              { label: "Mapping", value: live ? <StatusText tone={STATUS_TONE[live.status]}>{live.status}</StatusText> : "None" },
            ]} />
          ) : <p className="text-[13px] text-adm-muted">Nothing in this group is mapped to this DealerId.</p>}
        </div>
      </div>

      {cmp && mappedStore && (
        <div>
          <p className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-adm-ink">Evidence <StatusText tone={STATUS_TONE[cmp.verdict] ?? "neutral"}>{cmp.verdict}</StatusText></p>
          <WorkTable caption={`Identity comparison for DealerId ${p.sourceDealerId}`} inset>
            <thead><tr><Th>Field</Th><Th>In the file</Th><Th>Store on record</Th><Th>Result</Th></tr></thead>
            <tbody>{FIELD_ROWS.map(([label, k]) => (
              <tr key={k}><Td>{label}</Td><Td>{sourceValue(k) || "Missing"}</Td><Td>{storeValue(k) || "Not on record"}</Td><Td><StatusText tone={FIELD_TONE[cmp.fields[k]]}>{cmp.fields[k]}</StatusText></Td></tr>
            ))}</tbody>
          </WorkTable>
        </div>
      )}
      {changedSinceRun && <InlineNote tone="info" title="The mapping changed after this dry run.">Run the dry run again to refresh the comparison and outcome.</InlineNote>}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {counts.map(([k, v]) => <div key={k}><dt className="text-[12px] text-adm-muted">{k}</dt><dd className="text-[18px] leading-[24px] font-bold tabular-nums text-adm-ink">{v}</dd></div>)}
      </dl>
      {issues("Errors", p.errors)}
      {issues("Warnings", p.warnings)}

      <p className="text-[13px] text-adm-muted">
        {p.inventoryDiff?.compared
          ? `If imported: ${plural(p.inventoryDiff.additions, "addition")}, ${plural(p.inventoryDiff.updates, "update")}, ${p.inventoryDiff.unchanged} unchanged, ${plural(p.inventoryDiff.absenceCandidates, "vehicle")} absent from the file (reviewed, not removed).${p.inventoryDiff.shrinkGuard?.held ? ` The file is missing ${p.inventoryDiff.shrinkGuard.absent} of ${p.inventoryDiff.shrinkGuard.live} current vehicles, more than the ${p.inventoryDiff.shrinkGuard.allowed} the shrink guard allows, so absence would be held for review.` : ""}`
          : "Not compared with current inventory yet. That needs an approved mapping."}
      </p>

      <div className="space-y-3 border-t border-adm-border pt-3">
        {live && <MappingActions mapping={live} />}
        {!live && (
          <div className="flex flex-wrap items-end gap-3">
            <Button disabled={busy} onClick={() => startNewStore({ display_name: p.identity.dealerName, street: p.identity.address, city: p.identity.city, state: p.identity.region.toUpperCase(), zip: p.identity.postal })}>Create store from this identity</Button>
            <SelectField id={`pm-${p.sourceDealerId}`} label="Propose mapping to store" value={target} onChange={setTarget} options={[{ value: "", label: "Choose a store" }, ...stores.map((s) => ({ value: s.id, label: s.display_name }))]} className="min-w-[240px]" />
            <Button variant="primary" disabled={busy || !target || !runId} onClick={() => act(() => proposeMapping({ sourceDealerId: p.sourceDealerId, storeId: target, runId: runId! }), "Mapping proposed from the dry run. Review it in Store mapping review.")}>Propose mapping</Button>
          </div>
        )}
        {!live && <p className="text-[12px] text-adm-muted">Creating a store only opens the form prefilled. Review it and save, then propose the mapping.</p>}
      </div>
    </li>
  );
}

function FilePanel({ file, binding, tenantId, groupName, stores, mappings }: {
  file: FeedFile; binding: { status: "pending" | "approved" | "disabled"; tenant_id: string | null } | null; tenantId: string; groupName: string; stores: DealerStore[]; mappings: InventorySourceMapping[];
}) {
  const { act, busy } = useAct();
  const { overview } = useNet();
  const [imported, setImported] = useState<ImportNowResult | null>(null);
  const [armed, setArmed] = useState(false);
  const [ack, setAck] = useState(false);
  const runs = useQuery(boardQueries.runs);
  const mine = (runs.data ?? []).filter((r) => r.path === file.path);
  const latest = mine.find((r) => isPartitionReport(r.report));
  const report = latest && isPartitionReport(latest.report) ? latest.report : null;
  const parts = report?.partitions ?? [];
  const ready = parts.filter((p) => p.outcome === "ready").length;
  const held = parts.filter((p) => p.outcome !== "ready");
  const approved = binding?.status === "approved" && binding.tenant_id === tenantId;
  const c = overview.controls;
  const blocked = c?.emergency_stop ? "Emergency stop is on." : c?.ingestion_paused ? "Ingestion is paused." : null;
  const allMatch = parts.length > 0 && parts.every((p) => p.comparison?.verdict === "match");

  return (
    <Panel title={`File: ${fileName(file.path)}`} description={file.path}>
      <div className="space-y-5">
        {doNotMap(file) && <InlineNote tone="warning" title="Do not map this file">It looks like a test or deliberately held file. Map only production feeds.</InlineNote>}

        <div className="space-y-3">
          <h4 className="text-[14px] font-semibold text-adm-ink">File mapping</h4>
          <p className="text-[13px] text-adm-muted">
            {binding ? <>Status: <StatusText tone={STATUS_TONE[binding.status]}>{binding.status}</StatusText> {binding.tenant_id === tenantId ? `for ${groupName}` : "for a different dealer account"}</> : "This file is not mapped to a dealer account, so it stays in quarantine."}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {binding?.status !== "approved" && <Button disabled={busy} onClick={() => act(() => proposeBinding(file.path, tenantId), `File proposed for ${groupName}`)}>Propose binding to {groupName}</Button>}
            {binding?.status === "pending" && (
              <>
                {!allMatch && <CheckField id="bind-ack" label="I reviewed the identities and confirm this file belongs to this group" checked={ack} onChange={setAck} />}
                <Button variant="primary" disabled={busy || (!allMatch && !ack)} onClick={() => act(() => approveBinding(file.path, ack), "File binding approved")}>Approve binding</Button>
              </>
            )}
            {binding && binding.status !== "disabled" && <ConfirmButton label="Disable" confirmLabel="Disable binding" variant="danger" disabled={busy} onConfirm={() => act(() => disableBinding(file.path), "File binding disabled")} />}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-adm-border pt-4">
          <Button disabled={busy} onClick={() => act(() => partitionDryRun(file.path), "Dry run finished. No vehicles were changed.")}>Dry run</Button>
          {!armed ? (
            <Button variant="primary" disabled={busy || !approved || !!blocked} onClick={() => setArmed(true)}>Import now</Button>
          ) : (
            <span className="inline-flex items-center gap-2">
              <Button variant="primary" disabled={busy} onClick={async () => { setArmed(false); const r = await act(() => importNow(file.path), "Import finished"); if (r.ok) setImported(r.value); }}>Confirm import</Button>
              <Button variant="ghost" onClick={() => setArmed(false)}>Cancel</Button>
            </span>
          )}
          <span className="text-[12px] text-adm-muted">{!approved ? "Import needs an approved file binding for this group." : blocked ? `${blocked} Change it on Group overview.` : "Import changes inventory for ready partitions only."}</span>
        </div>

        {imported && (
          <div role="status" className="space-y-2 rounded-[6px] border border-adm-border bg-adm-workspace p-4">
            <p className="text-[14px] font-semibold text-adm-ink">
              {(() => { const ps = imported.result?.partitions ?? []; const ok = ps.filter((x) => x.status === "applied").length; const q = ps.filter((x) => x.status !== "applied").length; return `${ok} of ${ps.length} partitions applied${q ? `, ${q} not applied` : ""}`; })()}
            </p>
            <ul className="text-[13px] text-adm-muted">
              {(imported.result?.partitions ?? []).map((x) => <li key={x.sourceDealerId}>DealerId {x.sourceDealerId}: <StatusText tone={STATUS_TONE[x.status]}>{x.status}</StatusText> {humanize(x.reason)}</li>)}
              {!imported.result && <li>Job {imported.jobId} is {imported.status}. Check Runs and exceptions for the result.</li>}
            </ul>
          </div>
        )}

        <QueryState status={runs.isLoading ? "loading" : runs.isError ? "error" : "ready"} errorTitle="Could not load earlier runs" errorDetail={runs.isError ? explainError(runs.error) : undefined} onRetry={() => runs.refetch()}>
          {!report ? (
            <EmptyState title="No partition dry run for this file yet" detail="Run a dry run to see each dealer found in the file next to the store it would update. Nothing is changed." compact />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-[16px] font-semibold text-adm-ink">{ready} of {parts.length} partitions ready{held.length > 0 ? `, ${held.length} not ready` : ""}</p>
                <StatusText tone={report.outcome === "passed" ? "success" : "danger"}>{report.outcome}</StatusText>
                <span className="text-[12px] text-adm-muted">Dry run {when(latest!.started_at)}. No inventory writes, no paid calls.</span>
              </div>
              {held.length > 0 && ready > 0 && <InlineNote tone="info" title="Ready partitions import on their own.">The rest stay in quarantine until their mapping is sorted out.</InlineNote>}
              {report.outcome === "rejected" && <InlineNote tone="danger" title="The whole file was rejected">{report.rejectReasons.map(humanize).join(", ")}</InlineNote>}
              {(report.headers.missing.length > 0 || report.headers.extra.length > 0) && <InlineNote tone="warning" title="Column headers differ from the expected layout">{report.headers.missing.length > 0 && `Missing: ${report.headers.missing.join(", ")}. `}{report.headers.extra.length > 0 && `Unexpected: ${report.headers.extra.join(", ")}.`}</InlineNote>}
              <ul className="space-y-4">{parts.map((p) => <PartitionCard key={p.sourceDealerId} p={p} mappings={mappings} stores={stores} runId={latest?.status === "passed" ? latest.id : null} />)}</ul>
            </div>
          )}
        </QueryState>

        {mine.length > 0 && (
          <WorkTable caption="Earlier runs for this file" minWidth={560}>
            <thead><tr><Th>Started</Th><Th>Kind</Th><Th>Result</Th><Th>Reason</Th></tr></thead>
            <tbody>{mine.slice(0, 8).map((r) => <tr key={r.id}><Td>{when(r.started_at)}</Td><Td>{humanize(r.kind)}</Td><Td><StatusText tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</StatusText></Td><Td className="text-[12px]">{humanize(r.failure_reason)}</Td></tr>)}</tbody>
          </WorkTable>
        )}
      </div>
    </Panel>
  );
}

export default function MappingSection() {
  const { groupId, group, stores } = useNet();
  const { act, busy } = useAct();
  const [params, setParams] = useSearchParams();
  const files = useQuery(boardQueries.files);
  const bindings = useQuery(boardQueries.bindings);
  const mappings = useQuery({ queryKey: ["inv-net", "mappings", groupId], queryFn: () => listSourceMappings(groupId) });
  const storeRows = stores.map((s) => s.store);
  const sel = params.get("file");
  const file = (files.data ?? []).find((f) => f.path === sel) ?? null;
  const bindingOf = (path: string) => (bindings.data ?? []).find((b) => b.path === path) ?? null;
  const storeName = (id: string) => storeRows.find((s) => s.id === id)?.display_name ?? "Unknown store";
  const open = (mappings.data ?? []).filter((m) => m.status === "pending" || m.status === "approved");

  return (
    <div className="space-y-4">
      <MappingReviewBoard groupId={groupId} />
      <Panel
        title="Feed files"
        description="Each file may hold several dealers. Dry runs read the file and never change vehicles."
        flush
        action={<Button variant="primary" disabled={busy} onClick={() => act(() => discoverFiles(), "File discovery finished")}>Discover files</Button>}
      >
        <QueryState status={files.isLoading ? "loading" : files.isError ? "error" : (files.data ?? []).length === 0 ? "empty" : "ready"} errorTitle="Could not load feed files" errorDetail={files.isError ? explainError(files.error) : undefined} onRetry={() => files.refetch()} emptyTitle="No files recorded yet" emptyDetail="Press Discover files to list the inbound folder.">
          <WorkTable caption="Feed files" minWidth={860}>
            <thead><tr><Th>File</Th><Th>File mapping</Th><Th>Status</Th><Th>Modified</Th><Th align="right">Actions</Th></tr></thead>
            <tbody>
              {(files.data ?? []).map((f) => {
                const b = bindingOf(f.path);
                return (
                  <tr key={f.id} className={f.path === sel ? "bg-adm-selected/50" : undefined}>
                    <Td className="font-semibold">{fileName(f.path)}{doNotMap(f) && <span className="ml-2"><StatusText tone="warning">Do not map</StatusText></span>}</Td>
                    <Td>{b ? <StatusText tone={STATUS_TONE[b.status]}>{b.status}</StatusText> : <StatusText tone="neutral">Unmapped</StatusText>}</Td>
                    <Td><StatusText tone={STATUS_TONE[f.status] ?? "neutral"}>{f.status}</StatusText>{f.quarantine_reason && <span className="ml-1 text-[12px] text-adm-muted">{humanize(f.quarantine_reason)}</span>}</Td>
                    <Td>{when(f.remote_mtime)}</Td>
                    <Td align="right"><Button size="sm" onClick={() => setParams(new URLSearchParams({ view: "mapping", file: f.path }))}>Review</Button></Td>
                  </tr>
                );
              })}
            </tbody>
          </WorkTable>
        </QueryState>
      </Panel>

      {sel && !file && files.isSuccess && <Panel><EmptyState title="That file is no longer listed" detail="Run Discover files, or pick another file." compact /></Panel>}
      {file && <FilePanel key={file.path} file={file} binding={bindingOf(file.path)} tenantId={group.tenant_id} groupName={group.name} stores={storeRows} mappings={mappings.data ?? []} />}

      <Panel title="Source dealer mappings" description="Which feed DealerId feeds which store. Mappings are never inferred from file names." flush>
        <QueryState status={mappings.isLoading ? "loading" : mappings.isError ? "error" : open.length === 0 ? "empty" : "ready"} errorTitle="Could not load mappings" errorDetail={mappings.isError ? explainError(mappings.error) : undefined} onRetry={() => mappings.refetch()} emptyTitle="No mappings yet" emptyDetail="Run a dry run, then propose a mapping from each dealer found in the file.">
          <WorkTable caption="Source dealer mappings" minWidth={820}>
            <thead><tr><Th>DealerId</Th><Th>Store</Th><Th>Status</Th><Th>Evidence</Th><Th>Proposed</Th><Th>Actions</Th></tr></thead>
            <tbody>{open.map((m) => (
              <tr key={m.id}>
                <Td className="font-semibold">{m.source_dealer_id}<span className="block text-[12px] font-normal text-adm-muted">{m.observed_identity?.dealerName}</span></Td>
                <Td>{storeName(m.store_id)}</Td>
                <Td><StatusText tone={STATUS_TONE[m.status]}>{m.status}</StatusText></Td>
                <Td><StatusText tone={STATUS_TONE[m.evidence?.verdict ?? "incomplete"] ?? "neutral"}>{m.evidence?.verdict ?? "incomplete"}</StatusText></Td>
                <Td>{when(m.proposed_at)}</Td>
                <Td><MappingActions mapping={m} /></Td>
              </tr>
            ))}</tbody>
          </WorkTable>
        </QueryState>
      </Panel>
    </div>
  );
}
