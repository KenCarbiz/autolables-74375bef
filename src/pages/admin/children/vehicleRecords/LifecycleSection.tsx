import { useEffect, useRef, useState } from "react";
import { Card, Al97Dialog } from "@/components/admin/al97/al97ui";
import {
  custodyChip, DECISIONS, DECISION_ORDER, NO_SIDE_EFFECTS, reasonOk, restoreBlockedReason, type ReappearanceDecision,
} from "@/lib/vehicleHistory/labels";
import type { ReviewRow } from "@/lib/vehicleHistory/types";
import { Chip, NotInstalled, Notice, ReadFailure, Reason, type SectionProps } from "./shared";
import { formatDate } from "./format";

const EFFECTS: Record<ReappearanceDecision, { will: string[]; wont: string[] }> = {
  restore_episode: { will: ["The archived episode reopens with its history intact.", "A restored event is added to the vehicle timeline."], wont: ["No new episode is created."] },
  new_episode: { will: ["The earlier episode is kept and closed as it is.", "A new in-stock episode is opened and linked to it."], wont: ["The earlier episode is not rewritten."] },
  wrong_store_mapping: { will: ["The review is closed with your reason."], wont: ["No custody episode is opened or changed."] },
  reject_source: { will: ["The review is closed with your reason."], wont: ["No custody episode is opened or changed."] },
  keep_quarantined: { will: ["Your note is saved and the review stays open."], wont: ["No custody episode is opened or changed."] },
};

function DecisionDialog({ review, open, onOpenChange, onDone, resolve, returnFocus }: {
  review: ReviewRow; open: boolean; onOpenChange: (o: boolean) => void; onDone: (m: string) => void;
  resolve: SectionProps["actions"]["resolveReview"]; returnFocus: React.RefObject<HTMLElement>;
}) {
  const [decision, setDecision] = useState<ReappearanceDecision | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = restoreBlockedReason(review.prior_custody_state);
  useEffect(() => {
    if (!open) { setDecision(null); setReason(""); setError(null); }
  }, [open]);
  const ready = decision !== null && reasonOk(reason) && !busy;

  const submit = async () => {
    if (!decision || !reasonOk(reason)) return;
    setBusy(true);
    setError(null);
    const r = await resolve(review.id, decision, reason.trim()).catch(() => ({ ok: false as const, message: "The request did not reach the server. Nothing was changed." }));
    setBusy(false);
    if (r.ok) onDone(`${DECISIONS[decision].label} recorded for ${review.vin}.`);
    else setError(r.message);
  };

  return (
    <Al97Dialog
      open={open}
      onOpenChange={onOpenChange}
      returnFocus={returnFocus}
      title={`Decide return of ${review.vin}`}
      description="This vehicle appeared again after its earlier episode. Choose what the record should say."
      footer={<>
        <button type="button" className="btn" onClick={() => onOpenChange(false)}>Cancel</button>
        <button type="button" className="btn primary" disabled={!ready} onClick={submit}>{busy ? "Recording" : "Record decision"}</button>
      </>}
    >
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="vr-subhead">Decision</legend>
        {DECISION_ORDER.map((d) => {
          const off = d === "restore_episode" && blocked !== null;
          return (
            <div key={d} className={`vr-radio${off ? " off" : ""}`}>
              <label>
                <input type="radio" name="decision" value={d} checked={decision === d} disabled={off} onChange={() => setDecision(d)} />
                {DECISIONS[d].label}
              </label>
              <p>{off ? blocked : DECISIONS[d].description}</p>
            </div>
          );
        })}
      </fieldset>
      {decision && (
        <div className="vr-effects">
          <div><strong>What will happen</strong><ul>{EFFECTS[decision].will.map((t) => <li key={t}>{t}</li>)}</ul></div>
          <div><strong>What will not happen</strong><ul>{[...EFFECTS[decision].wont, NO_SIDE_EFFECTS].map((t) => <li key={t}>{t}</li>)}</ul></div>
        </div>
      )}
      <Reason id="vr-decision-reason" value={reason} onChange={setReason} />
      {error && <Notice tone="bad">{error}</Notice>}
    </Al97Dialog>
  );
}

function ReviewRowView({ review, canManage, onDone, resolve }: { review: ReviewRow; canManage: boolean; onDone: (m: string) => void; resolve: SectionProps["actions"]["resolveReview"] }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <tr>
      <td><span className="vr-vin">{review.vin}</span></td>
      <td>{review.detected_source}<small>{formatDate(review.detected_at)}</small></td>
      <td><Chip chip={custodyChip(review.prior_custody_state)} />{review.prior_instance_id ? null : <small>No prior episode</small>}</td>
      <td>
        {canManage ? (
          <>
            <button ref={trigger} type="button" className="btn" onClick={() => setOpen(true)}>Decide</button>
            <DecisionDialog review={review} open={open} onOpenChange={setOpen} resolve={resolve} returnFocus={trigger} onDone={(m) => { setOpen(false); onDone(m); }} />
          </>
        ) : <small>Owner or admin only</small>}
      </td>
    </tr>
  );
}

export default function LifecycleSection({ reviews, installed, canManage, actions, onChanged }: SectionProps & { reviews: ReviewRow[] | null; installed: boolean }) {
  const [notice, setNotice] = useState<string | null>(null);
  const done = (m: string) => { setNotice(m); onChanged(); };
  return (
    <Card id="vr-lifecycle" title="Lifecycle and returns" description="A sold, archived or missing vehicle is a custody state, never a deletion. When one shows up again, a person decides what the record says.">
      {!installed ? <NotInstalled /> : reviews === null ? <ReadFailure what="Open returns" /> : reviews.length === 0 ? (
        <p className="vr-note">No returns are waiting for a decision.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Vehicle</th><th scope="col">Seen again by</th><th scope="col">Prior episode</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
            <tbody>{reviews.map((r) => <ReviewRowView key={r.id} review={r} canManage={canManage} resolve={actions.resolveReview} onDone={done} />)}</tbody>
          </table>
        </div>
      )}
      {notice && <Notice tone="ok">{notice}</Notice>}
    </Card>
  );
}
