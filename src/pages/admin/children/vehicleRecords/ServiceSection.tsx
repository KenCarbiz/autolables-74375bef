import { Card } from "@/components/admin/al97/al97ui";
import { intakeLabel, repairChip } from "@/lib/vehicleHistory/labels";
import type { InspectionRow, RepairRow, VisitRow } from "@/lib/vehicleHistory/types";
import { Chip, NotInstalled, ReadFailure } from "./shared";
import { formatDate } from "./format";

export default function ServiceSection({ visits, inspections, repairs, installed }: {
  visits: VisitRow[] | null; inspections: InspectionRow[]; repairs: RepairRow[]; installed: boolean;
}) {
  return (
    <Card id="vr-service" title="Service and multi-point inspections" description="Each label states what the record says. A finding or an authorization is never shown as work performed.">
      {!installed ? <NotInstalled /> : visits === null ? <ReadFailure what="Service visits" /> : visits.length === 0 ? (
        <p className="vr-note">No service visits have been recorded yet.</p>
      ) : visits.map((v) => {
        const insp = inspections.filter((i) => i.service_visit_id === v.id);
        const items = repairs.filter((r) => r.service_visit_id === v.id);
        return (
          <section key={v.id} className="vr-visit" aria-label={`Service visit ${v.ro_number ?? v.id}`}>
            <h3><span className="vr-vin">{v.vin}</span></h3>
            <p className="vr-note" style={{ padding: "0 0 8px" }}>
              Opened {formatDate(v.opened_at)} from {v.source_app}{v.ro_number ? `, RO ${v.ro_number}` : ""}. {intakeLabel(v.intake_verification)}.
              {v.instance_id ? "" : " No active custody episode."}
            </p>
            {insp.length > 0 && (
              <p className="vr-note" style={{ padding: "0 0 8px" }}>
                {insp.map((i) => `Inspection ${formatDate(i.inspected_at)}, ${i.technician_verified ? "technician verified" : "not technician verified"}`).join(". ")}.
              </p>
            )}
            {items.length === 0 ? <p className="vr-note">No repair items on this visit.</p> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th scope="col">Item</th><th scope="col">Severity</th><th scope="col">Status</th></tr></thead>
                  <tbody>
                    {items.map((r) => (
                      <tr key={r.id}>
                        <td>{r.item ?? "Unnamed item"}</td>
                        <td>{r.severity ?? "Not rated"}</td>
                        <td><Chip chip={repairChip(r.status)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </Card>
  );
}
