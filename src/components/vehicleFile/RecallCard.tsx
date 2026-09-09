import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, FileText, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { OUTCOME_LABELS, useRecallTask, type RecallOutcome } from "@/hooks/useRecallTask";
import { Card, btn, btnPrimary } from "./primitives";
import { normalizeRecalls, type RecallItem, type VehicleRow } from "./types";
import { deriveRecallView, recallScopeOfSource, type RecallView } from "@/lib/vehicleTruth/recallView";

type RecallHook = ReturnType<typeof useRecallTask>;

// Service Get Ready: record the recall outcome (one of three) with the required
// service detail. Resolving the task clears the publish blocker (a "No fix
// available" outcome keeps the recall visible but is still a recorded review).
const OUTCOME_ORDER: RecallOutcome[] = ["recall_completed", "no_fix_available", "does_not_apply"];

const RecallReviewActions = ({ recall, vehicle }: { recall: RecallHook; vehicle: VehicleRow }) => {
  const { task, blocking, submitting, submitOutcome } = recall;
  const [picked, setPicked] = useState<RecallOutcome | null>(null);
  const [employee, setEmployee] = useState("");
  const [ro, setRo] = useState("");
  const [notes, setNotes] = useState("");
  const [docs, setDocs] = useState<{ url: string; caption?: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!task) return null;

  const onFiles = async (files: FileList | null) => {
    if (!files?.length || !vehicle.tenant_id || !vehicle.vin) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const path = `${vehicle.tenant_id}/${vehicle.vin}/recall/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error } = await supabase.storage.from("service-docs").upload(path, file, { upsert: false });
      if (!error) {
        const { data } = supabase.storage.from("service-docs").getPublicUrl(path);
        if (data?.publicUrl) setDocs((p) => [...p, { url: data.publicUrl, caption: file.name }]);
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  // Already reviewed — show the immutable record (audit trail preserved).
  if (task.status === "resolved" && task.outcome) {
    return (
      <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
        <p className="text-al-body font-semibold text-emerald-800">Recall reviewed · {OUTCOME_LABELS[task.outcome]}</p>
        <p className="text-al-meta text-muted-foreground mt-0.5">
          {[task.employee_name, task.ro_number ? `RO ${task.ro_number}` : null, task.completed_at ? new Date(task.completed_at).toLocaleDateString() : null].filter(Boolean).join(" · ")}
        </p>
        {task.notes ? <p className="text-al-meta text-muted-foreground mt-0.5">{task.notes}</p> : null}
        {task.outcome === "no_fix_available" && (
          <p className="text-al-meta text-amber-700 mt-1">OEM remedy not yet available — the recall stays visible; dealer publish policy applies.</p>
        )}
      </div>
    );
  }

  const submit = async () => {
    if (!picked) return;
    if (!employee.trim()) { toast.error("Service employee name is required"); return; }
    const r = await submitOutcome(picked, {
      employeeName: employee.trim(),
      roNumber: ro.trim() || undefined,
      notes: notes.trim() || undefined,
      documents: docs,
    });
    if (r.ok) toast.success("Recall outcome recorded"); else toast.error(r.error || "Could not record the outcome");
  };

  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="text-al-body font-semibold text-amber-800">Open Recall Review Required {blocking ? "· blocks publish" : ""}</p>
      <p className="text-al-meta text-muted-foreground mt-0.5 mb-2">Service must record an outcome before this vehicle can publish.</p>
      <div className="flex flex-wrap gap-1.5">
        {OUTCOME_ORDER.map((o) => (
          <button
            key={o}
            onClick={() => setPicked(o)}
            className={`text-al-meta font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
              picked === o ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-foreground hover:bg-muted"
            }`}
          >
            {OUTCOME_LABELS[o]}
          </button>
        ))}
      </div>
      {picked && (
        <div className="mt-2 space-y-1.5">
          <input value={employee} onChange={(e) => setEmployee(e.target.value)} placeholder="Service employee name *" className="w-full h-9 px-2.5 rounded-lg border border-border bg-background text-al-body text-foreground" />
          <input value={ro} onChange={(e) => setRo(e.target.value)} placeholder="RO number (if applicable)" className="w-full h-9 px-2.5 rounded-lg border border-border bg-background text-al-body text-foreground" />
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" rows={2} className="w-full px-2.5 py-2 rounded-lg border border-border bg-background text-al-body text-foreground resize-none" />
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} className="w-full h-9 rounded-lg border border-dashed border-border text-al-meta font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50">
            {uploading ? "Uploading…" : docs.length ? `${docs.length} file${docs.length === 1 ? "" : "s"} attached` : "Attach a photo or document (optional)"}
          </button>
          {docs.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {docs.map((d, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-al-meta bg-muted px-1.5 py-0.5 rounded">
                  {d.caption || "file"}
                  <button onClick={() => setDocs((p) => p.filter((_, j) => j !== i))} aria-label="Remove attachment"><X className="w-2.5 h-2.5" /></button>
                </span>
              ))}
            </div>
          )}
          <button onClick={submit} disabled={submitting} className={`${btnPrimary} w-full`}>
            {submitting ? "Recording…" : `Record: ${OUTCOME_LABELS[picked]}`}
          </button>
        </div>
      )}
    </div>
  );
};

// Recall card — VIN verification and model campaign context, kept apart.
// "Clear" is a claim about THIS VIN, so it renders only from a VIN-level
// source that answered; the provider the function actually used comes back on
// `provider`, and an NHTSA answer is model scope however it reached us.
export const RecallCard = ({ vehicle, recall }: { vehicle: VehicleRow; recall: RecallHook }) => {
  const [view, setView] = useState<RecallView>(() => deriveRecallView(vehicle));
  const [failed, setFailed] = useState(false);
  const [recalls, setRecalls] = useState<RecallItem[]>(normalizeRecalls(vehicle.recall_payload));
  const [checking, setChecking] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const checkedAt = view.vin.checkedAt ?? view.model?.checkedAt ?? null;
  const open = view.vin.openCount ?? view.model?.campaignCount ?? 0;

  const run = async () => {
    if (!vehicle.vin) { toast.error("No VIN to check"); return; }
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("marketcheck-recalls", { body: { vin: vehicle.vin, tenant_id: vehicle.tenant_id } });
      if (error) throw error;
      const d = (data || {}) as { error?: string; recallStatus?: string; checkedAt?: string; openRecallCount?: number; recalls?: RecallItem[]; provider?: string; note?: string };
      if (d.error === "not_configured") { toast.error("Recall lookup isn't configured yet (MarketCheck AutoRecalls key)."); setFailed(true); }
      else if (d.error === "no_endpoint_matched") { toast.error("MarketCheck recall endpoint not reachable — likely no AutoRecalls access on the key."); setFailed(true); }
      else if (d.recallStatus === "error") { toast.error("We could not check recalls right now. Try again."); setFailed(true); }
      else {
        setFailed(false);
        setRecalls(d.recalls || []);
        setView(deriveRecallView({
          recall_status: d.recallStatus ?? null,
          open_recall_count: d.openRecallCount ?? null,
          recall_checked_at: d.checkedAt ?? null,
          recall_payload: {
            source: d.provider ?? null,
            checked_at: d.checkedAt ?? null,
            note: d.note ?? null,
            campaigns: d.recalls ?? [],
            open_recall_count: d.openRecallCount ?? null,
          },
        }));
        toast.success(
          (d.openRecallCount || 0) > 0
            ? `${d.openRecallCount} open recall${d.openRecallCount === 1 ? "" : "s"} found`
            : recallScopeOfSource(d.provider ?? null) === "vin"
              ? "No active recalls on this VIN"
              : "No campaigns found for this model — VIN-level verification unavailable",
        );
      }
    } catch {
      toast.error("We could not check recalls right now. Try again.");
      setFailed(true);
    } finally {
      setChecking(false);
    }
  };

  const checkBtn = (label: string) => (
    <button onClick={run} disabled={checking} className={btn}>{checking ? "Checking…" : label}</button>
  );

  if (view.riskSignalled) {
    return (
      <>
        <Card title="Recall" action={
          <div className="flex items-center gap-2">
            <span className="text-al-meta font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Action needed</span>
            {checkBtn("Check again")}
          </div>
        }>
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0"><ShieldAlert className="w-5 h-5" /></span>
            <div className="min-w-0">
              <p className="text-al-card text-foreground">{view.vin.label}</p>
              <p className="text-al-body text-muted-foreground mt-0.5">
                {view.vin.checkComplete
                  ? `Open recall detected (${open} active) on this VIN.`
                  : `A safety campaign is on record${view.model ? ` at model scope (${view.model.label})` : ""}, and no VIN-level check has answered.`}
                {" "}Service must confirm whether it is completed, no fix is available, or it does not apply to this vehicle.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setDetailsOpen(true)} className={btnPrimary}><ShieldAlert className="w-3.5 h-3.5" /> Open recall review</button>
            <button onClick={() => setDetailsOpen(true)} className={btn}><FileText className="w-3.5 h-3.5" /> Add service note</button>
          </div>
        </Card>

        <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
          <SheetContent className="w-full sm:max-w-md overflow-y-auto">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 text-red-700"><ShieldAlert className="w-5 h-5" /> Recall details</SheetTitle>
            </SheetHeader>
            <p className="text-al-meta text-muted-foreground mt-1">
              {view.vin.checkComplete
                ? `${open} active manufacturer recall${open === 1 ? "" : "s"} on this VIN.`
                : `${open} manufacturer recall campaign${open === 1 ? "" : "s"} on record. ${view.vin.detail}`}
            </p>
            <div className="mt-4 space-y-3">
              {recalls.map((r, i) => (
                <div key={i} className="rounded-xl border border-red-200 bg-red-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-al-meta font-bold uppercase tracking-wider text-red-700">{r.component || "Safety recall"}</p>
                    {r.nhtsaCampaignNumber ? <span className="text-al-meta font-mono text-muted-foreground">{r.nhtsaCampaignNumber}</span> : null}
                  </div>
                  <p className="text-al-body text-foreground mt-1 leading-relaxed">{r.summary || r.description || r.title}</p>
                  {r.consequence ? <p className="text-al-meta text-muted-foreground mt-1.5"><span className="font-semibold">Risk:</span> {r.consequence}</p> : null}
                  {r.remedy ? <p className="text-al-meta text-muted-foreground mt-1.5"><span className="font-semibold">Remedy:</span> {r.remedy}</p> : null}
                  {r.reportDate ? <p className="text-al-meta text-muted-foreground mt-1.5">Reported {r.reportDate}</p> : null}
                </div>
              ))}
            </div>
            <div className="mt-4 border-t border-border pt-4">
              <RecallReviewActions recall={recall} vehicle={vehicle} />
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  if (failed) {
    return (
      <Card title="Recall" action={
        <div className="flex items-center gap-2">
          <span className="text-al-meta font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Error</span>
          {checkBtn("Try again")}
        </div>
      }>
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0"><AlertTriangle className="w-5 h-5" /></span>
          <div>
            <p className="text-al-card text-foreground">Recall check failed</p>
            <p className="text-al-body text-muted-foreground">We could not check recalls right now. Try again.</p>
          </div>
        </div>
      </Card>
    );
  }

  if (view.vin.clearClaimAllowed) {
    return (
      <Card title="Recall" action={
        <div className="flex items-center gap-2">
          <span className="text-al-meta font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Clear</span>
          {checkBtn("Check again")}
        </div>
      }>
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0"><ShieldCheck className="w-5 h-5" /></span>
          <div>
            <p className="text-al-card text-foreground">No active recalls</p>
            <p className="text-al-body text-muted-foreground">
              VIN-level check{view.vin.source ? ` (${view.vin.source})` : ""} · last checked {checkedAt ? new Date(checkedAt).toLocaleDateString() : "today"}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Recall" action={
      <div className="flex items-center gap-2">
        <span className="text-al-meta font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Not verified</span>
        {checkBtn("Run recall check")}
      </div>
    }>
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-lg bg-muted text-muted-foreground flex items-center justify-center shrink-0"><ShieldCheck className="w-5 h-5" /></span>
        <div>
          <p className="text-al-card text-foreground">{view.vin.label}</p>
          <p className="text-al-body text-muted-foreground">{view.vin.detail}</p>
          {view.model ? (
            <p className="text-al-meta text-muted-foreground mt-1">Model-level context: {view.model.label}. {view.model.detail}</p>
          ) : null}
        </div>
      </div>
    </Card>
  );
};

export default RecallCard;
