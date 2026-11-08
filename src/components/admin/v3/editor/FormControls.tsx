import { forwardRef, useId, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { AdminIcon } from "./AdminIcon";
import { INPUT_CLASS } from "./EditorLayout";

/** Native select with the shared input chrome and a 20px chevron instead of the browser arrow. */
export const SelectField = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { wrapperClassName?: string }>(
  ({ className, wrapperClassName, children, ...rest }, ref) => (
    <span className={cn("relative inline-flex w-full", wrapperClassName)}>
      <select ref={ref} {...rest} className={cn(INPUT_CLASS, "appearance-none pr-10", className)}>{children}</select>
      <AdminIcon name="chevron-down" className="absolute right-3 top-1/2 -translate-y-1/2 text-adm-muted pointer-events-none" />
    </span>
  ),
);
SelectField.displayName = "SelectField";

/** Switch built on a real checkbox. The whole label is the hit area (44px on mobile). */
export const SwitchField = ({
  label,
  checked,
  onChange,
  disabled,
  ariaLabel,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) => {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("inline-flex items-center gap-2.5 min-h-[40px] max-sm:min-h-[44px] min-w-[44px] text-[14px] text-adm-ink", disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
      <input id={id} type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} aria-label={ariaLabel} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden="true" className="relative inline-block w-10 h-6 rounded-full bg-adm-border transition-colors peer-checked:bg-adm-primary peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-adm-primary after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4" />
      <span>{label}</span>
    </label>
  );
};
