import VehicleEvidenceTimeline from "@/components/vehicle/VehicleEvidenceTimeline";
import { useVehicleEvidence } from "@/lib/stickerStudio/useVehicleEvidence";
import { STATE_LABEL } from "@/lib/lifecycle/states";
import { Card, EmptyNote, TabHeader, fmtWhen } from "./primitives";
import type { LifecycleResult } from "./lifecycle";
import type { VehicleRow } from "./types";

// History: the stored evidence timeline for this VIN plus the last lifecycle
// transition. It reads existing records only; nothing is generated here.
export const HistoryTab = ({ vehicle, lifecycle }: { vehicle: VehicleRow; lifecycle: LifecycleResult }) => {
  const { events, loading } = useVehicleEvidence(vehicle.id, vehicle.vin, vehicle.tenant_id);
  const row = lifecycle.row;
  return (
    <div className="space-y-6">
      <TabHeader
        title="History"
        description="What has been generated, signed, scanned and published against this VIN, in the order it happened."
      />
      {row?.previous_state && (
        <Card title="Latest lifecycle transition">
          <p className="text-al-body text-foreground">
            {STATE_LABEL[row.previous_state]} to {STATE_LABEL[row.state]}
            <span className="text-muted-foreground"> | {fmtWhen(row.state_changed_at) ?? "time unknown"}</span>
          </p>
        </Card>
      )}
      <Card title="Evidence timeline">
        {loading ? (
          <p className="text-al-body text-muted-foreground">Reading the evidence timeline...</p>
        ) : events.length === 0 ? (
          <EmptyNote
            title="Nothing has been recorded against this VIN yet"
            detail="Evidence rows are written as documents are generated, printed, signed, scanned and published."
          />
        ) : (
          <VehicleEvidenceTimeline
            vehicleId={vehicle.id}
            vin={vehicle.vin}
            tenantId={vehicle.tenant_id}
            vehicleTitle={vehicle.ymm || vehicle.vin}
          />
        )}
      </Card>
    </div>
  );
};

export default HistoryTab;
