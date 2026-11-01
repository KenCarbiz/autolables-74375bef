import { useState, type FormEvent } from "react";
import { Card, Glyph } from "@/components/admin/al97/al97ui";
import { custodyChip, intakeLabel, laneForMilestone, milestoneLabel, NOT_INSTALLED_BANNER, openedReasonLabel, type ChipTone, type LifecycleLane } from "@/lib/vehicleHistory/labels";
import type { LookupResult, VehicleLookup, VehicleRecordsActions } from "@/lib/vehicleHistory/types";
import { Chip, NotInstalled, Notice } from "./shared";
import { formatDate } from "./format";

interface TimelineEvent { at: string | null; lane: LifecycleLane; text: string; detail?: string }

const LANE_TONE: Record<LifecycleLane, ChipTone> = { Inventory: "blue", Service: "neutral", Ownership: "neutral" };

function buildTimeline(v: VehicleLookup): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const e of v.episodes) {
    events.push({ at: e.acquired_at ?? e.created_at, lane: "Inventory", text: `Episode opened: ${openedReasonLabel(e.opened_reason)}` });
  }
  for (const m of v.milestones) events.push({ at: m.occurred_at, lane: laneForMilestone(m.milestone), text: milestoneLabel(m.milestone) });
  for (const s of v.visits) {
    events.push({
      at: s.opened_at,
      lane: "Service",
      text: `Service visit${s.ro_number ? `, RO ${s.ro_number}` : ""}`,
      detail: `${intakeLabel(s.intake_verification)}${s.odometer_value != null ? ` - ${s.odometer_value.toLocaleString("en-US")} ${s.odometer_unit}` : ""}`,
    });
  }
  return events.sort((a, b) => (a.at ?? "9999").localeCompare(b.at ?? "9999"));
}

function VehicleResult({ v }: { v: VehicleLookup }) {
  const timeline = buildTimeline(v);
  const hasActive = v.episodes.some((e) => e.status === "active" && e.custody_state !== "archived");
  const byId = new Map(v.episodes.map((e) => [e.id, e]));
  return (
    <Card id={`vr-vin-${v.vin}`} title={`VIN ${v.vin}`} description={hasActive ? undefined : "No active custody episode. Service and inspection history stays with the vehicle."}>
      <h3 className="vr-subhead">Custody episodes</h3>
      {v.episodes.length === 0 ? <p className="vr-note">This vehicle has no custody episode at this account.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Episode</th><th scope="col">Custody state</th><th scope="col">Opened</th><th scope="col">Ended</th></tr></thead>
            <tbody>
              {v.episodes.map((e) => (
                <tr key={e.id}>
                  <td>{openedReasonLabel(e.opened_reason)}{e.previous_instance_id && byId.has(e.previous_instance_id) ? <small>Follows the {openedReasonLabel(byId.get(e.previous_instance_id)!.opened_reason).toLowerCase()} episode</small> : null}</td>
                  <td><Chip chip={custodyChip(e.custody_state)} /></td>
                  <td>{formatDate(e.acquired_at ?? e.created_at)}</td>
                  <td>{e.disposed_at ? formatDate(e.disposed_at) : e.status === "active" ? "Still open" : "Not recorded"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3 className="vr-subhead">Service visits</h3>
      {v.visits.length === 0 ? <p className="vr-note">No service visits recorded for this VIN.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Opened</th><th scope="col">Source</th><th scope="col">Repair order</th><th scope="col">Intake</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {v.visits.map((s) => (
                <tr key={s.id}>
                  <td>{formatDate(s.opened_at)}</td>
                  <td>{s.source_app}</td>
                  <td>{s.ro_number ?? "None"}</td>
                  <td>{intakeLabel(s.intake_verification)}</td>
                  <td>{s.status === "closed" ? "Closed" : s.status === "voided" ? "Voided" : "Open"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3 className="vr-subhead">Timeline</h3>
      <ol className="timeline" aria-label={`Timeline for ${v.vin}`}>
        {timeline.map((t, i) => (
          <li key={i}>
            <span className="vr-lane"><Chip chip={{ label: t.lane, tone: LANE_TONE[t.lane] }} /></span>
            <strong>{t.text}</strong>
            <small>{formatDate(t.at)}{t.detail ? ` - ${t.detail}` : ""}</small>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export default function SearchSection({ actions, installed }: { actions: VehicleRecordsActions; installed: boolean }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim() || busy) return;
    setBusy(true);
    setResult(null);
    try {
      setResult(await actions.lookup(query));
    } catch {
      setResult({ kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vr-stack">
      <Card id="vr-search" title="Vehicle files search" description="Look up one vehicle by VIN or stock number to see every custody episode and service visit at this account.">
        {installed ? (
          <form className="vr-search" onSubmit={submit}>
            <label className="field" htmlFor="vr-q">
              <span>VIN or stock number</span>
              <input id="vr-q" className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="1HGCM82633A004352" autoComplete="off" spellCheck={false} />
            </label>
            <button type="submit" className="btn primary" disabled={busy || !query.trim()}><Glyph name="search" />{busy ? "Searching" : "Search"}</button>
          </form>
        ) : <NotInstalled />}
        {busy && <p className="vr-note" role="status" aria-busy="true">Searching vehicle records.</p>}
        {result?.kind === "none" && <Notice tone="ok">No custody episode or service visit found for that VIN or stock number at this account.</Notice>}
        {result?.kind === "error" && <Notice tone="bad">The search could not be completed. This is a read failure, not an empty result.</Notice>}
        {result?.kind === "missing" && <Notice tone="bad">{NOT_INSTALLED_BANNER}</Notice>}
      </Card>
      {result?.kind === "found" && result.vehicles.map((v) => <VehicleResult key={v.vin} v={v} />)}
    </div>
  );
}
