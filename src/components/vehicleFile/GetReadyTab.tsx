import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, Check, Clock, Lock, MoreHorizontal, Unlock, Wrench,
} from "lucide-react";
import { Card, DeepLink, EmptyNote, Section, btn, fmtWhen } from "./primitives";
import { VehicleSubHeader } from "./SubPageHeader";
import { Button, Disclosure } from "@/components/product";
import {
  OFF_RAIL, RAIL, stageStates, type LifecycleResult, type StageState,
} from "./lifecycle";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { VEHICLE_NOTE_ACTION, cleanNote, notesFromAudit, type NoteAuditRow } from "./vehicleNotes";
import { STATE_LABEL, type LifecycleState } from "@/lib/lifecycle/states";
import type { ReadinessSummary, VehicleRow } from "./types";
import { useEntitlements } from "@/hooks/useEntitlements";
import { canDispatchGetReady } from "@/lib/commandCenter/dispatchAuthority";
import { clearanceReasonLabel } from "@/lib/service/workspaceStatus";

interface PrepRow {
  id: string;
  created_at: string;
  signed_at: string | null;
  updated_at: string;
  status: "pending" | "signed" | "rejected" | "overridden";
  foreman_name: string | null;
  inspection_passed: boolean;
  inspection_form_type: string | null;
  rejection_reason: string | null;
  listing_unlocked: boolean;
  accessories_installed: Array<{ name: string; installed_date?: string | null }> | null;
  install_photos: Array<{ url: string; caption?: string }> | null;
  notes: string | null;
}

interface GateEvent {
  id: string;
  created_at: string;
  user_email: string | null;
  details: { prev_state?: string; new_state?: string; reason?: string } | null;
}

const STAGE_DOT: Record<StageState, string> = {
  done: "bg-adm-surface text-adm-primary border-adm-primary",
  current: "bg-adm-primary text-white border-adm-primary",
  future: "bg-adm-workspace text-adm-muted border-adm-border",
};

const RailStrip = ({ state }: { state: LifecycleState | null }) => {
  const states = stageStates(state);
  return (
    <ol className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-0">
      {RAIL.map((stage, i) => {
        const s = states[stage.key];
        return (
          <li key={stage.key} className={`flex min-w-0 items-center gap-2 ${i < RAIL.length - 1 ? "sm:flex-1" : ""}`}>
            <span className={`w-7 h-7 rounded-full border inline-flex items-center justify-center shrink-0 ${STAGE_DOT[s]}`}>
              <span className="text-[13px] font-bold tabular-nums">{i + 1}</span>
            </span>
            <div className="min-w-0 shrink-0">
              <p className={`text-[13px] leading-[16px] font-semibold ${s === "future" ? "text-adm-muted" : "text-adm-ink"}`}>{stage.label}</p>
              <p className="text-[12px] leading-[16px] text-adm-muted">
                {s === "done" ? "Confirmed" : s === "current" ? "In progress" : "Not started"}
              </p>
            </div>
            {i < RAIL.length - 1 && <span aria-hidden="true" className={`hidden sm:block h-px min-w-[12px] flex-1 ${states[RAIL[i + 1].key] === "future" ? "bg-adm-border" : "bg-adm-primary"}`} />}
          </li>
        );
      })}
    </ol>
  );
};

