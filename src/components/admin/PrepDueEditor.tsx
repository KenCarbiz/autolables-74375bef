import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/product";
import { isoToZonedInput, zonedInputToIso } from "@/lib/approvedFields/prepDueInput";

export const PrepDueEditor = ({
  dueAt,
  timeZone,
  pending,
  onSave,
}: {
  dueAt: string | null;
  timeZone: string | null | undefined;
  pending: boolean;
  onSave: (dueAt: string | null) => void;
}) => {
  const [value, setValue] = useState(() => isoToZonedInput(dueAt, timeZone));
  useEffect(() => setValue(isoToZonedInput(dueAt, timeZone)), [dueAt, timeZone]);

  const save = () => {
    const iso = zonedInputToIso(value, timeZone);
    if (!iso) {
      toast.error("Enter a valid due date.");
      return;
    }
    onSave(iso);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="datetime-local"
        aria-label="Due date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-9 min-w-0 flex-1 rounded-[6px] border border-adm-border bg-adm-surface px-2 text-[14px] text-adm-ink"
      />
      <Button onClick={save} disabled={pending || !value}>Set</Button>
      <Button onClick={() => onSave(null)} disabled={pending || !dueAt}>Clear</Button>
    </div>
  );
};

export default PrepDueEditor;
