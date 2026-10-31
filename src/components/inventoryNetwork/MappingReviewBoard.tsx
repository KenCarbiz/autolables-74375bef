import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { Button, EmptyState, InlineNote, KeyValueList, Panel, SkeletonBlock, StatusText, Td, Th, WorkTable, type Tone } from "@/components/product";
import { ICON } from "@/components/admin/v2/primitives";
import { cn } from "@/lib/utils";
import {
  decideMapping, explainError, importNow, isSetupError, listFeedBindings, listFeedControls, listFeedFiles, listFeedRuns, listGroups, listAllStores, listOpenMappings,
  partitionDryRun, previewMapping, proposeMapping, saveStore,
  type DealerGroup, type DealerStore, type FieldVerdict, type MappingComparison,
} from "@/lib/inventoryNetwork/api";
import { buildMappingRows, STATE_LABEL, type MappingRow, type MappingState } from "@/lib/inventoryNetwork/mappingBoard";
import { IconButton, NetIcon, type NetIconName } from "./icons";

const CONSOLE = "/admin/integrations/inventory-network";
export const storeHref = (id: string) => `${CONSOLE}?view=stores&store=${encodeURIComponent(id)}`;

export const boardQueries = {
  files: { queryKey: ["inv-net", "board", "files"], queryFn: listFeedFiles },
  runs: { queryKey: ["inv-net", "board", "runs"], queryFn: () => listFeedRuns({ limit: 200, withReport: true }) },
  mappings: { queryKey: ["inv-net", "board", "mappings"], queryFn: listOpenMappings },
  stores: { queryKey: ["inv-net", "board", "stores"], queryFn: listAllStores },
  groups: { queryKey: ["inv-net", "board", "groups"], queryFn: listGroups },
  bindings: { queryKey: ["inv-net", "board", "bindings"], queryFn: listFeedBindings },
  controls: { queryKey: ["inv-net", "board", "controls"], queryFn: listFeedControls },
} as const;

const STATE_TONE: Record<MappingState, Tone> = {
  source_unread: "neutral", stale: "warning", validation_failed: "danger", unmapped: "neutral", proposed: "info", identity_conflict: "danger",
  ready_for_approval: "info", approved_paused: "warning", approved: "success", imported: "success",
};
const STATE_ICON: Record<MappingState, NetIconName> = {
  source_unread: "feedFile", stale: "refresh", validation_failed: "warning", unmapped: "mapping", proposed: "identityReview", identity_conflict: "conflict",
  ready_for_approval: "approval", approved_paused: "paused", approved: "approval", imported: "import",
};
const VERDICT_TONE: Record<string, Tone> = { match: "success", name_review: "warning", incomplete: "warning", mismatch: "danger" };
const FIELD_TONE: Record<string, Tone> = { match: "success", mismatch: "danger", differs: "warning", unknown: "neutral" };
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : "Never");
const humanize = (s: string | null | undefined) => (s ? s.replace(/_/g, " ") : "");
const fileName = (p: string) => p.split("/").pop() ?? p;
const shortHash = (h: string | null | undefined) => (h ? h.slice(0, 12) : "Unknown");
const address = (o: { street?: string | null; address?: string | null; city?: string | null; state?: string | null; region?: string | null; zip?: string | null; postal?: string | null } | null) =>
  o ? [o.street ?? o.address, [o.city, o.state ?? o.region].filter(Boolean).join(", "), o.zip ?? o.postal].filter(Boolean).join(" ") : "";

function useBoardAct() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: Tone; text: string } | null>(null);
  const act = async <T,>(fn: () => Promise<T>, success: string): Promise<{ ok: true; value: T } | { ok: false }> => {
    setBusy(true);
    try {
      const value = await fn();
      setNotice({ tone: "success", text: success });
      qc.invalidateQueries({ queryKey: ["inv-net"] });
      qc.invalidateQueries({ queryKey: ["filescom-overview"] });
      return { ok: true, value };
    } catch (e) {
      setNotice({ tone: "danger", text: explainError(e) });
      return { ok: false };
    } finally {
      setBusy(false);
    }
  };
  return { act, busy, notice, setNotice };
}
type Act = ReturnType<typeof useBoardAct>["act"];

