import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTenant } from "@/contexts/TenantContext";
import { useViewFixture } from "@/lib/admin/dataSource";
import { Al97Dialog, Al97Frame, Banner, KeyVals, useFixtureCopy } from "@/components/admin/al97/al97ui";

// Worker setup / change review. Proposes a schedule for the Files.com import
// worker and nothing more: the real schedule is
// supabase/manual/files_inventory_worker_schedule.sql, applied by hand after
// Ken approves it, so every enable, apply or schedule control stays disabled.

export interface WorkerSetupFixture { account: string; store: string | null; workerSchedule: "found" | "not_found" | null }

export const WORKER_APPROVAL_REASON = "The worker schedule is applied by hand from supabase/manual/files_inventory_worker_schedule.sql after Ken approves it. Nothing on this page can enable it.";

export default function WorkerSetupPage() {
  const fx = useViewFixture<WorkerSetupFixture>("al97-worker");
  const copy = useFixtureCopy();
  const { tenant, currentStore } = useTenant();
  const [open, setOpen] = useState(true);
  const [reason, setReason] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const schedule = fx?.workerSchedule ?? null;
  const scopeLabel = { account: fx?.account ?? tenant?.name ?? "This account", store: fx ? fx.store : currentStore?.name ?? null };

  const actions = (
    <div className="invnet-ov mt-10 flex flex-wrap justify-center gap-2">
      <button ref={trigger} type="button" className="btn" onClick={() => setOpen(true)}>Review worker setup</button>
      <Link to="/admin/integrations/files-com" className="btn">Open Files.com feed</Link>
    </div>
  );
  return (
    <>
      <Al97Frame crumb="Worker setup / change review" title="Worker setup / change review" subtitle="An explicit operational change, never an automatic repair." scopeLabel={scopeLabel} main={<div className="work" />}>{actions}</Al97Frame>
      <Al97Dialog
        open={open}
        onOpenChange={setOpen}
        returnFocus={trigger}
        title="Review Files.com worker setup"
        description={copy("worker.subtitle", "Proposed operation · needs owner approval")}
        footer={<>
          <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
          <span id="worker-enable-reason" className="sr-only">{WORKER_APPROVAL_REASON}</span>
          <button type="button" className="btn primary" disabled title={WORKER_APPROVAL_REASON} aria-describedby="worker-enable-reason">Enable worker</button>
        </>}
      >
        <Banner tone="amber" icon="warning" title="This enables background processing" detail="New approved files may change inventory after the worker starts." />
        <KeyVals rows={[
          ["Function", "files-inventory-worker"],
          ["Current schedule", schedule === "found" ? "Scheduled" : schedule === "not_found" ? copy("worker.none", "None found") : "Not readable here"],
          ["Proposed schedule", "Operator must specify"],
          ["Paid enrichment", "Not enabled by this operation"],
          ["Store controls", "Existing pauses and approvals retained"],
        ]} />
        <label className="field">
          <span>Reason</span>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required before requesting approval" aria-describedby="worker-enable-reason" />
        </label>
        <p className="fine">Before activation: verify idempotent processing, current-schema compatibility, queue bounds and rollback on synthetic data.</p>
      </Al97Dialog>
    </>
  );
}
