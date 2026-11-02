import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { adminTabHref } from "@/lib/admin/sections";
import { ChildPageFrame } from "@/components/admin/v2/AdminShell";
import { Button, EmptyState, InlineNote, Panel, SkeletonBlock, StatusText } from "@/components/product";
import {
  activateLaunch, approvePlan, attestCheck, describeError, emergencyStop, expandLaunch, getLaunchStatus, pauseLaunch, recordQuota, releaseStop, resumeLaunch, rollbackLaunch, stopDrill,
} from "@/lib/marketcheckLaunch/api";
import type { FailedCheck, LaunchStatus, ReadinessCheck } from "@/lib/marketcheckLaunch/types";
import { canExpand, canPause, canResume, canRollback, failingMandatory, nextRolloutStore, refusalText, stateLabel, STATE_TONE } from "@/lib/marketcheckLaunch/viewModel";
import { AttestDialog, QuotaDialog, ReasonDialog, TypedConfirmDialog, type Outcome, type Perform } from "./marketcheckLaunch/dialogs";
import { AuditSection, ConsumptionSection, PlanSummary, ReadinessSection, Section, SqlFallback, StateSection } from "./marketcheckLaunch/sections";

const crumbs = [
  { label: "Administration", href: "/admin" },
  { label: "Integrations", href: adminTabHref("inventory-feed") },
  { label: "MarketCheck" },
  { label: "Launch Control" },
];
const TITLE = "MarketCheck Launch Control";
const STATUS_KEY = ["mc-launch", "status"] as const;

type Dialog = null | "activate" | "pause" | "resume" | "expand" | "rollback" | "stop" | "release" | "quota" | "approve";

