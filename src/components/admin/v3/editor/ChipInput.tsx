import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { AdminIcon } from "./AdminIcon";
import { INPUT_CLASS } from "./EditorLayout";

export const ChipInput = ({
  label,
  values,
  onChange,
  placeholder = "Type and press Enter",
  validate,
  max,
  disabled,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  validate?: (value: string) => string | null;
  max?: number;
  disabled?: boolean;
}) => {
  const id = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");

  const add = () => {
    const v = text.trim();
    if (!v) return;
    const problem = validate?.(v) ?? (values.some((x) => x.toLowerCase() === v.toLowerCase()) ? `${v} is already added.` : max !== undefined && values.length >= max ? `You can add up to ${max}.` : null);
    if (problem) { setError(problem); return; }
    setError(null);
    setText("");
    onChange([...values, v]);
    setAnnounce(`${v} added`);
  };

  return (
    <div className="min-w-0 space-y-2">
      <label htmlFor={`${id}-in`} className="block text-[14px] leading-[20px] font-medium text-adm-ink">{label}</label>
      {values.length > 0 && (
        <ul aria-label={`${label} entries`} className="flex flex-wrap gap-2">
          {values.map((v) => (
            <li key={v} className="inline-flex items-center gap-1 rounded-full bg-adm-selected text-adm-primary pl-3 pr-1 min-h-[32px] text-[14px] font-medium max-w-full">
              <span className="break-all">{v}</span>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${v}`}
                onClick={() => { onChange(values.filter((x) => x !== v)); setAnnounce(`${v} removed`); }}
                className="inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-adm-surface disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary"
              >
                <AdminIcon name="close" size="compact" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={`${id}-in`}
        type="text"
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => { setText(e.target.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }}
        onBlur={add}
        className={cn(INPUT_CLASS)}
      />
      {error && <p id={`${id}-err`} role="alert" className="text-[13px] leading-[18px] font-medium text-adm-danger">{error}</p>}
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
    </div>
  );
};
