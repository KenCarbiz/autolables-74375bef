import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/product";
import { useDealNumbers } from "@/hooks/useApprovedFields";
import { DEAL_NUMBER_MAX_LENGTH, displayDealNumber, normalizeDealNumber } from "@/lib/approvedFields/dealNumber";

export const DealNumberField = ({ addendumId, canEdit }: { addendumId: string; canEdit: boolean }) => {
  const { dealNumbers, save } = useDealNumbers([addendumId]);
  const stored = dealNumbers?.status === "available" ? dealNumbers.data.get(addendumId) ?? null : null;
  const [value, setValue] = useState(stored ?? "");
  useEffect(() => setValue(stored ?? ""), [stored]);

  if (dealNumbers?.status !== "available") {
    return <span className="text-adm-muted">{displayDealNumber(null)}</span>;
  }
  if (!canEdit) return <span className={stored ? undefined : "text-adm-muted"}>{displayDealNumber(stored)}</span>;

  const { value: next, error } = normalizeDealNumber(value);
  const dirty = next !== (stored ?? null);

  const submit = () => {
    if (error) {
      toast.error(error);
      return;
    }
    save.mutate(
      { addendumId, dealNumber: next },
      {
        onSuccess: () => toast.success(next ? "Deal number saved" : "Deal number cleared"),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Deal number could not be saved"),
      },
    );
  };

  return (
    <span className="inline-flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && dirty) submit(); }}
        maxLength={DEAL_NUMBER_MAX_LENGTH + 16}
        placeholder="Not entered"
        aria-label="DMS deal number"
        className="h-8 w-[140px] rounded-[6px] border border-adm-border bg-adm-surface px-2 text-right text-[14px] text-adm-ink placeholder:text-adm-muted"
      />
      <Button onClick={submit} disabled={!dirty || save.isPending}>Save</Button>
    </span>
  );
};

export default DealNumberField;
