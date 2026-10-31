import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/product";
import { useDealNumbers } from "@/hooks/useApprovedFields";
import { DEAL_NUMBER_MAX_LENGTH, displayDealNumber, normalizeDealNumber } from "@/lib/approvedFields/dealNumber";

export const DealNumberField = ({ addendumId, canEdit }: { addendumId: string; canEdit: boolean }) => {
  const { dealNumbers, save } = useDealNumbers([addendumId]);
  const stored = dealNumbers?.status === "available" ? dealNumbers.data.get(addendumId) ?? null : null;
  const [value, setValue] = useState(stored ?? "");
  const [editing, setEditing] = useState(false);
  useEffect(() => setValue(stored ?? ""), [stored]);

  if (dealNumbers?.status !== "available") {
    return <span className="text-adm-muted">{displayDealNumber(null)}</span>;
  }
  if (!canEdit) return <span className={stored ? undefined : "text-adm-muted"}>{displayDealNumber(stored)}</span>;

  const { value: next, error } = normalizeDealNumber(value);
  const dirty = next !== (stored ?? null);

  const cancel = () => {
    setValue(stored ?? "");
    setEditing(false);
  };

  const submit = () => {
    if (error) {
      toast.error(error);
      return;
    }
    save.mutate(
      { addendumId, dealNumber: next },
      {
        onSuccess: () => {
          toast.success(next ? "Deal number saved" : "Deal number cleared");
          setEditing(false);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Deal number could not be saved"),
      },
    );
  };

  if (!editing) {
    return (
      <span className="inline-flex items-baseline justify-end gap-2">
        <span className={stored ? undefined : "text-adm-muted"}>{displayDealNumber(stored)}</span>
        <button type="button" onClick={() => setEditing(true)} className="text-[13px] font-medium text-adm-primary hover:underline">Edit</button>
      </span>
    );
  }

  return (
    <span className="flex w-[9.5rem] max-w-full flex-col items-end gap-2">
      <input
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && dirty) submit();
          if (e.key === "Escape") cancel();
        }}
        maxLength={DEAL_NUMBER_MAX_LENGTH + 16}
        placeholder="Not entered"
        aria-label="DMS deal number"
        className="h-8 w-full min-w-0 rounded-[6px] border border-adm-border bg-adm-surface px-2 text-right text-[14px] text-adm-ink placeholder:text-adm-muted"
      />
      <span className="inline-flex items-center gap-3">
        <Button onClick={submit} disabled={!dirty || save.isPending}>Save</Button>
        <button type="button" onClick={cancel} className="text-[13px] font-medium text-adm-primary hover:underline">Cancel</button>
      </span>
    </span>
  );
};

export default DealNumberField;
