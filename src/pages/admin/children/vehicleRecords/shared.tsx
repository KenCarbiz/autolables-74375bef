import { ChipView } from "@/components/admin/al97/al97ui";
import type { LabelChip } from "@/lib/vehicleHistory/labels";
import type { VehicleRecordsActions } from "@/lib/vehicleHistory/types";
import "./vehicleRecords.css";

export interface SectionProps {
  canManage: boolean;
  actions: VehicleRecordsActions;
  onChanged: () => void;
}

export const Chip = ({ chip }: { chip: LabelChip }) => <ChipView chip={chip} />;

export const ReadFailure = ({ what }: { what: string }) => (
  <p className="vr-note" role="status">{what} could not be read. This is a read failure, not an empty list.</p>
);

export const NotInstalled = () => (
  <p className="vr-note" role="status">Nothing to show here until the vehicle history migration is applied.</p>
);

export const Notice = ({ tone, children }: { tone: "ok" | "bad"; children: string }) => (
  <p className={`vr-notice ${tone}`} role={tone === "bad" ? "alert" : "status"}>{children}</p>
);

export const Reason = ({ id, value, onChange, label = "Reason" }: { id: string; value: string; onChange: (v: string) => void; label?: string }) => (
  <label className="field" htmlFor={id}>
    <span>{label} (at least 5 characters)</span>
    <input id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
  </label>
);