function Drawer({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); if (prior && document.contains(prior)) prior.focus(); };
  }, []);
  return (
    <aside ref={ref} role="dialog" aria-label={label} tabIndex={-1} className="fixed bottom-0 right-0 top-16 z-30 flex w-full max-w-[760px] flex-col overflow-y-auto border-l border-adm-border bg-adm-surface shadow-[var(--al-floating-shadow)] outline-none">
      <div className="flex items-center justify-between gap-3 border-b border-adm-border px-5 py-3">
        <h3 className="text-[16px] font-semibold text-adm-ink">{label}</h3>
        <button type="button" aria-label="Close" onClick={onClose} className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary"><X className={ICON.inSquare} aria-hidden="true" /></button>
      </div>
      <div className="space-y-5 p-5">{children}</div>
    </aside>
  );
}

const FIELDS: Array<[string, "name" | "street" | "city" | "state" | "zip"]> = [["Name", "name"], ["Street", "street"], ["City", "city"], ["State", "state"], ["ZIP", "zip"]];

function IdentityTable({ c }: { c: MappingComparison }) {
  const storeName = c.store ? [c.store.name, c.store.legal_name].filter(Boolean).join(" / ") : null;
  return (
    <WorkTable caption="Identity comparison" inset>
      <thead><tr><Th>Field</Th><Th>In the CSV</Th><Th>Store on record</Th><Th>Result</Th></tr></thead>
      <tbody>{FIELDS.map(([label, k]) => {
        const r = (c.fields[k] ?? "unknown") as FieldVerdict | "differs";
        const store = k === "name" ? storeName : c.store?.[k];
        return <tr key={k}><Td>{label}</Td><Td>{c.observed?.[k] || "Missing"}</Td><Td>{store || "Missing"}</Td><Td><StatusText tone={FIELD_TONE[r]}>{r}</StatusText></Td></tr>;
      })}</tbody>
    </WorkTable>
  );
}

