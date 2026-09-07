import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, Clock, Lock, Unlock, Wrench,
} from "lucide-react";
import { Card, DeepLink, EmptyNote, Pair, Section, TabHeader, btn, fmtWhen, sinceLabel } from "./primitives";
import {
  OFF_RAIL, RAIL, STATE_LABEL, STATE_NEXT_ACTION, STATE_OWNER,
  stageStates, type LifecycleResult, type LifecycleState, type StageState,
} from "./lifecycle";
import type { VehicleRow } from "./types";

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
  done: "bg-emerald-500 text-emerald-50 border-emerald-500",
  current: "bg-primary text-primary-foreground border-primary",
  future: "bg-muted text-muted-foreground border-border",
};

const RailStrip = ({ state }: { state: LifecycleState | null }) => {
  const states = stageStates(state);
  return (
    <ol className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-0">
      {RAIL.map((stage, i) => {
        const s = states[stage.key];
        return (
          <li key={stage.key} className="flex-1 min-w-0 flex sm:flex-col items-center sm:items-stretch gap-3 sm:gap-0">
            <div className="flex items-center sm:justify-center gap-0 shrink-0">
              {i > 0 && <span className={`hidden sm:block h-0.5 flex-1 ${s === "future" ? "bg-border" : "bg-emerald-500"}`} />}
              <span className={`w-7 h-7 rounded-full border-2 inline-flex items-center justify-center shrink-0 ${STAGE_DOT[s]}`}>
                {s === "done"
                  ? <CheckCircle2 className="w-4 h-4" />
                  : <span className="text-al-meta font-bold tabular-nums">{i + 1}</span>}
              </span>
              {i < RAIL.length - 1 && <span className={`hidden sm:block h-0.5 flex-1 ${states[RAIL[i + 1].key] === "future" ? "bg-border" : "bg-emerald-500"}`} />}
            </div>
            <div className="min-w-0 sm:text-center sm:mt-2">
              <p className={`text-al-body font-semibold truncate ${
                s === "current" ? "text-foreground" : s === "done" ? "text-emerald-700" : "text-muted-foreground"
              }`}>
                {stage.label}
              </p>
              <p className="text-al-meta text-muted-foreground truncate">
                {s === "done" ? "Confirmed" : s === "current" ? "In progress" : "Not started"}
              </p>
            </div>
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
          <span className={`text-al-meta font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${statusCls}`}>{row.status}</span>
          {row.listing_unlocked && (
            <span className="text-al-meta font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 inline-flex items-center gap-1">
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

export const GetReadyTab = ({ vehicle, lifecycle }: { vehicle: VehicleRow; lifecycle: LifecycleResult }) => {
  const navigate = useNavigate();
  const { row, loading, error, tracked } = lifecycle;
  const [prep, setPrep] = useState<PrepRow[]>([]);
  const [gates, setGates] = useState<GateEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      // deno-lint-ignore no-explicit-any
      const sb = supabase as unknown as { from: (t: string) => any };
      const [prepRes, gateRes] = await Promise.all([
        sb.from("prep_sign_offs")
          .select("id,created_at,signed_at,updated_at,status,foreman_name,inspection_passed,inspection_form_type,rejection_reason,listing_unlocked,accessories_installed,install_photos,notes")
          .eq("vin", vehicle.vin).order("updated_at", { ascending: false }).limit(20),
        sb.from("audit_log")
          .select("id, created_at, user_email, details")
          .eq("action", "vehicle_lifecycle_gate_set")
          .eq("entity_id", vehicle.vin)
          .order("created_at", { ascending: false }).limit(25),
      ]);
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

  const state = row?.state ?? null;
  const offRail = !!state && OFF_RAIL.includes(state);
  const latestPrep = prep[0] ?? null;
  const unlocked = !!latestPrep?.listing_unlocked;

  const header = (
    <TabHeader
      title="Get Ready"
      description={<>Where this vehicle stands in the stored lifecycle, who owns the current stage, and what has to happen next. The work itself is done on the specialist screens.</>}
      action={
        <button onClick={() => navigate(`/get-ready-command/${vehicle.id}`)} className={btn}>
          Open Get Ready Command <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
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
    <div className="space-y-6">
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

          <Card title="Stage rail">
            <RailStrip state={offRail ? (row?.previous_state ?? null) : state} />
            {offRail && (
              <p className="text-al-meta text-muted-foreground">
                Positioned from the last stage before the hold{row?.previous_state ? ` (${STATE_LABEL[row.previous_state]})` : ""}. No stage advances while the vehicle is parked.
              </p>
            )}
          </Card>

          <Card title="Current stage">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <Pair label="Lifecycle state" value={STATE_LABEL[state]} />
              <Pair label="Owner" value={STATE_OWNER[state]} />
              <Pair label="Time in stage" value={sinceLabel(row?.state_changed_at) ?? "Unknown"} />
              <Pair label="Since" value={fmtWhen(row?.state_changed_at) ?? "Unknown"} />
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
              <div>
                <p className="text-al-meta font-bold uppercase tracking-wider text-muted-foreground">Next action</p>
                <p className="text-al-body text-foreground mt-0.5">{STATE_NEXT_ACTION[state]}</p>
              </div>
              <div>
                <p className="text-al-meta font-bold uppercase tracking-wider text-muted-foreground">Blocker</p>
                <p className="text-al-body text-foreground mt-0.5">
                  {row?.gate_reason
                    ? row.gate_reason
                    : offRail
                      ? "A manager gate is holding this vehicle."
                      : state === "RETAIL_READY"
                        ? "None — the vehicle has cleared get ready."
                        : `Nothing beyond the stage itself. ${STATE_OWNER[state]} owns the next move.`}
                </p>
              </div>
            </div>
            {(state === "K208_READY_TO_CERTIFY" || state === "K208_FINALIZED") && (
              <p className="text-al-meta text-muted-foreground">
                Shown for visibility only. K-208 certification authority comes from the store's K-208 policy and is enforced server-side — never from a job title.
              </p>
            )}
          </Card>
        </>
      )}

      <Card title="Publishing gate">
        <div className={`rounded-xl border p-4 flex items-start gap-3 ${
          unlocked ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
        }`}>
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
      </Card>

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
