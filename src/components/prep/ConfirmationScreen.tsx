import { format } from "date-fns";
import { CheckCircle2 } from "lucide-react";

interface ConfirmationScreenProps {
  vehicleLabel: string;
  vin: string;
  eventName: string;
  signerName: string;
  photoCount: number;
  submittedAt: string;
  onDone: () => void;
  onAddAnother: () => void;
  onViewTimeline: () => void;
}

const ConfirmationScreen = ({
  vehicleLabel,
  vin,
  eventName,
  signerName,
  photoCount,
  submittedAt,
  onDone,
  onAddAnother,
  onViewTimeline,
}: ConfirmationScreenProps) => (
  <div className="space-y-4">
    <div className="rounded-2xl bg-card border border-border shadow-premium p-6 text-center">
      <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto" />
      <h2 className="text-xl font-bold text-foreground mt-3">Signoff Submitted</h2>
      <p className="text-sm text-muted-foreground mt-1">This work event is locked and on the vehicle record.</p>
      <div className="mt-5 rounded-xl bg-muted/50 divide-y divide-border text-left">
        <Row label="Vehicle" value={vehicleLabel || vin} />
        <Row label="Event" value={eventName} />
        <Row label="Signed by" value={signerName} />
        <Row label="Photos uploaded" value={String(photoCount)} />
        <Row label="Time" value={format(new Date(submittedAt), "MMM d, yyyy h:mm a")} />
      </div>
    </div>
    <button
      onClick={onDone}
      className="w-full h-14 rounded-2xl bg-blue-600 text-white text-base font-bold shadow-premium hover:bg-blue-700 transition"
    >
      Done
    </button>
    <button
      onClick={onAddAnother}
      className="w-full h-12 rounded-2xl border border-border bg-card text-sm font-bold text-foreground hover:bg-muted transition"
    >
      Add Another Work Event
    </button>
    <button
      onClick={onViewTimeline}
      className="w-full h-12 rounded-2xl text-sm font-bold text-blue-600 hover:bg-blue-50 transition"
    >
      View Full Timeline
    </button>
  </div>
);

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="px-4 py-2.5 flex items-center justify-between gap-3">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="text-xs font-semibold text-foreground text-right">{value}</span>
  </div>
);

export default ConfirmationScreen;