export default function MarketCheckLaunchControlPage() {
  const auth = useAuth();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [attest, setAttest] = useState<ReadinessCheck | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const q = useQuery({ queryKey: STATUS_KEY, queryFn: getLaunchStatus, enabled: auth.isAdmin });

  const perform: Perform = useCallback(async (fn, success) => {
    let out: Outcome;
    try {
      const r = await fn();
      out = r.ok ? { ok: true } : { ok: false, message: refusalText(r.reason ?? "refused"), failed: r.failed as FailedCheck[] | undefined };
      if (r.ok) setNotice({ tone: "success", text: success });
    } catch (e) {
      out = { ok: false, message: describeError(e) };
    }
    await qc.invalidateQueries({ queryKey: STATUS_KEY });
    return out;
  }, [qc]);

  if (auth.loading) return <ChildPageFrame section="integrations" crumbs={crumbs} title={TITLE}><SkeletonBlock className="h-64 w-full" /></ChildPageFrame>;
  if (!auth.isAdmin) {
    return (
      <ChildPageFrame section="integrations" crumbs={crumbs} title={TITLE}>
        <Panel><EmptyState title="Platform administrators only" detail="This console controls paid MarketCheck calls, so it is limited to platform administrators." compact /></Panel>
      </ChildPageFrame>
    );
  }

  const s = q.data ?? null;
  const close = () => setDialog(null);
  const failing = s ? failingMandatory(s.readiness?.checks) : [];
  const next = s ? nextRolloutStore(s.plan?.rollout_stores) : null;

  return (
    <ChildPageFrame
      section="integrations"
      crumbs={crumbs}
      title={TITLE}
      badge={s ? <StatusText tone={STATE_TONE[s.state]}>{stateLabel(s.state)}</StatusText> : <StatusText tone="neutral">Unknown</StatusText>}
      subtitle="Readiness, consumption and the controlled start of paid MarketCheck calls. Reading this page never makes a paid call or changes any setting."
    >
      <div className="space-y-4">
        <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-[#F3B4AE] bg-adm-danger-bg px-4 py-3">
          <span className="text-[13px] font-semibold text-adm-danger">Emergency stop is always available</span>
          <Button variant="danger" className="!bg-adm-danger !text-white" onClick={() => setDialog("stop")}>Stop All MarketCheck Paid Calls</Button>
        </div>

        {notice && <InlineNote tone={notice.tone} title={notice.text} action={<Button size="sm" variant="ghost" onClick={() => setNotice(null)}>Dismiss</Button>} />}
        {q.isLoading && <SkeletonBlock className="h-64 w-full" />}
        {q.isError && (
          <InlineNote tone="danger" title="Launch status is Unknown" action={<Button size="sm" onClick={() => q.refetch()}>Retry</Button>}>
            Could not read launch status. {describeError(q.error)} Nothing below can be treated as passed until this loads.
          </InlineNote>
        )}

        {s && (
          <>
            <ReadinessSection status={s} onRecord={setAttest} />
            <ConsumptionSection c={s.consumption} onRecord={() => setDialog("quota")} />
            <StateSection status={s} onApprove={() => setDialog("approve")} />
            <ActivationSection
              status={s}
              failingLabels={failing.map((c) => c.label)}
              next={next?.name ?? null}
              onOpen={setDialog}
            />
          </>
        )}

        <Section title="Emergency stop" description="Stops every paid MarketCheck call and parks the scheduled jobs.">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="danger" className="!bg-adm-danger !text-white" onClick={() => setDialog("stop")}>Stop All MarketCheck Paid Calls</Button>
            {s?.emergency_stop && <Button variant="outline" onClick={() => setDialog("release")}>Release stop</Button>}
            {s && !s.emergency_stop && (
              <Button variant="secondary" onClick={() => void perform(stopDrill, "Stop drill finished")}>Run stop drill</Button>
            )}
          </div>
          {s?.emergency_stop && <p className="mt-2 text-[13px] text-adm-muted">Releasing the stop lands in PAUSED. It never goes live on its own.</p>}
          <SqlFallback />
        </Section>

        {s && <AuditSection events={s.events ?? []} />}
      </div>

      <TypedConfirmDialog
        open={dialog === "activate"}
        onClose={close}
        title="Start MarketCheck & Inventory Intelligence"
        description="Review exactly what this starts. Paid MarketCheck calls begin for the canary store only."
        word="START"
        confirmLabel="Start"
        onConfirm={() => perform(() => activateLaunch(s!.plan!.version, "START"), "MarketCheck canary started")}
      >
        {s?.plan && <PlanSummary plan={s.plan} />}
      </TypedConfirmDialog>
      <ReasonDialog open={dialog === "pause"} onClose={close} title="Pause MarketCheck launch" confirmLabel="Pause" onConfirm={(reason) => perform(() => pauseLaunch(reason), "Launch paused")} />
      <TypedConfirmDialog open={dialog === "resume"} onClose={close} title="Resume MarketCheck launch" word="RESUME" confirmLabel="Resume" onConfirm={() => perform(() => resumeLaunch("RESUME"), "Launch resumed")} />
      <TypedConfirmDialog
        open={dialog === "expand"}
        onClose={close}
        title={next ? `Expand to ${next.name}` : "Expand"}
        description="Only the next store in the approved order can be added."
        word="EXPAND"
        confirmLabel="Expand"
        onConfirm={() => perform(() => expandLaunch(next!.store_id, "EXPAND"), "Next store added")}
      />
      <TypedConfirmDialog open={dialog === "rollback"} onClose={close} title="Roll back MarketCheck launch" description="Restores the budget, store policies and scheduled jobs saved before activation." word="ROLLBACK" confirmLabel="Roll back" danger onConfirm={() => perform(() => rollbackLaunch("ROLLBACK"), "Launch rolled back")} />
      <TypedConfirmDialog open={dialog === "release"} onClose={close} title="Release emergency stop" description="The launch lands in PAUSED, never live. Resume it separately." word="RELEASE" confirmLabel="Release stop" onConfirm={() => perform(() => releaseStop("RELEASE"), "Stop released; launch is paused")} />
      <ReasonDialog open={dialog === "stop"} onClose={close} title="Stop all MarketCheck paid calls" description="Every paid MarketCheck call is blocked immediately and scheduled jobs are parked." confirmLabel="Stop all paid calls" danger onConfirm={(reason) => perform(() => emergencyStop(reason), "Emergency stop is on")} />
      <TypedConfirmDialog open={dialog === "approve"} onClose={close} title="Approve launch plan" description="Approving marks this plan version as the one that can be started." word="APPROVE" confirmLabel="Approve plan" onConfirm={() => perform(() => approvePlan(s!.plan!.version), "Plan approved")}>
        {s?.plan && <PlanSummary plan={s.plan} />}
      </TypedConfirmDialog>
      <QuotaDialog open={dialog === "quota"} onClose={close} onSubmit={(f) => perform(() => recordQuota(f), "Provider figures recorded")} />
      <AttestDialog check={attest} onClose={() => setAttest(null)} onSubmit={(a) => perform(() => attestCheck(a), "Evidence recorded")} />
    </ChildPageFrame>
  );
}

function ActivationSection({ status: s, failingLabels, next, onOpen }: { status: LaunchStatus; failingLabels: string[]; next: string | null; onOpen: (d: Dialog) => void }) {
  const running = s.activation_on || s.state === "paused";
  return (
    <Section title="Activation" description="Starting is deliberate: it needs every mandatory check passed, an approved plan and a typed confirmation.">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={!s.activation_allowed || !s.plan} onClick={() => onOpen("activate")}>Start MarketCheck &amp; Inventory Intelligence</Button>
      </div>
      {!s.activation_allowed && (
        <div className="mt-3">
          <InlineNote tone="warning" title={s.emergency_stop ? "Emergency stop is on" : s.activation_on ? "Already started" : "Activation is disabled"}>
            {!s.emergency_stop && !s.activation_on && failingLabels.length > 0 && <>Not passed: {failingLabels.join(", ")}.</>}
            {!s.emergency_stop && !s.activation_on && failingLabels.length === 0 && <>The plan is not approved or the state does not allow starting.</>}
          </InlineNote>
        </div>
      )}
      {running && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {canPause(s) && <Button variant="secondary" onClick={() => onOpen("pause")}>Pause</Button>}
          {canResume(s) && <Button variant="primary" onClick={() => onOpen("resume")}>Resume</Button>}
          {canExpand(s) && <Button variant="outline" onClick={() => onOpen("expand")}>Expand next store{next ? `: ${next}` : ""}</Button>}
          {canRollback(s) && <Button variant="danger" onClick={() => onOpen("rollback")}>Rollback</Button>}
        </div>
      )}
      {!running && canRollback(s) && (
        <div className="mt-4"><Button variant="danger" onClick={() => onOpen("rollback")}>Rollback</Button></div>
      )}
    </Section>
  );
}
