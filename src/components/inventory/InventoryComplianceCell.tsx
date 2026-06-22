import InventoryComplianceChips from "@/components/inventory/InventoryComplianceChips";
import InventoryCtMvpBadge from "@/components/inventory/InventoryCtMvpBadge";
import UsedVehicleDocsButton from "@/components/inventory/UsedVehicleDocsButton";
import type { InventoryCtMvpStatus } from "@/hooks/useInventoryCtMvpStatus";

export type InventoryComplianceCellProps = {
  vehicle: {
    id: string;
    vin?: string | null;
    condition?: string | null;
  };
  status: InventoryCtMvpStatus | null;
  loading?: boolean;
  compact?: boolean;
};

const InventoryComplianceCell = ({ vehicle, status, loading = false, compact = false }: InventoryComplianceCellProps) => {
  const isUsedLike = vehicle.condition === "used" || vehicle.condition === "cpo" || !vehicle.condition;

  return (
    <div className="flex min-w-[170px] flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <InventoryCtMvpBadge status={status} loading={loading} compact={compact} />
        {isUsedLike ? <UsedVehicleDocsButton vehicleId={vehicle.id} vin={vehicle.vin} condition={vehicle.condition} /> : null}
      </div>
      <InventoryComplianceChips status={status} compact={compact} />
    </div>
  );
};

export default InventoryComplianceCell;