function ReviewBody({ row, stores, act, busy, onCreate }: { row: MappingRow; stores: DealerStore[]; act: Act; busy: boolean; onCreate: () => void }) {
  const [pick, setPick] = useState(row.mapping?.store_id ?? "");
  const [ack, setAck] = useState(false);
  const runId = row.mapping?.evidence?.run_id ?? row.run?.id ?? "";
  const storeId = row.mapping?.store_id ?? pick;
  const canPreview = !!row.dealerId && !!storeId && !!runId;
  const q = useQuery({ queryKey: ["inv-net", "board", "preview", row.dealerId, storeId, runId], queryFn: () => previewMapping(row.dealerId!, storeId, runId), enabled: canPreview });
  const c = q.data?.comparison ?? null;
  const verdict = c?.verdict ?? null;
  const legacy = row.mapping?.status === "pending" && row.mapping.evidence?.computed_by !== "server";
  const approvable = verdict === "match" || (verdict === "name_review" && ack);
  const counts = q.data?.partition.counts ?? row.partition?.counts ?? null;

  return (
    <div className="space-y-5">
      <KeyValueList rows={[
        { label: "DealerId", value: <code className="text-[13px]">{row.dealerId}</code> },
        { label: "Dry run", value: <code className="text-[13px]">{runId || "None"}</code> },
        { label: "File hash", value: <code className="text-[13px]">{shortHash(q.data?.content_sha256 ?? row.run?.content_sha256)}</code> },
        { label: "File modified", value: when(q.data?.remote_mtime ?? row.run?.remote_mtime ?? row.file.remote_mtime) },
        { label: "Rows", value: counts ? `${counts.rows} rows, ${counts.valid} valid, ${counts.invalid} invalid` : "Unknown" },
        { label: "Blank prices", value: counts ? `${counts.priceMissing} blank, ${counts.priceZero} zero` : "Unknown" },
      ]} />

      {!row.mapping && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px]">
            <label htmlFor="rv-store" className="mb-1 block text-[13px] font-semibold text-adm-ink">Destination store</label>
            <select id="rv-store" className="w-full rounded-[4px] border border-adm-border bg-adm-surface px-3 py-2 text-[14px]" value={pick} onChange={(e) => { setPick(e.target.value); setAck(false); }}>
              <option value="">Choose a store</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.display_name}{s.city ? `, ${s.city}` : ""}</option>)}
            </select>
          </div>
          <Button onClick={onCreate}><NetIcon name="store" />Create store from reviewed identity</Button>
        </div>
      )}

      {!canPreview && !row.mapping && <p className="text-[13px] text-adm-muted">Choose a store to compare identities. Nothing is saved until you propose.</p>}
      {q.isLoading && canPreview && <SkeletonBlock className="h-40 w-full" />}
      {q.isError && <InlineNote tone="danger" title="Could not compare identities">{explainError(q.error)}</InlineNote>}
      {c && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <NetIcon name="identityReview" />
            <span className="text-[14px] font-semibold text-adm-ink">Server comparison</span>
            <StatusText tone={VERDICT_TONE[c.verdict]}>{humanize(c.verdict)}</StatusText>
            {c.verdict === "match" && row.mapping?.status === "approved" && <NetIcon name="verified" className="text-adm-success" label="Verified mapping" />}
          </div>
          <IdentityTable c={c} />
          {c.verdict === "mismatch" && <InlineNote tone="danger" title="Address does not match. A mismatch can never be approved." action={storeId ? <Link className="text-[13px] font-semibold underline" to={storeHref(storeId)}>Fix store identity</Link> : undefined}>If the store record is wrong, fix it, then review again. Otherwise choose a different store.</InlineNote>}
          {c.verdict === "incomplete" && <InlineNote tone="warning" title="Identity incomplete" action={storeId ? <Link className="text-[13px] font-semibold underline" to={storeHref(storeId)}>Fix store identity</Link> : undefined}>A field is missing on the file or the store, so it cannot be approved yet.</InlineNote>}
          {c.verdict === "name_review" && (
            <label className="flex items-start gap-3 text-[14px]">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>The address matches. I confirm <strong>{c.observed?.name}</strong> is a name used by <strong>{c.store?.name}</strong>.</span>
            </label>
          )}
        </div>
      )}

      {legacy && <InlineNote tone="warning" title="This proposal predates server-checked review">Reject it, then propose again from the dry run.</InlineNote>}

      <div className="flex flex-wrap items-center gap-3 border-t border-adm-border pt-4">
        {!row.mapping && (
          <Button variant="primary" disabled={busy || !c || !(verdict === "match" || verdict === "name_review") || !row.run} onClick={() => act(() => proposeMapping({ sourceDealerId: row.dealerId!, storeId: pick, runId: row.run!.id }), "Mapping proposed from the dry run")}>
            <NetIcon name="mapping" />Propose mapping
          </Button>
        )}
        {row.mapping?.status === "pending" && (
          <>
            <Button variant="primary" disabled={busy || legacy || !approvable} onClick={() => act(() => decideMapping(row.mapping!.id, "approve", verdict === "name_review" && ack), "Mapping approved")}>
              <NetIcon name="approval" />Approve mapping
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => act(() => decideMapping(row.mapping!.id, "reject"), "Mapping rejected")}>Reject</Button>
          </>
        )}
        {row.mapping?.status === "approved" && <RevokeButton busy={busy} onConfirm={() => act(() => decideMapping(row.mapping!.id, "revoke"), "Mapping revoked. Vehicles stay with their store.")} />}
        {!row.mapping && c && (c.verdict === "mismatch" || c.verdict === "incomplete") && <span className="text-[12px] text-adm-muted">Proposing is blocked until the identity matches.</span>}
      </div>
    </div>
  );
}

function RevokeButton({ busy, onConfirm }: { busy: boolean; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <span className="inline-flex gap-2"><Button variant="danger" disabled={busy} onClick={() => { setArmed(false); onConfirm(); }}>Confirm revoke</Button><Button variant="ghost" onClick={() => setArmed(false)}>Cancel</Button></span>
  ) : <Button variant="danger" disabled={busy} onClick={() => setArmed(true)}>Revoke mapping</Button>;
}

