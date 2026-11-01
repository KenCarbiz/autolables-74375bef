import { useState, type ReactNode } from "react";
import { approveBinding, isPartitionReport, type FeedBinding, type InventorySourceMapping, type PartitionReportItem } from "@/lib/inventoryNetwork/api";
import { Al97Frame, Banner, Card, ChipView, Glyph, KeyVals, Metrics, Savebar, useFixtureCopy, type ScopePicker } from "./al97ui";
import { latestPartitionRun, useLedgers } from "./ledgers";
import { formatClock, type Chip } from "./overviewModel";
import { fileName, humanize, mcModeLabel, plural, useAct, useNet } from "./shared";
import { useAdminNow } from "@/lib/admin/dataSource";

interface Requirement { key: "binding" | "mapping" | "identity" | "dryrun" | "pause" | "worker"; label: string; chip: Chip; next: ReactNode; todo: string | null }

const shortHash = (h: string | null | undefined) => (h ? `sha256: ${h.slice(0, 12)}…` : "Not recorded");

export default function MappingReview({ scope, path, children }: { scope?: ScopePicker; path: string; children?: ReactNode }) {
  const { group, groupId, stores, overview } = useNet();
  const now = useAdminNow();
  const t = useFixtureCopy();
  const { act, busy } = useAct();
  const [checked, setChecked] = useState(false);
  const l = useLedgers({ bindings: true, files: true, runs: true, mappings: groupId });

  const file = l.files?.find((f) => f.path === path) ?? null;
  const name = fileName(path);
  const binding: FeedBinding | null = l.bindings?.find((b) => b.path === path) ?? null;
  const run = latestPartitionRun(path, l.runs);
  const report = run && isPartitionReport(run.report) ? run.report : null;
  const live = (m: InventorySourceMapping) => m.status === "pending" || m.status === "approved";
  const partition: PartitionReportItem | null = report
    ? report.partitions.find((p) => l.mappings?.some((m) => live(m) && m.source_dealer_id === p.sourceDealerId)) ?? report.partitions[0] ?? null
    : null;
  const mapping = partition ? l.mappings?.find((m) => live(m) && m.source_dealer_id === partition.sourceDealerId) ?? null : null;
  const store = stores.find((s) => s.store.id === (mapping?.store_id ?? partition?.mapping?.storeId)) ?? null;
  const storeName = store?.store.display_name ?? null;
  const controls = overview.controls;

  const reqs: Requirement[] = [];
  {
    let chip: Chip; let next: ReactNode; let todo: string | null = null;
    if (l.bindings === null) { chip = { label: "Unknown", tone: "neutral" }; next = "File bindings were not read"; todo = "read the file binding"; }
    else if (!binding) { chip = { label: "Missing", tone: "amber" }; next = <a href="#inv-binding">Propose a file binding</a>; todo = "propose and approve the file binding"; }
    else if (binding.status === "approved" && binding.tenant_id !== group.tenant_id) { chip = { label: "Other account", tone: "red" }; next = "Bound to a different dealer account"; todo = "resolve the file's account"; }
    else if (binding.status === "approved") { chip = { label: "Approved", tone: "green" }; next = "Exact path bound to this account"; }
    else if (binding.status === "pending") { chip = { label: "Needs approval", tone: "amber" }; next = <a href="#inv-binding">Review file binding</a>; todo = "approve the file binding"; }
    else { chip = { label: "Disabled", tone: "neutral" }; next = "Binding disabled"; todo = "propose a new file binding"; }
    reqs.push({ key: "binding", label: `File belongs to ${group.name}`, chip, next, todo });
  }
  {
    const chip: Chip = mapping?.status === "approved" ? { label: "Approved", tone: "green" } : mapping ? { label: "Pending", tone: "amber" } : { label: report ? "Missing" : "Unknown", tone: report ? "amber" : "neutral" };
    const next = mapping?.status === "approved" ? "Exact DealerId verified" : mapping ? "Approve the proposed mapping below" : report ? "Propose a mapping from the dry run" : "Needs a dry run to find the DealerId";
    reqs.push({ key: "mapping", label: `DealerId maps to ${storeName ?? "a store"}`, chip, next, todo: mapping?.status === "approved" ? null : "approve the DealerId mapping" });
  }
  {
    const verdict = mapping?.evidence?.computed_by === "server" ? mapping.evidence.verdict : partition?.comparison?.verdict;
    const r: [Chip, string] = verdict === "match" ? [{ label: "Match", tone: "green" }, "Name and address reviewed"]
      : verdict === "name_review" ? [{ label: "Name review", tone: "amber" }, "Confirm the dealer name belongs to this store"]
      : verdict === "mismatch" ? [{ label: "Mismatch", tone: "red" }, "Never approvable; fix the store identity"]
      : [{ label: "Not compared", tone: "neutral" }, "Needs a mapped store and a dry run"];
    reqs.push({ key: "identity", label: "Store identity matches", chip: r[0], next: r[1], todo: verdict === "match" ? null : "confirm the store identity" });
  }
  {
    const stale = !!(file?.last_content_sha256 && run?.content_sha256 && file.last_content_sha256 !== run.content_sha256);
    const invalid = partition?.counts.invalid ?? 0;
    const r: [Chip, string, string | null] = l.runs === null ? [{ label: "Unknown", tone: "neutral" }, "Runs were not read", "read the dry run"]
      : !run || !report ? [{ label: "Not run", tone: "neutral" }, "Run a dry run of this file", "run a dry run"]
      : report.outcome !== "passed" ? [{ label: "Rejected", tone: "red" }, report.rejectReasons.map(humanize).join(", ") || "See the saved report", "fix the file and run it again"]
      : stale ? [{ label: "Stale", tone: "amber" }, "The file changed after this dry run", "run a current dry run"]
      : partition && partition.outcome !== "ready" ? [{ label: humanize(partition.outcome), tone: "amber" }, partition.reasons.map(humanize).join(", ") || "Partition not ready", "resolve the partition"]
      : [{ label: "Passed", tone: "green" }, invalid === 0 ? "No invalid rows" : `${plural(invalid, "invalid row")}`, null];
    reqs.push({ key: "dryrun", label: "Latest dry run is current", chip: r[0], next: r[1], todo: r[2] });
  }
  {
    const st = store?.store;
    const r: [Chip, string, string | null] = !controls ? [{ label: "Unknown", tone: "neutral" }, "Global controls were not read", "read the controls"]
      : controls.emergency_stop ? [{ label: "Emergency stop", tone: "red" }, "Release it on the overview", "release the emergency stop"]
      : controls.ingestion_paused ? [{ label: "Ingestion paused", tone: "amber" }, "Resume ingestion on the overview", "resume ingestion"]
      : !st ? [{ label: "Unknown", tone: "neutral" }, "No store is mapped yet", "map a store"]
      : !st.inventory_feed_enabled ? [{ label: "Feed off", tone: "neutral" }, "Turn the store feed on", "turn the store feed on"]
      : st.feed_import_paused ? [{ label: "Paused", tone: "neutral" }, "Resume after prerequisites", "resume the store"]
      : [{ label: "Enabled", tone: "green" }, "Store imports allowed", null];
    reqs.push({ key: "pause", label: "Store import pause", chip: r[0], next: r[1], todo: r[2] });
  }
  reqs.push(l.heartbeatAt
    ? { key: "worker", label: "Background worker", chip: { label: t("worker.verified", "Verified"), tone: "green" }, next: `Heartbeat ${formatClock(l.heartbeatAt, now)}`, todo: null }
    : { key: "worker", label: "Background worker", chip: { label: "Not verified", tone: "amber" }, next: "Verify worker before automatic import", todo: "verify the worker" });

  const ready = reqs.every((r) => r.chip.tone === "green");
  const caption = t("caption", "");
  const kept = file && /test/i.test(name) ? "Test file, never imported" : "Production inventory source";

  if (ready) {
    const policy = store?.policy ?? null;
    const evidence: Record<Requirement["key"], [string, string]> = {
      binding: ["File binding", "Exact path / tenant approved"], mapping: ["Dealer mapping", "Exact DealerId / store approved"], identity: ["Identity", "Reviewed name and address"],
      dryrun: ["Dry run", "Current file / mapping revision"], worker: ["Worker", "Fresh heartbeat / claim contract"], pause: ["Execution control", "Authorized store enabled"],
    };
    const order: Requirement["key"][] = ["binding", "mapping", "identity", "dryrun", "worker", "pause"];
    const outcome = (k: Requirement["key"]): Chip => (k === "binding" || k === "mapping" || k === "pause" ? { label: "Ready", tone: "green" } : reqs.find((r) => r.key === k)!.chip);
    const main = (
      <div className="work">
        <Banner tone="blue" icon="info" title="Ready for an authorized initial import" detail="File binding, DealerId mapping, validation and worker evidence agree. Import remains an explicit action." />
        <div><Card id="inv-dest-h" title="Exact source destination">
          <KeyVals rows={[["Account", group.name], ["Store", storeName ?? "Unknown"], ["File", name], ["DealerId", partition?.sourceDealerId ?? "Unknown"], ["Source version", t("source.version", shortHash(file?.last_content_sha256))]]} />
        </Card></div>
        <div><Card id="inv-ready-h" title="Readiness checklist">
          <div className="table-wrap"><table>
            <thead><tr><th scope="col">Requirement</th><th scope="col">Evidence</th><th scope="col">Outcome</th></tr></thead>
            <tbody>{order.map((k) => <tr key={k}><td>{evidence[k][0]}</td><td>{evidence[k][1]}</td><td><ChipView chip={outcome(k)} /></td></tr>)}</tbody>
          </table></div>
        </Card></div>
        <div><Card id="inv-bounds-h" title="Initial-import boundaries">
          <KeyVals rows={[
            ["Provider mode", mcModeLabel(policy).label],
            ["Price promotion", t("bounds.price", store?.store.feed_price_updates_listing ? "On" : "Off")],
            ["Retirement", t("bounds.retirement", store?.store.retirement_automation_enabled ? "On" : "Off")],
            ["Legacy adoption", store?.store.adopt_legacy_matches ? "Adopt exact matches" : "Review ambiguous matches"],
            ["Customer visibility", "Resolved separately"],
          ]} />
        </Card></div>
        <Savebar title="Ready for review" detail="The real server rechecks every condition at commit. No silent import after approval." action={<a className="btn primary" href="#inv-file-import">Review initial import</a>} />
      </div>
    );
    return <Al97Frame crumb="Feed mapping / ready" title="Feed mapping / ready" subtitle={`All prerequisites verified${caption}`} scope={scope} storeName={storeName} main={main}>{children}</Al97Frame>;
  }

  const todos = reqs.map((r) => r.todo).filter((x): x is string => !!x && x !== "resume the store");
  const paused = reqs.some((r) => r.todo === "resume the store");
  const blockedDetail = `${todos.length ? `${todos.map((x, i) => (i === 0 ? x[0].toUpperCase() + x.slice(1) : x)).join(todos.length > 2 ? ", " : " and ").replace(/, ([^,]*)$/, " and $1")}.` : ""}${paused ? `${todos.length ? " " : ""}Resume is a separate reviewed change.` : ""}`;
  const canApprove = binding?.status === "pending" && checked && !busy;
  const approveReason = !binding ? "Propose the file binding first." : binding.status !== "pending" ? "Only a pending binding can be approved." : !checked ? "Confirm the file belongs to this account first." : undefined;

  const main = (
    <div className="work">
      <div className="identity-strip">
        <Glyph name="file" />
        <div><b>{name}</b><small>{l.files === null ? "File list not read" : file ? `${kept}${caption}` : "Not in the discovered file list"}</small></div>
        <ChipView chip={{ label: "Not ready", tone: "amber" }} />
      </div>
      <div><Card id="inv-check-h" title="Readiness checklist">
        <div className="table-wrap"><table>
          <thead><tr><th scope="col">Requirement</th><th scope="col">Status</th><th scope="col">What happens next</th></tr></thead>
          <tbody>{reqs.map((r) => <tr key={r.key}><td>{r.label}</td><td><ChipView chip={r.chip} /></td><td>{r.next}</td></tr>)}</tbody>
        </table></div>
      </Card></div>
      <div className="split">
        <div><div id="inv-binding">
          <Card id="inv-bind-h" title="File binding review" description="Approval binds this exact path and verified identity, not a filename pattern.">
            <KeyVals rows={[["Destination account", group.name], ["Destination store", storeName ?? "Not mapped"], ["Source DealerId", partition?.sourceDealerId ?? "Unknown"]]} />
            <label className="checkline">
              <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => setChecked(e.target.checked)} disabled={binding?.status !== "pending"} />
              <span aria-hidden="true">{checked ? "☑" : "□"}{" "}</span>I checked this file belongs to this account.
            </label>
            <button type="button" className="btn primary" disabled={!canApprove} title={approveReason} onClick={() => act(() => approveBinding(path, checked), "File binding approved. Nothing was imported.")}>Approve binding</button>
          </Card>
        </div></div>
        <div><div>
          <Card id="inv-dry-h" title="Dry-run evidence">
            <Metrics label="Dry-run counts" items={[
              { label: "Rows", value: partition ? String(partition.counts.rows) : "Unknown", sub: run ? t("dryrun.rows", `Dry run ${formatClock(run.started_at, now)}`) : "No dry run", icon: "car", known: !!partition },
              { label: "Invalid", value: partition ? String(partition.counts.invalid) : "Unknown", sub: "Review report", icon: "warning", known: !!partition },
            ]} />
            <KeyVals rows={[
              ["Snapshot hash", shortHash(run?.content_sha256)],
              ["Paid calls", report ? String(report.providerCalls) : "Unknown"],
              ["Listing changes", report ? (report.inventoryWrites === 0 ? "None in dry run" : String(report.inventoryWrites)) : "Unknown"],
            ]} />
          </Card>
        </div></div>
      </div>
      <Savebar title="Import is blocked" detail={blockedDetail} action={<button type="button" className="btn primary" disabled title={`Import is blocked: ${todos.concat(paused ? ["resume the store"] : []).join(", ")}.`}>Import now</button>} />
    </div>
  );
  return <Al97Frame crumb="Feed mapping review" title="Feed mapping review" subtitle={`${storeName ?? "No store mapped"} · ${name}`} scope={scope} storeName={storeName} main={main}>{children}</Al97Frame>;
}
