import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button, Panel, QueryState, StatusText, Td, Th, WorkTable } from "@/components/product";
import {
  explainError, listAudit, listConflicts, listFeedEvents, listFeedJobs, listFeedRuns, listHeldSnapshots, listRetirementReview, listSnapshots, resolveConflict, resolveHeldSnapshot, retryJob, reviewRetirement,
  type DealerStore, type InventoryVinConflict,
} from "@/lib/inventoryNetwork/api";
import { ConfirmButton, NavLink, STATUS_TONE, fileName, humanize, shortId, useAct, useNet, when, inputClass } from "./shared";

type Panelkey = "timeline" | "held" | "conflicts" | "retirement" | "log";
const PANELS: Array<{ key: Panelkey; label: string }> = [{ key: "timeline", label: "Timeline" }, { key: "held", label: "Held files" }, { key: "conflicts", label: "VIN conflicts" }, { key: "retirement", label: "Retirement review" }, { key: "log", label: "Change log" }];

interface Item { key: string; at: string; type: "Event" | "Job" | "Run" | "Snapshot"; path: string; storeIds: string[]; dealerId?: string; runId: string | null; status: string; detail: string; retryJobId?: string }

function Timeline() {
  const { stores, href } = useNet();
  const { act, busy } = useAct();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const events = useQuery({ queryKey: ["inv-net", "events"], queryFn: () => listFeedEvents(100) });
  const jobs = useQuery({ queryKey: ["inv-net", "jobs"], queryFn: () => listFeedJobs(100) });
  const runs = useQuery({ queryKey: ["inv-net", "runs"], queryFn: () => listFeedRuns({ limit: 100 }) });
  const snaps = useQuery({ queryKey: ["inv-net", "snapshots"], queryFn: () => listSnapshots(100) });
  const names = useMemo(() => new Map(stores.map((s) => [s.store.id, s.store.display_name])), [stores]);
  const failed = [events, jobs, runs, snaps].find((x) => x.isError);
  const loading = [events, jobs, runs, snaps].some((x) => x.isLoading);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const e of events.data ?? []) out.push({ key: `e${e.id}`, at: e.received_at, type: "Event", path: e.path, storeIds: [], runId: null, status: "received", detail: humanize(e.action) });
    for (const j of jobs.data ?? []) {
      const parts = [`attempt ${j.attempts} of ${j.max_attempts}`, humanize(j.trigger)];
      if (j.status === "queued") parts.push(`next attempt ${when(j.next_attempt_at)}`);
      if (j.last_error) parts.push(`last error: ${humanize(j.last_error)}`);
      out.push({ key: `j${j.id}`, at: j.created_at, type: "Job", path: j.path, storeIds: [], runId: j.run_id, status: j.status, detail: parts.join(", "), retryJobId: j.status === "failed" || j.status === "dead" ? j.id : undefined });
    }
    for (const r of runs.data ?? []) out.push({ key: `r${r.id}`, at: r.started_at, type: "Run", path: r.path, storeIds: r.affected_store_ids ?? [], runId: r.id, status: r.status, detail: [humanize(r.kind), humanize(r.failure_reason)].filter(Boolean).join(", ") });
    for (const s of snaps.data ?? []) out.push({ key: `s${s.id}`, at: s.created_at, type: "Snapshot", path: s.path, storeIds: s.store_id ? [s.store_id] : [], dealerId: s.source_dealer_id, runId: s.run_id, status: s.status, detail: `${s.row_count} rows, ${s.invalid_count} invalid, ${s.duplicate_count} duplicate${s.reason ? `, ${humanize(s.reason)}` : ""}` });
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }, [events.data, jobs.data, runs.data, snaps.data]);

  const needle = q.trim().toLowerCase();
  const shown = items.filter((i) => !needle || [i.type, i.path, i.status, i.detail, i.runId, i.dealerId, ...i.storeIds.map((s) => names.get(s))].join(" ").toLowerCase().includes(needle)).slice(0, 200);
  const setQ = (v: string) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set("q", v); else n.delete("q"); return n; }, { replace: true });

  return (
    <Panel title="Timeline" description="Newest first. Search by file, store, status or run." flush action={<input aria-label="Search timeline" className={`${inputClass} w-64`} placeholder="Search file, store, status" value={q} onChange={(e) => setQ(e.target.value)} />}>
      <QueryState status={loading ? "loading" : failed ? "error" : shown.length === 0 ? "empty" : "ready"} errorTitle="Could not load the timeline" errorDetail={failed?.error ? explainError(failed.error) : undefined} onRetry={() => [events, jobs, runs, snaps].forEach((x) => x.refetch())} emptyTitle={needle ? "Nothing matches that search" : "No activity yet"} emptyDetail={needle ? undefined : "Feed notifications, jobs, runs and snapshots appear here as they happen."}>
        <WorkTable caption="Runs timeline" minWidth={1000}>
          <thead><tr><Th>When</Th><Th>Type</Th><Th>File</Th><Th>Store</Th><Th>Run</Th><Th>Status</Th><Th>Detail</Th><Th align="right">Actions</Th></tr></thead>
          <tbody>{shown.map((i) => (
            <tr key={i.key}>
              <Td>{when(i.at)}</Td>
              <Td>{i.type}</Td>
              <Td><NavLink to={href("mapping", { file: i.path })}>{fileName(i.path)}</NavLink></Td>
              <Td>{i.storeIds.length > 0 ? i.storeIds.map((id, n) => <span key={id}>{n > 0 && ", "}<NavLink to={href("stores", { store: id })}>{names.get(id) ?? "Unknown store"}</NavLink></span>) : i.dealerId ? <span className="text-adm-muted">Unmapped (DealerId {i.dealerId})</span> : <span className="text-adm-muted">None</span>}</Td>
              <Td>{i.runId ? <NavLink to={href("runs", { panel: "timeline", q: i.runId })}>{shortId(i.runId)}</NavLink> : <span className="text-adm-muted">None</span>}</Td>
              <Td><StatusText tone={STATUS_TONE[i.status] ?? "neutral"}>{i.status}</StatusText></Td>
              <Td className="text-[12px]">{i.detail}</Td>
              <Td align="right">{i.retryJobId && <Button size="sm" disabled={busy} onClick={() => act(() => retryJob(i.retryJobId!), "Job queued again")}>Retry</Button>}</Td>
            </tr>
          ))}</tbody>
        </WorkTable>
      </QueryState>
    </Panel>
  );
}

