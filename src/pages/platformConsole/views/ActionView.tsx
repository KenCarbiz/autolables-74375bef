import { useId, useState, type FormEvent } from "react";
import { ConsoleFrame } from "@/components/platformConsole/ConsoleFrame";
import { ConsoleIcon } from "@/components/platformConsole/icons";
import { ConsoleButton, FactRows, Panel } from "@/components/platformConsole/ui";
import { LinkButton, StickyActionBar, StickyBarSpacer, useIsPhone, ViewBoundary } from "@/components/platformConsole/uiA";
import { MutationBlockedError, useConsoleMutation, useConsoleView } from "@/lib/platformConsole/dataSource";
import { loadAction, type ActionReviewModel } from "@/lib/platformConsole/live/actions";
import { useConsoleParams } from "../PlatformConsole";

// Review form for a mutating action. Nothing here sends a request by itself:
// Execute goes through useConsoleMutation, which refuses anything this build
// is not authorized to run, and the refusal is shown on the page.

export default function ActionView() {
  const phone = useIsPhone();
  const { actionId = "" } = useConsoleParams();
  const view = useConsoleView<ActionReviewModel>("action", () => loadAction(actionId), { key: [actionId] });
  return (
    <ConsoleFrame
      title={phone ? (view.data?.phoneTitle ?? "Review action") : (view.data?.title ?? "Review operational action")}
      subtitle="Preview scope and consequences before executing a paid or mutating action."
      onRefresh={view.isFixture ? undefined : view.refresh}
      refreshing={view.status === "loading"}
    >
      <ViewBoundary view={view} what="action">
        {(m) => <ActionForm m={m} phone={phone} />}
      </ViewBoundary>
    </ConsoleFrame>
  );
}

function ActionForm({ m, phone }: { m: ActionReviewModel; phone: boolean }) {
  const run = useConsoleMutation();
  const [reason, setReason] = useState(m.reasonDraft);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const reasonId = useId();
  const formId = useId();
  const alertId = useId();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setOutcome(null);
    try {
      const r = await run({ kind: m.kind, operationKey: `${m.actionId}:${m.previewVersion}`, reason, scope: m.scope, previewVersion: m.previewVersion });
      setOutcome({ ok: true, message: r.message });
    } catch (err) {
      setOutcome({ ok: false, message: err instanceof MutationBlockedError || err instanceof Error ? err.message : "The action was refused." });
    } finally {
      setBusy(false);
    }
  }

  const rows = phone ? m.phone.rows : m.rows;
  const result = outcome && (
    <p id={alertId} role={outcome.ok ? "status" : "alert"} className={`mt-3 flex items-start gap-2 rounded-[6px] px-3 py-2 text-[13px] ${outcome.ok ? "bg-[#E8F5EF] text-[#11734E]" : "bg-[#FFF0F1] text-[#B42332]"}`}>
      <ConsoleIcon name="warning" size={16} className="mt-[1px] shrink-0" />
      <span>{outcome.ok ? outcome.message : `Refused: ${outcome.message}`}</span>
    </p>
  );
  const reasonInput = (
    <input
      id={reasonId}
      value={reason}
      onChange={(e) => setReason(e.target.value)}
      placeholder={m.phone.reasonPlaceholder}
      aria-describedby={outcome ? alertId : undefined}
      aria-required="true"
      className="mt-[5px] h-11 w-full rounded-[6px] border border-[#D7E1ED] bg-white px-3 text-[13px] text-[#132A42] placeholder:text-[#52677C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#075BE8]"
    />
  );

  if (phone) {
    return (
      <form id={formId} onSubmit={onSubmit} noValidate>
        <Panel id="pc-act-m" title={m.phone.heading} helper={m.phone.subtitle} className="min-h-[720px]">
          <dl className="-mx-1 mt-[7px]">
            {rows.map((r) => (
              <div key={r.label} className="mt-[37px] border-b border-[#D7E1ED] pb-[24px] first:mt-[30px]">
                <dt className="text-[13px] font-bold leading-[18px] text-[#52677C]">{r.label}</dt>
                <dd className="mt-[15px] text-[12px] leading-[16px] text-[#132A42]">{r.value}</dd>
              </div>
            ))}
          </dl>
          <div className="-mx-1 mt-[66px]">
            <label htmlFor={reasonId} className="text-[13px] font-bold leading-[18px] text-[#132A42]">Reason required</label>
            {reasonInput}
            <p className="mt-[28px] text-[12px] leading-[16px] text-[#885608]">{m.phone.note}</p>
            {result}
          </div>
        </Panel>
        <StickyBarSpacer />
        <StickyActionBar>
          <ConsoleButton type="submit" form={formId} variant="primary" disabled={busy} className="w-[174px]">{m.executeLabel}</ConsoleButton>
        </StickyActionBar>
      </form>
    );
  }

  return (
    <form id={formId} onSubmit={onSubmit} noValidate className="mx-auto w-full max-w-[1080px]">
      <Panel id="pc-act" title={m.heading} helper={m.subtitle} className="min-h-[650px]">
        <div className="mx-1 mt-[2px]">
          <FactRows labelWidth={263} rowHeight={64} rows={m.rows.map((r) => ({ label: r.label, value: r.value }))} />
        </div>
        <div className="mx-1 mt-[58px]">
          <label htmlFor={reasonId} className="text-[13px] font-bold leading-[18px] text-[#132A42]">Reason required</label>
          {reasonInput}
          {result}
        </div>
        <div className="mx-1 mt-[56px] flex justify-end gap-3">
          <LinkButton to={m.backHref} className="w-[130px]">Cancel</LinkButton>
          <ConsoleButton type="submit" variant="primary" disabled={busy} className="w-[194px]">{m.executeLabel}</ConsoleButton>
        </div>
      </Panel>
    </form>
  );
}
