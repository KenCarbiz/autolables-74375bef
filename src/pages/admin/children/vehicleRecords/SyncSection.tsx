import { useState } from "react";
import { Card } from "@/components/admin/al97/al97ui";
import { inboxStatusLabel, INBOX_STATUS_LABELS, quarantineReasonLabel, reasonOk, REPLAYABLE_INBOX } from "@/lib/vehicleHistory/labels";
import type { InboxRow, QuarantineRow } from "@/lib/vehicleHistory/types";
import { Chip, NotInstalled, Notice, ReadFailure, Reason, type SectionProps } from "./shared";
import { formatDate } from "./format";

const STATUS_ORDER = Object.keys(INBOX_STATUS_LABELS);
const HEALTHY = new Set(["applied", "superseded"]);

interface Props extends SectionProps {
  installed: boolean;
  inbox: InboxRow[] | null;
  inboxCounts: Record<string, number> | null;
  quarantine: QuarantineRow[] | null;
  replayCap: number | null;
}

function Replay({ inbox, replayCap, actions, onChanged, canManage }: { inbox: InboxRow[]; replayCap: number | null; actions: SectionProps["actions"]; onChanged: () => void; canManage: boolean }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const run = async () => {
    setMsg(null);
    if (picked.length === 0) return setMsg({ tone: "bad", text: "Select at least one row to replay." });
    if (!reasonOk(reason)) return setMsg({ tone: "bad", text: "Enter a reason of at least 5 characters." });
    if (replayCap === null) return setMsg({ tone: "bad", text: "The replay limit could not be read, so nothing was sent." });
    if (picked.length > replayCap) return setMsg({ tone: "bad", text: `You selected ${picked.length} rows but the limit is ${replayCap}. Select fewer rows. Nothing was sent.` });
    setBusy(true);
    const r = await actions.replay(picked, reason.trim()).catch(() => ({ ok: false as const, message: "The request did not reach the server. Nothing was changed." }));
    setBusy(false);
    if (r.ok) { setMsg({ tone: "ok", text: `${picked.length} ${picked.length === 1 ? "row" : "rows"} queued to run again.` }); setPicked([]); setReason(""); onChanged(); }
    else setMsg({ tone: "bad", text: r.message });
  };

  return (
    <Card id="vr-replay" title="Dead letters and unmatched events" description={!canManage ? "Only owners and admins can replay events." : replayCap === null ? "The replay limit could not be read, so replay is off." : `Replay at most ${replayCap} ${replayCap === 1 ? "row" : "rows"} at a time. The server enforces the same limit.`}>
      {inbox.length === 0 ? <p className="vr-note">No dead-letter, held or unmatched events.</p> : (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr>{canManage && <th scope="col"><span className="sr-only">Select</span></th>}<th scope="col">Event</th><th scope="col">Vehicle</th><th scope="col">Status</th><th scope="col">Received</th></tr></thead>
              <tbody>
                {inbox.map((r) => (
                  <tr key={r.id}>
                    {canManage && <td>{REPLAYABLE_INBOX.has(r.status) ? <input type="checkbox" className="vr-check" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.event_type} ${r.vin ?? "without a VIN"}`} /> : <small>Not replayable</small>}</td>}
                    <td>{r.event_type}<small>{r.producer}</small></td>
                    <td>{r.vin ? <span className="vr-vin">{r.vin}</span> : "No VIN"}</td>
                    <td><Chip chip={{ label: inboxStatusLabel(r.status), tone: r.status === "held" ? "blue" : "amber" }} /></td>
                    <td>{formatDate(r.received_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canManage && (
            <>
              <p className="vr-note">{picked.length} selected{replayCap !== null ? ` of ${replayCap} allowed` : ""}.</p>
              <Reason id="vr-replay-reason" value={reason} onChange={setReason} />
              <p style={{ marginTop: 12 }}><button type="button" className="btn primary" onClick={run} disabled={busy}>{busy ? "Replaying" : "Replay selected rows"}</button></p>
            </>
          )}
        </>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </Card>
  );
}

export default function SyncSection({ installed, inbox, inboxCounts, quarantine, replayCap, canManage, actions, onChanged }: Props) {
  if (!installed) return <Card id="vr-sync" title="Sync activity and exceptions"><NotInstalled /></Card>;
  return (
    <div className="vr-stack">
      <Card id="vr-sync" title="Sync activity and exceptions" description="Incoming events from connected systems, by what happened to them.">
        {inboxCounts === null ? <ReadFailure what="Incoming event counts" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Status</th><th scope="col">Events</th></tr></thead>
              <tbody>
                {STATUS_ORDER.map((s) => (
                  <tr key={s}>
                    <td><Chip chip={{ label: inboxStatusLabel(s), tone: HEALTHY.has(s) ? "neutral" : s === "received" ? "blue" : "amber" }} /></td>
                    <td>{(inboxCounts[s] ?? 0).toLocaleString("en-US")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card id="vr-quarantine" title="Held vehicle identities" description="Service events whose vehicle could not be matched are parked here, not rewritten.">
        {quarantine === null ? <ReadFailure what="Held identities" /> : quarantine.length === 0 ? <p className="vr-note">No open held identities.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">VIN as received</th><th scope="col">Why it is held</th><th scope="col">Source</th><th scope="col">Received</th></tr></thead>
              <tbody>
                {quarantine.map((q) => (
                  <tr key={q.id}>
                    <td><span className="vr-vin">{q.raw_vin}</span></td>
                    <td>{quarantineReasonLabel(q.reason)}</td>
                    <td>{q.source_app}{q.source_ref ? <small>{q.source_ref}</small> : null}</td>
                    <td>{formatDate(q.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {inbox === null
        ? <Card id="vr-replay" title="Dead letters and unmatched events"><ReadFailure what="Dead letters" /></Card>
        : <Replay inbox={inbox} replayCap={replayCap} actions={actions} onChanged={onChanged} canManage={canManage} />}
    </div>
  );
}
