import { Car } from "lucide-react";

interface VehicleFoundCardProps {
  photoUrl?: string;
  ymm: string;
  vin: string;
  stockNumber?: string;
}

const VehicleFoundCard = ({ photoUrl, ymm, vin, stockNumber }: VehicleFoundCardProps) => {
  const upper = vin.toUpperCase();
  const head = upper.slice(0, Math.max(0, upper.length - 6));
  const tail = upper.slice(-6);
  return (
    <div className="rounded-2xl bg-card border border-border shadow-premium overflow-hidden">
      {photoUrl ? (
        <img src={photoUrl} alt={ymm} className="w-full aspect-[16/9] object-cover" />
      ) : (
        <div className="w-full aspect-[16/9] bg-muted flex items-center justify-center">
          <Car className="w-10 h-10 text-muted-foreground/40" />
        </div>
      )}
      <div className="p-4">
        <p className="text-lg font-bold text-foreground leading-tight">{ymm || "Vehicle"}</p>
        <p className="mt-1.5 font-mono text-sm">
          <span className="text-muted-foreground">{head}</span>
          <span className="font-bold text-foreground text-base tracking-wide">{tail}</span>
        </p>
        {stockNumber && (
          <span className="mt-2 inline-block text-xs font-semibold text-muted-foreground bg-muted rounded-lg px-2 py-1">
            Stock #{stockNumber}
          </span>
        )}
      </div>
    </div>
  );
};

export default VehicleFoundCard;
