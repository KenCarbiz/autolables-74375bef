import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { createDedupePreview, getDedupeOverview, runDedupeScan, type DedupeOverview } from "@/lib/inventoryNetwork/api";
import { Al97Frame, Banner, Card, Flow, Glyph, KeyVals, Metrics, Savebar, useNetFixture, type MetricItem, type ScopePicker } from "@/components/admin/al97/al97ui";
import preserveRecords from "@/assets/al97/preserve-records.svg";
import { useAct, useNet } from "./shared";

// Duplicate handling summary (AL97 13), beside the approved Duplicate handling
// view. It reads inv_dedupe_overview only. Detection and building a preview
// are explicit clicks on the existing permission-checked calls; nothing here
// clears the emergency stop, turns on automatic reconciliation or purges.

const day = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));

export function useDedupeOverview(): { data: DedupeOverview | null; loading: boolean } {
  const fx = useNetFixture();
  const { groupId } = useNet();
  const q = useQuery({ queryKey: ["inv-net", "dedupe", groupId], queryFn: () => getDedupeOverview(groupId), enabled: !fx });
  return fx ? { data: fx.dedupe ?? null, loading: false } : { data: q.data ?? null, loading: q.isLoading };
}

export default function DuplicateHandling({ scope, storeId, children }: { scope?: ScopePicker; storeId?: string | null; children?: ReactNode }) {
  const { groupId, href, stores } = useNet();
  const store = storeId ? stores.find((s) => s.store.id === storeId)?.store ?? null : null;
  const { act, busy } = useAct();
  const navigate = useNavigate();
  const { data, loading } = useDedupeOverview();
  const c = data?.controls ?? null;
  const limits = c?.limits_approved_at ? "approved" : "proposed";
  const reconciled = data ? data.reconciled.filter((a) => !a.retired_at).length : null;
  const scanReason = !c ? "Duplicate handling could not be read." : !c.detection_enabled ? "Detection is switched off in the safety controls." : null;

  const items: MetricItem[] = c ? [
    { label: "Detection", value: c.detection_enabled ? "On" : "Off", sub: `Last scan: ${data?.last_checked_at ? day(data.last_checked_at) : "never"}`, icon: "search" },
    { label: "Automatic reconcile", value: c.auto_reconcile_enabled ? "On" : "Off", sub: c.limits_approved_at ? "Owner limits approved" : "Owner limits not approved", icon: "pause" },
    { label: "Permanent purge", value: c.purge_enabled ? "On" : "Off", sub: c.purge_enabled ? "Purge enabled" : "Retention policy not approved", icon: "archive" },
    { label: "Provider calls", value: "0", sub: "Reconciliation uses saved data", icon: "shield" },
  ] : (["Detection", "Automatic reconcile", "Permanent purge", "Provider calls"] as const).map((label, i) => ({ label, value: "Unknown", sub: loading ? "Reading" : "Not read", icon: (["search", "pause", "archive", "shield"] as const)[i], known: false }));

  const scan = <><span id="dd-scan-reason" className="sr-only">{scanReason ?? ""}</span>
    <button type="button" className="btn" disabled={!!scanReason || busy} title={scanReason ?? undefined} aria-describedby={scanReason ? "dd-scan-reason" : undefined} onClick={() => void act(() => runDedupeScan(groupId), "Detection finished")}><Glyph name="search" />Run detection</button></>;
  const build = (id: string) => void act(() => createDedupePreview(id), "Preview built").then((r) => { if (r.ok) navigate(href("duplicates", { review: "reconcile", plan: r.value.preview_id })); });

  const open = data ? data.candidates.filter((x) => x.status === "open" && (!store || x.store_id === store.id)) : [];
  const candidates = data && data.last_checked_at ? (
    <Card id="dd-candidates" title={`Open candidates (${open.length})`} action={scan}>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">VIN</th><th scope="col">Store</th><th scope="col">State</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
          <tbody>{open.map((x) => (
            <tr key={x.id}>
              <td>…{x.vin_suffix}</td><td>{x.store_name ?? "Unknown"}</td>
              <td><span className={`chip ${x.disposition === "eligible" ? "blue" : x.disposition === "blocked" ? "red" : "amber"}`}>{x.disposition === "eligible" ? "Ready for preview" : x.disposition === "blocked" ? "Blocked" : "Needs review"}</span></td>
              <td>{x.disposition === "eligible" ? <button type="button" className="btn" disabled={busy} onClick={() => build(x.id)}>Build preview</button> : null}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Card>
  ) : (
    <Card id="dd-candidates" title={data ? "No candidates checked yet" : "Candidates unknown"}>
      <div className="empty">
        <img className="art" src={preserveRecords} alt="" />
        <h3>{data ? "Run detection to inspect current records" : "Candidates could not be read"}</h3>
        <p>Zero candidates before a scan does not mean zero duplicates.</p>
        {scan}
      </div>
    </Card>
  );

  const main = (
    <div className="work">
      {!c ? <Banner tone="amber" icon="warning" title={loading ? "Reading duplicate handling" : "Duplicate handling could not be read"} detail="Nothing is shown as safe because the controls were not read." />
        : c.emergency_stop ? <Banner tone="amber" icon="warning" title="Emergency stop engaged" detail="Detection may identify candidates. Apply stays blocked until reviewed safety controls permit it." />
        : <Banner tone="blue" icon="info" title="Emergency stop clear" detail="Every reconciliation still needs an exact preview and a separate approval." />}
      <Metrics label="Duplicate handling summary" items={items} />
      <Card id="dd-flow" title="Candidate workflow">
        <Flow steps={[
          { no: 1, title: "Detect", chip: { label: "Read + record scan", tone: "blue" }, note: "Exact VIN and ownership" },
          { no: 2, title: "Preview", chip: { label: "Fingerprint plan", tone: "blue" }, note: "No listing changes" },
          { no: 3, title: "Approve", chip: { label: "Exact plan only", tone: "blue" }, note: "Short expiry" },
          { no: 4, title: "Apply / recover", chip: { label: "Guarded", tone: "neutral" }, note: "Archive; retain evidence" },
        ]} />
      </Card>
      <div className="split">
        <div><div>{candidates}</div></div>
        <div><div>
          <Card id="dd-controls" title="Safety controls">
            <KeyVals rows={c ? [
              ["Maximum sets per run", `${c.max_sets_per_run} · ${limits === "approved" ? "approved" : "proposed, not approved"}`],
              ["Store stock share", `${c.max_store_share_pct}% · ${limits}`],
              ["Preview / approval expiry", `${c.preview_ttl_minutes} / ${c.approval_ttl_minutes} minutes · ${limits}`],
              ["Emergency stop", c.emergency_stop ? <span className="chip red">Engaged</span> : <span className="chip">Clear</span>],
              ["Hard delete", c.purge_enabled ? <span className="chip amber">Enabled</span> : <span className="chip neutral">Unavailable</span>],
            ] : [["Controls", "Unknown"]]} />
          </Card>
        </div></div>
      </div>
      <Savebar title={reconciled == null ? "Reconciled records unknown" : reconciled === 0 ? "No records reconciled" : `${reconciled} ${reconciled === 1 ? "record" : "records"} reconciled`}
        detail="A scan is an explicit recorded action. No scan is run by opening this page."
        action={<Link to={href("duplicates")} className="btn">Review safety controls</Link>} />
    </div>
  );
  return <Al97Frame crumb="Duplicate handling" title="Duplicate handling" subtitle="Preserve the established vehicle record and its paid data." scope={scope} storeName={store?.display_name ?? null} main={main}>{children}</Al97Frame>;
}