function CreateStoreForm({ row, groups, defaultGroupId, act, busy, onCreated }: { row: MappingRow; groups: DealerGroup[]; defaultGroupId: string; act: Act; busy: boolean; onCreated: (id: string) => void }) {
  const o = row.observed;
  const [f, setF] = useState({ group_id: defaultGroupId, display_name: o?.dealerName ?? "", street: o?.address ?? "", city: o?.city ?? "", state: (o?.region ?? "").toUpperCase(), zip: o?.postal ?? "" });
  const [created, setCreated] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const problems: string[] = [];
  if (!f.group_id) problems.push("Choose a dealer group.");
  if (f.display_name.trim().length < 2 || f.display_name.trim().length > 120) problems.push("Name must be 2 to 120 characters.");
  if (f.state && !/^[A-Z]{2}$/.test(f.state)) problems.push("State must be two letters.");
  if (f.zip && !/^[0-9]{5}(-[0-9]{4})?$/.test(f.zip.trim())) problems.push("ZIP must be five digits or ZIP+4.");
  const group = groups.find((g) => g.id === f.group_id);
  const input = (k: keyof typeof f, label: string) => (
    <div>
      <label htmlFor={`cs-${k}`} className="mb-1 block text-[13px] font-semibold text-adm-ink">{label}</label>
      <input id={`cs-${k}`} className="w-full rounded-[4px] border border-adm-border bg-adm-surface px-3 py-2 text-[14px]" value={f[k]} onChange={(e) => set(k, k === "state" ? e.target.value.toUpperCase() : e.target.value)} />
    </div>
  );
  const create = async () => {
    const r = await act(() => saveStore({ group_id: f.group_id, display_name: f.display_name.trim(), street: f.street.trim(), city: f.city.trim(), state: f.state.trim(), zip: f.zip.trim() }), "Store created from the reviewed identity");
    if (r.ok) setCreated(r.value);
  };
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-adm-muted">Prefilled from the CSV identity for DealerId <code>{row.dealerId}</code>. Edit anything that is wrong before creating.</p>
      <div>
        <label htmlFor="cs-group" className="mb-1 block text-[13px] font-semibold text-adm-ink">Dealer group</label>
        <select id="cs-group" className="w-full rounded-[4px] border border-adm-border bg-adm-surface px-3 py-2 text-[14px]" value={f.group_id} onChange={(e) => set("group_id", e.target.value)} disabled={!!created}>
          <option value="">Choose a group</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>
      <div className="grid gap-4 md:grid-cols-2">{input("display_name", "Display name")}{input("street", "Street")}{input("city", "City")}<div className="grid grid-cols-2 gap-4">{input("state", "State")}{input("zip", "ZIP")}</div></div>
      <div aria-label="Store preview" className="rounded-[6px] border border-adm-border bg-adm-workspace p-4 text-[13px]">
        <p className="font-semibold text-adm-ink">{f.display_name || "Unnamed store"}</p>
        <p className="text-adm-muted">{address(f) || "No address"}{group ? `. Group: ${group.name}` : ""}</p>
        <p className="mt-2 text-adm-muted">Created unsubscribed, with the customer browser, listing sync, sharing and MarketCheck all off. Change those later in store settings.</p>
      </div>
      {problems.length > 0 && <InlineNote tone="warning" title="Fix before creating">{problems.join(" ")}</InlineNote>}
      {!created ? (
        <Button variant="primary" disabled={busy || problems.length > 0} onClick={create}><NetIcon name="store" />Create store</Button>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <StatusText tone="success">Store created</StatusText>
          <Button variant="primary" disabled={busy || !row.run} onClick={async () => { const r = await act(() => proposeMapping({ sourceDealerId: row.dealerId!, storeId: created, runId: row.run!.id }), "Mapping proposed from the dry run"); if (r.ok) onCreated(created); }}>
            <NetIcon name="mapping" />Propose mapping to this store
          </Button>
          <Link className="text-[13px] font-semibold text-adm-primary underline" to={storeHref(created)}>Open store settings</Link>
        </div>
      )}
    </div>
  );
}

type DrawerMode = "source" | "review" | "store" | "create";

function Strip({ row, open }: { row: MappingRow; open: (m: DrawerMode) => void }) {
  const stage = (mode: DrawerMode, icon: NetIconName, title: string, value: string, status: ReactNode) => (
    <button type="button" onClick={() => open(mode)} className="flex min-w-[180px] flex-1 items-start gap-3 rounded-[6px] border border-adm-border bg-adm-surface p-3 text-left hover:border-adm-primary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary">
      <NetIcon name={icon} className="mt-0.5 text-adm-muted" />
      <span className="min-w-0"><span className="block text-[12px] text-adm-muted">{title}</span><span className="block truncate text-[14px] font-semibold text-adm-ink">{value}</span><span className="mt-1 block">{status}</span></span>
    </button>
  );
  return (
    <nav aria-label="Source to store" className="flex flex-col gap-2 md:flex-row md:items-stretch">
      {stage("source", "feedFile", "Source", `${fileName(row.path)} / ${row.dealerId ?? "unread"}`, <StatusText tone={row.run ? (row.run.status === "passed" ? "success" : "danger") : "neutral"}>{row.run ? `Dry run ${row.run.status}` : "No dry run"}</StatusText>)}
      <span aria-hidden="true" className="hidden self-center text-adm-muted md:block"><NetIcon name="mapping" /></span>
      {stage("review", "identityReview", "Mapping", row.mapping ? row.mapping.status : "None", <StatusText tone={STATE_TONE[row.state]}>{STATE_LABEL[row.state]}</StatusText>)}
      <span aria-hidden="true" className="hidden self-center text-adm-muted md:block"><NetIcon name="mapping" /></span>
      {stage(row.store ? "store" : "create", "store", "Store", row.store?.display_name ?? "No store", <StatusText tone={row.store ? "info" : "neutral"}>{row.group?.name ?? "No group"}</StatusText>)}
    </nav>
  );
}

