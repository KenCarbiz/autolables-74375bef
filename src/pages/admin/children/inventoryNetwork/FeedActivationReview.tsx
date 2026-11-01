import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { isPartitionReport, type InventorySourceMapping } from "@/lib/inventoryNetwork/api";
import { Al97Dialog, Al97Frame, Banner, KeyVals, type ScopePicker } from "@/components/admin/al97/al97ui";
import { latestPartitionRun, useLedgers } from "./ledgers";
import { fileName, useNet } from "./shared";

// Review store feed activation: the exact file, store and DealerId, and the
// gates an activation needs. Resume stays disabled: no existing server action
// resumes a store only after rechecking these gates, so the store pause is
// changed on Stores after this review.

export const RESUME_REASON = "No server action resumes a store only after rechecking these gates. Review here, then change the store pause on Stores.";

const GATES: Array<[string, string]> = [
  ["File binding", "Approved"],
  ["Dealer mapping", "Approved and current"],
  ["Dry run", "Current file hash; no invalid rows"],
  ["Worker", "Verified heartbeat and claim"],
  ["Paid data", "Feed only; no new requests"],
];

export default function FeedActivationReview({ scope, path, children }: { scope?: ScopePicker; path: string; children?: ReactNode }) {
  const { group, groupId, stores, href } = useNet();
  const l = useLedgers({ runs: true, mappings: groupId });
  const [open, setOpen] = useState(true);
  const [checked, setChecked] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  const run = latestPartitionRun(path, l.runs);
  const report = run && isPartitionReport(run.report) ? run.report : null;
  const live = (m: InventorySourceMapping) => m.status === "pending" || m.status === "approved";
  const partition = report ? report.partitions.find((p) => l.mappings?.some((m) => live(m) && m.source_dealer_id === p.sourceDealerId)) ?? report.partitions[0] ?? null : null;
  const mapping = partition ? l.mappings?.find((m) => live(m) && m.source_dealer_id === partition.sourceDealerId) ?? null : null;
  const store = stores.find((s) => s.store.id === (mapping?.store_id ?? partition?.mapping?.storeId)) ?? null;
  const storeName = store?.store.display_name ?? null;

  return (
    <>
      <Al97Frame crumb="Review store feed activation" title="Review store feed activation" subtitle={`${storeName ?? "No store mapped"} · preserve existing inventory and paid-data limits.`} scope={scope} storeName={storeName} main={<div className="work" />}>
        <div className="invnet-ov mt-10 flex flex-wrap justify-center gap-2">
          <button ref={trigger} type="button" className="btn" onClick={() => setOpen(true)}>Review feed activation</button>
          <Link to={href("mapping", { file: path })} className="btn">Open feed mapping review</Link>
        </div>
        {!open && children}
      </Al97Frame>
      <Al97Dialog
        open={open}
        onOpenChange={setOpen}
        returnFocus={trigger}
        title="Review feed activation"
        description="Exact source and store; separate approval from mapping"
        footer={<>
          <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
          <span id="resume-reason" className="sr-only">{RESUME_REASON}</span>
          <button type="button" className="btn primary" disabled title={RESUME_REASON} aria-describedby="resume-reason">Resume this store</button>
        </>}
      >
        <KeyVals rows={[["Account", group.name], ["Store", storeName ?? "Not mapped"], ["File", fileName(path)], ["DealerId", partition?.sourceDealerId ?? "Unknown"]]} />
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Gate</th><th scope="col">Required</th></tr></thead>
            <tbody>{GATES.map(([g, r]) => <tr key={g}><td>{g}</td><td>{r}</td></tr>)}</tbody>
          </table>
        </div>
        <Banner tone="blue" icon="info" title="Keep price promotion and retirement off" detail="Initial import does not authorize overwriting prices, adopting ambiguous matches or retiring missing vehicles." />
        <label className="checkline">
          <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          {`${checked ? "☑" : "□"} I reviewed the exact dry run, counts and import changes.`}
        </label>
      </Al97Dialog>
    </>
  );
}
