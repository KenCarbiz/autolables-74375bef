import { useId, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

// Form controls drawn to the reference: 40px inputs, 6px radius, 1px lines,
// labels in semibold 13px, hints in 12px. Every control has a real label.

export const controlClass =
  "h-10 w-full rounded-md border border-adm-border bg-adm-surface px-3 text-[14px] leading-[20px] text-adm-ink placeholder:text-adm-muted/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-adm-primary disabled:bg-adm-workspace disabled:text-adm-muted";

export const FieldLabel = ({ htmlFor, children, hint }: { htmlFor: string; children: ReactNode; hint?: ReactNode }) => (
  <label htmlFor={htmlFor} className="block text-[13px] leading-[18px] font-semibold text-adm-ink">
    {children}
    {hint && <span className="ml-1 font-normal text-adm-muted">{hint}</span>}
  </label>
);

export const FieldHint = ({ children, error }: { children: ReactNode; error?: boolean }) => (
  <p className={cn("mt-1 text-[12px] leading-[18px]", error ? "text-adm-danger" : "text-adm-muted")}>{children}</p>
);

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  error?: string | null;
};

export const TextField = ({ label, value, onChange, hint, error, id, className, ...rest }: TextFieldProps) => {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <div className={className}>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <input id={fieldId} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined} className={cn(controlClass, "mt-1", error && "border-adm-danger")} {...rest} />
      {error ? <FieldHint error>{error}</FieldHint> : hint ? <FieldHint>{hint}</FieldHint> : null}
    </div>
  );
};

type TextAreaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
};

export const TextAreaField = ({ label, value, onChange, hint, id, className, rows = 3, ...rest }: TextAreaFieldProps) => {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <div className={className}>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <textarea id={fieldId} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className={cn(controlClass, "mt-1 h-auto py-2 resize-y")} {...rest} />
      {hint && <FieldHint>{hint}</FieldHint>}
    </div>
  );
};

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> & {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  hint?: ReactNode;
  /** Render the label beside the control instead of above it. */
  inline?: boolean;
};

export const SelectControl = ({ value, onChange, options, id, className, ...rest }: Omit<SelectFieldProps, "label" | "hint" | "inline">) => (
  <span className={cn("relative block", className)}>
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn(controlClass, "appearance-none pr-9")} {...rest}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-adm-muted" aria-hidden="true" />
  </span>
);

export const SelectField = ({ label, hint, inline = false, id, className, ...rest }: SelectFieldProps) => {
  const auto = useId();
  const fieldId = id ?? auto;
  if (inline) {
    return (
      <RowField label={label} htmlFor={fieldId} className={className}>
        <SelectControl id={fieldId} {...rest} />
        {hint && <FieldHint>{hint}</FieldHint>}
      </RowField>
    );
  }
  return (
    <div className={className}>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <SelectControl id={fieldId} className="mt-1" {...rest} />
      {hint && <FieldHint>{hint}</FieldHint>}
    </div>
  );
};

/** Label on the left, control on the right, as the reference's identity card. */
export const RowField = ({ label, htmlFor, children, className }: { label: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) => (
  <div className={cn("grid grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)] sm:items-start gap-1 sm:gap-4", className)}>
    <label htmlFor={htmlFor} className="text-[13px] leading-[18px] font-semibold text-adm-ink sm:pt-2.5">{label}</label>
    <div className="min-w-0">{children}</div>
  </div>
);

export const ReadOnlyValue = ({ id, value, locked = false, editHref, editLabel, placeholder = "Not set" }: { id?: string; value: string; locked?: boolean; editHref?: string; editLabel?: string; placeholder?: string }) => (
  <div className="flex items-center gap-2">
    <span className="relative block w-full">
      <input id={id} readOnly value={value || placeholder} aria-readonly="true" className={cn(controlClass, "bg-adm-workspace text-adm-muted", locked && "pr-9")} />
      {locked && <Lock className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-adm-muted" aria-label="Read only" />}
    </span>
    {editHref && (
      <Link to={editHref} className="text-[13px] font-semibold text-adm-primary hover:underline whitespace-nowrap">{editLabel ?? "Edit"}</Link>
    )}
  </div>
);

/** Label above a read-only value, with the link to the tab that owns it. */
export const ReadOnlyField = ({ id, label, value, editHref, editLabel = "Edit", placeholder = "Not set", className }: { id?: string; label: ReactNode; value: string; editHref?: string; editLabel?: string; placeholder?: string; className?: string }) => {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <div className={className}>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <input id={fieldId} readOnly value={value || placeholder} aria-readonly="true" className={cn(controlClass, "mt-1 bg-adm-workspace text-adm-muted")} />
      {editHref && (
        <FieldHint>
          <Link to={editHref} className="font-semibold text-adm-primary hover:underline">{editLabel}</Link>
        </FieldHint>
      )}
    </div>
  );
};

export const ToggleRow = ({ label, hint, checked, onChange, disabled }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-[14px] leading-[20px] font-semibold text-adm-ink">{label}</label>
        {hint && <p className="text-[12px] leading-[18px] text-adm-muted">{hint}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 h-6 w-11 flex-shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary disabled:opacity-50", checked ? "bg-adm-primary" : "bg-adm-border")}
      >
        <span className={cn("absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-5" : "")} />
      </button>
    </div>
  );
};