const storeLabel = (stores: DealerStore[], id: string | null) => stores.find((s) => s.id === id)?.display_name ?? "another store";

function explain(c: InventoryVinConflict, stores: DealerStore[]) {
  const claim = storeLabel(stores, c.claiming_store_id);
  const have = storeLabel(stores, c.existing_store_id);
  if (c.kind === "other_store") return `${claim}'s feed lists this VIN, but ${have} already holds it as live inventory. Transfer closes ${have}'s record so ${claim} can take it on the next import. Dismiss leaves it with ${have}.`;
  if (c.kind === "legacy_listing") return `A listing for this VIN existed before the network. Adopt links it to ${claim}'s feed record. Dismiss leaves the old listing unlinked.`;
  return `This VIN has a listing linked to ${have}. Nothing can be adopted automatically. Dismiss it once you have checked.`;
}

function Conflicts() {
  const { groupId, stores } = useNet();
  const { act, busy } = useAct();
  const rows = stores.map((s) => s.store);
  const q = useQuery({ queryKey: ["inv-net", "conflicts", groupId], queryFn: () => listConflicts(groupId) });
  return (
    <Panel title="VIN conflicts" description="The same VIN claimed by more than one place. Nothing merges on its own." flush>
      <QueryState status={q.isLoading ? "loading" : q.isError ? "error" : (q.data ?? []).length === 0 ? "empty" : "ready"} errorTitle="Could not load conflicts" errorDetail={q.isError ? explainError(q.error) : undefined} onRetry={() => q.refetch()} emptyTitle="No open conflicts">
        <WorkTable caption="VIN conflicts" minWidth={900}>
          <thead><tr><Th>VIN</Th><Th>Store claiming</Th><Th>What happened</Th><Th>First seen</Th><Th align="right">Actions</Th></tr></thead>
          <tbody>{(q.data ?? []).map((c) => (
            <tr key={c.id}>
              <Td className="font-mono text-[12px]">{c.vin}</Td>
              <Td>{storeLabel(rows, c.claiming_store_id)}</Td>
              <Td className="max-w-[420px] text-[12px]">{explain(c, rows)}</Td>
              <Td>{when(c.first_seen_at)}</Td>
              <Td align="right">
                <div className="flex flex-wrap justify-end gap-2">
                  {c.kind === "other_store" && <ConfirmButton label="Transfer" confirmLabel="Transfer VIN" disabled={busy} onConfirm={() => act(() => resolveConflict(c.id, "transfer"), "Transferred")} />}
                  {c.kind === "legacy_listing" && <Button size="sm" disabled={busy} onClick={() => act(() => resolveConflict(c.id, "adopt"), "Legacy listing adopted")}>Adopt legacy listing</Button>}
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => resolveConflict(c.id, "dismiss"), "Conflict dismissed")}>Dismiss</Button>
                </div>
              </Td>
            </tr>
          ))}</tbody>
        </WorkTable>
      </QueryState>
    </Panel>
  );
}