function Detail({ row, stores, groups, defaultGroupId, act, busy }: { row: MappingRow; stores: DealerStore[]; groups: DealerGroup[]; defaultGroupId: string; act: Act; busy: boolean }) {
  const [mode, setMode] = useState<DrawerMode | null>(null);
  const [armed, setArmed] = useState(false);
  const importBlock = row.mapping?.status !== "approved" ? "Approve the mapping first." : row.pausedReason ? `${row.pausedReason}.` : null;
  const candidates = stores.filter((s) => !row.bindingGroup || s.group_id === row.bindingGroup.id);
  return (
    <Panel title={`${fileName(row.path)} / ${row.dealerId ?? "no dry run"}`} description={row.nextAction === "None" ? "Nothing to do." : `Next: ${row.nextAction}`}>
      <div className="space-y-4">
        <Strip row={row} open={setMode} />
        <div className="flex flex-wrap items-center gap-3 border-t border-adm-border pt-4">
          <Button disabled={busy} onClick={() => act(() => partitionDryRun(row.path), "Dry run finished. No vehicles were changed.")}><NetIcon name="dryRun" />Run dry run</Button>
          {!armed ? (
            <Button variant="primary" disabled={busy || !!importBlock} onClick={() => setArmed(true)}><NetIcon name="import" />Import now</Button>
          ) : (
            <span className="inline-flex gap-2">
              <Button variant="primary" disabled={busy} onClick={() => { setArmed(false); act(() => importNow(row.path), "Import finished"); }}>Confirm import</Button>
              <Button variant="ghost" onClick={() => setArmed(false)}>Cancel</Button>
            </span>
          )}
          <span className="text-[12px] text-adm-muted">{importBlock ? `Import is unavailable: ${importBlock}` : "Imports ready partitions of this file. Never calls MarketCheck."}</span>
        </div>
      </div>
      {mode === "source" && (
        <Drawer label="Source partition" onClose={() => setMode(null)}>
          <KeyValueList rows={[
            { label: "File", value: <span className="break-all">{row.path}</span> },
            { label: "DealerId", value: <code>{row.dealerId ?? "Unknown"}</code> },
            { label: "Observed dealer", value: row.observed?.dealerName || "Missing" },
            { label: "Observed address", value: address(row.observed) || "Missing" },
            { label: "Dry run", value: row.run ? `${row.run.id} (${row.run.status}, ${when(row.run.finished_at)})` : "None" },
            { label: "File hash", value: <code>{shortHash(row.file.last_content_sha256)}</code> },
            { label: "Last arrival", value: when(row.lastArrival) },
            { label: "Validation", value: row.partition ? `${humanize(row.partition.outcome)}${row.partition.reasons.length ? `: ${row.partition.reasons.map(humanize).join(", ")}` : ""}` : "Not read" },
          ]} />
          {row.stale && <InlineNote tone="warning" title="The file changed after this dry run">Run a new dry run before reviewing.</InlineNote>}
          {row.partition && row.partition.errors.length > 0 && <ul className="space-y-0.5 text-[12px] text-adm-muted">{row.partition.errors.slice(0, 8).map((e, i) => <li key={i}>Row {e.row}{e.vin ? ` (${e.vin})` : ""}: {humanize(e.code)}</li>)}</ul>}
        </Drawer>
      )}
      {mode === "review" && (
        <Drawer label="Identity review" onClose={() => setMode(null)}>
          {!row.partition || !row.run ? <EmptyState title="No dry run to review" detail="Run a dry run of this file first." compact /> : <ReviewBody row={row} stores={candidates} act={act} busy={busy} onCreate={() => setMode("create")} />}
        </Drawer>
      )}
      {mode === "store" && row.store && (
        <Drawer label="Destination store" onClose={() => setMode(null)}>
          <KeyValueList rows={[
            { label: "Store", value: row.store.display_name },
            { label: "Legal name", value: row.store.legal_name ?? "Not set" },
            { label: "Address", value: address(row.store) || "Not set" },
            { label: "Group", value: row.group?.name ?? "Unknown" },
            { label: "Feed", value: row.store.inventory_feed_enabled ? (row.store.feed_import_paused ? "On, import paused" : "On") : "Off" },
            { label: "Subscription", value: humanize(row.store.subscription_status) },
          ]} />
          <Link className="inline-flex items-center gap-2 text-[14px] font-semibold text-adm-primary underline" to={storeHref(row.store.id)}><NetIcon name="store" />Open store settings</Link>
        </Drawer>
      )}
      {mode === "create" && (
        <Drawer label="Create store from reviewed identity" onClose={() => setMode(null)}>
          {!row.observed ? <EmptyState title="No identity to start from" detail="Run a dry run first." compact /> : <CreateStoreForm row={row} groups={groups} defaultGroupId={row.bindingGroup?.id ?? defaultGroupId} act={act} busy={busy} onCreated={() => setMode(null)} />}
        </Drawer>
      )}
    </Panel>
  );
}

