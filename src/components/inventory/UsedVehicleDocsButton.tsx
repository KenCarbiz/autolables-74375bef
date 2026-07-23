import { ScrollText } from "lucide-react";
import { useNavigate } from "react-router-dom";

export type UsedVehicleDocsButtonProps = {
  vehicleId: string;
  vin?: string | null;
  condition?: string | null;
  variant?: "button" | "menu";
  className?: string;
};

const UsedVehicleDocsButton = ({ vehicleId, condition, variant = "button", className = "" }: UsedVehicleDocsButtonProps) => {
  const navigate = useNavigate();
  const isUsedLike = condition === "used" || condition === "cpo" || !condition;

  if (!isUsedLike) return null;

  // Shortcut to the vehicle's Deal Flow — the one place the official FTC Buyers
  // Guide + CT K-208 are generated, filled, and filed.
  const launch = () => navigate(`/vehicle-file/${vehicleId}?tab=deal`);

  if (variant === "menu") {
    return (
      <button type="button" onClick={launch} className={`inline-flex w-full items-center gap-2 text-left ${className}`}>
        <ScrollText className="h-4 w-4" />
        FTC / K208 Documents
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={launch}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-xs font-bold text-blue-700 hover:bg-blue-100 ${className}`}
    >
      <ScrollText className="h-3.5 w-3.5" />
      FTC / K208
    </button>
  );
};

export default UsedVehicleDocsButton;
