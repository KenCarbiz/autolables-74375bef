import { ReviewDialog } from "@/components/admin/v2/ReviewDialog";
import { AdminButton, AdminTable, InlineNote, Td, Th } from "@/components/admin/v2/primitives";
import { canApply } from "@/lib/admin/reviewApply";
import { ROUTING_FIELD_LABELS } from "@/lib/admin/routingDraft";
import type { RoutingDraftApi } from "./useRoutingDraft";

const OUTPUTS = [
  { label: "Customer Passport contact", detail: "The Talk to us pill and sheet on every published passport (public-listing-view)." },
  { label: "Lead alerts", detail: "Who is told when a shopper reserves, values a trade or asks a question (lead-alert)." },
  { label: "Unanswered lead escalation", detail: "The scheduled sweep that escalates unanswered requests (passport-lead-escalation)." },
];

export const RoutingReviewDialog = ({
  api,
  open,
  onClose,
  title = "Review routing changes",
}: {
  api: RoutingDraftApi;
  open: boolean;
  onClose: () => void;
  title?: string;
}) => {
  const { state, gate, changeRows, storeCount, canEdit } = api;
  const phase = state.phase;
  const applyGate = canApply(state);
  const canPress = phase === "reviewing" && applyGate.ok && gate.ok && canEdit;
  const scope = storeCount === 1 ? "this rooftop" : `all ${storeCount} rooftops on this account`;

  const footerText =
    phase === "applied" ? state.result?.message ?? "Applied."
    : state.error ? state.error
    : phase === "reviewing" && !gate.ok ? gate.reason
    : phase === "reviewing" && !applyGate.ok ? applyGate.reason
    : phase === "conflict" ? "Reload to pick up the changes made elsewhere, then review again."
    : "Nothing is written until you apply.";

  return (
    <ReviewDialog
      open={open}
      title={title}
      subtitle={`Applies to ${scope}. Nothing is written until you apply.`}
      onClose={onClose}
      footer={
        <>
          <p className={`text-[13px] leading-[18px] ${state.error || (phase === "reviewing" && !gate.ok) ? "text-adm-danger" : "text-adm-muted"}`} role="status">{footerText}</p>
          <div className="flex items-center gap-2">
            {phase === "applied" ? (
              <AdminButton variant="primary" onClick={onClose}>Done</AdminButton>
            ) : phase === "conflict" ? (
              <>
                <AdminButton variant="secondary" onClick={onClose}>Keep editing</AdminButton>
                <AdminButton variant="primary" onClick={() => { api.discard(); onClose(); }}>Reload settings</AdminButton>
              </>
            ) : (
              <>
                <AdminButton variant="secondary" onClick={onClose} disabled={phase === "applying"}>Cancel</AdminButton>
                <AdminButton variant="primary" onClick={() => { void api.apply(); }} disabled={!canPress}>{phase === "applying" ? "Applying…" : "Apply changes"}</AdminButton>
              </>
            )}
          </div>
        </>
      }
    >
      {phase === "conflict" ? (
        <InlineNote tone="danger" title="These settings changed elsewhere while you were editing.">
          {state.changedElsewhere.map((f) => ROUTING_FIELD_LABELS[f] ?? f).join(", ")}. Reload to see the current values; your draft will be discarded.
        </InlineNote>
      ) : (
        <>
          {changeRows.length === 0 ? (
            <p className="text-[14px] text-adm-muted">Nothing has changed.</p>
          ) : (
            <AdminTable caption="Settings that will change">
              <thead>
                <tr>
                  <Th>Setting</Th>
                  <Th>Before</Th>
                  <Th>After</Th>
                </tr>
              </thead>
              <tbody>
                {changeRows.map((r) => (
                  <tr key={r.field}>
                    <Td className="font-semibold">{r.label}</Td>
                    <Td className="text-adm-muted">{r.before}</Td>
                    <Td>{r.after}</Td>
                  </tr>
                ))}
              </tbody>
            </AdminTable>
          )}

          {gate.newBlockers.length > 0 ? (
            <InlineNote tone="danger" title="Add a valid fallback before enabling this route.">{gate.newBlockers.join(" ")}</InlineNote>
          ) : gate.remainingBlockers.length > 0 ? (
            <InlineNote tone="warning" title="Existing gaps remain after this change.">{gate.remainingBlockers.join(" ")} Requests still end at the store contact.</InlineNote>
          ) : gate.readinessAfter.ready ? (
            <InlineNote tone="success" title="Every public route ends at a working destination." />
          ) : null}

          {phase === "applied" && state.result && <InlineNote tone="success" title="Applied.">{state.result.message}</InlineNote>}
          {phase === "failed" && state.error && <InlineNote tone="danger" title="Not applied.">{state.error}</InlineNote>}

          <div>
            <p className="text-[14px] font-semibold text-adm-ink">What this affects</p>
            <ul className="mt-2 space-y-2">
              {OUTPUTS.map((o) => (
                <li key={o.label} className="text-[13px] leading-[18px]">
                  <span className="font-semibold text-adm-ink">{o.label}</span>
                  <span className="text-adm-muted"> {o.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </ReviewDialog>
  );
};