export function MappingReviewBoard({ groupId = null }: { groupId?: string | null }) {
  const files = useQuery(boardQueries.files);
  const runs = useQuery(boardQueries.runs);
  const mappings = useQuery(boardQueries.mappings);
  const stores = useQuery(boardQueries.stores);
  const groups = useQuery(boardQueries.groups);
  const bindings = useQuery(boardQueries.bindings);
  const controls = useQuery(boardQueries.controls);
  const all = [files, runs, mappings, stores, groups, bindings, controls];
  const { act, busy, notice, setNotice } = useBoardAct();
  const [sel, setSel] = useState<string | null>(null);
  const loading = all.some((q) => q.isLoading);
  const failed = all.find((q) => q.isError);
  const setup = all.some((q) => q.isError && isSetupError(q.error));
  const fetching = all.some((q) => q.isFetching);

  const board = useMemo(() => buildMappingRows({
    files: files.data ?? [], runs: runs.data ?? [], mappings: mappings.data ?? [], stores: stores.data ?? [], groups: groups.data ?? [], bindings: bindings.data ?? [], controls: controls.data?.[0] ?? null,
  }), [files.data, runs.data, mappings.data, stores.data, groups.data, bindings.data, controls.data]);
  const rows = groupId ? board.production.filter((r) => !r.store || r.store.group_id === groupId || r.bindingGroup?.id === groupId) : board.production;
  const row = rows.find((r) => r.key === sel) ?? null;
  const ready = rows.filter((r) => r.state === "imported" || r.state === "approved" || r.state === "approved_paused").length;

  return (
    <div className="space-y-4">
      <Panel
        title={<span className="inline-flex items-center gap-2"><NetIcon name="group" />Store mapping review</span>}
        description="One row per DealerId found in the latest dry run of each production file. DealerIds are shown exactly as they appear in the CSV."
        flush
        action={<IconButton name="refresh" label="Refresh mapping data" spinning={fetching} disabled={fetching} onClick={() => all.forEach((q) => q.refetch())} />}
      >
        <div className="space-y-3 px-4 pb-4">
          {notice && <InlineNote tone={notice.tone} title={notice.text} action={<Button size="sm" variant="ghost" onClick={() => setNotice(null)}>Dismiss</Button>} />}
          {setup && <InlineNote tone="warning" title="Setup required">The store mapping database update has not been applied to this project yet, so mappings cannot be reviewed.</InlineNote>}
          {failed && !setup && <InlineNote tone="danger" title="Could not load mapping data" action={<Button size="sm" onClick={() => all.forEach((q) => q.refetch())}>Retry</Button>}>{explainError(failed.error)}</InlineNote>}
          {!loading && !failed && rows.length > 0 && <p className="text-[13px] text-adm-muted">{ready} of {rows.length} DealerIds approved or imported.</p>}
        </div>
        {loading ? <div className="p-4"><SkeletonBlock className="h-40 w-full" /></div> : !failed && (rows.length === 0 ? (
          <EmptyState title="No production files yet" detail="Discover files, then run a dry run to see each DealerId in them." compact />
        ) : (
          <WorkTable caption="Store mapping review" minWidth={1500} dense>
            <thead><tr><Th>Source file</Th><Th>DealerId</Th><Th>Observed store / address</Th><Th>Destination store</Th><Th>Group</Th><Th align="right">Rows / new / used</Th><Th>Identity</Th><Th>Validation</Th><Th>Approval</Th><Th>Last arrival</Th><Th>Last import</Th><Th>Next action</Th></tr></thead>
            <tbody>{rows.map((r) => {
              const c = r.partition?.counts;
              const verdict = r.mapping?.evidence?.computed_by === "server" ? r.mapping.evidence.verdict ?? null : null;
              return (
                <tr key={r.key} className={cn("cursor-pointer hover:bg-adm-workspace", r.key === sel && "bg-adm-selected/50")} onClick={() => setSel(r.key)}>
                  <Td><button type="button" className="inline-flex items-center gap-2 text-left font-semibold text-adm-primary hover:underline" onClick={(e) => { e.stopPropagation(); setSel(r.key); }}><NetIcon name="feedFile" />{fileName(r.path)}</button></Td>
                  <Td><code className="text-[12px]">{r.dealerId ?? "Unread"}</code></Td>
                  <Td>{r.observed ? <><span className="font-medium">{r.observed.dealerName || "No name"}</span><span className="block text-[12px] text-adm-muted">{address(r.observed)}</span></> : <span className="text-adm-muted">Not read</span>}</Td>
                  <Td>{r.store ? <span className="inline-flex items-center gap-1.5"><NetIcon name="store" className="text-adm-muted" />{r.store.display_name}{r.store.is_primary_inventory_store && <NetIcon name="homeStore" className="text-adm-muted" label="Primary store" />}</span> : <span className="text-adm-muted">None</span>}</Td>
                  <Td>{r.group?.name ?? (r.bindingGroup ? `${r.bindingGroup.name} (file)` : <span className="text-adm-muted">None</span>)}</Td>
                  <Td align="right">{c ? `${c.rows} / ${c.new ?? "n/a"} / ${c.used ?? "n/a"}` : "n/a"}</Td>
                  <Td>{verdict ? <span className="inline-flex items-center gap-1"><StatusText tone={VERDICT_TONE[verdict] ?? "neutral"}>{humanize(verdict)}</StatusText>{verdict === "match" && r.mapping?.status === "approved" && <NetIcon name="verified" className="text-adm-success" label="Verified" />}</span> : <span className="text-adm-muted">Not reviewed</span>}</Td>
                  <Td>{r.partition ? <StatusText tone={r.partition.outcome === "rejected" ? "danger" : r.partition.counts.invalid > 0 ? "warning" : "success"}>{r.partition.outcome === "rejected" ? "Failed" : `${r.partition.counts.invalid} invalid`}</StatusText> : r.state === "validation_failed" ? <StatusText tone="danger">Failed</StatusText> : <span className="text-adm-muted">No dry run</span>}</Td>
                  <Td><span className="inline-flex items-center gap-1.5"><NetIcon name={STATE_ICON[r.state]} className="text-adm-muted" /><StatusText tone={STATE_TONE[r.state]}>{STATE_LABEL[r.state]}</StatusText></span>{r.stale && r.state !== "stale" && <span className="ml-1"><StatusText tone="warning">Stale</StatusText></span>}</Td>
                  <Td>{when(r.lastArrival)}</Td>
                  <Td>{when(r.lastImport)}</Td>
                  <Td className="text-[12px]">{r.nextAction}</Td>
                </tr>
              );
            })}</tbody>
          </WorkTable>
        ))}
        {board.tests.length > 0 && (
          <details className="border-t border-adm-border px-4 py-3">
            <summary className="cursor-pointer text-[13px] font-semibold text-adm-ink">Test files, never mapped ({board.tests.length})</summary>
            <ul className="mt-2 space-y-1 text-[13px] text-adm-muted">{board.tests.map((f) => <li key={f.id}>{f.path}</li>)}</ul>
          </details>
        )}
      </Panel>
      {row && <Detail key={row.key} row={row} stores={stores.data ?? []} groups={groups.data ?? []} defaultGroupId={groupId ?? groups.data?.[0]?.id ?? ""} act={act} busy={busy} />}
    </div>
  );
}

export default MappingReviewBoard;