const HOLD_RULE: Record<string, string> = {
  absent_vs_live: "more of the store's current cars are missing than the guard allows",
  count_drop_vs_trusted: "the file has far fewer cars than the last trusted file",
};

function HeldFiles() {
  const { groupId, stores } = useNet();
  const { act, busy } = useAct();
  const rows = stores.map((s) => s.store);
  const [reason, setReason] = useState<Record<string, string>>({});
  const q = useQuery({ queryKey: ["inv-net", "held", groupId], queryFn: () => listHeldSnapshots(groupId) });
  return (
    <Panel title="Held files" description="Files that look incomplete. Nothing in them was applied: no prices, no new cars, no missing counts. Decide each one." flush>
      <QueryState status={q.isLoading ? "loading" : q.isError ? "error" : (q.data ?? []).length === 0 ? "empty" : "ready"} errorTitle="Could not load held files" errorDetail={q.isError ? explainError(q.error) : undefined} onRetry={() => q.refetch()} emptyTitle="No files are held">
        <WorkTable caption="Held files" minWidth={960}>
          <thead><tr><Th>Store</Th><Th>File</Th><Th>Why it is held</Th><Th align="right">In file</Th><Th align="right">Missing</Th><Th>Reason for decision</Th><Th align="right">Actions</Th></tr></thead>
          <tbody>{(q.data ?? []).map((s) => {
            const h = s.report?.hold;
            const why = (h?.rules ?? []).map((r) => HOLD_RULE[r] ?? humanize(r)).join("; ");
            const note = reason[s.id] ?? "";
            const ok = note.trim().length >= 3;
            return (
              <tr key={s.id}>
                <Td>{storeLabel(rows, s.store_id)}</Td>
                <Td>{fileName(s.path)}<div className="text-[12px] text-adm-muted">{when(s.created_at)}</div></Td>
                <Td>{why || "Held for review"}{h?.trusted_valid != null ? <div className="text-[12px] text-adm-muted">Last trusted file had {h.trusted_valid} cars</div> : null}</Td>
                <Td align="right">{s.valid_count}</Td>
                <Td align="right">{h ? `${h.absent} of ${h.live} (allowed ${h.allowed_absent})` : ""}</Td>
                <Td><input aria-label="Reason for decision" className={`${inputClass} w-56`} placeholder="Required" value={note} onChange={(e) => setReason((m) => ({ ...m, [s.id]: e.target.value }))} /></Td>
                <Td align="right">
                  <div className="flex justify-end gap-2">
                    <ConfirmButton label="Apply as complete" confirmLabel="Count missing cars" variant="danger" disabled={busy || !ok} onConfirm={() => act(() => resolveHeldSnapshot(s.id, "apply_full", note), "File applied as complete")} />
                    <Button size="sm" disabled={busy || !ok} onClick={() => act(() => resolveHeldSnapshot(s.id, "apply_without_absence", note), "File applied without missing counts")}>Apply without missing</Button>
                    <Button size="sm" variant="ghost" disabled={busy || !ok} onClick={() => act(() => resolveHeldSnapshot(s.id, "reject", note), "File rejected")}>Reject</Button>
                  </div>
                </Td>
              </tr>
            );
          })}</tbody>
        </WorkTable>
      </QueryState>
    </Panel>
  );
}