const PrepCard = ({ row, onOpen }: { row: PrepRow; onOpen: () => void }) => {
  const installed = (row.accessories_installed || []).filter((a) => a.installed_date).length;
  const total = (row.accessories_installed || []).length;
  const photos = (row.install_photos || []).length;
  const statusCls =
    row.status === "signed" ? "bg-emerald-100 text-emerald-700"
      : row.status === "rejected" ? "bg-red-100 text-red-700"
      : row.status === "overridden" ? "bg-muted text-muted-foreground"
      : "bg-amber-100 text-amber-700";
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
      <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${statusCls}`}>
        {row.status === "signed" ? <CheckCircle2 className="w-4 h-4" />
          : row.status === "rejected" ? <AlertTriangle className="w-4 h-4" />
          : <Clock className="w-4 h-4" />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-al-body font-semibold text-foreground truncate">{row.foreman_name || "Unassigned foreman"}</p>
          <span className={`text-al-meta font-semibold px-1.5 py-0.5 rounded-[2px] ${statusCls}`}>{row.status}</span>
          {row.listing_unlocked && (
            <span className="text-al-meta font-semibold px-1.5 py-0.5 rounded-[2px] bg-emerald-100 text-emerald-700 inline-flex items-center gap-1">
              <Unlock className="w-2.5 h-2.5" /> unlocked
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-al-meta text-muted-foreground mt-0.5 flex-wrap">
          <span>{new Date(row.updated_at).toLocaleDateString()}</span>
          {total > 0 && <span>{installed}/{total} installed</span>}
          {photos > 0 && <span>{photos} photo{photos === 1 ? "" : "s"}</span>}
          {row.inspection_form_type && row.inspection_form_type !== "None" && <span>{row.inspection_form_type} inspection</span>}
          {row.status === "rejected" && row.rejection_reason && <span className="text-red-600 truncate">Reason: {row.rejection_reason}</span>}
        </div>
      </div>
      <button onClick={onOpen} className={btn}>Open <ArrowUpRight className="w-3.5 h-3.5" /></button>
    </div>
  );
};

export const GetReadyTab = ({ vehicle, lifecycle, ready, strip }: { vehicle: VehicleRow; lifecycle: LifecycleResult; ready?: ReadinessSummary; strip?: ReactNode }) => {
  const navigate = useNavigate();
  const { row, loading, error, tracked } = lifecycle;
  const { user, isAdmin } = useAuth();
  const { member } = useEntitlements();
  const canDecide = canDispatchGetReady(member?.role, isAdmin);
  const [acting, setActing] = useState(false);
  const [prep, setPrep] = useState<PrepRow[]>([]);
  const [gates, setGates] = useState<GateEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [noteRows, setNoteRows] = useState<NoteAuditRow[]>([]);
  const [draft, setDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const { tenant } = useTenant();

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      // deno-lint-ignore no-explicit-any
      const sb = supabase as unknown as { from: (t: string) => any };
      const [prepRes, gateRes, noteRes] = await Promise.all([
        sb.from("prep_sign_offs")
          .select("id,created_at,signed_at,updated_at,status,foreman_name,inspection_passed,inspection_form_type,rejection_reason,listing_unlocked,accessories_installed,install_photos,notes")
          .eq("vin", vehicle.vin).order("updated_at", { ascending: false }).limit(20),
        sb.from("audit_log")
          .select("id, created_at, user_email, details")
          .eq("action", "vehicle_lifecycle_gate_set")
          .eq("entity_id", vehicle.vin)
          .order("created_at", { ascending: false }).limit(25),
        sb.from("audit_log")
          .select("id, created_at, user_email, details")
          .eq("action", VEHICLE_NOTE_ACTION)
          .eq("entity_id", vehicle.vin)
          .order("created_at", { ascending: false }).limit(50),
      ]);
      setNoteRows((noteRes?.data || []) as NoteAuditRow[]);
      setPrep((prepRes.data || []) as PrepRow[]);
      setGates((gateRes.data || []) as GateEvent[]);
    } catch {
      setPrep([]);
      setGates([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [vehicle.vin]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const addNote = async () => {
    const text = cleanNote(draft);
    if (!text) return;
    setSavingNote(true);
    // deno-lint-ignore no-explicit-any
    const { error: err } = await (supabase as any).from("audit_log").insert({
      action: VEHICLE_NOTE_ACTION,
      entity_type: "vehicle_listing",
      entity_id: vehicle.vin,
      store_id: tenant?.id || null,
      user_email: user?.email || null,
      details: { vin: vehicle.vin, listing_id: vehicle.id, text },
    });
    setSavingNote(false);
    if (err) { toast.error("Note could not be saved"); return; }
    setDraft("");
    toast.success("Note added");
    void loadHistory();
  };

  const state = row?.state ?? null;
  const offRail = !!state && OFF_RAIL.includes(state);
  const stageAction = canDecide && state === "AWAITING_MANAGER_AUTHORIZATION"
    ? { label: "Authorize for Get Ready", rpc: "authorize_vehicle_for_get_ready" }
    : canDecide && state === "FINAL_READY_VERIFICATION"
      ? { label: "Mark retail ready", rpc: "mark_vehicle_retail_ready" }
      : null;

  const runStageAction = async () => {
    if (!stageAction) return;
    setActing(true);
    try {
      // deno-lint-ignore no-explicit-any
      const { data, error: err } = await (supabase as any).rpc(stageAction.rpc, { p_vehicle_id: vehicle.id, p_note: null });
      if (err) { toast.error(err.message === "not_authorized" ? "Only a manager can complete this stage." : "The stage could not be completed."); return; }
      if (data?.ok === false) {
        if (data.reason === "not_cleared") {
          const blockers = ((data.blockers as string[]) || []).map(clearanceReasonLabel).join(". ");
          toast.error(blockers ? `Not cleared for delivery: ${blockers}` : "Not cleared for delivery yet.");
        } else if (data.reason === "not_certified") {
          toast.error("Licensee certification is still pending on the K-208.");
        } else if (data.reason === "already_authorized") {
          toast.error("Already authorized for Get Ready.");
        } else {
          toast.error("This stage can't be completed right now.");
        }
        return;
      }
      toast.success(stageAction.rpc === "mark_vehicle_retail_ready" ? "Vehicle marked retail ready." : "Authorized for Get Ready. Service is notified.");
      lifecycle.reload();
      void loadHistory();
    } finally {
      setActing(false);
    }
  };
  const latestPrep = prep[0] ?? null;
  const unlocked = !!latestPrep?.listing_unlocked;

  const header = (
    <VehicleSubHeader
      vehicle={vehicle}
      section="Get ready"
      crumbs={false}
      title="Vehicle get ready"
      description="Move this vehicle through each stage to become retail ready."
      strip={strip}
      actions={
        <>
          {stageAction && (
            <Button variant="primary" onClick={() => void runStageAction()} disabled={acting}>
              {acting ? "Saving" : stageAction.label}
            </Button>
          )}
          <Button variant={stageAction ? undefined : "primary"} onClick={() => navigate(`/get-ready-command/${vehicle.id}`)}>
            Open Get Ready Command <ArrowUpRight className="w-5 h-5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="More actions" className="h-10 w-10 grid place-items-center rounded-[6px] border border-adm-border bg-adm-surface text-adm-ink hover:bg-adm-workspace">
              <MoreHorizontal className="w-5 h-5" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => navigate(`/vehicle-file/${vehicle.id}`)}>Open vehicle file</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate(`/ready-board`)}>Open Ready Board</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { void navigator.clipboard?.writeText(vehicle.vin); toast.success("VIN copied"); }}>Copy VIN</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    />
  );

  // recompute_vehicle_lifecycle returns early for anything that is not used or
  // CPO stock, so a new vehicle has no lifecycle row by design. Say that
  // instead of drawing an empty rail.
  if (!tracked) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyNote
          title="New vehicles do not run a get-ready lifecycle"
          detail="The lifecycle machine tracks used, CPO and certified stock only. A new vehicle goes straight to merchandising: build its documents and publish it. Pre-delivery inspection and install sign-offs are recorded on the Compliance tab."
        />
        <Section title="Where new-vehicle prep is recorded">
          <DeepLink to={`/prep/${encodeURIComponent(vehicle.vin)}`} label="Prep & install sign-off" detail="Foreman sign-off, accessory installs and install photos" />
          <DeepLink to={`/vehicle-file/${vehicle.id}?tab=compliance`} label="Compliance" detail="Delivery sign-offs, install proof and the signature record" />
        </Section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}

      {loading ? (
        <Card><p className="text-al-body text-muted-foreground">Reading the lifecycle record…</p></Card>
      ) : error ? (
        <Card>
          <p className="text-al-body text-red-600 inline-flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0" /> The lifecycle record could not be read: {error}
          </p>
        </Card>
      ) : !state ? (
        <EmptyNote
          title="No lifecycle record for this vehicle yet"
          detail="The lifecycle row is created the first time the vehicle is recomputed after intake. Until then there is no stored stage to show — nothing here is guessed from other tables."
        />
      ) : (
        <>
          {offRail && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-al-card text-amber-900">{STATE_LABEL[state]} — the vehicle is off the get-ready rail</p>
                <p className="text-al-body text-amber-800 mt-0.5">
                  {row?.gate_reason
                    ? `Reason on file: ${row.gate_reason}`
                    : "No reason was recorded with this gate change."}
                  {" "}A manager moves it back through the intake gate.
                </p>
              </div>
            </div>
          )}

          <div>
            <RailStrip state={offRail ? (row?.previous_state ?? null) : state} />
            {offRail && (
              <p className="text-al-meta text-muted-foreground mt-2">
                Positioned from the last stage before the hold{row?.previous_state ? ` (${STATE_LABEL[row.previous_state]})` : ""}. No stage advances while the vehicle is parked.
              </p>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <div className="min-w-0 flex flex-col gap-4">
          {ready && (
        <Card title="Checklist" action={<span className="text-[13px] text-adm-muted tabular-nums">{ready.done} of {ready.checks.length} complete</span>}>
          <p className="-mt-2 text-[13px] leading-[18px] text-adm-muted">Complete all items to make this vehicle retail ready.</p>
          <ul className="divide-y divide-adm-border">
            {ready.checks.map((c) => (
              <li key={c.label} className="flex items-center justify-between gap-3 py-[4px] text-[14px] leading-[20px]">
                <span className="inline-flex items-center gap-2 min-w-0">
                  <span role="img" aria-label={c.ok ? "Complete" : c.blocks ? "Open, blocks publish" : "Open"} className={`h-4 w-4 shrink-0 rounded-[3px] border inline-flex items-center justify-center ${c.ok ? "bg-adm-primary border-adm-primary text-white" : "bg-adm-surface border-adm-border"}`}>
                    {c.ok && <Check className="w-3 h-3" strokeWidth={3} aria-hidden="true" />}
                  </span>
                  <span className="truncate">{c.label}</span>
                </span>
                <span className="text-[12px] leading-[18px] text-adm-muted shrink-0">
                  {c.ok ? (fmtWhen(c.when) ?? "Complete") : c.blocks ? "Open, blocks publish" : "Open"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
            </div>
            <div className="min-w-0 flex flex-col gap-4">
      <Card title="Notes">
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void addNote(); }}>
          <label className="sr-only" htmlFor="vehicle-note">Add a note</label>
          <textarea
            id="vehicle-note"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={500}
            rows={4}
            placeholder="Add a note for the team"
            className="w-full rounded-[6px] border border-adm-border bg-adm-surface px-3 py-2 text-[14px] leading-[20px] text-adm-ink focus:outline-none focus:ring-2 focus:ring-adm-primary"
          />
          <div className="flex items-center justify-between">
            <span className="text-[12px] leading-[18px] text-adm-muted tabular-nums">{draft.length} / 500</span>
            <Button type="submit" disabled={savingNote || !draft.trim()}>{savingNote ? "Saving" : "Save note"}</Button>
          </div>
        </form>
        {historyLoading ? (
          <p className="text-[14px] text-adm-muted">Loading notes...</p>
        ) : (() => {
          const notes = [
            ...notesFromAudit(noteRows),
            ...(row?.gate_reason ? [{ key: "gate", when: row.state_changed_at, who: "Manager gate", text: row.gate_reason }] : []),
            ...prep.filter((r) => r.notes && r.notes.trim()).map((r) => ({ key: r.id, when: r.updated_at, who: r.foreman_name || "Prep sign-off", text: r.notes as string })),
          ];
          return notes.length === 0 ? (
            null
          ) : (
            <ul className="divide-y divide-adm-border">
              {notes.map((n) => (
                <li key={n.key} className="py-2">
                  <p className="text-[14px] leading-[20px] text-adm-ink whitespace-pre-wrap">{n.text}</p>
                  <p className="text-[12px] leading-[18px] text-adm-muted">{n.who} | {fmtWhen(n.when) ?? "time unknown"}</p>
                </li>
              ))}
            </ul>
          );
        })()}
      </Card>
            </div>
          </div>
        </>
      )}

      <Disclosure
        title="Publishing gate"
        summary={unlocked ? "Publishing unlocked" : "Publishing locked, prep sign-off required"}
        defaultOpen={!unlocked}
      >
        <div className="flex items-start gap-3">
          {unlocked ? <Unlock className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" /> : <Lock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />}
          <div className="min-w-0">
            <p className={`text-al-card ${unlocked ? "text-emerald-900" : "text-amber-900"}`}>
              {unlocked ? "Publishing unlocked" : "Publishing locked — prep sign-off required"}
            </p>
            <p className={`text-al-body mt-0.5 ${unlocked ? "text-emerald-800" : "text-amber-800"}`}>
              {unlocked
                ? `Foreman ${latestPrep?.foreman_name || "sign-off"} recorded ${fmtWhen(latestPrep?.signed_at) ?? "on file"}.`
                : "A signed prep record gates the public listing. The latest sign-off must have the inspection passed and the listing unlocked."}
            </p>
          </div>
        </div>
      </Disclosure>

      <Card title="Prep & install records">
        {historyLoading ? (
          <p className="text-al-body text-muted-foreground">Loading records…</p>
        ) : prep.length === 0 ? (
          <EmptyNote
            title="No prep sign-offs recorded for this vehicle"
            detail="A foreman sign-off is created on the Prep screen when the install is complete. Nothing is shown here until one exists."
          />
        ) : (
          <div className="space-y-2">
            {prep.map((r) => (
              <PrepCard key={r.id} row={r} onOpen={() => navigate(`/prep/${encodeURIComponent(vehicle.vin)}`)} />
            ))}
          </div>
        )}
      </Card>

      <Card title="Stage history">
        {historyLoading ? (
          <p className="text-al-body text-muted-foreground">Loading history…</p>
        ) : gates.length === 0 && !row?.previous_state ? (
          <EmptyNote
            title="No recorded stage changes yet"
            detail="Manager gate changes are journaled to the audit log. Operational stages are recomputed from stored facts rather than journaled individually, so they appear only as the current stage above."
          />
        ) : (
          <ol className="space-y-2">
            {row?.previous_state && state && (
              <li className="rounded-xl border border-border bg-card px-4 py-3">
                <p className="text-al-body font-semibold text-foreground">
                  {STATE_LABEL[row.previous_state]} to {STATE_LABEL[state]}
                </p>
                <p className="text-al-meta text-muted-foreground">Most recent transition · {fmtWhen(row.state_changed_at) ?? "unknown"}</p>
              </li>
            )}
            {gates.map((g) => (
              <li key={g.id} className="rounded-xl border border-border bg-card px-4 py-3">
                <p className="text-al-body font-semibold text-foreground">
                  Manager gate set to {STATE_LABEL[(g.details?.new_state || "") as LifecycleState] || g.details?.new_state || "unknown state"}
                </p>
                <p className="text-al-meta text-muted-foreground">
                  {[fmtWhen(g.created_at), g.user_email, g.details?.reason].filter(Boolean).join(" · ")}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Section title="Work the specialist screens">
        <DeepLink to={`/get-ready-command/${vehicle.id}`} label="Get Ready Command" detail="Per-vehicle get-ready control for this VIN" />
        <DeepLink to={`/service/vehicle/${encodeURIComponent(vehicle.vin)}`} label="Service" detail="Inspection, findings, approvals and repairs" />
        <DeepLink to={`/k208/${encodeURIComponent(vehicle.vin)}`} label="Safety inspection (K-208)" detail="Inspection record and certification" />
        <DeepLink to="/recon" label="Recon" detail="Reconditioning board" />
        <DeepLink to={`/prep/${encodeURIComponent(vehicle.vin)}`} label="Prep & install" detail="Foreman sign-off and install photos" />
        <DeepLink to="/ready-board" label="Ready Board" detail="Detail, final verification and retail-ready release" />
      </Section>

      <p className="text-al-meta text-muted-foreground inline-flex items-center gap-1.5">
        <Wrench className="w-3.5 h-3.5" /> Stage names are the stored vehicle_lifecycle states; the rail groups them for reading and adds nothing.
      </p>
    </div>
  );
};

export default GetReadyTab;