function Retirement() {
  const { groupId, stores } = useNet();
  const { act, busy } = useAct();
  const rows = stores.map((s) => s.store);
  const q = useQuery({ queryKey: ["inv-net", "retirement", groupId], queryFn: () => listRetirementReview(groupId) });
  return (
    <Panel title="Retirement review" description="Vehicles missing from several clean feeds in a row. Retire removes them from customer views. Keep puts them back on watch." flush>
      <QueryState status={q.isLoading ? "loading" : q.isError ? "error" : (q.data ?? []).length === 0 ? "empty" : "ready"} errorTitle="Could not load retirement review" errorDetail={q.isError ? explainError(q.error) : undefined} onRetry={() => q.refetch()} emptyTitle="No vehicles waiting for review">
        <WorkTable caption="Retirement review" minWidth={820}>
          <thead><tr><Th>Store</Th><Th>Vehicle</Th><Th>VIN</Th><Th>Stock</Th><Th align="right">Missed feeds</Th><Th>Last seen</Th><Th align="right">Actions</Th></tr></thead>
          <tbody>{(q.data ?? []).map((v) => (
            <tr key={v.id}>
              <Td>{storeLabel(rows, v.store_id)}</Td>
              <Td>{[v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || "Unknown"}</Td>
              <Td className="font-mono text-[12px]">{v.vin}</Td>
              <Td>{v.stock_number ?? ""}</Td>
              <Td align="right">{v.missing_snapshots}</Td>
              <Td>{when(v.last_seen_at)}</Td>
              <Td align="right">
                <div className="flex justify-end gap-2">
                  <ConfirmButton label="Retire" confirmLabel="Retire vehicle" variant="danger" disabled={busy} onConfirm={() => act(() => reviewRetirement(v.id, "retire"), "Vehicle retired")} />
                  <Button size="sm" disabled={busy} onClick={() => act(() => reviewRetirement(v.id, "keep"), "Vehicle kept")}>Keep</Button>
                </div>
              </Td>
            </tr>
          ))}</tbody>
        </WorkTable>
      </QueryState>
    </Panel>
  );
}

function ChangeLog() {
  const { groupId, stores } = useNet();
  const q = useQuery({ queryKey: ["inv-net", "audit", groupId], queryFn: () => listAudit(groupId) });
  const name = (id: string | null) => (id ? stores.find((s) => s.store.id === id)?.store.display_name ?? "Unknown store" : "Group");
  return (
    <Panel title="Change log" description="Every setting change in this group, newest first." flush>
      <QueryState status={q.isLoading ? "loading" : q.isError ? "error" : (q.data ?? []).length === 0 ? "empty" : "ready"} errorTitle="Could not load the change log" errorDetail={q.isError ? explainError(q.error) : undefined} onRetry={() => q.refetch()} emptyTitle="No changes recorded yet">
        <WorkTable caption="Change log" minWidth={640}>
          <thead><tr><Th>When</Th><Th>Store</Th><Th>What</Th><Th>Action</Th></tr></thead>
          <tbody>{(q.data ?? []).map((a) => <tr key={a.id}><Td>{when(a.at)}</Td><Td>{name(a.store_id)}</Td><Td>{humanize(a.entity)}</Td><Td>{humanize(a.action)}</Td></tr>)}</tbody>
        </WorkTable>
      </QueryState>
    </Panel>
  );
}

export default function RunsSection() {
  const { href } = useNet();
  const [params] = useSearchParams();
  const panel = (PANELS.find((p) => p.key === params.get("panel"))?.key ?? "timeline") as Panelkey;
  return (
    <div className="space-y-4">
      <nav aria-label="Runs and exceptions panels" className="flex flex-wrap gap-2">
        {PANELS.map((p) => (
          <Link key={p.key} to={href("runs", { panel: p.key })} aria-current={panel === p.key ? "page" : undefined} className={`min-h-[36px] rounded-full border px-3.5 py-1.5 text-[13px] font-medium ${panel === p.key ? "border-adm-primary bg-adm-selected text-adm-primary" : "border-adm-border bg-adm-surface text-adm-ink hover:bg-adm-workspace"}`}>{p.label}</Link>
        ))}
      </nav>
      {panel === "timeline" && <Timeline />}
      {panel === "held" && <HeldFiles />}
      {panel === "conflicts" && <Conflicts />}
      {panel === "retirement" && <Retirement />}
      {panel === "log" && <ChangeLog />}
    </div>
  );
}
